-- 0058 (Nov 12, 2026, Wush): Cash & ledger. Correct, Archive and Restore of ledger entries are SWITCHED OFF for now,
-- for every role, also Admin. Decided by Wush on Nov 12 after the financial-safety review. TEMPORARY.
-- Why: Correct changes the amount of a saved entry, and Archive / Restore take an entry out of (or back into) the
--   totals. Each one changes the ledger balance and the report of a past period. There is an audit log, but the
--   books of a closed period should not move. Until Matt and accounting approve a proper reversal / adjustment
--   workflow, a saved ledger entry can't be changed, hidden or brought back by anyone.
-- What still works: recording a manual Expense or Revenue (record_cash_entry) and everything loans, payments,
--   renewals and auction sales write by themselves. Archive and Restore of OTHER records (customers, loans...) too.
-- What this means for staff: a mistake in a manual entry can't be fixed in the app right now. Tell the Admin and the
--   developer and write it down. Do NOT record a second entry to "balance" it.
-- No entry, no archive information and no audit record is changed or removed here.
-- To switch it back on later (after approval): make ctm_ledger_locked() return false, in a new migration.
-- Self-test: select * from public.ctm_selftest_0058();   (every test rolls back)

-- the switch (true = locked). Only read inside the functions below and by the page's read function.
create or replace function public.ctm_ledger_locked() returns boolean language sql immutable as $$ select true $$;
revoke all on function public.ctm_ledger_locked() from public, anon, authenticated;

do $patch$
declare d text; d0 text;
  msg text := 'Correcting, archiving and restoring ledger entries is switched off for now, for every role, until a reversal workflow is approved. Nothing was changed.';
begin
  -- Correct
  select pg_get_functiondef('public.admin_edit_cash_entry(uuid,numeric,text,text)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$  perform public.ctm_assert_role(array[]::public.staff_role[]);$a$,
    $b$  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if public.ctm_ledger_locked() then raise exception '$b$ || msg || $c$'; end if;$c$);
  if d = d0 then raise exception '0058: could not update admin_edit_cash_entry'; end if;
  execute d;
  -- Archive (only ledger entries; other tables are not touched)
  select pg_get_functiondef('public.archive_record(text,uuid,text)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$  elsif p_table = 'cash_flow_entries' then$a$,
    $b$  elsif p_table = 'cash_flow_entries' then
    if public.ctm_ledger_locked() then raise exception '$b$ || msg || $c$'; end if;$c$);
  if d = d0 then raise exception '0058: could not update archive_record'; end if;
  execute d;
  -- Restore (only ledger entries)
  select pg_get_functiondef('public.restore_record(text,uuid)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$  perform set_config('ctm.system', 'on', true);$a$,
    $b$  if p_table = 'cash_flow_entries' and public.ctm_ledger_locked() then raise exception '$b$ || msg || $c$'; end if;
  perform set_config('ctm.system', 'on', true);$c$);
  if d = d0 then raise exception '0058: could not update restore_record'; end if;
  execute d;
  -- the page is told the lock is on, so it explains it instead of showing buttons that would be refused
  select pg_get_functiondef('public.cash_ledger_page(text,text,text,text,date,date,boolean,integer,integer)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$        'entries', count(*),$a$, $b$        'entries', count(*),
        'changes_locked', public.ctm_ledger_locked(),$b$);
  if d = d0 then raise exception '0058: could not update cash_ledger_page'; end if;
  execute d;
end $patch$;

-- 0056's self-test had two tests that corrected and archived an entry as an Admin. That is switched off now, so
-- they move to ctm_selftest_0058 as "refused". The other two (running balance inside a filter, the under-review
-- notice) stay exactly as they were.
create or replace function public.ctm_selftest_0056() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  admin_id uuid; r jsonb; r2 jsonb; s text; ok boolean; ok2 boolean;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;

  test := 'Running balance inside a search or a filter is the real ledger balance after that entry (worked out again from every earlier entry), not a subtotal of the rows shown';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page(null, 'expense', null, null, null, null, false, 1, 100);
    r2 := cash_ledger_page('a', null, 'in', 'system', date '2026-08-01', date '2026-10-31', false, 3, 50);
    execute 'reset role';
    select bool_and((e->>'balance')::numeric = (select sum(case when c.is_memo then 0 when c.direction = 'in' then c.amount else -c.amount end) from cash_flow_entries c
              where c.archived_at is null and (c.created_at, c.id) <= ((e->>'created_at')::timestamptz, (e->>'id')::uuid))), count(*) > 0 into ok, ok2
    from (select e from jsonb_array_elements(r->'rows') e union all select e from jsonb_array_elements(r2->'rows') e) q;
    outcome := case when ok and ok2 and jsonb_array_length(r2->'rows') > 0 then 'PASS (' || (jsonb_array_length(r->'rows') + jsonb_array_length(r2->'rows')) || ' filtered rows checked)' else 'FAIL' end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  execute 'reset role'; return next;

  test := 'Under review: a Cashier and an Operator are told yes/no that the balance includes entries under review, without the count or the amount; an Admin gets both';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page()->'summary';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r2 := cash_ledger_page()->'summary';
    execute 'reset role';
    s := jsonb_typeof(r->'under_review') || ',' || jsonb_typeof(r->'check_count') || ',' || jsonb_typeof(r->'check_sum') || ',' || ((r->>'under_review')::boolean = ((r2->>'check_count')::int > 0))::text
      || ',' || jsonb_typeof(r2->'check_count') || ',' || ((r->>'balance')::numeric = (r2->>'balance')::numeric)::text;
    outcome := case when s = 'boolean,null,null,true,number,true' then 'PASS' else 'FAIL ' || s end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  execute 'reset role'; return next;
end $$;

create or replace function public.ctm_selftest_0058() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  admin_id uuid; who uuid; s text; m uuid; m2 uuid; sys uuid; h0 text; h1 text; a0 int; a1 int; r jsonb; b0 numeric; x uuid; x2 uuid; rid uuid := gen_random_uuid(); c0 int;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id into m from cash_flow_entries where related_loan_id is null and entry_type = 'expense' and not is_memo and archived_at is null order by created_at limit 1;            -- a manual entry
  select id into m2 from cash_flow_entries where related_loan_id is null and entry_type = 'revenue' and not is_memo and archived_at is null order by created_at limit 1;           -- another one (archived inside the test)
  select id into sys from cash_flow_entries where related_loan_id is not null and entry_type = 'payment_received' and archived_at is null order by created_at limit 1;              -- a system entry

  test := 'Locked for every role, also Admin: Correct, Archive and Restore of a ledger entry are refused (manual and system entries), and no amount, archive mark or audit record changes';
  begin
    if m is null or m2 is null or sys is null then outcome := 'SKIP (needs two manual entries and a system entry)'; raise exception 'ROLLBACK'; end if;
    perform set_config('ctm.system', 'on', true); -- an archived entry to try Restore on (inside this test only)
    update cash_flow_entries set archived_at = now(), archived_by = admin_id, archive_reason = 'TEST archived for the test' where id = m2;
    perform set_config('ctm.system', 'off', true);
    select md5(string_agg(c.id::text || c.amount || coalesce(c.description, '') || coalesce(c.archived_at::text, '') || coalesce(c.archive_reason, ''), '|' order by c.id)) into h0 from cash_flow_entries c;
    select count(*) into a0 from audit_log where table_name = 'cash_flow_entries';
    execute 'set local role authenticated';
    s := '';
    foreach who in array array[admin_id, op_id, cash_id, appr_id] loop
      perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
      begin perform admin_edit_cash_entry(m, 1, 'TEST', 'TEST reason'); s := s || 'CORRECTED';
      exception when others then s := s || case when sqlerrm like '%switched off for now%' then 'L' else 'r' end; end;
      begin perform admin_edit_cash_entry(sys, 1, 'TEST', 'TEST reason'); s := s || 'CORRECTED';
      exception when others then s := s || case when sqlerrm like '%switched off for now%' then 'L' else 'r' end; end;
      begin perform archive_record('cash_flow_entries', m, 'TEST reason'); s := s || 'ARCHIVED';
      exception when others then s := s || case when sqlerrm like '%switched off for now%' then 'L' else 'r' end; end;
      begin perform archive_record('cash_flow_entries', sys, 'TEST reason'); s := s || 'ARCHIVED';
      exception when others then s := s || case when sqlerrm like '%switched off for now%' then 'L' else 'r' end; end;
      begin perform restore_record('cash_flow_entries', m2); s := s || 'RESTORED';
      exception when others then s := s || case when sqlerrm like '%switched off for now%' then 'L' else 'r' end; end;
      s := s || ' ';
    end loop;
    execute 'reset role';
    select md5(string_agg(c.id::text || c.amount || coalesce(c.description, '') || coalesce(c.archived_at::text, '') || coalesce(c.archive_reason, ''), '|' order by c.id)) into h1 from cash_flow_entries c;
    select count(*) into a1 from audit_log where table_name = 'cash_flow_entries';
    -- Admin: L = stopped by the lock, five times. The others: r = stopped by their role (before the lock is even looked at)
    outcome := case when s = 'LLLLL rrrrr rrrrr rrrrr ' and h0 = h1 and a0 = a1 then 'PASS' else 'FAIL ' || s || ' same=' || (h0 = h1)::text || ' audit+' || (a1 - a0) end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Still working while locked: a Cashier records a manual Expense once (the same form sent twice = one entry) and the balance moves by exactly its amount; the page is told the lock is on';
  begin
    select count(*) into c0 from cash_flow_entries;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page()->'summary';
    x := record_cash_entry('expense', 250.75, 'TEST office supplies', rid);
    x2 := record_cash_entry('expense', 250.75, 'TEST office supplies', rid);
    s := (x = x2)::text || ',' || ((r->>'balance')::numeric - (cash_ledger_page()->'summary'->>'balance')::numeric) || ',' || (r->>'changes_locked');
    execute 'reset role';
    s := s || ',' || ((select count(*) from cash_flow_entries) - c0);
    outcome := case when s = 'true,250.75,true,1' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Other records are not locked: the Archive and Restore rules of customers, loans and the rest are the same as before (only ledger entries are switched off)';
  outcome := case when (select prosrc from pg_proc where oid = 'public.archive_record(text,uuid,text)'::regprocedure) like '%Only closed loans (redeemed or forfeited) can be archived.%'
    and (select count(*) from regexp_matches((select prosrc from pg_proc where oid = 'public.archive_record(text,uuid,text)'::regprocedure), 'ctm_ledger_locked', 'g')) = 1
    and (select prosrc from pg_proc where oid = 'public.restore_record(text,uuid)'::regprocedure) like '%p_table = ''cash_flow_entries'' and public.ctm_ledger_locked()%'
    then 'PASS' else 'FAIL' end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0058() from public, anon, authenticated;

-- applied only if these pass (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0058' t, * from public.ctm_selftest_0058() union all select '0057' t, * from public.ctm_selftest_0057() union all select '0056' t, * from public.ctm_selftest_0056()
    union all select '0055' t, * from public.ctm_selftest_0055()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0058 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
