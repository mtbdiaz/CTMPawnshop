import { z } from "zod";

const price = (label: string) => z.coerce.number().gt(0, `${label} price must be greater than 0`);

// PB-6 AC2 + item 3: the owner sets per-gram prices for 24K, 21K and 18K only.
export const businessRulesSchema = z.object({
  interest_rate_percent: z.coerce.number().min(0, "Interest rate can't be negative"),
  price_24k: price("24K"),
  price_21k: price("21K"),
  price_18k: price("18K"),
  ltv_percent: z.coerce.number().gt(0, "LTV% must be greater than 0").max(100, "LTV% can't exceed 100"),
  grace_period_days: z.coerce.number().int("Grace period must be a whole number of days").min(0, "Grace period can't be negative"),
});

export type BusinessRulesInput = z.infer<typeof businessRulesSchema>;
