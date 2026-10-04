import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseClient } from "../data/firebaseClient.js";
import { observeSession } from "./session.js";

export function createAuthService(client = getFirebaseClient()) {
  const { auth, db } = client;
  return {
    login: (email, password) => signInWithEmailAndPassword(auth, email.trim(), password),
    logout: () => signOut(auth),
    subscribe: (notify) => observeSession({
      observeAuth: (next, error) => onAuthStateChanged(auth, next, error),
      observeProfile: (uid, next, error) => onSnapshot(doc(db, "users", uid),
        { includeMetadataChanges: true },
        (snapshot) => next(snapshot.exists() ? snapshot.data() : null, snapshot.metadata.fromCache), error),
    }, notify),
  };
}
