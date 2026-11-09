import { describe, expect, it } from "vitest";
import { CUSTODY, daysHeld, historySummary, parseInventorySearch, stillInShop } from "./custody";

describe("custody (V1)", () => {
  it("forfeited and queued items are still in the shop; released is not", () => {
    expect(stillInShop("forfeited")).toBe(true);
    expect(stillInShop("queued_for_auction")).toBe(true);
    expect(stillInShop("extended")).toBe(true);
    expect(stillInShop("redeemed")).toBe(false);
    expect(CUSTODY.extended.label).toBe("In vault");
    expect(CUSTODY.redeemed.label).toBe("Released");
  });
});

describe("daysHeld (V1)", () => {
  it("counts Manila calendar days, not 24-hour blocks", () => {
    // came in at 11:30 PM Manila on Nov 7 (15:30 UTC); on Nov 8 that's 1 day, even though only 30+ minutes passed
    expect(daysHeld("2026-11-07T15:30:00Z", "2026-11-08")).toBe(1);
    // came in at 12:30 AM Manila on Nov 8 (16:30 UTC on Nov 7): same day = 0
    expect(daysHeld("2026-11-07T16:30:00Z", "2026-11-08")).toBe(0);
  });
  it("a released item stops counting on its release day", () => {
    expect(daysHeld("2026-09-01T02:00:00Z", "2026-11-09", "2026-09-21T03:00:00Z")).toBe(20);
  });
  it("works across month and year ends", () => {
    expect(daysHeld("2026-12-30T02:00:00Z", "2027-01-02")).toBe(3);
  });
});

describe("historySummary (V1)", () => {
  const rows = [
    { new_status: "pawned", changed_at: "2026-09-01T02:00:00Z" },
    { new_status: "redeemed", changed_at: "2026-10-05T03:00:00Z" },
    { new_status: "extended", changed_at: "2026-10-01T03:00:00Z" },
  ];
  it("when it got its current status, and the release time", () => {
    const h = historySummary(rows, "redeemed");
    expect(h.since?.changed_at).toBe("2026-10-05T03:00:00Z");
    expect(h.releasedAt).toBe("2026-10-05T03:00:00Z");
    expect(historySummary(rows, "extended").since?.changed_at).toBe("2026-10-01T03:00:00Z");
  });
  it("no history entry for the current status (old demo data): nothing shown", () => {
    expect(historySummary([{ new_status: "forfeited", changed_at: "2026-09-05T02:00:00Z" }], "queued_for_auction").since).toBeNull();
    expect(historySummary([], "pawned")).toEqual({ since: null, releasedAt: null });
  });
});

describe("parseInventorySearch (V1)", () => {
  it("item words become filters, the rest is text", () => {
    expect(parseInventorySearch("chain 18k")).toEqual({ category: "chain", karat: 18, text: "" });
    expect(parseInventorySearch("Rings 24K Reyes")).toEqual({ category: "ring", karat: 24, text: "Reyes" });
    expect(parseInventorySearch("PT-20260915")).toEqual({ category: null, karat: null, text: "PT-20260915" });
    expect(parseInventorySearch("Safe 1")).toEqual({ category: null, karat: null, text: "Safe 1" });
  });
  it("a karat the shop doesn't use is just text", () => {
    expect(parseInventorySearch("14k")).toEqual({ category: null, karat: null, text: "14k" });
  });
  it("earring and others", () => {
    expect(parseInventorySearch("earring").category).toBe("earrings");
    expect(parseInventorySearch("others").category).toBeNull();
  });
});
