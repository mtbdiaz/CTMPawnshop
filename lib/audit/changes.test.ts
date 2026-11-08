import { describe, expect, it } from "vitest";
import { changedFields, showValue } from "./changes";

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
