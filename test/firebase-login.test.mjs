import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, terminate } from "firebase/firestore";
import { createAuthService } from "../src/auth/firebaseAuth.js";

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
