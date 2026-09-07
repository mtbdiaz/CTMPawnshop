-- PB-17 AC2 hardening: loan creation must produce the loan, its matching
-- inventory record, and its initial cash flow entry together, not as three
-- separate client-side round trips. The previous implementation
-- (app/dashboard/loans/actions.ts:createLoan) issued three independent
-- `insert` calls from the Next.js server action; if the second or third
-- insert failed (network blip, a table-level RLS/constraint rejection,
-- etc.) the earlier insert(s) were left committed, orphaning an
-- inventory_items row with no loan, or a loan with no cash flow entry.
-- This wraps all three writes in a single Postgres function so they commit
-- or roll back together. Runs with the caller's own privileges (no
-- `security definer`) so the existing per-table RLS insert policies
-- (cashier/admin on loans, cashier/operator/admin on inventory_items and
-- cash_flow_entries) still apply exactly as before — this only fixes
-- atomicity, not authorization.
create or replace function public.create_pawn_loan(
  p_customer_id uuid,
  p_appraisal_item_id uuid,
  p_vault_location text,
  p_principal_amount numeric,
  p_interest_rate_percent numeric,
  p_grace_period_days integer,
  p_loan_date date,
  p_maturity_date date,
  p_ticket_number text,
  p_created_by uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_inventory_id uuid;
  v_loan_id uuid;
begin
  insert into public.inventory_items (appraisal_item_id, vault_location, status)
  values (p_appraisal_item_id, p_vault_location, 'pawned')
  returning id into v_inventory_id;

  insert into public.loans (
    customer_id, appraisal_item_id, inventory_item_id,
    principal_amount, principal_balance, interest_rate_percent,
    grace_period_days, loan_date, maturity_date, ticket_number, created_by
  )
  values (
    p_customer_id, p_appraisal_item_id, v_inventory_id,
    p_principal_amount, p_principal_amount, p_interest_rate_percent,
    p_grace_period_days, p_loan_date, p_maturity_date, p_ticket_number, p_created_by
  )
  returning id into v_loan_id;

  insert into public.cash_flow_entries (
    entry_type, direction, amount, description, related_loan_id, created_by
  )
  values (
    'loan_disbursement', 'out', p_principal_amount,
    'Loan disbursed for item ' || p_appraisal_item_id, v_loan_id, p_created_by
  );

  return v_loan_id;
end;
$$;

grant execute on function public.create_pawn_loan(
  uuid, uuid, text, numeric, numeric, integer, date, date, text, uuid
) to authenticated;
