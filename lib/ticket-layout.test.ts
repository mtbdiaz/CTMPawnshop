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
  // Nov 14, 2026 (Matt's review): corrections to the owner's printed wording, made in scripts/extract-ticket-layout.py
  it("spells Thumbmark on both signature lines", () => {
    const text = TICKET_WORDS.map((w) => w.t);
    expect(text.filter((t) => t === "Thumbmark)")).toHaveLength(2);
    expect(text).not.toContain("Thumbrark)");
  });
  it("has no stray %) after the interest blank, and the interest line stays evenly spaced", () => {
    expect(TICKET_WORDS.some((w) => w.t === "%)")).toBe(false);
    const blank = TICKET_WORDS.find((w) => w.t === "________%")!; // the interest blank with its % sign
    const line = TICKET_WORDS.filter((w) => Math.abs(w.y - blank.y) < 1).sort((a, b) => a.x - b.x);
    const after = line.filter((w) => w.x > blank.x); // P.M./P.A. has pledges to this Pawnee ...
    expect(after.map((w) => w.t).slice(0, 3)).toEqual(["P.M./P.A.", "has", "pledges"]);
    const gaps = after.map((w, i) => w.x - (i === 0 ? blank.x + blank.pw : after[i - 1].x + after[i - 1].pw));
    for (const g of gaps) {
      expect(g).toBeGreaterThan(3);
      expect(g).toBeLessThan(9); // no big hole where the stray word was
    }
    const last = after[after.length - 1];
    expect(last.t).toBe("article(s)");
    expect(last.x + last.pw).toBeCloseTo(578.4, 0); // the right edge of the justified line did not move
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
