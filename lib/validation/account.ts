import { z } from "zod";
import { ALL_ROLES } from "@/lib/auth/roles";

export const createAccountSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required"),
  email: z.string().trim().email("Enter a valid email address"),
  role: z.enum(ALL_ROLES as [string, ...string[]]),
  temp_password: z.string().min(8, "Temporary password must be at least 8 characters"),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

// U3 (Nov 15): a name/role change only. Before: editAccountSchema also carried is_active, so a Save from an old page
// could switch a deactivated account back on. Activating and deactivating are now a separate action.
export const staffDetailsSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required"),
  role: z.enum(ALL_ROLES as [string, ...string[]]),
});

export type StaffDetailsInput = z.infer<typeof staffDetailsSchema>;
