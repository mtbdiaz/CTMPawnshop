-- 0029 (Nov 9, 2026, Wush): #35 reminder logs can only be added through log_reminder (since PR #26 the app uses it).
-- Same pattern as 0021/0026: the policy stays but always says no, so a log can't be inserted through the API
-- without the checks (role, loan still due, double-click rule, method and result required).
-- Nothing here changes data. Self-test: select * from public.ctm_selftest_0029();   (every test rolls back)
alter policy "reminder_log: cashier or admin insert" on public.reminder_log with check (false);

create or replace function public.ctm_selftest_0029() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  due_loan uuid; n integer;
begin
  select id into due_loan from loans where status in ('active','extended','reinstated') and archived_at is null
    and (principal_balance > 0 or interest_owed > 0) and maturity_date between ctm_today() and ctm_today() + 3 limit 1;

  test := 'cashier cannot insert a reminder log directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    insert into reminder_log (loan_id, created_by) values (due_loan, cash_id);
    raise exception 'ROWS:inserted';
  exception when others then outcome := case when sqlerrm like '%row-level security%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'log_reminder still saves for a cashier';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform log_reminder(due_loan, 'call', 'reached', 'SELFTEST');
    execute 'reset role';
    select count(*) into n from reminder_log where loan_id = due_loan and notes = 'SELFTEST';
    outcome := case when n = 1 then 'PASS (saved, then rolled back)' else 'FAIL ' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0029() from public, anon, authenticated;
