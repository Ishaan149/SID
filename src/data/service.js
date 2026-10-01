import { createFirebaseAdapter } from "./firebaseAdapter.js";
import { createLocalStorageAdapter } from "./localStorageAdapter.js";
export function createDataService({ adapter, fallback = createLocalStorageAdapter() } = {}) {
  let active = adapter;
  let fallbackUsed = false;
  let snapshot = null;
  let pending = Promise.resolve();

  const switchToLocal = async () => {
    if (snapshot) {
      // Preserve the Firestore data already on screen before replaying a failed write.
      await fallback.replace("batches", snapshot.batches);
      await fallback.replace("roster", snapshot.roster);
      await fallback.replace("activity", snapshot.activity);
      await fallback.updateSettings(snapshot.settings);
    }
    active = fallback;
    fallbackUsed = true;
  };
  const withFallback = async (operation) => {
    try {
      return await operation(active);
    } catch (error) {
      if (active?.kind !== "firebase" || !fallback) throw error;
      console.warn("Firebase unavailable; using localStorage fallback.", error);
      await switchToLocal();
      return operation(active);
    }
  };
  // A failed write must copy a complete, committed snapshot to localStorage.
  const write = (operation, updateSnapshot) => {
    const result = pending.then(async () => {
      const value = await withFallback(operation);
      if (snapshot) snapshot = updateSnapshot(snapshot);
      return value;
    });
    pending = result.catch(() => {});
    return result;
  };
  const add = (collection, value) => write(
    (a) => a.create(collection, value),
    (data) => ({ ...data, [collection]: [...data[collection], value] }),
  );
  const update = (collection, id, patch) => write(
    (a) => a.update(collection, id, patch),
    (data) => ({ ...data, [collection]: data[collection].map((item) => item.id === id ? { ...item, ...patch } : item) }),
  );
  const remove = (collection, id) => write(
    (a) => a.remove(collection, id),
    (data) => ({ ...data, [collection]: data[collection].filter((item) => item.id !== id) }),
  );
  return {
    async load() {
      await pending;
      snapshot = await withFallback((a) => a.load());
      return snapshot;
    },
    addBatch: (batch) => add("batches", batch),
    updateBatch: (id, patch) => update("batches", id, patch),
    deleteBatch: (id) => remove("batches", id),
    addActivity: (entry) => add("activity", entry),
    addStaff: (staff) => add("roster", staff),
    updateStaff: (id, patch) => update("roster", id, patch),
    deleteStaff: (id) => remove("roster", id),
    updateSettings: (patch) => write(
      (a) => a.updateSettings(patch),
      (data) => ({ ...data, settings: { ...data.settings, ...patch } }),
    ),
    seed: (data) => write(
      async (a) => {
        await a.replace("batches", data.batches);
        await a.replace("roster", data.roster);
        await a.replace("activity", data.activity);
        await a.updateSettings(data.settings);
        return data;
      },
      () => data,
    ),
    get status() { return { kind: active?.kind || "none", fallbackUsed }; },
  };
}

export function createConfiguredDataService() {
  const env = import.meta.env || {};
  const mode = env.VITE_DATA_ADAPTER || (env.DEV ? "firebase" : "local");
  return mode === "local"
    ? createDataService({ adapter: createLocalStorageAdapter() })
    : createDataService({ adapter: createFirebaseAdapter(), fallback: createLocalStorageAdapter() });
}
