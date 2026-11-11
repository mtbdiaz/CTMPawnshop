-- 0045 (Nov 11, 2026, Wush): the reading side of the audit sessions from 0044, plus two safety fixes.
-- Why (Physical Audit brief):
--   - The audit page must show about 10 items at a time, with search, a vault filter and views (Not checked, Found,
--     Not located, Prior discrepancies...), and progress numbers for the WHOLE audit. Doing the search and the
--     counting in the database means the browser only gets the 10 rows it shows (no hidden list of hundreds).
--   - The old "insert" rules let an Operator write audit rows straight into the tables (around the checks in 0044's
--     functions), for example add a line ticked Found to someone's open audit. Now only the audit functions write.
--   - A "Found elsewhere" result (the item was there, but in the wrong place) also goes to the follow-up list, so
--     someone puts it back or fixes its location and writes what they did.
-- Nothing here changes an inventory item, a loan or a custody status.
-- Self-test: select * from public.ctm_selftest_0045();   (every test rolls back)

-- 1. only the audit functions (security definer) write audits and audit lines
drop policy if exists "physical_inventory_audits: operator or admin insert" on public.physical_inventory_audits;
drop policy if exists "physical_inventory_audit_items: operator or admin insert" on public.physical_inventory_audit_items;
-- one line per item in an audit (there are no doubles today; checked before writing this)
create unique index if not exists physical_inventory_audit_items_one_per_item on public.physical_inventory_audit_items (audit_id, inventory_item_id);

-- 2. follow-up ("Mark found" / "Mark fixed"): Not located AND Found elsewhere lines of a SUBMITTED audit
create or replace function public.resolve_audit_item(p_line_id uuid, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.physical_inventory_audit_items; s text;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into a from public.physical_inventory_audit_items where id = p_line_id for update;
  if not found then raise exception 'Audit line not found.'; end if;
  select status into s from public.physical_inventory_audits where id = a.audit_id;
  if s <> 'submitted' then raise exception 'This audit is not submitted yet.'; end if;
  -- old lines (before 0044) only have found = false; newer ones have the result
  if coalesce(a.result, case when a.found = false then 'not_located' end) is distinct from 'not_located'
     and a.result is distinct from 'found_elsewhere' then
    raise exception 'This item had no problem in that audit.';
  end if;
  if a.resolved_at is not null then raise exception 'This missing item was already marked found.'; end if;
  if coalesce(char_length(trim(p_notes)), 0) < 5 then raise exception 'Write where the item was found (at least 5 characters).'; end if;
  if char_length(trim(p_notes)) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  update public.physical_inventory_audit_items set resolved_at = now(), resolved_by = auth.uid(), resolution_notes = trim(p_notes) where id = a.id;
end $$;

-- 3. the locations to audit, from the items really in the vault now (no made-up names)
create or replace function public.audit_scope_options() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object('vault', vault_location, 'n', n) order by vault_location)
    from (select vault_location, count(*) n from public.inventory_items
          where archived_at is null and public.ctm_in_custody(status) group by 1) z), '[]'::jsonb);
end $$;

-- 4. one page of an audit: the audit, the totals for the whole audit, and the rows the filters pick
--    p_view: all | not_checked | found | found_elsewhere | not_located | discrepancies | prior | left
create or replace function public.audit_session_page(p_audit uuid, p_view text default 'all', p_q text default null,
  p_vault text default null, p_page integer default 1, p_size integer default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  au public.physical_inventory_audits;
  v_size int := least(greatest(coalesce(p_size, 10), 5), 50);  -- 5 to 50 rows a page
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_like text;
  v_ano int;
  v_vault text := nullif(btrim(coalesce(p_vault, '')), '');
  v_view text := coalesce(nullif(p_view, ''), 'all');
  res jsonb;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into au from public.physical_inventory_audits where id = p_audit and archived_at is null;
  if not found then raise exception 'Audit not found.'; end if;
  if v_q is not null then
    if char_length(v_q) > 80 then v_q := left(v_q, 80); end if;
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; -- typed % or _ are plain letters
    if v_q ~* '^a[\s-]?\d{1,9}$' then v_ano := regexp_replace(v_q, '\D', '', 'g')::int; end if; -- "A-0045" / "a45" = appraisal 45
  end if;

  with base as (
    select l.id, l.version, l.result, l.reason, l.notes, l.found_location, l.checked_at, cp.full_name as checked_by_name,
           l.expected_vault, l.expected_status::text as expected_status, l.resolved_at,
           i.id as inventory_item_id, i.status::text as item_status, i.vault_location as current_vault,
           public.ctm_in_custody(i.status) as in_custody,
           ai.id as appraisal_item_id, ai.appraisal_no, ai.category::text as category, ai.category_other, ai.karat, ai.weight_grams,
           ai.condition_notes, coalesce(array_length(ai.photo_paths, 1), 0) as photo_count, c.full_name as customer_name,
           ln.ticket_number, ln.status::text as loan_status,
           pr.prior_result, pr.prior_at, pr.prior_resolved_at, coalesce(pr.prior_open, false) as prior_open
    from public.physical_inventory_audit_items l
    join public.inventory_items i on i.id = l.inventory_item_id
    left join public.appraisal_items ai on ai.id = i.appraisal_item_id
    left join public.customers c on c.id = ai.customer_id
    left join public.profiles cp on cp.id = l.checked_by
    -- the newest loan of the item (its pawn ticket)
    left join lateral (select x.ticket_number, x.status from public.loans x
                       where x.inventory_item_id = i.id and x.archived_at is null order by x.created_at desc limit 1) ln on true
    -- the item in an EARLIER submitted audit: an open problem first, otherwise the newest result. History only:
    -- it never becomes this audit's result.
    left join lateral (
      select o.result as prior_result, coalesce(oa.submitted_at, oa.created_at) as prior_at, o.resolved_at as prior_resolved_at,
             (o.result in ('not_located', 'found_elsewhere') and o.resolved_at is null) as prior_open
      from public.physical_inventory_audit_items o
      join public.physical_inventory_audits oa on oa.id = o.audit_id
      where o.inventory_item_id = i.id and o.audit_id <> l.audit_id and oa.status = 'submitted' and oa.archived_at is null
        and o.result is not null and coalesce(oa.submitted_at, oa.created_at) <= coalesce(au.submitted_at, now()) -- only audits from before this one
      order by (o.result in ('not_located', 'found_elsewhere') and o.resolved_at is null) desc, coalesce(oa.submitted_at, oa.created_at) desc
      limit 1) pr on true
    where l.audit_id = au.id
  ), filtered as (
    select * from base b
    where (v_vault is null or b.expected_vault = v_vault)
      and (v_q is null or b.appraisal_no = v_ano or b.ticket_number ilike v_like or b.category ilike v_like
           or b.category_other ilike v_like or b.condition_notes ilike v_like or b.expected_vault ilike v_like
           or b.current_vault ilike v_like or b.customer_name ilike v_like or lower(v_q) = b.karat || 'k')
      and case v_view
            when 'not_checked' then b.result is null and b.in_custody
            when 'found' then b.result = 'found'
            when 'found_elsewhere' then b.result = 'found_elsewhere'
            when 'not_located' then b.result = 'not_located'
            when 'discrepancies' then b.result in ('not_located', 'found_elsewhere')
            when 'prior' then b.prior_open
            when 'left' then b.result is null and not b.in_custody
            else true end
  )
  select jsonb_build_object(
    'audit', jsonb_build_object('id', au.id, 'status', au.status, 'scope_vault', au.scope_vault, 'started_at', au.started_at,
             'submitted_at', au.submitted_at, 'is_partial', au.is_partial, 'expected_count', au.expected_count, 'notes', au.notes,
             'started_by', (select full_name from public.profiles where id = au.performed_by),
             'submitted_by', (select full_name from public.profiles where id = au.submitted_by)),
    -- totals for the WHOLE audit (not just the filter), so the progress is always the real progress
    'counts', (select jsonb_build_object(
             'expected', count(*),
             'found', count(*) filter (where result = 'found'),
             'found_elsewhere', count(*) filter (where result = 'found_elsewhere'),
             'not_located', count(*) filter (where result = 'not_located'),
             'not_checked', count(*) filter (where result is null and in_custody),
             'left', count(*) filter (where result is null and not in_custody),
             'prior', count(*) filter (where prior_open),
             'prior_found_now', count(*) filter (where prior_open and result = 'found'),
             'new_findings', count(*) filter (where result in ('not_located', 'found_elsewhere') and not prior_open),
             'checkers', (select jsonb_agg(distinct checked_by_name) from base where checked_by_name is not null)) from base),
    'vaults', (select coalesce(jsonb_agg(jsonb_build_object('vault', v, 'n', n) order by v), '[]'::jsonb)
               from (select expected_vault v, count(*) n from base group by 1) z),
    'total', (select count(*) from filtered),
    'page', v_page, 'size', v_size,
    'rows', (select coalesce(jsonb_agg(to_jsonb(f) order by f.expected_vault, f.appraisal_no nulls last, f.id), '[]'::jsonb)
             from (select * from filtered order by expected_vault, appraisal_no nulls last, id
                   offset (v_page - 1) * v_size limit v_size) f)
  ) into res;
  return res;
end $$;

revoke all on function public.audit_scope_options() from public, anon;
revoke all on function public.audit_session_page(uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.audit_scope_options() to authenticated;
grant execute on function public.audit_session_page(uuid, text, text, text, integer, integer) to authenticated;

create or replace function public.ctm_selftest_0045() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  a uuid; a2 uuid; l uuid; l2 uuid; it uuid; ano int; p0 int; s text; n int; r jsonb; t0 timestamptz;
begin
  test := 'Direct writes: an Operator can''t insert an audit or an audit line around the audit functions';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select inventory_item_id into it from physical_inventory_audit_items where audit_id = a limit 1;
    s := '';
    begin insert into physical_inventory_audits (performed_by, discrepancy_count) values (op_id, 0); s := 'audit saved';
    exception when others then s := 'a-refused'; end;
    begin insert into physical_inventory_audit_items (audit_id, inventory_item_id, expected_status, found, result) values (a, it, 'pawned', true, 'found'); s := s || '/line saved';
    exception when others then s := s || '/l-refused'; end;
    execute 'reset role';
    outcome := case when s = 'a-refused/l-refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Page: 10 rows a page, real totals, the last page, a too-big page size is capped, views and A-number search';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    r := audit_session_page(a, 'all', null, null, 1, 10);
    s := jsonb_array_length(r->'rows') || '/' || (r->>'total') || '/' || (r->'counts'->>'not_checked');
    l := (r->'rows'->0->>'id')::uuid; ano := (r->'rows'->0->>'appraisal_no')::int;
    perform record_audit_result(l, 'found', 0);
    r := audit_session_page(a, 'found', null, null, 1, 10);   s := s || '|' || (r->>'total');
    r := audit_session_page(a, 'not_checked', null, null, 1, 10); s := s || '/' || (r->>'total') || '/' || (r->'counts'->>'found');
    r := audit_session_page(a, 'all', null, null, 5, 10);     s := s || '|' || jsonb_array_length(r->'rows');
    r := audit_session_page(a, 'all', null, null, 1, 1000);   s := s || '/' || jsonb_array_length(r->'rows');
    r := audit_session_page(a, 'all', 'A-' || lpad(ano::text, 4, '0'), null, 1, 10); s := s || '|' || (r->>'total') || '/' || ((r->'rows'->0->>'id')::uuid = l);
    r := audit_session_page(a, 'all', '%', null, 1, 10);      s := s || '/' || (r->>'total');
    execute 'reset role';
    outcome := case when s = '10/48/48|1/47/1|8/48|1/true/0' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Roles: a Cashier can''t read an audit page or the locations list';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    s := '';
    begin perform audit_session_page(a); s := 'page read'; exception when others then s := 'p-refused'; end;
    begin perform audit_scope_options(); s := s || '/options read'; exception when others then s := s || '/o-refused'; end;
    execute 'reset role';
    outcome := case when s = 'p-refused/o-refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'History: a missing item from an earlier audit shows as a prior discrepancy, stays open when found today; wrong place can be followed up';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    p0 := (audit_session_page(a, 'prior')->>'total')::int; -- items that already have an open problem from older audits
    -- two items with no open problem from before
    select x.id, x.inventory_item_id into l, it from physical_inventory_audit_items x where x.audit_id = a and not exists (
      select 1 from physical_inventory_audit_items o join physical_inventory_audits oa on oa.id = o.audit_id
      where o.inventory_item_id = x.inventory_item_id and o.audit_id <> a and oa.status = 'submitted' and oa.archived_at is null
        and o.result in ('not_located', 'found_elsewhere') and o.resolved_at is null) order by x.id limit 1;
    select x.id into l2 from physical_inventory_audit_items x where x.audit_id = a and x.id <> l and not exists (
      select 1 from physical_inventory_audit_items o join physical_inventory_audits oa on oa.id = o.audit_id
      where o.inventory_item_id = x.inventory_item_id and o.audit_id <> a and oa.status = 'submitted' and oa.archived_at is null
        and o.result in ('not_located', 'found_elsewhere') and o.resolved_at is null) order by x.id desc limit 1;
    perform record_audit_result(l, 'not_located', 0, 'not_at_location', 'TEST');
    perform record_audit_result(l2, 'found_elsewhere', 0, null, null, 'TEST Vault B');
    perform submit_audit_session(a, true);
    a2 := start_inventory_audit('Safe 1', null);
    r := audit_session_page(a2, 'prior', null, null, 1, 10);
    s := ((r->>'total')::int - p0)::text; -- 2 new prior problems (one Not located, one Found elsewhere)
    perform record_audit_result((select id from physical_inventory_audit_items where audit_id = a2 and inventory_item_id = it), 'found', 0);
    r := audit_session_page(a2, 'all', null, null, 1, 10);
    s := s || '/' || ((r->'counts'->>'prior_found_now')::int >= 1) || '/' || ((select resolved_at from physical_inventory_audit_items where id = l) is null);
    perform resolve_audit_item(l2, 'TEST put it back');
    begin perform resolve_audit_item((select id from physical_inventory_audit_items where audit_id = a and result is null limit 1), 'TEST xxxxx'); s := s || '/unchecked resolved';
    exception when others then s := s || '/no-problem refused'; end;
    execute 'reset role';
    outcome := case when s = '2/true/true/no-problem refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Locations list = the items in the vault; an empty location can''t be started; a whole-vault page is quick';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    r := audit_scope_options();
    select sum((e->>'n')::int) into n from jsonb_array_elements(r) e;
    s := (n = (select count(*) from inventory_items where archived_at is null and ctm_in_custody(status)))::text;
    begin perform start_inventory_audit('TEST no such place', null); s := s || '/empty started';
    exception when others then s := s || case when sqlerrm like 'There are no items%' then '/empty refused' else '/' || sqlerrm end; end;
    a := start_inventory_audit(null, null);
    t0 := clock_timestamp();
    r := audit_session_page(a, 'not_checked', 'ring', null, 3, 10);
    s := s || '/' || (extract(epoch from clock_timestamp() - t0) < 2)::text;
    execute 'reset role';
    outcome := case when s = 'true/empty refused/true' then 'PASS (' || n || ' items, page in ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || ' ms)' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0045() from public, anon, authenticated;
