-- Improvement pass (owner review, Oct 2026). Additive only: new columns,
-- tables, functions and policies; existing rows backfilled, no data dropped.
-- Applied to the live project statement by statement (the Supabase connector
-- times out on long scripts); this file mirrors what was applied. Replaced
-- policies are neutralised with ALTER POLICY ... USING (false) rather than dropped.

---------------------------------------------------------------------------
-- 1. Archive columns on every business table (no hard deletes anywhere)
---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'customers','appraisal_items','loans','loan_payments','loan_extensions','inventory_items',
    'cash_flow_entries','auction_batches','physical_inventory_audits','suspicious_activity_flags','reminder_log'
  ] loop
    execute format('alter table public.%I add column if not exists archived_at timestamptz', t);
    execute format('alter table public.%I add column if not exists archived_by uuid references public.profiles(id)', t);
    execute format('alter table public.%I add column if not exists archive_reason text', t);
  end loop;
end $$;

-- Nobody deletes business data, including Admin: archive instead.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','appraisal_items','loans','loan_payments','loan_extensions','inventory_items','inventory_status_history',
    'cash_flow_entries','auction_batches','auction_batch_items','physical_inventory_audits','physical_inventory_audit_items',
    'suspicious_activity_flags','reminder_log','system_settings','profiles','audit_log'
  ] loop
    execute format('revoke delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;
alter default privileges in schema public revoke delete, truncate on tables from anon, authenticated;

---------------------------------------------------------------------------
-- 2-4. Appraisals: category, karat-price valuation, available/pawned pool
---------------------------------------------------------------------------
alter table public.appraisal_items add column if not exists category public.item_category not null default 'others';
alter table public.appraisal_items add column if not exists category_other text;
alter table public.appraisal_items add column if not exists status public.appraisal_status not null default 'available';
-- The appraisal calculator no longer asks for a customer or a purity test;
-- the customer is attached when the item is pawned. Legacy rows keep theirs.
alter table public.appraisal_items alter column customer_id drop not null;
alter table public.appraisal_items alter column purity_percent drop not null;
-- New appraisals: 24K/21K/18K only. NOT VALID keeps legacy rows readable.
-- New or changed karats must be 24/21/18; legacy rows keep theirs and stay
-- readable (a NOT VALID check would still fire when legacy rows are updated).
create or replace function public.guard_appraisal_karat() returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' or new.karat is distinct from old.karat) and new.karat not in (18, 21, 24) then
    raise exception 'Only 24K, 21K and 18K items are accepted.' using errcode = '23514';
  end if;
  return new;
end $$;
create or replace trigger appraisal_items_karat_check before insert or update on public.appraisal_items
  for each row execute function public.guard_appraisal_karat();

update public.appraisal_items a set status = 'pawned'
where status = 'available' and exists (select 1 from public.loans l where l.appraisal_item_id = a.id);

alter table public.system_settings add column if not exists price_24k numeric(12,2) not null default 0;
alter table public.system_settings add column if not exists price_21k numeric(12,2) not null default 0;
alter table public.system_settings add column if not exists price_18k numeric(12,2) not null default 0;
-- Seed from the old single gold price using standard fineness (21K = 87.5%, 18K = 75%).
update public.system_settings set
  price_24k = case when price_24k = 0 then gold_price_per_gram else price_24k end,
  price_21k = case when price_21k = 0 then round(gold_price_per_gram * 0.875, 2) else price_21k end,
  price_18k = case when price_18k = 0 then round(gold_price_per_gram * 0.75, 2) else price_18k end;

---------------------------------------------------------------------------
-- 6-8. Loan lifecycle history (score inputs, reinstate, capitalize)
---------------------------------------------------------------------------
alter table public.loans add column if not exists interest_accrued_through date;
alter table public.loans add column if not exists defaulted_at timestamptz;
alter table public.loans add column if not exists reinstated_at timestamptz;
alter table public.loans add column if not exists redeemed_at timestamptz;
alter table public.loans add column if not exists forfeited_at timestamptz;
alter table public.loans add column if not exists late_payment_count integer not null default 0;

update public.loans set interest_accrued_through = maturity_date where interest_accrued_through is null;
update public.loans set defaulted_at = ((maturity_date + grace_period_days)::timestamp at time zone 'Asia/Manila')
  where defaulted_at is null and status in ('defaulted', 'forfeited');
update public.loans set redeemed_at = updated_at where redeemed_at is null and status = 'redeemed';

alter table public.loan_extensions add column if not exists extension_type public.extension_type not null default 'renewal';
alter table public.loan_extensions add column if not exists capitalized_amount numeric(12,2) not null default 0;

-- Non-cash ledger memos (capitalized interest) are shown but never move the cash balance.
alter table public.cash_flow_entries add column if not exists is_memo boolean not null default false;

create table if not exists public.score_weights (
  key text primary key,
  value numeric not null,
  description text not null
);
alter table public.score_weights enable row level security;
create policy "score_weights: staff select" on public.score_weights for select to authenticated using (true);
create policy "score_weights: admin update" on public.score_weights for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, update on public.score_weights to authenticated;
insert into public.score_weights (key, value, description) values
  ('base', 60, 'Starting score for a customer with at least one loan'),
  ('redeemed_on_time', 8, 'Per loan redeemed with no late payment and no default'),
  ('renewal', 3, 'Per renewal or capitalization'),
  ('renewal_cap', 15, 'Maximum total points from renewals'),
  ('delinquent', -6, 'Per loan with a payment made after maturity (within grace)'),
  ('reinstated', -15, 'Per loan reinstated after default'),
  ('defaulted', -25, 'Per loan that defaulted or was forfeited'),
  ('currently_overdue', -10, 'Per open loan currently past maturity'),
  ('old_outcome_months', 24, 'Outcomes older than this many months count at the factor below'),
  ('old_outcome_factor', 0.5, 'Weight multiplier for old outcomes')
on conflict (key) do nothing;

-- Per-customer history counts (archived loans included on purpose).
create or replace view public.customer_history_summary with (security_invoker = true) as
select
  c.id as customer_id,
  count(l.id) as total_loans,
  count(l.id) filter (where l.status in ('active', 'extended', 'reinstated')) as active_loans,
  count(l.id) filter (where l.status = 'redeemed') as redeemed_loans,
  count(l.id) filter (where l.extension_count > 0) as renewed_loans,
  count(l.id) filter (where l.late_payment_count > 0) as delinquent_loans,
  count(l.id) filter (where l.reinstated_at is not null) as reinstated_loans,
  count(l.id) filter (where l.defaulted_at is not null or l.status in ('defaulted', 'forfeited')) as defaulted_loans
from public.customers c
left join public.loans l on l.customer_id = c.id
group by c.id;
grant select on public.customer_history_summary to authenticated;

---------------------------------------------------------------------------
-- 5. Locked records. Lifecycle changes go through SECURITY DEFINER functions
-- below, which set ctm.system for their transaction; Admin corrections go
-- through admin_edit_* (reason required, before/after audited).
---------------------------------------------------------------------------
alter policy "loans: cashier or admin update" on public.loans using (false) with check (false);

alter policy "appraisal_items: admin can update" on public.appraisal_items using (false) with check (false);
create policy "appraisal_items: appraiser or admin update available" on public.appraisal_items for update to authenticated
  using (public.get_my_role() in ('appraiser', 'admin') and status = 'available' and archived_at is null)
  with check (public.get_my_role() in ('appraiser', 'admin'));

create or replace function public.ctm_is_system() returns boolean language sql stable as $$
  select coalesce(current_setting('ctm.system', true), '') = 'on'
$$;

create or replace function public.guard_customer_locked() returns trigger language plpgsql set search_path = public as $$
begin
  if public.ctm_is_system() then return new; end if;
  if new.full_name is distinct from old.full_name or new.id_type is distinct from old.id_type
     or new.id_number is distinct from old.id_number then
    raise exception 'Name and ID are locked after registration. An Admin can correct them with Edit (Admin) and a reason.'
      using errcode = '42501';
  end if;
  if new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by
     or new.archive_reason is distinct from old.archive_reason then
    raise exception 'Use Archive / Restore to change archive status.' using errcode = '42501';
  end if;
  return new;
end $$;
create or replace trigger customers_guard_locked before update on public.customers for each row execute function public.guard_customer_locked();

create or replace function public.guard_appraisal_locked() returns trigger language plpgsql set search_path = public as $$
begin
  if public.ctm_is_system() then return new; end if;
  if new.status is distinct from old.status or new.customer_id is distinct from old.customer_id
     or new.archived_at is distinct from old.archived_at or new.archive_reason is distinct from old.archive_reason then
    raise exception 'Status, customer and archive fields change only through pawning or archiving.' using errcode = '42501';
  end if;
  if not public.is_admin() and (
       new.counterfeit_resolution is distinct from old.counterfeit_resolution
       or (old.is_counterfeit_risk and not new.is_counterfeit_risk)) then
    raise exception 'Only an Admin can resolve a counterfeit flag.' using errcode = '42501';
  end if;
  return new;
end $$;
create or replace trigger appraisal_items_guard_locked before update on public.appraisal_items for each row execute function public.guard_appraisal_locked();

---------------------------------------------------------------------------
-- Shared helpers
---------------------------------------------------------------------------
create or replace function public.ctm_assert_role(allowed public.staff_role[]) returns public.staff_role
language plpgsql stable security definer set search_path = public as $$
declare r public.staff_role;
begin
  select role into r from public.profiles where id = auth.uid() and is_active;
  if r is null then raise exception 'Not signed in, or the account is inactive.' using errcode = '42501'; end if;
  if r <> 'admin' and not (r = any(allowed)) then
    raise exception 'Your role (%) is not allowed to do this.', r using errcode = '42501';
  end if;
  return r;
end $$;

create or replace function public.ctm_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Manila')::date
$$;

create or replace function public.ctm_norm_id(v text) returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(v, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

create or replace function public.ctm_receipt_number() returns text language sql volatile as $$
  select 'RC-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDDHH24MISS') || '-' || upper(substr(md5(random()::text), 1, 4))
$$;

-- Charges one full term of interest for every 30-day period (or part of one)
-- that has started since interest was last accounted for. Same rule the
-- loan started with: interest is per 30-day term, a part-term counts in full.
create or replace function public.ctm_accrue_interest(p_loan uuid) returns public.loans
language plpgsql security definer set search_path = public as $$
declare
  l public.loans;
  n integer;
  term_interest numeric;
begin
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'Loan not found'; end if;
  if l.interest_accrued_through is null then l.interest_accrued_through := l.maturity_date; end if;
  if l.status in ('active', 'extended', 'reinstated', 'defaulted') and l.principal_balance > 0
     and public.ctm_today() > l.interest_accrued_through then
    n := ceil((public.ctm_today() - l.interest_accrued_through)::numeric / 30);
    term_interest := round(l.principal_balance * l.interest_rate_percent / 100, 2);
    update public.loans
      set interest_owed = interest_owed + n * term_interest,
          interest_accrued_through = l.interest_accrued_through + n * 30
      where id = p_loan
      returning * into l;
  end if;
  return l;
end $$;

---------------------------------------------------------------------------
-- Loan lifecycle (all locked-record writes happen here)
---------------------------------------------------------------------------
-- The previous 10-argument create_pawn_loan is left in place but revoked (see grants below).

create or replace function public.create_pawn_loan(
  p_customer_id uuid,
  p_appraisal_item_id uuid,
  p_principal_amount numeric,
  p_vault_location text default 'Vault A'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a public.appraisal_items;
  c public.customers;
  s public.system_settings;
  v_inventory uuid;
  v_loan uuid;
  v_today date := public.ctm_today();
  v_maturity date;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);

  select * into c from public.customers where id = p_customer_id;
  if not found or c.archived_at is not null then raise exception 'Customer not found'; end if;
  if c.is_blacklisted then raise exception 'Customer is blacklisted: %. Loan blocked.', coalesce(c.blacklist_reason, 'no reason on file'); end if;

  select * into a from public.appraisal_items where id = p_appraisal_item_id for update;
  if not found or a.archived_at is not null then raise exception 'Appraised item not found'; end if;
  if a.status <> 'available' then raise exception 'This item is already pawned. Record a new appraisal.'; end if;
  if a.is_counterfeit_risk and a.counterfeit_resolution is distinct from 'cleared' then
    raise exception 'This item is flagged as a counterfeit risk and has not been cleared by an Admin.';
  end if;
  if p_principal_amount is null or p_principal_amount <= 0 then raise exception 'Loan amount must be greater than 0'; end if;
  if p_principal_amount > a.suggested_loan_max then
    raise exception 'Loan amount exceeds the maximum of %', a.suggested_loan_max;
  end if;

  select * into s from public.system_settings where id = 1;
  v_maturity := v_today + 30;

  insert into public.inventory_items (appraisal_item_id, vault_location, status)
  values (a.id, coalesce(nullif(trim(p_vault_location), ''), 'Vault A'), 'pawned')
  returning id into v_inventory;

  insert into public.loans (
    customer_id, appraisal_item_id, inventory_item_id, principal_amount, principal_balance,
    interest_rate_percent, interest_owed, interest_accrued_through, grace_period_days,
    loan_date, maturity_date, ticket_number, created_by
  ) values (
    c.id, a.id, v_inventory, p_principal_amount, p_principal_amount,
    s.interest_rate_percent, round(p_principal_amount * s.interest_rate_percent / 100, 2), v_maturity, s.grace_period_days,
    v_today, v_maturity,
    'PT-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDDHH24MISS') || '-' || upper(substr(md5(random()::text), 1, 4)),
    auth.uid()
  ) returning id into v_loan;

  update public.appraisal_items set status = 'pawned', customer_id = c.id where id = a.id;

  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
  values ('loan_disbursement', 'out', p_principal_amount, 'Loan disbursed', v_loan, auth.uid());

  return v_loan;
end $$;

create or replace function public.record_payment(
  p_loan_id uuid, p_amount numeric, p_lost_ticket boolean default false, p_id_confirm text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.loans;
  v_id text;
  v_interest numeric;
  v_principal numeric;
  v_total numeric;
  v_receipt text := public.ctm_receipt_number();
  v_payment uuid;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  if l.status not in ('active', 'extended', 'reinstated') then raise exception 'Loan is % and accepts no further payments', l.status; end if;
  if p_lost_ticket then
    select id_number into v_id from public.customers where id = l.customer_id;
    if v_id is null or public.ctm_norm_id(v_id) <> public.ctm_norm_id(p_id_confirm) then
      raise exception 'ID number does not match our records for this customer.';
    end if;
  end if;

  l := public.ctm_accrue_interest(p_loan_id);
  v_total := round(l.principal_balance + l.interest_owed, 2);
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than 0'; end if;
  if p_amount > v_total then raise exception 'Payment of % exceeds the total owed (%)', p_amount, v_total; end if;

  v_interest := least(p_amount, l.interest_owed);
  v_principal := least(p_amount - v_interest, l.principal_balance);

  insert into public.loan_payments (loan_id, amount, principal_portion, interest_portion, receipt_number, verified_via_lost_ticket, created_by)
  values (l.id, p_amount, v_principal, v_interest, v_receipt, coalesce(p_lost_ticket, false), auth.uid())
  returning id into v_payment;

  update public.loans set
    principal_balance = principal_balance - v_principal,
    interest_owed = interest_owed - v_interest,
    lost_ticket_used = lost_ticket_used or coalesce(p_lost_ticket, false),
    late_payment_count = late_payment_count + case when public.ctm_today() > maturity_date then 1 else 0 end
  where id = l.id;

  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
  values ('payment_received', 'in', p_amount, 'Payment ' || v_receipt || ' for ' || l.ticket_number, l.id, auth.uid());

  return jsonb_build_object('payment_id', v_payment, 'receipt_number', v_receipt);
end $$;

-- PB-19 pay-and-renew: collect all interest owed, start a fresh 30-day term.
create or replace function public.renew_loan(p_loan_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.loans;
  v_collect numeric;
  v_new_maturity date;
  v_new_interest numeric;
  v_receipt text := public.ctm_receipt_number();
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  if l.status not in ('active', 'extended', 'reinstated') then raise exception 'Loan is % and cannot be renewed', l.status; end if;
  if l.principal_balance <= 0 then raise exception 'This loan is fully paid. Redeem the item instead.'; end if;
  if l.status <> 'reinstated' and public.ctm_today() > l.maturity_date + l.grace_period_days then
    raise exception 'Grace period has expired. This loan can no longer be renewed.';
  end if;

  l := public.ctm_accrue_interest(p_loan_id);
  v_collect := l.interest_owed;
  v_new_maturity := greatest(l.maturity_date, l.interest_accrued_through) + 30;
  v_new_interest := round(l.principal_balance * l.interest_rate_percent / 100, 2);

  insert into public.loan_extensions (loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, extension_type, created_by)
  values (l.id, l.maturity_date, v_new_maturity, v_new_interest, 'renewal', auth.uid());

  if v_collect > 0 then
    insert into public.loan_payments (loan_id, amount, principal_portion, interest_portion, receipt_number, created_by)
    values (l.id, v_collect, 0, v_collect, v_receipt, auth.uid());
    insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
    values ('payment_received', 'in', v_collect, 'Renewal interest ' || v_receipt || ' for ' || l.ticket_number, l.id, auth.uid());
  end if;

  update public.loans set
    maturity_date = v_new_maturity,
    interest_accrued_through = v_new_maturity,
    interest_owed = v_new_interest,
    extension_count = extension_count + 1,
    status = 'extended',
    late_payment_count = late_payment_count + case when public.ctm_today() > l.maturity_date then 1 else 0 end
  where id = l.id;
  update public.inventory_items set status = 'extended' where id = l.inventory_item_id;

  return jsonb_build_object('collected', v_collect, 'new_maturity', v_new_maturity, 'receipt_number', case when v_collect > 0 then v_receipt end);
end $$;

-- Item 8: add unpaid interest to principal and extend one term. No cash moves.
create or replace function public.capitalize_loan(p_loan_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.loans;
  v_cap numeric;
  v_new_principal numeric;
  v_new_maturity date;
  v_new_interest numeric;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  if l.status not in ('active', 'extended', 'reinstated') then raise exception 'Loan is % and cannot be capitalized', l.status; end if;

  l := public.ctm_accrue_interest(p_loan_id);
  v_cap := round(l.interest_owed, 2);
  if v_cap <= 0 then raise exception 'There is no unpaid interest to capitalize. Use Renew instead.'; end if;

  v_new_principal := round(l.principal_balance + v_cap, 2);
  v_new_maturity := case when l.maturity_date >= public.ctm_today() then l.maturity_date + 30 else public.ctm_today() + 30 end;
  v_new_interest := round(v_new_principal * l.interest_rate_percent / 100, 2);

  insert into public.loan_extensions (loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, extension_type, capitalized_amount, created_by)
  values (l.id, l.maturity_date, v_new_maturity, v_new_interest, 'capitalized', v_cap, auth.uid());

  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by, is_memo)
  values ('capitalization', 'in', v_cap, 'Interest capitalized into principal (non-cash) for ' || l.ticket_number, l.id, auth.uid(), true);

  update public.loans set
    principal_balance = v_new_principal,
    interest_owed = v_new_interest,
    maturity_date = v_new_maturity,
    interest_accrued_through = v_new_maturity,
    extension_count = extension_count + 1,
    status = 'extended'
  where id = l.id;
  update public.inventory_items set status = 'extended' where id = l.inventory_item_id;

  return jsonb_build_object('capitalized', v_cap, 'new_principal', v_new_principal, 'new_maturity', v_new_maturity, 'new_interest', v_new_interest);
end $$;

create or replace function public.redeem_loan(p_loan_id uuid, p_lost_ticket boolean default false, p_id_confirm text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.loans; v_id text;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  if l.status not in ('active', 'extended', 'reinstated') then raise exception 'Loan is % and cannot be redeemed', l.status; end if;
  l := public.ctm_accrue_interest(p_loan_id);
  if l.principal_balance > 0 or l.interest_owed > 0 then
    raise exception 'Loan still has an outstanding balance of %', round(l.principal_balance + l.interest_owed, 2);
  end if;
  if p_lost_ticket then
    select id_number into v_id from public.customers where id = l.customer_id;
    if v_id is null or public.ctm_norm_id(v_id) <> public.ctm_norm_id(p_id_confirm) then
      raise exception 'ID number does not match our records for this customer.';
    end if;
  end if;
  update public.loans set status = 'redeemed', redeemed_at = now(), lost_ticket_used = lost_ticket_used or coalesce(p_lost_ticket, false)
  where id = l.id;
  update public.inventory_items set status = 'redeemed' where id = l.inventory_item_id;
end $$;

-- Item 7: a defaulted loan gets another chance. The default stays on record.
create or replace function public.reinstate_loan(p_loan_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.loans; v_inv public.inventory_status;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  if l.status <> 'defaulted' then raise exception 'Only a defaulted loan can be reinstated (this one is %)', l.status; end if;
  select status into v_inv from public.inventory_items where id = l.inventory_item_id;
  if v_inv = 'queued_for_auction' then raise exception 'The item is already queued for auction and cannot be reinstated.'; end if;
  update public.loans set status = 'reinstated', reinstated_at = now() where id = l.id;
  update public.inventory_items set status = 'pawned' where id = l.inventory_item_id;
  perform public.ctm_accrue_interest(p_loan_id);
end $$;

-- Admin confirms a default as final: the item now belongs to the shop.
create or replace function public.forfeit_loan(p_loan_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.loans;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id;
  if not found then raise exception 'Loan not found'; end if;
  if l.status <> 'defaulted' then raise exception 'Only a defaulted loan can be forfeited (this one is %)', l.status; end if;
  update public.loans set status = 'forfeited', forfeited_at = now() where id = l.id;
  update public.inventory_items set status = 'forfeited' where id = l.inventory_item_id and status <> 'queued_for_auction';
end $$;

-- PB-21: past maturity + grace -> defaulted. Reinstated loans are excluded.
create or replace function public.run_default_detection() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.ctm_assert_role(array['operator', 'cashier', 'appraiser']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  with d as (
    update public.loans set status = 'defaulted', defaulted_at = now()
    where status in ('active', 'extended') and archived_at is null
      and public.ctm_today() > maturity_date + grace_period_days
    returning inventory_item_id
  )
  update public.inventory_items i set status = 'forfeited' from d where i.id = d.inventory_item_id and i.status in ('pawned', 'extended');
  get diagnostics n = row_count;
  return n;
end $$;

---------------------------------------------------------------------------
-- 1. Archive / restore
---------------------------------------------------------------------------
create or replace function public.archive_record(p_table text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.staff_role;
  v_status text;
  v_open integer;
begin
  r := public.ctm_assert_role(array['appraiser']::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to archive a record.'; end if;
  if p_table not in ('customers','appraisal_items','loans','loan_payments','loan_extensions','inventory_items',
                     'cash_flow_entries','auction_batches','physical_inventory_audits','suspicious_activity_flags','reminder_log') then
    raise exception 'Records of type % cannot be archived', p_table;
  end if;
  if r <> 'admin' and p_table <> 'appraisal_items' then raise exception 'Only an Admin can archive this record.' using errcode = '42501'; end if;

  if p_table = 'appraisal_items' then
    select status::text into v_status from public.appraisal_items where id = p_id;
    if v_status is distinct from 'available' then raise exception 'Only items still in the appraisal pool can be archived.'; end if;
  elsif p_table = 'loans' then
    select status::text into v_status from public.loans where id = p_id;
    if v_status not in ('redeemed', 'forfeited') then raise exception 'Only closed loans (redeemed or forfeited) can be archived.'; end if;
  elsif p_table = 'customers' then
    select count(*) into v_open from public.loans where customer_id = p_id and status in ('active','extended','reinstated','defaulted');
    if v_open > 0 then raise exception 'This customer has open loans and cannot be archived.'; end if;
  end if;

  perform set_config('ctm.system', 'on', true);
  execute format('update public.%I set archived_at = now(), archived_by = $1, archive_reason = $2 where id = $3 and archived_at is null', p_table)
    using auth.uid(), trim(p_reason), p_id;
  if not found then raise exception 'Record not found or already archived'; end if;
end $$;

create or replace function public.restore_record(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if p_table not in ('customers','appraisal_items','loans','loan_payments','loan_extensions','inventory_items',
                     'cash_flow_entries','auction_batches','physical_inventory_audits','suspicious_activity_flags','reminder_log') then
    raise exception 'Records of type % cannot be restored', p_table;
  end if;
  perform set_config('ctm.system', 'on', true);
  execute format('update public.%I set archived_at = null, archived_by = null, archive_reason = null where id = $1 and archived_at is not null', p_table)
    using p_id;
  if not found then raise exception 'Record not found or not archived'; end if;
end $$;

---------------------------------------------------------------------------
-- 5. Admin corrections: reason required, before/after written to the audit trail
---------------------------------------------------------------------------
create or replace function public.ctm_log_admin_edit(p_table text, p_id uuid, p_reason text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (table_name, record_id, action, actor, changed_data)
  values (p_table, p_id::text, 'UPDATE', auth.uid(),
          jsonb_build_object('admin_edit', true, 'reason', p_reason, 'before', p_before, 'after', p_after));
$$;

create or replace function public.admin_edit_customer(
  p_id uuid, p_full_name text, p_id_type text, p_id_number text, p_contact_number text, p_address text, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare b public.customers; a public.customers;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  if coalesce(trim(p_full_name), '') = '' or coalesce(trim(p_id_type), '') = '' or coalesce(trim(p_id_number), '') = '' then
    raise exception 'Name, ID type and ID number are required.';
  end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.customers where id = p_id for update;
  if not found then raise exception 'Customer not found'; end if;
  update public.customers set full_name = trim(p_full_name), id_type = trim(p_id_type), id_number = trim(p_id_number),
    contact_number = coalesce(nullif(trim(p_contact_number), ''), contact_number), address = coalesce(nullif(trim(p_address), ''), address)
  where id = p_id returning * into a;
  perform public.ctm_log_admin_edit('customers', p_id, trim(p_reason), to_jsonb(b), to_jsonb(a));
end $$;

-- Principal edits keep the ledger consistent with a correcting cash entry
-- (never by rewriting the original disbursement).
create or replace function public.admin_edit_loan(
  p_id uuid, p_principal_amount numeric, p_interest_rate_percent numeric, p_maturity_date date, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare b public.loans; a public.loans; v_delta numeric;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.loans where id = p_id for update;
  if not found then raise exception 'Loan not found'; end if;
  if p_principal_amount is null or p_principal_amount <= 0 then raise exception 'Principal must be greater than 0'; end if;
  if p_interest_rate_percent is null or p_interest_rate_percent < 0 then raise exception 'Interest rate cannot be negative'; end if;
  v_delta := round(p_principal_amount - b.principal_amount, 2);
  if b.principal_balance + v_delta < 0 then raise exception 'That principal is lower than what has already been repaid.'; end if;

  update public.loans set
    principal_amount = p_principal_amount,
    principal_balance = principal_balance + v_delta,
    interest_rate_percent = p_interest_rate_percent,
    maturity_date = coalesce(p_maturity_date, maturity_date),
    interest_accrued_through = case when p_maturity_date is not null and p_maturity_date <> b.maturity_date
                                    then greatest(interest_accrued_through, p_maturity_date) else interest_accrued_through end
  where id = p_id returning * into a;

  if v_delta <> 0 then
    insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
    values ('adjustment', case when v_delta > 0 then 'out'::public.cash_flow_direction else 'in'::public.cash_flow_direction end, abs(v_delta),
            'Admin correction to disbursement for ' || b.ticket_number || ': ' || trim(p_reason), p_id, auth.uid());
  end if;
  perform public.ctm_log_admin_edit('loans', p_id, trim(p_reason), to_jsonb(b), to_jsonb(a));
end $$;

create or replace function public.admin_edit_payment(p_id uuid, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.loan_payments; a public.loan_payments; v_delta numeric; v_new_pp numeric; v_new_ip numeric;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than 0'; end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.loan_payments where id = p_id for update;
  if not found then raise exception 'Payment not found'; end if;
  v_delta := round(p_amount - b.amount, 2);
  -- Corrections land on principal first; a reduction larger than the principal portion comes off interest.
  v_new_pp := greatest(0, b.principal_portion + v_delta);
  v_new_ip := round(p_amount - v_new_pp, 2);
  if v_new_ip < 0 then raise exception 'Invalid amount'; end if;

  update public.loan_payments set amount = p_amount, principal_portion = v_new_pp, interest_portion = v_new_ip
  where id = p_id returning * into a;
  update public.loans set
    principal_balance = principal_balance - (v_new_pp - b.principal_portion),
    interest_owed = greatest(0, interest_owed - (v_new_ip - b.interest_portion))
  where id = b.loan_id;
  if v_delta <> 0 then
    insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
    values ('adjustment', case when v_delta > 0 then 'in'::public.cash_flow_direction else 'out'::public.cash_flow_direction end, abs(v_delta),
            'Admin correction to payment ' || b.receipt_number || ': ' || trim(p_reason), b.loan_id, auth.uid());
  end if;
  perform public.ctm_log_admin_edit('loan_payments', p_id, trim(p_reason), to_jsonb(b), to_jsonb(a));
end $$;

-- Manual expense/revenue lines are corrected in place; the ledger and
-- running balance are always recomputed from the entries.
create or replace function public.admin_edit_cash_entry(p_id uuid, p_amount numeric, p_description text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.cash_flow_entries; a public.cash_flow_entries;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than 0'; end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.cash_flow_entries where id = p_id for update;
  if not found then raise exception 'Entry not found'; end if;
  if b.entry_type not in ('expense', 'revenue') then
    raise exception 'Loan-linked entries are corrected through the loan or payment, not directly.';
  end if;
  update public.cash_flow_entries set amount = p_amount, description = coalesce(nullif(trim(p_description), ''), description)
  where id = p_id returning * into a;
  perform public.ctm_log_admin_edit('cash_flow_entries', p_id, trim(p_reason), to_jsonb(b), to_jsonb(a));
end $$;

---------------------------------------------------------------------------
-- Permissions on the new functions
---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'ctm_assert_role(public.staff_role[])', 'ctm_accrue_interest(uuid)', 'ctm_log_admin_edit(text, uuid, text, jsonb, jsonb)',
    'create_pawn_loan(uuid, uuid, text, numeric, numeric, integer, date, date, text, uuid)',
    'create_pawn_loan(uuid, uuid, numeric, text)', 'record_payment(uuid, numeric, boolean, text)', 'renew_loan(uuid)',
    'capitalize_loan(uuid)', 'redeem_loan(uuid, boolean, text)', 'reinstate_loan(uuid)', 'forfeit_loan(uuid)',
    'run_default_detection()', 'archive_record(text, uuid, text)', 'restore_record(text, uuid)',
    'admin_edit_customer(uuid, text, text, text, text, text, text)', 'admin_edit_loan(uuid, numeric, numeric, date, text)',
    'admin_edit_payment(uuid, numeric, text)', 'admin_edit_cash_entry(uuid, numeric, text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'create_pawn_loan(uuid, uuid, numeric, text)', 'record_payment(uuid, numeric, boolean, text)', 'renew_loan(uuid)',
    'capitalize_loan(uuid)', 'redeem_loan(uuid, boolean, text)', 'reinstate_loan(uuid)', 'forfeit_loan(uuid)',
    'run_default_detection()', 'archive_record(text, uuid, text)', 'restore_record(text, uuid)',
    'admin_edit_customer(uuid, text, text, text, text, text, text)', 'admin_edit_loan(uuid, numeric, numeric, date, text)',
    'admin_edit_payment(uuid, numeric, text)', 'admin_edit_cash_entry(uuid, numeric, text, text)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Item 10: Cashiers add items through the inline calculator in New Loan.
alter policy "appraisal_items: appraiser or admin can insert" on public.appraisal_items
  with check (public.get_my_role() in ('appraiser', 'cashier', 'admin'));
