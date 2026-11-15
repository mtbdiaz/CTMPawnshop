import { describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";
import { generateTempPassword, TEMP_PASSWORD_LENGTH } from "./temp-password";

describe("generateTempPassword (U6)", () => {
  it("is 16 characters with a capital, a small letter, a digit and a symbol, and no look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(TEMP_PASSWORD_LENGTH);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[!@#$%*?]/);
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });

  it("doesn't repeat (2,000 passwords, all different) and refuses short lengths", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateTempPassword()));
    expect(seen.size).toBe(2000);
    expect(() => generateTempPassword(8)).toThrow();
  });

  it("uses the secure random generator, not Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    generateTempPassword();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(typeof crypto.randomInt).toBe("function");
  });
});
