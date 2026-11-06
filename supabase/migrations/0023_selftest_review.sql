-- Self-tests for the backend review fixes. Owner-only. Every test rolls back.
--   select * from public.ctm_selftest_review();
create or replace function public.ctm_selftest_review() returns table(test text, outcome text) language plpgsql as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  a_cust uuid; a_item uuid; n integer; m integer; t_item uuid;
begin
  select id into a_cust from customers where archived_at is null and not is_blacklisted order by created_at limit 1;
  select id into a_item from appraisal_items where status = 'available' and archived_at is null and is_counterfeit_risk and counterfeit_resolution = 'pending' limit 1;

  test := '#26 cashier cannot insert a loan directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    insert into loans (customer_id, appraisal_item_id, principal_amount, interest_rate_percent, principal_balance, maturity_date, grace_period_days, ticket_number)
    values (a_cust, a_item, 1000, 5, 1000, current_date + 30, 7, 'SELFTEST-1');
    raise exception 'ROWS:inserted';
  exception when others then outcome := case when sqlerrm like '%row-level security%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := '#26 a flagged item cannot be pawned through create_pawn_loan';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform create_pawn_loan(a_cust, a_item, 500, 'Vault A');
    raise exception 'ROWS:created';
  exception when others then outcome := case when sqlerrm like '%counterfeit risk%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := '#1 #2 default detection skips paid loans and leaves items in the vault';
  begin
    perform ctm_default_detection_core();
    select count(*) into n from loans where status = 'defaulted' and principal_balance <= 0 and interest_owed <= 0;
    select count(*) into m from loans l join inventory_items i on i.id = l.inventory_item_id where l.status = 'defaulted' and i.status = 'forfeited';
    raise exception 'RESULT:%:%', n, m;
  exception when others then outcome := case when sqlerrm = 'RESULT:0:0' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  return next;

  test := '#24 changing a cleared item''s karat sends it back to review; #27 appraised_by is locked';
  begin
    insert into appraisal_items (weight_grams, karat, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max,
      is_counterfeit_risk, counterfeit_resolution, appraised_by, category, status)
    values (5, 18, 2662.5, 70, 13312.5, 8386.88, 9318.75, true, 'cleared', appr_id, 'ring', 'available') returning id into t_item;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    update appraisal_items set karat = 21 where id = t_item;
    select count(*) into n from appraisal_items where id = t_item and counterfeit_resolution = 'pending';
    begin
      update appraisal_items set appraised_by = op_id where id = t_item;
      m := 0;
    exception when others then m := 1; end;
    raise exception 'RESULT:%:%', n, m;
  exception when others then outcome := case when sqlerrm = 'RESULT:1:1' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := '#11 a cashier can read other staff names';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    select count(*) into n from profiles;
    raise exception 'COUNT:%', n;
  exception when others then outcome := case when sqlerrm like 'COUNT:%' and split_part(sqlerrm, ':', 2)::int > 1 then 'PASS (' || sqlerrm || ')' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := '#25 an operator cannot upload item photos';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    insert into storage.objects (bucket_id, name) values ('item-photos', 'selftest-operator.jpg');
    raise exception 'ROWS:inserted';
  exception when others then outcome := case when sqlerrm like '%row-level security%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := '#10 a second active customer with the same ID is refused';
  begin
    insert into customers (full_name, address, contact_number, id_type, id_number)
    select 'Selftest Duplicate', address, contact_number, id_type, lower(replace(id_number, '-', ' ')) from customers where id = a_cust;
    raise exception 'ROWS:inserted';
  exception when others then outcome := case when sqlstate = '23505' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  return next;
end $$;
revoke all on function public.ctm_selftest_review() from public, anon, authenticated;
