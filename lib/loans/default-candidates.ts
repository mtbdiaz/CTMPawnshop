// L30: the loans "Check for defaults" would mark Defaulted today. READ-ONLY: this never changes a loan.
// Used twice so they always agree: the preview list the Admin sees, and the server check right before running.
import { createClient } from "@/lib/supabase/server";
import { pastGracePeriod, wouldBeDefaulted } from "./display"; // A1: the date rule, and the date rule + "still owes money"
import { addDaysIso } from "./accrual"; // due date + grace days

export type DefaultCandidate = {
  id: string;
  ticket_number: string;
  maturity_date: string;
  grace_period_days: number;
  principal_balance: number;
  interest_owed: number;
  interest_rate_percent: number;
  interest_accrued_through: string | null;
  status: string;
  loan_date: string;
  customers: { full_name: string } | null;
};

export async function loadDefaultCandidates(today: string) {
  const supabase = await createClient();
  // only running loans already past their due date can be past the grace period too, so ask for those
  const { data, error } = await supabase
    .from("loans")
    .select("id, ticket_number, maturity_date, grace_period_days, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, status, loan_date, archived_at, customers(full_name)")
    .in("status", ["active", "extended"]) // run_default_detection skips reinstated loans
    .is("archived_at", null)
    .lt("maturity_date", today)
    .order("maturity_date") // longest past due first
    .order("id"); // same date -> always the same order
  if (error) return { error, candidates: [] as DefaultCandidate[], paid: [] as DefaultCandidate[], skippedReinstated: 0 };
  const rows = (data ?? []) as unknown as (DefaultCandidate & { archived_at: string | null })[]; // the past-due running loans
  // A1: the exact database rule (past due date + grace days AND still owes money), in one shared function
  const candidates = rows.filter((l) => wouldBeDefaulted(l, today));
  // A1: past the grace period but owing ₱0. Since Matt's fix #1 the database SKIPS these, so they no longer block
  // the check. They are only listed, so the Admin knows the item is waiting to be released with Redeem.
  const paid = rows.filter((l) => pastGracePeriod(l, today) && !wouldBeDefaulted(l, today));
  // L31: reinstated loans past their grace period. The database NEVER checks these (Matt #3), so the Admin is told,
  // instead of a message that sounds like no running loan is past its grace period. Read-only, count only.
  const { data: reinstated } = await supabase
    .from("loans")
    .select("maturity_date, grace_period_days")
    .eq("status", "reinstated")
    .is("archived_at", null)
    .lt("maturity_date", today);
  const skippedReinstated = (reinstated ?? []).filter((l) => today > addDaysIso(l.maturity_date, Number(l.grace_period_days ?? 0))).length;
  return { error: null, candidates, paid, skippedReinstated };
}

// the list as one text, so the server can tell if it changed after the Admin looked at it
export function candidateKey(candidates: { id: string }[]): string {
  return candidates
    .map((c) => c.id)
    .sort()
    .join(",");
}
