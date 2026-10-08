import { z } from "zod";

const categories = ["earrings", "ring", "pendant", "chain", "bracelet", "pendant_with_chain", "others"] as const;

// Items 2, 3, 9: appraisal calculator inputs. No customer (attached at pawn
// time) and no purity test (the per-karat price already encodes fineness).
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

export type AppraisalInput = z.infer<typeof appraisalSchema>;
