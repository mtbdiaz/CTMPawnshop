-- Self-tests for the owner decisions (0026, 0027).
-- 1. The lifecycle test capitalized a loan 40 days past due. With the 7-day grace period that is now refused (#30),
--    so it capitalizes 5 days past due instead: one term is charged (paid up to today + 25), new due date today + 55.
do $$
declare f text;
begin
  f := pg_get_functiondef('public.ctm_selftest_lifecycle()'::regprocedure);
  f := replace(f, 'update loans set maturity_date = ctm_today() - 40, interest_accrued_through = ctm_today() - 40 where id = v_loan;',
                  'update loans set maturity_date = ctm_today() - 5, interest_accrued_through = ctm_today() - 5 where id = v_loan;');
  f := replace(f, 'l.maturity_date = ctm_today() + 50, n);', 'l.maturity_date = ctm_today() + 55, n);');
  execute f;
end $$;

-- 2. ctm_selftest_decisions(): ID lockdown, reveal + VIEW audit, capitalize after grace, reinstated loans default again.
create or replace function public.ctm_selftest_decisions() returns table(test text, outcome text) language plpgsql as $f$
declare cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  a_cust uuid; a_loan uuid; v text; n int;
begin
  select id into a_cust from customers where archived_at is null order by created_at limit 1;
  select id into a_loan from loans where status in ('active','extended') and archived_at is null and principal_balance > 0 order by created_at limit 1;

  test := 'staff cannot select id_number directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    execute 'select id_number from customers limit 1' into v;
    raise exception 'READ';
  exception when others then outcome := case when sqlerrm like 'permission denied%' then 'PASS (permission denied)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'staff can still read other customer columns';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    select count(*) into n from customers where full_name is not null;
    raise exception 'ROWS:%', n;
  exception when others then outcome := case when sqlerrm like 'ROWS:%' and sqlerrm <> 'ROWS:0' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'cashier reveal returns the ID and writes a VIEW audit row';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    v := reveal_customer_id(a_cust);
    execute 'reset role';
    select count(*) into n from audit_log where record_id = a_cust::text and action = 'VIEW' and actor = cash_id and created_at > now() - interval '1 minute';
    raise exception 'GOT:% AUDIT:%', (v is not null), n;
  exception when others then outcome := case when sqlerrm = 'GOT:t AUDIT:1' then 'PASS (rolled back)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'appraiser cannot reveal an ID';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    v := reveal_customer_id(a_cust);
    raise exception 'ALLOWED';
  exception when others then outcome := case when sqlerrm like 'Your role%' then 'PASS (role denied)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'capitalize is refused after the grace period';
  begin
    perform set_config('ctm.system', 'on', true);
    update loans set maturity_date = ctm_today() - 60, interest_accrued_through = ctm_today() - 60 where id = a_loan;
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform capitalize_loan(a_loan);
    raise exception 'ALLOWED';
  exception when others then outcome := case when sqlerrm like 'The grace period ended%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'a reinstated loan past grace is defaulted again';
  begin
    perform set_config('ctm.system', 'on', true);
    update loans set status = 'reinstated', maturity_date = ctm_today() - 60 where id = a_loan;
    n := ctm_default_detection_core();
    select status::text into v from loans where id = a_loan;
    raise exception 'STATUS:%', v;
  exception when others then outcome := case when sqlerrm = 'STATUS:defaulted' then 'PASS (rolled back)' else 'FAIL ' || sqlerrm end; end;
  return next;
end $f$;
revoke execute on function public.ctm_selftest_decisions() from public, anon, authenticated;
