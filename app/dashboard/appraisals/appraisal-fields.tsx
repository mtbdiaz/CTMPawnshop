"use client"; // runs in the browser: the buttons react to clicks

import { Field } from "@/components/form"; // the app's labeled text box
import { cx } from "@/components/ui"; // joins class names
import { ITEM_CATEGORIES, KARATS, pricePerGram, type KaratPrices } from "@/lib/appraisal/valuation";

// C2: the item fields shared by New appraisal and Edit appraisal, so both look and behave the same:
// category buttons, "Describe the item" only for Others, karat buttons, weight, and the missing-price warning.
export function AppraisalFields({
  idPrefix, // keeps the ids unique when two forms are on one page
  prices, // today's price per gram for each karat (from Settings)
  category,
  setCategory,
  other,
  setOther,
  karat,
  setKarat,
  weight,
  setWeight,
}: {
  idPrefix: string;
  prices: KaratPrices;
  category: string;
  setCategory: (v: string) => void;
  other: string;
  setOther: (v: string) => void;
  karat: number | null;
  setKarat: (v: number) => void;
  weight: string;
  setWeight: (v: string) => void;
}) {
  // C3: the picked karat has no price in Settings -> say so right away, not only after Save
  const missingPrice = karat !== null && !(pricePerGram(karat, prices) > 0);
  const weightProblem = weightError(weight); // P7: null when the weight is fine or still empty

  return (
    <>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-slate-700">
          Category<span className="ml-0.5 text-red-600" aria-hidden="true">*</span>
        </legend>
        {/* one button per category; the real radio is hidden but still works with the keyboard.
            P2: an even grid with no gaps: "Pendant w/ Chain" (the longest name) takes two spaces, so 7 categories fill
            2 full rows of 4 on wider screens, and 4 full rows of 2 on phones (grid-flow-row-dense fills the hole) */}
        <div className="mt-1 grid grid-flow-row-dense grid-cols-2 gap-1.5 sm:grid-cols-4">
          {ITEM_CATEGORIES.map((c) => (
            <label
              key={c.value}
              className={cx(
                c.value === "pendant_with_chain" && "col-span-2",
                "cursor-pointer whitespace-nowrap rounded-md border px-2 py-1.5 text-center text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy-500",
                category === c.value ? "border-navy-700 bg-navy-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              <input type="radio" name="category" value={c.value} required checked={category === c.value} onChange={() => setCategory(c.value)} className="sr-only" />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      {/* only for Others: what the item is (e.g. Anklet) */}
      {category === "others" && (
        <Field
          id={`${idPrefix}-other`}
          label="Describe the item"
          name="category_other"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="e.g. Anklet"
          hint="Optional"
          maxLength={60}
          className="sm:col-span-2"
        />
      )}

      <fieldset>
        <legend className="text-sm font-medium text-slate-700">
          Karat<span className="ml-0.5 text-red-600" aria-hidden="true">*</span>
        </legend>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {KARATS.map((k) => (
            <label
              key={k}
              className={cx(
                "cursor-pointer rounded-md border py-2 text-center text-sm font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy-500",
                karat === k ? "border-navy-700 bg-navy-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              <input type="radio" name="karat" value={k} required checked={karat === k} onChange={() => setKarat(k)} className="sr-only" />
              {k}K
            </label>
          ))}
        </div>
        {/* C3: shown as soon as the karat is picked. role="alert" = screen readers hear it */}
        {missingPrice && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700">
            The {karat}K price per gram is not set. An Admin must set it in Settings before this item can be appraised.
          </p>
        )}
      </fieldset>
      <div>
      <Field
        id={`${idPrefix}-weight`}
        label="Weight (g)"
        name="weight_grams"
        type="number"
        step="0.001"
        min="0.001"
        max="5000"
        required
        inputMode="decimal"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        aria-describedby={weightProblem ? `${idPrefix}-weight-problem` : undefined}
      />
      {/* P7: a weight the form can't accept, said right away (Save stays greyed out) */}
      {weightProblem && (
        <p id={`${idPrefix}-weight-problem`} role="alert" className="mt-1 text-xs font-medium text-red-700">
          {weightProblem}
        </p>
      )}
      </div>
    </>
  );
}

/** P7: the weight rule shown under the box: above 0, at most 5,000 g, at most 3 decimals (same as the server). */
export function weightError(weight: string): string | null {
  if (weight.trim() === "") return null; // nothing typed yet
  const n = Number(weight);
  if (!Number.isFinite(n)) return "Enter the weight as a number of grams, e.g. 3.25.";
  if (n <= 0) return "Weight must be more than 0 g.";
  if (n > 5000) return "Check the weight. The most allowed is 5,000 g.";
  if (!/^\d*(\.\d{0,3})?$/.test(weight.trim())) return "Use at most 3 decimal places (e.g. 3.255 g).";
  return null;
}

/** C3: true when this karat has a price above zero in Settings. */
export function hasPrice(karat: number | null, prices: KaratPrices) {
  return karat !== null && pricePerGram(karat, prices) > 0;
}
