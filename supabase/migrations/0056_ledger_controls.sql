-- 0056 (Nov 12, 2026, Wush): Cash & ledger, after the financial-control review. No ledger entry is changed here.
--   1. Everyone who can open the ledger (Admin, Operator, Cashier) is now told when the balance includes entries
--      that are under review, as a yes/no. The count and the amount stay Admin-only.
--   2. The page is told how many entries are archived, so archiving can't quietly take money out of the totals:
--      the page says "N archived entries are not counted".
--   3. Found while checking Archive: an Admin calling archive_record() directly could archive ANY ledger entry,
--      also one made by a loan, a payment or an auction sale (the page only offers it for manual entries). That
--      would take real money out of the totals. Now only a manual Expense or Revenue can be archived, the same
--      rule admin_edit_cash_entry already has. Loan-linked entries are corrected from the loan (an Adjustment).
-- Self-test: select * from public.ctm_selftest_0056();   (every test rolls back)

do $patch$
declare d text; d0 text;
begin
  select pg_get_functiondef('public.cash_ledger_page(text,text,text,text,date,date,boolean,integer,integer)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$        'entries', count(*),$a$,
    $b$        'entries', count(*),
        'under_review', (count(*) filter (where no_sale_record)) > 0,
        'archived', (select count(*) from public.cash_flow_entries ar where ar.archived_at is not null),$b$);
  if d = d0 then raise exception '0056: could not update cash_ledger_page'; end if;
  execute d;

  select pg_get_functiondef('public.archive_record(text,uuid,text)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$    if v_open > 0 then raise exception 'This customer has open loans and cannot be archived.'; end if;$a$,
    $b$    if v_open > 0 then raise exception 'This customer has open loans and cannot be archived.'; end if;
  elsif p_table = 'cash_flow_entries' then
    if exists (select 1 from public.cash_flow_entries c where c.id = p_id and (c.related_loan_id is not null or c.entry_type not in ('expense', 'revenue') or c.is_memo)) then
      raise exception 'Only a manual Expense or Revenue entry can be archived. An entry made by a loan, a payment or a sale is corrected from that loan.';
    end if;$b$);
  if d = d0 then raise exception '0056: could not update archive_record'; end if;
  execute d;
end $patch$;

create or replace function public.ctm_selftest_0056() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  admin_id uuid; r jsonb; r2 jsonb; s text; ok boolean; ok2 boolean; m uuid; m_amt numeric; sys uuid; b0 numeric; a0 int; n0 int; k0 int;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id, amount into m, m_amt from cash_flow_entries where related_loan_id is null and entry_type = 'expense' and not is_memo and archived_at is null order by created_at limit 1; -- a manual entry
  select id into sys from cash_flow_entries where related_loan_id is not null and entry_type = 'payment_received' and archived_at is null order by created_at limit 1;                -- a system entry

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

  test := 'Correct (Admin): refused for a Cashier and an Operator, without a reason, and on a loan-linked entry; a correction keeps the same entry, and the audit log keeps who, why, and the amount before and after';
  begin
    if m is null or sys is null then outcome := 'SKIP (needs a manual and a system entry)'; raise exception 'ROLLBACK'; end if;
    select count(*) into a0 from audit_log where table_name = 'cash_flow_entries' and record_id::text = m::text and changed_data ? 'admin_edit';
    execute 'set local role authenticated';
    s := '';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform admin_edit_cash_entry(m, 1, 'TEST', 'TEST reason'); s := s || 'x'; exception when others then s := s || '1'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform admin_edit_cash_entry(m, 1, 'TEST', 'TEST reason'); s := s || 'x'; exception when others then s := s || '2'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin perform admin_edit_cash_entry(m, 1, 'TEST', '  '); s := s || 'x'; exception when others then s := s || '3'; end;
    begin perform admin_edit_cash_entry(m, 0, 'TEST', 'TEST reason'); s := s || 'x'; exception when others then s := s || '4'; end;
    begin perform admin_edit_cash_entry(sys, 1, 'TEST', 'TEST reason'); s := s || 'x'; exception when others then s := s || '5'; end;
    b0 := (cash_ledger_page()->'summary'->>'balance')::numeric;
    perform admin_edit_cash_entry(m, m_amt + 10, 'TEST corrected', 'TEST keyed wrong');
    r := cash_ledger_page(m::text);
    s := s || '|' || (b0 - (r->'summary'->>'balance')::numeric) || '|' || (r->>'total') || '|' || jsonb_array_length(r->'rows'->0->'edits')
      || '|' || (r->'rows'->0->'edits'->-1->>'reason') || ',' || ((r->'rows'->0->'edits'->-1->>'before')::numeric = m_amt)::text || ',' || ((r->'rows'->0->'edits'->-1->>'after')::numeric = m_amt + 10)::text;
    execute 'reset role';
    s := s || '|' || ((select count(*) from audit_log where table_name = 'cash_flow_entries' and record_id::text = m::text and changed_data ? 'admin_edit' and actor::text = admin_id::text) - a0);
    -- the expense grew by 10, so the balance is 10 lower: a correction DOES move every balance after the entry
    outcome := case when s = '12345|10.00|1|' || (a0 + 1) || '|TEST keyed wrong,true,true|1' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Archive (Admin): refused for a Cashier and an Operator, without a reason, and for an entry made by a loan or payment; an archived manual entry leaves the totals but is counted as archived, keeps who and why, and comes back on restore';
  begin
    if m is null or sys is null then outcome := 'SKIP (needs a manual and a system entry)'; raise exception 'ROLLBACK'; end if;
    select count(*) into a0 from audit_log where table_name = 'cash_flow_entries' and record_id::text = m::text;
    execute 'set local role authenticated';
    s := '';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform archive_record('cash_flow_entries', m, 'TEST reason'); s := s || 'x'; exception when others then s := s || '1'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform archive_record('cash_flow_entries', m, 'TEST reason'); s := s || 'x'; exception when others then s := s || '2'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin perform archive_record('cash_flow_entries', m, ' '); s := s || 'x'; exception when others then s := s || '3'; end;
    begin perform archive_record('cash_flow_entries', sys, 'TEST reason'); s := s || 'x';
    exception when others then s := s || case when sqlerrm like 'Only a manual Expense or Revenue entry can be archived%' then '4' else sqlerrm end; end;
    r := cash_ledger_page()->'summary';
    perform archive_record('cash_flow_entries', m, 'TEST entered twice');
    r2 := cash_ledger_page()->'summary';
    s := s || '|' || ((r2->>'balance')::numeric - (r->>'balance')::numeric = m_amt)::text || ',' || ((r2->>'archived')::int - (r->>'archived')::int) || ',' || ((r->>'entries')::int - (r2->>'entries')::int);
    perform restore_record('cash_flow_entries', m);
    r2 := cash_ledger_page()->'summary';
    s := s || '|' || ((r2->>'balance')::numeric = (r->>'balance')::numeric)::text || ',' || ((r2->>'archived')::int = (r->>'archived')::int)::text;
    execute 'reset role';
    s := s || '|' || (((select count(*) from audit_log where table_name = 'cash_flow_entries' and record_id::text = m::text and actor::text = admin_id::text) - a0) >= 2)::text
      || ',' || (select exists (select 1 from audit_log where table_name = 'cash_flow_entries' and record_id::text = m::text and (coalesce(changed_data::text, '') || coalesce(old_data::text, '')) like '%TEST entered twice%'))::text;
    outcome := case when s = '1234|true,1,1|true,true|true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0056() from public, anon, authenticated;

-- applied only if these pass (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0056' t, * from public.ctm_selftest_0056() union all select '0055' t, * from public.ctm_selftest_0055()
    union all select '0031' t, * from public.ctm_selftest_0031() union all select '0053' t, * from public.ctm_selftest_0053()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0056 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
