import { describe, it, expect } from "vitest";
import { appraisalSchema } from "./appraisal";

describe("appraisalSchema (calculator inputs)", () => {
  const valid = { category: "ring", karat: "18", weight_grams: "10.5", condition_notes: "Light scratches", photo_paths: [] };

  it("accepts valid input with no customer and no photo (both optional now)", () => {
    expect(appraisalSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects negative or zero weight", () => {
    expect(appraisalSchema.safeParse({ ...valid, weight_grams: "-1" }).success).toBe(false);
    expect(appraisalSchema.safeParse({ ...valid, weight_grams: "0" }).success).toBe(false);
  });

  it("accepts only 24K, 21K and 18K", () => {
    for (const k of ["24", "21", "18"]) expect(appraisalSchema.safeParse({ ...valid, karat: k }).success).toBe(true);
    for (const k of ["22", "14", "10"]) expect(appraisalSchema.safeParse({ ...valid, karat: k }).success).toBe(false);
  });

  it("requires a known category", () => {
    expect(appraisalSchema.safeParse({ ...valid, category: "necklace" }).success).toBe(false);
    expect(appraisalSchema.safeParse({ ...valid, category: "others", category_other: "Anklet" }).success).toBe(true);
  });
});
