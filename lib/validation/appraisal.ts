import { z } from "zod";

// PB-12 AC2: reject out-of-range values (e.g. negative weight).
export const appraisalSchema = z.object({
  customer_id: z.string().uuid("Select a customer"),
  weight_grams: z.coerce.number().gt(0, "Weight must be greater than 0"),
  karat: z.coerce.number().int().min(1, "Karat must be between 1 and 24").max(24, "Karat must be between 1 and 24"),
  purity_percent: z.coerce.number().gt(0, "Purity must be between 0 and 100").max(100, "Purity must be between 0 and 100"),
  condition_notes: z.string().trim().optional().or(z.literal("")),
  // PB-13 AC1: at least one photo required.
  photo_paths: z
    .array(z.string())
    .min(1, "At least one photo is required"),
});

export type AppraisalInput = z.infer<typeof appraisalSchema>;
