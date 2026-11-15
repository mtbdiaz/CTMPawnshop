import { describe, it, expect } from "vitest";
import { createAccountSchema, staffDetailsSchema } from "./account";

describe("createAccountSchema (PB-4)", () => {
  const valid = {
    full_name: "Jane Cashier",
    email: "jane@ctmpawnshop.test",
    role: "cashier",
    temp_password: "Ctm-abc12345!1",
  };

  it("accepts valid input", () => {
    expect(createAccountSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty full name", () => {
    expect(createAccountSchema.safeParse({ ...valid, full_name: "  " }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(createAccountSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(
      false,
    );
  });

  it("rejects a role outside the four staff roles", () => {
    expect(createAccountSchema.safeParse({ ...valid, role: "superadmin" }).success).toBe(false);
  });

  it("rejects a temp password shorter than 8 characters", () => {
    expect(createAccountSchema.safeParse({ ...valid, temp_password: "short" }).success).toBe(
      false,
    );
  });
});

describe("staffDetailsSchema (PB-4, U3)", () => {
  it("accepts a name and a role", () => {
    expect(staffDetailsSchema.safeParse({ full_name: "Jane Cashier", role: "appraiser" }).success).toBe(true);
  });

  it("rejects a missing role or a blank name", () => {
    expect(staffDetailsSchema.safeParse({ full_name: "Jane" }).success).toBe(false);
    expect(staffDetailsSchema.safeParse({ full_name: "  ", role: "cashier" }).success).toBe(false);
  });

  it("has no active/inactive field (that is a separate action now)", () => {
    const parsed = staffDetailsSchema.safeParse({ full_name: "Jane", role: "cashier", is_active: true });
    expect(parsed.success && "is_active" in parsed.data).toBe(false);
  });
});
