import { trackerError } from "./mutations.js";

const operations = new Set(["receiveBatch", "transitionBatch", "archiveBatch", "addStaff", "setStaffActive", "removeStaff"]);
export function createPendingJournal(storage, projectId, uid) {
  const key = `aete_pending_v1:${projectId}:${uid}`;
  let memory = null;
  try {
    const raw = storage?.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.projectId === projectId && parsed.uid === uid && operations.has(parsed.kind)
        && parsed.input && typeof parsed.input === "object") memory = parsed;
    }
  } catch { /* The in-memory journal still protects retries within this page. */ }
  return {
    get current() { return memory; },
    remember(kind, input) {
      if (!operations.has(kind)) throw trackerError("invalid-input", "Unknown save operation.");
      const record = { projectId, uid, kind, input: JSON.parse(JSON.stringify(input)) };
      if (memory && JSON.stringify(memory) !== JSON.stringify(record)) {
        throw trackerError("pending-request", "A previous save still needs confirmation. Use Retry previous save before making another change.");
      }
      memory = record;
      try { storage?.setItem(key, JSON.stringify(record)); } catch { /* Keep in memory if browser storage is blocked. */ }
    },
    clear() {
      memory = null;
      try { storage?.removeItem(key); } catch { /* A replay of the stale stored request remains safe. */ }
    },
  };
}
