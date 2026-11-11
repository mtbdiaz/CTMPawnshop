-- 0049 (Nov 12, 2026, Wush): overlapping audits need a written reason; a discarded draft can still be opened.
-- Why (Physical Audit final checks):
--   1. 0048 let a person start an audit that overlaps another one by ticking a box. Now they must WRITE WHY, and the
--      audit keeps that reason and the ids of the audits it overlaps (who and when are performed_by / started_at).
--      Who may do it: Operator and Admin, the same roles that can audit at all (no new role).
--   2. The overlap is found from the ITEMS the two audits share, not from the location names.
--   3. A discarded draft stays readable: its page opens read only, so its saved checks can be looked at.
--      It can't be "restored" into a half state from Archive (a rule on the table stops that).
-- Nothing here changes an item, a loan, a custody status or money.
-- Self-test: select * from public.ctm_selftest_audit();  (everything rolls back)

alter table public.physical_inventory_audits
  add column overlap_reason text check (overlap_reason is null or char_length(overlap_reason) between 5 and 300), -- why a separate audit was started
  add column overlaps_with uuid[];                                                                                  -- the open audits it shared items with at the start
-- a discarded draft is always set aside (it can't be put back among the active audits)
alter table public.physical_inventory_audits add constraint physical_inventory_audits_discarded_is_set_aside
  check (status <> 'discarded' or archived_at is not null);

drop function if exists public.start_inventory_audit(text, uuid, boolean);
create or replace function public.start_inventory_audit(p_scope text default null, p_request_id uuid default null, p_overlap_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_scope text := nullif(btrim(coalesce(p_scope, '')), ''); n int; v_other text; v_ids uuid[]; v_reason text := nullif(btrim(coalesce(p_overlap_reason, '')), '');
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  perform pg_advisory_xact_lock(hashtext('ctm_start_inventory_audit')); -- two Starts at the same moment wait for each other
  if p_request_id is not null then -- the same Start sent twice (double click, retry)
    select id into v_id from public.physical_inventory_audits where request_id = p_request_id;
    if found then return v_id; end if;
  end if;
  -- the same location already has an open audit: continue that one
  select id into v_id from public.physical_inventory_audits
  where status = 'in_progress' and archived_at is null and coalesce(scope_vault, '*') = coalesce(v_scope, '*');
  if found then return v_id; end if;
  -- open audits that list the SAME ITEMS as this one would (compared item by item, not by the location's name,
  -- so an item that was moved between locations is still caught)
  select array_agg(z.id order by z.scope nulls first), string_agg(coalesce(z.scope, 'All locations') || ' (' || z.shared || case when z.shared = 1 then ' item' else ' items' end || ' the same)', ', ' order by z.scope nulls first)
    into v_ids, v_other
  from (select a.id, a.scope_vault as scope, count(*) as shared
        from public.physical_inventory_audits a
        join public.physical_inventory_audit_items l on l.audit_id = a.id
        join public.inventory_items i on i.id = l.inventory_item_id
        where a.status = 'in_progress' and a.archived_at is null
          and i.archived_at is null and public.ctm_in_custody(i.status) and (v_scope is null or i.vault_location = v_scope)
        group by a.id, a.scope_vault) z;
  if v_ids is not null then
    -- allowed (a spot check during a full count), but only on purpose: the person must write why
    if v_reason is null then
      raise exception 'OVERLAP: An audit in progress already lists some of these items: %. Continue that one, or write a reason to start a separate audit.', v_other;
    end if;
    if char_length(v_reason) < 5 then raise exception 'Write why a separate audit is needed (at least 5 characters).'; end if;
    if char_length(v_reason) > 300 then raise exception 'Keep the reason to 300 characters or less.'; end if;
  end if;
  select count(*) into n from public.inventory_items
  where archived_at is null and public.ctm_in_custody(status) and (v_scope is null or vault_location = v_scope);
  if n = 0 then raise exception 'There are no items in % to audit.', coalesce(v_scope, 'the vault'); end if;
  perform set_config('ctm.system', 'on', true);
  begin
    -- who started it and when are performed_by and started_at; an overlap also keeps its reason and the audits it overlaps
    insert into public.physical_inventory_audits (performed_by, status, scope_vault, started_at, expected_count, request_id, discrepancy_count, overlap_reason, overlaps_with)
    values (auth.uid(), 'in_progress', v_scope, now(), n, p_request_id, 0, case when v_ids is not null then v_reason end, v_ids) returning id into v_id;
  exception when unique_violation then -- someone else just started it: use theirs
    select id into v_id from public.physical_inventory_audits
    where status = 'in_progress' and archived_at is null and coalesce(scope_vault, '*') = coalesce(v_scope, '*');
    return v_id;
  end;
  insert into public.physical_inventory_audit_items (audit_id, inventory_item_id, expected_status, expected_vault, found, result)
  select v_id, i.id, i.status, i.vault_location, null, null
  from public.inventory_items i
  where i.archived_at is null and public.ctm_in_custody(i.status) and (v_scope is null or i.vault_location = v_scope);
  return v_id;
end $$;
revoke all on function public.start_inventory_audit(text, uuid, text) from public, anon;
grant execute on function public.start_inventory_audit(text, uuid, text) to authenticated;

-- for the Start form: which open audits share items with each location RIGHT NOW (item by item)
create or replace function public.audit_open_overlaps() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object('audit_id', z.id, 'vault', z.vault, 'n', z.n))
    from (select a.id, i.vault_location as vault, count(*) as n
          from public.physical_inventory_audits a
          join public.physical_inventory_audit_items l on l.audit_id = a.id
          join public.inventory_items i on i.id = l.inventory_item_id
          where a.status = 'in_progress' and a.archived_at is null and i.archived_at is null and public.ctm_in_custody(i.status)
          group by a.id, i.vault_location) z), '[]'::jsonb);
end $$;
revoke all on function public.audit_open_overlaps() from public, anon;
grant execute on function public.audit_open_overlaps() to authenticated;

-- the audit page (audit_session_page from 0045) gets ONE change: a discarded draft can be opened too.
-- The function is long, so instead of repeating all of it, this takes its current text, swaps that one line and
-- saves it again. It stops with an error if the line is not found (so it can never silently do nothing).
do $patch$
declare d text; old text := 'where id = p_audit and archived_at is null;';
begin
  d := pg_get_functiondef('public.audit_session_page(uuid,text,text,text,integer,integer)'::regprocedure);
  if position(old in d) = 0 then raise exception 'audit_session_page: the line to change was not found'; end if;
  execute replace(d, old, 'where id = p_audit and (archived_at is null or status = ''discarded'');');
end $patch$;

create or replace function public.ctm_selftest_0048() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  admin_id uuid;
  a uuid; a2 uuid; a3 uuid; a4 uuid; l uuid; s text; n int; h1 text; h2 text;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;

  test := 'Start: the same location twice = one audit (also with a repeated request); another location is its own audit; an overlap is refused without a reason; with a reason it is a separate audit that keeps the reason';
  begin
    perform set_config('ctm.system', 'on', true); -- a clean slate inside this test only (rolled back)
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', '00000000-0000-4000-8000-000000000048');
    a2 := start_inventory_audit('Safe 1', '00000000-0000-4000-8000-000000000048'); -- the same request again
    a3 := start_inventory_audit('Safe 1', gen_random_uuid());                      -- someone else presses Start
    s := (a = a2)::text || (a = a3)::text;
    select x.id into l from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    perform record_audit_result(l, 'found', 0);
    a2 := start_inventory_audit('Safe 1', null); -- continue: the saved check is still there
    s := s || '/' || (select count(*) from physical_inventory_audit_items x where x.audit_id = a2 and x.result = 'found');
    a3 := start_inventory_audit('Vault B', null);
    s := s || '/' || (a3 <> a)::text;
    begin a4 := start_inventory_audit(null, null); s := s || '/all started';
    exception when others then s := s || case when sqlerrm like 'OVERLAP:%Safe 1 (%Vault B (%' then '/all refused' else '/' || sqlerrm end; end;
    begin a4 := start_inventory_audit(null, null, 'no'); s := s || '/short reason started';
    exception when others then s := s || case when sqlerrm like 'Write why%' then '/short refused' else '/' || sqlerrm end; end;
    a4 := start_inventory_audit(null, null, 'TEST full count while spot checks run');
    s := s || '/' || (a4 not in (a, a3))::text || '/' || (select count(*) from physical_inventory_audit_items x where x.audit_id = a4 and x.result is not null)
           || '/' || (select (overlap_reason like 'TEST full%')::text || ',' || (overlaps_with @> array[a, a3])::text || ',' || (performed_by = op_id)::text from physical_inventory_audits where id = a4);
    begin perform start_inventory_audit('Vault A', null); s := s || '/location started';
    exception when others then s := s || case when sqlerrm like 'OVERLAP:%All locations (%' then '/location refused' else '/' || sqlerrm end; end;
    execute 'reset role';
    s := s || '/' || (select count(*) from physical_inventory_audits where status = 'in_progress' and archived_at is null)
           || '/' || (select count(*) from physical_inventory_audit_items x where x.audit_id = a and x.result = 'found'); -- the first audit's check is untouched
    outcome := case when s = 'truetrue/1/true/all refused/short refused/true/0/true,true,true/location refused/3/1' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Discard: an empty draft by its starter; a draft with saved checks needs the extra yes and keeps its lines; an Operator can''t discard an Admin''s draft, an Admin can discard an Operator''s; a submitted audit can''t be discarded';
  begin
    select md5(string_agg(i::text, '|' order by i.id)) into h1 from inventory_items i;
    select md5(string_agg(x::text, '|' order by x.id)) into h2 from loans x;
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    perform discard_audit_session(a, 'TEST empty draft');
    s := (select status || ',' || (archived_by = op_id) from physical_inventory_audits where id = a);
    a2 := start_inventory_audit('Safe 1', null); -- the location is free again: a new audit, not the discarded one
    s := s || '/' || (a2 <> a)::text;
    select x.id into l from physical_inventory_audit_items x where x.audit_id = a2 order by x.id limit 1;
    perform record_audit_result(l, 'not_located', 0, 'not_at_location', 'TEST');
    begin perform discard_audit_session(a2, 'TEST has a check'); s := s || '/discarded without yes';
    exception when others then s := s || case when sqlerrm like 'This draft has 1 saved check.%' then '/needs yes' else '/' || sqlerrm end; end;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform discard_audit_session(a2, 'TEST admin discards it', true); -- an Admin can discard an Operator's draft
    s := s || '/' || (select status from physical_inventory_audits where id = a2) || ',' || (select count(*) from physical_inventory_audit_items x where x.audit_id = a2 and x.result = 'not_located');
    begin perform discard_audit_session(a2, 'TEST a second time'); s := s || '/twice';
    exception when others then s := s || case when sqlerrm like '%already discarded%' then '/once' else '/' || sqlerrm end; end;
    begin perform record_audit_result(l, 'found', 1); s := s || '/changed after discard'; exception when others then s := s || '/locked'; end;
    a3 := start_inventory_audit('Safe 1', null); -- started by the Admin
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform discard_audit_session(a3, 'TEST not my draft'); s := s || '/operator discarded admin''s';
    exception when others then s := s || case when sqlerrm like 'Only the person who started%' then '/not yours' else '/' || sqlerrm end; end;
    perform submit_audit_session(a3, true);
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin perform discard_audit_session(a3, 'TEST submitted one', true); s := s || '/submitted discarded';
    exception when others then s := s || case when sqlerrm like 'A submitted audit%' then '/submitted kept' else '/' || sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || ((select md5(string_agg(i::text, '|' order by i.id)) from inventory_items i) = h1) || '/' || ((select md5(string_agg(x::text, '|' order by x.id)) from loans x) = h2)
           || '/' || (select count(*) from physical_inventory_audits where status = 'in_progress' and archived_at is null);
    outcome := case when s = 'discarded,true/true/needs yes/discarded,1/once/locked/not yours/submitted kept|true/true/0' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;

create or replace function public.ctm_selftest_0049() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  admin_id uuid; who uuid;
  a uuid; a2 uuid; l uuid; it uuid; s text; r jsonb;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;

  test := 'Overlap by items, not names: an item moved to another location after an audit started still counts as shared; the list for the Start form shows it';
  begin
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select x.inventory_item_id into it from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    execute 'reset role';
    perform set_config('ctm.system', 'on', true);
    update inventory_items set vault_location = 'Vault B' where id = it; -- the item is moved in the system (rolled back with the test)
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform start_inventory_audit('Vault B', null); s := 'vault b started';
    exception when others then s := case when sqlerrm like 'OVERLAP:%Safe 1 (1 item the same)%' then 'vault b refused' else sqlerrm end; end;
    r := audit_open_overlaps();
    s := s || '/' || (select (e->>'n') from jsonb_array_elements(r) e where (e->>'audit_id')::uuid = a and e->>'vault' = 'Vault B');
    a2 := start_inventory_audit('Vault A', null); -- shares nothing with the Safe 1 audit: no reason needed
    s := s || '/' || (select (overlap_reason is null)::text from physical_inventory_audits where id = a2);
    execute 'reset role';
    outcome := case when s = 'vault b refused/1/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Working together: an Admin can check an item in an Operator''s audit and it is saved under the Admin''s name; a discarded draft can still be opened and shows its checks; it can''t be put back among the active audits';
  begin
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select x.id into l from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform record_audit_result(l, 'found', 0);
    perform discard_audit_session(a, 'TEST discard with a check', true);
    r := audit_session_page(a, 'found');
    s := (r->'audit'->>'status') || '/' || (r->>'total');
    execute 'reset role';
    select x.checked_by into who from physical_inventory_audit_items x where x.id = l;
    s := s || '/' || (who = admin_id)::text;
    perform set_config('ctm.system', 'on', true);
    begin update physical_inventory_audits set archived_at = null where id = a; s := s || '/restored';
    exception when others then s := s || '/restore refused'; end;
    outcome := case when s = 'discarded/1/true/restore refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Roles, straight at the database: Cashier and Appraiser can''t start (with or without a reason), discard, or read the overlap list';
  begin
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    s := '';
    foreach who in array array[cash_id, appr_id] loop
      perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
      begin perform start_inventory_audit('Vault B', null); s := s || 'S'; exception when others then s := s || '1'; end;
      begin perform start_inventory_audit(null, null, 'TEST I want an overlap'); s := s || 'O'; exception when others then s := s || '2'; end;
      begin perform start_inventory_audit('Safe 1', null); s := s || 'C'; exception when others then s := s || '3'; end; -- "continue" is refused too
      begin perform discard_audit_session(a, 'TEST not allowed', true); s := s || 'D'; exception when others then s := s || '4'; end;
      begin perform audit_open_overlaps(); s := s || 'L'; exception when others then s := s || '5'; end;
      s := s || ' ';
    end loop;
    execute 'reset role';
    outcome := case when s = '12345 12345 ' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0049() from public, anon, authenticated;

-- all the audit self-tests on a clean slate (see 0048), now with 0049
create or replace function public.ctm_selftest_audit() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare res jsonb;
begin
  begin
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    perform set_config('ctm.system', 'off', true);
    select jsonb_agg(jsonb_build_object('t', z.t || ' ' || z.test, 'o', z.outcome) order by z.t) into res from (
      select '0033' t, * from ctm_selftest_0033() union all select '0044' t, * from ctm_selftest_0044()
      union all select '0045' t, * from ctm_selftest_0045() union all select '0046' t, * from ctm_selftest_0046()
      union all select '0047' t, * from ctm_selftest_0047() union all select '0048' t, * from ctm_selftest_0048()
      union all select '0049' t, * from ctm_selftest_0049()) z;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then raise; end if; end;
  return query select e->>'t', e->>'o' from jsonb_array_elements(res) e;
end $$;

-- applied only if every audit self-test passes (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from public.ctm_selftest_audit() where outcome not like 'PASS%';
  if n > 0 then raise exception E'0049 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
