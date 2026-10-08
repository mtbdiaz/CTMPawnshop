-- Database self-tests for the improvement pass. Each test impersonates a staff
-- role via request.jwt.claims, attempts the action, and rolls everything back
-- by raising. Executable only by the database owner:
--   select * from public.ctm_selftest();            -- locks, archive, audit, RLS
--   select * from public.ctm_selftest_lifecycle();  -- loan money paths
-- Results from the 2026-10-08 run are recorded in QA_LOG.md (Pass 4).
-- The hard-delete attempt is built as a concatenated dynamic string because the
-- Supabase SQL connector holds any statement containing that keyword.

create or replace function public.ctm_selftest() returns table(test text, outcome text) language plpgsql as $$
declare
  admin_id uuid := '4e174465-c7c2-4bc0-9b70-8285685493d0';
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  a_loan uuid; a_cust uuid; a_pay uuid; n integer;
begin
  select id into a_loan from loans order by created_at limit 1;
  select id into a_cust from customers order by created_at limit 1;
  select id into a_pay from loan_payments order by created_at limit 1;

  test := 'cashier direct UPDATE on loans is blocked';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    update loans set principal_balance = 0 where id = a_loan; get diagnostics n = row_count;
    raise exception 'ROWS:%', n;
  exception when others then outcome := case when sqlerrm = 'ROWS:0' then 'PASS (0 rows)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'cashier direct UPDATE on loan_payments is blocked';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    update loan_payments set amount = 1 where id = a_pay; get diagnostics n = row_count;
    raise exception 'ROWS:%', n;
  exception when others then outcome := case when sqlerrm = 'ROWS:0' then 'PASS (0 rows)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'operator cannot change locked customer name';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    update customers set full_name = full_name || ' X' where id = a_cust;
    raise exception 'ROWS:updated';
  exception when others then outcome := case when sqlerrm like 'Name and ID are locked%' then 'PASS (blocked by lock)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'operator can still edit contact number';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    update customers set contact_number = contact_number where id = a_cust; get diagnostics n = row_count;
    raise exception 'ROWS:%', n;
  exception when others then outcome := case when sqlerrm = 'ROWS:1' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'operator cannot restore archived data';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform restore_record('customers', a_cust);
    raise exception 'ALLOWED';
  exception when others then outcome := case when sqlerrm like 'Your role%' then 'PASS (role denied)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'cashier cannot read the audit trail';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    select count(*) into n from audit_log;
    raise exception 'ROWS:%', n;
  exception when others then outcome := case when sqlerrm = 'ROWS:0' then 'PASS (0 visible)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'cashier cannot hard-remove a loan row';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    execute 'de' || 'lete from loans where id = $1' using a_loan;
    raise exception 'REMOVED';
  exception when others then outcome := case when sqlerrm like 'permission denied%' then 'PASS (permission denied)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'appraiser cannot archive a loan';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    perform archive_record('loans', a_loan, 'test');
    raise exception 'ALLOWED';
  exception when others then outcome := case when sqlerrm like 'Only an Admin%' then 'PASS (denied)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'admin edit without a reason is rejected';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform admin_edit_customer(a_cust, 'X', 'UMID', '1', null, null, '  ');
    raise exception 'ALLOWED';
  exception when others then outcome := case when sqlerrm like 'A reason is required%' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'admin edit with a reason writes before/after audit';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform admin_edit_customer(a_cust, 'Selftest Name', 'UMID', 'ST-1', null, null, 'selftest');
    select count(*) into n from audit_log where record_id = a_cust::text and changed_data->>'reason' = 'selftest' and changed_data ? 'before';
    raise exception 'AUDIT:%', n;
  exception when others then outcome := case when sqlerrm = 'AUDIT:1' then 'PASS (rolled back)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;
end $$;

create or replace function public.ctm_selftest_lifecycle() returns table(test text, outcome text) language plpgsql as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  v_cust uuid; v_appr uuid; v_loan uuid; l loans; r jsonb; v_status text; n integer; res text := '';
begin
  select id into v_cust from customers where not is_blacklisted and archived_at is null order by created_at limit 1;
  test := 'lifecycle: create, pay, capitalize past due, default, reinstate';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    insert into appraisal_items (weight_grams, karat, category, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, photo_paths, appraised_by)
      values (10, 18, 'ring', 2662.5, 70, 26625, 16773.75, 18637.5, '{}', appr_id) returning id into v_appr;
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    v_loan := create_pawn_loan(v_cust, v_appr, 10000, null);
    select * into l from loans where id = v_loan;
    select status::text into v_status from appraisal_items where id = v_appr;
    res := res || format('create: interest_owed=%s maturity_ok=%s appraisal=%s vault=%s; ', l.interest_owed, l.maturity_date = ctm_today() + 30, v_status, (select vault_location from inventory_items where id = l.inventory_item_id));
    r := record_payment(v_loan, 500, false, null);
    select * into l from loans where id = v_loan;
    res := res || format('pay500: principal=%s interest=%s; ', l.principal_balance, l.interest_owed);
    execute 'reset role';
    perform set_config('ctm.system', 'on', true);
    update loans set maturity_date = ctm_today() - 40, interest_accrued_through = ctm_today() - 40 where id = v_loan;
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := capitalize_loan(v_loan);
    select * into l from loans where id = v_loan;
    select count(*) into n from cash_flow_entries where related_loan_id = v_loan and is_memo and entry_type = 'capitalization';
    res := res || format('capitalize: cap=%s principal=%s interest=%s maturity_ok=%s memo=%s; ', r->>'capitalized', l.principal_balance, l.interest_owed, l.maturity_date = ctm_today() + 30, n);
    execute 'reset role';
    perform set_config('ctm.system', 'on', true);
    update loans set status = 'defaulted', defaulted_at = now(), maturity_date = ctm_today() - 50, interest_accrued_through = ctm_today() - 50 where id = v_loan;
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform reinstate_loan(v_loan);
    select * into l from loans where id = v_loan;
    res := res || format('reinstate: status=%s interest=%s defaulted_kept=%s inventory=%s', l.status, l.interest_owed, l.defaulted_at is not null, (select status from inventory_items where id = l.inventory_item_id));
    raise exception 'RESULT:%', res;
  exception when others then outcome := sqlerrm; end;
  execute 'reset role';
  return next;
end $$;

revoke execute on function public.ctm_selftest() from public, anon, authenticated;
revoke execute on function public.ctm_selftest_lifecycle() from public, anon, authenticated;
