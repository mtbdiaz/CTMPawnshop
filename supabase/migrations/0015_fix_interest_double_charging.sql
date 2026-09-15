-- BUG FIX: recordPayment (app/dashboard/loans/actions.ts) was recalculating
-- interest due as `principal_balance * interest_rate_percent / 100` fresh on
-- EVERY payment call, instead of charging interest once per interest period.
-- Since a partial payment only reduces principal_balance by the
-- non-interest remainder, calling recordPayment repeatedly in quick
-- succession (e.g. a cashier taking several partial payments the same day)
-- re-charged a fresh ~one-month interest hit on each call, compounding
-- wildly instead of settling a single period's interest. Observed live:
-- an ₱12,412.58 loan took 8 payments totaling ~₱14,842 in one day to reach
-- a ₱0 balance — ~₱2,430 of that was interest re-charged on the same
-- interest period, not real accrued interest.
--
-- Fix: track the interest owed for the CURRENT period as its own
-- persisted, monotonically-decreasing column (`interest_owed`), set once
-- when the loan is created or extended, and only ever paid down — never
-- recomputed from the shrinking principal balance on each payment.

alter table public.loans
  add column interest_owed numeric(12,2) not null default 0;

-- Backfill: best-effort recovery for existing open loans — one period's
-- interest on the current balance. This cannot reconstruct interest that
-- was already correctly or incorrectly charged in the buggy payment
-- history; it only corrects the field going forward.
update public.loans
set interest_owed = round(principal_balance * (interest_rate_percent / 100), 2)
where status in ('active', 'extended') and principal_balance > 0;

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
    principal_amount, principal_balance, interest_rate_percent, interest_owed,
    grace_period_days, loan_date, maturity_date, ticket_number, created_by
  )
  values (
    p_customer_id, p_appraisal_item_id, v_inventory_id,
    p_principal_amount, p_principal_amount, p_interest_rate_percent,
    round(p_principal_amount * (p_interest_rate_percent / 100), 2),
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
