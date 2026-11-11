"use client"; // runs in the browser: the button, the popup and the "Saving" state

import { useState } from "react";
import { ActionForm, Field, SubmitButton, TextareaField, useFieldError } from "@/components/form";
import { PopupButton } from "@/components/popup-button";
import { RequestIdInput } from "@/components/request-id"; // a retry never records the sale twice
import { formatDate, formatPeso } from "@/lib/format";
import { appraisedText, parsePeso } from "@/lib/inventory/auction";
import { recordSale, type ActionState } from "../actions";

// #43 + UC16 + AP1 (migration 0052): "Record sale" for an item queued for auction.
// Still one step, as Matt built it: saving marks the item Sold and adds the money to the cash ledger.
// New: the popup shows exactly which item and batch, the buyer's name is required, the person ticks that the
// payment was received in full and the item was handed over, and a last "check before saving" box repeats the numbers.
export function RecordSaleButton({
  itemId, // the vault item
  label, // e.g. "Ring, 18K, 2 g"
  refNo, // e.g. "A-0045"
  ticket, // the forfeited loan's ticket
  batch, // e.g. "AB-0007"
  auctionDate, // the batch's auction date, when one was set
  minPrice, // the reserve price, or null when "No reserve" was chosen
  value, // the appraised value, as a guide
}: {
  itemId: string;
  label: string;
  refNo: string;
  ticket: string;
  batch: string;
  auctionDate: string | null;
  minPrice: number | null;
  value: number | null;
}) {
  const [price, setPrice] = useState(""); // what is typed, to check it against the reserve while typing
  const [buyer, setBuyer] = useState("");
  const [paid, setPaid] = useState(false); // tick 1: the payment was received in full
  const [handed, setHanded] = useState(false); // tick 2: the item was handed to the buyer
  const n = parsePeso(price);
  const below = n !== null && minPrice != null && n < minPrice; // the database refuses this too
  const ready = n !== null && !below && buyer.trim().length >= 2 && paid && handed;

  return (
    <PopupButton label="Record sale" title="Record sale" className="font-medium text-navy-800">
      <ActionForm<ActionState> action={recordSale} className="space-y-3 text-sm" successMessage={`Sale recorded for ${label} (${ticket}).`}>
        <input type="hidden" name="item_id" value={itemId} />
        <RequestIdInput />
        {/* which item, so the sale is never recorded on the wrong one */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-slate-50 px-3 py-2">
          <div className="col-span-2">
            <dt className="text-xs text-slate-500">Item</dt>
            <dd className="font-medium text-slate-900">
              {label}
              {refNo && <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-mono text-xs ring-1 ring-slate-200">{refNo}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Pawn ticket</dt>
            <dd className="break-all">{ticket || "No loan"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Auction batch</dt>
            <dd>
              {batch}
              {auctionDate ? ` · auction ${formatDate(auctionDate)}` : " · auction date not set"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Reserve price</dt>
            <dd className="font-medium tabular-nums">{minPrice != null ? formatPeso(minPrice) : "No reserve"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Appraised value (guide)</dt>
            <dd className="tabular-nums">{appraisedText(value)}</dd>
          </div>
        </dl>
        <Field
          label="Sale price (₱)"
          name="sale_price"
          inputMode="decimal"
          required
          autoFocus
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          liveError={below ? `Below the reserve price (${formatPeso(minPrice as number)}).` : null}
          placeholder={minPrice != null ? `At least ${minPrice}` : "e.g. 15000"}
          hint="The amount the buyer paid. It is added to the cash ledger as revenue."
        />
        <Field label="Buyer's name" name="buyer_name" required maxLength={120} value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Name or company" />
        <TextareaField label="Note (optional)" name="sale_notes" rows={2} maxLength={500} placeholder="e.g. Sold at the November auction, lot 4" />
        <ConfirmTicks paid={paid} handed={handed} onPaid={setPaid} onHanded={setHanded} />
        <p className="text-xs text-slate-600">
          Saving marks the item Sold (it has left the shop), records who saved it and when, and adds the money to the cash ledger. If the buyer has not paid in full or
          has not taken the item yet, don&apos;t record the sale yet. It can&apos;t be undone from the app.
        </p>
        <div className="flex justify-end border-t border-slate-200 pt-3">
          <SubmitButton
            pendingLabel="Saving"
            disabled={!ready}
            confirm={{
              title: "Check the sale before saving",
              message: "Saving marks the item Sold and adds this amount to the cash ledger. It can't be undone from the app.",
              confirmLabel: "Save sale",
              tone: "primary",
              details: [
                ["Item", `${label}${refNo ? ` · ${refNo}` : ""}`],
                ["Pawn ticket", ticket || "No loan"],
                ["Batch", batch],
                ["Reserve price", minPrice != null ? formatPeso(minPrice) : "No reserve"],
                ["Sale price", n !== null ? formatPeso(n) : ""],
                ["Buyer", buyer.trim()],
                ["Payment received in full", paid ? "Yes" : "No"],
                ["Item handed to the buyer", handed ? "Yes" : "No"],
              ],
            }}
          >
            Review sale
          </SubmitButton>
        </div>
      </ActionForm>
    </PopupButton>
  );
}

// SR1: the two confirmation ticks, with their error line (inside the form, so it can read the form's errors).
// Before: one tick said both "payment received" and "item handed over". They are two different events, so each has its
// own tick. Both are needed to save: this system has no "paid, not released yet" state, so a sale is only recorded
// when both really happened.
function ConfirmTicks({ paid, handed, onPaid, onHanded }: { paid: boolean; handed: boolean; onPaid: (v: boolean) => void; onHanded: (v: boolean) => void }) {
  const error = useFieldError("confirm");
  const box = "mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500";
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-slate-800">Confirm both before saving</legend>
      <label className="flex items-start gap-2 text-slate-800">
        <input type="checkbox" name="confirm_payment" checked={paid} onChange={(e) => onPaid(e.target.checked)} className={box} />
        <span>The payment was received in full.</span>
      </label>
      <label className="flex items-start gap-2 text-slate-800">
        <input type="checkbox" name="confirm_handover" checked={handed} onChange={(e) => onHanded(e.target.checked)} className={box} />
        <span>The item was handed to the buyer.</span>
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
