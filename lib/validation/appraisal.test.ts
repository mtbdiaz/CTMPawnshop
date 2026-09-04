import { describe, it, expect } from "vitest";
import { appraisalSchema } from "./appraisal";

describe("appraisalSchema (PB-12 AC2, PB-13 AC1)", () => {
  const valid = {
    customer_id: "11111111-1111-1111-8111-111111111111",
    weight_grams: "10.5",
    karat: "18",
    purity_percent: "75",
    condition_notes: "Light scratches",
    photo_paths: ["item-photos/foo.jpg"],
  };

  it("accepts valid input", () => {
    expect(appraisalSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects negative or zero weight", () => {
    expect(appraisalSchema.safeParse({ ...valid, weight_grams: "-1" }).success).toBe(false);
    expect(appraisalSchema.safeParse({ ...valid, weight_grams: "0" }).success).toBe(false);
  });

  it("rejects karat outside 1-24", () => {
    expect(appraisalSchema.safeParse({ ...valid, karat: "0" }).success).toBe(false);
    expect(appraisalSchema.safeParse({ ...valid, karat: "25" }).success).toBe(false);
  });

  it("rejects purity outside 0-100", () => {
    expect(appraisalSchema.safeParse({ ...valid, purity_percent: "0" }).success).toBe(false);
    expect(appraisalSchema.safeParse({ ...valid, purity_percent: "101" }).success).toBe(false);
  });

  it("rejects zero photos", () => {
    expect(appraisalSchema.safeParse({ ...valid, photo_paths: [] }).success).toBe(false);
  });

  it("rejects an invalid customer id", () => {
    expect(appraisalSchema.safeParse({ ...valid, customer_id: "not-a-uuid" }).success).toBe(
      false,
    );
  });
});
