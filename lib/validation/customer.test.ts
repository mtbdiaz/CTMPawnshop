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

  // F2: +63 and 63 numbers are accepted and saved as 09...
  it("accepts +63 and 63 mobile numbers and saves them as 09", () => {
    for (const n of ["+639171234567", "639171234567", "+63 917 123 4567", "0917-123-4567"]) {
      const r = customerSchema.safeParse({ ...valid, contact_number: n });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.contact_number).toBe("09171234567");
    }
  });

  it("still rejects numbers that aren't Philippine mobiles", () => {
    for (const n of ["1234", "0817123456", "+6391712345", "+1 555 123 4567"]) {
      expect(customerSchema.safeParse({ ...valid, contact_number: n }).success).toBe(false);
    }
  });

  // F8: extra spaces inside a name become one; real names with punctuation are allowed
  it("cleans extra spaces in the name and allows real Filipino names", () => {
    const r = customerSchema.safeParse({ ...valid, full_name: "  Ma.  Teresa   Dela Cruz-Santos  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.full_name).toBe("Ma. Teresa Dela Cruz-Santos");
    expect(customerSchema.safeParse({ ...valid, full_name: "Niño O'Brien" }).success).toBe(true);
  });

  // F10: the ID number must fit the chosen ID type (dashes, spaces and capitals don't matter)
  it("accepts correctly formatted IDs for each strict type", () => {
    const ok: [string, string][] = [
      ["PhilSys National ID", "1234-5678-9012-3456"],
      ["UMID", "0111-2222333-4"],
      ["SSS ID", "34-1234567-8"],
      ["PRC ID", "0123456"],
      ["Passport", "P1234567A"],
      ["Passport", "eb1234567"],
      ["Driver's License", "N01-12-123456"],
      ["Postal ID", "PRN 1234 5678 9012"],
    ];
    for (const [id_type, id_number] of ok) expect(customerSchema.safeParse({ ...valid, id_type, id_number }).success).toBe(true);
  });

  it("rejects IDs in the wrong format for their type, with a message under ID number", () => {
    const bad: [string, string][] = [
      ["PhilSys National ID", "1234-5678"],
      ["UMID", "ABC-123"],
      ["SSS ID", "12345678901"],
      ["Passport", "1234567"],
      ["Driver's License", "0000-000418"],
      ["Voter's ID", "12"],
    ];
    for (const [id_type, id_number] of bad) {
      const r = customerSchema.safeParse({ ...valid, id_type, id_number });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].path).toEqual(["id_number"]);
    }
  });

  // F11: date of birth is optional, but not in the future or before 1900
  it("accepts an empty or real date of birth", () => {
    expect(customerSchema.safeParse({ ...valid, date_of_birth: "" }).success).toBe(true); // empty is fine
    expect(customerSchema.safeParse({ ...valid, date_of_birth: "1985-06-15" }).success).toBe(true); // a real birthday
  });

  it("rejects a date of birth in the future or before 1900", () => {
    for (const date_of_birth of ["2999-01-01", "1850-03-03"]) {
      const r = customerSchema.safeParse({ ...valid, date_of_birth }); // check one bad date
      expect(r.success).toBe(false); // it must fail
      if (!r.success) expect(r.error.issues[0].path).toEqual(["date_of_birth"]); // and the message goes under the date field
    }
  });
});
