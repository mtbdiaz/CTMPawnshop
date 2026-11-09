-- 0027 (Nov 9, 2026, Wush): #34 + #35 Reminders. Staff record HOW they contacted the customer, WHAT happened,
-- and an optional note, so the Admin can see it. Additive only: old logs keep empty method/outcome
-- (the page shows them as "Attempt logged"), and the current page keeps working until the new one is merged.
-- Self-test: select * from public.ctm_selftest_0027();   (every test rolls back)

create type public.reminder_method as enum ('call', 'sms', 'in_person', 'other');
-- reached = talked to the customer; message_sent = SMS/chat sent by hand; no_answer; wrong_number;
-- follow_up = needs another try or an Admin's attention (e.g. asked to call back, dispute)
create type public.reminder_outcome as enum ('reached', 'message_sent', 'no_answer', 'wrong_number', 'follow_up');

alter table public.reminder_log
  add column contact_method public.reminder_method,
  add column outcome public.reminder_outcome,
  add column notes text check (notes is null or char_length(notes) <= 500);

-- #35 one way in: checks the role and the loan, and refuses repeats, all inside the database.
-- The loan row is locked while checking, so two clicks at the exact same moment can't both save.
create or replace function public.log_reminder(p_loan_id uuid, p_method public.reminder_method, p_outcome public.reminder_outcome, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.loans; v_id uuid; v_note text := nullif(trim(p_notes), '');
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]); -- Cashier or Admin, same as before
  if p_method is null or p_outcome is null then raise exception 'Pick how you contacted the customer and what happened.'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'The note is too long (500 characters at most).'; end if;
  select * into l from public.loans where id = p_loan_id for update; -- lock: one log at a time per loan
  if not found then raise exception 'Loan not found.'; end if;
  if l.status not in ('active', 'extended', 'reinstated') or l.archived_at is not null then
    raise exception 'This loan is no longer open (redeemed, defaulted or archived).';
  end if;
  if l.principal_balance <= 0 and l.interest_owed <= 0 then
    raise exception 'This loan is fully paid, so it doesn''t need a payment reminder.';
  end if;
  if l.maturity_date < public.ctm_today() or l.maturity_date > public.ctm_today() + 3 then
    raise exception 'This loan isn''t due within 3 days any more. Reload the page.';
  end if;
  -- the same staff member logged this loan less than 2 minutes ago = a double click or a retry: keep the first one
  select id into v_id from public.reminder_log
    where loan_id = p_loan_id and created_by = auth.uid() and archived_at is null and sent_at > now() - interval '2 minutes'
    order by sent_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.reminder_log (loan_id, created_by, contact_method, outcome, notes)
    values (p_loan_id, auth.uid(), p_method, p_outcome, v_note) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.log_reminder(uuid, public.reminder_method, public.reminder_outcome, text) from public, anon;
grant execute on function public.log_reminder(uuid, public.reminder_method, public.reminder_outcome, text) to authenticated;

-- Self-test (owner only)
create or replace function public.ctm_selftest_0027() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- Cashier
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- Operator
  a_loan uuid; far_loan uuid; id1 uuid; id2 uuid; n integer; r record;
begin
  select id into a_loan from loans where status in ('active','extended','reinstated') and archived_at is null
    and (principal_balance > 0 or interest_owed > 0) and maturity_date between ctm_today() and ctm_today() + 3 limit 1;
  select id into far_loan from loans where status in ('active','extended') and archived_at is null and maturity_date > ctm_today() + 10 limit 1;

  test := 'cashier logs a call with outcome and note';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    id1 := log_reminder(a_loan, 'call', 'no_answer', '  Rang twice  ');
    execute 'reset role';
    select * into r from reminder_log where id = id1;
    outcome := case when r.created_by = cash_id and r.contact_method = 'call' and r.outcome = 'no_answer' and r.notes = 'Rang twice' then 'PASS' else 'FAIL saved ' || row_to_json(r)::text end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#35 a second click within 2 minutes saves nothing new';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    id1 := log_reminder(a_loan, 'sms', 'message_sent', null);
    id2 := log_reminder(a_loan, 'sms', 'message_sent', null);
    execute 'reset role';
    select count(*) into n from reminder_log where loan_id = a_loan and sent_at > now() - interval '1 minute';
    outcome := case when id1 = id2 and n = 1 then 'PASS (1 log)' else 'FAIL ' || n || ' logs' end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'operator cannot log a reminder';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform log_reminder(a_loan, 'call', 'reached', null);
    raise exception 'ROWS:saved';
  exception when others then outcome := case when sqlerrm like '%not allowed%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'a loan not due within 3 days is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform log_reminder(far_loan, 'call', 'reached', null);
    raise exception 'ROWS:saved';
  exception when others then outcome := case when sqlerrm like '%due within 3 days%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'missing outcome is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform log_reminder(a_loan, 'call', null, null);
    raise exception 'ROWS:saved';
  exception when others then outcome := case when sqlerrm like 'Pick how%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'not signed in (anon) cannot call it';
  begin
    execute 'set local role anon';
    perform log_reminder(a_loan, 'call', 'reached', null);
    raise exception 'ROWS:saved';
  exception when others then outcome := case when sqlerrm like '%permission denied%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0027() from public, anon, authenticated;
