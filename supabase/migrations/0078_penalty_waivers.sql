-- 0078 (Nov 15, 2026, Matt + Claude): waiving a penalty (the liquidated damages of migration 0073).
-- Why: if CTM is closed (holiday, emergency, system trouble) the customer cannot pay or renew, so the penalty that
-- piles up is not the customer's fault. An Admin can waive it, for a written reason. Nothing is waived by itself.
--
-- What is a "penalty" here: the liquidated damages (2% of the unpaid principal per 30 days after the grace days).
-- Interest is not a penalty and is never waived by this.
--
-- How it works: waive_penalty() (Admin only) first writes the penalty down to today (the same step every payment
-- does), then lowers loans.damages_owed by the amount waived and saves one permanent row in loan_penalty_waivers.
-- The penalty is kept as "written down up to a day" (damages_accrued_through), so a waived amount is never added
-- again; only days after that day add new penalty, which is a new penalty and needs its own waiver.
-- No duplicate: the amount can't be more than the penalty still owed, the loan is locked while it runs, and the
-- form's one-time id (ctm_requests, kind 'waive') makes a double click save once.
-- A waiver moves no cash, so the ledger is untouched. The row is audited (audit_log) and can never be changed or deleted.
-- New table and function only; no existing loan, payment or ledger row is changed by this migration.

create table public.loan_penalty_waivers (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id),
  ticket_number text not null,                 -- the loan's reference, saved as it was
  customer_name text not null,                 -- the customer, saved as it was
  penalty_before numeric(12,2) not null check (penalty_before > 0),   -- the original penalty owed when it was waived
  amount_waived numeric(12,2) not null check (amount_waived > 0),
  penalty_after numeric(12,2) not null check (penalty_after >= 0),    -- the penalty still payable afterwards
  owed_before numeric(12,2) not null,          -- what the customer owed to redeem, before and after
  owed_after numeric(12,2) not null,
  reason_code text not null check (reason_code in ('shop_closed', 'business_closure', 'system_downtime', 'other')),
  reason_note text not null check (char_length(btrim(reason_note)) between 5 and 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  request_id uuid,
  is_demo boolean not null default false,
  constraint loan_penalty_waivers_math check (round(penalty_before - amount_waived, 2) = penalty_after)
);
create index loan_penalty_waivers_loan_idx on public.loan_penalty_waivers (loan_id, created_at desc);

alter table public.loan_penalty_waivers enable row level security;
create policy "loan_penalty_waivers: staff select" on public.loan_penalty_waivers for select to authenticated using (true);
revoke all on public.loan_penalty_waivers from anon, authenticated;
grant select on public.loan_penalty_waivers to authenticated;   -- written only by waive_penalty()

-- a waiver is a permanent record
create or replace function public.ctm_block_waiver_changes() returns trigger language plpgsql as $$
begin
  raise exception 'A penalty waiver is a permanent record and cannot be changed or deleted.';
end $$;
create trigger loan_penalty_waivers_no_change before update or delete on public.loan_penalty_waivers
  for each row execute function public.ctm_block_waiver_changes();
create trigger loan_penalty_waivers_audit after insert or update or delete on public.loan_penalty_waivers
  for each row execute function public.audit_trigger_fn();

create or replace function public.waive_penalty(
  p_loan_id uuid, p_reason_code text, p_note text, p_amount numeric default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.loans; v_seen jsonb; v_note text := btrim(coalesce(p_note, ''));
  v_before numeric; v_waive numeric; v_owed_before numeric; v_owed_after numeric; v_name text; v_id uuid; v_result jsonb;
begin
  perform public.ctm_assert_role(array['admin']::public.staff_role[]);   -- Admin only
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id for update;     -- locked: two Admins can't waive the same penalty
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  v_seen := public.ctm_request_seen(p_request_id, 'waive', p_loan_id);
  if v_seen is not null then return v_seen; end if;
  if p_reason_code is null or p_reason_code not in ('shop_closed', 'business_closure', 'system_downtime', 'other') then
    raise exception 'Pick the reason for the waiver.';
  end if;
  if char_length(v_note) < 5 then raise exception 'Write what happened (at least 5 characters).'; end if;
  if char_length(v_note) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  if l.status not in ('active', 'extended', 'reinstated', 'defaulted') then
    raise exception 'A penalty can only be waived on a loan that is still open or defaulted (this one is %).', l.status;
  end if;
  l := public.ctm_accrue_interest(p_loan_id);                            -- write the penalty (and interest) down to today
  v_before := l.damages_owed;
  if v_before <= 0 then raise exception 'There is no penalty to waive on this loan.'; end if;
  v_waive := coalesce(round(p_amount, 2), v_before);                     -- no amount = the whole penalty owed
  if v_waive <= 0 or v_waive > v_before then
    raise exception 'The amount to waive must be more than 0 and not more than the penalty owed (%).', to_char(v_before, 'FM999,999,990.00');
  end if;
  v_owed_before := public.owed_now(l);
  update public.loans set damages_owed = damages_owed - v_waive where id = p_loan_id returning * into l;
  v_owed_after := public.owed_now(l);
  select full_name into v_name from public.customers where id = l.customer_id;
  insert into public.loan_penalty_waivers (loan_id, ticket_number, customer_name, penalty_before, amount_waived, penalty_after,
    owed_before, owed_after, reason_code, reason_note, created_by, request_id)
  values (l.id, l.ticket_number, coalesce(v_name, ''), v_before, v_waive, round(v_before - v_waive, 2),
    v_owed_before, v_owed_after, p_reason_code, v_note, auth.uid(), p_request_id)
  returning id into v_id;
  v_result := jsonb_build_object('waiver_id', v_id, 'penalty_before', v_before, 'amount_waived', v_waive,
                                 'penalty_after', round(v_before - v_waive, 2), 'owed_after', v_owed_after);
  if p_request_id is not null then
    insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'waive', l.id, v_result);
  end if;
  return v_result;
end $$;
revoke all on function public.waive_penalty(uuid, text, text, numeric, uuid) from public, anon;
grant execute on function public.waive_penalty(uuid, text, text, numeric, uuid) to authenticated;
