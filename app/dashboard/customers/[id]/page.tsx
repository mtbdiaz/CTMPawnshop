import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { computeCustomerScore, weightsFromRows } from "@/lib/customers/score";
// C1: interest that piled up after the due date (same math as the Dashboard and loan page)
import { accruedInterest } from "@/lib/loans/accrual";
// C8: "how many days until this date" (negative = in the past), same helper as the Dashboard
import { daysUntilDue } from "@/lib/compliance/reminders";
import { ScoreBadge } from "@/components/score-badge";
import { ArchiveForm } from "@/components/archive-controls";
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  DetailGrid,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatusBadge,
  ViewButton,
} from "@/components/ui";
import { updateCustomer } from "../actions";
import { AdminIdentityForm, CustomerForm } from "../customer-form";
import { BlacklistForm } from "./blacklist-form";
// P3: masked ID + eye button, and who may reveal a full ID
import { IdReveal } from "../id-reveal";
import { ID_REVEAL_ROLES, idEnding, maskId } from "@/lib/customers/id-privacy";

type LoanHistoryRow = {
  id: string;
  ticket_number: string;
  principal_amount: number;
  principal_balance: number;
  interest_owed: number;
  // C1: these two are needed to work out the late interest
  interest_rate_percent: number;
  interest_accrued_through: string | null;
  status: string;
  loan_date: string;
  maturity_date: string;
  extension_count: number;
  late_payment_count: number;
  defaulted_at: string | null;
  reinstated_at: string | null;
  redeemed_at: string | null;
  archived_at: string | null;
  loan_payments: { id: string; amount: number; receipt_number: string; created_at: string }[];
  // C4: extension_type tells a cash renewal apart from a capitalize (no cash)
  loan_extensions: { id: string; new_maturity_date: string; additional_interest_amount: number; capitalized_amount: number; extension_type: string; created_at: string }[];
};

// C2 + C3 + C8: one status word per loan, the SAME words the Dashboard uses.
// "badge" picks the colour of the existing StatusBadge, "label" is the word shown.
function loanLabel(loan: LoanHistoryRow, owed: number, today: string): { badge: string; label: string } {
  const open = loan.status === "active" || loan.status === "extended" || loan.status === "reinstated"; // still running
  if (open && owed < 0.01) return { badge: "redeemed", label: "Paid, ready to release" }; // C2: nothing left to pay (green)
  if (open) {
    const days = daysUntilDue(loan.maturity_date, today); // days until due (negative = late)
    if (days < 0) return { badge: "defaulted", label: "Overdue" }; // past the due date (red)
    if (days <= 7) return { badge: "pending", label: "Due soon" }; // C8: due within 7 days (amber)
    if (loan.status === "extended") return { badge: "extended", label: "Renewed" }; // C3: "Renewed", not "Extended"
    if (loan.status === "reinstated") return { badge: "reinstated", label: "Reinstated" };
    return { badge: "active", label: "Active" };
  }
  if (loan.status === "defaulted") return { badge: "defaulted", label: "Defaulted" }; // grace period ended
  if (loan.status === "redeemed") return { badge: "redeemed", label: "Redeemed" };
  return { badge: loan.status, label: loan.status === "forfeited" ? "Forfeited" : loan.status };
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["operator", "cashier", "appraiser", "admin"]);
  const role = user.profile.role;
  const { id } = await params;

  const supabase = await createClient();
  const { data: customer } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (!customer) notFound();

  // PB-10: every loan for this customer plus its payments and extensions.
  const [{ data: loans }, { data: appraisals }, { data: weightRows }] = await Promise.all([
    supabase
      .from("loans")
      .select(
        "id, ticket_number, principal_amount, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, status, loan_date, maturity_date, extension_count, late_payment_count, defaulted_at, reinstated_at, redeemed_at, archived_at, loan_payments(id, amount, receipt_number, created_at), loan_extensions(id, new_maturity_date, additional_interest_amount, capitalized_amount, extension_type, created_at)",
      )
      .eq("customer_id", id)
      .order("loan_date", { ascending: false }),
    supabase
      .from("appraisal_items")
      .select("id, category, category_other, weight_grams, karat, computed_value, is_counterfeit_risk, counterfeit_resolution, created_at")
      .eq("customer_id", id)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("score_weights").select("key, value"),
  ]);
  const loanHistory = (loans ?? []) as unknown as LoanHistoryRow[];
  // Item 6: archived loans still count toward history and score.
  const today = manilaToday(); // today's date in Manila
  const history = computeCustomerScore(loanHistory, today, weightsFromRows(weightRows));
  const openLoans = loanHistory.filter((l) => l.status === "active" || l.status === "extended" || l.status === "reinstated");
  const canEdit = hasRole(role, ["operator"]);
  const blocked = customer.is_blacklisted;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {customer.full_name}
            {/* C9: wrapper for the badges. font-sans = normal font instead of the serif title font, gap-2 = small space between badges */}
            <span className="flex flex-wrap items-center gap-2 font-sans">
              {/* the customer's score badge (e.g. "Good 85") */}
              <ScoreBadge score={history.score} tier={history.tier} />
              {/* red badge, only shows if the customer is blacklisted */}
              {blocked && <Badge tone="danger">Blacklisted</Badge>}
              {/* gray badge, only shows if the customer is archived */}
              {customer.archived_at && <Badge tone="neutral">Archived</Badge>}
              {/* yellow badge, only shows if the customer is AML flagged */}
              {customer.aml_status === "flagged" && <Badge tone="warning">AML flagged</Badge>}
            {/* end of the badges wrapper */}
            </span>
          </span>
        }
        description={`Customer since ${formatDate(customer.created_at)}. ${openLoans.length} open loan${openLoans.length === 1 ? "" : "s"}.`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Customers", href: "/dashboard/customers" },
          { label: customer.full_name },
        ]}
        actions={
          !blocked && (
            <>
              {hasRole(role, ["cashier"]) && (
                <ButtonLink href={`/dashboard/loans/new?customer=${customer.id}`} variant="primary">
                  New loan
                </ButtonLink>
              )}
            </>
          )
        }
      />

      {blocked && (
        <Alert tone="danger" title="Blacklisted. Do not issue new loans.">
          {customer.blacklist_reason ? `Reason: ${customer.blacklist_reason}` : "No reason recorded."}
        </Alert>
      )}
      {customer.aml_status === "flagged" && (
        <Alert tone="warning" title="AML identity check flagged this customer">
          {customer.aml_notes}
        </Alert>
      )}

      {history.hasWarnings && (
        <Alert tone="warning" title="History warning">
          {[
            history.counts.delinquent && `${history.counts.delinquent} loan(s) paid late`,
            history.counts.reinstated && `${history.counts.reinstated} reinstated`,
            history.counts.defaulted && `${history.counts.defaulted} defaulted`,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </Alert>
      )}
      <Card>
        <DetailGrid
          items={[
            { label: "Score", value: history.score === null ? "No history" : `${history.score} / 100 (${history.tier})`, emphasize: true },
            { label: "Total loans", value: String(history.counts.total) },
            { label: "Open", value: String(history.counts.active) },
            { label: "Redeemed", value: String(history.counts.redeemed) },
            { label: "Renewed", value: String(history.counts.renewed) },
            { label: "Paid late", value: String(history.counts.delinquent) },
            { label: "Reinstated", value: String(history.counts.reinstated) },
            { label: "Defaulted", value: String(history.counts.defaulted) },
            { label: "Overdue now", value: String(history.counts.overdue) },
          ]}
        />
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Phone fix: min-w-0 lets this column shrink to the screen width instead of pushing the page sideways */}
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <section>
            <SectionTitle description="Newest first, archived loans included.">Loans and transactions</SectionTitle>
            {loanHistory.length === 0 ? (
              <Card padded={false}>
                <EmptyState
                  title="No loans yet"
                  description="Loans, payments, renewals and redemptions appear here once a loan is created for this customer."
                />
              </Card>
            ) : (
              <div className="space-y-3">
                {loanHistory.map((loan) => {
                  // C1: still owed = principal left + interest, INCLUDING interest that piled up
                  // after the due date (same as the loan page). Defaulted loans still owe money too.
                  const owes = loan.status === "active" || loan.status === "extended" || loan.status === "reinstated" || loan.status === "defaulted";
                  const owed = owes ? Number(loan.principal_balance) + accruedInterest(loan, today).interestOwed : 0;
                  // the status word and colour, same as the Dashboard
                  const label = loanLabel(loan, owed, today);
                  return (
                    <Card key={loan.id}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-medium">{loan.ticket_number}</span>
                          {loan.archived_at && <Badge tone="neutral">Archived</Badge>}
                          <p className="mt-0.5 text-xs text-slate-500">
                            Issued {formatDate(loan.loan_date)}. Due {formatDate(loan.maturity_date)}.
                            {/* C3: "1 time" / "2 times" instead of "time(s)" */}
                            {loan.extension_count > 0 ? ` Renewed ${loan.extension_count} time${loan.extension_count === 1 ? "" : "s"}.` : ""}
                          </p>
                        </div>
                        {/* Phone fix: on phones this block sits under the ticket, left-aligned and full width;
                            from sm (640px) up it goes back to the right side */}
                        <div className="w-full text-left sm:w-auto sm:text-right">
                          {/* C2 + C3 + C8: same status words as the Dashboard */}
                          <StatusBadge status={label.badge} label={label.label} />
                          <div className="mt-1">
                            <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>
                          </div>
                          <p className="mt-1 text-sm tabular-nums text-slate-700">
                            {formatPeso(loan.principal_amount)} principal
                            {/* C1: shown for open AND defaulted loans */}
                            {owes && <span className="block font-semibold text-navy-900">{formatPeso(owed)} owed</span>}
                          </p>
                        </div>
                      </div>
                      {(loan.loan_payments.length > 0 || loan.loan_extensions.length > 0) && (
                        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                          {loan.loan_payments.map((p) => (
                            <li key={p.id} className="flex justify-between gap-2">
                              <span>
                                Payment, receipt <span className="font-mono">{p.receipt_number}</span>, {formatDate(p.created_at)}
                              </span>
                              <span className="tabular-nums font-medium text-emerald-700">{formatPeso(p.amount)}</span>
                            </li>
                          ))}
                          {loan.loan_extensions.map((ext) =>
                            // C4: a capitalize adds the unpaid interest to the principal (no cash paid),
                            // so it must not look like a normal cash renewal
                            ext.extension_type === "capitalized" ? (
                              <li key={ext.id} className="flex justify-between gap-2">
                                <span>
                                  Capitalized (no cash), new due date {formatDate(ext.new_maturity_date)}, {formatDate(ext.created_at)}
                                </span>
                                <span className="tabular-nums">{formatPeso(ext.capitalized_amount)} added to principal</span>
                              </li>
                            ) : (
                              <li key={ext.id} className="flex justify-between gap-2">
                                <span>
                                  {/* C3: "Renewed", the same word as everywhere else */}
                                  Renewed, new due date {formatDate(ext.new_maturity_date)}, {formatDate(ext.created_at)}
                                </span>
                                {/* the interest charged for the new 30-day term */}
                                <span className="tabular-nums">{formatPeso(ext.additional_interest_amount)} interest for the new term</span>
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <SectionTitle>Items</SectionTitle>
            <Card padded={false}>
              {appraisals && appraisals.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {appraisals.map((a) => (
                    // Phone fix: flex-wrap lets the badge, amount and button drop to a second line on small screens
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3 text-sm">
                      <span>
                        {categoryLabel(a.category, a.category_other)}, {a.karat}K, {a.weight_grams} g
                      </span>
                      <span className="flex flex-wrap items-center gap-3">
                        {a.is_counterfeit_risk && (
                          <StatusBadge status={a.counterfeit_resolution ?? "pending"} label={a.counterfeit_resolution === "cleared" ? "Cleared" : a.counterfeit_resolution === "confirmed" ? "Confirmed risk" : "Counterfeit review"} />
                        )}
                        <span className="tabular-nums text-slate-700">{formatPeso(a.computed_value)}</span>
                        <ViewButton href={`/dashboard/appraisals/${a.id}`}>View appraisal</ViewButton>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No items pawned yet." />
              )}
            </Card>
          </section>
        </div>

        <div className="space-y-6">
          <section>
            <SectionTitle>Profile</SectionTitle>
            <Card>
              {canEdit ? (
                <CustomerForm action={updateCustomer} customer={customer} />
              ) : (
                <DetailGrid
                  items={[
                    { label: "Contact", value: customer.contact_number },
                    { label: "Email", value: customer.email || "" },
                    { label: "Address", value: customer.address },
                    { label: "Date of birth", value: formatDate(customer.date_of_birth) },
                    { label: "ID type", value: customer.id_type },
                    // P3: masked here too (this read-only view is what Cashier and Appraiser see). Cashier gets the eye button;
                    // only the masked text is sent to the browser
                    {
                      label: "ID number",
                      value: <IdReveal customerId={customer.id} masked={maskId(customer.id_number)} ending={idEnding(customer.id_number)} canReveal={hasRole(role, ID_REVEAL_ROLES)} />,
                    },
                  ]}
                />
              )}
            </Card>
          </section>

          {role === "admin" && (
            <section>
              <SectionTitle description="Name and ID are locked. Corrections need a reason.">Correct identity (Admin)</SectionTitle>
              <Card>
                <AdminIdentityForm customer={customer} />
              </Card>
            </section>
          )}
          {role === "admin" && !customer.archived_at && openLoans.length === 0 && (
            <section>
              <SectionTitle>Archive</SectionTitle>
              <Card>
                <ArchiveForm table="customers" id={customer.id} label="Customer" />
              </Card>
            </section>
          )}
          {role === "admin" && (
            <section>
              <SectionTitle>Blacklist status</SectionTitle>
              <Card>
                <BlacklistForm customer={customer} />
              </Card>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}