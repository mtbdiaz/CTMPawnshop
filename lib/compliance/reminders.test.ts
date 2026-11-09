import { describe, it, expect } from "vitest";
import { isDueForReminder, REMINDER_LEAD_DAYS } from "./reminders";
import { addDays, cycleStart, dueLabel, dueRange, logsThisCycle, manilaDateOf, reminderWindowEnd } from "./reminders";

describe("isDueForReminder (PB-33)", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("is false for a maturity far in the future", () => {
    const maturity = new Date(now);
    maturity.setDate(maturity.getDate() + REMINDER_LEAD_DAYS + 5);
    expect(isDueForReminder(maturity, now)).toBe(false);
  });

  it("is true within the lead window", () => {
    const maturity = new Date(now);
    maturity.setDate(maturity.getDate() + 1);
    expect(isDueForReminder(maturity, now)).toBe(true);
  });

  it("is false for a maturity already in the past", () => {
    const maturity = new Date(now);
    maturity.setDate(maturity.getDate() - 1);
    expect(isDueForReminder(maturity, now)).toBe(false);
  });
});

describe("isDueForReminder uses calendar days", () => {
  it("keeps a loan due today on the list all day", () => {
    expect(isDueForReminder("2026-09-24", "2026-09-24")).toBe(true);
  });

  it("includes the last day of the lead window and excludes the day after", () => {
    expect(isDueForReminder("2026-09-27", "2026-09-24")).toBe(true);
    expect(isDueForReminder("2026-09-28", "2026-09-24")).toBe(false);
  });
});

// R1: the new Reminders page helpers

describe("Reminders dates (R1)", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(reminderWindowEnd("2026-12-30")).toBe("2027-01-02");
  });
  it("Due dropdown ranges are inclusive", () => {
    expect(dueRange("all", "2026-11-08")).toEqual(["2026-11-08", "2026-11-11"]);
    expect(dueRange("today", "2026-11-08")).toEqual(["2026-11-08", "2026-11-08"]);
    expect(dueRange("tomorrow", "2026-12-31")).toEqual(["2027-01-01", "2027-01-01"]);
    expect(dueRange("later", "2026-11-08")).toEqual(["2026-11-10", "2026-11-11"]);
  });
  it("due words", () => {
    expect(dueLabel(0)).toBe("Due today");
    expect(dueLabel(1)).toBe("Due tomorrow");
    expect(dueLabel(3)).toBe("Due in 3 days");
  });
  it("uses the Manila day of a saved time", () => {
    expect(manilaDateOf("2026-11-07T16:30:00Z")).toBe("2026-11-08"); // 12:30 AM Nov 8 in Manila
    expect(manilaDateOf("2026-11-07T15:59:00Z")).toBe("2026-11-07"); // 11:59 PM Nov 7 in Manila
  });
  it("a log from an earlier due date (before a renewal) doesn't count", () => {
    expect(cycleStart("2026-12-10")).toBe("2026-12-07");
    const logs = [
      { sent_at: "2026-11-08T02:00:00Z" }, // old due date Nov 10
      { sent_at: "2026-12-08T02:00:00Z" }, // this due date
      { sent_at: "2026-12-09T05:00:00Z" }, // this due date, newer
    ];
    expect(logsThisCycle(logs, "2026-12-10").map((l) => l.sent_at)).toEqual(["2026-12-09T05:00:00Z", "2026-12-08T02:00:00Z"]);
    expect(logsThisCycle(logs.slice(0, 1), "2026-12-10")).toEqual([]);
  });
});
