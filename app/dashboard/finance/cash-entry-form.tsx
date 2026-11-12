"use client"; // runs in the browser: the popup, what is typed, the review box

import { useState } from "react";
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from "@/components/form";
import { PopupButton } from "@/components/popup-button"; // a button that opens a small popup on the same page
import { RequestIdInput } from "@/components/request-id"; // the same Save sent twice = one entry
import { formatPeso } from "@/lib/format";
import { adminEditCashEntry, recordCashEntry, type ActionState } from "./actions";

// a typed amount ("1,500.50") -> a number, or null when it is not a valid peso amount (the server checks again)
function typedAmount(raw: string): number | null {
  const s = raw.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 10_000_000 ? n : null;
}

// PB-29 + CL1 (Nov 12): "+ Record cash entry".
// Before: the form was always open at the top of the page and saved on one click.
// Now: it opens in a popup, and before saving a box repeats what will be recorded (money in or out, the amount,
// the description, who records it). An entry can't be edited by staff after saving, so it is checked first.
// locked (LK1, migration 0058): a saved entry can't be corrected or archived by anyone right now, so the popup says
// so before saving.
export function RecordCashEntryButton({ recordedBy, locked }: { recordedBy: string; locked: boolean }) {
  const [type, setType] = useState("expense");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [formKey, setFormKey] = useState(0); // changes after a save, so the next entry gets a new request id
  const n = typedAmount(amount);
  const ready = n !== null && description.trim().length >= 3;
  const out = type === "expense"; // an expense takes money out; revenue brings money in

  return (
    <PopupButton primary label="+ Record cash entry" title="Record cash entry">
      <ActionForm<ActionState>
        key={formKey}
        action={recordCashEntry}
        className="space-y-3 text-sm"
        successMessage={`${out ? "Expense" : "Revenue"} of ${n !== null ? formatPeso(n) : ""} added to the ledger.`}
        onSuccess={() => {
          // start clean for the next entry
          setAmount("");
          setDescription("");
          setType("expense");
          setFormKey((k) => k + 1);
        }}
      >
        <RequestIdInput />
        <p className="text-slate-600">For money that is not part of a loan: rent, bills, supplies, other income. Loans, payments and auction sales are recorded by the system.</p>
        <SelectField label="Type" name="entry_type" value={type} onChange={(e) => setType(e.target.value)} required>
          <option value="expense">Expense (cash out)</option>
          <option value="revenue">Revenue (cash in)</option>
        </SelectField>
        <Field
          label="Amount (₱)"
          name="amount"
          inputMode="decimal"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          // only once something is typed, so an empty box is not an error yet
          liveError={amount.trim() && n === null ? "Enter an amount in pesos, like 1500 or 1500.50 (more than 0)." : null}
          placeholder="e.g. 1500.50"
        />
        <TextareaField
          label="Description"
          name="description"
          rows={2}
          required
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Electricity bill, October"
          hint="What the money was for."
        />
        {locked && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Check carefully before saving. A saved entry can&apos;t be corrected or removed in the app right now (corrections are switched off until a reversal workflow is
            approved).
          </p>
        )}
        <div className="flex justify-end border-t border-slate-200 pt-3">
          <SubmitButton
            pendingLabel="Saving"
            disabled={!ready}
            confirm={{
              title: "Check the entry before saving",
              message: locked
                ? "This adds a permanent entry to the cash ledger. It can't be corrected or removed in the app right now, so check the amount and the type carefully."
                : "This adds a permanent entry to the cash ledger. Only an Admin can correct it afterwards, with a written reason.",
              confirmLabel: out ? "Record expense" : "Record revenue", // CL2: the button says exactly what it will record
              tone: "primary",
              details: [
                ["Entry", out ? "Cash out · Expense" : "Cash in · Revenue"], // CL2: the direction and the type first, in one line
                ["Amount", n !== null ? `${out ? "−" : "+"}${formatPeso(n)}` : ""],
                ["Description", description.trim()],
                ["Recorded by", recordedBy],
                ["Date", "Now (the time of saving)"],
              ],
            }}
          >
            Review entry
          </SubmitButton>
        </div>
      </ActionForm>
    </PopupButton>
  );
}

export function AdminEditCashEntryForm({ id, amount, description }: { id: string; amount: number; description: string }) {
  return (
    <ActionForm action={adminEditCashEntry} className="space-y-2" successMessage="Entry corrected.">
      <input type="hidden" name="entry_id" value={id} />
      <Field label="Amount (₱)" name="amount" type="number" step="0.01" min="0.01" defaultValue={amount} required />
      <Field label="Description" name="description" defaultValue={description} required />
      <TextareaField label="Reason" name="reason" rows={2} required />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving" confirm={{ title: "Correct this entry?", message: "The change and your reason go to the audit trail.", confirmLabel: "Save correction", tone: "primary" }}>
        Save correction
      </SubmitButton>
    </ActionForm>
  );
}
