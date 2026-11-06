"use client"; // runs in the browser: it compares what you typed with what is saved

import { useState } from "react";
import { ActionForm, SubmitButton, TextareaField } from "@/components/form";
import { buttonClasses } from "@/components/ui";
import { calculateKaratValuation, isAcceptedKarat, type KaratPrices } from "@/lib/appraisal/valuation";
import { compareAppraisal } from "@/lib/appraisal/edit"; // the same "what changed?" rule the server uses
import { formatPeso } from "@/lib/format";
import { AppraisalFields, hasPrice, weightError } from "../appraisal-fields"; // C2: the same fields as New appraisal
import { updateAppraisal } from "../actions";

/** Editable only while the item is still in the available pool. */
export function EditAppraisalForm({
  id,
  category,
  categoryOther,
  karat,
  weight,
  notes,
  updatedAt,
  prices,
  ltvPercent,
  currentValue,
  currentMax,
  cleared,
  canChangeMaterial,
}: {
  id: string;
  category: string;
  categoryOther: string | null;
  karat: number;
  weight: number;
  notes: string | null;
  updatedAt: string; // A2: the version this form was opened on
  prices: KaratPrices; // today's prices, for the old vs new preview
  ltvPercent: number;
  currentValue: number; // the saved value
  currentMax: number; // the saved maximum loan
  cleared: boolean; // A3: an Admin cleared this item's counterfeit flag
  canChangeMaterial: boolean; // A3: false for an Appraiser on a cleared item
}) {
  // what the form shows now (starts as what is saved)
  const [cat, setCat] = useState(category);
  const [other, setOther] = useState(categoryOther ?? "");
  const [k, setK] = useState<number | null>(isAcceptedKarat(karat) ? karat : null);
  const [w, setW] = useState(String(weight));
  const [n, setN] = useState(notes ?? "");
  const [formKey, setFormKey] = useState(0); // changes on Cancel, so the notes box starts over

  const saved = { category, category_other: categoryOther, karat, weight_grams: weight, condition_notes: notes };
  const change = compareAppraisal(saved, { category: cat, category_other: cat === "others" ? other : null, karat: k ?? 0, weight_grams: Number(w), condition_notes: n });
  // A2: the new value, only when karat or weight changed (that's the only time it re-prices)
  const preview = change.reprice && k && hasPrice(k, prices) && Number(w) > 0 ? calculateKaratValuation(Number(w), k, prices, ltvPercent) : null;
  const blockedMaterial = change.material && !canChangeMaterial; // A3: the server would refuse, so say it here first

  // C5: Cancel = back to what is saved
  function reset() {
    setCat(category);
    setOther(categoryOther ?? "");
    setK(isAcceptedKarat(karat) ? karat : null);
    setW(String(weight));
    setN(notes ?? "");
    setFormKey((x) => x + 1);
  }

  return (
    <ActionForm key={formKey} action={updateAppraisal} className="grid grid-cols-1 gap-3 sm:grid-cols-2" successMessage={(s) => s.message ?? "Appraisal updated."}>
      <input type="hidden" name="appraisal_id" value={id} />
      <input type="hidden" name="updated_at" value={updatedAt} />
      <AppraisalFields
        idPrefix="edit"
        prices={prices}
        category={cat}
        setCategory={setCat}
        other={other}
        setOther={setOther}
        karat={k}
        setKarat={setK}
        weight={w}
        setWeight={setW}
      />
      <TextareaField id="edit-notes" label="Notes" name="condition_notes" rows={2} maxLength={500} value={n} onChange={(e) => setN(e.target.value)} className="sm:col-span-2" />

      {/* A3: a cleared item's karat, weight or category is what the Admin checked */}
      {cleared && (
        <p className="text-xs text-slate-600 sm:col-span-2">
          {canChangeMaterial
            ? "An Admin cleared this item. Changing the karat, weight or category sends it back to counterfeit review."
            : "An Admin cleared this item, so only an Admin can change its karat, weight or category. You can still edit the notes."}
        </p>
      )}
      {blockedMaterial && (
        <p role="alert" className="text-xs font-medium text-red-700 sm:col-span-2">
          Only an Admin can change the karat, weight or category of a cleared item. Press Cancel to undo.
        </p>
      )}

      {/* A2: before saving, show what happens to the value */}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm sm:col-span-2" aria-live="polite">
        {!change.any ? (
          <span className="text-slate-600">No changes yet.</span>
        ) : preview ? (
          <span>
            Value {formatPeso(currentValue)} → <strong className="text-navy-900">{formatPeso(preview.value)}</strong> · Maximum loan {formatPeso(currentMax)} →{" "}
            <strong className="text-navy-900">{formatPeso(preview.suggestedLoanMax)}</strong> <span className="text-slate-600">(today&apos;s price)</span>
          </span>
        ) : change.reprice ? (
          <span className="text-slate-600">Pick a karat with a price and enter the weight to see the new value.</span>
        ) : (
          <span className="text-slate-600">Value and maximum loan stay the same ({formatPeso(currentValue)} / {formatPeso(currentMax)}).</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 sm:col-span-2">
        {/* A2: nothing changed = nothing to save */}
        <SubmitButton variant="secondary" pendingLabel="Saving" disabled={!change.any || blockedMaterial || (change.reprice && !preview) || Boolean(weightError(w))}>
          Save changes
        </SubmitButton>
        {/* C5: Cancel puts everything back */}
        <button type="button" onClick={reset} disabled={!change.any} className={buttonClasses("ghost")}>
          Cancel
        </button>
      </div>
    </ActionForm>
  );
}
