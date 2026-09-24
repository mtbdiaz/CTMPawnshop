import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { calculateRenewal } from "@/lib/loans/calculations";
import { formatDate, formatDateTime, formatPeso, manilaToday } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import {
  Alert,
  Card,
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
  TableLink,
  buttonClasses,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { PaymentForm, ExtensionForm, RedeemForm } from "./payment-form";

export default async function LoanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ issued?: string }>;
}) {
  const user = await requireRole(["cashier", "operator", "appraiser", "admin"]);
  const { id } = await params;
  const { issued } = await searchParams;

  const supabase = await createClient();
  const { data: loan } = await supabase
    .from("loans")
    .select("*, customers(id, full_name, address, contact_number, id_type, id_number), appraisal_items(id, weight_grams, karat, purity_percent, computed_value), inventory_items(vault_location)")
    .eq("id", id)
    .maybeSingle();
  if (!loan) notFound();

  const { data: payments } = await supabase
    .from("loan_payments")
    .select("*")
    .eq("loan_id", id)
    .order("created_at", { ascending: false });

  type Joined = {
    customers: { id: string; full_name: string; address: string; contact_number: string; id_type: string; id_number: string } | null;
    appraisal_items: { id: string; weight_grams: number; karat: number; purity_percent: number; computed_value: number } | null;
    inventory_items: { vault_location: string } | null;
  };
  const { customers: customer, appraisal_items: item, inventory_items: vault } = loan as unknown as Joined;

  const principal = Number(loan.principal_balance);
  const interest = Number(loan.interest_owed);
  const owed = Math.round((principal + interest) * 100) / 100;
  const open = loan.status === "active" || loan.status === "extended";
  const canTransact = open && hasRole(user.profile.role, ["cashier"]);
  const overdue = open && loan.maturity_date < manilaToday();
  const graceEnds = new Date(`${loan.maturity_date}T00:00:00Z`);
  graceEnds.setUTCDate(graceEnds.getUTCDate() + loan.grace_period_days);
  const graceEndDate = graceEnds.toISOString().slice(0, 10);
  const renewal = calculateRenewal(new Date(`${loan.maturity_date}T00:00:00Z`), principal, interest, Number(loan.interest_rate_percent));

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xl">{loan.ticket_number}</span>
            <StatusBadge status={loan.status} label={loan.status === "extended" ? "Renewed" : undefined} />
            {overdue && <StatusBadge status="defaulted" label="Overdue" />}
          </span>
        }
        description={
          customer ? (
            <>
              Pawn loan for <TableLink href={`/dashboard/customers/${customer.id}`}>{customer.full_name}</TableLink>
            </>
          ) : undefined
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Loans", href: "/dashboard/loans" },
          { label: loan.ticket_number },
        ]}
        actions={<PrintButton label="Print pawn ticket" />}
      />

      {issued === "1" && (
        <Alert tone="success" title="Loan created and ticket issued" className="print:hidden">
          Print the pawn ticket below and hand it to the customer. The disbursement has been logged in the cash ledger.
        </Alert>
      )}
      {(loan.status === "defaulted" || loan.status === "forfeited") && (
        <Alert tone="danger" title={`This loan is ${loan.status}`} className="print:hidden">
          It passed its maturity date and {loan.grace_period_days}-day grace period without payment or renewal. The item has
          moved toward forfeiture.
        </Alert>
      )}
      {overdue && (
        <Alert tone="warning" title="Past due" className="print:hidden">
          Matured {formatDate(loan.maturity_date)}. Grace period ends {formatDate(graceEndDate)} — after that the item is
          forfeited.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="print:border-2 print:border-navy-900 print:p-8">
            <div id="pawn-ticket">
              <div className="flex items-start justify-between gap-4 border-b border-dashed border-slate-300 pb-4">
                <div>
                  <p className="font-display text-xl font-semibold text-navy-900">CTM Pawnshop</p>
                  <p className="text-xs text-slate-500">Pawn Ticket · Gold Collateral Loan</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Ticket no.</p>
                  <p className="font-mono text-base font-semibold text-navy-900">{loan.ticket_number}</p>
                </div>
              </div>

              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 py-4 text-sm sm:grid-cols-2 print:grid-cols-2">
                <TicketRow label="Pawner">
                  <span className="font-medium">{customer?.full_name}</span>
                  <span className="block text-xs text-slate-500">{customer?.address}</span>
                  <span className="block text-xs text-slate-500">{customer?.contact_number}</span>
                </TicketRow>
                <TicketRow label="Pledged item">
                  {item ? (
                    <>
                      <span className="font-medium">
                        Gold, {item.weight_grams} g, {item.karat}k ({item.purity_percent}% purity)
                      </span>
                      <span className="block text-xs text-slate-500">Appraised at {formatPeso(item.computed_value)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </TicketRow>
                <TicketRow label="Principal loaned">
                  <span className="text-lg font-semibold tabular-nums">{formatPeso(loan.principal_amount)}</span>
                </TicketRow>
                <TicketRow label="Interest">{loan.interest_rate_percent}% per 30-day term</TicketRow>
                <TicketRow label="Date of loan">{formatDate(loan.loan_date)}</TicketRow>
                <TicketRow label="Maturity date">
                  <span className="font-semibold">{formatDate(loan.maturity_date)}</span>
                  <span className="block text-xs text-slate-500">
                    Grace period {loan.grace_period_days} days, until {formatDate(graceEndDate)}
                  </span>
                </TicketRow>
              </dl>

              <p className="hidden border-t border-dashed border-slate-300 pt-4 text-[11px] leading-relaxed text-slate-600 print:block">
                Present this ticket to redeem or renew. If the loan is not redeemed or renewed by the end of the grace period,
                the pledged item is forfeited. Lost tickets require identity verification with the ID presented at the time of
                the loan.
              </p>
              <div className="hidden grid-cols-2 gap-8 pt-10 text-xs text-slate-600 print:grid">
                <div className="border-t border-slate-400 pt-1">Pawner&apos;s signature</div>
                <div className="border-t border-slate-400 pt-1">Authorized CTM representative</div>
              </div>
            </div>
          </Card>

          <section className="print:hidden">
            <SectionTitle>Payment history</SectionTitle>
            <Card padded={false}>
              {payments && payments.length > 0 ? (
                <Table minWidth="600px">
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
                        <TD align="right">
                          <Link href={`/dashboard/loans/${loan.id}/receipt/${p.id}`} className={buttonClasses("ghost", "sm")}>
                            <Icon name="printer" className="h-3.5 w-3.5" /> Receipt
                          </Link>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EmptyState icon="cash" title="No payments yet" />
              )}
            </Card>
          </section>
        </div>

        <div className="space-y-6 print:hidden">
          <Card className={overdue ? "border-red-300" : "border-gold-300"}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {open ? "Amount to redeem today" : "Balance"}
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-navy-900">{open ? formatPeso(owed) : formatPeso(0)}</p>
            {open && (
              <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Principal balance</dt>
                  <dd className="tabular-nums">{formatPeso(principal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Interest owed this term</dt>
                  <dd className="tabular-nums">{formatPeso(interest)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Due</dt>
                  <dd className={overdue ? "font-semibold text-red-700" : undefined}>{formatDate(loan.maturity_date)}</dd>
                </div>
                {vault && (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Vault location</dt>
                    <dd>{vault.vault_location}</dd>
                  </div>
                )}
              </dl>
            )}
          </Card>

          {canTransact ? (
            <>
              {owed > 0 && (
                <Card>
                  <SectionTitle>Record payment</SectionTitle>
                  <PaymentForm loanId={loan.id} interestDue={interest} principalBalance={principal} />
                </Card>
              )}
              {principal > 0 && (
                <Card>
                  <SectionTitle description="Collect this term's interest and extend the due date by 30 days.">Renew loan</SectionTitle>
                  <ExtensionForm
                    loanId={loan.id}
                    collectNow={renewal.interestCollectedNow}
                    newInterest={renewal.newInterestOwed}
                    newMaturity={renewal.newMaturityDate.toISOString().slice(0, 10)}
                  />
                </Card>
              )}
              <Card className={owed <= 0 ? "border-emerald-300" : undefined}>
                <SectionTitle>Redeem item</SectionTitle>
                <RedeemForm loanId={loan.id} canRedeem={owed <= 0} owed={owed} />
              </Card>
            </>
          ) : open ? (
            <Alert tone="info">Only a Cashier or Admin can record payments, renew, or redeem this loan.</Alert>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TicketRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}
