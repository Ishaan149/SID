import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, terminate, writeBatch } from "firebase/firestore";
import { quickEntryRecords } from "../src/auth/quickEntry.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;

test("rules allow anonymous quick entry while isolating profiles and denying manager grants", { skip: !host }, async () => {
  const [hostname, port] = host.split(":");
  const projectId = "demo-aete";
  const clients = [];
  const client = (uid, anonymousToken = false) => {
    const app = initializeApp({ projectId, apiKey: "demo-key" }, `rules-${uid || "anonymous"}`);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, hostname, Number(port), uid ? { mockUserToken: {
      sub: uid, ...(anonymousToken ? { firebase: { sign_in_provider: "anonymous" } } : {}),
    } } : {});
    clients.push({ app, db });
    return db;
  };
  const denied = (operation) => assert.rejects(operation, (error) => error.code === "permission-denied");
  try {
    for (const [uid, role] of [["manager", "manager"], ["worker", "shiftA"]]) {
      const response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`, {
        method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { role: { stringValue: role }, active: { booleanValue: true } } }),
      });
      assert.equal(response.ok, true, await response.text());
    }
    const manager = client("manager");
    const worker = client("worker");
    const anonymous = client();
    const missing = client("unassigned");
    assert.equal((await getDoc(doc(manager, "users", "manager"))).data().role, "manager");
    assert.equal((await getDoc(doc(worker, "users", "worker"))).data().role, "shiftA");
    assert.equal((await getDoc(doc(missing, "users", "unassigned"))).exists(), false);
    await denied(getDoc(doc(anonymous, "users", "manager")));
    await denied(getDoc(doc(worker, "users", "manager")));
    await denied(getDoc(doc(manager, "users", "worker")));
    await denied(getDocs(collection(manager, "users")));
    await denied(updateDoc(doc(worker, "users", "worker"), { role: "manager" }));
    await denied(updateDoc(doc(manager, "users", "manager"), { active: false }));
    await denied(setDoc(doc(missing, "users", "unassigned"), { role: "manager", active: true }));
    await denied(setDoc(doc(manager, "users", "new-manager"), { role: "manager", active: true }));
    await denied(deleteDoc(doc(manager, "users", "manager")));
    await getDocs(collection(manager, "batches"));
    await denied(getDocs(collection(missing, "batches")));
    await denied(getDocs(collection(anonymous, "batches")));
    await denied(setDoc(doc(manager, "batches", "batch"), { status: "Received" }));
    await denied(setDoc(doc(worker, "roster", "staff"), { role: "manager" }));

    const quickEntry = (db, uid, profile, staff) => {
      const batch = writeBatch(db);
      batch.set(doc(db, "users", uid), profile);
      batch.set(doc(db, "roster", uid), staff);
      return batch.commit();
    };
    const uid = "quick-invalid";
    const newUser = client(uid, true);
    const valid = quickEntryRecords(uid, "New Person", "plant");
    for (const [profile, staff] of [
      [{ role: "manager", active: true }, { ...valid.staff, role: "Operations Manager", shift: null }],
      [{ ...valid.profile, active: false }, valid.staff],
      [{ ...valid.profile, extra: true }, valid.staff],
      [valid.profile, { ...valid.staff, role: "Shift A Supervisor", shift: "Shift A" }],
      [valid.profile, { ...valid.staff, active: false }],
      [valid.profile, { ...valid.staff, name: " " }],
      [valid.profile, { ...valid.staff, id: "someone-else" }],
    ]) await denied(quickEntry(newUser, uid, profile, staff));
    assert.equal((await getDoc(doc(newUser, "users", uid))).exists(), false);
    await denied(setDoc(doc(newUser, "users", uid), valid.profile));
    await denied(setDoc(doc(newUser, "roster", uid), valid.staff));
    await denied(quickEntry(anonymous, uid, valid.profile, valid.staff));
    await denied(quickEntry(newUser, "someone-else", valid.profile, { ...valid.staff, id: "someone-else" }));
    await denied(quickEntry(client("email-supervisor"), "email-supervisor",
      quickEntryRecords("email-supervisor", "Email Person", "plant").profile,
      quickEntryRecords("email-supervisor", "Email Person", "plant").staff));
    for (const role of ["plant", "shiftA", "shiftB"]) {
      const quickUid = `quick-${role}`;
      const supervisor = client(quickUid, true);
      const records = quickEntryRecords(quickUid, `New ${role}`, role);
      await quickEntry(supervisor, quickUid, records.profile, records.staff);
      assert.deepEqual((await getDoc(doc(supervisor, "users", quickUid))).data(), records.profile);
      assert.deepEqual((await getDoc(doc(supervisor, "roster", quickUid))).data(), records.staff);
      await getDocs(collection(supervisor, "batches"));
      await denied(updateDoc(doc(supervisor, "users", quickUid), { role: "manager" }));
      await denied(updateDoc(doc(supervisor, "users", quickUid), { role: "plant" }));
      await denied(updateDoc(doc(supervisor, "roster", quickUid), { role: "Operations Manager", shift: null }));
      await denied(deleteDoc(doc(supervisor, "users", quickUid)));
      await denied(setDoc(doc(supervisor, "roster", `extra-${role}`), { ...records.staff, id: `extra-${role}` }));
    }
    const existing = { id: "existing-staff", name: "Existing Person", role: "Shift A Supervisor", shift: "Shift A", active: true };
    await setDoc(doc(manager, "roster", existing.id), existing);
    const reuse = client("quick-reuse", true);
    await setDoc(doc(reuse, "users", "quick-reuse"), quickEntryRecords("quick-reuse", "existing person", "shiftA", existing).profile);
    await denied(setDoc(doc(reuse, "users", "another-quick"), quickEntryRecords("another-quick", "Existing Person", "shiftA", existing).profile));
    await denied(setDoc(doc(reuse, "roster", "extra"), { ...existing, id: "extra" }));
  } finally {
    for (const { db, app } of clients) { await terminate(db); await deleteApp(app); }
  }
});
