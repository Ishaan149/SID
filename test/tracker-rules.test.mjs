import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getFirestore, connectFirestoreEmulator, doc, getDocFromServer, getDocs, collection,
  setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, runTransaction,
  terminate, Timestamp, setLogLevel,
} from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = "demo-aete";
let sequence = 0;
const unique = (prefix) => `${prefix}-${++sequence}`;
const reject = (operation) => assert.rejects(operation, (error) => error.code === "permission-denied");

function encoded(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  return { stringValue: value };
}

// Admin REST calls are restricted to the disposable local emulator.
async function adminProfile(uid, role, active = true) {
  const response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`, {
    method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { role: encoded(role), active: encoded(active) } }),
  });
  assert.ok(response.ok, await response.text());
}

function eventFor(b, beforeStatus, uid, patch = {}) {
  const prefix = { Received: "received", Processing: "process", Ready: "ready", Dispatched: "dispatch" }[b.status] || "received";
  return {
    id: b.lastEventId, batchId: b.id, version: b.version, at: b.updatedAt,
    action: b.archived ? "Archived" : { Received: "Received", Processing: "Into process", Ready: "Ready", Dispatched: "Dispatched" }[b.status] || "Unknown",
    actorUid: uid, staffId: b.archived ? null : (b[`${prefix}StaffId`] ?? null),
    who: b.archived ? "Manager" : (b[`${prefix}By`] ?? "Unknown"), shift: b.archived ? null : (b[`${prefix}Shift`] ?? null),
    jobNo: b.jobNo, beforeStatus, afterStatus: b.status, snapshot: b, ...patch,
  };
}

function received(uid, patch = {}) {
  const id = unique("batch");
  return {
    id, jobNo: `JC-${id}`, customer: "Test customer", parts: "Cable trays",
    piecesIn: 10, weightIn: 100, status: "Received", receivedBy: "Plant Person",
    receivedStaffId: "r3-staff-plant", receivedShift: "Plant", receivedUid: uid,
    receivedAt: serverTimestamp(), notes: "", version: 1, archived: false,
    updatedAt: serverTimestamp(), lastEventId: unique("event"), ...patch,
  };
}

function advanced(old, uid, role, patch = {}) {
  const status = { Received: "Processing", Processing: "Ready", Ready: "Dispatched" }[old.status];
  const prefix = { Processing: "process", Ready: "ready", Dispatched: "dispatch" }[status];
  const shift = { plant: "Plant", shiftA: "Shift A", shiftB: "Shift B" }[role];
  return {
    ...old, status, version: old.version + 1, updatedAt: serverTimestamp(), lastEventId: unique("event"),
    [`${prefix}By`]: { plant: "Plant Person", shiftA: "Shift A Person", shiftB: "Shift B Person" }[role],
    [`${prefix}StaffId`]: `r3-staff-${role}`, [`${prefix}Shift`]: shift,
    [`${prefix}At`]: serverTimestamp(), [`${prefix}Uid`]: uid,
    ...(status === "Ready" ? { piecesOut: 10, weightOut: 105 } : {}), ...patch,
  };
}

function archived(old, uid, patch = {}) {
  return {
    ...old, archived: true, archivedAt: serverTimestamp(), archivedUid: uid,
    archiveReason: "Incorrect job card; retained for review", version: old.version + 1,
    updatedAt: serverTimestamp(), lastEventId: unique("event"), ...patch,
  };
}

async function atomic(db, b, beforeStatus = null, eventPatch = {}) {
  const writes = writeBatch(db);
  writes.set(doc(db, "batches", b.id), b);
  writes.set(doc(db, "activity", b.lastEventId), eventFor(b, beforeStatus, db.actorUid, eventPatch));
  await writes.commit();
}
const read = async (db, id) => (await getDocFromServer(doc(db, "batches", id))).data();

// All cases use production rules and requests through the ordinary client SDK.
// No test helper bypasses rules for batch/roster/activity writes.
test("tracker server rules", { skip: !host, timeout: 90000 }, async (t) => {
  setLogLevel("silent");
  const [hostname, port] = host.split(":");
  const clients = [];
  const client = (name, role, active = true) => {
    const app = initializeApp({ projectId, apiKey: "demo-key" }, `r3-${name}`);
    const db = getFirestore(app);
    const uid = name === "anonymous" ? null : `r3-${name}`;
    connectFirestoreEmulator(db, hostname, Number(port), uid ? { mockUserToken: { sub: uid } } : {});
    db.actorUid = uid;
    clients.push({ db, app, uid, role, active });
    return db;
  };
  const manager = client("manager", "manager");
  const plant = client("plant", "plant");
  const shiftA = client("shiftA", "shiftA");
  const shiftB = client("shiftB", "shiftB");
  const otherA = client("otherA", "shiftA");
  const inactive = client("inactive", "plant", false);
  const invalid = client("invalid", "administrator");
  const missing = client("missing", null);
  const anonymous = client("anonymous", null);
  const staff = {
    plant: { id: "r3-staff-plant", name: "Plant Person", role: "Plant Supervisor", shift: "Plant", active: true },
    shiftA: { id: "r3-staff-shiftA", name: "Shift A Person", role: "Shift A Supervisor", shift: "Shift A", active: true },
    shiftB: { id: "r3-staff-shiftB", name: "Shift B Person", role: "Shift B Supervisor", shift: "Shift B", active: true },
  };
  async function atStage(status = "Received") {
    const b = received(plant.actorUid);
    await atomic(plant, b);
    let current = await read(plant, b.id);
    if (status !== "Received") {
      await atomic(shiftA, advanced(current, shiftA.actorUid, "shiftA"), "Received");
      current = await read(plant, b.id);
    }
    if (status === "Ready" || status === "Dispatched") {
      await atomic(shiftB, advanced(current, shiftB.actorUid, "shiftB"), "Processing");
      current = await read(plant, b.id);
    }
    if (status === "Dispatched") {
      await atomic(plant, advanced(current, plant.actorUid, "plant"), "Ready");
      current = await read(plant, b.id);
    }
    return current;
  }
  try {
    for (const c of clients) if (c.role) await adminProfile(c.uid, c.role, c.active);
    for (const person of Object.values(staff)) await setDoc(doc(manager, "roster", person.id), person);

    await t.test("all active roles can read; anonymous, missing, inactive, and invalid roles cannot", async () => {
      const b = await atStage();
      for (const db of [manager, plant, shiftA, shiftB]) {
        assert.equal((await read(db, b.id)).status, "Received");
        await getDocs(collection(db, "roster"));
        await getDocs(collection(db, "activity"));
      }
      for (const db of [anonymous, missing, inactive, invalid]) {
        for (const name of ["batches", "roster", "activity"]) await reject(getDocs(collection(db, name)));
        await reject(getDocFromServer(doc(db, "batches", b.id)));
        await reject(atomic(db, received(db.actorUid)));
      }
    });

    await t.test("plant receives; either shift processes/completes; plant dispatches with preserved snapshots", async () => {
      const b = await atStage("Dispatched");
      assert.equal(b.version, 4);
      assert.equal(b.processUid, shiftA.actorUid);
      assert.equal(b.readyUid, shiftB.actorUid);
      assert.equal(b.dispatchUid, plant.actorUid);
      assert.ok(b.receivedAt instanceof Timestamp);
      assert.ok(b.receivedAt.toMillis() <= b.processAt.toMillis());
      const e = (await getDocFromServer(doc(manager, "activity", b.lastEventId))).data();
      assert.deepEqual(e.snapshot, b);
      assert.equal(e.actorUid, plant.actorUid);
      assert.equal(e.staffId, staff.plant.id);
    });

    await t.test("Shift B can start processing, Shift A can complete it, and a second Shift A account can act", async () => {
      const b = await atStage();
      await atomic(shiftB, advanced(b, shiftB.actorUid, "shiftB"), b.status);
      const p = await read(manager, b.id);
      await atomic(shiftA, advanced(p, shiftA.actorUid, "shiftA"), p.status);
      assert.equal((await read(manager, b.id)).readyUid, shiftA.actorUid);
      const another = await atStage();
      await atomic(otherA, advanced(another, otherA.actorUid, "shiftA"), another.status);
      assert.equal((await read(manager, another.id)).processUid, otherA.actorUid);
    });

    await t.test("direct SDK requests cannot bypass role checks at any stage", async () => {
      for (const db of [manager, shiftA, shiftB]) await reject(atomic(db, received(db.actorUid)));
      const b = await atStage();
      for (const db of [manager, plant]) await reject(atomic(db, advanced(b, db.actorUid, "shiftA"), b.status));
      const p = await atStage("Processing");
      for (const db of [manager, plant]) await reject(atomic(db, advanced(p, db.actorUid, "shiftA"), p.status));
      const r = await atStage("Ready");
      for (const db of [manager, shiftA, shiftB]) await reject(atomic(db, advanced(r, db.actorUid, "plant"), r.status));
    });

    await t.test("receive validates required fields, schema, document IDs, text, and numeric ranges", async () => {
      for (const patch of [
        { customer: "" }, { jobNo: "   " }, { parts: "x".repeat(501) }, { piecesIn: -1 },
        { piecesIn: 1.5 }, { piecesIn: "10" }, { piecesIn: 1000000001 }, { weightIn: -1 },
        { weightIn: Infinity }, { weightIn: NaN }, { weightIn: "100" }, { weightIn: 1000000000001 },
        { notes: "x".repeat(2001) }, { extra: true }, { archived: true }, { version: 2 },
        { id: "unsafe.id" }, { receivedAt: Timestamp.fromMillis(0) }, { updatedAt: Timestamp.fromMillis(0) },
        { receivedUid: "someone-else" }, { lastEventId: "unsafe.event" },
      ]) await reject(atomic(plant, received(plant.actorUid, patch)));
      const omitted = received(plant.actorUid);
      delete omitted.customer;
      await reject(atomic(plant, omitted));
      const mismatched = received(plant.actorUid);
      const writes = writeBatch(plant);
      writes.set(doc(plant, "batches", unique("different-id")), mismatched);
      writes.set(doc(plant, "activity", mismatched.lastEventId), eventFor(mismatched, null, plant.actorUid));
      await reject(writes.commit());
      // Zero and quantity discrepancies remain permitted by the existing workflow.
      await atomic(plant, received(plant.actorUid, { piecesIn: 0, weightIn: 0 }));
    });

    await t.test("active roster identity, name, and shift must match; a shift cannot impersonate another shift", async () => {
      for (const patch of [
        { receivedStaffId: "missing-person" }, { receivedBy: "Forged Name" },
        { receivedStaffId: staff.shiftA.id, receivedBy: staff.shiftA.name }, { receivedShift: "Shift A" },
      ]) await reject(atomic(plant, received(plant.actorUid, patch)));
      await updateDoc(doc(manager, "roster", staff.plant.id), { active: false });
      await reject(atomic(plant, received(plant.actorUid)));
      await updateDoc(doc(manager, "roster", staff.plant.id), { active: true });
      const b = await atStage();
      await reject(atomic(shiftA, advanced(b, shiftA.actorUid, "shiftB"), "Received"));
      await reject(atomic(shiftA, advanced(b, "forged-account", "shiftA"), "Received"));
      await updateDoc(doc(manager, "roster", staff.shiftA.id), { active: false });
      await reject(atomic(shiftA, advanced(b, shiftA.actorUid, "shiftA"), "Received"));
      await updateDoc(doc(manager, "roster", staff.shiftA.id), { active: true });
    });

    await t.test("received fields and previous stage history cannot be rewritten during a legitimate transition", async () => {
      const b = await atStage();
      for (const patch of [
        { piecesIn: 999 }, { weightIn: 999 }, { customer: "Rewritten" }, { jobNo: "Rewritten" },
        { parts: "Rewritten" }, { notes: "Rewritten" }, { receivedBy: "Rewritten" },
        { receivedUid: shiftA.actorUid }, { receivedAt: serverTimestamp() },
      ]) await reject(atomic(shiftA, advanced(b, shiftA.actorUid, "shiftA", patch), b.status));
      const p = await atStage("Processing");
      await reject(atomic(shiftA, advanced(p, shiftA.actorUid, "shiftA", { processBy: "Rewritten" }), p.status));
      const r = await atStage("Ready");
      await reject(atomic(plant, advanced(r, plant.actorUid, "plant", { piecesOut: 999 }), r.status));
    });

    await t.test("skipped/backward/no-op stages and premature output fields are rejected", async () => {
      const b = await atStage();
      const skipped = advanced(advanced(b, shiftA.actorUid, "shiftA"), shiftA.actorUid, "shiftA", { version: b.version + 1 });
      await reject(atomic(shiftA, skipped, b.status));
      await reject(atomic(shiftA, advanced(b, shiftA.actorUid, "shiftA", { piecesOut: 10 }), b.status));
      const p = await atStage("Processing");
      for (const status of ["Received", "Processing", "Dispatched", "Invented"]) {
        await reject(atomic(shiftA, advanced(p, shiftA.actorUid, "shiftA", { status }), p.status));
      }
      const done = await atStage("Dispatched");
      await reject(atomic(plant, { ...done, version: done.version + 1, updatedAt: serverTimestamp(), lastEventId: unique("event") }, done.status));
    });

    await t.test("output quantities and current action times are validated while discrepancies remain allowed", async () => {
      const p = await atStage("Processing");
      for (const patch of [
        { piecesOut: -1 }, { piecesOut: 1.5 }, { piecesOut: "10" }, { piecesOut: 1000000001 },
        { weightOut: -1 }, { weightOut: Infinity }, { weightOut: NaN }, { weightOut: "105" },
        { readyAt: Timestamp.fromMillis(0) }, { updatedAt: Timestamp.fromMillis(0) },
      ]) await reject(atomic(shiftA, advanced(p, shiftA.actorUid, "shiftA", patch), p.status));
      await atomic(shiftA, advanced(p, shiftA.actorUid, "shiftA", { piecesOut: 12, weightOut: 0 }), p.status);
      assert.equal((await read(plant, p.id)).piecesOut, 12);
    });

    await t.test("a batch mutation without its new activity entry is rejected atomically", async () => {
      const fresh = received(plant.actorUid);
      await reject(setDoc(doc(plant, "batches", fresh.id), fresh));
      assert.equal((await getDocFromServer(doc(plant, "batches", fresh.id))).exists(), false);
      const b = await atStage();
      const next = advanced(b, shiftA.actorUid, "shiftA");
      await reject(setDoc(doc(shiftA, "batches", b.id), next));
      assert.equal((await read(plant, b.id)).version, 1);
      assert.equal((await getDocFromServer(doc(plant, "activity", next.lastEventId))).exists(), false);
    });

    await t.test("forged event content rejects both documents, including altered snapshots and actor identities", async () => {
      const b = await atStage();
      for (const patch of [
        { actorUid: "someone-else" }, { who: "Forged Name" }, { staffId: staff.shiftB.id },
        { shift: "Plant" }, { jobNo: "Wrong Job" }, { version: 20 }, { beforeStatus: "Ready" },
        { afterStatus: "Dispatched" }, { action: "Dispatched" }, { at: Timestamp.fromMillis(0) },
        { batchId: "another-batch" }, { extra: true }, { snapshot: { ...b, customer: "Forged" } },
      ]) {
        const next = advanced(b, shiftA.actorUid, "shiftA");
        await reject(atomic(shiftA, next, b.status, patch));
        assert.equal((await read(plant, b.id)).version, 1);
        assert.equal((await getDocFromServer(doc(plant, "activity", next.lastEventId))).exists(), false);
      }
    });

    await t.test("orphaned, replayed, edited, and deleted activity entries are denied, even to a manager", async () => {
      const b = await atStage();
      const newId = unique("event");
      await reject(setDoc(doc(plant, "activity", newId), eventFor({ ...b, lastEventId: newId }, null, plant.actorUid)));
      const missingBatch = received(plant.actorUid);
      await reject(setDoc(doc(plant, "activity", missingBatch.lastEventId), eventFor(missingBatch, null, plant.actorUid)));
      for (const db of [manager, plant, shiftA]) {
        await reject(updateDoc(doc(db, "activity", b.lastEventId), { who: "Rewritten" }));
        await reject(deleteDoc(doc(db, "activity", b.lastEventId)));
      }
      await reject(atomic(shiftA, advanced(b, shiftA.actorUid, "shiftA", { lastEventId: b.lastEventId }), b.status));
    });

    await t.test("only managers can archive with a reason and a matching immutable event; physical deletion is denied", async () => {
      for (const status of ["Received", "Processing", "Ready", "Dispatched"]) {
        const b = await atStage(status);
        for (const db of [plant, shiftA, shiftB]) await reject(atomic(db, archived(b, db.actorUid), b.status));
        for (const patch of [{ archiveReason: " " }, { archivedUid: plant.actorUid }, { piecesIn: 99 }]) {
          await reject(atomic(manager, archived(b, manager.actorUid, patch), b.status));
        }
        await atomic(manager, archived(b, manager.actorUid), b.status);
        const archivedBatch = await read(manager, b.id);
        assert.equal(archivedBatch.status, status);
        assert.equal(archivedBatch.archived, true);
        assert.equal(archivedBatch.archivedUid, manager.actorUid);
        assert.equal(archivedBatch.piecesIn, b.piecesIn);
        const log = (await getDocFromServer(doc(manager, "activity", archivedBatch.lastEventId))).data();
        assert.equal(log.action, "Archived");
        assert.equal(log.actorUid, manager.actorUid);
        await reject(deleteDoc(doc(manager, "batches", b.id)));
        await reject(atomic(manager, { ...archivedBatch, archived: false, version: archivedBatch.version + 1,
          lastEventId: unique("event"), updatedAt: serverTimestamp() }, status));
      }
      const activeBatch = await atStage();
      await reject(deleteDoc(doc(manager, "batches", activeBatch.id)));
    });

    await t.test("multiline required text is accepted while multiline whitespace remains denied", async () => {
      for (const key of ['jobNo', 'customer', 'parts']) {
        await reject(atomic(plant, received(plant.actorUid, { [key]: ' \n\t\r ' })));
      }
      const b = received(plant.actorUid, { customer: 'Customer\nSecond line', parts: 'قناة "quoted", brackets\nSecond line' });
      await atomic(plant, b);
      const stored = await read(manager, b.id);
      await reject(atomic(manager, archived(stored, manager.actorUid, { archiveReason: ' \n\t\r ' }), stored.status));
      await atomic(manager, archived(stored, manager.actorUid, { archiveReason: '@review\nSecond line "retained"' }), stored.status);
      const result = await read(manager, b.id);
      assert.equal(result.archiveReason, '@review\nSecond line "retained"');
      const event = (await getDocFromServer(doc(manager, 'activity', result.lastEventId))).data();
      assert.equal(event.snapshot.archiveReason, result.archiveReason);
      assert.equal(result.customer, stored.customer);
      assert.equal(result.parts, stored.parts);
    });

    await t.test("later roster edits or removal do not invalidate or rewrite historical batch snapshots", async () => {
      const p = await atStage("Processing");
      await updateDoc(doc(manager, "roster", staff.shiftA.id), { name: "Renamed Person", active: false });
      await atomic(shiftB, advanced(p, shiftB.actorUid, "shiftB"), p.status);
      let b = await read(manager, p.id);
      assert.equal(b.processBy, staff.shiftA.name);
      await deleteDoc(doc(manager, "roster", staff.shiftA.id));
      await atomic(plant, advanced(b, plant.actorUid, "plant"), b.status);
      b = await read(manager, p.id);
      assert.equal(b.processBy, staff.shiftA.name);
      await setDoc(doc(manager, "roster", staff.shiftA.id), staff.shiftA);
    });

    await t.test("roster schema and manager-only writes cannot grant login permissions", async () => {
      const entry = { id: unique("staff"), name: "New Worker", role: "Shift A Supervisor", shift: "Shift A", active: true };
      for (const db of [plant, shiftA, shiftB, anonymous, inactive]) await reject(setDoc(doc(db, "roster", entry.id), entry));
      for (const patch of [{ name: " " }, { active: "true" }, { shift: "Plant" }, { role: "manager" }, { uid: "fake" }]) {
        await reject(setDoc(doc(manager, "roster", entry.id), { ...entry, ...patch }));
      }
      await setDoc(doc(manager, "roster", entry.id), entry);
      await updateDoc(doc(manager, "roster", entry.id), { active: false });
      for (const db of [plant, shiftA]) await reject(deleteDoc(doc(db, "roster", entry.id)));
      await deleteDoc(doc(manager, "roster", entry.id));
      await reject(setDoc(doc(manager, "users", unique("user")), { role: "manager", active: true }));
      await reject(updateDoc(doc(shiftA, "users", shiftA.actorUid), { role: "manager" }));
    });

    await t.test("stale revisions cannot overwrite a completed transition", async () => {
      const b = await atStage();
      await atomic(shiftA, advanced(b, shiftA.actorUid, "shiftA"), b.status);
      const stale = advanced(b, shiftB.actorUid, "shiftB");
      await reject(atomic(shiftB, stale, b.status));
      assert.equal((await read(manager, b.id)).processUid, shiftA.actorUid);
      assert.equal((await getDocFromServer(doc(manager, "activity", stale.lastEventId))).exists(), false);
      const p = await read(plant, b.id);
      await reject(atomic(shiftA, advanced(p, shiftA.actorUid, "shiftA", { version: p.version }), p.status));
      await reject(atomic(shiftA, advanced(p, shiftA.actorUid, "shiftA", { version: p.version + 2 }), p.status));
    });

    await t.test("two independent clients race: one transaction commits, the stale request is rejected, with one log", async () => {
      const b = await atStage();
      let firstReads = 0;
      let release;
      const bothRead = new Promise((resolve) => { release = resolve; });
      const eventIds = [];
      function attempt(db) {
        let calls = 0;
        const eventId = unique("race-event");
        eventIds.push(eventId);
        return runTransaction(db, async (tx) => {
          const current = (await tx.get(doc(db, "batches", b.id))).data();
          if (current.version !== b.version) throw new Error("Batch changed; reload before retrying.");
          if (++calls === 1) { if (++firstReads === 2) release(); await bothRead; }
          const next = advanced(current, db.actorUid, "shiftA", { lastEventId: eventId });
          tx.set(doc(db, "batches", b.id), next);
          tx.set(doc(db, "activity", eventId), eventFor(next, current.status, db.actorUid));
        });
      }
      const results = await Promise.allSettled([attempt(shiftA), attempt(otherA)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const failure = results.find((r) => r.status === "rejected").reason;
      // The emulator can evaluate stale-write rules before the transaction
      // precondition. Both a retry conflict and a rules denial are valid;
      // below we verify the committed revision and absence of the losing log.
      assert.ok(failure.code === "permission-denied" || /Batch changed/.test(failure.message));
      const committed = await read(manager, b.id);
      assert.equal(committed.version, 2);
      assert.equal(committed.status, "Processing");
      let logs = 0;
      for (const id of eventIds) if ((await getDocFromServer(doc(manager, "activity", id))).exists()) logs++;
      assert.equal(logs, 1);
    });

    await t.test("revoking a role immediately denies server reads and writes for an already connected client", async () => {
      const b = await atStage();
      await adminProfile(otherA.actorUid, "shiftA", false);
      await reject(getDocFromServer(doc(otherA, "batches", b.id)));
      await reject(atomic(otherA, advanced(b, otherA.actorUid, "shiftA"), b.status));
    });

    await t.test("unknown collections, legacy PIN settings, and nested paths are denied", async () => {
      for (const path of [["settings", "app"], ["other", "data"], ["users", manager.actorUid, "roles", "manager"],
        ["batches", "x", "notes", "x"], ["roster", staff.plant.id, "private", "x"]]) {
        await reject(getDocFromServer(doc(manager, ...path)));
        await reject(setDoc(doc(manager, ...path), { allow: true }));
      }
    });
  } finally {
    for (const { db, app } of clients) { await terminate(db); await deleteApp(app); }
  }
});
