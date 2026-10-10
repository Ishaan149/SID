import { requireId, requireText, roleShift } from "../data/mutations.js";

export const STAFF_ROLES = Object.freeze({ plant: "Plant", shiftA: "Shift A", shiftB: "Shift B" });
export const STAFF_TITLES = Object.freeze({
  plant: "Plant Supervisor", shiftA: "Shift A Supervisor", shiftB: "Shift B Supervisor",
});

export function normalizeStaffName(name) {
  return requireText(name, "Your name", 120).replace(/\s+/g, " ");
}

export function quickEntryRecords(uid, name, role, existingStaff = null) {
  if (!Object.hasOwn(STAFF_ROLES, role)) throw new Error("Choose Plant, Shift A, or Shift B.");
  const chosenName = normalizeStaffName(name);
  const shift = roleShift(role);
  if (existingStaff && (existingStaff.active !== true || existingStaff.shift !== shift ||
      normalizeStaffName(existingStaff.name).toLocaleLowerCase() !== chosenName.toLocaleLowerCase())) {
    throw new Error("The roster name is unavailable for this role.");
  }
  const staffId = existingStaff ? requireId(existingStaff.id) : requireId(uid);
  const staff = existingStaff || { id: staffId, name: chosenName, role: STAFF_TITLES[role], shift, active: true };
  return { profile: { role, active: true, entry: "quick", staffId, name: staff.name }, staff: existingStaff ? null : staff };
}

export function quickEntryErrorMessage(error) {
  if (error?.code === "auth/network-request-failed" || error?.code === "unavailable")
    return "Unable to connect to Firebase. Check your connection and try again.";
  if (error?.code === "permission-denied")
    return "Quick entry was denied. Check that anonymous sign-in and the current Firestore rules are enabled.";
  if (error?.code === "auth/operation-not-allowed")
    return "Anonymous sign-in is disabled in Firebase Authentication.";
  return error?.message || "Quick entry could not finish. Please try again.";
}
