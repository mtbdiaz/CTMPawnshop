import { z } from "zod";

export const createLoanSchema = z.object({
  customer_id: z.string().uuid("Select a customer"),
  appraisal_item_id: z.string().uuid("Select an appraised item"),
  principal_amount: z.coerce.number().gt(0, "Loan amount must be greater than 0"),
  vault_location: z.string().trim().min(1, "Vault location is required"),
});
export type CreateLoanInput = z.infer<typeof createLoanSchema>;

export const paymentSchema = z.object({
  loan_id: z.string().uuid(),
  amount: z.coerce.number().gt(0, "Payment amount must be greater than 0"),
  // PB-22: lost-ticket alternate verification.
  lost_ticket: z.boolean().default(false),
  id_number_confirm: z.string().trim().optional(),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export const extensionSchema = z.object({
  loan_id: z.string().uuid(),
});
export type ExtensionInput = z.infer<typeof extensionSchema>;

export const redeemSchema = z.object({
  loan_id: z.string().uuid(),
  lost_ticket: z.boolean().default(false),
  id_number_confirm: z.string().trim().optional(),
});
export type RedeemInput = z.infer<typeof redeemSchema>;
