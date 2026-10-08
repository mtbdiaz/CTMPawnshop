import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { accruedInterest, capitalizePreview, renewPreview, TERM_DAYS } from "@/lib/loans/accrual";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { formatDate, formatDateTime, formatPeso, humanize, manilaToday } from "@/lib/format";
import {
  ActionsCell,
  Alert,
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
  AdminEditPaymentForm,
  CapitalizeForm,
  ExtensionForm,
  ForfeitForm,
  PaymentForm,
  RedeemForm,
  ReinstateForm,
} from "./payment-form";

const OPEN = new Set(["active", "extended", "reinstated"]);

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["cashier", "operator", "appraiser", "admin"]);
  const role = user.profile.role;
  const isAdmin = role === "admin";
  const { id } = await params;
  const today = manilaToday();

  const supabase = await createClient();
  const { data: loan } = await supabase
    .from("loans")
    .select("*, customers(id, full_name, contact_number), appraisal_items(id, category, category_other, weight_grams, karat, computed_value), inventory_items(vault_location)")
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
    inventory_items: { vault_location: string } | null;
  };
  const { customers: customer, appraisal_items: item, inventory_items: vault } = loan as unknown as Joined;

  const accrual = accruedInterest(loan, today);
  const principal = Number(loan.principal_balance);
  const interest = accrual.interestOwed;
  const owed = Math.round((principal + interest) * 100) / 100;
  const open = OPEN.has(loan.status);
  const canTransact = hasRole(role, ["cashier"]);
  const overdue = open && loan.maturity_date < today;
  const renew = renewPreview(loan, today);
  const cap = capitalizePreview(loan, today);
  const itemLabel = item ? `${categoryLabel(item.category, item.category_other)}, ${item.karat}K, ${item.weight_grams} g` : "";

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xl">{loan.ticket_number}</span>
            <StatusBadge status={loan.status} label={loan.status === "extended" ? "Renewed" : undefined} />
            {overdue && <StatusBadge status="defaulted" label="Overdue" />}
            {loan.archived_at && <StatusBadge status="neutral" label="Archived" />}
          </span>
        }
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Loans", href: "/dashboard/loans" }, { label: loan.ticket_number }]}
        actions={
          <>
            {customer && <ButtonLink href={`/dashboard/customers/${customer.id}`}>View customer</ButtonLink>}
            <ButtonLink href={`/print/ticket/${loan.id}`}>Print ticket</ButtonLink>
          </>
        }
      />

      {loan.status === "defaulted" && (
        <Alert tone="danger" title="Defaulted">
          The grace period ended without payment. A Cashier or Admin can reinstate it; an Admin can forfeit it.
        </Alert>
      )}
      {overdue && (
        <Alert tone="warning" title="Past due">
          Matured {formatDate(loan.maturity_date)}. Interest keeps accruing every {TERM_DAYS} days until it is paid, renewed or capitalized.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <DetailGrid
              items={[
                { label: "Customer", value: customer?.full_name ?? "" },
                { label: "Contact", value: customer?.contact_number ?? "" },
                { label: "Item", value: itemLabel },
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
                          {isAdmin && (
                            <details className="text-left">
                              <summary className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-sm">Edit (Admin)</summary>
                              <div className="mt-2 w-64">
                                <AdminEditPaymentForm paymentId={p.id} loanId={loan.id} amount={Number(p.amount)} />
                              </div>
                            </details>
                          )}
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

          {isAdmin && (
            <section className="space-y-3">
              <SectionTitle description="Saved loans are locked. Corrections need a written reason and are audited.">Admin</SectionTitle>
              <Card>
                <AdminEditLoanForm loanId={loan.id} principal={Number(loan.principal_amount)} rate={Number(loan.interest_rate_percent)} maturity={loan.maturity_date} />
              </Card>
              {(loan.status === "redeemed" || loan.status === "forfeited") && !loan.archived_at && (
                <Card>
                  <ArchiveForm table="loans" id={loan.id} label="Loan" />
                </Card>
              )}
            </section>
          )}
        </div>

        <div className="space-y-5">
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
                  <dt className="text-slate-600">Interest charged</dt>
                  <dd className="tabular-nums">{formatPeso(loan.interest_owed)}</dd>
                </div>
                {accrual.extraTerms > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Accrued since ({accrual.extraTerms} term{accrual.extraTerms > 1 ? "s" : ""})</dt>
                    <dd className="tabular-nums">{formatPeso(interest - Number(loan.interest_owed))}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-600">Status</dt>
                  <dd>{humanize(loan.status)}</dd>
                </div>
              </dl>
            )}
          </Card>

          {canTransact && open && (
            <>
              {owed > 0 && (
                <Card>
                  <SectionTitle>Record payment</SectionTitle>
                  <PaymentForm loanId={loan.id} interestDue={interest} principalBalance={principal} />
                </Card>
              )}
              {principal > 0 && (
                <Card>
                  <SectionTitle description={`Collect interest owed and extend by ${TERM_DAYS} days.`}>Renew</SectionTitle>
                  <ExtensionForm loanId={loan.id} collectNow={renew.collectNow} newInterest={renew.newInterestOwed} newMaturity={renew.newMaturity} />
                </Card>
              )}
              {principal > 0 && interest > 0 && (
                <Card>
                  <SectionTitle description="For a customer who cannot pay the interest today.">Capitalize and extend</SectionTitle>
                  <CapitalizeForm loanId={loan.id} capitalized={cap.capitalized} newPrincipal={cap.newPrincipal} newMaturity={cap.newMaturity} newInterest={cap.newInterestOwed} />
                </Card>
              )}
              <Card>
                <SectionTitle>Redeem</SectionTitle>
                <RedeemForm loanId={loan.id} canRedeem={owed <= 0} owed={owed} />
              </Card>
            </>
          )}
          {canTransact && loan.status === "defaulted" && (
            <Card>
              <SectionTitle>Reinstate</SectionTitle>
              <ReinstateForm loanId={loan.id} interestOwed={interest} />
            </Card>
          )}
          {isAdmin && loan.status === "defaulted" && (
            <Card>
              <SectionTitle>Forfeit</SectionTitle>
              <ForfeitForm loanId={loan.id} />
            </Card>
          )}
          {!canTransact && open && <Alert tone="info">Only a Cashier or Admin can record payments, renew or redeem.</Alert>}
        </div>
      </div>
    </div>
  );
}
