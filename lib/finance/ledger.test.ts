import { describe, it, expect } from "vitest";
import { computeCashPosition, computeRunningBalances, entryTypeLabel, hasFilters, ledgerFilters, movementOf, shortDescription } from "./ledger";

describe("computeCashPosition (PB-28)", () => {
  it("nets in vs out", () => {
    const result = computeCashPosition([
      { amount: 1000, direction: "in" },
      { amount: 300, direction: "out" },
      { amount: 200, direction: "in" },
    ]);
    expect(result.totalIn).toBe(1200);
    expect(result.totalOut).toBe(300);
    expect(result.net).toBe(900);
  });

  it("handles no entries", () => {
    expect(computeCashPosition([])).toEqual({ totalIn: 0, totalOut: 0, net: 0 });
  });
});

describe("computeRunningBalances (PB-30)", () => {
  it("accumulates a running balance in order", () => {
    const balances = computeRunningBalances([
      { amount: 1000, direction: "in" },
      { amount: 300, direction: "out" },
      { amount: 200, direction: "in" },
    ]);
    expect(balances).toEqual([1000, 700, 900]);
  });

  it("reconciles the final balance with computeCashPosition's net", () => {
    const entries: { amount: number; direction: "in" | "out" }[] = [
      { amount: 500, direction: "in" },
      { amount: 150, direction: "out" },
    ];
    const balances = computeRunningBalances(entries);
    const position = computeCashPosition(entries);
    expect(balances[balances.length - 1]).toBe(position.net);
  });
});

describe("non-cash memo entries", () => {
  it("never move the cash position or running balance", () => {
    const entries = [
      { amount: 1000, direction: "out" as const },
      { amount: 400, direction: "in" as const, is_memo: true },
      { amount: 200, direction: "in" as const },
    ];
    expect(computeCashPosition(entries).net).toBe(-800);
    expect(computeRunningBalances(entries)).toEqual([-1000, -1000, -800]);
  });
});

describe("Cash & ledger page helpers (CL1)", () => {
  it("names the movement; a memo is never cash", () => {
    expect(movementOf({ direction: "in", is_memo: false })).toBe("in");
    expect(movementOf({ direction: "out", is_memo: false })).toBe("out");
    expect(movementOf({ direction: "in", is_memo: true })).toBe("noncash");
  });
  it("shortens system descriptions and keeps typed ones", () => {
    expect(shortDescription({ entry_type: "payment_received", description: "Payment RC-20261111015343-EABC for PT-20261111015311-5989" })).toBe("Payment");
    expect(shortDescription({ entry_type: "payment_received", description: "Renewal interest RC-20261111003722-5C59 for PT-20260905082048-38E0" })).toBe("Renewal interest");
    expect(shortDescription({ entry_type: "revenue", description: "Auction sale of forfeited item for PT-20260704132219-38FC" })).toBe("Auction sale of forfeited item");
    expect(shortDescription({ entry_type: "adjustment", description: "Void of ticket PT-20260721111733-22D4: disbursement reversed" })).toBe("Void: disbursement reversed");
    expect(shortDescription({ entry_type: "expense", description: "Shop rent for October 2026" })).toBe("Shop rent for October 2026");
    expect(shortDescription({ entry_type: "loan_disbursement", description: "Loan disbursed" })).toBe("Loan disbursed");
    expect(shortDescription({ entry_type: "expense", description: null })).toBe("Expense");
  });
  it("names the types", () => {
    expect(entryTypeLabel("loan_disbursement")).toBe("Loan disbursement");
    expect(entryTypeLabel("something_new")).toBe("something new");
  });
  it("cleans the filters from the address", () => {
    expect(ledgerFilters({})).toEqual({ q: "", type: "", flow: "", source: "", from: "", to: "", check: false });
    expect(ledgerFilters({ type: "drop table", flow: "sideways", source: "x", from: "yesterday", to: "2026-13-99x" })).toMatchObject({ type: "", flow: "", source: "", from: "", to: "" });
    expect(ledgerFilters({ q: "  rent ", type: "expense", flow: "out", source: "manual", from: "2026-10-01", to: "2026-10-31", check: "1" })).toEqual({
      q: "rent", type: "expense", flow: "out", source: "manual", from: "2026-10-01", to: "2026-10-31", check: true,
    });
    expect(ledgerFilters({ from: "2026-10-31", to: "2026-10-01" }).to).toBe("2026-10-31"); // typed backwards
    expect(hasFilters(ledgerFilters({}))).toBe(false);
    expect(hasFilters(ledgerFilters({ flow: "noncash" }))).toBe(true);
  });
});
