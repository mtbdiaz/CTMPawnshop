import { describe, expect, it } from "vitest";
import { addDays, addMonths, clampIso, daysInMonth, isDisabledDay, longDate, monthGrid, parseIso, toIso } from "./calendar";

describe("parseIso", () => {
  it("reads a real day, rejects an empty or impossible one", () => {
    expect(parseIso("2026-11-15")).toEqual({ year: 2026, month: 11, day: 15 });
    expect(parseIso("")).toBeNull();
    expect(parseIso("2026-02-30")).toBeNull();
    expect(parseIso("2026-13-01")).toBeNull();
    expect(parseIso("15/11/2026")).toBeNull();
  });
});

describe("daysInMonth", () => {
  it("handles leap years", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("addDays / addMonths", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-15", -7)).toBe("2026-11-08");
  });
  it("keeps the day, or pulls it back to the end of a shorter month", () => {
    expect(addMonths("2026-11-15", 1)).toBe("2026-12-15");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-11-15", 12)).toBe("2027-11-15");
  });
});

describe("range", () => {
  it("clamps to min and max, ignoring an empty limit", () => {
    expect(clampIso("2026-11-20", undefined, "2026-11-15")).toBe("2026-11-15");
    expect(clampIso("2026-11-01", "2026-11-10", undefined)).toBe("2026-11-10");
    expect(clampIso("2026-11-12", "", "")).toBe("2026-11-12");
  });
  it("marks days outside the range as disabled", () => {
    expect(isDisabledDay("2026-11-16", undefined, "2026-11-15")).toBe(true);
    expect(isDisabledDay("2026-11-15", undefined, "2026-11-15")).toBe(false);
    expect(isDisabledDay("2026-11-09", "2026-11-10", undefined)).toBe(true);
  });
});

describe("monthGrid", () => {
  it("November 2026 starts on a Sunday: 5 rows, the 1st in the first cell", () => {
    const g = monthGrid(2026, 11);
    expect(g.length).toBe(5);
    expect(g.every((r) => r.length === 7)).toBe(true);
    expect(g[0][0]).toEqual({ iso: "2026-11-01", day: 1, inMonth: true });
    expect(g[4][1]).toEqual({ iso: "2026-11-30", day: 30, inMonth: true });
    expect(g[4][2]).toEqual({ iso: "2026-12-01", day: 1, inMonth: false });
  });
  it("a month that starts late in the week gets 6 rows and shows the days before it", () => {
    const g = monthGrid(2026, 8); // August 1, 2026 is a Saturday
    expect(g.length).toBe(6);
    expect(g[0][6]).toEqual({ iso: "2026-08-01", day: 1, inMonth: true });
    expect(g[0][0]).toEqual({ iso: "2026-07-26", day: 26, inMonth: false });
  });
  it("every day of the month appears exactly once", () => {
    const days = monthGrid(2028, 2).flat().filter((c) => c.inMonth);
    expect(days.length).toBe(29);
    expect(new Set(days.map((d) => d.iso)).size).toBe(29);
  });
});

describe("text", () => {
  it("toIso pads and longDate names the weekday", () => {
    expect(toIso(2026, 3, 5)).toBe("2026-03-05");
    expect(longDate("2026-11-15")).toBe("Sunday, November 15, 2026");
  });
});
