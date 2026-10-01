export const COLLECTIONS = Object.freeze({
  batches: "batches",
  roster: "roster",
  activity: "activity",
  settings: "settings",
});

export const DEFAULT_SETTINGS = Object.freeze({ pin: "1234" });

export function emptyTrackerData() {
  return { batches: [], roster: [], activity: [], settings: { ...DEFAULT_SETTINGS } };
}
