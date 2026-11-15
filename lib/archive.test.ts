import { describe, expect, it } from "vitest";
import { ARCHIVABLE_TABLES, ARCHIVE_LABELS, ARCHIVE_POLICY, friendlyArchiveError, restoreReasonError } from "./archive";

describe("archive tables", () => {
  it("covers every record type staff can create, each with a label", () => {
    for (const t of ["customers", "appraisal_items", "loans", "loan_payments", "cash_flow_entries", "inventory_items"]) {
      expect(ARCHIVABLE_TABLES).toContain(t);
    }
    for (const t of ARCHIVABLE_TABLES) expect(ARCHIVE_LABELS[t]).toBeTruthy();
  });
});

describe("ARCHIVE_POLICY (0085, Wush's decisions)", () => {
  it("has a rule for every type", () => {
    for (const t of ARCHIVABLE_TABLES) expect(ARCHIVE_POLICY[t]).toBeTruthy();
  });
  it("payments, renewals and reminders are never archived or restored; cash, batches and audits are never restored", () => {
    for (const t of ["loan_payments", "loan_extensions", "reminder_log"] as const) expect(ARCHIVE_POLICY[t]).toEqual({ archive: "never", restore: "never" });
    for (const t of ["cash_flow_entries", "auction_batches", "physical_inventory_audits"] as const) expect(ARCHIVE_POLICY[t].restore).toBe("never");
  });
  it("only customers, appraisals and loans can be archived from their page", () => {
    expect(ARCHIVABLE_TABLES.filter((t) => ARCHIVE_POLICY[t].archive === "allowed").sort()).toEqual(["appraisal_items", "customers", "loans"]);
  });
});

describe("restoreReasonError", () => {
  it("needs 10+ characters with a letter (same as the database)", () => {
    expect(restoreReasonError("short")).toMatch(/at least 10/);
    expect(restoreReasonError("          ")).toMatch(/at least 10/);
    expect(restoreReasonError("1234567890")).toMatch(/at least 10/);
    expect(restoreReasonError("  Archived   by mistake  ")).toBeNull();
  });
});

describe("friendlyArchiveError", () => {
  it("shows the database's own plain messages", () => {
    expect(friendlyArchiveError({ code: "P0001", message: "This loan was cancelled (VOID)." })).toBe("This loan was cancelled (VOID).");
    expect(friendlyArchiveError({ code: "42501", message: "Your role (cashier) is not allowed to do this." })).toMatch(/cashier/);
  });
  it("never shows a raw database error", () => {
    expect(friendlyArchiveError({ code: "23505", message: 'duplicate key value violates unique constraint "customers_unique_id"' })).not.toMatch(/constraint/);
    expect(friendlyArchiveError({ code: "42P01", message: 'relation "x" does not exist' })).toMatch(/nothing was changed/);
    expect(friendlyArchiveError(null)).toMatch(/nothing was changed/);
  });
});
