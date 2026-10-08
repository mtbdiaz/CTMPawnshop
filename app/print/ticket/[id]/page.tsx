import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { TERM_DAYS, addDaysIso, termInterest } from "@/lib/loans/accrual";
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { SlipBlock, SlipHeader, SlipRow, SlipRule } from "../../slip";

export const metadata = { title: "Pawn ticket" };

export default async function TicketPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: loan } = await supabase
    .from("loans")
    .select("*, customers(full_name, address, contact_number, id_type, id_number), appraisal_items(category, category_other, karat, weight_grams, computed_value, condition_notes), inventory_items(vault_location)")
    .eq("id", id)
    .maybeSingle();
  if (!loan) notFound();
  const j = loan as unknown as {
    customers: { full_name: string; address: string; contact_number: string; id_type: string; id_number: string } | null;
    appraisal_items: { category: string; category_other: string | null; karat: number; weight_grams: number; computed_value: number; condition_notes: string | null } | null;
    inventory_items: { vault_location: string } | null;
  };
  const c = j.customers;
  const item = j.appraisal_items;
  const interest = termInterest(Number(loan.principal_amount), Number(loan.interest_rate_percent));

  return (
    <article>
      <SlipHeader title="PAWN TICKET" />
      <SlipRule />
      <SlipRow label="Ticket">{loan.ticket_number}</SlipRow>
      <SlipRow label="Issued">{formatDateTime(loan.created_at)}</SlipRow>
      <SlipRule />
      <SlipBlock label="Pawner">
        {c?.full_name}
        <br />
        {c?.address}
        <br />
        {c?.contact_number}
        <br />
        {c?.id_type} {c?.id_number}
      </SlipBlock>
      <SlipRule />
      <SlipBlock label="Item">
        {item ? `${categoryLabel(item.category, item.category_other)}, ${item.karat}K gold, ${item.weight_grams} g` : ""}
        {item?.condition_notes ? (
          <>
            <br />
            {item.condition_notes}
          </>
        ) : null}
      </SlipBlock>
      <SlipRow label="Appraised">{item ? formatPeso(item.computed_value) : ""}</SlipRow>
      <SlipRow label="Vault">{j.inventory_items?.vault_location ?? ""}</SlipRow>
      <SlipRule />
      <SlipRow label="Principal" strong>
        {formatPeso(loan.principal_amount)}
      </SlipRow>
      <SlipRow label={`Interest ${loan.interest_rate_percent}%/${TERM_DAYS}d`}>{formatPeso(interest)}</SlipRow>
      <SlipRow label="Loan date">{formatDate(loan.loan_date)}</SlipRow>
      <SlipRow label="Due date" strong>
        {formatDate(loan.maturity_date)}
      </SlipRow>
      <SlipRow label="Grace until">{formatDate(addDaysIso(loan.maturity_date, loan.grace_period_days))}</SlipRow>
      <SlipRule />
      <p className="text-[10px]">
        Present this ticket to redeem or renew. Unpaid interest accrues every {TERM_DAYS} days. If not redeemed or renewed by the end of
        the grace period, the item may be forfeited. A lost ticket requires the ID presented at the time of the loan.
      </p>
      <div className="mt-6 border-t border-black pt-0.5 text-[10px]">Pawner signature</div>
      <div className="mt-6 border-t border-black pt-0.5 text-[10px]">CTM representative</div>
    </article>
  );
}
