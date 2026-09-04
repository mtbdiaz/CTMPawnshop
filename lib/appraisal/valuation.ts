// PB-14: Calculate Valuation & Loan Range.
//
// TODO: confirm formula with CTM Pawnshop. This is a placeholder, not a
// client-confirmed formula — the exact karat/purity-to-value formula was
// never numerically confirmed (flagged not Estimable in the INVEST review).
// Using the standard, industry-reasonable approach until real figures are
// provided:
//   value = weight_grams * (purity_percent / 100) * gold_price_per_gram
//   loan_max = value * (ltv_percent / 100)
//   loan_min = loan_max * 0.9   (placeholder 10% appraiser-negotiation buffer)

export type ValuationInput = {
  weightGrams: number;
  purityPercent: number;
  goldPricePerGram: number;
  ltvPercent: number;
};

export type ValuationResult = {
  value: number;
  suggestedLoanMin: number;
  suggestedLoanMax: number;
};

const LOAN_RANGE_BUFFER = 0.9;

export function calculateValuation(input: ValuationInput): ValuationResult {
  const value = input.weightGrams * (input.purityPercent / 100) * input.goldPricePerGram;
  const suggestedLoanMax = value * (input.ltvPercent / 100);
  const suggestedLoanMin = suggestedLoanMax * LOAN_RANGE_BUFFER;

  return {
    value: round2(value),
    suggestedLoanMin: round2(suggestedLoanMin),
    suggestedLoanMax: round2(suggestedLoanMax),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// PB-15: Flag Counterfeit Risk — expected purity range per claimed karat.
// TODO: confirm these tolerance ranges with CTM Pawnshop; placeholder based
// on standard gold fineness tables (24k=99.9, 22k=91.6, 21k=87.5, 18k=75,
// 14k=58.3, 10k=41.7) with a tolerance band around each.
const EXPECTED_PURITY_RANGES: Record<number, [number, number]> = {
  24: [95, 100],
  22: [88, 95],
  21: [84, 91],
  18: [72, 79],
  14: [55, 62],
  10: [38, 45],
};

export function isCounterfeitRisk(karat: number, purityPercent: number): boolean {
  const range = EXPECTED_PURITY_RANGES[karat];
  if (!range) return true; // unrecognized karat claim -> flag for Admin review
  return purityPercent < range[0] || purityPercent > range[1];
}
