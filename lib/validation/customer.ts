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

// F11: date of birth is optional, but if it's filled in it must be a real one:
// not in the future and not before 1900. The date box sends "YYYY-MM-DD", so the dates can be compared as text.
export const dateOfBirthSchema = z
  .string() // the value from the date box
  .trim() // remove spaces around it
  .optional() // the field can be missing
  .or(z.literal("")) // or empty
  .refine((v) => !v || (v >= "1900-01-01" && v <= manilaToday()), "Date of birth can't be in the future or before 1900"); // empty is fine; otherwise 1900 to today

// PB-7 AC2: missing required fields block submission.
// This is the rule set for the Register customer form.
export const customerSchema = z.object({
  // F8: extra spaces inside the name are turned into one ("Juan  Dela   Cruz" -> "Juan Dela Cruz").
  // Any letters, hyphens, apostrophes and periods are allowed (e.g. Ma. Teresa, O'Brien, Dela Cruz-Santos).
  full_name: z.string().trim().min(1, "Full name is required").transform((v) => v.replace(/\s+/g, " ")),
  address: z.string().trim().min(1, "Address is required"),
  contact_number: phPhoneSchema, // uses the shared phone rule above
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  date_of_birth: dateOfBirthSchema, // F11: optional, but not in the future
  id_type: z.string().trim().min(1, "Select an ID type"),
  id_number: z.string().trim().min(1, "ID number is required"),
})
  // F10: after the basic checks, the ID number must match the format of the chosen ID type
  .superRefine((data, ctx) => {
    const message = idNumberError(data.id_type, data.id_number);
    if (message) ctx.addIssue({ code: "custom", path: ["id_number"], message }); // shows under the ID number field
  });

// Creates a TypeScript type from the rules, so other code knows the shape of the data
export type CustomerInput = z.infer<typeof customerSchema>;