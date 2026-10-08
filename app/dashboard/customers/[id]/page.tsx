import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { computeCustomerScore, weightsFromRows } from "@/lib/customers/score";
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

type LoanHistoryRow = {
  id: string;
  ticket_number: string;
  principal_amount: number;
  principal_balance: number;
  interest_owed: number;
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
  loan_extensions: { id: string; new_maturity_date: string; additional_interest_amount: number; created_at: string }[];
};

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
        "id, ticket_number, principal_amount, principal_balance, interest_owed, status, loan_date, maturity_date, extension_count, late_payment_count, defaulted_at, reinstated_at, redeemed_at, archived_at, loan_payments(id, amount, receipt_number, created_at), loan_extensions(id, new_maturity_date, additional_interest_amount, created_at)",
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
  const history = computeCustomerScore(loanHistory, manilaToday(), weightsFromRows(weightRows));
  const openLoans = loanHistory.filter((l) => l.status === "active" || l.status === "extended" || l.status === "reinstated");
  const canEdit = hasRole(role, ["operator"]);
  const blocked = customer.is_blacklisted;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {customer.full_name}
            <ScoreBadge score={history.score} tier={history.tier} />
            {blocked && <Badge tone="danger">Blacklisted</Badge>}
            {customer.archived_at && <Badge tone="neutral">Archived</Badge>}
            {customer.aml_status === "flagged" && <Badge tone="warning">AML flagged</Badge>}
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
        <div className="space-y-6 xl:col-span-2">
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
                  const owed = Number(loan.principal_balance) + Number(loan.interest_owed);
                  const isOpen = loan.status === "active" || loan.status === "extended" || loan.status === "reinstated";
                  return (
                    <Card key={loan.id}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-medium">{loan.ticket_number}</span>
                          {loan.archived_at && <Badge tone="neutral">Archived</Badge>}
                          <p className="mt-0.5 text-xs text-slate-500">
                            Issued {formatDate(loan.loan_date)}. Due {formatDate(loan.maturity_date)}.
                            {loan.extension_count > 0 ? ` Renewed ${loan.extension_count} time(s).` : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <StatusBadge status={loan.status} />
                          <div className="mt-1">
                            <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>
                          </div>
                          <p className="mt-1 text-sm tabular-nums text-slate-700">
                            {formatPeso(loan.principal_amount)} principal
                            {isOpen && <span className="block font-semibold text-navy-900">{formatPeso(owed)} owed</span>}
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
                          {loan.loan_extensions.map((ext) => (
                            <li key={ext.id} className="flex justify-between gap-2">
                              <span>
                                Extended to {formatDate(ext.new_maturity_date)}, {formatDate(ext.created_at)}
                              </span>
                              <span className="tabular-nums">{formatPeso(ext.additional_interest_amount)} new-period interest</span>
                            </li>
                          ))}
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
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span>
                        {categoryLabel(a.category, a.category_other)}, {a.karat}K, {a.weight_grams} g
                      </span>
                      <span className="flex items-center gap-3">
                        {a.is_counterfeit_risk && (
                          <StatusBadge status={a.counterfeit_resolution ?? "pending"} label={`Counterfeit: ${a.counterfeit_resolution ?? "pending"}`} />
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
                    { label: "ID number", value: <span className="font-mono">{customer.id_number}</span> },
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
