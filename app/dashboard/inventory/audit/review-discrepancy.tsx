"use client"; // runs in the browser: the popup, the answer that is picked, the photos

import { useState, type ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { PopupButton } from "@/components/popup-button"; // a button that opens a small popup on the same page
import { PhotoGrid } from "@/components/photo-viewer";
import { Badge, buttonClasses } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { appraisalNo } from "@/lib/ref-numbers";
import { FOLLOWUP_OUTCOMES, followupLabel, followupStatus, reasonLabel, resultLabel, type FollowupRow } from "@/lib/inventory/audit";
import { auditItemPhotos, reviewDiscrepancy, type ActionState } from "../actions";

const inputClass = "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

// AD1 (Nov 11, migration 0046): "Review discrepancy" replaces the one-click "Mark found".
// The popup shows everything needed to recognise the item, what the audit found, and every check since.
// The person then says what THEY found now. Nothing here changes the audit's own result, the item's location,
// its custody status or its loan.
export function ReviewDiscrepancy({ row }: { row: FollowupRow }) {
  const [outcome, setOutcome] = useState(""); // the answer picked in the popup
  const [photos, setPhotos] = useState<{ urls: string[]; error?: string; loading?: boolean } | null>(null);
  const ref = appraisalNo(row.appraisal_no); // "A-0665"
  const title = `${categoryLabel(row.category, row.category_other)}, ${row.karat ?? "?"}K, ${row.weight_grams ?? "?"} g`;
  const saw = FOLLOWUP_OUTCOMES.find((o) => o.value === outcome)?.saw ?? false; // an answer that says the item was seen
  const status = followupStatus(row.followups, row.result);

  async function showPhotos() {
    if (!row.appraisal_item_id) return;
    setPhotos({ urls: [], loading: true });
    try {
      setPhotos(await auditItemPhotos(row.appraisal_item_id));
    } catch {
      setPhotos({ urls: [], error: "Could not load the photos." });
    }
  }

  return (
    <PopupButton label="Review discrepancy" title="Review discrepancy" className="font-medium text-navy-800">
      <div className="space-y-4 text-sm">
        {/* 1. which item, and what the audit found (read only) */}
        <div>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {title}
            {ref && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-800">{ref}</span>}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Info label="Pawn ticket">{row.ticket_number ?? "No loan"}</Info>
            <Info label="Pawner">{row.customer_name ?? "Not recorded"}</Info>
            <Info label="Recorded location">{row.current_vault ?? row.expected_vault ?? "Not recorded"}</Info>
            <Info label="Audit finding">
              {resultLabel(row.result)}
              {row.result === "not_located" && row.reason ? `: ${reasonLabel(row.reason).toLowerCase()}` : ""}
              {row.result === "found_elsewhere" && row.found_location ? ` (${row.found_location})` : ""}
            </Info>
            <Info label="Audit date">{formatDateTime(row.audit_at)}</Info>
            <Info label="Recorded by">{row.recorded_by ?? "Not recorded"}</Info>
            <div className="col-span-2">
              <Info label="Note from the audit">{row.notes ? <span className="italic">&ldquo;{row.notes}&rdquo;</span> : "None written"}</Info>
            </div>
            {row.condition_notes?.trim() && (
              <div className="col-span-2">
                <Info label="Notes from the appraisal">{row.condition_notes}</Info>
              </div>
            )}
          </dl>
          <div className="mt-2">
            {row.photo_count > 0 && !photos?.urls.length ? (
              <button type="button" onClick={showPhotos} disabled={photos?.loading} className={buttonClasses("secondary", "sm")}>
                {photos?.loading ? "Loading photos" : `Show photos (${row.photo_count})`}
              </button>
            ) : (
              row.photo_count === 0 && <span className="text-xs text-slate-600">No photos were taken at the appraisal.</span>
            )}
            {photos?.error && (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {photos.error}
              </p>
            )}
            {photos && photos.urls.length > 0 && <PhotoGrid className="mt-2" photos={photos.urls.map((url, i) => ({ url, alt: `${title}${ref ? `, ${ref}` : ""}, photo ${i + 1}` }))} />}
          </div>
        </div>

        {/* 2. the checks done since the audit, oldest first */}
        <div className="border-t border-slate-200 pt-3">
          <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
            Follow-up so far <Badge tone={status.tone}>{status.label}</Badge>
          </p>
          {row.followups.length ? (
            <ul className="mt-1 space-y-1 text-xs text-slate-700">
              {row.followups.map((f, i) => (
                <li key={i} className="break-words">
                  <span className="font-medium text-slate-900">{followupLabel(f.outcome)}{f.found_location ? ` (${f.found_location})` : ""}</span> · {formatDateTime(f.at)} · {f.by ?? "staff"} · <span className="italic">&ldquo;{f.notes}&rdquo;</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-slate-600">Nobody has checked this item again yet.</p>
          )}
        </div>

        {/* 3. what the person found now */}
        <ActionForm<ActionState>
          action={reviewDiscrepancy}
          className="space-y-3 border-t border-slate-200 pt-3"
          // after a save the form starts clean: the old note, place and "I saw it" tick must not carry over to the next check
          resetOnSuccess
          onSuccess={() => setOutcome("")}
          successMessage={(state) => (state.id === "found_expected" ? `${ref || title}: follow-up closed.` : `${ref || title}: follow-up saved. It stays on the list.`)}
        >
          {(state) => (
            <>
              <input type="hidden" name="line_id" value={row.id} />
              <input type="hidden" name="seen" value={row.followups.length} />
              <fieldset>
                <legend className="font-medium text-slate-900">
                  What did you find when you checked again? <span className="text-red-600" aria-hidden="true">*</span>
                </legend>
                <div className="mt-1.5 space-y-1.5">
                  {FOLLOWUP_OUTCOMES.map((o) => (
                    <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-300 px-3 py-2 has-[:checked]:border-navy-700 has-[:checked]:bg-navy-50">
                      <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="mt-0.5 h-4 w-4 border-slate-400 text-navy-700 focus:ring-navy-500" />
                      <span>
                        <span className="text-slate-900">{o.label}</span>
                        <span className="block text-xs text-slate-600">{o.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {state.fieldErrors?.outcome && <p className="mt-1 text-xs font-medium text-red-700">{state.fieldErrors.outcome}</p>}
              </fieldset>

              {outcome === "found_elsewhere" && (
                <label className="block font-medium text-slate-700">
                  Where is it now? <span className="text-red-600" aria-hidden="true">*</span>
                  <input type="text" name="found_location" required minLength={2} maxLength={120} placeholder="e.g. Vault B, shelf 2" className={inputClass} />
                  {state.fieldErrors?.found_location && <span className="mt-1 block text-xs font-medium text-red-700">{state.fieldErrors.found_location}</span>}
                  <span className="mt-1 block text-xs font-normal text-slate-600">This is only written down here. The item&rsquo;s location in the system is not changed, so it stays on this list until it is back at its recorded location.</span>
                </label>
              )}

              <label className="block font-medium text-slate-700">
                What you checked and saw <span className="text-red-600" aria-hidden="true">*</span>
                <textarea name="notes" required minLength={10} maxLength={500} rows={2} placeholder="e.g. Matched the tag and the weight on shelf 3 of Vault A" className={inputClass} />
                {state.fieldErrors?.notes && <span className="mt-1 block text-xs font-medium text-red-700">{state.fieldErrors.notes}</span>}
              </label>

              {/* only for the answers that say the item was seen: the person confirms they saw it themselves */}
              {saw && (
                <label className="flex items-start gap-2 text-slate-800">
                  <input type="checkbox" name="confirm" required className="mt-0.5 h-4 w-4 rounded border-slate-400 text-navy-700 focus:ring-navy-500" />
                  <span>
                    I saw this item myself and matched it to {ref || "its record"} (type, karat and weight).
                    {state.fieldErrors?.confirm && <span className="block text-xs font-medium text-red-700">{state.fieldErrors.confirm}</span>}
                  </span>
                </label>
              )}

              <SubmitButton pendingLabel="Saving" disabled={!outcome}>
                Save follow-up
              </SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </PopupButton>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-slate-900">{children}</dd>
    </div>
  );
}
