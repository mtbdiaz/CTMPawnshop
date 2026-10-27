import { describe, expect, it } from "vitest";
import { TICKET_FIELDS, TICKET_PAGE, TICKET_RECTS, TICKET_SLOTS, TICKET_WORDS } from "./ticket-layout";

// The layout is generated from the owner's PDF (scripts/extract-ticket-layout.py).
describe("pawn ticket layout", () => {
  it("is half-letter landscape (8.5 x 6.5 in)", () => {
    expect(TICKET_PAGE).toEqual({ w: 612, h: 468 });
  });
  it("has the six blanks to fill, in reading order", () => {
    expect(TICKET_SLOTS).toHaveLength(6);
    const ys = TICKET_SLOTS.map((s) => s.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
  it("leaves the three date placeholders to the system", () => {
    expect(TICKET_FIELDS).toHaveLength(3);
    expect(TICKET_WORDS.some((w) => /BOLD/.test(w.t))).toBe(false);
  });
  it("keeps the printed wording of the form", () => {
    const text = TICKET_WORDS.map((w) => w.t).join(" ");
    for (const phrase of ["CTM", "PAWNSHOP", "TIN:", "948-317-198-0000", "Pawnee", "(Description", "Service", "Proceeds", "ATP.\""]) {
      expect(text).toContain(phrase);
    }
  });
  it("draws the NO box, description box, 4-row table and two signature lines", () => {
    expect(TICKET_RECTS.filter((r) => r.h === 0)).toHaveLength(2);
    expect(TICKET_RECTS.filter((r) => r.h > 0)).toHaveLength(8);
  });
  it("keeps every word inside the page", () => {
    for (const w of TICKET_WORDS) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.x + w.pw).toBeLessThanOrEqual(TICKET_PAGE.w);
      expect(w.y + w.h).toBeLessThanOrEqual(TICKET_PAGE.h);
    }
  });
});
