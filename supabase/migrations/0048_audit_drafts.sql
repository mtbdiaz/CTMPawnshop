-- 0048 (Nov 12, 2026, Wush): audit drafts: no accidental overlaps, and a safer Discard.
-- Why: starting an audit for one location after another left a growing list of drafts, some of them listing the
--   same items (All locations + one shelf). The same location twice was already impossible (one open audit per
--   location, since 0044); what was missing:
--   1. Overlap: "All locations" lists every item, so it overlaps an open audit of one location (and the other way
--      round). A spot check of one safe during a long full count is a real thing, so this is ALLOWED, but never by
--      accident: the start is refused unless the person says they want a separate audit (p_allow_overlap).
--      Each audit keeps its own results; one never writes into another.
--   2. Two people pressing Start at the same moment: one start at a time (a lock), so they get the same audit.
--   3. Discard: only the person who started the draft, or an Admin. A draft with saved checks needs an extra yes.
--      The draft is not deleted: its status becomes 'discarded' (with who, when and why), and its lines are kept.
-- Nothing here changes an item, a loan, a custody status or money.
-- Self-test: select * from public.ctm_selftest_audit();  (all audit self-tests on a clean slate; everything rolls back)

-- 1. a third status for a draft that was thrown away
alter table public.physical_inventory_audits drop constraint if exists physical_inventory_audits_status_check;
alter table public.physical_inventory_audits add constraint physical_inventory_audits_status_check
  check (status in ('in_progress', 'submitted', 'discarded'));
-- the drafts discarded before this were only "archived"; give them the new status (no real audit is touched)
select set_config('ctm.system', 'on', true);
update public.physical_inventory_audits set status = 'discarded' where status = 'in_progress' and archived_at is not null;
select set_config('ctm.system', 'off', true);

-- 2. Start: same location = the open audit (unchanged). New: overlap needs a clear yes, and one start at a time.
drop function if exists public.start_inventory_audit(text, uuid);
create or replace function public.start_inventory_audit(p_scope text default null, p_request_id uuid default null, p_allow_overlap boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_scope text := nullif(btrim(coalesce(p_scope, '')), ''); n int; v_other text;
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
  -- an open audit that lists the same items: All locations vs one location
  if not coalesce(p_allow_overlap, false) then
    select string_agg(coalesce(scope_vault, 'All locations'), ', ' order by scope_vault nulls first) into v_other
    from public.physical_inventory_audits
    where status = 'in_progress' and archived_at is null and (v_scope is null or scope_vault is null);
    if v_other is not null then
      raise exception 'OVERLAP: An audit that lists the same items is already in progress (%). Continue that one, or confirm that you want a separate audit.', v_other;
    end if;
  end if;
  select count(*) into n from public.inventory_items
  where archived_at is null and public.ctm_in_custody(status) and (v_scope is null or vault_location = v_scope);
  if n = 0 then raise exception 'There are no items in % to audit.', coalesce(v_scope, 'the vault'); end if;
  perform set_config('ctm.system', 'on', true);
  begin
    insert into public.physical_inventory_audits (performed_by, status, scope_vault, started_at, expected_count, request_id, discrepancy_count)
    values (auth.uid(), 'in_progress', v_scope, now(), n, p_request_id, 0) returning id into v_id;
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
revoke all on function public.start_inventory_audit(text, uuid, boolean) from public, anon;
grant execute on function public.start_inventory_audit(text, uuid, boolean) to authenticated;

-- 3. Discard a draft
drop function if exists public.discard_audit_session(uuid, text);
create or replace function public.discard_audit_session(p_audit uuid, p_reason text, p_confirm_checks boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare a public.physical_inventory_audits; r public.staff_role; n int;
begin
  r := public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into a from public.physical_inventory_audits where id = p_audit for update;
  if not found then raise exception 'Audit not found.'; end if;
  if a.status = 'submitted' then raise exception 'A submitted audit can''t be discarded.'; end if;
  if a.status <> 'in_progress' or a.archived_at is not null then raise exception 'This draft was already discarded.'; end if;
  if r <> 'admin' and a.performed_by is distinct from auth.uid() then
    raise exception 'Only the person who started this audit, or an Admin, can discard it.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  if char_length(btrim(p_reason)) > 300 then raise exception 'Keep the reason to 300 characters or less.'; end if;
  select count(*) into n from public.physical_inventory_audit_items where audit_id = a.id and result is not null;
  if n > 0 and not coalesce(p_confirm_checks, false) then
    raise exception 'This draft has % saved %. Tick the box to confirm you want to discard it.', n, case when n = 1 then 'check' else 'checks' end;
  end if;
  perform set_config('ctm.system', 'on', true);
  -- not deleted: the draft and its lines stay in the database, marked discarded, with who, when and why
  update public.physical_inventory_audits set status = 'discarded', archived_at = now(), archived_by = auth.uid(), archive_reason = btrim(p_reason) where id = a.id;
end $$;
revoke all on function public.discard_audit_session(uuid, text, boolean) from public, anon;
grant execute on function public.discard_audit_session(uuid, text, boolean) to authenticated;

create or replace function public.ctm_selftest_0048() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  admin_id uuid;
  a uuid; a2 uuid; a3 uuid; a4 uuid; l uuid; s text; n int; h1 text; h2 text;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;

  test := 'Start: the same location twice = one audit (also with a repeated request); another location is its own audit; an overlap is refused unless asked for; an asked-for overlap is separate';
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
    exception when others then s := s || case when sqlerrm like 'OVERLAP:%Safe 1, Vault B%' then '/all refused' else '/' || sqlerrm end; end;
    a4 := start_inventory_audit(null, null, true);
    s := s || '/' || (a4 not in (a, a3))::text || '/' || (select count(*) from physical_inventory_audit_items x where x.audit_id = a4 and x.result is not null);
    begin perform start_inventory_audit('Vault A', null); s := s || '/location started';
    exception when others then s := s || case when sqlerrm like 'OVERLAP:%All locations%' then '/location refused' else '/' || sqlerrm end; end;
    execute 'reset role';
    s := s || '/' || (select count(*) from physical_inventory_audits where status = 'in_progress' and archived_at is null);
    outcome := case when s = 'truetrue/1/true/all refused/true/0/location refused/3' then 'PASS' else 'FAIL ' || s end;
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
revoke all on function public.ctm_selftest_0048() from public, anon, authenticated;

-- All the audit self-tests in one go, on a clean slate. The older ones (0044 to 0047) start audits of "Safe 1" and
-- of all locations, so real drafts that are open at the time would get in their way. This sets the open drafts
-- aside first, runs every test, then rolls everything back (the real drafts are untouched).
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
      union all select '0047' t, * from ctm_selftest_0047() union all select '0048' t, * from ctm_selftest_0048()) z;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then raise; end if; end;
  return query select e->>'t', e->>'o' from jsonb_array_elements(res) e;
end $$;
revoke all on function public.ctm_selftest_audit() from public, anon, authenticated;

-- applied only if every audit self-test passes (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from public.ctm_selftest_audit() where outcome not like 'PASS%';
  if n > 0 then raise exception E'0048 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
