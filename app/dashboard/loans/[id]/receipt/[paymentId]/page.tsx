import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPeso } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { ButtonLink, Card, PageHeader } from "@/components/ui";

export default async function PaymentReceiptPage({
  params,
}: {
  params: Promise<{ id: string; paymentId: string }>;
}) {
  await requireRole(["cashier", "operator", "appraiser", "admin"]);
  const { id, paymentId } = await params;

  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("loan_payments")
    .select("*, loans(id, ticket_number, principal_balance, interest_owed, maturity_date, customers(full_name))")
    .eq("id", paymentId)
    .eq("loan_id", id)
    .maybeSingle();
  if (!payment) notFound();

  const loan = (
    payment as unknown as {
      loans: {
        id: string;
        ticket_number: string;
        principal_balance: number;
        interest_owed: number;
        maturity_date: string;
        customers: { full_name: string } | null;
      } | null;
    }
  ).loans;
  const { data: staff } = payment.created_by
    ? await supabase.from("profiles").select("full_name").eq("id", payment.created_by).maybeSingle()
    : { data: null };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment receipt"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Loans", href: "/dashboard/loans" },
          { label: loan?.ticket_number ?? "Loan", href: `/dashboard/loans/${id}` },
          { label: payment.receipt_number },
        ]}
        actions={
          <>
            <ButtonLink href={`/dashboard/loans/${id}`}>Back to ticket</ButtonLink>
            <PrintButton label="Print receipt" />
          </>
        }
      />

      <Card className="mx-auto max-w-md print:max-w-none print:border-2 print:border-navy-900 print:p-8">
        <div className="text-center">
          <p className="font-display text-xl font-semibold text-navy-900">CTM Pawnshop</p>
          <p className="text-xs uppercase tracking-wide text-slate-500">Official payment receipt</p>
        </div>
        <dl className="mt-6 space-y-2 text-sm">
          <Row label="Receipt no." value={<span className="font-mono">{payment.receipt_number}</span>} />
          <Row label="Date" value={formatDateTime(payment.created_at)} />
          <Row label="Pawn ticket" value={<span className="font-mono">{loan?.ticket_number}</span>} />
          <Row label="Received from" value={loan?.customers?.full_name ?? "—"} />
        </dl>
        <dl className="mt-4 space-y-2 border-t border-dashed border-slate-300 pt-4 text-sm">
          <Row label="Applied to interest" value={formatPeso(payment.interest_portion)} />
          <Row label="Applied to principal" value={formatPeso(payment.principal_portion)} />
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-navy-900">
            <dt>Amount paid</dt>
            <dd className="tabular-nums">{formatPeso(payment.amount)}</dd>
          </div>
        </dl>
        {payment.verified_via_lost_ticket && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Ticket reported lost — pawner identity verified by ID number.
          </p>
        )}
        <p className="mt-6 text-center text-xs text-slate-500">
          Received by {staff?.full_name ?? "CTM staff"}. Keep this receipt for your records.
        </p>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-right tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
