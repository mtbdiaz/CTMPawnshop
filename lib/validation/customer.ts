// zod is the library that checks form input and creates error messages
import { z } from "zod";

// Philippine mobile number rule.
// "export" lets other files import and reuse this same rule.
export const phPhoneSchema = z
  .string() // the value must be text
  .trim() // remove spaces at the start and end
  // Remove spaces and dashes inside the number, so
  // "0917 123 4567" and "0917-123-4567" both become "09171234567".
  // This cleaned version is what gets saved to the database.
  .transform((value) => value.replace(/[\s-]/g, ""))
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
      .regex(/^09\d{9}$/, "Enter an 11-digit mobile number starting with 09"),
  );

// PB-7 AC2: missing required fields block submission.
// This is the rule set for the Register customer form.
export const customerSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required"),
  address: z.string().trim().min(1, "Address is required"),
  contact_number: phPhoneSchema, // uses the shared phone rule above
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  date_of_birth: z.string().trim().optional().or(z.literal("")),
  id_type: z.string().trim().min(1, "ID type is required"),
  id_number: z.string().trim().min(1, "ID number is required"),
});

// Creates a TypeScript type from the rules, so other code knows the shape of the data
export type CustomerInput = z.infer<typeof customerSchema>;