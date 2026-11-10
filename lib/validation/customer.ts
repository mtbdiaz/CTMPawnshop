// zod is the library that checks form input and creates error messages
import { z } from "zod";
import { manilaToday } from "@/lib/format"; // F11: today's date in Manila, to block birthdays in the future

// Philippine mobile number rule.
// "export" lets other files import and reuse this same rule.
export const phPhoneSchema = z
  .string() // the value must be text
  .trim() // remove spaces at the start and end
  // Remove spaces and dashes inside the number, so
  // "0917 123 4567" and "0917-123-4567" both become "09171234567".
  // This cleaned version is what gets saved to the database.
  .transform((value) => value.replace(/[\s-]/g, ""))
  // F2: also accept +63 and 63 numbers, saved the same way as 09 numbers:
  // "+639171234567" or "639171234567" -> "09171234567"
  .transform((value) => (/^\+?63\d{10}$/.test(value) ? `0${value.replace(/^\+?63/, "")}` : value))
  // .pipe() runs a second set of checks on the cleaned value
  .pipe(
    z
      .string()
      // empty field: show the "required" message
      .min(1, "Contact number is required")
      // Pattern the number must match:
      //   ^      start of the text
      //   09     must begin with 09
      //   \d{9}  then exactly 9 digits
      //   $      end of the text, nothing extra allowed
      .regex(/^09\d{9}$/, "Enter a valid Philippine mobile number, e.g. 0917 123 4567 or +63 917 123 4567"),
  );

// F10: ID number format rules, one per ID type.
// Dashes, spaces and capitals don't matter: the number is checked after removing them,
// and it is saved exactly as typed. "strict" = the format is fixed, so a wrong one is blocked.
// "loose" types vary by year or LGU, so they only need 4 to 30 letters/numbers.
// TODO: confirm these formats with CTM Pawnshop before the final demo.
export const ID_RULES: Record<string, { pattern: RegExp; example: string; strict: boolean }> = {
  "PhilSys National ID": { pattern: /^\d{16}$/, example: "16 digits, e.g. 1234-5678-9012-3456", strict: true },
  UMID: { pattern: /^\d{12}$/, example: "12-digit CRN, e.g. 0111-2222333-4", strict: true },
  "SSS ID": { pattern: /^\d{10}$/, example: "10 digits, e.g. 34-1234567-8", strict: true },
  "PRC ID": { pattern: /^\d{7}$/, example: "7-digit registration number, e.g. 0123456", strict: true },
  // new passports: P1234567A; older ones: EB1234567 or P1234567
  Passport: { pattern: /^[A-Z]{1,2}\d{7}[A-Z]?$/, example: "e.g. P1234567A or EB1234567", strict: true },
  // letter + 10 digits: N01-12-123456
  "Driver's License": { pattern: /^[A-Z]\d{10}$/, example: "1 letter + 10 digits, e.g. N01-12-123456", strict: true },
  "Postal ID": { pattern: /^[A-Z0-9]{4,30}$/, example: "as printed on the card", strict: false },
  "Voter's ID": { pattern: /^[A-Z0-9]{4,30}$/, example: "as printed on the card", strict: false },
  "Senior Citizen ID": { pattern: /^[A-Z0-9]{4,30}$/, example: "as printed on the card", strict: false },
};

// F10: checks one ID number against its type. Returns an error message, or null when it's fine.
// An ID type that isn't in the list (old records) only needs to be filled in.
export function idNumberError(idType: string, idNumber: string): string | null {
  const rule = ID_RULES[idType]; // the rule for this ID type (undefined if it isn't in the list)
  if (!rule) return null; // unknown/old type: no format rule
  const clean = idNumber.replace(/[\s-]/g, "").toUpperCase(); // ignore dashes, spaces and capitals
  if (rule.pattern.test(clean)) return null; // format is right
  return rule.strict // wrong format: strict types show the expected format, loose types ask for the number on the card
    ? `This doesn't look like a ${idType} number. Expected ${rule.example}.`
    : `Enter the ${idType} number as printed on the card (4 to 30 letters or numbers).`;
}

// F15: customers must be 18 or older. 18 is the age of majority in the Philippines (RA 6809), and a minor
// can't fully consent to a contract like a pawn loan (Civil Code). Big pawnshops (e.g. Cebuana) also require 18+.
export const MIN_AGE = 18;

// F15: the latest birthday that is still 18 today, e.g. today 2026-11-04 -> "2008-11-04".
// Born on or before this date = 18 or older. Uses Manila's date, like the rest of the app.
export function adultCutoff(today: string = manilaToday()): string {
  const [y, m, d] = today.split("-"); // "2026-11-04" -> "2026", "11", "04"
  return `${Number(y) - MIN_AGE}-${m}-${d}`; // same month and day, 18 years earlier
}

// the two date checks used below. The date box sends "YYYY-MM-DD", so the dates can be compared as text.
// F5: the date must really exist on the calendar ("1990-02-30" or "2023-02-29" are refused; "2024-02-29" is fine,
// 2024 is a leap year). We build the date and check that the year, month and day come back the same.
export function isCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); // must look exactly like YYYY-MM-DD
  if (!m) return false; // wrong shape, e.g. "hello" or "1990/01/01"
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]; // the three numbers
  const date = new Date(Date.UTC(y, mo - 1, d)); // JavaScript rolls Feb 30 over to Mar 2
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d; // same numbers back = real date
}
const realDate = (v: string) => isCalendarDate(v) && v >= "1900-01-01" && v <= manilaToday(); // F5 + F11: a real date, not in the future, not before 1900
const isAdult = (v: string) => v <= adultCutoff(); // F15: born on or before the 18-years-ago date
const realDateMessage = "Enter a real date of birth (not in the future or before 1900)"; // F5: also covers dates that don't exist

// F4: length limits, long enough for real Filipino names and addresses, short enough to stop junk.
// The same numbers are used as maxLength on the form boxes.
export const MAX = { full_name: 120, name_part: 55, address: 300, email: 254, id_number: 30 } as const; // NP: 55 per name part (migration 0042)

// NP (Nov 11, Matt/Wush): every customer form asks for the name in parts. First and Last are required, Middle and
// Suffix are optional. The database (migration 0042) builds full_name from the parts with the same rule as joinName,
// so lists, search, receipts and reports keep showing one name.
export const SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV", "V"] as const; // the only suffixes allowed (same list as the database)
const tidy = (v: string) => v.trim().replace(/\s+/g, " "); // F8: no spaces at the ends, one space inside

// NC1 (Nov 11): a name part typed all in small letters gets capitals ("bautista" -> "Bautista",
// "dela cruz" -> "Dela Cruz", "de los reyes" -> "De los Reyes", "santos y reyes" -> "Santos y Reyes").
// Small joining words stay small unless they come first. Anything typed with a capital is kept exactly as typed,
// because real names like "dela Cruz" or "McArthur" are spelled in many ways.
const SMALL_WORDS = new Set(["de", "del", "la", "las", "los", "y", "da", "van", "von"]);
export function tidyNamePart(v: string): string {
  const t = tidy(v);
  if (t !== t.toLowerCase()) return t; // has a capital somewhere: keep it
  return t
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/^\p{L}/u, (c) => c.toUpperCase()))) // first letter big
    .join(" ")
    .replace(/-(\p{L})/gu, (_m, c: string) => `-${c.toUpperCase()}`); // "cruz-santos" -> "Cruz-Santos"
}

// "Juan" + "Bautista" + "Dela Cruz" + "Jr." -> "Juan B. Dela Cruz Jr." (the middle name as its initial).
// Same as ctm_join_name in the database, so the screen shows exactly what will be saved.
export function joinName(first: string, middle: string | null | undefined, last: string, suffix: string | null | undefined): string {
  const m = tidy(middle ?? ""); // the middle name, tidied
  return [tidyNamePart(first), m ? `${m.charAt(0).toUpperCase()}.` : "", tidyNamePart(last), tidy(suffix ?? "")] // the four pieces (NC1: capitals)
    .filter(Boolean) // drop the empty ones
    .join(" "); // one space between them
}

// one name box: required or optional, tidied, at most 55 characters
const namePart = (label: string, required: boolean) => {
  const base = z.string().trim().max(MAX.name_part, `${label} can be at most ${MAX.name_part} characters`).transform(tidyNamePart); // F4: length limit, F8: tidy, NC1: capitals
  return required ? z.string().trim().min(1, `${label} is required`).pipe(base) : base.optional().default(""); // required = can't be empty; optional = left out is the same as empty
};
// the four name boxes, shared by Register and the Admin identity correction
export const nameFields = {
  first_name: namePart("First name", true),
  middle_name: namePart("Middle name", false),
  last_name: namePart("Last name", true),
  // empty = no suffix; anything else must be one from the list
  suffix: z.union([z.literal(""), z.enum(SUFFIXES)], { error: "Pick a suffix from the list" }).optional().default(""),
};
const adultMessage = `The customer must be at least ${MIN_AGE} years old to pawn`;

// F15 + F16: used for both Register and Edit contact details. Required (email is the only optional field),
// because the 18+ rule can't be checked without it.
export const requiredDateOfBirthSchema = z
  .string() // the value from the date box
  .trim() // remove spaces around it
  .min(1, `Date of birth is required (customers must be ${MIN_AGE} or older)`) // can't be empty
  .refine(realDate, realDateMessage) // a real date
  .refine(isAdult, adultMessage); // 18 or older

// PB-7 AC2: missing required fields block submission.
// This is the rule set for the Register customer form.
export const customerSchema = z.object({
  // NP: the name in parts. F8: extra spaces inside become one ("Dela   Cruz" -> "Dela Cruz").
  // Any letters, hyphens, apostrophes and periods are allowed (e.g. Ma. Teresa, O'Brien, Dela Cruz-Santos).
  ...nameFields,
  address: z.string().trim().min(1, "Address is required").max(MAX.address, `Address can be at most ${MAX.address} characters`), // F4: length limit
  contact_number: phPhoneSchema, // uses the shared phone rule above
  email: z.string().trim().max(MAX.email, `Email can be at most ${MAX.email} characters`).email("Enter a valid email").optional().or(z.literal("")), // F4: length limit
  date_of_birth: requiredDateOfBirthSchema, // F15: required on Register, and the customer must be 18 or older
  id_type: z.string().trim().min(1, "Select an ID type"),
  id_number: z.string().trim().min(1, "ID number is required").max(MAX.id_number, `ID number can be at most ${MAX.id_number} characters`), // F4: length limit
})
  // F10: after the basic checks, the ID number must match the format of the chosen ID type
  .superRefine((data, ctx) => {
    const message = idNumberError(data.id_type, data.id_number);
    if (message) ctx.addIssue({ code: "custom", path: ["id_number"], message }); // shows under the ID number field
  });

// Creates a TypeScript type from the rules, so other code knows the shape of the data
export type CustomerInput = z.infer<typeof customerSchema>;
