import { describe, expect, it } from "vitest";
import { ACTION_WORD, detailsLabel, eventReason, eventSummary, eventTitle, recordRef, refIds, type AuditEvent, type RefLookups } from "./events";
import { pageWindow } from "@/lib/reports/report-utils";

// AT7 (Nov 13): the Audit Trail's plain-language WHAT / WHICH / WHY.
const LOAN = "11111111-1111-4111-8111-111111111111";
const CUST = "22222222-2222-4222-8222-222222222222";
const APPR = "33333333-3333-4333-8333-333333333333";
const ITEM = "44444444-4444-4444-8444-444444444444";
const BATCH = "55555555-5555-4555-8555-555555555555";

const lk: RefLookups = {
  loans: new Map([[LOAN, { ticket_number: "PT-20261006102326-829B", customer_id: CUST }]]),
  customers: new Map([[CUST, { customer_no: 339, full_name: "Juan Dela Cruz" }]]),
  appraisals: new Map([[APPR, { appraisal_no: 36 }]]),
  items: new Map([[ITEM, { appraisal_item_id: APPR }]]),
  batches: new Map([[BATCH, { batch_no: 7 }]]),
};
const ev = (e: Partial<AuditEvent>): AuditEvent => ({ table_name: "loans", record_id: LOAN, action: "UPDATE", changed_data: null, old_data: null, ...e });

describe("event titles and summaries", () => {
  it("names a loan status change in the app's own words", () => {
    const e = ev({ old_data: { status: "active", principal_balance: 26950 }, changed_data: { status: "defaulted", principal_balance: 26950 } });
    expect(eventTitle(e)).toBe("Loan status updated");
    expect(eventSummary(e)).toBe("Active → Defaulted");
    expect(detailsLabel(e)).toBe("View changes");
    const renewed = ev({ old_data: { status: "active" }, changed_data: { status: "extended" } });
    expect(eventSummary(renewed)).toBe("Active → Renewed"); // "extended" is called Renewed everywhere
  });
  it("puts the most important change first and counts the rest", () => {
    const e = ev({ old_data: { interest_owed: 10, status: "active", late_payment_count: 0 }, changed_data: { interest_owed: 0, status: "redeemed", late_payment_count: 1 } });
    expect(eventSummary(e)).toBe("Active → Redeemed (+2 more)");
  });
  it("says when an older entry has no row before the change", () => {
    const e = ev({ changed_data: { status: "defaulted" } });
    expect(eventSummary(e)).toBe("Older entry: only the new values were saved");
    expect(detailsLabel(e)).toBe("View details");
  });
  it("describes new records by their key facts", () => {
    expect(eventTitle(ev({ table_name: "loan_payments", action: "INSERT", changed_data: { amount: 500, loan_id: LOAN } }))).toBe("Payment recorded");
    expect(eventSummary(ev({ table_name: "loan_payments", action: "INSERT", changed_data: { amount: 500 } }))).toBe("₱500.00 payment");
    expect(eventSummary(ev({ table_name: "inventory_status_history", action: "INSERT", changed_data: { old_status: "pawned", new_status: "forfeited" } }))).toBe("In vault → Forfeited");
    expect(eventSummary(ev({ table_name: "cash_flow_entries", action: "INSERT", changed_data: { entry_type: "loan_disbursement", amount: 2000, direction: "out" } }))).toBe(
      "Loan disbursement · ₱2,000.00 out",
    );
    expect(eventSummary(ev({ table_name: "loan_extensions", action: "INSERT", changed_data: { previous_maturity_date: "2026-11-05", new_maturity_date: "2026-12-05" } }))).toBe(
      "Due date Nov 5, 2026 → Dec 5, 2026",
    );
    expect(detailsLabel(ev({ table_name: "loan_payments", action: "INSERT", changed_data: { amount: 1 } }))).toBe("View details");
  });
  it("explains an ID view and keeps its reason", () => {
    const e = ev({ table_name: "customers", record_id: CUST, action: "VIEW", changed_data: { field: "id_number", reason: "ID revealed on screen" } });
    expect(eventTitle(e)).toBe("Customer ID number viewed");
    expect(eventSummary(e)).toBe("The full ID number was shown on screen");
    expect(eventReason(e)).toBe("ID revealed on screen");
  });
  it("shows an Admin correction with its reason and its before/after", () => {
    const e = ev({ table_name: "customers", record_id: CUST, changed_data: { admin_edit: true, reason: "Typo in the number", before: { contact_number: "0917" }, after: { contact_number: "0918" } } });
    expect(eventTitle(e)).toBe("Customer corrected by an Admin");
    expect(eventSummary(e)).toBe("Contact number: 0917 → 0918");
    expect(eventReason(e)).toBe("Typo in the number");
    expect(detailsLabel(e)).toBe("View changes");
  });
  it("uses the same four action words everywhere", () => {
    expect(Object.values(ACTION_WORD)).toEqual(["Created", "Updated", "Deleted", "Viewed"]);
  });
});

describe("record references", () => {
  it("shows PT-, C-, A-, RC- and AB- references, looked up when the entry only has an ID", () => {
    expect(recordRef(ev({ changed_data: { ticket_number: "PT-1", customer_id: CUST } }), lk)).toEqual({ main: "PT-1", sub: "C-0339 · Juan Dela Cruz" });
    expect(recordRef(ev({ table_name: "loan_payments", record_id: "x", action: "INSERT", changed_data: { receipt_number: "RC-9", loan_id: LOAN } }), lk)).toEqual({
      main: "RC-9",
      sub: "PT-20261006102326-829B",
    });
    // an ID view stores only the field and the reason: the customer is found by the record ID
    expect(recordRef(ev({ table_name: "customers", record_id: CUST, action: "VIEW", changed_data: { field: "id_number" } }), lk)).toEqual({ main: "C-0339", sub: "Juan Dela Cruz" });
    expect(recordRef(ev({ table_name: "inventory_status_history", record_id: "x", action: "INSERT", changed_data: { inventory_item_id: ITEM } }), lk).main).toBe("A-0036");
    expect(recordRef(ev({ table_name: "auction_batches", record_id: BATCH, changed_data: { notes: "" } }), lk).main).toBe("AB-0007");
    expect(recordRef(ev({ table_name: "cash_flow_entries", record_id: "x", action: "INSERT", changed_data: { related_loan_id: null } }), lk)).toEqual({ main: "", sub: "Not linked to a loan" });
  });
  it("collects only real record IDs to look up", () => {
    const ids = refIds([
      ev({ changed_data: { customer_id: CUST, appraisal_item_id: APPR } }),
      ev({ table_name: "loan_payments", record_id: "p", changed_data: { loan_id: LOAN, receipt_number: "RC-1" } }),
      ev({ table_name: "inventory_items", record_id: ITEM, changed_data: { appraisal_item_id: "not-an-id" } }),
    ]);
    expect(ids.loans).toEqual([LOAN]);
    expect(ids.customers).toEqual([CUST]);
    expect(ids.appraisals).toEqual([APPR]);
    expect(ids.items).toEqual([ITEM]);
  });
});

describe("pageWindow (AT8)", () => {
  it("shows the first, the last and two on each side, with gaps", () => {
    expect(pageWindow(6, 1139)).toEqual([1, "gap", 4, 5, 6, 7, 8, "gap", 1139]);
    expect(pageWindow(1, 1139)).toEqual([1, 2, 3, "gap", 1139]);
    expect(pageWindow(1139, 1139)).toEqual([1, "gap", 1137, 1138, 1139]);
  });
  it("shows a single skipped page instead of a gap, and handles small and odd counts", () => {
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(99, 3)).toEqual([1, 2, 3]);
  });
});
