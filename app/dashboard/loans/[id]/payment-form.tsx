"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, Field, SubmitButton, TextareaField } from "@/components/form";
import { buttonClasses } from "@/components/ui";
import { formatDate, formatPeso } from "@/lib/format";
import { splitPayment, termInterest } from "@/lib/loans/accrual"; // AR1: one term of interest on what is left; LD: the payment order
import { RequestIdInput } from "@/components/request-id"; // #31 one-time id so a retry never saves twice
import { type ActionState, recordPayment, processExtension, redeemLoan, capitalizeLoan, reinstateLoan, forfeitLoan, adminEditLoan, adminEditPayment } from "../actions";

function LostTicketFields() {
  const [show, setShow] = useState(false);
  return (
    // F4: rounded-md (6px corners)
    <div className="space-y-2 rounded-md bg-slate-50 p-3">     
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
  damagesDue = 0,
  renewOnClear,
}: {
  loanId: string;
  interestDue: number;
  principalBalance: number;
  damagesDue?: number; // LD (0073): liquidated damages owed today (after the grace days), paid before interest
  // AR1 (Matt, 0043): the loan is past its due date and can still be renewed. A payment that clears all the interest
  // renews it by itself (record_payment), to this due date, with one term of interest billed for the new term
  renewOnClear?: { newMaturity: string; ratePercent: number } | null;
}) {
  const [amount, setAmount] = useState("");
  const [round, setRound] = useState(0); // #31: +1 after each saved payment, so the next payment gets a new id
  const [lastReceipt, setLastReceipt] = useState<{ id: string; number: string; renewedTo?: string } | null>(null); // S1: the payment just saved (AR1: and the new due date if it renewed the loan)
  const total = Math.round((damagesDue + interestDue + principalBalance) * 100) / 100;
  // L17: what this payment does, with the database's own rule (record_payment). LD (0073): liquidated damages are paid
  // first, then interest, then principal. interestDue / damagesDue already include what was added after the due date
  // and after the grace days, as the database works out first.
  const paid = Math.min(Math.max(Number(amount) || 0, 0), total); // the payment, never more than what is owed
  const split = splitPayment(paid, { damages: damagesDue, interest: interestDue, principal: principalBalance });
  const toDamages = split.damages;
  const toInterest = split.interest;
  const toPrincipal = split.principal;
  const damagesLeft = Math.round((damagesDue - toDamages) * 100) / 100;
  const interestLeft = Math.round((interestDue - toInterest) * 100) / 100;
  const principalLeft = Math.round((principalBalance - toPrincipal) * 100) / 100;
  const charges = Math.round((damagesDue + interestDue) * 100) / 100; // LD: everything paid before principal
  // AR1: this payment renews the loan (same rule as the database: overdue, all interest (LD: and damages) paid, principal still owed)
  const willRenew = Boolean(renewOnClear) && paid > 0 && interestLeft === 0 && damagesLeft === 0 && principalLeft > 0;
  const newTermInterest = willRenew ? termInterest(principalLeft, renewOnClear!.ratePercent) : 0; // billed for the new term

  return (
    <ActionForm
      action={recordPayment}
      className="space-y-3"
      resetOnSuccess
      successMessage={(s: ActionState) =>
        s.renewedTo
          ? `Payment recorded. The interest is paid, so the loan is renewed: new due date ${formatDate(s.renewedTo)}.` // AR1
          : "Payment recorded. The receipt is in the payment history."
      }
      onSuccess={(state: ActionState) => {
        setAmount("");
        setRound((r) => r + 1);
        // S1: remember the new payment, to offer its receipt right here
        setLastReceipt(state.paymentId ? { id: state.paymentId, number: state.receiptNumber ?? "", renewedTo: state.renewedTo } : null);
      }}
    >
      {/* S1: straight to the receipt after a payment, instead of looking for it in the payment history */}
      {lastReceipt && (
        <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span>
            Payment recorded{lastReceipt.number ? ` · ${lastReceipt.number}` : ""}
            {/* AR1: say that it also renewed the loan */}
            {lastReceipt.renewedTo && <span className="block">Loan renewed. New due date {formatDate(lastReceipt.renewedTo)}.</span>}
          </span>
          <a href={`/print/receipt/${lastReceipt.id}`} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "sm")}>
            Print receipt
          </a>
        </p>
      )}
      <input type="hidden" name="loan_id" value={loanId} />
      <RequestIdInput key={round} />
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
        hint={
          damagesDue > 0
            ? "Liquidated damages are settled first, then interest; any remainder reduces the principal."
            : "Interest owed is settled first; any remainder reduces the principal."
        }
      />
      <div className="flex flex-wrap gap-2">
        {/* LD: with liquidated damages owed, the quick button pays the damages and the interest (they are paid first) */}
        {/* PR1 (Nov 14, page check): on an overdue loan that can still be renewed, this amount also renews it (ctm_auto_renew:
            all interest and damages paid, some principal still owed), so the button says "& renew". Before: "Interest only"
            even when it renewed the loan. Not overdue (or past the grace days): "Interest only" / "Damages and interest" as before. */}
        {charges > 0 && (
          <button type="button" onClick={() => setAmount(String(charges))} className={buttonClasses("secondary", "sm")}>
            {renewOnClear && principalBalance > 0
              ? damagesDue > 0
                ? "Damages, interest & renew"
                : "Interest & renew"
              : damagesDue > 0
                ? "Damages and interest"
                : "Interest only"}{" "}
            · {formatPeso(charges)}
          </button>
        )}
        <button type="button" onClick={() => setAmount(String(total))} className={buttonClasses("secondary", "sm")}>
          Pay in full · {formatPeso(total)}
        </button>
      </div>
      {/* AR1: before saving, say that this payment also renews the overdue loan, and what that means.
          PR2 (Nov 14, page check): a title line and the amount being collected. It follows the typed amount (willRenew is the
          database's own rule), not only the quick button. Before: one sentence without the amount. */}
      {willRenew && (
        <div role="status" className="rounded-md border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-900">
          <p className="font-semibold">This payment will renew the loan</p>
          <p className="mt-0.5">
            The {formatPeso(paid)} payment pays all the {damagesDue > 0 ? "liquidated damages and interest" : "interest"}
            {toPrincipal > 0 ? ` and ${formatPeso(toPrincipal)} of the principal` : ""}. New due date {formatDate(renewOnClear!.newMaturity)}. Interest
            for the new term ({formatPeso(newTermInterest)}) is added, the same as Renew.
          </p>
        </div>
      )}
      {/* AR1: an overdue loan with interest still unpaid after this payment stays overdue */}
      {renewOnClear && paid > 0 && (interestLeft > 0 || damagesLeft > 0) && (
        <p className="text-xs text-slate-600">
          Pay at least {formatPeso(charges)} (all the {damagesDue > 0 ? "liquidated damages and interest" : "interest"}) to also renew the loan to{" "}
          {formatDate(renewOnClear.newMaturity)}.
        </p>
      )}
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
          // L17: the full effect before confirming (your saved to-do: interest and principal left after)
          details: [
            ["Owed now", formatPeso(total)],
            ["Payment", formatPeso(paid)],
            // LD: the damages lines only when the loan owes liquidated damages
            ...(damagesDue > 0 ? ([["To liquidated damages", formatPeso(toDamages)]] as [string, string][]) : []),
            ["To interest", formatPeso(toInterest)],
            ["To principal", formatPeso(toPrincipal)],
            ...(damagesDue > 0 ? ([["Damages left after", formatPeso(damagesLeft)]] as [string, string][]) : []),
            ["Interest left after", formatPeso(interestLeft)],
            ["Principal left after", formatPeso(principalLeft)],
            // AR1: when the payment renews the loan, the new term's interest is added and the due date moves
            ...(willRenew
              ? ([
                  ["Renews the loan", `Yes, new due date ${formatDate(renewOnClear!.newMaturity)}`],
                  ["New term interest", formatPeso(newTermInterest)],
                  ["Total to redeem after", formatPeso(Math.round((principalLeft + newTermInterest) * 100) / 100)],
                ] as [string, string][])
              : ([["Total left after", formatPeso(Math.round((damagesLeft + interestLeft + principalLeft) * 100) / 100)]] as [string, string][])),
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
  currentMaturity,
  collectNow,
  collectDamages = 0,
  newInterest,
  newMaturity,
}: {
  loanId: string;
  currentMaturity: string; // #31 the due date on this page; the database refuses if it changed (renewed in another tab)
  collectNow: number;
  collectDamages?: number; // LD (0073): the liquidated damages part of collectNow (a reinstated loan past its grace days)
  newInterest: number;
  newMaturity: string;
}) {
  return (
    <ActionForm action={processExtension} className="space-y-3" successMessage="Loan renewed for another term.">
      <input type="hidden" name="loan_id" value={loanId} />
      <input type="hidden" name="expected_maturity" value={currentMaturity} />
      {/* a new id for each due date: after a renewal the page shows the new date, so the next renewal is a new request */}
      <RequestIdInput key={currentMaturity} />
      <dl className="space-y-1.5 text-sm">
        {/* LD: with liquidated damages, the two parts first, then the total */}
        {collectDamages > 0 && (
          <>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Interest owed</dt>
              <dd className="tabular-nums">{formatPeso(Math.round((collectNow - collectDamages) * 100) / 100)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Liquidated damages</dt>
              <dd className="tabular-nums">{formatPeso(collectDamages)}</dd>
            </div>
          </>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-slate-600">{collectDamages > 0 ? "Collect now (total)" : "Collect now (interest owed)"}</dt>
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
  currentMaturity,
  capitalized,
  newPrincipal,
  newMaturity,
  newInterest,
}: {
  loanId: string;
  currentMaturity: string; // #31 same as Renew
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
      <input type="hidden" name="expected_maturity" value={currentMaturity} />
      <RequestIdInput key={currentMaturity} />
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
// RW1 (Nov 14): reinstating keeps the old due date, and the nightly default check (12:05 AM) also checks Reinstated
// loans, so a reinstated loan that still owes money is Defaulted again that night unless it is renewed or paid in full
// first (checked with rolled-back tests on a real Defaulted loan: reinstate only -> Defaulted again; renew right after,
// or a payment of all the interest and damages -> renewed, stays open; less than that -> Defaulted again; paid in full
// -> stays open with ₱0). Capitalize is refused after the grace period, so it isn't offered.
// RW6: the payment wording follows ctm_auto_renew exactly: it renews only when all interest and damages are paid AND some
// principal is still owed, so "₱X or more, but less than the full amount". The amounts are worked out when the page loads
// (renewPreview / owedNow, the same math as renew_loan and owed_now); the Renew and Record payment forms work them out again
// after reinstating. Only the loan id is sent: the database checks the loan is still Defaulted and its item isn't queued
// for auction, so an old page can't reinstate the wrong thing.
// Before: the form only said "Due date: Unchanged. Renew or capitalize to extend it." and nothing about tonight's check.
export function ReinstateForm({
  loanId,
  interestOwed,
  damagesOwed = 0,
  dueDate,
  graceEnd,
  principalLeft,
  renewDue,
  owedTotal,
}: {
  loanId: string;
  interestOwed: number;
  damagesOwed?: number;
  dueDate: string; // the loan's own due date (it doesn't change)
  graceEnd: string; // due date + the loan's own grace days
  principalLeft: number;
  renewDue: string; // the new due date a renewal right after reinstating would give (renewPreview, same as renew_loan)
  owedTotal: number; // principal + interest + damages today
}) {
  const charges = Math.round((interestOwed + damagesOwed) * 100) / 100; // what Renew collects (interest + damages)
  const canRenew = principalLeft > 0 && charges > 0; // nothing to renew when only interest or damages are left
  const rows: [string, string][] = [
    ["Interest owed now", formatPeso(interestOwed)],
    // LD (0073): the liquidated damages since the grace days ended stay owed after reinstating
    ...(damagesOwed > 0 ? ([["Liquidated damages owed", formatPeso(damagesOwed)]] as [string, string][]) : []),
    ["Due date", `${formatDate(dueDate)} (not changed)`],
    ["Grace period ended", formatDate(graceEnd)],
    ["To keep it open today", canRenew ? `Renew (${formatPeso(charges)}) or pay in full (${formatPeso(owedTotal)})` : `Pay in full (${formatPeso(owedTotal)})`],
  ];
  return (
    <ActionForm action={reinstateLoan} className="space-y-3" successMessage="Loan reinstated. Renew it or have it paid in full today.">
      <input type="hidden" name="loan_id" value={loanId} />
      <p className="text-sm text-slate-600">
        Interest{damagesOwed > 0 ? " and liquidated damages" : ""} kept accruing while the loan was in default. The item stays in the vault and is taken
        off the forfeiture list.
      </p>
      {/* RW1: the warning comes before the button, so it is read before anyone confirms */}
      <div role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
        <p className="font-semibold">Reinstating does not extend the due date</p>
        <p className="mt-1">
          The due date stays {formatDate(dueDate)} and the grace period ended {formatDate(graceEnd)}. If the loan still owes money at the next automatic
          default check (every night at 12:05 AM, or sooner if an Admin runs Check for defaults), it is marked Defaulted again.
        </p>
        <p className="mt-1.5 font-medium">To keep it open, before the customer leaves:</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
          {canRenew && (
            <li>
              Renew it: collect {formatPeso(charges)} ({damagesOwed > 0 ? `${formatPeso(interestOwed)} interest + ${formatPeso(damagesOwed)} liquidated damages` : "the interest"}).
              New due date {formatDate(renewDue)}. Recording a payment of {formatPeso(charges)} or more, but less than the full amount, renews it too.
            </li>
          )}
          <li>Or have it paid in full ({formatPeso(owedTotal)}), then redeem the item.</li>
        </ul>
        {canRenew && <p className="mt-1.5">A smaller payment does not stop the default.</p>}
      </div>
      <Summary rows={rows} />
      <SubmitButton
        pendingLabel="Reinstating"
        confirm={{
          title: "Reinstate this loan?",
          message: `The loan reopens with the status Reinstated. The due date stays ${formatDate(dueDate)}, so unless it is ${canRenew ? "renewed or " : ""}paid in full before the next automatic check (12:05 AM), it is marked Defaulted again.`,
          confirmLabel: "Reinstate",
          tone: "primary",
          locked: true,
          details: rows,
        }}
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
      {/* L19: says what it does (was "Edit (Admin)") */}
      <SubmitButton variant="secondary" pendingLabel="Saving" confirm={{ title: "Save this correction?", message: "The before and after values and your reason are written to the audit trail.", confirmLabel: "Save correction", tone: "primary" }}>
        Save correction
      </SubmitButton>
    </ActionForm>
  );
}

/** L19: Admin correction of one payment, picked from a list (it used to open inside the payments table row). */
export function AdminCorrectPaymentForm({
  loanId,
  payments,
}: {
  loanId: string;
  payments: { id: string; receipt: string; amount: number; date: string }[];
}) {
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? ""); // the payment being corrected
  const picked = payments.find((p) => p.id === paymentId);
  return (
    <ActionForm key={paymentId} action={adminEditPayment} className="space-y-3" successMessage="Payment corrected. The ledger and audit trail are updated.">
      <input type="hidden" name="loan_id" value={loanId} />
      <div>
        <label htmlFor="correct-payment" className="block text-sm font-medium text-slate-700">
          Payment
        </label>
        <select
          id="correct-payment"
          name="payment_id"
          value={paymentId}
          onChange={(e) => setPaymentId(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
        >
          {payments.map((p) => (
            <option key={p.id} value={p.id}>
              {p.receipt} · {formatPeso(p.amount)} · {p.date}
            </option>
          ))}
        </select>
      </div>
      <Field label="Correct amount (₱)" name="amount" type="number" step="0.01" min="0.01" defaultValue={picked?.amount} required />
      <TextareaField label="Reason for the change" name="reason" rows={2} required hint="At least 5 characters. Saved in the audit trail." />
      <SubmitButton variant="secondary" pendingLabel="Saving" confirm={{ title: "Correct this payment?", message: "The ledger entry is corrected to match, and the change is audited.", confirmLabel: "Save correction", tone: "primary" }}>
        Save correction
      </SubmitButton>
    </ActionForm>
  );
}
