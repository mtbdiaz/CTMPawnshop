import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { accruedInterest, capitalizePreview, renewPreview, TERM_DAYS } from "@/lib/loans/accrual";
import { isOverdueUnpaid } from "@/lib/loans/status"; // F3: shared overdue rule
import { pastGracePeriod, renewBlocked, renewGraceEnd, situationBadge, stateBadge } from "@/lib/loans/display"; // L3/L4: the same badges as the Loans list; L24: renew grace rule
import { Icon } from "@/components/icons";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { formatDate, formatDateTime, formatPeso, manilaToday } from "@/lib/format";
import type { ReactNode } from "react";
import {
  ActionsCell,
  Alert,
  Badge,
  ButtonLink,
  Card,
  DetailGrid,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  ViewButton,
} from "@/components/ui";
import { ArchiveForm } from "@/components/archive-controls";
import {
  AdminEditLoanForm,
  AdminCorrectPaymentForm,
  CapitalizeForm,
  ExtensionForm,
  ForfeitForm,
  PaymentForm,
  RedeemForm,
  ReinstateForm,
} from "./payment-form";

const OPEN = new Set(["active", "extended", "reinstated"]);

// L14: the browser tab shows the ticket number (never customer details)
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["cashier", "operator", "appraiser", "admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("loans").select("ticket_number").eq("id", id).maybeSingle();
  return { title: data ? `${data.ticket_number} · Loan` : "Loan" }; // the layout adds " · CTM PawnTrack"
}

// the clickable row of a closed section (same look as Admin actions on the customer profile)
function ActionRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-medium text-slate-900">{title}</span>
          <span className="block text-sm text-slate-500">{hint}</span>
        </span>
        <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 px-5 py-4">{children}</div>
    </details>
  );
}

// L27: one row of the Loan actions panel.
// - available: a fold-out row (<details>). name="loan-actions" = the browser keeps only ONE row open at a time
//   (opening one closes the other). Click, Enter or Space opens it; screen readers hear expanded / collapsed.
//   The form stays on the page while closed, so a typed amount isn't lost when you peek at another action.
// - not available: a plain row with "Not available" and the reason (the same rule the database uses), so it's
//   clear why, without a form that would only fail.
type LoanAction = { key: string; title: string; hint: string; reason?: string; body?: ReactNode };
function LoanActionRow({ action, open }: { action: LoanAction; open: boolean }) {
  if (action.reason) {
    return (
      <div className="px-5 py-3">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-700">{action.title}</span>
          <Badge tone="neutral">Not available</Badge>
        </span>
        <span className="mt-0.5 block text-sm text-slate-600">{action.reason}</span>
      </div>
    );
  }
  return (
    <details name="loan-actions" open={open} className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-medium text-slate-900">{action.title}</span>
          <span className="block text-sm text-slate-600">{action.hint}</span>
        </span>
        <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 px-5 py-4">{action.body}</div>
    </details>
  );
}

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["cashier", "operator", "appraiser", "admin"]);
  const role = user.profile.role;
  const isAdmin = role === "admin";
  const { id } = await params;
  const today = manilaToday();

  const supabase = await createClient();
  const { data: loan } = await supabase
    .from("loans")
    .select("*, customers(id, full_name, contact_number), appraisal_items(id, category, category_other, weight_grams, karat, computed_value), inventory_items(vault_location, status)")
    .eq("id", id)
    .maybeSingle();
  if (!loan) notFound();

  const [{ data: payments }, { data: extensions }] = await Promise.all([
    supabase.from("loan_payments").select("*").eq("loan_id", id).is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("loan_extensions").select("*").eq("loan_id", id).order("created_at", { ascending: false }),
  ]);

  type Joined = {
    customers: { id: string; full_name: string; contact_number: string } | null;
    appraisal_items: { id: string; category: string; category_other: string | null; weight_grams: number; karat: number; computed_value: number } | null;
    inventory_items: { vault_location: string; status: string } | null;
  };
  const { customers: customer, appraisal_items: item, inventory_items: vault } = loan as unknown as Joined;

  const accrual = accruedInterest(loan, today);
  const principal = Number(loan.principal_balance);
  const interest = accrual.interestOwed;
  const owed = Math.round((principal + interest) * 100) / 100;
  const open = OPEN.has(loan.status);
  const canTransact = hasRole(role, ["cashier"]);
  const overdue = isOverdueUnpaid(loan, today); // F3: past due AND still owes money (a paid loan waiting for release isn't overdue)
  const state = stateBadge(loan.status); // L3/L4: e.g. Renewed
  const situation = situationBadge(loan, today); // L3/L4: Paid, ready to release / Overdue / Due soon
  const paidAwaitingRelease = situation?.label === "Paid, ready to release"; // L16
  const accruedFrom = loan.interest_accrued_through ?? loan.maturity_date; // L18: the date interest was last added up to
  const renew = renewPreview(loan, today);
  // L24: renew_loan refuses active/renewed loans after due date + grace days, so say so instead of showing a form that fails
  const noRenew = renewBlocked(loan, today);
  const graceEnd = renewGraceEnd(loan);
  const cap = capitalizePreview(loan, today);
  const itemLabel = item ? `${categoryLabel(item.category, item.category_other)}, ${item.karat}K, ${item.weight_grams} g` : "";

  // L27: the Loan actions panel. Same forms, numbers, confirm popups and permissions as before; only the layout changed.
  // Each "reason" is the database's own rule, so a Cashier never fills in a form the database would refuse.
  const openActions: LoanAction[] = [
    {
      key: "payment",
      title: "Record payment",
      // AR1: on an overdue loan, say that paying the interest also renews it
      hint: `${formatPeso(owed)} owed now. Interest is paid first, then principal.${today > loan.maturity_date && !noRenew && principal > 0 ? ` Paying all the interest also renews the loan to ${formatDate(renew.newMaturity)}.` : ""}`,
      reason: owed > 0 ? undefined : "Nothing is owed. Use Redeem to release the item.",
      // AR1 (0043): past the due date and still renewable -> clearing the interest renews it (same date as Renew)
      body: (
        <PaymentForm
          loanId={loan.id}
          interestDue={interest}
          principalBalance={principal}
          renewOnClear={today > loan.maturity_date && !noRenew ? { newMaturity: renew.newMaturity, ratePercent: Number(loan.interest_rate_percent) } : null}
        />
      ),
    },
    {
      key: "renew",
      title: "Renew",
      hint: `Collect ${formatPeso(renew.collectNow)} interest. New due date ${formatDate(renew.newMaturity)}.`,
      // renew_loan: "This loan is fully paid. Redeem the item instead." / "Grace period has expired." (L24)
      reason:
        principal <= 0
          ? "Fully paid. Redeem the item instead."
          : noRenew
            ? // A1: the daily check (12:05 AM, Matt #7) moves it to Defaulted, so staff no longer need to ask an Admin
              `The grace period ended on ${formatDate(graceEnd)}, so this loan can no longer be renewed. The customer can still pay the balance. If it isn't paid, tonight's automatic check (12:05 AM) moves it to Defaulted.`
            : undefined,
      body: (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Collect the interest owed and extend by {TERM_DAYS} days.</p>
          <ExtensionForm loanId={loan.id} currentMaturity={loan.maturity_date} collectNow={renew.collectNow} newInterest={renew.newInterestOwed} newMaturity={renew.newMaturity} />
        </div>
      ),
    },
    {
      key: "capitalize",
      title: "Capitalize and extend",
      hint: `Add ${formatPeso(cap.capitalized)} unpaid interest to the principal. No cash today.`,
      // capitalize_loan: "There is no unpaid interest to capitalize. Use Renew instead."
      reason: principal <= 0 ? "Fully paid. Redeem the item instead." : interest <= 0 ? "No unpaid interest to capitalize. Use Renew instead." : pastGracePeriod(loan, today) ? "The grace period is over, so this loan can no longer be capitalized." : undefined, // owner decision on Matt #30
      body: (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">For a customer who cannot pay the interest today.</p>
          <CapitalizeForm loanId={loan.id} currentMaturity={loan.maturity_date} capitalized={cap.capitalized} newPrincipal={cap.newPrincipal} newMaturity={cap.newMaturity} newInterest={cap.newInterestOwed} />
        </div>
      ),
    },
    {
      key: "redeem",
      title: "Redeem",
      hint: "Paid in full. Release the item and close the loan.",
      // redeem_loan refuses while anything is owed
      reason: owed > 0 ? `${formatPeso(owed)} must be paid first (Record payment).` : undefined,
      body: <RedeemForm loanId={loan.id} canRedeem owed={owed} />,
    },
  ];
  // defaulted loans: Reinstate (Cashier/Admin) and Forfeit (Admin only, the server checks too)
  const defaultedActions: LoanAction[] = [
    ...(canTransact
      ? [
          {
            key: "reinstate",
            title: "Reinstate",
            hint: "Reopen the loan. The default stays on record.",
            // reinstate_loan: "The item is already queued for auction and cannot be reinstated."
            reason: vault?.status === "queued_for_auction" ? "The item is already queued for auction, so the loan can't be reinstated." : vault?.status === "sold" ? "The item was sold at auction, so the loan can't be reinstated." : undefined,
            body: <ReinstateForm loanId={loan.id} interestOwed={interest} />,
          },
        ]
      : []),
    ...(isAdmin ? [{ key: "forfeit", title: "Forfeit", hint: "Make the default final. The item becomes shop property.", body: <ForfeitForm loanId={loan.id} /> }] : []),
  ];
  const actions = canTransact && open ? openActions : loan.status === "defaulted" ? defaultedActions : [];
  // the row that starts open: the most likely next step. Owes money -> Record payment; owes ₱0 -> Redeem.
  // Nothing starts open on a defaulted loan (Reinstate and Forfeit are rare and serious).
  const startOpen = canTransact && open ? (owed > 0 ? "payment" : "redeem") : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xl">{loan.ticket_number}</span>
            <StatusBadge status={state.status} label={state.label} />
            {situation && <StatusBadge status={situation.status} label={situation.label} />}
            {loan.archived_at && <StatusBadge status="neutral" label="Archived" />}
          </span>
        }
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Loans", href: "/dashboard/loans" }, { label: loan.ticket_number }]}
        actions={
          <>
            {customer && <ButtonLink href={`/dashboard/customers/${customer.id}`}>View customer</ButtonLink>}
            {/* L15: the original appraisal (photos, flag history, who appraised it) */}
            {item && <ButtonLink href={`/dashboard/appraisals/${item.id}`}>View appraisal</ButtonLink>}
            <ButtonLink href={`/print/ticket/${loan.id}`}>Print ticket</ButtonLink>
          </>
        }
      />

      {loan.status === "defaulted" && (
        <Alert tone="danger" title="Defaulted">
          The grace period ended without payment. A Cashier or Admin can reinstate it; an Admin can forfeit it.
        </Alert>
      )}
      {/* L16: paid in full, item still in the vault: say what to do next */}
      {paidAwaitingRelease && (
        <Alert tone="success" title="Paid in full, ready to release">
          {canTransact ? "Nothing is owed. Use Redeem in Loan actions to release the item to the customer and close the loan." : "Nothing is owed. A Cashier or Admin releases the item with Redeem."}
        </Alert>
      )}
      {overdue && (
        <Alert tone="warning" title="Past due">
          Matured {formatDate(loan.maturity_date)}. Interest keeps accruing every {TERM_DAYS} days until it is paid, renewed or capitalized.
        </Alert>
      )}

      {/* L27: three blocks. On a phone they stack in this order: loan details, money + Loan actions, then the history.
          On a big screen (lg): loan details top-left, history under it, money + Loan actions on the right spanning both rows.
          grid-rows-[auto_1fr] = the first row is only as tall as the loan details, so no gap opens under them
          when the right side is taller. min-w-0 = a column may shrink to fit a phone (the 640px Payments table
          scrolls inside its card instead of stretching the page). */}
      <div className="grid gap-5 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          <Card>
            <DetailGrid
              items={[
                { label: "Customer", value: customer?.full_name ?? "" },
                { label: "Contact", value: customer?.contact_number ?? "" },
                // L15: the item opens its appraisal
                { label: "Item", value: item ? <Link href={`/dashboard/appraisals/${item.id}`} className="text-navy-700 underline-offset-2 hover:underline">{itemLabel}</Link> : "" },
                { label: "Appraised value", value: item ? formatPeso(item.computed_value) : "" },
                { label: "Original principal", value: formatPeso(loan.principal_amount) },
                { label: "Interest rate", value: `${loan.interest_rate_percent}% per ${TERM_DAYS} days` },
                { label: "Loan date", value: formatDate(loan.loan_date) },
                { label: "Due date", value: formatDate(loan.maturity_date), emphasize: true },
                { label: "Renewals", value: String(loan.extension_count) },
                { label: "Vault", value: vault?.vault_location ?? "" },
              ]}
            />
          </Card>
        </div>

        {/* L27: the right side: what is owed, then Loan actions */}
        <div className="min-w-0 space-y-5 lg:col-start-3 lg:row-span-2 lg:row-start-1">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{open || loan.status === "defaulted" ? "To redeem today" : "Balance"}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-navy-900">{open || loan.status === "defaulted" ? formatPeso(owed) : formatPeso(0)}</p>
            {(open || loan.status === "defaulted") && (
              <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Principal balance</dt>
                  <dd className="tabular-nums">{formatPeso(principal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Interest billed</dt>
                  <dd className="tabular-nums">{formatPeso(loan.interest_owed)}</dd>
                </div>
                {accrual.extraTerms > 0 && (
                  <div className="flex justify-between">
                    {/* L18: a term is 30 days (TERM_DAYS) */}
                    <dt className="text-slate-600">
                      Interest added after {formatDate(accruedFrom)} ({accrual.extraTerms} × {TERM_DAYS} days)
                    </dt>
                    <dd className="tabular-nums">{formatPeso(interest - Number(loan.interest_owed))}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-600">Status</dt>
                  <dd>{state.label}</dd>
                </div>
              </dl>
            )}
          </Card>

          {/* L27: Loan actions. One row open at a time; rows that can't be used say why */}
          {actions.length > 0 && (
            <section>
              <SectionTitle description="Open one action at a time. Each asks you to confirm before anything is saved.">Loan actions</SectionTitle>
              <Card padded={false} className="divide-y divide-slate-200">
                {actions.map((a) => (
                  <LoanActionRow key={a.key} action={a} open={a.key === startOpen} />
                ))}
              </Card>
            </section>
          )}
          {!canTransact && open && <Alert tone="info">Only a Cashier or Admin can record payments, renew or redeem.</Alert>}
        </div>

        {/* the history: payments, renewals, Admin actions */}
        <div className="min-w-0 space-y-5 lg:col-span-2 lg:col-start-1 lg:row-start-2 lg:self-start">
          <section>
            <SectionTitle>Payments</SectionTitle>
            <Card padded={false}>
              {payments && payments.length > 0 ? (
                <Table minWidth="640px">
                  <THead>
                    <TH>Receipt</TH>
                    <TH>Date</TH>
                    <TH align="right">Amount</TH>
                    <TH align="right">Interest</TH>
                    <TH align="right">Principal</TH>
                    <TH>
                      <span className="sr-only">Actions</span>
                    </TH>
                  </THead>
                  <TBody>
                    {payments.map((p) => (
                      <TR key={p.id}>
                        <TD mono>{p.receipt_number}</TD>
                        <TD className="text-slate-600">{formatDateTime(p.created_at)}</TD>
                        <TD align="right" className="font-medium">
                          {formatPeso(p.amount)}
                        </TD>
                        <TD align="right">{formatPeso(p.interest_portion)}</TD>
                        <TD align="right">{formatPeso(p.principal_portion)}</TD>
                        <ActionsCell>
                          <ViewButton href={`/print/receipt/${p.id}`}>Print receipt</ViewButton>
                          {/* L19: payment corrections moved to Admin actions below (not inside the table row) */}
                        </ActionsCell>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EmptyState title="No payments yet." />
              )}
            </Card>
          </section>

          {extensions && extensions.length > 0 && (
            <section>
              <SectionTitle>Renewals and capitalizations</SectionTitle>
              <Card padded={false}>
                <Table minWidth="560px">
                  <THead>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH align="right">Interest</TH>
                    <TH>New due date</TH>
                  </THead>
                  <TBody>
                    {extensions.map((e) => (
                      <TR key={e.id}>
                        <TD className="text-slate-600">{formatDateTime(e.created_at)}</TD>
                        <TD>{e.extension_type === "capitalized" ? "Capitalized (no cash)" : "Renewed"}</TD>
                        <TD align="right">{formatPeso(e.extension_type === "capitalized" ? e.capitalized_amount : e.additional_interest_amount)}</TD>
                        <TD>{formatDate(e.new_maturity_date)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            </section>
          )}

          {/* L19: Admin actions closed by default, like on the customer profile. The server checks Admin too */}
          {isAdmin && (
            <section>
              <SectionTitle description="Rarely needed. Saved loans are locked; each correction needs a written reason and is saved in the audit trail.">Admin actions</SectionTitle>
              <Card padded={false} className="divide-y divide-slate-200">
                <ActionRow title="Correct loan details" hint="Fix a wrong principal, interest rate or due date.">
                  <AdminEditLoanForm loanId={loan.id} principal={Number(loan.principal_amount)} rate={Number(loan.interest_rate_percent)} maturity={loan.maturity_date} />
                </ActionRow>
                {payments && payments.length > 0 && (
                  <ActionRow title="Correct a payment" hint="Fix the amount of a payment that was entered wrong. The ledger is corrected to match.">
                    <AdminCorrectPaymentForm loanId={loan.id} payments={payments.map((p) => ({ id: p.id, receipt: p.receipt_number, amount: Number(p.amount), date: formatDateTime(p.created_at) }))} />
                  </ActionRow>
                )}
                {(loan.status === "redeemed" || loan.status === "forfeited") && !loan.archived_at && (
                  <ActionRow title="Archive loan" hint="Hide a closed loan from lists. Nothing is deleted; an Admin can restore it.">
                    <ArchiveForm table="loans" id={loan.id} label="Loan" />
                  </ActionRow>
                )}
              </Card>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
