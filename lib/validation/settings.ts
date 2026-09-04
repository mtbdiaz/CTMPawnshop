import { z } from "zod";

// PB-6 AC2: reject negative/non-numeric input.
export const businessRulesSchema = z.object({
  interest_rate_percent: z.coerce.number().min(0, "Interest rate can't be negative"),
  gold_price_per_gram: z.coerce.number().min(0, "Gold price can't be negative"),
  ltv_percent: z.coerce
    .number()
    .gt(0, "LTV% must be greater than 0")
    .max(100, "LTV% can't exceed 100"),
  grace_period_days: z.coerce
    .number()
    .int("Grace period must be a whole number of days")
    .min(0, "Grace period can't be negative"),
});

export type BusinessRulesInput = z.infer<typeof businessRulesSchema>;
