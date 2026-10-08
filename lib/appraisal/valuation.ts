// PB-14 valuation, owner-confirmed structure (Oct 2026):
//   value      = weight_g x price_per_gram(karat)
//   max loan   = value x LTV%
//   min loan   = max loan x 0.9   (unchanged placeholder negotiation buffer)
// The per-karat price already encodes fineness, so purity is no longer a
// multiplier. The owner sets the 24K/21K/18K prices in Settings; nothing below
// 18K is accepted for new appraisals. See DECISIONS_LOG.md.

export const KARATS = [24, 21, 18] as const;
export type Karat = (typeof KARATS)[number];

export type KaratPrices = { price_24k: number; price_21k: number; price_18k: number };

export const ITEM_CATEGORIES = [
  { value: "earrings", label: "Earrings" },
  { value: "ring", label: "Ring" },
  { value: "pendant", label: "Pendant" },
  { value: "chain", label: "Chain" },
  { value: "bracelet", label: "Bracelet" },
  { value: "pendant_with_chain", label: "Pendant w/ Chain" },
  { value: "others", label: "Others" },
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number]["value"];

export function categoryLabel(category: string | null | undefined, other?: string | null): string {
  if (!category) return "Others";
  if (category === "others" && other?.trim()) return `Others (${other.trim()})`;
  return ITEM_CATEGORIES.find((c) => c.value === category)?.label ?? "Others";
}

export function isAcceptedKarat(karat: number): karat is Karat {
  return (KARATS as readonly number[]).includes(karat);
}

export function pricePerGram(karat: number, prices: KaratPrices): number {
  if (karat === 24) return Number(prices.price_24k);
  if (karat === 21) return Number(prices.price_21k);
  if (karat === 18) return Number(prices.price_18k);
  return 0;
}

export type ValuationResult = {
  pricePerGram: number;
  value: number;
  suggestedLoanMin: number;
  suggestedLoanMax: number;
};

const LOAN_RANGE_BUFFER = 0.9;

export function calculateKaratValuation(weightGrams: number, karat: number, prices: KaratPrices, ltvPercent: number): ValuationResult {
  const price = pricePerGram(karat, prices);
  const weight = Number.isFinite(weightGrams) && weightGrams > 0 ? weightGrams : 0;
  const value = round2(weight * price);
  const max = round2(value * (ltvPercent / 100));
  return { pricePerGram: price, value, suggestedLoanMax: max, suggestedLoanMin: round2(max * LOAN_RANGE_BUFFER) };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
