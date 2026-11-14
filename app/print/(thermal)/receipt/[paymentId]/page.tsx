import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { SlipHeader, SlipRow, SlipRule } from "../../slip";

export const metadata = { title: "Receipt" };

// RA1 (Nov 14): only a Cashier or an Admin (admin always passes) prints an official receipt. The check is here in the
// page itself, not only in the print layout, because a layout and its page load at the same time.
// Before: any signed-in role could open a receipt by its link (the print layout let all four roles in).
// Operator: not allowed until the team confirms they need it. Signed out: sent to the login page.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReceiptPrint({ params }: { params: Promise<{ paymentId: string }> }) {
  await requireRole(["cashier"]);
  const { paymentId } = await params;
  if (!UUID.test(paymentId)) notFound(); // RA2: a made-up or broken link -> "not found", without asking the database
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
      {/* LD (0073): the liquidated damages part, only when the payment paid some.
          RC1 (Nov 14, page check): spelled out, "To liquidated damages" (was "To liq. damages"). The 80mm slip fits about
          42 characters per line at 11px, so the 21-character label and an amount up to ₱999,999.99 stay on one line. */}
      {Number(payment.damages_portion) > 0 && <SlipRow label="To liquidated damages">{formatPeso(payment.damages_portion)}</SlipRow>}
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
