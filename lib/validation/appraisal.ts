import { z } from "zod";

const categories = ["earrings", "ring", "pendant", "chain", "bracelet", "pendant_with_chain", "others"] as const;

// Items 2, 3, 9: the item fields of an appraisal (used by New appraisal and Edit appraisal).
// No purity test (the per-karat price already encodes fineness).
export const appraisalSchema = z
  .object({
    category: z.enum(categories, { message: "Pick a category" }),
    category_other: z.string().trim().max(60).optional().or(z.literal("")),
    karat: z.coerce
      .number()
      .refine((k) => k === 24 || k === 21 || k === 18, "Only 24K, 21K and 18K are accepted"),
    weight_grams: z.coerce.number().gt(0, "Weight must be greater than 0").max(5000, "Check the weight"),
    condition_notes: z.string().trim().max(500).optional().or(z.literal("")),
    photo_paths: z.array(z.string()).default([]),
    flag_counterfeit: z.boolean().default(false),
  });

// #38: a NEW appraisal also says which customer the item belongs to (owner decision, Nov 10, 2026).
// Edit appraisal doesn't send it: the customer is changed with its own button on the appraisal page.
export const newAppraisalSchema = appraisalSchema.extend({
  customer_id: z.string({ message: "Choose the customer" }).uuid("Choose the customer"),
});

export type AppraisalInput = z.infer<typeof appraisalSchema>;
