import { getApps, initializeApp } from "firebase/app";
import { browserSessionPersistence, connectAuthEmulator, initializeAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

let client;

export function readFirebaseConfig(env) {
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  const emulator = env.VITE_FIREBASE_USE_EMULATOR === "true";
  if (emulator && env.PROD) throw new Error("Production cannot use Firebase emulators.");
  if (emulator) {
    // A demo project prevents emulator development from reaching a real project.
    return { apiKey: "demo-api-key", authDomain: "demo-aete.local", projectId: "demo-aete", appId: "demo-aete-app" };
  }
  if (Object.values(config).some((value) => !value?.trim())) {
    throw new Error("Firebase configuration is missing. Copy .env.example to .env.local and restart the app.");
  }
  return config;
}

export function getFirebaseClient() {
  if (client) return client;
  const env = import.meta.env || {};
  const config = readFirebaseConfig(env);
  const app = getApps().find((item) => item.name === "aete-tracker") || initializeApp(config, "aete-tracker");
  const auth = initializeAuth(app, { persistence: browserSessionPersistence });
  const db = getFirestore(app);
  if (env.VITE_FIREBASE_USE_EMULATOR === "true") {
    connectAuthEmulator(auth, `http://127.0.0.1:${Number(env.VITE_AUTH_PORT || 9099)}`, { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", Number(env.VITE_FIRESTORE_PORT || 8080));
  }
  client = { app, auth, db };
  return client;
}
