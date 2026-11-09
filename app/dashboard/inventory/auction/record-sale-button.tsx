"use client"; // runs in the browser: the button, the popup and the "Saving" state

import { useRef, useState } from "react";
import { ActionForm, Field, SubmitButton, TextareaField } from "@/components/form";
import { buttonClasses } from "@/components/ui";
import { Icon } from "@/components/icons";
import { RequestIdInput } from "@/components/request-id"; // a retry never records the sale twice
import { formatPeso } from "@/lib/format";
import { recordSale, type ActionState } from "../actions";

// #43 + UC16: "Record sale" for an item queued for auction. A popup asks for the sale price (required), the buyer
// and a note (optional). The popup is the confirm step. Saving marks the item Sold and adds the money to the ledger.
export function RecordSaleButton({
  itemId, // the vault item
  label, // e.g. "Ring, 18K, 2 g"
  ticket, // the forfeited loan's ticket
  minPrice, // the batch's minimum price, if one was set
  value, // the appraised value, as a guide
}: {
  itemId: string;
  label: string;
  ticket: string;
  minPrice: number | null;
  value: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false); // the form is only drawn while open, so it starts empty
  const titleId = `sale-title-${itemId}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          ref.current?.showModal();
          setOpen(true);
        }}
        className={buttonClasses("secondary", "sm") + " whitespace-nowrap"}
      >
        Record sale
      </button>

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-slate-200 p-0 text-left shadow-2xl backdrop:bg-navy-950/50"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              Record sale
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {label} · {ticket}
            </p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>

        {open && (
          <ActionForm<ActionState>
            action={recordSale}
            className="space-y-4 px-5 py-5"
            successMessage={`Sale recorded for ${label} (${ticket}).`}
            onSuccess={() => ref.current?.close()}
          >
            <input type="hidden" name="item_id" value={itemId} />
            <RequestIdInput />
            {/* the minimum and the appraised value, so the price is checked before saving */}
            <dl className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Minimum price</dt>
                <dd className="font-medium tabular-nums">{minPrice ? formatPeso(minPrice) : "None set"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Appraised value</dt>
                <dd className="font-medium tabular-nums">{formatPeso(value)}</dd>
              </div>
            </dl>
            <Field
              label="Sale price (₱)"
              name="sale_price"
              inputMode="decimal"
              required
              autoFocus
              placeholder={minPrice ? `At least ${minPrice}` : "e.g. 15000"}
              hint="The amount the buyer paid. It is added to the cash ledger as revenue."
            />
            <Field label="Buyer (optional)" name="buyer_name" maxLength={120} placeholder="Name or company" />
            <TextareaField label="Note (optional)" name="sale_notes" rows={2} maxLength={500} placeholder="e.g. Sold at the November auction, lot 4" />
            <p className="text-xs text-slate-600">Saving marks the item Sold. This can&apos;t be undone from the app.</p>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => ref.current?.close()} className={buttonClasses("secondary")}>
                Cancel
              </button>
              <SubmitButton pendingLabel="Saving">Save sale</SubmitButton>
            </div>
          </ActionForm>
        )}
      </dialog>
    </>
  );
}
