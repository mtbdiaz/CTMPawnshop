import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { addDaysIso, termInterest } from "@/lib/loans/accrual";
import { PawnTicketForm } from "./pawn-ticket-form";

export const metadata = { title: "Pawn ticket" };

export default async function TicketPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: loan } = await supabase
    .from("loans")
    .select("*, customers(full_name, address), appraisal_items(category, category_other, karat, weight_grams, computed_value, condition_notes)")
    .eq("id", id)
    .maybeSingle();
  if (!loan) notFound();
  const j = loan as unknown as {
    customers: { full_name: string; address: string } | null;
    appraisal_items: { category: string; category_other: string | null; karat: number; weight_grams: number; computed_value: number; condition_notes: string | null } | null;
  };
  const item = j.appraisal_items;
  const principal = Number(loan.principal_amount);
  const serviceCharge = 0; // No service fee is recorded in the system; shown as 0.00.
  return (
    <PawnTicketForm
      ticketNumber={loan.ticket_number}
      loanDate={loan.loan_date}
      maturityDate={loan.maturity_date}
      redemptionExpiry={addDaysIso(loan.maturity_date, loan.grace_period_days)}
      customerName={j.customers?.full_name ?? ""}
      address={j.customers?.address ?? ""}
      principal={principal}
      interestRatePercent={Number(loan.interest_rate_percent)}
      interest={termInterest(principal, Number(loan.interest_rate_percent))}
      serviceCharge={serviceCharge}
      appraised={item ? Number(item.computed_value) : null}
      description={
        item ? `${categoryLabel(item.category, item.category_other)}, ${item.karat}K gold, ${item.weight_grams} g${item.condition_notes ? `. ${item.condition_notes}` : ""}` : ""
      }
    />
  );
}
