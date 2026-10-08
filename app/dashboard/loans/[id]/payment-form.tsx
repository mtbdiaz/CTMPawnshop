"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, Field, SubmitButton, TextareaField } from "@/components/form";
import { buttonClasses } from "@/components/ui";
import { formatDate, formatPeso } from "@/lib/format";
import { recordPayment, processExtension, redeemLoan, capitalizeLoan, reinstateLoan, forfeitLoan, adminEditLoan, adminEditPayment } from "../actions";

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
      successMessage="Payment recorded. The receipt is in the payment history."
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
      <SubmitButton
        pendingLabel="Recording"
        disabled={!(Number(amount) > 0)}
        confirm={{
          title: "Record this payment?",
          message: "Count the cash before you confirm.",
          confirmLabel: "Record payment",
          tone: "primary",
          locked: true,
          details: [
            ["Amount", formatPeso(Number(amount))],
            ["To interest", formatPeso(Math.min(Number(amount) || 0, interestDue))],
            ["To principal", formatPeso(Math.max(0, (Number(amount) || 0) - interestDue))],
          ],
        }}
      >
        Record payment
      </SubmitButton>
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
        pendingLabel="Renewing"
        confirm={{
          title: "Renew this loan?",
          message: `Collect ${formatPeso(collectNow)} from the customer now. The due date moves to ${formatDate(newMaturity)}.`,
          confirmLabel: "Collect and renew",
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
          ? "Fully paid. Release the item to the customer and close the loan."
          : `${formatPeso(owed)} must be paid before the item can be released.`}
      </p>
      {canRedeem && <LostTicketFields />}
      <SubmitButton
        variant="success"
        pendingLabel="Processing"
        disabled={!canRedeem}
        confirm={{
          title: "Release the item?",
          message: "This closes the loan and marks the item as returned to the customer. It can't be undone.",
          confirmLabel: "Redeem and release",
          tone: "primary",
        }}
      >
        Redeem item
      </SubmitButton>
    </ActionForm>
  );
}

function Summary({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <dt className="text-slate-600">{k}</dt>
          <dd className="tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Item 8: add unpaid interest to principal and extend one term. No cash changes hands. */
export function CapitalizeForm({
  loanId,
  capitalized,
  newPrincipal,
  newMaturity,
  newInterest,
}: {
  loanId: string;
  capitalized: number;
  newPrincipal: number;
  newMaturity: string;
  newInterest: number;
}) {
  const rows: [string, string][] = [
    ["Interest added to principal", formatPeso(capitalized)],
    ["New principal", formatPeso(newPrincipal)],
    ["New due date", formatDate(newMaturity)],
    ["Interest for the new term", formatPeso(newInterest)],
  ];
  return (
    <ActionForm action={capitalizeLoan} className="space-y-3" successMessage="Interest capitalized and loan extended.">
      <input type="hidden" name="loan_id" value={loanId} />
      <Summary rows={rows} />
      <SubmitButton
        variant="secondary"
        pendingLabel="Capitalizing"
        disabled={capitalized <= 0}
        confirm={{
          title: "Capitalize and extend?",
          message: "No cash is collected. The unpaid interest becomes part of the principal. This counts as a renewal.",
          confirmLabel: "Capitalize",
          tone: "primary",
          locked: true,
          details: rows,
        }}
      >
        Capitalize and extend
      </SubmitButton>
    </ActionForm>
  );
}

/** Item 7: give a defaulted loan another chance. */
export function ReinstateForm({ loanId, interestOwed }: { loanId: string; interestOwed: number }) {
  const rows: [string, string][] = [
    ["Interest owed (through default)", formatPeso(interestOwed)],
    ["Due date", "Unchanged. Renew or capitalize to extend it."],
  ];
  return (
    <ActionForm action={reinstateLoan} className="space-y-3" successMessage="Loan reinstated.">
      <input type="hidden" name="loan_id" value={loanId} />
      <p className="text-sm text-slate-600">Interest kept accruing while the loan was in default. The item stays in the vault and is taken off the forfeiture list.</p>
      <Summary rows={rows} />
      <SubmitButton
        pendingLabel="Reinstating"
        confirm={{ title: "Reinstate this loan?", message: "The loan reopens with the status Reinstated.", confirmLabel: "Reinstate", tone: "primary", locked: true, details: rows }}
      >
        Reinstate loan
      </SubmitButton>
    </ActionForm>
  );
}

export function ForfeitForm({ loanId }: { loanId: string }) {
  return (
    <ActionForm action={forfeitLoan} className="space-y-3" successMessage="Loan forfeited.">
      <input type="hidden" name="loan_id" value={loanId} />
      <p className="text-sm text-slate-600">Confirms the default as final. The item becomes shop property and can go to auction.</p>
      <SubmitButton
        variant="danger"
        pendingLabel="Forfeiting"
        confirm={{ title: "Forfeit this loan?", message: "The customer can no longer reinstate or redeem it.", confirmLabel: "Forfeit", locked: true }}
      >
        Forfeit item
      </SubmitButton>
    </ActionForm>
  );
}

/** Item 5: Admin correction. A written reason is required and audited. */
export function AdminEditLoanForm({
  loanId,
  principal,
  rate,
  maturity,
}: {
  loanId: string;
  principal: number;
  rate: number;
  maturity: string;
}) {
  return (
    <ActionForm action={adminEditLoan} className="space-y-3" successMessage="Loan corrected. The change is in the audit trail.">
      <input type="hidden" name="loan_id" value={loanId} />
      <Field label="Principal (₱)" name="principal_amount" type="number" step="0.01" min="0.01" defaultValue={principal} required />
      <Field label="Interest rate (%)" name="interest_rate_percent" type="number" step="0.01" min="0" defaultValue={rate} required />
      <Field label="Due date" name="maturity_date" type="date" defaultValue={maturity} required />
      <TextareaField label="Reason for the change" name="reason" rows={2} required hint="At least 5 characters. Saved in the audit trail." />
      <SubmitButton variant="secondary" pendingLabel="Saving" confirm={{ title: "Save this correction?", message: "The before and after values and your reason are written to the audit trail.", confirmLabel: "Save correction", tone: "primary" }}>
        Edit (Admin)
      </SubmitButton>
    </ActionForm>
  );
}

export function AdminEditPaymentForm({ paymentId, loanId, amount }: { paymentId: string; loanId: string; amount: number }) {
  return (
    <ActionForm action={adminEditPayment} className="space-y-2" successMessage="Payment corrected.">
      <input type="hidden" name="payment_id" value={paymentId} />
      <input type="hidden" name="loan_id" value={loanId} />
      <Field label="Amount (₱)" name="amount" type="number" step="0.01" min="0.01" defaultValue={amount} required />
      <TextareaField label="Reason" name="reason" rows={2} required />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving" confirm={{ title: "Correct this payment?", message: "The ledger entry is corrected to match, and the change is audited.", confirmLabel: "Save correction", tone: "primary" }}>
        Save correction
      </SubmitButton>
    </ActionForm>
  );
}
