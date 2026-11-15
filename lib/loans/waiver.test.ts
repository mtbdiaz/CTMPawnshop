import { describe, expect, it } from "vitest";
import { isWaiverReason, WAIVER_REASONS, waiverPreview, waiverReasonLabel } from "./waiver";

describe("penalty waiver reasons", () => {
  it("offers the four reasons from the request, and nothing else is accepted", () => {
    expect(WAIVER_REASONS.map((r) => r.value)).toEqual(["shop_closed", "business_closure", "system_downtime", "other"]);
    expect(isWaiverReason("shop_closed")).toBe(true);
    expect(isWaiverReason("customer_asked")).toBe(false);
    expect(isWaiverReason("")).toBe(false);
    expect(isWaiverReason(undefined)).toBe(false);
  });
  it("turns a code into words, and shows an unknown code as it is", () => {
    expect(waiverReasonLabel("shop_closed")).toBe("Pawnshop closed on the customer's due date");
    expect(waiverReasonLabel("something_new")).toBe("something_new");
  });
});

describe("waiverPreview", () => {
  it("waives the whole penalty when no amount is given", () => {
    expect(waiverPreview(200, 10_700, null)).toEqual({ error: null, waive: 200, penaltyAfter: 0, owedAfter: 10_500 });
  });
  it("waives part of it and leaves the rest payable", () => {
    expect(waiverPreview(200, 10_700, 50.5)).toEqual({ error: null, waive: 50.5, penaltyAfter: 149.5, owedAfter: 10_649.5 });
  });
  it("refuses 0, a negative amount, and more than the penalty", () => {
    for (const a of [0, -5, 200.01, Number.NaN]) {
      const r = waiverPreview(200, 10_700, a);
      expect(r.error).not.toBeNull();
      expect(r.waive).toBe(0);
      expect(r.owedAfter).toBe(10_700); // nothing changes
    }
  });
  it("refuses when there is no penalty", () => {
    expect(waiverPreview(0, 10_500, null).error).toBe("No penalty is owed on this loan.");
  });
  it("keeps centavos exact", () => {
    expect(waiverPreview(0.3, 0.3, 0.1).penaltyAfter).toBe(0.2);
  });
});
