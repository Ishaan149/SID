import { onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, query, where, writeBatch, setDoc } from "firebase/firestore";
import { getFirebaseClient } from "../data/firebaseClient.js";
import { observeSession } from "./session.js";
import { normalizeStaffName, quickEntryRecords, STAFF_ROLES } from "./quickEntry.js";

export function createAuthService(client = getFirebaseClient()) {
  const { auth, db } = client;
  async function enterStaff(name, role) {
    // Validate before creating the temporary Firebase identity.
    const chosenName = normalizeStaffName(name);
    if (!Object.hasOwn(STAFF_ROLES, role)) throw new Error("Choose Plant, Shift A, or Shift B.");
    if (!auth.currentUser) await signInAnonymously(auth);
    if (!auth.currentUser?.isAnonymous) throw new Error("Sign out of the current account before entering as staff.");
    const uid = auth.currentUser.uid;
    const profileRef = doc(db, "users", uid);
    const previous = await getDocFromServer(profileRef);
    if (previous.exists()) {
      const profile = previous.data();
      if (profile.active === true && profile.entry === "quick" && profile.role === role &&
          normalizeStaffName(profile.name).toLocaleLowerCase() === chosenName.toLocaleLowerCase()) return;
      throw new Error("This temporary session already belongs to another entry. Leave and switch user to continue.");
    }
    const snapshot = await getDocsFromServer(query(collection(db, "roster"), where("shift", "==", STAFF_ROLES[role])));
    const match = snapshot.docs.map((item) => item.data()).find((staff) =>
      staff.active === true && normalizeStaffName(staff.name).toLocaleLowerCase() === chosenName.toLocaleLowerCase());
    const { profile, staff } = quickEntryRecords(uid, chosenName, role, match);
    if (staff) {
      const batch = writeBatch(db);
      batch.set(profileRef, profile);
      batch.set(doc(db, "roster", uid), staff);
      await batch.commit();
    } else {
      await setDoc(profileRef, profile);
    }
    // A server read confirms setup and refreshes an observer that first saw
    // the missing profile while the anonymous identity was being created.
    const confirmed = await getDocFromServer(profileRef);
    if (!confirmed.exists()) throw new Error("Quick entry was not confirmed. Please try again.");
  }
  return {
    login: (email, password) => signInWithEmailAndPassword(auth, email.trim(), password),
    enterStaff,
    logout: () => signOut(auth),
    subscribe: (notify) => observeSession({
      observeAuth: (next, error) => onAuthStateChanged(auth, next, error),
      observeProfile: (uid, next, error) => onSnapshot(doc(db, "users", uid),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (snapshot.metadata.hasPendingWrites) return;
          next(snapshot.exists() ? snapshot.data() : null, snapshot.metadata.fromCache);
        }, error),
    }, notify),
  };
}
