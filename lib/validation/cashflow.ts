import { z } from "zod";

// PB-29 AC2: reject invalid amounts (zero/negative where not applicable).
// CL1 (Nov 12, migration 0055): the same limits the database uses in record_cash_entry, so a mistake is caught
// before the trip to the server: more than 0, at most 10,000,000, pesos and centavos only, and a real description.
export const cashEntrySchema = z.object({
  entry_type: z.enum(["expense", "revenue"], { message: "Pick Expense or Revenue." }),
  amount: z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, "")) // "1,500.50" is fine to type
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter an amount in pesos, like 1500 or 1500.50.")
    .transform(Number)
    .refine((n) => n > 0, "Amount must be greater than 0")
    .refine((n) => n <= 10_000_000, "The amount can't be more than 10,000,000."),
  description: z.string().trim().min(3, "Write what the money was for (at least 3 characters).").max(200, "Keep the description to 200 characters or less."),
});
export type CashEntryInput = z.infer<typeof cashEntrySchema>;
