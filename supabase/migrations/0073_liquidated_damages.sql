-- 0073 (Nov 14, 2026, Wush, from Matt's request): liquidated damages, the clause on CTM's pawn ticket:
--   "In case this loan is not paid on maturity date, the pawner hereby agrees to pay in addition to accrued interest,
--    2% per month of the principal as liquidated damages. For purposes of computing the amount of liquidated damages,
--    a fraction of a month shall be considered as one (1) full month."
--
-- Business rules (decided by the team, Nov 14):
--   - every loan, the ones already running too (the clause is already on CTM's printed tickets);
--   - "the principal" = the principal still unpaid (principal_balance), the same base the interest uses;
--   - the first month starts the day after the grace days end (maturity date + grace days); a month is 30 days, the
--     same as an interest term, and any part of a month counts as a full month;
--   - a payment pays the liquidated damages first, then the interest, then the principal;
--   - the % is a setting (Settings, default 2%) and is fixed on each loan when it is issued, like the interest rate.
--     Loans that exist now get 2%.
--   - it keeps adding up while the loan is running or defaulted and still has principal left; it stops for a
--     redeemed or forfeited loan. A renewal (Renew, automatic renewal, Capitalize) starts a new term, so the count
--     starts again from the new due date + grace days.
--
-- What changes in the data: three new loan columns, one new payment column and one new setting, all filled with their
-- defaults (2%, ₱0, empty). No amount on any existing loan, payment or ledger entry is changed by this migration.
-- What changes for staff: the amount to redeem a loan that is past its grace days now includes the liquidated
-- damages (today: the 148 defaulted loans, ₱44,970 in total). It is written down on the loan the next time a payment,
-- renewal or reinstatement runs (the same way the interest after the due date is).
-- Self-test: select * from public.ctm_selftest_0073();   (every test rolls back)

-- ---------- 1. the setting, the loan columns and the payment column ----------
alter table public.system_settings
  add column if not exists liquidated_damages_percent numeric(5,2) not null default 2;
alter table public.system_settings drop constraint if exists system_settings_ld_percent_check;
alter table public.system_settings add constraint system_settings_ld_percent_check check (liquidated_damages_percent >= 0 and liquidated_damages_percent <= 100);

alter table public.loans
  add column if not exists liquidated_damages_percent numeric(5,2) not null default 2,
  add column if not exists damages_owed numeric(12,2) not null default 0,
  add column if not exists damages_accrued_through date;
alter table public.loans drop constraint if exists loans_damages_owed_check;
alter table public.loans add constraint loans_damages_owed_check check (damages_owed >= 0);
alter table public.loans drop constraint if exists loans_ld_percent_check;
alter table public.loans add constraint loans_ld_percent_check check (liquidated_damages_percent >= 0 and liquidated_damages_percent <= 100);
comment on column public.loans.liquidated_damages_percent is '0073: liquidated damages, % of the unpaid principal per 30 days after the grace days; fixed when the loan is issued';
comment on column public.loans.damages_owed is '0073: liquidated damages written down and not paid yet';
comment on column public.loans.damages_accrued_through is '0073: liquidated damages are written down up to this day; null = none yet this term (they start after maturity_date + grace_period_days)';

alter table public.loan_payments add column if not exists damages_portion numeric(12,2) not null default 0;
alter table public.loan_payments drop constraint if exists loan_payments_damages_portion_check;
alter table public.loan_payments add constraint loan_payments_damages_portion_check check (damages_portion >= 0);
comment on column public.loan_payments.damages_portion is '0073: the part of this payment that paid liquidated damages (paid before interest and principal)';

-- a new loan takes the % in Settings at the moment it is issued (create_pawn_loan doesn't need to change)
create or replace function public.ctm_loan_damages_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.liquidated_damages_percent := coalesce((select liquidated_damages_percent from public.system_settings where id = 1), 2);
  return new;
end $$;
revoke all on function public.ctm_loan_damages_rate() from public, anon, authenticated;
drop trigger if exists loans_damages_rate on public.loans;
create trigger loans_damages_rate before insert on public.loans for each row execute function public.ctm_loan_damages_rate();

-- ---------- 2. how much is owed ----------
-- the day the liquidated damages count from (the day after this one is the first day of month 1)
create or replace function public.ctm_damages_start(l public.loans) returns date
language sql immutable set search_path = public as $$
  select coalesce(l.damages_accrued_through, l.maturity_date + coalesce(l.grace_period_days, 0))
$$;
-- liquidated damages not written down yet: each 30 days (or part of 30 days) since the start adds one month
create or replace function public.ctm_pending_damages(l public.loans) returns numeric
language sql stable set search_path = public as $$
  select case
    when l.status in ('active', 'extended', 'reinstated', 'defaulted') and l.principal_balance > 0 and l.liquidated_damages_percent > 0
         and public.ctm_today() > public.ctm_damages_start(l)
    then ceil((public.ctm_today() - public.ctm_damages_start(l))::numeric / 30) * round(l.principal_balance * l.liquidated_damages_percent / 100, 2)
    else 0::numeric
  end
$$;
revoke all on function public.ctm_damages_start(public.loans) from public, anon;
revoke all on function public.ctm_pending_damages(public.loans) from public, anon;
grant execute on function public.ctm_damages_start(public.loans) to authenticated, service_role;
grant execute on function public.ctm_pending_damages(public.loans) to authenticated, service_role;

-- owed now = principal + interest (with the terms after the due date) + liquidated damages (written down + not yet)
create or replace function public.owed_now(l public.loans) returns numeric
language sql stable set search_path = public as $$
  select case
    when l.status = 'forfeited' then null::numeric
    when l.status = 'redeemed' then 0::numeric
    else round(
      l.principal_balance + l.interest_owed
      + case
          when l.status in ('active', 'extended', 'reinstated', 'defaulted') and l.principal_balance > 0
               and public.ctm_today() > coalesce(l.interest_accrued_through, l.maturity_date)
          then ceil((public.ctm_today() - coalesce(l.interest_accrued_through, l.maturity_date))::numeric / 30)
               * round(l.principal_balance * l.interest_rate_percent / 100, 2)
          else 0
        end
      + l.damages_owed + public.ctm_pending_damages(l), 2)
  end
$$;

-- writes down the interest after the due date (as before) and now the liquidated damages too
create or replace function public.ctm_accrue_interest(p_loan uuid) returns public.loans
language plpgsql security definer set search_path = public as $$
declare l public.loans; n integer; term_interest numeric; v_start date; m integer; v_month numeric;
begin
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'Loan not found'; end if;
  if l.interest_accrued_through is null then l.interest_accrued_through := l.maturity_date; end if;
  if l.status in ('active','extended','reinstated','defaulted') and l.principal_balance > 0 and public.ctm_today() > l.interest_accrued_through then
    n := ceil((public.ctm_today() - l.interest_accrued_through)::numeric / 30);
    term_interest := round(l.principal_balance * l.interest_rate_percent / 100, 2);
    update public.loans set interest_owed = interest_owed + n * term_interest, interest_accrued_through = l.interest_accrued_through + n * 30
      where id = p_loan returning * into l;
  end if;
  -- 0073: liquidated damages, months of 30 days counted from the end of the grace days
  v_start := public.ctm_damages_start(l);
  if l.status in ('active','extended','reinstated','defaulted') and l.principal_balance > 0 and l.liquidated_damages_percent > 0 and public.ctm_today() > v_start then
    m := ceil((public.ctm_today() - v_start)::numeric / 30);
    v_month := round(l.principal_balance * l.liquidated_damages_percent / 100, 2);
    update public.loans set damages_owed = damages_owed + m * v_month, damages_accrued_through = v_start + m * 30
      where id = p_loan returning * into l;
  end if;
  return l;
end $$;

-- ---------- 3. payments: liquidated damages first, then interest, then principal ----------
create or replace function public.record_payment(p_loan_id uuid, p_amount numeric, p_lost_ticket boolean default false, p_id_confirm text default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.loans; v_id text; v_damages numeric; v_interest numeric; v_principal numeric; v_total numeric; v_receipt text; v_payment uuid; v_seen jsonb; v_result jsonb; v_renewed date;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id for update;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  v_seen := public.ctm_request_seen(p_request_id, 'payment', p_loan_id);
  if v_seen is not null then return v_seen; end if;
  if l.status not in ('active','extended','reinstated') then raise exception 'Loan is % and accepts no further payments', l.status; end if;
  if p_lost_ticket then
    select id_number into v_id from public.customers where id = l.customer_id;
    if v_id is null or public.ctm_norm_id(v_id) <> public.ctm_norm_id(p_id_confirm) then raise exception 'ID number does not match our records for this customer.'; end if;
  end if;
  l := public.ctm_accrue_interest(p_loan_id);
  v_total := round(l.principal_balance + l.interest_owed + l.damages_owed, 2);
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than 0'; end if;
  if p_amount > v_total then raise exception 'Payment of % exceeds the total owed (%)', p_amount, v_total; end if;
  v_receipt := public.ctm_receipt_number();
  v_damages := least(p_amount, l.damages_owed);                              -- 0073: liquidated damages first
  v_interest := least(p_amount - v_damages, l.interest_owed);                -- then interest
  v_principal := least(p_amount - v_damages - v_interest, l.principal_balance); -- then principal
  insert into public.loan_payments (loan_id, amount, principal_portion, interest_portion, damages_portion, receipt_number, verified_via_lost_ticket, created_by)
  values (l.id, p_amount, v_principal, v_interest, v_damages, v_receipt, coalesce(p_lost_ticket, false), auth.uid()) returning id into v_payment;
  update public.loans set principal_balance = principal_balance - v_principal, interest_owed = interest_owed - v_interest, damages_owed = damages_owed - v_damages,
    lost_ticket_used = lost_ticket_used or coalesce(p_lost_ticket, false),
    late_payment_count = late_payment_count + case when public.ctm_today() > maturity_date then 1 else 0 end
  where id = l.id;
  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
  values ('payment_received', 'in', p_amount, 'Payment ' || v_receipt || ' for ' || l.ticket_number, l.id, auth.uid());
  -- 0043: an overdue loan whose interest (and, 0073, liquidated damages) is now fully paid is renewed, like pressing Renew
  v_renewed := public.ctm_auto_renew(l.id, auth.uid());
  v_result := jsonb_build_object('payment_id', v_payment, 'receipt_number', v_receipt, 'renewed_to', v_renewed);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'payment', l.id, v_result); end if;
  return v_result;
end $$;

create or replace function public.redeem_loan(p_loan_id uuid, p_lost_ticket boolean default false, p_id_confirm text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.loans; v_id text;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  if l.status not in ('active','extended','reinstated') then raise exception 'Loan is % and cannot be redeemed', l.status; end if;
  l := public.ctm_accrue_interest(p_loan_id);
  if l.principal_balance > 0 or l.interest_owed > 0 or l.damages_owed > 0 then
    raise exception 'Loan still has an outstanding balance of %', round(l.principal_balance + l.interest_owed + l.damages_owed, 2);
  end if;
  if p_lost_ticket then
    select id_number into v_id from public.customers where id = l.customer_id;
    if v_id is null or public.ctm_norm_id(v_id) <> public.ctm_norm_id(p_id_confirm) then raise exception 'ID number does not match our records for this customer.'; end if;
  end if;
  update public.loans set status = 'redeemed', redeemed_at = now(), lost_ticket_used = lost_ticket_used or coalesce(p_lost_ticket, false) where id = l.id;
  update public.inventory_items set status = 'redeemed' where id = l.inventory_item_id;
end $$;

-- ---------- 4. renewals: collect the liquidated damages with the interest; the new term starts the count again ----------
create or replace function public.renew_loan(p_loan_id uuid, p_request_id uuid default null, p_expected_maturity date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.loans; v_collect numeric; v_damages numeric; v_new_maturity date; v_new_interest numeric; v_receipt text; v_old_maturity date; v_seen jsonb; v_result jsonb;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id for update;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  v_seen := public.ctm_request_seen(p_request_id, 'renew', p_loan_id);
  if v_seen is not null then return v_seen; end if;
  if p_expected_maturity is not null and l.maturity_date <> p_expected_maturity then
    raise exception 'This loan changed since you opened the page (due date is now %). Reload the page before renewing.', to_char(l.maturity_date, 'Mon FMDD, YYYY');
  end if;
  if l.status not in ('active','extended','reinstated') then raise exception 'Loan is % and cannot be renewed', l.status; end if;
  if l.principal_balance <= 0 then raise exception 'This loan is fully paid. Redeem the item instead.'; end if;
  if l.status <> 'reinstated' and public.ctm_today() > l.maturity_date + l.grace_period_days then raise exception 'Grace period has expired. This loan can no longer be renewed.'; end if;
  v_old_maturity := l.maturity_date;
  l := public.ctm_accrue_interest(p_loan_id);
  v_damages := l.damages_owed;                 -- 0073
  v_collect := l.interest_owed + v_damages;
  v_new_maturity := greatest(l.maturity_date, l.interest_accrued_through) + 30;
  v_new_interest := round(l.principal_balance * l.interest_rate_percent / 100, 2);
  insert into public.loan_extensions (loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, extension_type, created_by)
  values (l.id, l.maturity_date, v_new_maturity, v_new_interest, 'renewal', auth.uid());
  if v_collect > 0 then
    v_receipt := public.ctm_receipt_number();
    insert into public.loan_payments (loan_id, amount, principal_portion, interest_portion, damages_portion, receipt_number, created_by)
    values (l.id, v_collect, 0, l.interest_owed, v_damages, v_receipt, auth.uid());
    insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
    values ('payment_received', 'in', v_collect,
            case when v_damages > 0 then 'Renewal interest and liquidated damages ' else 'Renewal interest ' end || v_receipt || ' for ' || l.ticket_number, l.id, auth.uid());
  end if;
  update public.loans set maturity_date = v_new_maturity, interest_accrued_through = v_new_maturity, interest_owed = v_new_interest,
    damages_owed = 0, damages_accrued_through = null,
    extension_count = extension_count + 1, status = 'extended',
    late_payment_count = late_payment_count + case when public.ctm_today() > v_old_maturity then 1 else 0 end
  where id = l.id;
  update public.inventory_items set status = 'extended' where id = l.inventory_item_id;
  v_result := jsonb_build_object('collected', v_collect, 'damages', v_damages, 'new_maturity', v_new_maturity, 'receipt_number', v_receipt);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'renew', l.id, v_result); end if;
  return v_result;
end $$;

create or replace function public.ctm_auto_renew(p_loan uuid, p_by uuid) returns date
language plpgsql security definer set search_path = public as $$
declare l public.loans; v_new date; v_interest numeric;
begin
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan for update;
  if not found
     or l.archived_at is not null
     or l.status not in ('active', 'extended', 'reinstated')
     or l.principal_balance <= 0
     or l.interest_owed > 0
     or l.damages_owed > 0 -- 0073: liquidated damages still owed: not renewed yet
     or public.ctm_today() <= l.maturity_date
     or (l.status <> 'reinstated' and public.ctm_today() > l.maturity_date + coalesce(l.grace_period_days, 0))
  then
    return null;
  end if;
  v_new := greatest(l.maturity_date, coalesce(l.interest_accrued_through, l.maturity_date)) + 30;
  v_interest := round(l.principal_balance * l.interest_rate_percent / 100, 2);
  insert into public.loan_extensions (loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, extension_type, created_by)
  values (l.id, l.maturity_date, v_new, v_interest, 'renewal', p_by);
  update public.loans set maturity_date = v_new, interest_accrued_through = v_new, interest_owed = v_interest,
    damages_accrued_through = null, -- 0073: the new term starts the count again
    extension_count = extension_count + 1, status = 'extended'
  where id = l.id;
  update public.inventory_items set status = 'extended' where id = l.inventory_item_id;
  return v_new;
end $$;

create or replace function public.capitalize_loan(p_loan_id uuid, p_request_id uuid default null, p_expected_maturity date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.loans; v_cap numeric; v_new_principal numeric; v_new_maturity date; v_new_interest numeric; v_seen jsonb; v_result jsonb;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id for update;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  v_seen := public.ctm_request_seen(p_request_id, 'capitalize', p_loan_id);
  if v_seen is not null then return v_seen; end if;
  if p_expected_maturity is not null and l.maturity_date <> p_expected_maturity then
    raise exception 'This loan changed since you opened the page (due date is now %). Reload the page before capitalizing.', to_char(l.maturity_date, 'Mon FMDD, YYYY');
  end if;
  if l.status not in ('active','extended','reinstated') then raise exception 'Loan is % and cannot be capitalized', l.status; end if;
  if public.ctm_today() > l.maturity_date + l.grace_period_days then
    raise exception 'The grace period ended on %. This loan can no longer be capitalized.', to_char(l.maturity_date + l.grace_period_days, 'Mon FMDD, YYYY');
  end if;
  l := public.ctm_accrue_interest(p_loan_id);
  -- 0073: only interest is ever added to the principal; liquidated damages are paid in cash first
  if l.damages_owed > 0 then
    raise exception 'Liquidated damages of % must be paid first (Record payment). Capitalizing only adds interest to the principal.', l.damages_owed;
  end if;
  v_cap := round(l.interest_owed, 2);
  if v_cap <= 0 then raise exception 'There is no unpaid interest to capitalize. Use Renew instead.'; end if;
  v_new_principal := round(l.principal_balance + v_cap, 2);
  v_new_maturity := greatest(l.maturity_date, l.interest_accrued_through) + 30;
  v_new_interest := round(v_new_principal * l.interest_rate_percent / 100, 2);
  insert into public.loan_extensions (loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, extension_type, capitalized_amount, created_by)
  values (l.id, l.maturity_date, v_new_maturity, v_new_interest, 'capitalized', v_cap, auth.uid());
  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by, is_memo)
  values ('capitalization', 'in', v_cap, 'Interest capitalized into principal (non-cash) for ' || l.ticket_number, l.id, auth.uid(), true);
  update public.loans set principal_balance = v_new_principal, interest_owed = v_new_interest, maturity_date = v_new_maturity,
    interest_accrued_through = v_new_maturity, damages_accrued_through = null, extension_count = extension_count + 1, status = 'extended'
  where id = l.id;
  update public.inventory_items set status = 'extended' where id = l.inventory_item_id;
  v_result := jsonb_build_object('capitalized', v_cap, 'new_principal', v_new_principal, 'new_maturity', v_new_maturity, 'new_interest', v_new_interest);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'capitalize', l.id, v_result); end if;
  return v_result;
end $$;

-- ---------- 5. Admin payment correction: the change comes off principal first, then interest, then damages ----------
create or replace function public.admin_edit_payment(p_id uuid, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.loan_payments; a public.loan_payments; v_delta numeric; v_new_pp numeric; v_new_ip numeric; v_new_dp numeric; v_rest numeric;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than 0'; end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.loan_payments where id = p_id for update;
  if not found then raise exception 'Payment not found'; end if;
  v_delta := round(p_amount - b.amount, 2);
  -- more money: all of it goes to principal (as before). Less money: principal first, then interest, then damages
  v_new_pp := greatest(0, b.principal_portion + v_delta);
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
end $$;

-- ---------- 6. the 0036 test of owed_now (#23) adds the liquidated damages too ----------
-- That test checks that owed_now() equals what ctm_accrue_interest() writes down. ctm_accrue_interest() now also writes
-- down liquidated damages (damages_owed), so the test adds them; nothing else in it changes.
do $fix0036$
declare d text;
begin
  d := pg_get_functiondef('public.ctm_selftest_0036'::regproc);
  if position('if lo.principal_balance + lo.interest_owed <> r.expected' in d) = 0 then raise exception '0073: the 0036 test line was not found'; end if;
  execute replace(d, 'if lo.principal_balance + lo.interest_owed <> r.expected', 'if lo.principal_balance + lo.interest_owed + lo.damages_owed <> r.expected');
end $fix0036$;

-- ---------- 7. self-test ----------
create or replace function public.ctm_selftest_0073() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  admin_id uuid; s text; n int; d public.loans; l public.loans; p public.loan_payments; r jsonb; v numeric; v2 numeric; v_month numeric; v_months int;
  v_loans int; v_pay int; v_ledger int; v_audit int; v_lsum numeric;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select count(*), sum(principal_balance + interest_owed) into v_loans, v_lsum from loans;
  select count(*) into v_pay from loan_payments; select count(*) into v_ledger from cash_flow_entries; select count(*) into v_audit from audit_log;
  -- the defaulted loan furthest past its grace days (reinstate allowed: item not queued or sold)
  select l0.* into d from loans l0 join inventory_items i on i.id = l0.inventory_item_id
    where l0.status = 'defaulted' and l0.archived_at is null and l0.principal_balance > 0 and i.status not in ('queued_for_auction', 'sold')
    order by l0.maturity_date, l0.id limit 1;

  test := 'Owed now: running loans before the grace days end owe exactly what they owed before 0073; loans past the grace days add 2% of the unpaid principal for each 30 days or part of 30 days; every existing loan has 2%';
  begin
    -- before 0073: principal + interest (+ interest terms after the due date)
    select count(*) into n from loans l0 where l0.archived_at is null and l0.status not in ('redeemed', 'forfeited')
      and owed_now(l0) <> round(l0.principal_balance + l0.interest_owed
            + case when l0.status in ('active','extended','reinstated','defaulted') and l0.principal_balance > 0 and ctm_today() > coalesce(l0.interest_accrued_through, l0.maturity_date)
                   then ceil((ctm_today() - coalesce(l0.interest_accrued_through, l0.maturity_date))::numeric / 30) * round(l0.principal_balance * l0.interest_rate_percent / 100, 2) else 0 end
            + case when l0.principal_balance > 0 and ctm_today() > l0.maturity_date + l0.grace_period_days
                   then ceil((ctm_today() - (l0.maturity_date + l0.grace_period_days))::numeric / 30) * round(l0.principal_balance * 0.02, 2) else 0 end, 2);
    s := (n = 0)::text
      || ',' || ((select count(*) from loans where liquidated_damages_percent <> 2 and created_at < now() - interval '1 minute') = 0)::text
      || ',' || ((select count(*) from loans where damages_owed <> 0) = 0)::text
      || ',' || (ctm_pending_damages(d) > 0)::text;
    outcome := case when s = 'true,true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'A payment pays liquidated damages first, then interest, then principal; damages and interest paid -> the reinstated loan renews and the count starts again; paying the rest lets it be redeemed';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform reinstate_loan(d.id);
    execute 'reset role';
    select * into l from loans where id = d.id;
    v_months := ceil((ctm_today() - (d.maturity_date + d.grace_period_days))::numeric / 30);
    v_month := round(d.principal_balance * 2 / 100, 2);
    s := (l.damages_owed = v_months * v_month and l.damages_accrued_through = d.maturity_date + d.grace_period_days + v_months * 30)::text;
    -- 1) less than the damages: all of it is damages
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := record_payment(d.id, l.damages_owed - 1);
    execute 'reset role';
    select * into p from loan_payments where id = (r->>'payment_id')::uuid;
    s := s || ',' || (p.damages_portion = l.damages_owed - 1 and p.interest_portion = 0 and p.principal_portion = 0)::text;
    -- 2) the last ₱1 of damages + all the interest: the loan renews (reinstated loans can renew any time)
    select * into l from loans where id = d.id;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := record_payment(d.id, l.damages_owed + l.interest_owed);
    execute 'reset role';
    select * into p from loan_payments where id = (r->>'payment_id')::uuid;
    select * into l from loans where id = d.id;
    s := s || ',' || (p.damages_portion = 1 and p.principal_portion = 0 and r->>'renewed_to' is not null and l.damages_owed = 0 and l.damages_accrued_through is null and ctm_pending_damages(l) = 0)::text;
    -- 3) can't redeem while anything is owed; pay everything, then redeem
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform redeem_loan(d.id); s := s || ',x'; exception when others then s := s || ',' || (sqlerrm like 'Loan still has an outstanding balance%')::text; end;
    r := record_payment(d.id, owed_now(l));
    perform redeem_loan(d.id);
    execute 'reset role';
    select * into l from loans where id = d.id;
    s := s || ',' || (l.status = 'redeemed' and l.principal_balance = 0 and l.interest_owed = 0 and l.damages_owed = 0)::text;
    outcome := case when s = 'true,true,true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Renew collects interest + liquidated damages on one receipt and restarts the count; Capitalize refuses while damages are owed; an Admin correction takes money off principal, then interest, then damages';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform reinstate_loan(d.id);
    execute 'reset role';
    select * into l from loans where id = d.id;
    v := l.interest_owed; v2 := l.damages_owed;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := renew_loan(d.id);
    execute 'reset role';
    select * into p from loan_payments where receipt_number = r->>'receipt_number';
    select * into l from loans where id = d.id;
    s := ((r->>'collected')::numeric = v + v2 and (r->>'damages')::numeric = v2 and p.damages_portion = v2 and p.interest_portion = v
          and l.damages_owed = 0 and l.damages_accrued_through is null and owed_now(l) = l.principal_balance + l.interest_owed
          and exists (select 1 from cash_flow_entries c where c.related_loan_id = d.id and c.amount = v + v2 and c.description like 'Renewal interest and liquidated damages%'))::text;
    -- capitalize with damages owed (written down by hand inside this test only)
    update loans set damages_owed = 10 where id = d.id;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform capitalize_loan(d.id); s := s || ',x'; exception when others then s := s || ',' || (sqlerrm like 'Liquidated damages of%')::text; end;
    execute 'reset role';
    -- Admin correction of the renewal receipt: ₱1 less -> no principal in it, so interest goes down by ₱1, damages stay
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform admin_edit_payment(p.id, p.amount - 1, 'selftest 0073');
    execute 'reset role';
    select * into p from loan_payments where id = p.id;
    s := s || ',' || (p.damages_portion = v2 and p.interest_portion = v - 1 and p.principal_portion = 0)::text;
    outcome := case when s = 'true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'The % is a setting: a new loan takes the % in Settings (existing loans keep theirs); the setting refuses below 0 and above 100; only staff functions can change loans; nothing outside the tests changes';
  begin
    update system_settings set liquidated_damages_percent = 3 where id = 1;
    insert into loans select (jsonb_populate_record(null::loans, to_jsonb(d) || jsonb_build_object('id', gen_random_uuid(), 'ticket_number', 'ST0073-' || substr(md5(random()::text), 1, 8), 'liquidated_damages_percent', 9))).* returning * into l;
    s := (l.liquidated_damages_percent = 3 and (select liquidated_damages_percent from loans where id = d.id) = 2)::text;
    begin update system_settings set liquidated_damages_percent = -1 where id = 1; s := s || ',x'; exception when check_violation then s := s || ',true'; end;
    begin update system_settings set liquidated_damages_percent = 101 where id = 1; s := s || ',x'; exception when check_violation then s := s || ',true'; end;
    -- an Appraiser can't take a payment (unchanged rule)
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    begin perform record_payment(d.id, 1); s := s || ',x'; exception when others then s := s || ',' || (sqlerrm like '%not allowed%')::text; end;
    execute 'reset role';
    outcome := case when s = 'true,true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role';
  -- nothing left behind by the tests above
  if (select count(*) from loans) <> v_loans or (select sum(principal_balance + interest_owed) from loans) <> v_lsum or (select count(*) from loan_payments) <> v_pay
     or (select count(*) from cash_flow_entries) <> v_ledger or (select count(*) from audit_log) <> v_audit or (select liquidated_damages_percent from system_settings where id = 1) <> 2 then
    outcome := 'FAIL something changed after the tests';
  end if;
  return next;
end $$;
revoke all on function public.ctm_selftest_0073() from public, anon, authenticated;

-- applied only if these pass, and the earlier loan, payment, renewal (0043 automatic renewal, 0036 owed_now), report and
-- audit tests still pass. (Run before applying: all 224 tests, the only failures are lifecycle and review, which already
-- failed before 0073 because a later rule asks which customer an item belongs to.)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0073' t, * from public.ctm_selftest_0073() union all select '0072' t, * from public.ctm_selftest_0072()
    union all select '0071' t, * from public.ctm_selftest_0071() union all select '0070' t, * from public.ctm_selftest_0070()
    union all select '0069' t, * from public.ctm_selftest_0069() union all select '0068' t, * from public.ctm_selftest_0068()
    union all select '0067' t, * from public.ctm_selftest_0067() union all select '0066' t, * from public.ctm_selftest_0066()
    union all select '0065' t, * from public.ctm_selftest_0065() union all select '0064' t, * from public.ctm_selftest_0064()
    union all select '0063' t, * from public.ctm_selftest_0063() union all select '0062' t, * from public.ctm_selftest_0062()
    union all select '0058' t, * from public.ctm_selftest_0058() union all select '0038' t, * from public.ctm_selftest_0038()
    union all select '0043' t, * from public.ctm_selftest_0043() union all select '0036' t, * from public.ctm_selftest_0036()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0073 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
