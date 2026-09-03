import { describe, it, expect } from "vitest";
import { createAccountSchema, editAccountSchema } from "./account";

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

describe("editAccountSchema (PB-4)", () => {
  it("accepts valid input", () => {
    const result = editAccountSchema.safeParse({
      full_name: "Jane Cashier",
      role: "appraiser",
      is_active: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing role", () => {
    const result = editAccountSchema.safeParse({ full_name: "Jane", is_active: true });
    expect(result.success).toBe(false);
  });
});
