"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, CheckboxField, Field, SubmitButton, TextareaField } from "@/components/form";
import { createClient } from "@/lib/supabase/client";
import { ITEM_CATEGORIES, KARATS, calculateKaratValuation, categoryLabel, type KaratPrices } from "@/lib/appraisal/valuation";
import { formatPeso } from "@/lib/format";
import { cx } from "@/components/ui";
import { createAppraisal, type ActionState } from "./actions";

export type SavedAppraisal = {
  id: string;
  label: string;
  value: number;
  max: number;
};

/**
 * Item 9: appraisal calculator. No customer field (the customer is attached
 * when the item is pawned). Value and maximum loan update as you type.
 */
export function AppraisalCalculator({
  prices,
  ltvPercent,
  onSaved,
  compact = false,
}: {
  prices: KaratPrices;
  ltvPercent: number;
  /** When set (inline use in New Loan), called instead of navigating. */
  onSaved?: (saved: SavedAppraisal) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [other, setOther] = useState("");
  const [karat, setKarat] = useState<number | null>(null);
  const [weight, setWeight] = useState("");
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const w = Number(weight);
  const v = karat ? calculateKaratValuation(w, karat, prices, ltvPercent) : null;

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    const supabase = createClient();
    const uploaded: string[] = [];
    for (const file of Array.from(files)) {
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("item-photos").upload(path, file);
      if (error) setUploadError(`${file.name}: ${error.message}`);
      else uploaded.push(path);
    }
    setPhotoPaths((prev) => [...prev, ...uploaded]);
    setUploading(false);
    e.target.value = "";
  }

  return (
    <ActionForm
      action={createAppraisal}
      resetOnSuccess={Boolean(onSaved)}
      className={cx("grid grid-cols-1 gap-4", !compact && "lg:grid-cols-3")}
      successMessage="Appraisal saved to the available pool."
      onSuccess={(state: ActionState) => {
        if (!state.appraisalId) return;
        if (onSaved && v) {
          onSaved({ id: state.appraisalId, label: `${categoryLabel(category, other)}, ${karat}K, ${w} g`, value: v.value, max: v.suggestedLoanMax });
          setCategory("");
          setOther("");
          setKarat(null);
          setWeight("");
          setPhotoPaths([]);
        } else {
          router.push(`/dashboard/appraisals/${state.appraisalId}`);
        }
      }}
    >
      {photoPaths.map((p) => (
        <input key={p} type="hidden" name="photo_paths" value={p} />
      ))}
      <div className={cx("grid grid-cols-1 gap-4 sm:grid-cols-2", !compact && "lg:col-span-2")}>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium text-slate-700">
            Category<span className="ml-0.5 text-red-600" aria-hidden="true">*</span>
          </legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ITEM_CATEGORIES.map((c) => (
              <label
                key={c.value}
                className={cx(
                  "cursor-pointer rounded-md border px-2.5 py-1.5 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy-500",
                  category === c.value ? "border-navy-700 bg-navy-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                <input type="radio" name="category" value={c.value} required checked={category === c.value} onChange={() => setCategory(c.value)} className="sr-only" />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
        {category === "others" && (
          <Field label="Describe the item" name="category_other" value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. Anklet" hint="Optional" className="sm:col-span-2" />
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
        </fieldset>
        <Field
          label="Weight (g)"
          name="weight_grams"
          type="number"
          step="0.001"
          min="0.001"
          required
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />

        {!compact && (
          <>
            <TextareaField label="Notes" name="condition_notes" rows={2} hint="Optional" className="sm:col-span-2" />
            <div className="sm:col-span-2">
              <label htmlFor="photos" className="block text-sm font-medium text-slate-700">
                Photo
              </label>
              <input
                id="photos"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFiles}
                aria-describedby="photos-status"
                className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-slate-700"
              />
              <p id="photos-status" className="mt-1 text-xs text-slate-500">
                {uploading ? "Uploading" : uploadError ? <span className="font-medium text-red-700">{uploadError}</span> : photoPaths.length ? `${photoPaths.length} photo(s) attached` : "Optional"}
              </p>
            </div>
            <CheckboxField name="flag_counterfeit" label="Flag for counterfeit review" hint="An Admin must clear it before a loan." className="sm:col-span-2" />
          </>
        )}
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm lg:self-start">
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-600">Price per gram{karat ? ` (${karat}K)` : ""}</dt>
            <dd className="tabular-nums">{v ? formatPeso(v.pricePerGram) : "-"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-600">Weight</dt>
            <dd className="tabular-nums">{w > 0 ? `${w} g` : "-"}</dd>
          </div>
          <div className="flex justify-between gap-2 border-t border-slate-200 pt-1.5">
            <dt className="font-medium text-slate-900">Value</dt>
            <dd className="font-semibold tabular-nums text-navy-900">{v && w > 0 ? formatPeso(v.value) : "-"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-600">LTV</dt>
            <dd className="tabular-nums">{ltvPercent}%</dd>
          </div>
          <div className="flex justify-between gap-2 border-t border-slate-200 pt-1.5">
            <dt className="font-medium text-slate-900">Maximum loan</dt>
            <dd className="text-base font-semibold tabular-nums text-navy-900">{v && w > 0 ? formatPeso(v.suggestedLoanMax) : "-"}</dd>
          </div>
        </dl>
      </div>

      <div className={cx(!compact && "lg:col-span-3")}>
        <SubmitButton pendingLabel="Saving" disabled={uploading || !v || w <= 0}>
          Save to available items
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
