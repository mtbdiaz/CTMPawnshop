import { describe, it, expect } from "vitest";
import { verifyLostTicketId } from "./lost-ticket";

describe("verifyLostTicketId (PB-22)", () => {
  it("matches identical id numbers", () => {
    expect(verifyLostTicketId("P1234567", "P1234567")).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(verifyLostTicketId(" p1234567 ", "P1234567")).toBe(true);
  });

  it("rejects a mismatched id number", () => {
    expect(verifyLostTicketId("P0000000", "P1234567")).toBe(false);
  });
});
