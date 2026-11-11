import { describe, expect, it } from "vitest";
import { appraisedText, batchNo, batchStatus, eligibility, lineOutcome, parsePeso, reserveProblem, reserveState, saleProblems } from "./auction";

describe("auction batch number", () => {
  it("pads to 4 digits", () => {
    expect(batchNo(7)).toBe("AB-0007");
    expect(batchNo(12345)).toBe("AB-12345");
    expect(batchNo(null)).toBe("");
  });
});

describe("reserve price states", () => {
  it("tells Not set, No reserve and a price apart", () => {
    expect(reserveState(null, false)).toBe("not_set"); // items queued before 0052
    expect(reserveState(null, true)).toBe("no_reserve");
    expect(reserveState(5000, false)).toBe("price");
    expect(reserveState(0, false)).toBe("not_set"); // 0 is never a price
  });
  it("reads typed peso amounts", () => {
    expect(parsePeso("5,000")).toBe(5000);
    expect(parsePeso(" 5000.50 ")).toBe(5000.5);
    expect(parsePeso("-5")).toBeNull();
    expect(parsePeso("0")).toBeNull();
    expect(parsePeso("5000.555")).toBeNull();
    expect(parsePeso("abc")).toBeNull();
    expect(parsePeso("")).toBeNull();
    expect(parsePeso("10000001")).toBeNull();
  });
  it("needs a price or No reserve, never both, never neither", () => {
    expect(reserveProblem("", false)).toMatch(/Enter a reserve price/);
    expect(reserveProblem("5000", true)).toMatch(/Pick one/);
    expect(reserveProblem("-1", false)).toMatch(/pesos/);
    expect(reserveProblem("5000", false)).toBeNull();
    expect(reserveProblem("", true)).toBeNull();
  });
});

describe("auction eligibility", () => {
  const ok = { loan_status: "forfeited", audit_flag: null, in_open_batch: false } as const;
  it("allows a forfeited item that is not in a batch", () => {
    expect(eligibility(ok)).toMatchObject({ ok: true, label: "System checks passed", tone: "info" }); // HR1: not a green "Eligible"
  });
  it("blocks an item the audit could not find, a loan not forfeited, and an item already in a batch", () => {
    expect(eligibility({ ...ok, audit_flag: "not_located" }).ok).toBe(false);
    expect(eligibility({ ...ok, loan_status: "defaulted" }).ok).toBe(false);
    expect(eligibility({ ...ok, in_open_batch: true }).ok).toBe(false);
  });
  it("only warns for Found elsewhere", () => {
    expect(eligibility({ ...ok, audit_flag: "found_elsewhere" })).toMatchObject({ ok: true, tone: "warning" });
  });
});

describe("missing item details (FI1)", () => {
  const full = { loan_status: "forfeited", audit_flag: null, in_open_batch: false, appraisal_item_id: "x", category: "ring", karat: 18, weight_grams: 2, appraisal_no: 45, ticket_number: "PT-1" } as const;
  it("never shows a missing appraised value as ₱0.00", () => {
    expect(appraisedText(null)).toBe("not available");
    expect(appraisedText(0)).toBe("not available");
    expect(appraisedText(5779.39)).toBe("₱5,779.39");
  });
  it("blocks an item whose details or ticket did not load", () => {
    expect(eligibility(full).ok).toBe(true);
    expect(eligibility({ ...full, category: null })).toMatchObject({ ok: false, label: "Blocked: details missing" });
    expect(eligibility({ ...full, ticket_number: null }).ok).toBe(false);
    expect(eligibility({ ...full, appraisal_no: null }).ok).toBe(false);
  });
});

describe("batch lines", () => {
  it("names the outcome of a line", () => {
    expect(lineOutcome({ sold_at: "2026-11-12", unsold_at: null }).key).toBe("sold");
    expect(lineOutcome({ sold_at: null, unsold_at: "2026-11-12" }).key).toBe("unsold");
    expect(lineOutcome({ sold_at: null, unsold_at: null }).key).toBe("queued");
  });
  it("works out the batch status from its lines", () => {
    expect(batchStatus({ items: 3, sold: 0, unsold: 0 }).label).toBe("Open");
    expect(batchStatus({ items: 3, sold: 1, unsold: 0 }).label).toBe("In progress");
    expect(batchStatus({ items: 3, sold: 2, unsold: 1 }).label).toBe("Closed");
    expect(batchStatus({ items: 0, sold: 0, unsold: 0 }).label).toBe("Empty");
  });
});

describe("record sale form", () => {
  it("accepts a full, confirmed sale at or above the reserve", () => {
    expect(saleProblems("5000", "Juan Cruz", "", true, 5000)).toEqual({});
    expect(saleProblems("5,000.50", "Juan Cruz", "note", true, null)).toEqual({});
  });
  it("refuses a bad price, a price below the reserve, no buyer and no confirmation", () => {
    expect(saleProblems("abc", "Juan", "", true, null).sale_price).toBeTruthy();
    expect(saleProblems("4999.99", "Juan", "", true, 5000).sale_price).toMatch(/below/);
    expect(saleProblems("5000", " ", "", true, null).buyer_name).toBeTruthy();
    expect(saleProblems("5000", "Juan", "", false, null).confirm).toMatch(/both/); // payment AND handover
    expect(saleProblems("5000", "Juan", "x".repeat(501), true, null).sale_notes).toBeTruthy();
  });
});
