import { initializeApp } from "firebase/app";
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore,
  serverTimestamp, setDoc, updateDoc,
} from "firebase/firestore";
import { COLLECTIONS, DEFAULT_SETTINGS } from "./models.js";

const env = import.meta.env || {};
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "demo-project.local",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "aete-hdg-local",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "demo-bucket",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: env.VITE_FIREBASE_APP_ID || "demo-app-id",
};

export function createFirebaseAdapter() {
  const app = initializeApp(firebaseConfig, "aete-tracker");
  const db = getFirestore(app);
  if (env.VITE_FIREBASE_USE_EMULATOR !== "false") {
    try { connectFirestoreEmulator(db, "127.0.0.1", Number(env.VITE_FIRESTORE_PORT || 8080)); } catch {}
  }

  const readCollection = async (name) => {
    const snapshot = await getDocs(collection(db, name));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  };
  return {
    kind: "firebase",
    async load() {
      const [batches, roster, activity, settingsDoc] = await Promise.all([
        readCollection(COLLECTIONS.batches), readCollection(COLLECTIONS.roster),
        readCollection(COLLECTIONS.activity), getDoc(doc(db, COLLECTIONS.settings, "app")),
      ]);
      return { batches, roster, activity, settings: settingsDoc.exists() ? settingsDoc.data() : { ...DEFAULT_SETTINGS } };
    },
    async create(collectionName, value) {
      await setDoc(doc(db, collectionName, value.id), { ...value, createdAt: serverTimestamp() });
      return value;
    },
    async update(collectionName, id, patch) {
      await updateDoc(doc(db, collectionName, id), patch);
      return { id, ...patch };
    },
    async remove(collectionName, id) {
      await deleteDoc(doc(db, collectionName, id));
    },
    async replace(collectionName, values) {
      const current = await readCollection(collectionName);
      const wanted = new Set(values.map((item) => item.id));
      await Promise.all(current.filter((item) => !wanted.has(item.id)).map((item) => deleteDoc(doc(db, collectionName, item.id))));
      await Promise.all(values.map((item) => setDoc(doc(db, collectionName, item.id), item)));
      return values;
    },
    async updateSettings(patch) {
      await setDoc(doc(db, COLLECTIONS.settings, "app"), patch, { merge: true });
      const snapshot = await getDoc(doc(db, COLLECTIONS.settings, "app"));
      return snapshot.data();
    },
  };
}
