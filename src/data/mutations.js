export const STAGES = Object.freeze(["Received", "Processing", "Ready", "Dispatched"]);
export const STAFF_SHIFTS = Object.freeze({
  "Plant Supervisor": "Plant", "Shift A Supervisor": "Shift A",
  "Shift B Supervisor": "Shift B", "Operations Manager": null,
});
export const newId = () => globalThis.crypto.randomUUID();
export const roleShift = (role) => ({ plant: "Plant", shiftA: "Shift A", shiftB: "Shift B" })[role] || null;

export function trackerError(code, message, uncertain = false) {
  return Object.assign(new Error(message), { code, uncertain });
}
export function requireText(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw trackerError("invalid-input", `${label} is required and must be at most ${max} characters.`);
  }
  return value.trim();
}
export function requireQuantity(value, label, integer = false) {
  if (value === "" || value == null || typeof value === "boolean" || !["number", "string"].includes(typeof value)
    || (typeof value === "string" && !value.trim())) throw trackerError("invalid-input", `${label} is required.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > (integer ? 1e9 : 1e12) || (integer && !Number.isInteger(number))) {
    throw trackerError("invalid-input", `${label} must be a nonnegative ${integer ? "whole number" : "finite number"} within the allowed range.`);
  }
  return number;
}
export function requireId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw trackerError("invalid-input", "Invalid record ID.");
  return id;
}
export function requireRole(profile, roles) {
  if (profile?.active !== true || !roles.includes(profile.role)) {
    throw trackerError("access-denied", "Your account does not have permission for this action.");
  }
  return profile.role;
}
export function requireStaff(staff, shift) {
  if (staff?.active !== true || staff.shift !== shift) throw trackerError("invalid-staff", "This staff member is inactive or belongs to another shift. Select an active staff member.");
  requireId(staff.id);
  requireText(staff.name, "Staff name", 120);
}
export function requireRevision(batch, input) {
  if (!batch || batch.archived || batch.version !== input.expectedVersion || batch.status !== input.expectedStatus) {
    throw trackerError("conflict", "This batch changed or was archived by someone else. Close this form and review the latest batch before acting.");
  }
}
export function activityFor(batch, beforeStatus, uid) {
  const prefix = { Received: "received", Processing: "process", Ready: "ready", Dispatched: "dispatch" }[batch.status];
  return {
    id: batch.lastEventId, batchId: batch.id, version: batch.version, at: batch.updatedAt,
    action: batch.archived ? "Archived" : { Received: "Received", Processing: "Into process", Ready: "Ready", Dispatched: "Dispatched" }[batch.status],
    actorUid: uid, staffId: batch.archived ? null : batch[`${prefix}StaffId`],
    who: batch.archived ? "Manager" : batch[`${prefix}By`], shift: batch.archived ? null : batch[`${prefix}Shift`],
    jobNo: batch.jobNo, beforeStatus, afterStatus: batch.status, snapshot: batch,
  };
}
export function dateOf(value) {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function saveFailure(error) {
  if (["conflict", "invalid-input", "invalid-staff", "access-denied", "signed-out", "pending-request", "busy", "already-saved", "offline"].includes(error?.code)) return error;
  if (error?.code === "permission-denied") return trackerError("access-denied", "Firebase denied this change. Your access or the staff/batch details may have changed. Review the latest data and try again.");
  return trackerError("save-unconfirmed", "The save could not be confirmed. Reconnect and use Retry previous save; it checks the original request before writing again.", true);
}
