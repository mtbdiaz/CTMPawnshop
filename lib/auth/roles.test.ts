import { describe, it, expect } from "vitest";
import { hasRole } from "./roles";

describe("hasRole (PB-3 RBAC)", () => {
  it("denies access when role is null/undefined", () => {
    expect(hasRole(null, ["admin"])).toBe(false);
    expect(hasRole(undefined, ["cashier"])).toBe(false);
  });

  it("allows a role explicitly listed", () => {
    expect(hasRole("cashier", ["cashier", "operator"])).toBe(true);
  });

  it("denies a role not listed", () => {
    expect(hasRole("appraiser", ["cashier", "operator"])).toBe(false);
  });

  it("admin always has access, even when not listed", () => {
    expect(hasRole("admin", ["cashier"])).toBe(true);
  });
});
