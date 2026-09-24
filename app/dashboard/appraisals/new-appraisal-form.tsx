"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from "@/components/form";
import { Alert } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { calculateValuation, isCounterfeitRisk } from "@/lib/appraisal/valuation";
import { formatPeso } from "@/lib/format";
import { createAppraisal, type ActionState } from "./actions";

const KARATS = [24, 22, 21, 18, 14, 10];

export function NewAppraisalForm({
  customers,
  defaultCustomerId,
  goldPricePerGram,
  ltvPercent,
}: {
  customers: { id: string; full_name: string; is_blacklisted: boolean }[];
  defaultCustomerId?: string;
  goldPricePerGram: number;
  ltvPercent: number;
}) {
  const router = useRouter();
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [karat, setKarat] = useState("");
  const [purity, setPurity] = useState("");

  const w = Number(weight);
  const k = Number(karat);
  const p = Number(purity);
  const ready = w > 0 && p > 0 && p <= 100 && goldPricePerGram > 0;
  const preview = ready ? calculateValuation({ weightGrams: w, purityPercent: p, goldPricePerGram, ltvPercent }) : null;
  const riskPreview = k > 0 && p > 0 ? isCounterfeitRisk(k, p) : false;

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const supabase = createClient();
    const uploaded: string[] = [];
    for (const file of Array.from(files)) {
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("item-photos").upload(path, file);
      if (error) {
        setUploadError(`${file.name}: ${error.message}`);
        continue;
      }
      uploaded.push(path);
    }
    setPhotoPaths((prev) => [...prev, ...uploaded]);
    setUploading(false);
    e.target.value = "";
  }

  return (
    <ActionForm
      action={createAppraisal}
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      successMessage="Appraisal saved."
      onSuccess={(state: ActionState) => {
        if (state.appraisalId) router.push(`/dashboard/appraisals/${state.appraisalId}`);
      }}
    >
      {(state) => (
        <>
          {photoPaths.map((path) => (
            <input key={path} type="hidden" name="photo_paths" value={path} />
          ))}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
            <SelectField label="Customer" name="customer_id" required defaultValue={defaultCustomerId ?? ""} className="sm:col-span-2">
              <option value="" disabled>
                Select a customer…
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id} disabled={c.is_blacklisted}>
                  {c.full_name}
                  {c.is_blacklisted ? " — BLACKLISTED" : ""}
                </option>
              ))}
            </SelectField>

            <Field
              label="Weight (grams)"
              name="weight_grams"
              type="number"
              step="0.001"
              min="0.001"
              required
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <SelectField label="Claimed karat" name="karat" required value={karat} onChange={(e) => setKarat(e.target.value)}>
              <option value="" disabled>
                Select karat…
              </option>
              {KARATS.map((kt) => (
                <option key={kt} value={kt}>
                  {kt}k
                </option>
              ))}
            </SelectField>
            <Field
              label="Tested purity (%)"
              name="purity_percent"
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              required
              inputMode="decimal"
              value={purity}
              onChange={(e) => setPurity(e.target.value)}
              hint="From the acid/XRF test result."
              className="sm:col-span-2"
            />
            <TextareaField label="Condition notes" name="condition_notes" rows={2} hint="Optional — scratches, stones, clasp condition, etc." className="sm:col-span-2" />

            <div className="sm:col-span-2">
              <label htmlFor="photos" className="block text-sm font-medium text-slate-700">
                Item photos<span className="ml-0.5 text-red-600" aria-hidden="true">*</span>
              </label>
              <input
                id="photos"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFiles}
                aria-describedby="photos-status"
                className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-navy-800 hover:file:bg-navy-100"
              />
              <p id="photos-status" className="mt-1 text-xs">
                {uploading ? (
                  <span className="text-slate-500">Uploading…</span>
                ) : uploadError ? (
                  <span className="font-medium text-red-700">{uploadError}</span>
                ) : photoPaths.length > 0 ? (
                  <span className="font-medium text-emerald-700">{photoPaths.length} photo(s) attached.</span>
                ) : state.fieldErrors?.photo_paths ? (
                  <span className="font-medium text-red-700">{state.fieldErrors.photo_paths}</span>
                ) : (
                  <span className="text-slate-500">At least one photo is required.</span>
                )}
              </p>
            </div>
          </div>

          <aside className="rounded-xl border border-gold-300 bg-gold-50 p-4 lg:self-start">
            <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">Live estimate</p>
            {preview ? (
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-slate-600">Appraised value</dt>
                  <dd className="text-xl font-semibold tabular-nums text-navy-900">{formatPeso(preview.value)}</dd>
                </div>
                <div>
                  <dt className="text-slate-600">Suggested loan range</dt>
                  <dd className="font-semibold tabular-nums text-navy-900">
                    {formatPeso(preview.suggestedLoanMin)} – {formatPeso(preview.suggestedLoanMax)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Enter weight and purity to see the valuation.</p>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Gold price {formatPeso(goldPricePerGram)}/g · LTV {ltvPercent}%. Valuation formula is a placeholder pending
              confirmation by CTM Pawnshop.
            </p>
            {riskPreview && (
              <Alert tone="danger" className="mt-3" title="Purity outside expected range">
                This item will be flagged as a counterfeit risk and needs Admin review before a loan.
              </Alert>
            )}
          </aside>

          <div className="lg:col-span-3">
            <SubmitButton pendingLabel="Saving…" disabled={uploading}>
              Calculate &amp; save appraisal
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
