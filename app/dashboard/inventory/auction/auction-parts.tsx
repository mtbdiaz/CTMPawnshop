"use client"; // runs in the browser: small popups used by every Auction prep list

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ActionForm, Field, SubmitButton, TextareaField } from "@/components/form";
import { PopupButton } from "@/components/popup-button"; // a button that opens a small popup on the same page
import { PhotoGrid } from "@/components/photo-viewer";
import { Badge, buttonClasses } from "@/components/ui";
import { formatPeso } from "@/lib/format";
import { appraisedText, itemRef, itemTitle, reserveState, type AuctionItemInfo } from "@/lib/inventory/auction";
import { auditItemPhotos, markUnsold, setReserve, type ActionState } from "../actions";

// AP1: the reserve of an item, in words, so an empty value is never read as "no minimum".
// Not set = nobody decided yet (the item can't be sold) · No reserve = any price, chosen on purpose · or the price.
export function ReserveText({ minPrice, noReserve }: { minPrice: number | null; noReserve: boolean }) {
  const state = reserveState(minPrice, noReserve);
  if (state === "price") return <span className="font-medium tabular-nums text-slate-900">{formatPeso(Number(minPrice))}</span>;
  if (state === "no_reserve") return <span className="font-medium text-slate-900">No reserve</span>;
  return <Badge tone="warning">Not set</Badge>;
}

// one label + value inside a popup
function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-slate-900">{children}</dd>
    </div>
  );
}

// AP1: "Details" on any auction row: everything needed to be sure it is the right piece of jewelry
// (reference numbers, not just the description), the appraisal photos, and links to the appraisal and the loan.
// It only shows information; it changes nothing.
export function ItemDetails({ item, children }: { item: AuctionItemInfo; children?: ReactNode }) {
  const [photos, setPhotos] = useState<{ urls: string[]; error?: string; loading?: boolean } | null>(null);
  const title = itemTitle(item);
  const ref = itemRef(item);

  async function showPhotos() {
    if (!item.appraisal_item_id) return;
    setPhotos({ urls: [], loading: true });
    try {
      setPhotos(await auditItemPhotos(item.appraisal_item_id)); // links that work for 10 minutes
    } catch {
      setPhotos({ urls: [], error: "Could not load the photos." });
    }
  }

  return (
    <PopupButton label="Details" title="Item details">
      <div className="space-y-3 text-sm">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
          {title}
          {ref && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-800">{ref}</span>}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Info label="Pawn ticket">{item.ticket_number ?? "No loan"}</Info>
          <Info label="Pawned by">{item.customer_name ?? "Not recorded"}</Info>
          <Info label="Vault location">{item.vault_location ?? "Not recorded"}</Info>
          <Info label="Appraised value">{appraisedText(item.computed_value)}</Info>
          {children}
        </dl>
        {/* what the last physical audit said, when it found a problem that nobody followed up yet */}
        {item.audit_flag === "not_located" && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-900">
            <strong>Not located</strong> in the last physical audit. It can&apos;t be batched or sold until that is followed up on the Physical audit page.
          </p>
        )}
        {item.audit_flag === "found_elsewhere" && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
            <strong>Found elsewhere</strong> in the last physical audit. Check where the item is before the auction.
          </p>
        )}
        <div>
          {item.photo_count > 0 && !photos?.urls.length ? (
            <button type="button" onClick={showPhotos} disabled={photos?.loading} className={buttonClasses("secondary", "sm")}>
              {photos?.loading ? "Loading photos" : `Show photos (${item.photo_count})`}
            </button>
          ) : (
            item.photo_count === 0 && <span className="text-xs text-slate-600">No photos were taken at the appraisal.</span>
          )}
          {photos?.error && (
            <p role="alert" className="mt-1 text-xs text-red-700">
              {photos.error}
            </p>
          )}
          {photos && photos.urls.length > 0 && <PhotoGrid className="mt-2" photos={photos.urls.map((url, i) => ({ url, alt: `${title}${ref ? `, ${ref}` : ""}, photo ${i + 1}` }))} />}
        </div>
        {/* the existing pages for this item (they open in the same tab) */}
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
          {item.appraisal_item_id && (
            <Link href={`/dashboard/appraisals/${item.appraisal_item_id}`} className={buttonClasses("secondary", "sm")}>
              Open appraisal
            </Link>
          )}
          {item.loan_id && (
            <Link href={`/dashboard/loans/${item.loan_id}`} className={buttonClasses("secondary", "sm")}>
              Open loan
            </Link>
          )}
        </div>
      </div>
    </PopupButton>
  );
}

// AP1: "Set reserve" for a queued item whose reserve is Not set (all items queued before migration 0052),
// or "Change reserve" for an Admin. A price or the "No reserve" tick, never both.
export function SetReserveButton({ lineId, label, value, change }: { lineId: string; label: string; value: number | null; change?: boolean }) {
  const [none, setNone] = useState(false); // the "No reserve" tick
  return (
    <PopupButton label={change ? "Change reserve" : "Set reserve"} title={change ? "Change reserve price" : "Set reserve price"} className={change ? undefined : "font-medium text-navy-800"}>
      <ActionForm<ActionState> action={setReserve} className="space-y-3 text-sm" successMessage={`Reserve saved for ${label}.`}>
        <input type="hidden" name="line_id" value={lineId} />
        <p className="text-slate-700">
          <span className="font-medium text-slate-900">{label}</span>
          {" "}· appraised {appraisedText(value)} (a guide only)
        </p>
        <Field
          label="Reserve price (₱)"
          name="min_price"
          inputMode="decimal"
          disabled={none}
          placeholder="e.g. 5000"
          hint="The lowest amount the item may be sold for. A sale below it is refused."
        />
        <label className="flex items-start gap-2 text-slate-700">
          <input type="checkbox" name="no_reserve" checked={none} onChange={(e) => setNone(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500" />
          <span>
            No reserve
            <span className="block text-xs text-slate-600">The item may be sold at any price. Tick this only when that was decided on purpose.</span>
          </span>
        </label>
        <p className="text-xs text-slate-600">{change ? "Only an Admin can change a reserve that is already set." : "After saving, only an Admin can change it."}</p>
        <div className="flex justify-end border-t border-slate-200 pt-3">
          <SubmitButton pendingLabel="Saving">Save reserve</SubmitButton>
        </div>
      </ActionForm>
    </PopupButton>
  );
}

// AP1: "Mark unsold" for a queued item that did not sell. It goes back to Forfeited (Prepare items), stays in the
// vault, and the batch keeps the record. No money is recorded.
export function MarkUnsoldButton({ itemId, label, batch }: { itemId: string; label: string; batch: string }) {
  return (
    <PopupButton label="Mark unsold" title="Mark as not sold">
      <ActionForm<ActionState> action={markUnsold} className="space-y-3 text-sm" successMessage={`${label}: marked not sold. It is back under Prepare items.`}>
        <input type="hidden" name="item_id" value={itemId} />
        <p className="text-slate-700">
          <span className="font-medium text-slate-900">{label}</span> did not sell in batch {batch}.
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          <li>The item goes back to Forfeited and stays in the vault.</li>
          <li>Batch {batch} keeps the record: its reserve, that it was not sold, who marked it and why.</li>
          <li>It can be put in a later batch. No money is recorded.</li>
        </ul>
        <TextareaField label="Why was it not sold?" name="reason" rows={2} required maxLength={300} placeholder="e.g. No bids reached the reserve price" />
        <div className="flex justify-end border-t border-slate-200 pt-3">
          <SubmitButton
            pendingLabel="Saving"
            confirm={{ title: "Mark this item as not sold?", message: `${label} goes back to Forfeited. This can't be undone from the app.`, confirmLabel: "Mark unsold", tone: "primary" }}
          >
            Mark unsold
          </SubmitButton>
        </div>
      </ActionForm>
    </PopupButton>
  );
}
