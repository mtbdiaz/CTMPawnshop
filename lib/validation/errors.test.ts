import { describe, it, expect } from "vitest";
import { customerSchema } from "./customer";
import { validationFailure } from "./errors";

describe("validationFailure", () => {
  it("maps every invalid field to its own message", () => {
    const parsed = customerSchema.safeParse({
      full_name: "",
      address: "",
      contact_number: "0917",
      id_type: "UMID",
      id_number: "123",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const result = validationFailure(parsed.error);
    expect(result.fieldErrors.full_name).toBe("Full name is required");
    expect(result.fieldErrors.address).toBe("Address is required");
    expect(result.error).toBe("Please fix the highlighted fields.");
  });

  it("uses the single field's message when only one field is invalid", () => {
    const parsed = customerSchema.safeParse({
      full_name: "Juan",
      address: "Davao",
      contact_number: "",
      id_type: "UMID",
      id_number: "123",
    });
    if (parsed.success) throw new Error("expected failure");
    expect(validationFailure(parsed.error).error).toBe("Contact number is required");
  });
});
