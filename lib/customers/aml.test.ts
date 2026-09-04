import { describe, it, expect } from "vitest";
import { runAmlCheck } from "./aml";

describe("runAmlCheck (PB-8)", () => {
  it("clears a normal customer", () => {
    expect(runAmlCheck("Juan Dela Cruz", "ID-12345").status).toBe("clear");
  });

  it("flags a watchlist match in the name", () => {
    expect(runAmlCheck("Test-Flag Person", "ID-1").status).toBe("flagged");
  });

  it("flags a watchlist match in the id number", () => {
    expect(runAmlCheck("Someone", "SANCTIONED-999").status).toBe("flagged");
  });

  it("is case-insensitive", () => {
    expect(runAmlCheck("DOE-BLACKLIST Person", "x").status).toBe("flagged");
  });
});
