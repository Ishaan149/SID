import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, terminate } from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;

test("rules isolate profiles and deny all client role grants", { skip: !host }, async () => {
  const [hostname, port] = host.split(":");
  const projectId = "demo-aete";
  const clients = [];
  const client = (uid) => {
    const app = initializeApp({ projectId, apiKey: "demo-key" }, `rules-${uid || "anonymous"}`);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, hostname, Number(port), uid ? { mockUserToken: { sub: uid } } : {});
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
  } finally {
    for (const { db, app } of clients) { await terminate(db); await deleteApp(app); }
  }
});
