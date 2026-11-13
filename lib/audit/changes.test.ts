import { describe, expect, it } from "vitest";
import { affectedLabel, allFields, changedFields, maskSensitive, showValue } from "./changes";

// C10: the audit trail's "what changed" list
describe("changedFields (C10)", () => {
  // like Pedro Reyes's loan going back from Defaulted to Active on Nov 6
  const before = { id: "L1", status: "defaulted", principal_balance: 0, defaulted_at: "2026-11-06T10:52:09+00:00", updated_at: "2026-11-06T10:52:09+00:00", maturity_date: "2026-10-15" };
  const after = { ...before, status: "active", defaulted_at: null, updated_at: "2026-11-06T11:39:30+00:00" };

  it("lists only the columns that changed, and skips updated_at", () => {
    const c = changedFields(before, after)!;
    expect(c.map((x) => x.key)).toEqual(["status", "defaulted_at"]);
    expect(c[0]).toMatchObject({ label: "Status", before: "Defaulted", after: "Active" });
    expect(c[1].after).toBe("(empty)");
  });

  it("returns null when there is no old row (entries saved before Nov 6, or Created)", () => {
    expect(changedFields(null, after)).toBeNull();
    expect(changedFields(undefined, after)).toBeNull();
  });

  it("returns an empty list when only updated_at changed", () => {
    expect(changedFields(before, { ...before, updated_at: "2026-11-07T00:00:00+00:00" })).toEqual([]);
  });

  it("shows a column that is only in one of the rows", () => {
    const c = changedFields({ a: 1 }, { a: 1, note: "TEST" })!;
    expect(c).toEqual([{ key: "note", label: "Note", before: "(empty)", after: "TEST" }]);
  });
});

describe("showValue (C10)", () => {
  it("money, yes/no, dates, statuses", () => {
    expect(showValue("principal_balance", 9960)).toBe("₱9,960.00");
    expect(showValue("interest_owed", "500")).toBe("₱500.00");
    expect(showValue("is_blacklisted", true)).toBe("Yes");
    expect(showValue("maturity_date", "2026-10-15")).toMatch(/Oct 15, 2026/);
    expect(showValue("status", "extended")).toBe("Renewed"); // the app's word for an extended loan
    expect(showValue("status", "forfeited")).toBe("Forfeited");
    expect(showValue("karat", 18)).toBe("18");
  });

  it("staff ids show as names; other ids are shortened", () => {
    const names = new Map([["4e174465-c7c2-4bc0-9b70-8285685493d0", "Test Admin"]]);
    expect(showValue("appraised_by", "4e174465-c7c2-4bc0-9b70-8285685493d0", names)).toBe("Test Admin");
    expect(showValue("customer_id", "3f6d13f3-6705-44bc-9a87-89aeeabb20d8", names)).toBe("ID …bb20d8");
  });

  it("long text is cut, and free text keeps its words", () => {
    expect(showValue("notes", "x".repeat(100))).toHaveLength(81);
    expect(showValue("blacklist_reason", "Used a fake ID")).toBe("Used a fake ID");
  });
});

// AT2: the rows for the View data popup
describe("allFields (AT2)", () => {
  it("lists every field, marks the changed ones and leaves out updated_at", () => {
    const rows = allFields({ status: "extended", interest_owed: 70, updated_at: "a" }, { status: "defaulted", interest_owed: 70, updated_at: "b" });
    expect(rows.map((r) => [r.label, r.before, r.after, r.changed])).toEqual([
      ["Interest owed", "₱70.00", "₱70.00", false], // A to Z (AT3)
      ["Status", "Renewed", "Defaulted", true],
    ]);
    expect(allFields(null, { aml_status: "clear", id_number: "X" }).map((r) => r.label)).toEqual(["AML status", "ID number"]); // AT3
  });
  it("a Created entry (no row before) has no Before and nothing marked", () => {
    const rows = allFields(null, { status: "active" });
    expect(rows).toEqual([{ key: "status", label: "Status", before: null, after: "Active", changed: false }]);
  });
  it("nothing saved: no rows", () => {
    expect(allFields(null, null)).toEqual([]);
  });
});

// AT3: masking and the "affected record" words
describe("audit trail: masking and affected record (AT3)", () => {
  it("shows only the last 4 of an ID number and leaves everything else as it was", () => {
    expect(maskSensitive({ id_number: "1234-5678-9012", full_name: "Juan" })).toEqual({ id_number: "•••• 9012", full_name: "Juan" });
    expect(maskSensitive({ id_number: null })).toEqual({ id_number: null });
    expect(maskSensitive(null)).toBeNull();
  });
  it("AT5: masks an ID number at any level, with the app's rule, and changes nothing else", () => {
    const entry = { admin_edit: true, reason: "Typo", before: { id_number: "0000-000418", full_name: "Juan" }, after: { id_number: "12" }, list: [{ id_number: 1234567 }, "plain"], e: { id_number: "" } };
    expect(maskSensitive(entry)).toEqual({ admin_edit: true, reason: "Typo", before: { id_number: "•••• 0418", full_name: "Juan" }, after: { id_number: "••••" }, list: [{ id_number: "•••• 4567" }, "plain"], e: { id_number: "" } });
    expect(entry.before.id_number).toBe("0000-000418"); // the original object is not changed
    expect(maskSensitive({ id_number: "•••• 0418" })).toEqual({ id_number: "•••• 0418" }); // already masked by the database: stays the same
  });
  it("names the customer, loan, item or payment", () => {
    expect(affectedLabel("customers", { full_name: "Juan Dela Cruz", customer_no: 12 })).toBe("Juan Dela Cruz · C-0012");
    expect(affectedLabel("loans", { ticket_number: "PT-1" })).toBe("PT-1");
    expect(affectedLabel("appraisal_items", { appraisal_no: 36 })).toBe("A-0036");
    expect(affectedLabel("loan_payments", { receipt_number: "RC-9" })).toBe("Receipt RC-9");
    expect(affectedLabel("reminder_log", { id: "x" })).toBe("");
  });
});
