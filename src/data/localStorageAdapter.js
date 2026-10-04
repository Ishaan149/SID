// Legacy tracker storage is read-only. Shared saves never use these keys.
export const LOCAL_STORAGE_KEYS = Object.freeze({
  batches: "hdg_batches_v4", roster: "hdg_roster_v4",
  activity: "hdg_activity_v4", settings: "hdg_settings_v4",
});
export function inspectLegacyStorage(storage) {
  const records = {};
  const counts = {};
  try {
    for (const [name, key] of Object.entries(LOCAL_STORAGE_KEYS)) {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      records[key] = raw;
      try { const value = JSON.parse(raw); counts[name] = Array.isArray(value) ? value.length : null; }
      catch { counts[name] = null; }
    }
    return { available: true, present: Object.keys(records).length > 0, records, counts };
  } catch {
    return { available: false, present: false, records, counts };
  }
}
export function legacyBackup(legacy, now = new Date()) {
  if (!legacy.available) throw new Error("Browser storage could not be read. Enable browser storage to export these records.");
  // Preserve exact raw strings, including malformed JSON and historical settings.
  return JSON.stringify({ format: "aete-browser-backup-v1", exportedAt: now.toISOString(), records: legacy.records }, null, 2);
}
