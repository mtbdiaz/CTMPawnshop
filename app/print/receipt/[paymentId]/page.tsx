import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { SlipHeader, SlipRow, SlipRule } from "../../slip";

export const metadata = { title: "Receipt" };

export default async function ReceiptPrint({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("loan_payments")
    .select("*, loans(ticket_number, principal_balance, interest_owed, maturity_date, status, customers(full_name))")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) notFound();
  const loan = (
    payment as unknown as {
      loans: { ticket_number: string; principal_balance: number; interest_owed: number; maturity_date: string; status: string; customers: { full_name: string } | null } | null;
    }
  ).loans;
  const { data: staff } = payment.created_by ? await supabase.from("profiles").select("full_name").eq("id", payment.created_by).maybeSingle() : { data: null };

  return (
    <article>
      <SlipHeader title="OFFICIAL RECEIPT" />
      <SlipRule />
      <SlipRow label="Receipt">{payment.receipt_number}</SlipRow>
      <SlipRow label="Date">{formatDateTime(payment.created_at)}</SlipRow>
      <SlipRow label="Ticket">{loan?.ticket_number ?? ""}</SlipRow>
      <SlipRow label="From">{loan?.customers?.full_name ?? ""}</SlipRow>
      <SlipRule />
      <SlipRow label="To interest">{formatPeso(payment.interest_portion)}</SlipRow>
      <SlipRow label="To principal">{formatPeso(payment.principal_portion)}</SlipRow>
      <SlipRow label="AMOUNT PAID" strong>
        {formatPeso(payment.amount)}
      </SlipRow>
      <SlipRule />
      {loan && loan.status !== "redeemed" && (
        <>
          <SlipRow label="Principal left">{formatPeso(loan.principal_balance)}</SlipRow>
          <SlipRow label="Due date">{formatDate(loan.maturity_date)}</SlipRow>
          <SlipRule />
        </>
      )}
      {payment.verified_via_lost_ticket && <p>Ticket reported lost. Identity verified by ID number.</p>}
      <p>Received by {staff?.full_name ?? "CTM staff"}.</p>
      <p className="mt-2 text-center">Thank you. Keep this receipt.</p>
    </article>
  );
}
