import { describe, it, expect } from "vitest";
import { formatPeso, formatDate, humanize, manilaToday, manilaDayStart } from "./format";

describe("formatPeso", () => {
  it("always shows two decimals", () => {
    expect(formatPeso(529.6)).toBe("₱529.60");
    expect(formatPeso(12412.58)).toBe("₱12,412.58");
  });

  it("treats null and non-numeric values as zero", () => {
    expect(formatPeso(null)).toBe("₱0.00");
    expect(formatPeso("abc")).toBe("₱0.00");
  });

  it("accepts numeric strings from Postgres numeric columns", () => {
    expect(formatPeso("1000.5")).toBe("₱1,000.50");
  });
});

describe("formatDate", () => {
  it("does not shift date-only values across timezones", () => {
    expect(formatDate("2026-10-15")).toContain("15");
    expect(formatDate("2026-10-15")).toContain("Oct");
  });

  it("renders a dash for empty values", () => {
    expect(formatDate(null)).toBe("—");
  });
});

describe("humanize", () => {
  it("turns enum values into readable labels", () => {
    expect(humanize("queued_for_auction")).toBe("Queued for auction");
    expect(humanize("payment_received")).toBe("Payment received");
  });
});

describe("Manila business-day helpers", () => {
  it("rolls over at Manila midnight, not UTC midnight", () => {
    // 2026-09-24 17:30 UTC is already 01:30 on the 25th in Manila.
    expect(manilaToday(new Date("2026-09-24T17:30:00Z"))).toBe("2026-09-25");
    // 2026-09-24 15:30 UTC is still 23:30 on the 24th in Manila.
    expect(manilaToday(new Date("2026-09-24T15:30:00Z"))).toBe("2026-09-24");
  });

  it("anchors day ranges to +08:00", () => {
    expect(manilaDayStart("2026-09-24")).toBe("2026-09-24T00:00:00+08:00");
  });
});
