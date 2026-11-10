import { describe, it, expect } from "vitest";
import { customerSchema, requiredDateOfBirthSchema, adultCutoff, isCalendarDate, joinName, MAX } from "./customer";

describe("customerSchema (PB-7 AC2)", () => {
  const valid = {
    first_name: "Juan", // NP: the name in parts
    middle_name: "",
    last_name: "Dela Cruz",
    suffix: "",
    address: "123 Rizal St, Davao City",
    contact_number: "09171234567",
    email: "",
    date_of_birth: "1985-06-15", // F15: a birthday is now required (18+)
    id_type: "Passport",
    id_number: "P1234567",
  };

  it("accepts valid input", () => {
    expect(customerSchema.safeParse(valid).success).toBe(true);
  });

  // NP: first and last name are required; middle name and suffix are optional
  it("rejects a missing first or last name, allows no middle name or suffix", () => {
    expect(customerSchema.safeParse({ ...valid, first_name: "  " }).success).toBe(false); // no first name
    expect(customerSchema.safeParse({ ...valid, last_name: "" }).success).toBe(false); // no last name
    expect(customerSchema.safeParse({ ...valid, middle_name: undefined, suffix: undefined }).success).toBe(true); // both left out: fine
  });

  it("only allows a suffix from the list", () => {
    expect(customerSchema.safeParse({ ...valid, suffix: "Jr." }).success).toBe(true); // in the list
    expect(customerSchema.safeParse({ ...valid, suffix: "Esq." }).success).toBe(false); // not in the list
  });

  // NP: the same rule as ctm_join_name in the database (migration 0042)
  it("joinName puts the parts together with the middle initial", () => {
    expect(joinName("Juan", "Bautista", "Dela Cruz", "Jr.")).toBe("Juan B. Dela Cruz Jr."); // all four
    expect(joinName(" Ma.  Teresa ", "", "Cruz", "")).toBe("Ma. Teresa Cruz"); // no middle, no suffix, spaces tidied
    expect(joinName("Pedro", "reyes", "Santos", null)).toBe("Pedro R. Santos"); // the initial is a capital
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
    const r = customerSchema.safeParse({ ...valid, first_name: "  Ma.  Teresa ", last_name: " Dela   Cruz-Santos  " });
    expect(r.success).toBe(true);
    if (r.success) expect([r.data.first_name, r.data.last_name]).toEqual(["Ma. Teresa", "Dela Cruz-Santos"]);
    expect(customerSchema.safeParse({ ...valid, first_name: "Niño", last_name: "O'Brien" }).success).toBe(true);
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

  // F15: on Register the birthday is required and the customer must be 18 or older
  it("requires a date of birth when registering", () => {
    const r = customerSchema.safeParse({ ...valid, date_of_birth: "" }); // left empty
    expect(r.success).toBe(false); // must fail
    if (!r.success) expect(r.error.issues[0].path).toEqual(["date_of_birth"]); // message under the date field
  });

  it("accepts exactly 18 today, blocks 17", () => {
    const eighteenToday = adultCutoff(); // turns 18 today
    const [y, m, d] = eighteenToday.split("-"); // split it to make "one day younger"
    const oneDayShort = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 1)).toISOString().slice(0, 10); // turns 18 tomorrow
    expect(customerSchema.safeParse({ ...valid, date_of_birth: eighteenToday }).success).toBe(true); // 18 today: OK
    const r = customerSchema.safeParse({ ...valid, date_of_birth: oneDayShort }); // still 17
    expect(r.success).toBe(false); // blocked
    if (!r.success) expect(r.error.issues[0].message).toContain("at least 18"); // with the 18+ message
  });

  it("adultCutoff is 18 years before today, same month and day", () => {
    expect(adultCutoff("2026-11-04")).toBe("2008-11-04"); // normal day
    expect(adultCutoff("2026-03-01")).toBe("2008-03-01"); // a Feb 29, 2008 baby turns 18 on Mar 1, 2026
  });

  // F16: the same birthday rule is used when editing: required, real, and 18+
  it("birthday rule: empty, a minor or a future date is not accepted", () => {
    expect(requiredDateOfBirthSchema.safeParse("").success).toBe(false); // required now (only email is optional)
    expect(requiredDateOfBirthSchema.safeParse("1985-06-15").success).toBe(true); // an adult
    expect(requiredDateOfBirthSchema.safeParse(adultCutoff().replace(/^\d{4}/, (yr) => String(Number(yr) + 1))).success).toBe(false); // 17 years old
    expect(requiredDateOfBirthSchema.safeParse("2999-01-01").success).toBe(false); // in the future
  });

  it("rejects a date of birth in the future or before 1900", () => {
    for (const date_of_birth of ["2999-01-01", "1850-03-03"]) {
      const r = customerSchema.safeParse({ ...valid, date_of_birth }); // check one bad date
      expect(r.success).toBe(false); // it must fail
      if (!r.success) expect(r.error.issues[0].path).toEqual(["date_of_birth"]); // and the message goes under the date field
    }
  });
  // F5 regression: dates that don't exist are refused, real leap days are fine
  it("F5: rejects impossible calendar dates, accepts real leap days", () => {
    expect(isCalendarDate("1990-02-30")).toBe(false); // Feb 30 doesn't exist
    expect(isCalendarDate("2003-02-29")).toBe(false); // 2003 isn't a leap year
    expect(isCalendarDate("1900-02-29")).toBe(false); // 1900 isn't a leap year (century rule)
    expect(isCalendarDate("2000-02-29")).toBe(true); // 2000 is (divisible by 400)
    expect(isCalendarDate("2004-02-29")).toBe(true); // normal leap year
    expect(isCalendarDate("1990-13-01")).toBe(false); // month 13
    expect(isCalendarDate("1990-04-31")).toBe(false); // April has 30 days
    expect(isCalendarDate("1990-1-5")).toBe(false); // wrong shape
    const r = customerSchema.safeParse({ ...valid, date_of_birth: "1990-02-30" }); // through the whole form rule
    expect(r.success).toBe(false); // refused
    if (!r.success) expect(r.error.issues[0].path).toEqual(["date_of_birth"]); // message under the date field
    expect(customerSchema.safeParse({ ...valid, date_of_birth: "2004-02-29" }).success).toBe(true); // a real leap-day birthday, over 18
  });

  // F4 regression: length limits stop junk but allow real long names and addresses
  it("F4: length limits", () => {
    // NP: each name part can be up to 55 characters
    expect(customerSchema.safeParse({ ...valid, first_name: "Ma. Teresa Josefina", last_name: "Dela Cruz-Santos y Villanueva-Macaraeg de los Reyes" }).success).toBe(true); // a long real-looking name
    expect(customerSchema.safeParse({ ...valid, last_name: "A".repeat(MAX.name_part) }).success).toBe(true); // exactly the limit: OK
    expect(customerSchema.safeParse({ ...valid, last_name: "A".repeat(MAX.name_part + 1) }).success).toBe(false); // one over: refused
    expect(customerSchema.safeParse({ ...valid, middle_name: "B".repeat(MAX.name_part + 1) }).success).toBe(false); // middle name too long
    expect(customerSchema.safeParse({ ...valid, address: "B".repeat(MAX.address + 1) }).success).toBe(false); // address too long
    expect(customerSchema.safeParse({ ...valid, email: "a".repeat(250) + "@x.ph" }).success).toBe(false); // email too long
    expect(customerSchema.safeParse({ ...valid, id_type: "Postal ID", id_number: "C".repeat(MAX.id_number + 1) }).success).toBe(false); // ID too long
  });
});