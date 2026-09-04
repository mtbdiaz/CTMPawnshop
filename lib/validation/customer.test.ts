import { describe, it, expect } from "vitest";
import { customerSchema } from "./customer";

describe("customerSchema (PB-7 AC2)", () => {
  const valid = {
    full_name: "Juan Dela Cruz",
    address: "123 Rizal St, Davao City",
    contact_number: "09171234567",
    email: "",
    date_of_birth: "",
    id_type: "Passport",
    id_number: "P1234567",
  };

  it("accepts valid input", () => {
    expect(customerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing full name", () => {
    expect(customerSchema.safeParse({ ...valid, full_name: "" }).success).toBe(false);
  });

  it("rejects a missing address", () => {
    expect(customerSchema.safeParse({ ...valid, address: "  " }).success).toBe(false);
  });

  it("rejects a missing ID type/number", () => {
    expect(customerSchema.safeParse({ ...valid, id_type: "" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...valid, id_number: "" }).success).toBe(false);
  });

  it("rejects an invalid email when provided", () => {
    expect(customerSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });
});
