"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, Field, SubmitButton } from "@/components/form";
import { buttonClasses } from "@/components/ui";
import { formatDate, formatPeso } from "@/lib/format";
import { recordPayment, processExtension, redeemLoan } from "../actions";

function LostTicketFields() {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <CheckboxField
        name="lost_ticket"
        label="Customer lost their physical ticket"
        hint="Verify identity with the ID number on file instead."
        checked={show}
        onChange={(e) => setShow(e.target.checked)}
      />
      {show && (
        <Field
          label="Customer's ID number"
          name="id_number_confirm"
          required
          autoComplete="off"
          placeholder="Must match the ID on file"
        />
      )}
    </div>
  );
}

export function PaymentForm({
  loanId,
  interestDue,
  principalBalance,
}: {
  loanId: string;
  interestDue: number;
  principalBalance: number;
}) {
  const [amount, setAmount] = useState("");
  const total = Math.round((interestDue + principalBalance) * 100) / 100;

  return (
    <ActionForm
      action={recordPayment}
      className="space-y-3"
      resetOnSuccess
      successMessage="Payment recorded — receipt added to payment history."
      onSuccess={() => setAmount("")}
    >
      <input type="hidden" name="loan_id" value={loanId} />
      <Field
        label="Payment amount (₱)"
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        max={total}
        required
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        hint="Interest owed is settled first; any remainder reduces the principal."
      />
      <div className="flex flex-wrap gap-2">
        {interestDue > 0 && (
          <button type="button" onClick={() => setAmount(String(interestDue))} className={buttonClasses("secondary", "sm")}>
            Interest only · {formatPeso(interestDue)}
          </button>
        )}
        <button type="button" onClick={() => setAmount(String(total))} className={buttonClasses("secondary", "sm")}>
          Pay in full · {formatPeso(total)}
        </button>
      </div>
      <LostTicketFields />
      <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
    </ActionForm>
  );
}

export function ExtensionForm({
  loanId,
  collectNow,
  newInterest,
  newMaturity,
}: {
  loanId: string;
  collectNow: number;
  newInterest: number;
  newMaturity: string;
}) {
  return (
    <ActionForm action={processExtension} className="space-y-3" successMessage="Loan renewed for another term.">
      <input type="hidden" name="loan_id" value={loanId} />
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">Collect now (interest owed)</dt>
          <dd className="font-semibold tabular-nums">{formatPeso(collectNow)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">New due date</dt>
          <dd className="font-medium">{formatDate(newMaturity)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">Interest for the new term</dt>
          <dd className="tabular-nums">{formatPeso(newInterest)}</dd>
        </div>
      </dl>
      <SubmitButton
        variant="secondary"
        pendingLabel="Renewing…"
        confirm={{
          title: "Renew this loan?",
          message: `Collect ${formatPeso(collectNow)} from the customer now. The due date moves to ${formatDate(newMaturity)}.`,
          confirmLabel: "Collect & renew",
          tone: "primary",
        }}
      >
        Renew loan
      </SubmitButton>
    </ActionForm>
  );
}

export function RedeemForm({ loanId, canRedeem, owed }: { loanId: string; canRedeem: boolean; owed: number }) {
  return (
    <ActionForm action={redeemLoan} className="space-y-3" successMessage="Item redeemed and released to the customer.">
      <input type="hidden" name="loan_id" value={loanId} />
      <p className="text-sm text-slate-600">
        {canRedeem
          ? "Fully paid — release the item to the customer and close the loan."
          : `${formatPeso(owed)} must be paid before the item can be released.`}
      </p>
      {canRedeem && <LostTicketFields />}
      <SubmitButton
        variant="success"
        pendingLabel="Processing…"
        disabled={!canRedeem}
        confirm={{
          title: "Release the item?",
          message: "This closes the loan and marks the item as returned to the customer. It can't be undone.",
          confirmLabel: "Redeem & release",
          tone: "primary",
        }}
      >
        Redeem item
      </SubmitButton>
    </ActionForm>
  );
}
