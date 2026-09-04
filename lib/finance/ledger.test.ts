import { describe, it, expect } from "vitest";
import { computeCashPosition, computeRunningBalances } from "./ledger";

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
