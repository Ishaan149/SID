import { DEFAULT_SETTINGS } from "./models.js";

export const LOCAL_STORAGE_KEYS = Object.freeze({
  batches: "hdg_batches_v4",
  roster: "hdg_roster_v4",
  activity: "hdg_activity_v4",
  settings: "hdg_settings_v4",
});

export function createLocalStorageAdapter(storage = window.localStorage) {
  const read = (key, fallback) => {
    try {
      const value = storage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error("Local tracker save failed", error);
      throw error;
    }
  };

  return {
    kind: "local",
    async load() {
      return {
        batches: read(LOCAL_STORAGE_KEYS.batches, []),
        roster: read(LOCAL_STORAGE_KEYS.roster, []),
        activity: read(LOCAL_STORAGE_KEYS.activity, []),
        settings: read(LOCAL_STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS }),
      };
    },
    async create(collection, value) {
      const data = await this.load();
      const next = [...(data[collection] || []), value];
      write(LOCAL_STORAGE_KEYS[collection], next);
      return value;
    },
    async update(collection, id, patch) {
      const data = await this.load();
      const next = (data[collection] || []).map((item) => item.id === id ? { ...item, ...patch } : item);
      write(LOCAL_STORAGE_KEYS[collection], next);
      return next.find((item) => item.id === id) || null;
    },
    async remove(collection, id) {
      const data = await this.load();
      write(LOCAL_STORAGE_KEYS[collection], (data[collection] || []).filter((item) => item.id !== id));
    },
    async replace(collection, values) {
      write(LOCAL_STORAGE_KEYS[collection], values);
      return values;
    },
    async updateSettings(patch) {
      const data = await this.load();
      const settings = { ...data.settings, ...patch };
      write(LOCAL_STORAGE_KEYS.settings, settings);
      return settings;
    },
  };
}
