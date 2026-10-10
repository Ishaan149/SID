import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStaffName, quickEntryRecords, quickEntryErrorMessage } from "../src/auth/quickEntry.js";

test("quick entry creates a staff profile and only adds a missing roster name", () => {
  for (const [role, shift] of [["plant", "Plant"], ["shiftA", "Shift A"], ["shiftB", "Shift B"]]) {
    const records = quickEntryRecords("temporary-user", "  New   Person  ", role);
    assert.deepEqual(records.profile, { role, active: true, entry: "quick", staffId: "temporary-user", name: "New Person" });
    assert.equal(records.staff.shift, shift);
    const reused = quickEntryRecords("another-user", "new person", role, records.staff);
    assert.equal(reused.profile.staffId, "temporary-user");
    assert.equal(reused.staff, null);
  }
  for (const role of ["manager", "admin", "toString", "__proto__", ""]) {
    assert.throws(() => quickEntryRecords("temporary-user", "New Person", role));
  }
  assert.throws(() => normalizeStaffName("   "));
  assert.throws(() => normalizeStaffName("x".repeat(121)));
  assert.match(quickEntryErrorMessage({ code: "auth/operation-not-allowed" }), /Anonymous sign-in/);
});
