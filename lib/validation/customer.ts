import { z } from "zod";

// PB-7 AC2: missing required fields block submission.
export const customerSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required"),
  address: z.string().trim().min(1, "Address is required"),
  contact_number: z.string().trim().min(1, "Contact number is required"),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  date_of_birth: z.string().trim().optional().or(z.literal("")),
  id_type: z.string().trim().min(1, "ID type is required"),
  id_number: z.string().trim().min(1, "ID number is required"),
});

export type CustomerInput = z.infer<typeof customerSchema>;
