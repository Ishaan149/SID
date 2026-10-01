import test from "node:test";
import assert from "node:assert/strict";
import { createLocalStorageAdapter } from "../src/data/localStorageAdapter.js";
import { createDataService } from "../src/data/service.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("local adapter persists tracker collections and settings", async () => {
  const adapter = createLocalStorageAdapter(memoryStorage());
  const batch = { id: "b1", jobNo: "JC-1", status: "Received" };
  await adapter.create("batches", batch);
  await adapter.update("batches", "b1", { status: "Processing" });
  await adapter.updateSettings({ pin: "9876" });
  const data = await adapter.load();
  assert.equal(data.batches[0].status, "Processing");
  assert.equal(data.settings.pin, "9876");
});

test("local adapter removes records", async () => {
  const adapter = createLocalStorageAdapter(memoryStorage());
  await adapter.create("roster", { id: "s1", name: "Test" });
  await adapter.remove("roster", "s1");
  assert.deepEqual((await adapter.load()).roster, []);
});

test("service falls back to localStorage after a Firebase read failure", async () => {
  const fallback = createLocalStorageAdapter(memoryStorage());
  await fallback.create("batches", { id: "fallback-1", jobNo: "JC-F", status: "Received" });
  const service = createDataService({
    adapter: { kind: "firebase", async load() { throw new Error("emulator offline"); } },
    fallback,
  });
  const data = await service.load();
  assert.equal(data.batches[0].jobNo, "JC-F");
  assert.equal(service.status.fallbackUsed, true);
  assert.equal(service.status.kind, "local");
});

test("a failed Firestore write preserves loaded data before local retry", async () => {
  const remote = createLocalStorageAdapter(memoryStorage());
  const local = createLocalStorageAdapter(memoryStorage());
  await remote.create("batches", { id: "b1", jobNo: "JC-1", status: "Received" });
  await remote.create("roster", { id: "s1", name: "Ali", active: true });
  await remote.updateSettings({ pin: "9876" });
  let failWrites = false;
  const service = createDataService({
    adapter: {
      kind: "firebase",
      load: () => remote.load(),
      create: (collection, value) => remote.create(collection, value),
      update: (collection, id, patch) => {
        if (failWrites) throw new Error("emulator stopped");
        return remote.update(collection, id, patch);
      },
    },
    fallback: local,
  });

  await service.load();
  await service.addBatch({ id: "b2", jobNo: "JC-2", status: "Received" });
  failWrites = true;
  await service.updateBatch("b1", { status: "Processing" });

  const data = await local.load();
  assert.equal(data.batches.length, 2);
  assert.equal(data.batches.find((batch) => batch.id === "b1").status, "Processing");
  assert.equal(data.batches.find((batch) => batch.id === "b2").jobNo, "JC-2");
  assert.equal(data.roster[0].name, "Ali");
  assert.equal(data.settings.pin, "9876");
  assert.equal(service.status.kind, "local");
});

test("a local fallback write failure is reported to the caller", async () => {
  const remote = createLocalStorageAdapter(memoryStorage());
  await remote.create("batches", { id: "b1", status: "Received" });
  const local = createLocalStorageAdapter({
    getItem: () => null,
    setItem: () => { throw new Error("storage full"); },
  });
  const service = createDataService({
    adapter: { kind: "firebase", load: () => remote.load(), update: () => { throw new Error("emulator stopped"); } },
    fallback: local,
  });
  await service.load();
  await assert.rejects(service.updateBatch("b1", { status: "Processing" }), /storage full/);
  assert.equal(service.status.kind, "firebase");
});
