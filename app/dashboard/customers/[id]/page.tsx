import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso } from "@/lib/format";
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
  TableLink,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { updateCustomer } from "../actions";
import { CustomerForm } from "../customer-form";
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
  const [{ data: loans }, { data: appraisals }] = await Promise.all([
    supabase
      .from("loans")
      .select(
        "id, ticket_number, principal_amount, principal_balance, interest_owed, status, loan_date, maturity_date, extension_count, loan_payments(id, amount, receipt_number, created_at), loan_extensions(id, new_maturity_date, additional_interest_amount, created_at)",
      )
      .eq("customer_id", id)
      .order("loan_date", { ascending: false }),
    supabase
      .from("appraisal_items")
      .select("id, weight_grams, karat, computed_value, is_counterfeit_risk, counterfeit_resolution, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
  ]);
  const loanHistory = (loans ?? []) as unknown as LoanHistoryRow[];
  const openLoans = loanHistory.filter((l) => l.status === "active" || l.status === "extended");
  const canEdit = hasRole(role, ["operator"]);
  const blocked = customer.is_blacklisted;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {customer.full_name}
            {blocked && <Badge tone="danger" icon>Blacklisted</Badge>}
            {customer.aml_status === "flagged" && <Badge tone="warning">AML flagged</Badge>}
          </span>
        }
        description={`Customer since ${formatDate(customer.created_at)} · ${openLoans.length} open loan${openLoans.length === 1 ? "" : "s"}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Customers", href: "/dashboard/customers" },
          { label: customer.full_name },
        ]}
        actions={
          !blocked && (
            <>
              {hasRole(role, ["appraiser"]) && (
                <ButtonLink href={`/dashboard/appraisals?new=1&customer=${customer.id}`} variant={role === "appraiser" ? "primary" : "secondary"}>
                  <Icon name="scale" className="h-4 w-4" /> New appraisal
                </ButtonLink>
              )}
              {hasRole(role, ["cashier"]) && (
                <ButtonLink href={`/dashboard/loans?new=1&customer=${customer.id}`} variant="primary">
                  <Icon name="ticket" className="h-4 w-4" /> New loan
                </ButtonLink>
              )}
            </>
          )
        }
      />

      {blocked && (
        <Alert tone="danger" title="This customer is blacklisted — do not proceed with new appraisals or loans.">
          {customer.blacklist_reason ? `Reason: ${customer.blacklist_reason}` : "No reason recorded."}
        </Alert>
      )}
      {customer.aml_status === "flagged" && (
        <Alert tone="warning" title="AML identity check flagged this customer">
          {customer.aml_notes}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section>
            <SectionTitle description="Newest first. Open a ticket to record payments or extend.">
              Loans &amp; transaction history
            </SectionTitle>
            {loanHistory.length === 0 ? (
              <Card padded={false}>
                <EmptyState
                  icon="ticket"
                  title="No loans yet"
                  description="Loans, payments, renewals and redemptions appear here once a loan is created for this customer."
                />
              </Card>
            ) : (
              <div className="space-y-3">
                {loanHistory.map((loan) => {
                  const owed = Number(loan.principal_balance) + Number(loan.interest_owed);
                  const isOpen = loan.status === "active" || loan.status === "extended";
                  return (
                    <Card key={loan.id}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <TableLink href={`/dashboard/loans/${loan.id}`}>
                            <span className="font-mono">{loan.ticket_number}</span>
                          </TableLink>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Issued {formatDate(loan.loan_date)} · Due {formatDate(loan.maturity_date)}
                            {loan.extension_count > 0 ? ` · Renewed ${loan.extension_count}×` : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <StatusBadge status={loan.status} />
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
                                Payment · receipt <span className="font-mono">{p.receipt_number}</span> · {formatDate(p.created_at)}
                              </span>
                              <span className="tabular-nums font-medium text-emerald-700">{formatPeso(p.amount)}</span>
                            </li>
                          ))}
                          {loan.loan_extensions.map((ext) => (
                            <li key={ext.id} className="flex justify-between gap-2">
                              <span>
                                Renewed to {formatDate(ext.new_maturity_date)} · {formatDate(ext.created_at)}
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
            <SectionTitle>Appraised items</SectionTitle>
            <Card padded={false}>
              {appraisals && appraisals.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {appraisals.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <TableLink href={`/dashboard/appraisals/${a.id}`}>
                        {a.weight_grams}g · {a.karat}k gold
                      </TableLink>
                      <span className="flex items-center gap-3">
                        {a.is_counterfeit_risk && (
                          <StatusBadge status={a.counterfeit_resolution ?? "pending"} label={`Counterfeit: ${a.counterfeit_resolution ?? "pending"}`} />
                        )}
                        <span className="tabular-nums text-slate-700">{formatPeso(a.computed_value)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon="scale" title="No appraisals yet" />
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
                    { label: "Email", value: customer.email || "—" },
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
