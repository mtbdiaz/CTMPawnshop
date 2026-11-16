-- 0086 (Nov 16, 2026, QA report H-02 and H-03): the two Admin correction functions had no guard rails.
--  - admin_edit_payment could push a loan's principal balance below zero, and could change payments of closed loans
--    (a "redeemed" loan then owed money while its item was already released).
--  - admin_edit_loan worked on redeemed, forfeited and archived loans, and could raise the principal above what the
--    appraisal allows.
-- Now both lock the loan, refuse closed or archived loans, and refuse amounts that break the balance. Two CHECKs keep
-- balances from ever going negative (live data already satisfies them).
-- Not changed (needs the owner's rule): recalculating the interest of the current term when the principal changes.

alter table public.loans
  add constraint loans_principal_balance_nonneg check (principal_balance >= 0),
  add constraint loans_interest_owed_nonneg check (interest_owed >= 0);

create or replace function public.admin_edit_payment(p_id uuid, p_amount numeric, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare b public.loan_payments; a public.loan_payments; l public.loans; v_delta numeric; v_new_pp numeric; v_new_ip numeric; v_new_dp numeric; v_rest numeric;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than 0'; end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.loan_payments where id = p_id for update;
  if not found then raise exception 'Payment not found'; end if;
  select * into l from public.loans where id = b.loan_id for update;                    -- 0086: lock the loan too
  if l.archived_at is not null or l.status not in ('active', 'extended', 'reinstated', 'defaulted') then
    raise exception 'This loan is %, so its payments can no longer be corrected. Nothing was changed.', case when l.archived_at is not null then 'archived' else l.status::text end;
  end if;
  v_delta := round(p_amount - b.amount, 2);
  -- more money: all of it goes to principal (as before). Less money: principal first, then interest, then damages
  v_new_pp := greatest(0, b.principal_portion + v_delta);
  if l.principal_balance - (v_new_pp - b.principal_portion) < 0 then                    -- 0086: never more than the loan still owed
    raise exception 'That amount is more than this loan still owed (the highest is %). Nothing was changed.', to_char(b.amount + l.principal_balance, 'FM999,999,990.00');
  end if;
  v_rest := round(p_amount - v_new_pp, 2);                 -- what is left for damages and interest
  v_new_dp := least(b.damages_portion, v_rest);            -- 0073: damages keep their share as long as possible
  v_new_ip := round(v_rest - v_new_dp, 2);
  if v_new_ip < 0 then raise exception 'Invalid amount'; end if;
  update public.loan_payments set amount = p_amount, principal_portion = v_new_pp, interest_portion = v_new_ip, damages_portion = v_new_dp where id = p_id returning * into a;
  update public.loans set principal_balance = principal_balance - (v_new_pp - b.principal_portion),
    interest_owed = greatest(0, interest_owed - (v_new_ip - b.interest_portion)),
    damages_owed = greatest(0, damages_owed - (v_new_dp - b.damages_portion))
  where id = b.loan_id;
  if v_delta <> 0 then
    insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
    values ('adjustment', case when v_delta > 0 then 'in'::public.cash_flow_direction else 'out'::public.cash_flow_direction end, abs(v_delta), 'Admin correction to payment ' || b.receipt_number || ': ' || trim(p_reason), b.loan_id, auth.uid());
  end if;
  perform public.ctm_log_admin_edit('loan_payments', p_id, trim(p_reason), to_jsonb(b), to_jsonb(a));
end $function$;

create or replace function public.admin_edit_loan(p_id uuid, p_principal_amount numeric, p_interest_rate_percent numeric, p_maturity_date date, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare b public.loans; a public.loans; v_delta numeric; v_max numeric;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.loans where id = p_id for update;
  if not found then raise exception 'Loan not found'; end if;
  if b.archived_at is not null or b.status not in ('active', 'extended', 'reinstated', 'defaulted') then   -- 0086
    raise exception 'This loan is %, so it can no longer be corrected. Nothing was changed.', case when b.archived_at is not null then 'archived' else b.status::text end;
  end if;
  if p_principal_amount is null or p_principal_amount <= 0 then raise exception 'Principal must be greater than 0'; end if;
  if p_interest_rate_percent is null or p_interest_rate_percent < 0 then raise exception 'Interest rate cannot be negative'; end if;
  select suggested_loan_max into v_max from public.appraisal_items where id = b.appraisal_item_id;   -- 0086: same cap as a new loan
  if p_principal_amount > b.principal_amount and v_max is not null and p_principal_amount > v_max then
    raise exception 'That principal is above the maximum for this item (%). Nothing was changed.', to_char(v_max, 'FM999,999,990.00');
  end if;
  v_delta := round(p_principal_amount - b.principal_amount, 2);
  if b.principal_balance + v_delta < 0 then raise exception 'That principal is lower than what has already been repaid.'; end if;
  update public.loans set principal_amount = p_principal_amount, principal_balance = principal_balance + v_delta, interest_rate_percent = p_interest_rate_percent,
    maturity_date = coalesce(p_maturity_date, maturity_date),
    interest_accrued_through = case when p_maturity_date is not null and p_maturity_date <> b.maturity_date then greatest(interest_accrued_through, p_maturity_date) else interest_accrued_through end,
    -- 0074: the liquidated damages count follows a new due date too (null = not written down yet: it already starts from the new date)
    damages_accrued_through = case when p_maturity_date is not null and p_maturity_date <> b.maturity_date and b.damages_accrued_through is not null
                                   then greatest(b.damages_accrued_through, p_maturity_date + coalesce(b.grace_period_days, 0)) else damages_accrued_through end
  where id = p_id returning * into a;
  if v_delta <> 0 then
    insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
    values ('adjustment', case when v_delta > 0 then 'out'::public.cash_flow_direction else 'in'::public.cash_flow_direction end, abs(v_delta), 'Admin correction to disbursement for ' || b.ticket_number || ': ' || trim(p_reason), p_id, auth.uid());
  end if;
  perform public.ctm_log_admin_edit('loans', p_id, trim(p_reason), to_jsonb(b), to_jsonb(a));
end $function$;
