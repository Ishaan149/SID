import { createFirebaseAdapter } from "./firebaseAdapter.js";
import { getFirebaseClient } from "./firebaseClient.js";
import { createPendingJournal } from "./pendingRequests.js";
import { newId, trackerError } from "./mutations.js";

export function createDataService({ adapter, journal, getSession = () => ({ permissionsVerified: true }) }) {
  let data = null;
  let connection = { connected: false, error: null };
  let busy = false;
  const subscribers = new Set();
  const emit = () => { for (const notify of subscribers) notify(data, { ...connection, busy, pendingRequest: journal.current }); };
  const mutate = async (kind, input) => {
    if (busy) throw trackerError("busy", "A save is already in progress.");
    if (!connection.connected || getSession()?.permissionsVerified !== true) {
      throw trackerError("offline", "Shared data is not connected. Reconnect before saving; no browser-only changes will be made.");
    }
    journal.remember(kind, input);
    busy = true;
    emit();
    try {
      const result = await adapter[kind](input);
      journal.clear();
      return result;
    } catch (error) {
      if (!error.uncertain) journal.clear();
      throw error;
    } finally {
      busy = false;
      emit();
    }
  };
  const service = {
    subscribe(notify) {
      subscribers.add(notify);
      const stop = adapter.subscribe((next, status) => {
        data = next;
        connection = status;
        emit();
      }, (error) => {
        connection = { connected: false, error };
        emit();
      });
      notify(data, { ...connection, busy, pendingRequest: journal.current });
      return () => { subscribers.delete(notify); stop(); };
    },
    subscribeHistory: (...args) => adapter.subscribeHistory(...args),
    receiveBatch: (input) => mutate("receiveBatch", input),
    transitionBatch: (input) => mutate("transitionBatch", input),
    archiveBatch: (input) => mutate("archiveBatch", input),
    addStaff: (input) => mutate("addStaff", input),
    setStaffActive: (input) => mutate("setStaffActive", input),
    removeStaff: (input) => mutate("removeStaff", input),
    retryPending: () => {
      const request = journal.current;
      return request ? mutate(request.kind, request.input) : Promise.resolve(null);
    },
    newRequest: () => ({ id: newId(), mutationId: newId() }),
    get status() { return { kind: "firebase", ...connection, busy, pendingRequest: journal.current }; },
  };
  return service;
}
export function createConfiguredDataService({ uid, getSession }) {
  const client = getFirebaseClient();
  let storage;
  try { storage = window.sessionStorage; } catch { /* Optional journal persistence. */ }
  return createDataService({
    adapter: createFirebaseAdapter({ client, expectedUid: uid }), getSession,
    journal: createPendingJournal(storage, client.app.options.projectId, uid),
  });
}
