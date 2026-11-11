-- 0044 (Nov 11, 2026, Wush): Physical audit becomes a saved audit SESSION with three results per item.
-- Why (Wush's Physical Audit brief, Nov 11):
--   - The old form started with EVERY item ticked "Found" (defaultChecked). An item nobody looked at was saved as
--     found. Now every item starts as "Not checked" and only a person can set Found / Found elsewhere / Not located.
--   - The whole audit lived in the browser until Submit: a refresh, a closed tab or a second person lost or
--     overwrote the work. Now each result is saved in the database the moment it is picked (a draft), so the
--     audit survives page changes, filters, refreshes and a second device, and can be resumed later.
--   - Two people checking the same item can't silently overwrite each other (each line has a version number).
-- What it does NOT do: starting, saving or submitting an audit never changes an inventory item, a loan or a custody
--   status. A missing item still goes through the existing follow-up ("Mark found") or other authorized workflows.
-- Owner decisions (Wush, Nov 11, "do what is good"): partial audits are allowed but labelled Partial with the number
--   left unchecked; one open audit per location (starting again resumes it); Operator and Admin, as before.
-- Self-test: select * from public.ctm_selftest_0044();   (every test rolls back)

-- 1. the audit = a session
alter table public.physical_inventory_audits
  add column status text not null default 'submitted' check (status in ('in_progress', 'submitted')),
  add column scope_vault text,                                   -- null = every vault location
  add column started_at timestamptz not null default now(),
  add column submitted_at timestamptz,
  add column submitted_by uuid references public.profiles(id),
  add column is_partial boolean not null default false,
  add column expected_count integer,
  add column request_id uuid unique;                              -- the same Start pressed twice = one audit
-- the 8 audits saved before this were finished in one go
update public.physical_inventory_audits a set started_at = a.created_at, submitted_at = a.created_at, submitted_by = a.performed_by,
  expected_count = (select count(*) from public.physical_inventory_audit_items i where i.audit_id = a.id)
where a.submitted_at is null;
-- at most one open audit per location ("all" counts as its own location)
create unique index physical_inventory_audits_one_open on public.physical_inventory_audits (coalesce(scope_vault, '*'))
  where status = 'in_progress' and archived_at is null;

-- 2. one line per expected item = what the person found
alter table public.physical_inventory_audit_items
  alter column found drop not null,                                -- null = not checked (kept for the older pages and the follow-up list)
  add column result text check (result in ('found', 'found_elsewhere', 'not_located')), -- null = Not checked
  add column reason text check (reason is null or reason in ('not_at_location', 'label_mismatch', 'details_mismatch', 'other')),
  add column found_location text check (found_location is null or char_length(found_location) between 2 and 120),
  add column expected_vault text,                                  -- the vault location when the audit started (snapshot)
  add column checked_at timestamptz,
  add column checked_by uuid references public.profiles(id),
  add column version integer not null default 0;
update public.physical_inventory_audit_items set result = case when found then 'found' else 'not_located' end where result is null and found is not null;
create index if not exists physical_inventory_audit_items_audit on public.physical_inventory_audit_items (audit_id);
create index if not exists physical_inventory_audit_items_item on public.physical_inventory_audit_items (inventory_item_id);

-- the statuses that mean "the item is physically in the shop" (same list as the Inventory page's In vault)
create or replace function public.ctm_in_custody(s public.inventory_status) returns boolean
language sql immutable set search_path = public as $$ select s in ('pawned', 'extended', 'forfeited', 'queued_for_auction') $$;

-- 3. start (or resume) an audit for one location or for all of them. Takes a snapshot of the expected items.
create or replace function public.start_inventory_audit(p_scope text default null, p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_scope text := nullif(btrim(coalesce(p_scope, '')), ''); n int;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]); -- Operator or Admin
  if p_request_id is not null then
    select id into v_id from public.physical_inventory_audits where request_id = p_request_id;
    if found then return v_id; end if;                              -- Start pressed twice
  end if;
  select id into v_id from public.physical_inventory_audits
  where status = 'in_progress' and archived_at is null and coalesce(scope_vault, '*') = coalesce(v_scope, '*');
  if found then return v_id; end if;                                -- already open: resume it
  select count(*) into n from public.inventory_items
  where archived_at is null and public.ctm_in_custody(status) and (v_scope is null or vault_location = v_scope);
  if n = 0 then raise exception 'There are no items in % to audit.', coalesce(v_scope, 'the vault'); end if;
  perform set_config('ctm.system', 'on', true);
  begin
    insert into public.physical_inventory_audits (performed_by, status, scope_vault, started_at, expected_count, request_id, discrepancy_count)
    values (auth.uid(), 'in_progress', v_scope, now(), n, p_request_id, 0) returning id into v_id;
  exception when unique_violation then -- two people pressed Start for the same location at the same moment: use the other one
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

-- 4. save one result (a draft). p_version = the version the page showed; a different one = someone else changed it.
create or replace function public.record_audit_result(p_line uuid, p_result text, p_version integer, p_reason text default null, p_note text default null, p_found_location text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare l public.physical_inventory_audit_items; a public.physical_inventory_audits; v_result text := nullif(p_result, 'not_checked'); who text;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into l from public.physical_inventory_audit_items where id = p_line for update;
  if not found then raise exception 'This item is not in the audit. Reload the page.'; end if;
  select * into a from public.physical_inventory_audits where id = l.audit_id;
  if a.status <> 'in_progress' or a.archived_at is not null then raise exception 'This audit is already submitted. It can''t be changed.'; end if;
  if p_version is distinct from l.version then
    select full_name into who from public.profiles where id = l.checked_by;
    raise exception 'Someone else updated this item a moment ago (now: %, by %). Check it again.',
      coalesce(replace(l.result, '_', ' '), 'not checked'), coalesce(who, 'another staff member');
  end if;
  if v_result is not null and v_result not in ('found', 'found_elsewhere', 'not_located') then raise exception 'Unknown result.'; end if;
  if v_result = 'not_located' and p_reason is null then raise exception 'Pick a reason for Not located.'; end if;
  if v_result = 'found_elsewhere' and char_length(btrim(coalesce(p_found_location, ''))) < 2 then raise exception 'Write where the item was found.'; end if;
  if char_length(coalesce(p_note, '')) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  update public.physical_inventory_audit_items set
    result = v_result,
    found = case when v_result is null then null else v_result <> 'not_located' end, -- for the follow-up list
    reason = case when v_result = 'not_located' then p_reason end,
    found_location = case when v_result = 'found_elsewhere' then btrim(p_found_location) end,
    notes = nullif(btrim(coalesce(p_note, '')), ''),
    checked_at = case when v_result is null then null else now() end,
    checked_by = case when v_result is null then null else auth.uid() end,
    version = l.version + 1
  where id = l.id;
  return l.version + 1;
end $$;

-- 5. submit. A full audit needs every line that is still in the vault checked; a partial one is labelled Partial.
--    Lines whose item left the vault during the audit (redeemed, sold) don't need a result.
create or replace function public.submit_audit_session(p_audit uuid, p_partial boolean, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.physical_inventory_audits; v_unchecked int; v_notloc int; v_else int; v_found int;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into a from public.physical_inventory_audits where id = p_audit for update;
  if not found or a.archived_at is not null then raise exception 'Audit not found.'; end if;
  select count(*) filter (where l.result is null and public.ctm_in_custody(i.status)),
         count(*) filter (where l.result = 'not_located'),
         count(*) filter (where l.result = 'found_elsewhere'),
         count(*) filter (where l.result = 'found')
    into v_unchecked, v_notloc, v_else, v_found
  from public.physical_inventory_audit_items l join public.inventory_items i on i.id = l.inventory_item_id where l.audit_id = a.id;
  if a.status = 'submitted' then -- pressed twice, or from two tabs: the first one counts
    return jsonb_build_object('already', true, 'unchecked', v_unchecked, 'not_located', v_notloc, 'found_elsewhere', v_else, 'found', v_found);
  end if;
  if not coalesce(p_partial, false) and v_unchecked > 0 then
    raise exception '% items are still not checked. Check them, or submit it as a partial audit.', v_unchecked;
  end if;
  if char_length(coalesce(p_notes, '')) > 1000 then raise exception 'Keep the audit note to 1000 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  update public.physical_inventory_audits set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(),
    is_partial = coalesce(p_partial, false) and v_unchecked > 0, discrepancy_count = v_notloc + v_else,
    notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
  where id = a.id;
  return jsonb_build_object('already', false, 'unchecked', v_unchecked, 'not_located', v_notloc, 'found_elsewhere', v_else, 'found', v_found);
end $$;

-- 6. discard an open audit (User control and freedom). Kept, archived with a reason, never deleted.
create or replace function public.discard_audit_session(p_audit uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.physical_inventory_audits;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into a from public.physical_inventory_audits where id = p_audit for update;
  if not found or a.archived_at is not null then raise exception 'Audit not found.'; end if;
  if a.status <> 'in_progress' then raise exception 'A submitted audit can''t be discarded.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Write a reason of at least 5 characters.'; end if;
  perform set_config('ctm.system', 'on', true);
  update public.physical_inventory_audits set archived_at = now(), archived_by = auth.uid(), archive_reason = btrim(p_reason) where id = a.id;
end $$;

-- 7. "Mark found" only for an item reported Not located in a SUBMITTED audit (a draft isn't a finding yet)
create or replace function public.resolve_audit_item(p_line_id uuid, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.physical_inventory_audit_items; s text;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into a from public.physical_inventory_audit_items where id = p_line_id for update;
  if not found then raise exception 'Audit line not found.'; end if;
  select status into s from public.physical_inventory_audits where id = a.audit_id;
  if s <> 'submitted' then raise exception 'This audit is not submitted yet.'; end if;
  if a.found is distinct from false then raise exception 'This item was not marked missing in that audit.'; end if;
  if a.resolved_at is not null then raise exception 'This missing item was already marked found.'; end if;
  if coalesce(char_length(trim(p_notes)), 0) < 5 then raise exception 'Write where the item was found (at least 5 characters).'; end if;
  if char_length(trim(p_notes)) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  update public.physical_inventory_audit_items set resolved_at = now(), resolved_by = auth.uid(), resolution_notes = trim(p_notes) where id = a.id;
end $$;

revoke all on function public.start_inventory_audit(text, uuid) from public, anon;
revoke all on function public.record_audit_result(uuid, text, integer, text, text, text) from public, anon;
revoke all on function public.submit_audit_session(uuid, boolean, text) from public, anon;
revoke all on function public.discard_audit_session(uuid, text) from public, anon;
grant execute on function public.start_inventory_audit(text, uuid) to authenticated;
grant execute on function public.record_audit_result(uuid, text, integer, text, text, text) to authenticated;
grant execute on function public.submit_audit_session(uuid, boolean, text) to authenticated;
grant execute on function public.discard_audit_session(uuid, text) to authenticated;

-- 8. the rate limit gets an "audit" kind: one click per item in a walk through the vault is far more than 30 a minute
alter table public.ctm_rate_counters drop constraint ctm_rate_counters_kind_check;
alter table public.ctm_rate_counters add constraint ctm_rate_counters_kind_check check (kind in ('search', 'save', 'audit'));
create or replace function public.ctm_rate_check(p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); lim integer; n integer;
begin
  if uid is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  lim := case p_kind when 'search' then 60 when 'save' then 30 when 'audit' then 300 end; -- 0044: audit = 300 a minute
  if lim is null then raise exception 'Unknown kind of action: %', p_kind; end if;
  insert into public.ctm_rate_counters as c (user_id, kind, window_start)
  values (uid, p_kind, date_trunc('minute', now()))
  on conflict (user_id, kind, window_start) do update set count = c.count + 1
  returning c.count into n;
  if n = 1 then
    delete from public.ctm_rate_counters where user_id = uid and window_start < now() - interval '10 minutes';
  end if;
  return n <= lim;
end $$;

-- 9. the older one-go audit function (not used by the new page) also fills the new result column
create or replace function public.submit_inventory_audit(p_items jsonb, p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_audit uuid; v_disc int;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'No inventory items to audit'; end if;
  select count(*) into v_disc from jsonb_array_elements(p_items) e where not coalesce((e->>'found')::boolean, false);
  insert into public.physical_inventory_audits (performed_by, notes, discrepancy_count, expected_count, submitted_at, submitted_by)
  values (auth.uid(), nullif(trim(p_notes), ''), v_disc, jsonb_array_length(p_items), now(), auth.uid()) returning id into v_audit;
  insert into public.physical_inventory_audit_items (audit_id, inventory_item_id, expected_status, found, result, notes, checked_at, checked_by)
  select v_audit, (e->>'inventory_item_id')::uuid, (e->>'expected_status')::public.inventory_status, coalesce((e->>'found')::boolean, false),
    case when coalesce((e->>'found')::boolean, false) then 'found' else 'not_located' end, nullif(e->>'notes', ''), now(), auth.uid()
  from jsonb_array_elements(p_items) e;
  return v_audit;
end $$;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0044() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  a uuid; a2 uuid; l uuid; l2 uuid; v int; s text; n int; m int; h1 text; h2 text; r jsonb; small text;
begin
  -- a location with exactly one item in custody, for the small tests
  select vault_location into small from inventory_items where archived_at is null and ctm_in_custody(status) group by 1 having count(*) = 1 order by 1 limit 1;

  test := 'Start: every item in the vault is listed as Not checked (nothing pre-ticked), one audit per location, Start twice = the same audit';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit(null, null);
    a2 := start_inventory_audit(null, null);
    execute 'reset role';
    select count(*), count(*) filter (where x.result is null and x.found is null) into n, m from physical_inventory_audit_items x where x.audit_id = a; -- x. because "found" is also a PL/pgSQL word
    outcome := case when a = a2 and n = (select count(*) from inventory_items where archived_at is null and ctm_in_custody(status)) and m = n
                     and (select status from physical_inventory_audits where id = a) = 'in_progress'
                    then 'PASS (' || n || ' items, all Not checked)' else 'FAIL ' || n || '/' || m || ' same=' || (a = a2) end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'One location only: just its items; the old submitted audits are unchanged';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', gen_random_uuid());
    execute 'reset role';
    select count(*) into n from physical_inventory_audit_items where audit_id = a;
    select count(*) into m from physical_inventory_audits where status = 'submitted' and submitted_at is not null and id <> a;
    outcome := case when n = (select count(*) from inventory_items where archived_at is null and ctm_in_custody(status) and vault_location = 'Safe 1')
                     and m >= 8 then 'PASS (' || n || ' in Safe 1)' else 'FAIL ' || n || ' / old ' || m end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Results: Found saves; an old page (stale version) is refused; Not located needs a reason; Found elsewhere needs a place';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select id into l from physical_inventory_audit_items where audit_id = a limit 1;
    v := record_audit_result(l, 'found', 0);
    s := 'v' || v;
    begin perform record_audit_result(l, 'not_located', 0, 'not_at_location'); s := s || '/stale saved';
    exception when others then s := s || case when sqlerrm like 'Someone else updated this item%' then '/stale refused' else '/' || sqlerrm end; end;
    begin perform record_audit_result(l, 'not_located', v); s := s || '/no reason saved';
    exception when others then s := s || case when sqlerrm like 'Pick a reason%' then '/no reason refused' else '/' || sqlerrm end; end;
    begin perform record_audit_result(l, 'found_elsewhere', v, null, null, ' '); s := s || '/no place saved';
    exception when others then s := s || case when sqlerrm like 'Write where the item was found%' then '/no place refused' else '/' || sqlerrm end; end;
    v := record_audit_result(l, 'found_elsewhere', v, null, 'TEST note', 'Vault B shelf 2');
    execute 'reset role';
    select x.result || ',' || x.found || ',' || x.found_location || ',' || (x.checked_by = op_id) into h1 from physical_inventory_audit_items x where x.id = l;
    outcome := case when s = 'v1/stale refused/no reason refused/no place refused' and v = 2 and h1 = 'found_elsewhere,true,Vault B shelf 2,true'
                    then 'PASS' else 'FAIL ' || s || ' ' || v || ' ' || coalesce(h1, '?') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Roles: a Cashier and an Appraiser can''t start, check or submit; nobody can write audit lines directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select id into l from physical_inventory_audit_items where audit_id = a limit 1;
    s := '';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform start_inventory_audit('Vault B', null); s := s || 'cash start saved'; exception when others then s := s || 'c1'; end;
    begin perform record_audit_result(l, 'found', 0); s := s || 'cash check saved'; exception when others then s := s || 'c2'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    begin perform submit_audit_session(a, true); s := s || 'appr submit saved'; exception when others then s := s || 'a1'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin update physical_inventory_audit_items set result = 'found' where id = l; get diagnostics n = row_count; s := s || 'd' || n;
    exception when others then s := s || 'd-refused'; end;
    execute 'reset role';
    outcome := case when s in ('c1c2a1d0', 'c1c2a1d-refused') then 'PASS (' || s || ')' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Submit: a full audit with unchecked items is refused; partial works and is labelled; twice = once; no change after';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select id into l from physical_inventory_audit_items where audit_id = a order by id limit 1;
    select id into l2 from physical_inventory_audit_items where audit_id = a order by id desc limit 1;
    perform record_audit_result(l, 'found', 0);
    perform record_audit_result(l2, 'not_located', 0, 'not_at_location', 'TEST');
    s := '';
    begin perform submit_audit_session(a, false); s := 'full saved'; exception when others then s := case when sqlerrm like '%still not checked%' then 'full refused' else sqlerrm end; end;
    r := submit_audit_session(a, true, 'TEST partial');
    s := s || '/' || (r->>'already') || '/' || (r->>'not_located');
    r := submit_audit_session(a, true);
    s := s || '/' || (r->>'already');
    begin perform record_audit_result(l, 'not_located', 1, 'other'); s := s || '/changed after'; exception when others then s := s || '/locked'; end;
    execute 'reset role';
    select status || ',' || is_partial || ',' || discrepancy_count into h1 from physical_inventory_audits where id = a;
    outcome := case when s = 'full refused/false/1/true/locked' and h1 = 'submitted,true,1' then 'PASS' else 'FAIL ' || s || ' ' || h1 end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Nothing else changes: inventory items and loans are the same after a whole audit; Mark found only after submit';
  begin
    select md5(string_agg(i::text, '|' order by i.id)) into h1 from inventory_items i;
    select md5(string_agg(x::text, '|' order by x.id)) into h2 from loans x;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select id into l from physical_inventory_audit_items where audit_id = a limit 1;
    perform record_audit_result(l, 'not_located', 0, 'not_at_location');
    s := '';
    begin perform resolve_audit_item(l, 'TEST found it'); s := 'draft resolved'; exception when others then s := case when sqlerrm like '%not submitted%' then 'draft refused' else sqlerrm end; end;
    perform submit_audit_session(a, true);
    perform resolve_audit_item(l, 'TEST found it');
    execute 'reset role';
    s := s || '/' || ((select md5(string_agg(i::text, '|' order by i.id)) from inventory_items i) = h1) || '/' || ((select md5(string_agg(x::text, '|' order by x.id)) from loans x) = h2);
    outcome := case when s = 'draft refused/true/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'An item that leaves the vault during the audit does not block a full submit';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit(small, null);
    execute 'reset role';
    perform set_config('ctm.system', 'on', true);
    update inventory_items set status = 'redeemed' where id = (select inventory_item_id from physical_inventory_audit_items where audit_id = a limit 1);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    r := submit_audit_session(a, false);
    execute 'reset role';
    outcome := case when (r->>'unchecked')::int = 0 and (select status from physical_inventory_audits where id = a) = 'submitted' then 'PASS (' || small || ')' else 'FAIL ' || r::text end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0044() from public, anon, authenticated;
