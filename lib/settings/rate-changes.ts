// SR4 (Nov 14, Wush): Settings → Rates and business rules. Before saving, the Admin sees only the values that changed,
// as "old → new". Before: the save popup always listed the three current gold prices, even when only the interest
// rate was changed, and never showed the new values.
// Plain functions (no React, no database) so they can be unit tested.

export type RateKey =
  | "price_24k"
  | "price_21k"
  | "price_18k"
  | "interest_rate_percent"
  | "ltv_percent"
  | "grace_period_days"
  | "liquidated_damages_percent";

export type RateValues = Record<RateKey, number | string | null>;

type Kind = "peso" | "percent" | "days";

// The order here is the order of the boxes on the page and of the rows in the popup
export const RATE_FIELDS: { key: RateKey; label: string; kind: Kind }[] = [
  { key: "price_24k", label: "24K price per gram", kind: "peso" },
  { key: "price_21k", label: "21K price per gram", kind: "peso" },
  { key: "price_18k", label: "18K price per gram", kind: "peso" },
  { key: "interest_rate_percent", label: "Interest rate", kind: "percent" },
  { key: "ltv_percent", label: "Loan-to-value", kind: "percent" },
  { key: "grace_period_days", label: "Grace period", kind: "days" },
  { key: "liquidated_damages_percent", label: "Liquidated damages", kind: "percent" },
];

// A typed value as a number, or null when the box is empty or not a number (the server check says what's wrong)
export function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const plain = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 });
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// How one value reads in the popup: ₱3,550.00 / 5% / 7 days. An empty or wrong box reads "(empty)" or as typed.
export function formatRate(kind: Kind, value: number | string | null | undefined): string {
  const n = toNumber(value);
  if (n === null) return value === null || value === undefined || String(value).trim() === "" ? "(empty)" : String(value);
  if (kind === "peso") return peso.format(n);
  if (kind === "percent") return `${plain.format(n)}%`;
  return `${plain.format(n)} ${n === 1 ? "day" : "days"}`;
}

// The values that are different from what is saved now, as popup rows: [label, "old → new"].
// 5 and "5.00" are the same value, so retyping a value the same way doesn't count as a change.
export function changedRates(saved: RateValues, typed: RateValues): [string, string][] {
  const rows: [string, string][] = [];
  for (const f of RATE_FIELDS) {
    const before = toNumber(saved[f.key]);
    const after = toNumber(typed[f.key]);
    const same = before !== null && after !== null ? Math.abs(before - after) < 0.000001 : String(saved[f.key] ?? "").trim() === String(typed[f.key] ?? "").trim();
    if (!same) rows.push([f.label, `${formatRate(f.kind, saved[f.key])} → ${formatRate(f.kind, typed[f.key])}`]);
  }
  return rows;
}

// SR3: the example under Loan terms, worked out from what is typed: liquidated damages on ₱10,000 unpaid principal
// for every 30 days. null when the % box is empty or not a number (the example is then left out).
export function damagesExample(percent: number | string | null | undefined, unpaid = 10000): number | null {
  const p = toNumber(percent);
  if (p === null || p < 0) return null;
  return Math.round(unpaid * p) / 100; // unpaid × p%, to the centavo (the database rounds the same way)
}
