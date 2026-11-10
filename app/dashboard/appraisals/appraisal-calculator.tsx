"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, SubmitButton, TextareaField } from "@/components/form";
import { createClient } from "@/lib/supabase/client";
import { calculateKaratValuation, categoryLabel, type KaratPrices } from "@/lib/appraisal/valuation";
import { formatPeso } from "@/lib/format";
import { buttonClasses, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { AppraisalFields, hasPrice, weightError } from "./appraisal-fields"; // C2: the same item fields as Edit appraisal
import { createAppraisal, type ActionState } from "./actions";
import { CustomerPicker } from "./customer-picker"; // #38: who the item belongs to

// C4: photo rules. Phone photos are often 3-8 MB; 5 MB keeps them readable without filling storage.
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"]; // JPEG, PNG, WebP only
const PHOTO_MAX_MB = 5;
const PHOTO_MAX = 6; // at most 6 photos per item
type Photo = { path: string; url: string; name: string }; // path = where it is stored, url = the preview on this screen

export type SavedAppraisal = {
  id: string;
  label: string;
  value: number;
  max: number;
  flagged: boolean; // NL3: saved with "Flag for counterfeit review", so it can't be pawned until an Admin clears it
};

/**
 * Item 9: appraisal calculator. Value and maximum loan update as you type.
 * #38: every new appraisal says which customer the item belongs to. The popup has a customer picker;
 * inside New Loan the customer chosen in step 1 is used (forCustomer).
 * NL3: New Loan's "Appraise now" uses this same full form (notes, photos, counterfeit flag), not a smaller copy.
 */
export function AppraisalCalculator({
  prices,
  ltvPercent,
  onSaved,
  onCancel,
  forCustomer,
}: {
  prices: KaratPrices;
  ltvPercent: number;
  /** When set (inline use in New Loan), called instead of navigating. */
  onSaved?: (saved: SavedAppraisal) => void;
  /** C1: shows a Cancel button (used by the New appraisal popup). */
  onCancel?: () => void;
  /** #38: New Loan only: the customer picked in step 1 (null = none picked yet, so nothing can be saved). */
  forCustomer?: { id: string; full_name: string } | null;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [other, setOther] = useState("");
  const [karat, setKarat] = useState<number | null>(null);
  const [weight, setWeight] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]); // C4: attached photos with a preview each
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [hasCustomer, setHasCustomer] = useState(false); // #38: the popup's customer picker has someone picked
  const [flagged, setFlagged] = useState(false); // N6: "Flag for counterfeit review" is ticked
  const previews = useRef<string[]>([]); // every preview made, so they can be freed when the form closes

  const w = Number(weight);
  const priced = hasPrice(karat, prices); // C3: false when the picked karat has no price in Settings
  const v = karat && priced ? calculateKaratValuation(w, karat, prices, ltvPercent) : null;

  // free the previews' memory when the form goes away
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // so the same file can be picked again after Remove
    if (!files.length) return;
    const problems: string[] = [];
    // C4: check type, size and count BEFORE uploading anything
    const ok = files.filter((f) => {
      if (!PHOTO_TYPES.includes(f.type)) return problems.push(`${f.name} is not a JPEG, PNG or WebP photo.`), false;
      if (f.size > PHOTO_MAX_MB * 1024 * 1024) return problems.push(`${f.name} is larger than ${PHOTO_MAX_MB} MB.`), false;
      return true;
    });
    const room = PHOTO_MAX - photos.length;
    if (ok.length > room) problems.push(`Only ${PHOTO_MAX} photos per item. ${ok.length - Math.max(room, 0)} were not added.`);
    const toUpload = ok.slice(0, Math.max(room, 0));
    setUploadError(problems.length ? problems.join(" ") : null);
    if (!toUpload.length) return;

    setUploading(true);
    const supabase = createClient();
    const added: Photo[] = [];
    for (const file of toUpload) {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${crypto.randomUUID()}.${ext}`; // C4: a random name, so spaces or odd characters in the file name can't break the path
      const { error } = await supabase.storage.from("item-photos").upload(path, file, { contentType: file.type });
      if (error) {
        console.error("photo upload failed:", error.message); // details for the developers
        problems.push(`${file.name} could not be uploaded. Try again.`); // plain words for staff
      } else {
        const url = URL.createObjectURL(file); // a preview straight from the file, no download needed
        previews.current.push(url);
        added.push({ path, url, name: file.name });
      }
    }
    setPhotos((prev) => [...prev, ...added]);
    setUploadError(problems.length ? problems.join(" ") : null);
    setUploading(false);
  }

  // C4: take a photo off this appraisal before saving
  function removePhoto(path: string) {
    setPhotos((prev) => prev.filter((p) => p.path !== path));
    // #25: also delete the file, so it doesn't stay in storage forever. The database only lets you delete a photo
    // you uploaded yourself that isn't saved with an appraisal. If this fails, nothing is lost: the server
    // clean-up (lib/appraisal/photo-cleanup.ts) removes unused photos after 24 hours.
    void createClient()
      .storage.from("item-photos")
      .remove([path])
      .then(({ error }) => {
        if (error) console.error("photo delete failed:", error.message); // details for the developers
      });
  }

  // N2: the live valuation box. Maximum loan is the biggest number; value comes second.
  const valuation = (
    <section aria-labelledby="valuation-title" className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      {/* P3: a small heading so it's clear these numbers update as you type */}
      <h3 id="valuation-title" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        Live valuation
      </h3>
      <dl className="space-y-1.5">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">Price per gram{karat ? ` (${karat}K)` : ""}</dt>
          <dd className={cx("tabular-nums", karat !== null && !priced && "font-medium text-red-700")}>{v ? formatPeso(v.pricePerGram) : karat && !priced ? "Not set" : "-"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">Weight</dt>
          <dd className="tabular-nums">{w > 0 ? `${w} g` : "-"}</dd>
        </div>
        <div className="flex justify-between gap-2 border-t border-slate-200 pt-1.5">
          <dt className="font-medium text-slate-900">Appraised value</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{v && w > 0 ? formatPeso(v.value) : "-"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">LTV</dt>
          <dd className="tabular-nums">{ltvPercent}%</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-t border-slate-200 pt-1.5">
          <dt className="font-medium text-slate-900">Maximum loan</dt>
          <dd className="text-lg font-semibold tabular-nums text-navy-900">{v && w > 0 ? formatPeso(v.suggestedLoanMax) : "-"}</dd>
        </div>
      </dl>
      {/* N2: what the number means */}
      <p className="mt-2 text-xs text-slate-500">The most a Cashier can lend on this item. The loan can be lower.</p>
    </section>
  );

  // C3: can't save until the karat has a price and the weight is above 0
  // #38: and only once the customer is known (the picker in the popup, step 1 in New Loan)
  const inLoan = forCustomer !== undefined; // true = used inside New Loan (the customer comes from step 1)
  const customerOk = inLoan ? Boolean(forCustomer) : hasCustomer;
  const canSave = !uploading && Boolean(v) && w > 0 && !weightError(weight) && customerOk; // P7: also a weight within the rules

  // N1: the popup. Left = the item; right = live valuation and photos; bottom = review flag and the buttons.
  return (
    <ActionForm
      action={createAppraisal}
      className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      // N7: say where the item went
      successMessage={flagged ? "Appraisal saved and sent to counterfeit review. No loan until an Admin clears it." : inLoan ? "Appraisal saved. It is picked for this loan." : "Appraisal saved. It can now be pawned."}
      onSuccess={(state: ActionState) => {
        if (!state.appraisalId) return;
        if (onSaved && v) {
          // NL3: inside New Loan: hand the new item to the loan form and empty this form for the next item
          onSaved({ id: state.appraisalId, label: `${categoryLabel(category, other)}, ${karat}K, ${w} g`, value: v.value, max: v.suggestedLoanMax, flagged });
          setCategory("");
          setOther("");
          setKarat(null);
          setWeight("");
          setPhotos([]); // the photos now belong to the saved appraisal
          setFlagged(false);
          return;
        }
        router.push(`/dashboard/appraisals/${state.appraisalId}`); // open the new appraisal
      }}
      resetOnSuccess={inLoan} // NL3: also empties the notes box
    >
      {photos.map((p) => (
        <input key={p.path} type="hidden" name="photo_paths" value={p.path} />
      ))}

      {/* LEFT: category, karat, weight, notes */}
      <div className="grid content-start grid-cols-1 gap-4 sm:grid-cols-2">
        {/* #38: first, who brought the item in. NL3: inside New Loan it is the customer picked in step 1 */}
        <div className="sm:col-span-2">
          {!inLoan ? (
            <CustomerPicker onPicked={(c) => setHasCustomer(Boolean(c))} />
          ) : (
            <>
              <input type="hidden" name="customer_id" value={forCustomer?.id ?? ""} />
              {forCustomer ? (
                <p className="text-sm text-slate-600">
                  This item will be saved for <span className="font-medium text-slate-900">{forCustomer.full_name}</span>. If the loan is cancelled, the appraisal stays under Available items for this customer.
                </p>
              ) : (
                <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Pick the customer in step 1 first. An appraisal is saved for the customer who brought the item in.
                </p>
              )}
            </>
          )}
        </div>
        <AppraisalFields idPrefix="calc" prices={prices} category={category} setCategory={setCategory} other={other} setOther={setOther} karat={karat} setKarat={setKarat} weight={weight} setWeight={setWeight} />
        {/* N9: "(optional)" in the label instead of a separate line; the placeholder says what to write */}
        <TextareaField label="Notes (optional)" name="condition_notes" rows={3} maxLength={500} placeholder="Condition, markings, defects or other details" className="sm:col-span-2" />
      </div>

      {/* RIGHT: live valuation, then photos */}
      <div className="space-y-4">
        {valuation}

        {/* N5: our own photo area instead of the browser's file box (which said "No file chosen" even with photos attached) */}
        <div>
          <p id="photos-title" className="text-sm font-medium text-slate-700">
            Item photos ({photos.length}/{PHOTO_MAX})
          </p>
          {/* P4: a small dashed area. Click it, or Tab to it and press Enter/Space, to pick photos.
              The real file picker is hidden inside; the area shows the keyboard outline when it has focus */}
          {photos.length < PHOTO_MAX && (
            <label
              className={cx(
                "mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 text-sm text-slate-700 hover:border-navy-500 hover:bg-slate-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy-500",
                photos.length ? "py-2" : "py-4", // smaller once photos are attached
                uploading && "pointer-events-none opacity-60",
              )}
            >
              <Icon name="plus" className="h-4 w-4 text-slate-500" />
              <span className="font-medium">{uploading ? "Uploading" : photos.length ? "Add more photos" : "Add photos"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleFiles}
                disabled={uploading}
                aria-describedby="photos-status"
                className="sr-only"
              />
            </label>
          )}
          <p id="photos-status" aria-live="polite" className="mt-1 text-xs text-slate-500">
            {photos.length >= PHOTO_MAX ? `Photo limit reached (${PHOTO_MAX}). Remove one to add another.` : `Optional. JPEG, PNG or WebP, up to ${PHOTO_MAX_MB} MB each.`}
          </p>
          {uploadError && (
            <p role="alert" className="mt-1 text-xs font-medium text-red-700">
              {uploadError}
            </p>
          )}
          {/* C4: a small preview of each photo with View and Remove */}
          {photos.length > 0 && (
            <ul aria-labelledby="photos-title" className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3">
              {photos.map((p, i) => (
                <li key={p.path}>
                  <a href={p.url} target="_blank" rel="noreferrer" aria-label={`View photo ${i + 1}, ${p.name}`} className="block overflow-hidden rounded-md border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, not a page image */}
                    <img src={p.url} alt="" className="aspect-square w-full object-cover" />
                  </a>
                  <button type="button" onClick={() => removePhoto(p.path)} className="mt-1 w-full rounded text-xs font-medium text-red-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500" aria-label={`Remove photo ${i + 1}, ${p.name}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* BOTTOM: N6 the review flag. It records a doubt, not a finding */}
      <div className="lg:col-span-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="flag_counterfeit"
            checked={flagged}
            onChange={(e) => setFlagged(e.target.checked)}
            aria-describedby="flag-hint"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500"
          />
          <span>
            <span className="font-medium text-slate-800">Flag for counterfeit review</span>
            <span id="flag-hint" className="block text-xs text-slate-500">
              Request an Admin review if the item may be counterfeit. No loan can be issued until an Admin clears it.
            </span>
          </span>
        </label>
        {flagged && (
          <p role="status" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This item will go to Awaiting review, not Available.
          </p>
        )}
      </div>

      {/* N8: footer like Register customer: Cancel and the main button on the right */}
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 lg:col-span-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonClasses("secondary")}>
            Cancel
          </button>
        )}
        {/* N7: the words say where the item goes */}
        <SubmitButton pendingLabel="Saving" disabled={!canSave}>
          {flagged ? "Save for review" : "Save appraisal"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
