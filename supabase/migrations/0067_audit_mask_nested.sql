-- 0067 (Nov 13, 2026, Wush): the Audit Trail masks ID numbers at every level of an entry, with the app's own rule.
-- No audit entry, customer or any other record is changed by this migration.
--
-- Found while checking 0066 for the Reports review: 470 audit entries hold a customer's full ID number, not 468.
-- 468 have it at the top ({"id_number": ...}); 2 are Admin corrections (Oct 9 and Oct 30) that keep the whole row
-- inside "before" and "after" ({"admin_edit": true, "reason": ..., "before": {"id_number": ...}, "after": {...}}).
-- ctm_mask_audit (0066) only looked at the top, so audit_log_page still sent those 2 full numbers to an Admin.
-- Also, 0066 kept the last 4 characters as they were (dashes included) and showed a short ID in full, while the
-- rest of the app (lib/customers/id-privacy.ts maskId) keeps letters and digits only, shows the last 4, and hides
-- an ID of 4 characters or less completely.
--
-- Now:
--   ctm_mask_id(text): the app's rule: "0000-000418" -> "•••• 0418"; 4 characters or less -> "••••"; empty stays empty.
--   ctm_mask_audit(jsonb): goes through every object and list inside the entry and masks every "id_number" it finds.
--   Every other value is returned exactly as stored.
--   Nobody can call the two helpers straight from a login (only audit_log_page, which runs as the database owner,
--   uses them); they read no table, so this is tidiness, not a fix.
-- audit_log_page itself is not changed: it already calls ctm_mask_audit on both the new and the old values.
-- Self-test: select * from public.ctm_selftest_0067();   (every test rolls back)

create or replace function public.ctm_mask_id(v text) returns text
language sql immutable set search_path = public as $$
  select case
    when v is null or v = '' then v
    when length(regexp_replace(v, '[^a-zA-Z0-9]', '', 'g')) > 4 then '•••• ' || right(regexp_replace(v, '[^a-zA-Z0-9]', '', 'g'), 4) -- keep only the last 4 letters/digits
    else '••••' -- a very short ID is hidden completely
  end
$$;

create or replace function public.ctm_mask_audit(j jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; res jsonb;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'object' then
    res := '{}'::jsonb;
    for k, v in select e.key, e.value from jsonb_each(j) e loop
      if k = 'id_number' and jsonb_typeof(v) in ('string', 'number') then
        res := res || jsonb_build_object(k, public.ctm_mask_id(v #>> '{}')); -- the ID number itself, at any level
      else
        res := res || jsonb_build_object(k, public.ctm_mask_audit(v)); -- look inside (e.g. "before" / "after")
      end if;
    end loop;
    return res;
  elsif jsonb_typeof(j) = 'array' then
    return (select coalesce(jsonb_agg(public.ctm_mask_audit(x.e) order by x.o), '[]'::jsonb) from jsonb_array_elements(j) with ordinality x(e, o));
  end if;
  return j; -- text, numbers, true/false and null are returned as they are
end $$;

revoke all on function public.ctm_mask_id(text) from public, anon, authenticated;
revoke all on function public.ctm_mask_audit(jsonb) from public, anon, authenticated;

create or replace function public.ctm_selftest_0067() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  admin_id uuid; s text; r jsonb; n int; total int; pages int; leaks int := 0; seen int := 0; p int;
  sample jsonb := '{"id_number": "0000-000418", "full_name": "Juan", "before": {"id_number": "AB-12-345", "x": 1},
                    "after": {"id_number": "12"}, "list": [{"id_number": 1234567}, "plain"], "n": null, "e": {"id_number": ""}}';
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;

  test := 'The mask: every id_number at any level gets the app''s rule ("•••• 0418"; 4 or less -> "••••"; empty stays empty); every other value is unchanged';
  begin
    r := ctm_mask_audit(sample);
    s := (r = '{"id_number": "•••• 0418", "full_name": "Juan", "before": {"id_number": "•••• 2345", "x": 1},
                "after": {"id_number": "••••"}, "list": [{"id_number": "•••• 4567"}, "plain"], "n": null, "e": {"id_number": ""}}'::jsonb)::text
      || ',' || (ctm_mask_audit(null) is null)::text || ',' || (ctm_mask_audit('"text"') = '"text"')::text
      || ',' || (ctm_mask_id('0000-000418') = '•••• 0418')::text;
    outcome := case when s = 'true,true,true,true' then 'PASS' else 'FAIL ' || s || ' ' || r::text end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'Every stored audit entry: after masking no full ID number is left at any level, and entries without an ID number come back exactly as stored';
  begin
    select count(*) into n from audit_log a, lateral (select ctm_mask_audit(a.changed_data) c, ctm_mask_audit(a.old_data) o) m
     where exists (select 1 from jsonb_path_query(coalesce(m.c, '{}') || '{}', 'strict $.**.id_number') v where v #>> '{}' <> '' and v #>> '{}' not like '••••%')
        or exists (select 1 from jsonb_path_query(coalesce(m.o, '{}') || '{}', 'strict $.**.id_number') v where v #>> '{}' <> '' and v #>> '{}' not like '••••%');
    select count(*) into total from audit_log a
     where not jsonb_path_exists(coalesce(a.changed_data, '{}'), 'strict $.**.id_number') and not jsonb_path_exists(coalesce(a.old_data, '{}'), 'strict $.**.id_number')
       and (ctm_mask_audit(a.changed_data) is distinct from a.changed_data or ctm_mask_audit(a.old_data) is distinct from a.old_data);
    outcome := case when n = 0 and total = 0 then 'PASS' else 'FAIL full numbers left ' || n || ', other values changed ' || total end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'Through audit_log_page as an Admin: every page of customer entries has no full ID number at any level (the 2 Admin corrections included); the stored entries still have the full numbers';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := audit_log_page(p_table => 'customers', p_size => 100);
    total := (r->>'total')::int; pages := ceil(total / 100.0)::int;
    for p in 1 .. greatest(pages, 1) loop
      r := audit_log_page(p_table => 'customers', p_page => p, p_size => 100);
      seen := seen + jsonb_array_length(r->'rows');
      leaks := leaks + (select count(*) from jsonb_array_elements(r->'rows') x, jsonb_path_query(x, 'strict $.**.id_number') v
                         where v #>> '{}' <> '' and v #>> '{}' not like '••••%');
    end loop;
    execute 'reset role';
    select count(*) into n from audit_log a where exists (
      select 1 from jsonb_path_query(coalesce(a.changed_data, '{}'), 'strict $.**.id_number') v where v #>> '{}' <> '' and v #>> '{}' not like '••••%');
    outcome := case when leaks = 0 and seen = total and n >= 470 then 'PASS (' || seen || ' entries read, ' || n || ' stored with the full number)'
                    else 'FAIL leaks ' || leaks || ', read ' || seen || ' of ' || total || ', stored ' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0067() from public, anon, authenticated;

-- ctm_selftest_0066 is the same as in 0066 except two checks: it now expects the app's rule (ctm_mask_id) instead of
-- "the last 4 characters as stored", and accepts "••••" (no space), because 3 stored IDs are 4 characters or less
-- and are now hidden completely.
create or replace function public.ctm_selftest_0066() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  admin_id uuid; s text; r jsonb; r2 jsonb; n int; n2 int; t0 timestamptz; ms text := ''; v_today date := ctm_today(); loan_src uuid; d date;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;

  test := 'Roles: Operator, Cashier and Appraiser can''t run any report function or read the audit log; nobody (not even an Admin) reads the stored audit log directly; signed-out is refused';
  begin
    execute 'set local role authenticated';
    s := '';
    foreach n in array array[1, 2, 3] loop
      perform set_config('request.jwt.claims', json_build_object('sub', (array[op_id, cash_id, appr_id])[n], 'role', 'authenticated')::text, true);
      begin perform report_loans('outstanding'); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '1' else '?' end; end;
      begin perform report_inventory_aging(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '2' else '?' end; end;
      begin perform report_loan_analytics(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '3' else '?' end; end;
      begin perform report_cash_breakdown(v_today, v_today); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '4' else '?' end; end;
      begin perform audit_log_page(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '5' else '?' end; end;
      s := s || '/';
    end loop;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin select count(*) into n from audit_log; s := s || 'admin direct ' || n; exception when insufficient_privilege then s := s || 'admin direct refused'; end;
    execute 'reset role';
    execute 'set local role anon';
    begin select count(*) into n from audit_log; s := s || '/anon ' || n; exception when insufficient_privilege then s := s || '/anon refused'; end;
    execute 'reset role';
    outcome := case when s = '12345/12345/12345/admin direct refused/anon refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Audit log for an Admin: every entry is reachable through audit_log_page, ID numbers show only the last 4 (before and after), other fields are untouched, and the stored entries still have the full numbers';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := audit_log_page(p_table => 'customers', p_size => 100);
    r2 := audit_log_page(p_size => 5);
    execute 'reset role';
    s := ((r2->>'total')::int = (select count(*) from audit_log))::text
      || ',' || ((r->>'total')::int = (select count(*) from audit_log where table_name = 'customers'))::text
      -- no shown ID number is longer than the mask
      || ',' || (select bool_and(coalesce(x->'changed_data'->>'id_number', '') = '' or x->'changed_data'->>'id_number' like '••••%') and
                        bool_and(coalesce(x->'old_data'->>'id_number', '') = '' or x->'old_data'->>'id_number' like '••••%')
                 from jsonb_array_elements(r->'rows') x)::text
      -- the masked value is the real last 4, and the name is unchanged
      || ',' || coalesce((select bool_and(x->'changed_data'->>'id_number' = ctm_mask_id(a.changed_data->>'id_number') and x->'changed_data'->>'full_name' is not distinct from a.changed_data->>'full_name')
                 from jsonb_array_elements(r->'rows') x join audit_log a on a.id = (x->>'id')::uuid where coalesce(a.changed_data->>'id_number', '') <> ''), true)::text
      || ',' || ((select count(*) from audit_log where table_name = 'customers' and coalesce(changed_data->>'id_number', '') <> '' and changed_data->>'id_number' not like '•••• %') > 0)::text;
    outcome := case when s = 'true,true,true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Outstanding and Overdue: counts and totals equal the loan records worked out another way; a fully paid loan is never overdue; the rows of all pages add up to the totals; search and filters work';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_loans('outstanding', p_size => 1000);
    r2 := report_loans('overdue', p_size => 1000);
    s := ((r->>'all_count')::int = (select count(*) from loans where archived_at is null and status in ('active', 'extended', 'reinstated')))::text
      || ',' || ((r->>'all_owed')::numeric = (select coalesce(sum(owed_now(l)), 0) from loans l where archived_at is null and status in ('active', 'extended', 'reinstated')))::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r->'counts')) = (r->>'all_count')::int)::text
      || ',' || ((r->'totals'->>'owed')::numeric = (select sum((x->>'owed')::numeric) from jsonb_array_elements(r->'rows') x))::text
      || ',' || ((r2->>'all_count')::int = (select count(*) from loans l where archived_at is null and owed_now(l) >= 0.01 and
                   (status = 'defaulted' or (status in ('active', 'extended', 'reinstated') and maturity_date < ctm_today()))))::text
      || ',' || (not exists (select 1 from jsonb_array_elements(r2->'rows') x where (x->>'owed')::numeric < 0.01))::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r2->'counts')) = (r2->>'all_count')::int)::text
      || ',' || (coalesce((r->'counts'->>'overdue')::int, 0) + coalesce((r2->'counts'->>'defaulted')::int, 0) = (r2->>'all_count')::int)::text
      || ',' || ((report_loans('outstanding', p_filter => 'paid')->>'total')::int = coalesce((r->'counts'->>'paid')::int, 0))::text;
    -- search by ticket finds that loan
    s := s || ',' || ((report_loans('outstanding', p_q => (select ticket_number from loans where archived_at is null and status = 'active' limit 1))->>'total')::int >= 1)::text;
    -- a page past the end shows the last page
    s := s || ',' || ((report_loans('outstanding', p_page => 9999, p_size => 50)->>'page')::int = greatest(1, ceil((r->>'all_count')::numeric / 50)::int))::text;
    execute 'reset role';
    outcome := case when s not like '%false%' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Inventory aging and Trends: counts equal the records (items still in the shop; loans not archived), age groups add up, days held are Manila days, and the 12 months add up to the loans of those months';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_inventory_aging(p_size => 1000);
    r2 := report_loan_analytics();
    s := ((r->>'all_count')::int = (select count(*) from inventory_items where archived_at is null and status in ('pawned', 'extended', 'forfeited', 'queued_for_auction')))::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r->'band_counts')) = (r->>'all_count')::int)::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r->'custody_counts')) = (r->>'all_count')::int)::text
      || ',' || coalesce((select bool_and((x->>'days')::int = ctm_today() - ((x->>'created_at')::timestamptz at time zone 'Asia/Manila')::date) from jsonb_array_elements(r->'rows') x), true)::text
      || ',' || ((r2->>'total')::int = (select count(*) from loans where archived_at is null))::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r2->'by_status')) = (r2->>'total')::int)::text
      || ',' || (jsonb_array_length(r2->'months') = 12)::text
      || ',' || ((select sum((m->>'totalPrincipal')::numeric) from jsonb_array_elements(r2->'months') m)
                 = (select coalesce(sum(principal_amount), 0) from loans where archived_at is null and loan_date >= date_trunc('month', ctm_today()) - interval '11 months'))::text;
    execute 'reset role';
    outcome := case when s not like '%false%' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Financial summary = Cash & ledger: for this month, Jan 1 to today, one day and the whole ledger, Cash in, Cash out and the entry count equal cash_ledger_page; capitalized interest is never cash; a backwards range is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := '';
    foreach d in array array[date_trunc('month', v_today)::date, make_date(extract(year from v_today)::int, 1, 1), v_today, date '2000-01-01'] loop
      r := report_cash_breakdown(d, v_today);
      r2 := cash_ledger_page(p_from => d, p_to => v_today, p_page => 1, p_size => 5);
      s := s || ((r->>'cash_in')::numeric = (r2->>'sum_in')::numeric and (r->>'cash_out')::numeric = (r2->>'sum_out')::numeric
                 and (r->>'entries')::int = (r2->>'total')::int
                 and (select coalesce(sum((t->>'cash_in')::numeric), 0) from jsonb_array_elements(r->'by_type') t) = (r->>'cash_in')::numeric
                 -- every entry is either in the cash breakdown or counted as non-cash (capitalized interest), never both
                 and (select coalesce(sum((t->>'count')::int), 0) from jsonb_array_elements(r->'by_type') t) + (r->>'non_cash_count')::int = (r->>'entries')::int
                 and (r->>'non_cash_count')::int = (select count(*) from cash_flow_entries where archived_at is null and is_memo
                       and created_at >= d::timestamp at time zone 'Asia/Manila' and created_at < (v_today + 1)::timestamp at time zone 'Asia/Manila'))::text || ',';
    end loop;
    begin perform report_cash_breakdown(v_today, v_today - 1); s := s || 'backwards saved'; exception when others then s := s || 'backwards refused'; end;
    execute 'reset role';
    outcome := case when s = 'true,true,true,true,backwards refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Bigger dataset (inside the test only, rolled back): 20,000 more ledger rows and 10,000 more open loans; every report still adds them all up and answers quickly';
  begin
    select id into loan_src from loans where archived_at is null and status = 'active' and principal_balance > 0 order by created_at desc limit 1;
    if loan_src is null then outcome := 'SKIP (needs an active loan)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    n := (report_loans('outstanding')->>'all_count')::int;
    r := report_cash_breakdown(date '2000-01-01', v_today);
    execute 'reset role';
    -- the extra rows (TEST data, never saved: the whole test rolls back)
    insert into cash_flow_entries (entry_type, direction, amount, description, created_at, is_memo, created_by)
      select 'expense', 'out', 1.00, 'TEST perf row ' || g, now() - (g || ' minutes')::interval, false, admin_id from generate_series(1, 20000) g;
    insert into loans select r.* from loans l cross join generate_series(1, 10000) g
      cross join lateral jsonb_populate_record(null::loans, to_jsonb(l) || jsonb_build_object('id', gen_random_uuid(), 'ticket_number', 'TEST-PERF-' || g)) r
      where l.id = loan_src;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    t0 := clock_timestamp(); r2 := report_loans('outstanding'); ms := ms || 'outstanding ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    n2 := (r2->>'all_count')::int;
    t0 := clock_timestamp(); perform report_loans('overdue'); ms := ms || ', overdue ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    t0 := clock_timestamp(); perform report_inventory_aging(); ms := ms || ', aging ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    t0 := clock_timestamp(); r2 := report_loan_analytics(); ms := ms || ', trends ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    t0 := clock_timestamp(); s := (report_cash_breakdown(date '2000-01-01', v_today)->>'cash_out'); ms := ms || ', cash ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    t0 := clock_timestamp(); perform audit_log_page(p_size => 50); ms := ms || ', audit ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    execute 'reset role';
    s := (n2 = n + 10000)::text || ',' || (s::numeric = (r->>'cash_out')::numeric + 20000)::text || ',' || ((r2->>'total')::int >= 10000)::text;
    outcome := case when s = 'true,true,true' then 'PASS (' || ms || ')' else 'FAIL ' || s || ' ' || ms end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0066() from public, anon, authenticated;

-- applied only if these pass, and the earlier Reports, ledger and Suspicious activity tests still pass
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0067' t, * from public.ctm_selftest_0067() union all select '0066' t, * from public.ctm_selftest_0066()
    union all select '0065' t, * from public.ctm_selftest_0065() union all select '0064' t, * from public.ctm_selftest_0064()
    union all select '0063' t, * from public.ctm_selftest_0063() union all select '0062' t, * from public.ctm_selftest_0062()
    union all select '0058' t, * from public.ctm_selftest_0058() union all select '0038' t, * from public.ctm_selftest_0038()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0067 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
