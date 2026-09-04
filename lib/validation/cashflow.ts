import { z } from "zod";

// PB-29 AC2: reject invalid amounts (zero/negative where not applicable).
export const cashEntrySchema = z.object({
  entry_type: z.enum(["expense", "revenue"]),
  amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
  description: z.string().trim().min(1, "Description is required"),
});
export type CashEntryInput = z.infer<typeof cashEntrySchema>;
