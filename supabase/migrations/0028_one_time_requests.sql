-- 0028 (Nov 9, 2026, Wush): #31 a payment, renewal or capitalize can't be saved twice by a retry or a stale page,
-- and the Reminders double-click rule only skips a REAL repeat.
-- Nothing here changes existing data. The three loan functions keep their names and old calls still work
-- (the new inputs are optional), so the live site keeps working before the new front end is merged.
-- Self-test: select * from public.ctm_selftest_0028();   (every test rolls back)

-- 1. One row per form submit. The form sends a random id; if the same id comes again (network retry,
--    the browser re-sending), the function returns the first result instead of saving again.
--    Only the functions below write here (no insert policy); an Admin can read it.
create table public.ctm_requests (
  id uuid primary key,                         -- the id the form sent
  kind text not null,                          -- 'payment' / 'renew' / 'capitalize'
  loan_id uuid not null references public.loans(id),
  result jsonb,                                -- what the function returned the first time
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.ctm_requests enable row level security;
create policy "ctm_requests: admin read" on public.ctm_requests for select to authenticated using (public.is_admin());
revoke all on public.ctm_requests from anon;

-- the shared check: null = new request (go on); a result = already done (return it); wrong kind/loan = refuse
create or replace function public.ctm_request_seen(p_request_id uuid, p_kind text, p_loan_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare r public.ctm_requests;
begin
  if p_request_id is null then return null; end if;
  select * into r from public.ctm_requests where id = p_request_id;
  if not found then return null; end if;
  if r.kind <> p_kind or r.loan_id <> p_loan_id then raise exception 'This form was already used for something else. Reload the page.'; end if;
  return coalesce(r.result, '{}'::jsonb);
end $$;
revoke execute on function public.ctm_request_seen(uuid, text, uuid) from public, anon, authenticated;

-- 2. record_payment: + p_request_id, and the loan row is locked while paying (two payments at once wait in line)
drop function public.record_payment(uuid, numeric, boolean, text);
create function public.record_payment(p_loan_id uuid, p_amount numeric, p_lost_ticket boolean default false, p_id_confirm text default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.loans; v_id text; v_interest numeric; v_principal numeric; v_total numeric; v_receipt text; v_payment uuid; v_seen jsonb; v_result jsonb;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id for update; -- lock: one payment at a time per loan
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  v_seen := public.ctm_request_seen(p_request_id, 'payment', p_loan_id);
  if v_seen is not null then return v_seen; end if; -- #31 same form sent again: already saved, return the same receipt
  if l.status not in ('active','extended','reinstated') then raise exception 'Loan is % and accepts no further payments', l.status; end if;
  if p_lost_ticket then
    select id_number into v_id from public.customers where id = l.customer_id;
    if v_id is null or public.ctm_norm_id(v_id) <> public.ctm_norm_id(p_id_confirm) then raise exception 'ID number does not match our records for this customer.'; end if;
  end if;
  l := public.ctm_accrue_interest(p_loan_id);
  v_total := round(l.principal_balance + l.interest_owed, 2);
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than 0'; end if;
  if p_amount > v_total then raise exception 'Payment of % exceeds the total owed (%)', p_amount, v_total; end if;
  v_receipt := public.ctm_receipt_number();
  v_interest := least(p_amount, l.interest_owed);
  v_principal := least(p_amount - v_interest, l.principal_balance);
  insert into public.loan_payments (loan_id, amount, principal_portion, interest_portion, receipt_number, verified_via_lost_ticket, created_by)
  values (l.id, p_amount, v_principal, v_interest, v_receipt, coalesce(p_lost_ticket, false), auth.uid()) returning id into v_payment;
  update public.loans set principal_balance = principal_balance - v_principal, interest_owed = interest_owed - v_interest,
    lost_ticket_used = lost_ticket_used or coalesce(p_lost_ticket, false),
    late_payment_count = late_payment_count + case when public.ctm_today() > maturity_date then 1 else 0 end
  where id = l.id;
  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
  values ('payment_received', 'in', p_amount, 'Payment ' || v_receipt || ' for ' || l.ticket_number, l.id, auth.uid());
  v_result := jsonb_build_object('payment_id', v_payment, 'receipt_number', v_receipt);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'payment', l.id, v_result); end if;
  return v_result;
end $$;

-- 3. renew_loan: + p_request_id, + p_expected_maturity (the due date the page showed: if it changed, someone
--    already renewed in another tab or computer, so refuse instead of renewing twice), and the row lock
drop function public.renew_loan(uuid);
create function public.renew_loan(p_loan_id uuid, p_request_id uuid default null, p_expected_maturity date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.loans; v_collect numeric; v_new_maturity date; v_new_interest numeric; v_receipt text; v_old_maturity date; v_seen jsonb; v_result jsonb;
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
  v_collect := l.interest_owed;
  v_new_maturity := greatest(l.maturity_date, l.interest_accrued_through) + 30;
  v_new_interest := round(l.principal_balance * l.interest_rate_percent / 100, 2);
  insert into public.loan_extensions (loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, extension_type, created_by)
  values (l.id, l.maturity_date, v_new_maturity, v_new_interest, 'renewal', auth.uid());
  if v_collect > 0 then
    v_receipt := public.ctm_receipt_number();
    insert into public.loan_payments (loan_id, amount, principal_portion, interest_portion, receipt_number, created_by) values (l.id, v_collect, 0, v_collect, v_receipt, auth.uid());
    insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
    values ('payment_received', 'in', v_collect, 'Renewal interest ' || v_receipt || ' for ' || l.ticket_number, l.id, auth.uid());
  end if;
  update public.loans set maturity_date = v_new_maturity, interest_accrued_through = v_new_maturity, interest_owed = v_new_interest,
    extension_count = extension_count + 1, status = 'extended',
    late_payment_count = late_payment_count + case when public.ctm_today() > v_old_maturity then 1 else 0 end
  where id = l.id;
  update public.inventory_items set status = 'extended' where id = l.inventory_item_id;
  v_result := jsonb_build_object('collected', v_collect, 'new_maturity', v_new_maturity, 'receipt_number', v_receipt);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'renew', l.id, v_result); end if;
  return v_result;
end $$;

-- 4. capitalize_loan: same two inputs and the row lock (a second capitalize would add interest to principal again)
drop function public.capitalize_loan(uuid);
create function public.capitalize_loan(p_loan_id uuid, p_request_id uuid default null, p_expected_maturity date default null)
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
  l := public.ctm_accrue_interest(p_loan_id);
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
    interest_accrued_through = v_new_maturity, extension_count = extension_count + 1, status = 'extended'
  where id = l.id;
  update public.inventory_items set status = 'extended' where id = l.inventory_item_id;
  v_result := jsonb_build_object('capitalized', v_cap, 'new_principal', v_new_principal, 'new_maturity', v_new_maturity, 'new_interest', v_new_interest);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'capitalize', l.id, v_result); end if;
  return v_result;
end $$;

-- same access as before: signed-in staff only (each function checks the role inside)
revoke execute on function public.record_payment(uuid, numeric, boolean, text, uuid) from public, anon;
revoke execute on function public.renew_loan(uuid, uuid, date) from public, anon;
revoke execute on function public.capitalize_loan(uuid, uuid, date) from public, anon;
grant execute on function public.record_payment(uuid, numeric, boolean, text, uuid) to authenticated;
grant execute on function public.renew_loan(uuid, uuid, date) to authenticated;
grant execute on function public.capitalize_loan(uuid, uuid, date) to authenticated;

-- 5. Reminders (#35): the 2-minute double-click rule now only skips a log with the SAME method, result and note.
--    Before, "No answer" then "Reached" a minute later kept only the first one.
do $$
declare f text;
begin
  f := pg_get_functiondef('public.log_reminder(uuid,public.reminder_method,public.reminder_outcome,text)'::regprocedure);
  f := replace(f, 'and sent_at > now() - interval ''2 minutes''',
                  'and sent_at > now() - interval ''2 minutes'' and contact_method = p_method and outcome = p_outcome and notes is not distinct from v_note');
  if position('notes is not distinct from v_note' in f) = 0 then raise exception '0028: log_reminder text not found'; end if;
  execute f;
end $$;

-- Self-test (owner only). Pretends to be the Cashier account; everything rolls back.
create or replace function public.ctm_selftest_0028() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  rid uuid := gen_random_uuid(); a_loan uuid; due_loan uuid; mat date; r1 jsonb; r2 jsonb; n integer; m integer;
begin
  select id, maturity_date into a_loan, mat from loans where status in ('active','extended') and archived_at is null
    and principal_balance > 100 and maturity_date >= ctm_today() order by maturity_date desc limit 1;
  select id into due_loan from loans where status in ('active','extended','reinstated') and archived_at is null
    and (principal_balance > 0 or interest_owed > 0) and maturity_date between ctm_today() and ctm_today() + 3 limit 1;

  test := '#31 the same payment sent twice is saved once (same receipt)';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r1 := record_payment(a_loan, 10, false, null, rid);
    r2 := record_payment(a_loan, 10, false, null, rid);
    execute 'reset role';
    select count(*) into n from loan_payments where loan_id = a_loan and created_at > now() - interval '1 minute';
    outcome := case when r1 = r2 and n = 1 then 'PASS (1 payment, receipt ' || (r1->>'receipt_number') || ')' else 'FAIL ' || n || ' payments' end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'old-style payment call (no request id) still works';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r1 := record_payment(a_loan, 10, false, null);
    outcome := case when r1 ? 'receipt_number' then 'PASS' else 'FAIL ' || r1::text end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#31 the same renewal sent twice renews once';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r1 := renew_loan(a_loan, rid, mat);
    r2 := renew_loan(a_loan, rid, mat);
    execute 'reset role';
    select count(*) into n from loan_extensions where loan_id = a_loan and created_at > now() - interval '1 minute';
    outcome := case when r1 = r2 and n = 1 then 'PASS (1 renewal)' else 'FAIL ' || n || ' renewals' end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#31 renewing from a stale page (another tab already renewed) is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform renew_loan(a_loan, gen_random_uuid(), mat);       -- tab 1
    perform renew_loan(a_loan, gen_random_uuid(), mat);       -- tab 2, still showing the old due date
    raise exception 'ROWS:renewed twice';
  exception when others then outcome := case when sqlerrm like 'This loan changed since you opened the page%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := '#31 capitalize sent twice capitalizes once';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r1 := capitalize_loan(a_loan, rid, mat);
    r2 := capitalize_loan(a_loan, rid, mat);
    execute 'reset role';
    select count(*) into n from loan_extensions where loan_id = a_loan and extension_type = 'capitalized' and created_at > now() - interval '1 minute';
    outcome := case when r1 = r2 and n = 1 then 'PASS (1 capitalize)' else 'FAIL ' || n end;
    raise exception 'ROLLBACK';
  exception when others then
    if sqlerrm like 'There is no unpaid interest%' then outcome := 'SKIP (picked loan has no interest owed)';
    elsif sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'a request id reused on another loan is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform record_payment(a_loan, 10, false, null, rid);
    perform record_payment(due_loan, 10, false, null, rid);
    raise exception 'ROWS:saved';
  exception when others then outcome := case when sqlerrm like 'This form was already used%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'cashier cannot read or write ctm_requests directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    insert into ctm_requests (id, kind, loan_id) values (gen_random_uuid(), 'payment', a_loan);
    raise exception 'ROWS:inserted';
  exception when others then outcome := case when sqlerrm like '%row-level security%' or sqlerrm like '%permission denied%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := '#35 No answer then Reached a minute later: both logs kept; the same log twice: kept once';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform log_reminder(due_loan, 'call', 'no_answer', null);
    perform log_reminder(due_loan, 'call', 'reached', 'Will pay Friday');
    perform log_reminder(due_loan, 'call', 'reached', 'Will pay Friday');
    execute 'reset role';
    select count(*) into n from reminder_log where loan_id = due_loan and sent_at > now() - interval '1 minute';
    outcome := case when n = 2 then 'PASS (2 logs)' else 'FAIL ' || n || ' logs' end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0028() from public, anon, authenticated;
