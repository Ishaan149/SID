import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, terminate, doc, getDocFromServer, getDocsFromServer, collection, query, where, updateDoc } from "firebase/firestore";
import { createAuthService } from "../src/auth/firebaseAuth.js";
import { createFirebaseAdapter } from "../src/data/firebaseAdapter.js";
import { newId } from "../src/data/mutations.js";

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;

test("real SDK login/logout, unassigned account, and live role revocation against emulators", {
  skip: !authHost || !firestoreHost, timeout: 30000,
}, async () => {
  const projectId = "demo-aete";
  const app = initializeApp({ projectId, apiKey: "demo-key" }, "login-test");
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(app);
  const [hostname, port] = firestoreHost.split(":");
  connectFirestoreEmulator(db, hostname, Number(port));
  const service = createAuthService({ auth, db });
  let state;
  let wake = () => {};
  const stop = service.subscribe((next) => { state = next; wake(); });
  async function waitFor(status) {
    const deadline = Date.now() + 10000;
    while (state?.status !== status) {
      assert.ok(Date.now() < deadline, `Expected ${status}, got ${state?.status}`);
      await new Promise((resolve) => { const timeout = setTimeout(resolve, 100); wake = () => { clearTimeout(timeout); resolve(); }; });
    }
    return state;
  }
  async function profile(uid, active) {
    const response = await fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`, {
      method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { role: { stringValue: "manager" }, active: { booleanValue: active } } }),
    });
    assert.equal(response.ok, true, await response.text());
  }
  try {
    await waitFor("signed-out");
    const email = `phase2-${Date.now()}@example.test`;
    const password = "emulator-only-pass";
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;
    await waitFor("unassigned");
    await profile(uid, true);
    assert.equal((await waitFor("ready")).session.uid, uid);
    await service.logout();
    await waitFor("signed-out");
    assert.equal(auth.currentUser, null);
    await assert.rejects(service.login(email, "incorrect-password"));
    assert.equal(state.status, "signed-out");
    await service.login(` ${email} `, password);
    assert.equal((await waitFor("ready")).session.role, "manager");
    await profile(uid, false);
    await waitFor("unassigned");
    await service.logout();
    await waitFor("signed-out");
  } finally {
    stop();
    await terminate(db);
    await deleteApp(app);
  }
});

test("quick entry creates temporary identities, reuses names, attributes history, and respects roles", {
  skip: !authHost || !firestoreHost, timeout: 60000,
}, async () => {
  const app = initializeApp({ projectId: "demo-aete", apiKey: "demo-key" }, "quick-entry-test");
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(app);
  const [hostname, port] = firestoreHost.split(":");
  connectFirestoreEmulator(db, hostname, Number(port));
  const service = createAuthService({ auth, db });
  let state;
  const seenRoles = new Set();
  const stop = service.subscribe((next) => {
    state = next;
    if (next.status === "ready") seenRoles.add(next.session.role);
  });
  async function ready(uid, role) {
    const deadline = Date.now() + 10000;
    while (state?.status !== "ready" || state.session.uid !== uid) {
      if (Date.now() >= deadline) {
        const profile = await getDocFromServer(doc(db, "users", uid));
        assert.fail(`Expected ready ${role} ${uid}, got ${state?.status}, user ${state?.user?.uid}, missing ${state?.profileMissing}, stored ${JSON.stringify(profile.data())}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return state.session;
  }
  try {
    await assert.rejects(service.enterStaff("Pretend Manager", "manager"));
    assert.equal(auth.currentUser, null);
    let batch;
    const chosenNames = { plant: "Quick Plant", shiftA: "Quick A", shiftB: "Quick B" };
    const firstStaffIds = {};
    for (const role of ["plant", "shiftA", "shiftB"]) {
      await service.enterStaff(chosenNames[role], role);
      const uid = auth.currentUser.uid;
      assert.equal(auth.currentUser.isAnonymous, true);
      const session = await ready(uid, role);
      assert.equal(session.role, role);
      assert.equal(session.name, chosenNames[role]);
      firstStaffIds[role] = session.staffId;
      const staff = (await getDocFromServer(doc(db, "roster", session.staffId))).data();
      assert.equal(staff.name, chosenNames[role]);
      const adapter = createFirebaseAdapter({ client: { auth, db }, expectedUid: uid });
      if (role === "plant") {
        const input = { id: newId(), mutationId: newId(), jobNo: "QUICK-TEST", customer: "Synthetic quick entry test",
          parts: "Synthetic material", piecesIn: 10, weightIn: 25, staffId: session.staffId, notes: "" };
        await adapter.receiveBatch(input);
        batch = (await getDocFromServer(doc(db, "batches", input.id))).data();
      } else {
        await adapter.transitionBatch({ id: batch.id, mutationId: newId(), expectedVersion: batch.version,
          expectedStatus: batch.status, staffId: session.staffId, piecesOut: 10, weightOut: 25 });
        batch = (await getDocFromServer(doc(db, "batches", batch.id))).data();
      }
      assert.equal((await getDocFromServer(doc(db, "activity", batch.lastEventId))).data().who, chosenNames[role]);
      await assert.rejects(updateDoc(doc(db, "users", uid), { role: "manager" }), (error) => error.code === "permission-denied");
      await assert.rejects(adapter.archiveBatch({ id: batch.id, mutationId: newId(), expectedVersion: batch.version,
        expectedStatus: batch.status, reason: "Not allowed" }), (error) => error.code === "access-denied");
      await service.logout();
      assert.equal(auth.currentUser, null);
    }
    await service.enterStaff(" quick  plant ", "plant");
    const secondUid = auth.currentUser.uid;
    const secondSession = await ready(secondUid, "reused plant");
    assert.notEqual(secondUid, firstStaffIds.plant);
    assert.equal(secondSession.staffId, firstStaffIds.plant);
    assert.equal(secondSession.name, chosenNames.plant);
    const matching = await getDocsFromServer(query(collection(db, "roster"), where("name", "==", chosenNames.plant)));
    assert.equal(matching.size, 1);
    const adapter = createFirebaseAdapter({ client: { auth, db }, expectedUid: secondUid });
    await assert.rejects(adapter.transitionBatch({ id: batch.id, mutationId: newId(), expectedVersion: batch.version,
      expectedStatus: batch.status, staffId: firstStaffIds.shiftA }), (error) => error.code === "invalid-staff");
    await adapter.transitionBatch({ id: batch.id, mutationId: newId(), expectedVersion: batch.version,
      expectedStatus: batch.status, staffId: secondSession.staffId });
    batch = (await getDocFromServer(doc(db, "batches", batch.id))).data();
    assert.equal(batch.status, "Dispatched");
    const finalEvent = (await getDocFromServer(doc(db, "activity", batch.lastEventId))).data();
    assert.equal(finalEvent.who, chosenNames.plant);
    assert.equal(finalEvent.actorUid, secondUid);
    assert.equal(seenRoles.has("manager"), false);
  } finally {
    stop();
    await terminate(db);
    await deleteApp(app);
  }
});
