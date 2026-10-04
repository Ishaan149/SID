import { getFirebaseClient } from "./firebaseClient.js";
import {
  collection, doc, getDocFromServer, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import {
  activityFor, dateOf, requireId, requireQuantity, requireRevision, requireRole,
  requireStaff, requireText, roleShift, saveFailure, STAFF_SHIFTS, trackerError,
} from "./mutations.js";

const sameStaff = (a, b) => ["id", "name", "role", "shift", "active"].every((key) => a?.[key] === b?.[key]);
const sameIdentity = (a, b) => ["id", "name", "role", "shift"].every((key) => a?.[key] === b?.[key]);
const onlineByDefault = () => globalThis.navigator?.onLine !== false;

export function createFirebaseAdapter({ client = getFirebaseClient(), expectedUid, isOnline = onlineByDefault } = {}) {
  const { db, auth } = client;
  const signedInUid = () => {
    const uid = auth.currentUser?.uid;
    if (!uid || (expectedUid && uid !== expectedUid)) throw trackerError("signed-out", "The account changed. Sign in again before saving.");
    return uid;
  };
  const requireOnline = () => {
    if (!isOnline()) throw trackerError("offline", "You are offline. Reconnect before saving; shared data has not been replaced with browser storage.");
  };
  function confirmedEvent(event, kind, input, uid) {
    const snapshot = event?.snapshot;
    const action = kind === "receiveBatch" ? "Received" : kind === "archiveBatch" ? "Archived"
      : { Received: "Into process", Processing: "Ready", Ready: "Dispatched" }[input.expectedStatus];
    if (event.actorUid !== uid || event.batchId !== input.id || event.action !== action) {
      throw trackerError("conflict", "This request ID belongs to a different operation. Review the latest data.");
    }
    const matches = kind === "receiveBatch"
      ? snapshot.jobNo === input.jobNo && snapshot.customer === input.customer && snapshot.parts === input.parts
        && snapshot.piecesIn === input.piecesIn && snapshot.weightIn === input.weightIn && snapshot.receivedStaffId === input.staffId
        && snapshot.notes === input.notes
      : kind === "archiveBatch" ? snapshot.archiveReason === input.reason && event.version === input.expectedVersion + 1
      : event.staffId === input.staffId && event.beforeStatus === input.expectedStatus && event.version === input.expectedVersion + 1
        && (input.expectedStatus !== "Processing" || (snapshot.piecesOut === input.piecesOut && snapshot.weightOut === input.weightOut));
    if (!matches) throw trackerError("already-saved", "The earlier request was already saved with different form details. Close this form and review the saved record.");
    return { id: input.id, replayed: true };
  }
  function normalize(kind, raw) {
    const input = { ...raw, id: requireId(raw.id) };
    if (["receiveBatch", "transitionBatch", "archiveBatch"].includes(kind)) input.mutationId = requireId(raw.mutationId);
    if (kind === "receiveBatch") {
      input.jobNo = requireText(raw.jobNo, "Job number", 80);
      input.customer = requireText(raw.customer, "Customer", 200);
      input.parts = requireText(raw.parts, "Parts", 500);
      input.piecesIn = requireQuantity(raw.piecesIn, "Pieces in", true);
      input.weightIn = requireQuantity(raw.weightIn, "Weight in");
      input.staffId = requireId(raw.staffId);
      input.notes = raw.notes || "";
      if (typeof input.notes !== "string" || input.notes.length > 2000) throw trackerError("invalid-input", "Notes must be at most 2,000 characters.");
    }
    if (kind === "transitionBatch") {
      input.staffId = requireId(raw.staffId);
      if (raw.expectedStatus === "Processing") {
        input.piecesOut = requireQuantity(raw.piecesOut, "Pieces out", true);
        input.weightOut = requireQuantity(raw.weightOut, "Weight out");
      }
    }
    if (kind === "archiveBatch") input.reason = requireText(raw.reason, "Archive reason", 500);
    if (kind === "transitionBatch" || kind === "archiveBatch") {
      if (!Number.isInteger(raw.expectedVersion) || !["Received", "Processing", "Ready", "Dispatched"].includes(raw.expectedStatus)) {
        throw trackerError("invalid-input", "This batch needs to be reloaded before it can be changed.");
      }
    }
    return input;
  }
  async function mutateBatch(kind, raw) {
    let input;
    let uid;
    let attemptedWrite = false;
    try {
      input = normalize(kind, raw);
      requireOnline();
      uid = signedInUid();
      return await runTransaction(db, async (tx) => {
        signedInUid();
        const eventRef = doc(db, "activity", input.mutationId);
        const batchRef = doc(db, "batches", input.id);
        const [receipt, stored, account] = await Promise.all([
          tx.get(eventRef), tx.get(batchRef), tx.get(doc(db, "users", uid)),
        ]);
        if (receipt.exists()) return confirmedEvent(receipt.data(), kind, input, uid);
        const profile = account.data();
        const previous = stored.exists() ? stored.data() : null;
        let next;
        if (kind === "receiveBatch") {
          requireRole(profile, ["plant"]);
          if (previous) throw trackerError("conflict", "This batch ID already exists. Review the saved batches.");
          const staff = (await tx.get(doc(db, "roster", input.staffId))).data();
          requireStaff(staff, "Plant");
          next = {
            id: input.id, jobNo: input.jobNo, customer: input.customer, parts: input.parts,
            piecesIn: input.piecesIn, weightIn: input.weightIn, notes: input.notes,
            status: "Received", receivedStaffId: staff.id, receivedBy: staff.name, receivedShift: "Plant",
            receivedUid: uid, receivedAt: serverTimestamp(), version: 1, archived: false,
          };
        } else {
          requireRevision(previous, input);
          if (kind === "archiveBatch") {
            requireRole(profile, ["manager"]);
            next = { ...previous, archived: true, archivedAt: serverTimestamp(), archivedUid: uid, archiveReason: input.reason };
          } else {
            const role = requireRole(profile, previous.status === "Ready" ? ["plant"] : ["shiftA", "shiftB"]);
            const shift = roleShift(role);
            const staff = (await tx.get(doc(db, "roster", input.staffId))).data();
            requireStaff(staff, shift);
            const status = { Received: "Processing", Processing: "Ready", Ready: "Dispatched" }[previous.status];
            if (!status) throw trackerError("conflict", "This batch has already been dispatched.");
            const prefix = { Processing: "process", Ready: "ready", Dispatched: "dispatch" }[status];
            next = { ...previous, status, [`${prefix}StaffId`]: staff.id, [`${prefix}By`]: staff.name,
              [`${prefix}Shift`]: shift, [`${prefix}Uid`]: uid, [`${prefix}At`]: serverTimestamp(),
              ...(status === "Ready" ? { piecesOut: input.piecesOut, weightOut: input.weightOut } : {}),
            };
          }
          next.version = previous.version + 1;
        }
        next.updatedAt = serverTimestamp();
        next.lastEventId = input.mutationId;
        signedInUid();
        attemptedWrite = true;
        tx.set(batchRef, next);
        tx.set(eventRef, activityFor(next, previous?.status || null, uid));
        return { id: input.id, replayed: false };
      }, { maxAttempts: 3 });
    } catch (error) {
      // A lost commit response is checked against the original immutable event.
      // Retry uses this same event ID, never a second event for the same request.
      if (input && uid && isOnline() && auth.currentUser?.uid === uid) {
        try {
          const receipt = await getDocFromServer(doc(db, "activity", input.mutationId));
          if (receipt.exists()) return confirmedEvent(receipt.data(), kind, input, uid);
          if (kind !== "receiveBatch") {
            const latest = (await getDocFromServer(doc(db, "batches", input.id))).data();
            requireRevision(latest, input);
          }
        } catch (checkError) {
          if (["conflict", "already-saved"].includes(checkError.code)) throw checkError;
        }
      }
      if (attemptedWrite && auth.currentUser?.uid !== uid) throw Object.assign(saveFailure({ code: "unknown" }), { uncertain: true });
      throw saveFailure(error);
    }
  }
  async function mutateRoster(kind, input) {
    try {
      requireId(input.id);
      requireOnline();
      const uid = signedInUid();
      return await runTransaction(db, async (tx) => {
        const ref = doc(db, "roster", input.id);
        const [account, stored] = await Promise.all([tx.get(doc(db, "users", uid)), tx.get(ref)]);
        requireRole(account.data(), ["manager"]);
        const current = stored.data();
        if (kind === "addStaff") {
          const name = requireText(input.name, "Staff name", 120);
          if (!Object.hasOwn(STAFF_SHIFTS, input.role)) throw trackerError("invalid-input", "Select a valid staff role.");
          const staff = { id: input.id, name, role: input.role, shift: STAFF_SHIFTS[input.role], active: true };
          if (stored.exists()) {
            if (sameStaff(current, staff)) return { id: input.id, replayed: true };
            throw trackerError("conflict", "This staff record already exists and has changed. Review the roster.");
          }
          signedInUid();
          tx.set(ref, staff);
        } else if (kind === "setStaffActive") {
          if (typeof input.active !== "boolean") throw trackerError("invalid-input", "Staff active status must be true or false.");
          if (!sameIdentity(current, input.expected)) throw trackerError("conflict", "This staff record changed. Review the latest roster.");
          if (current.active === input.active) return { id: input.id, replayed: true };
          if (!sameStaff(current, input.expected)) throw trackerError("conflict", "This staff record changed. Review the latest roster.");
          signedInUid();
          tx.update(ref, { active: input.active });
        } else {
          if (!stored.exists()) return { id: input.id, replayed: true };
          if (!sameStaff(current, input.expected)) throw trackerError("conflict", "This staff record changed. Review the latest roster before removing it.");
          signedInUid();
          tx.delete(ref);
        }
        return { id: input.id, replayed: false };
      }, { maxAttempts: 3 });
    } catch (error) { throw saveFailure(error); }
  }
  return {
    kind: "firebase",
    subscribeHistory(id, next, fail) {
      return onSnapshot(query(collection(db, "activity"), where("batchId", "==", requireId(id))),
        { includeMetadataChanges: true }, (snapshot) => {
          if (snapshot.metadata.hasPendingWrites) return;
          next(snapshot.docs.map((item) => item.data()).sort((a, b) =>
            (dateOf(a.at)?.getTime() || 0) - (dateOf(b.at)?.getTime() || 0)), snapshot.metadata.fromCache);
        }, () => fail(new Error("Batch history could not be loaded. Check your connection and account access.")));
    },
    receiveBatch: (input) => mutateBatch("receiveBatch", input),
    transitionBatch: (input) => mutateBatch("transitionBatch", input),
    archiveBatch: (input) => mutateBatch("archiveBatch", input),
    addStaff: (input) => mutateRoster("addStaff", input),
    setStaffActive: (input) => mutateRoster("setStaffActive", input),
    removeStaff: (input) => mutateRoster("removeStaff", input),
    subscribe(next, fail) {
      const snapshots = {};
      let stopped = false;
      let failure = null;
      let committed = null;
      const publish = () => {
        if (stopped) return;
        const all = Object.values(snapshots);
        const ready = all.length === 3;
        const connected = ready && isOnline() && !failure && all.every((s) => !s.fromCache);
        if (ready && (committed || connected)) committed = { batches: snapshots.batches.data, roster: snapshots.roster.data, activity: snapshots.activity.data };
        next(committed, { connected, error: failure, fromCache: !connected });
      };
      const watch = (name, target) => onSnapshot(target, { includeMetadataChanges: true }, (snapshot) => {
        if (stopped) return;
        const old = snapshots[name]?.data || [];
        // Never show provisional writes as successfully saved shared records.
        snapshots[name] = { fromCache: snapshot.metadata.fromCache,
          data: snapshot.metadata.hasPendingWrites ? old : snapshot.docs.map((item) => ({ ...item.data(), id: item.id })) };
        publish();
      }, (error) => {
        if (stopped) return;
        failure = trackerError(error.code, error.code === "permission-denied"
          ? "Shared data access was denied. Ask your manager to check account access and database setup."
          : "Shared data could not be loaded. Check your connection and retry.");
        fail(failure);
        publish();
      });
      const stops = [
        watch("batches", collection(db, "batches")), watch("roster", collection(db, "roster")),
        watch("activity", query(collection(db, "activity"), orderBy("at", "desc"), limit(120))),
      ];
      globalThis.window?.addEventListener("online", publish);
      globalThis.window?.addEventListener("offline", publish);
      return () => {
        stopped = true;
        stops.forEach((stop) => stop());
        globalThis.window?.removeEventListener("online", publish);
        globalThis.window?.removeEventListener("offline", publish);
      };
    },
  };
}
