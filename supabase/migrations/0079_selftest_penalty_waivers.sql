-- Self-test for 0078 waive_penalty(). Every test rolls back: select * from public.ctm_selftest_0078();
-- It uses existing defaulted loans (past the grace days, so a penalty is owed) and puts everything back.
create or replace function public.ctm_selftest_0078() returns table(test text, outcome text) language plpgsql as $f$
declare
  admin_id uuid := '4e174465-c7c2-4bc0-9b70-8285685493d0'; cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  v_loan uuid; v_loan2 uuid; v_done uuid; r jsonb; r2 jsonb; msg text; n int; pen numeric; owed numeric; owed2 numeric; dmg numeric;
  rid uuid := gen_random_uuid();
begin
  select id into v_loan from loans where status = 'defaulted' and archived_at is null and principal_balance > 0 and liquidated_damages_percent > 0 order by created_at limit 1;
  select id into v_loan2 from loans where status = 'defaulted' and archived_at is null and principal_balance > 0 and liquidated_damages_percent > 0 and id <> v_loan order by created_at limit 1;
  select id into v_done from loans where status = 'redeemed' and archived_at is null limit 1;
  select damages_owed + ctm_pending_damages(l.*), owed_now(l.*) into pen, owed from loans l where id = v_loan;

  test := 'an Admin waives the whole penalty: balance drops by exactly that, one record, audited';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := waive_penalty(v_loan, 'shop_closed', 'TEST shop was closed on the due date');
    execute 'reset role';
    select owed_now(l.*), damages_owed into owed2, dmg from loans l where id = v_loan;
    select count(*) into n from loan_penalty_waivers w where w.loan_id = v_loan and w.reason_code = 'shop_closed' and w.created_by = admin_id
      and w.penalty_before = pen and w.amount_waived = pen and w.penalty_after = 0 and w.ticket_number is not null and w.customer_name <> '';
    raise exception 'R:% % % %', (r ->> 'amount_waived')::numeric = pen, abs(owed2 - (owed - pen)) < 0.01 and dmg = 0, n,
      (select count(*) from audit_log where table_name = 'loan_penalty_waivers' and action = 'INSERT' and actor = admin_id and created_at > now() - interval '1 minute');
  exception when others then outcome := case when sqlerrm = 'R:t t 1 1' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'the same penalty cannot be waived twice, and a waived penalty is not added back later';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform waive_penalty(v_loan, 'shop_closed', 'TEST first waiver');
    begin perform waive_penalty(v_loan, 'shop_closed', 'TEST second waiver'); msg := 'ALLOWED'; exception when others then msg := sqlerrm; end;
    execute 'reset role';
    select owed_now(l.*) into owed from loans l where id = v_loan;
    perform ctm_accrue_interest(v_loan);                                   -- the nightly / payment write-down runs again
    select owed_now(l.*), damages_owed into owed2, dmg from loans l where id = v_loan;
    raise exception 'R:% % %', msg like 'There is no penalty to waive%', dmg = 0, abs(owed - owed2) < 0.01;
  exception when others then outcome := case when sqlerrm = 'R:t t t' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'a partial waiver leaves the rest payable; more than what is left is refused; then the rest can be waived';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := waive_penalty(v_loan, 'other', 'TEST part of it only', 0.01);
    begin perform waive_penalty(v_loan, 'other', 'TEST too much', pen); msg := 'ALLOWED'; exception when others then msg := sqlerrm; end;
    r2 := waive_penalty(v_loan, 'other', 'TEST the rest', round(pen - 0.01, 2));
    execute 'reset role';
    select count(*) into n from loan_penalty_waivers where loan_id = v_loan;
    raise exception 'R:% % % %', (r ->> 'penalty_after')::numeric = round(pen - 0.01, 2), msg like 'The amount to waive must be%', (r2 ->> 'penalty_after')::numeric = 0, n;
  exception when others then outcome := case when sqlerrm = 'R:t t t 2' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'a Cashier cannot waive; a missing reason or note is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform waive_penalty(v_loan, 'shop_closed', 'TEST cashier try'); msg := 'ALLOWED'; exception when others then msg := sqlerrm; end;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin perform waive_penalty(v_loan, 'because', 'TEST bad reason'); exception when others then msg := msg || '|' || sqlerrm; end;
    begin perform waive_penalty(v_loan, 'other', 'ab'); exception when others then msg := msg || '|' || sqlerrm; end;
    execute 'reset role';
    select count(*) into n from loan_penalty_waivers where loan_id = v_loan;
    raise exception 'R:% % % %', msg like 'Your role%', msg like '%Pick the reason for the waiver.%', msg like '%Write what happened%', n;
  exception when others then outcome := case when sqlerrm = 'R:t t t 0' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'the same form sent twice waives once; the same id on another loan is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := waive_penalty(v_loan, 'system_downtime', 'TEST double click', null, rid);
    r2 := waive_penalty(v_loan, 'system_downtime', 'TEST double click', null, rid);
    begin perform waive_penalty(v_loan2, 'system_downtime', 'TEST wrong loan', null, rid); msg := 'ALLOWED'; exception when others then msg := sqlerrm; end;
    execute 'reset role';
    select count(*) into n from loan_penalty_waivers where loan_id = v_loan;
    raise exception 'R:% % %', r = r2, n, msg like 'This form was already used%';
  exception when others then outcome := case when sqlerrm = 'R:t 1 t' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'a redeemed loan cannot have a penalty waived';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform waive_penalty(v_done, 'shop_closed', 'TEST redeemed');
    raise exception 'ALLOWED';
  exception when others then outcome := case when sqlerrm like 'A penalty can only be waived on a loan that is still open%' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'records cannot be written, changed or deleted directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin insert into loan_penalty_waivers (loan_id, ticket_number, customer_name, penalty_before, amount_waived, penalty_after, owed_before, owed_after, reason_code, reason_note, created_by)
      values (v_loan, 'x', 'x', 10, 10, 0, 10, 0, 'other', 'TEST direct insert', admin_id); msg := 'ALLOWED'; exception when others then msg := sqlerrm; end;
    execute 'reset role';
    perform waive_penalty(v_loan, 'other', 'TEST then try to change it');
    begin update loan_penalty_waivers set amount_waived = 1 where loan_id = v_loan; msg := msg || '|ALLOWED'; exception when others then msg := msg || '|' || sqlerrm; end;
    raise exception 'R:%', msg;
  exception when others then outcome := case when sqlerrm like 'R:%permission denied%permanent record%' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;
end $f$;
revoke execute on function public.ctm_selftest_0078() from public, anon, authenticated;
