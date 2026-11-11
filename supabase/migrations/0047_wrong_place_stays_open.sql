-- 0047 (Nov 11, 2026, Wush): "Found at another location" no longer closes a follow-up.
-- Why (Physical Audit final verification): an item found in the wrong place is not missing any more, but the
--   system still says it is somewhere else. Closing the follow-up there would hide that mismatch. The app has no
--   screen yet to move an item to another vault location, so the only honest way to finish is: the item is back at
--   its recorded place and someone saw it there ("found_expected").
-- Now: found_elsewhere is saved as a check (with the place) and the item STAYS on the follow-up list.
--   Only found_expected closes it. Nothing here changes an item, its location, its custody status or a loan.
-- Self-test: select * from public.ctm_selftest_0047();   (every test rolls back)

create or replace function public.review_audit_discrepancy(p_line uuid, p_outcome text, p_notes text, p_found_location text default null, p_seen integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.physical_inventory_audit_items; a public.physical_inventory_audits; n int; v_notes text := btrim(coalesce(p_notes, '')); v_place text := btrim(coalesce(p_found_location, ''));
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]); -- Operator or Admin
  select * into l from public.physical_inventory_audit_items where id = p_line for update;
  if not found then raise exception 'Audit line not found.'; end if;
  select * into a from public.physical_inventory_audits where id = l.audit_id;
  if a.status <> 'submitted' or a.archived_at is not null then raise exception 'This audit is not submitted yet.'; end if;
  if coalesce(l.result, case when l.found = false then 'not_located' end) not in ('not_located', 'found_elsewhere') or l.result is null and l.found is distinct from false then
    raise exception 'This item had no problem in that audit.';
  end if;
  if l.resolved_at is not null then raise exception 'This follow-up is already closed. Reload the page.'; end if;
  select count(*) into n from public.physical_inventory_audit_followups where line_id = l.id;
  if p_seen is not null and p_seen <> n then raise exception 'Someone else added a follow-up for this item a moment ago. Reload the page and look at it first.'; end if;
  if p_outcome is null or p_outcome not in ('found_expected', 'found_elsewhere', 'still_not_located', 'escalated') then raise exception 'Pick what you found.'; end if;
  if char_length(v_notes) < 10 then raise exception 'Write what you checked and saw (at least 10 characters).'; end if;
  if char_length(v_notes) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  if p_outcome = 'found_elsewhere' and char_length(v_place) < 2 then raise exception 'Write where the item was found.'; end if;
  if char_length(v_place) > 120 then raise exception 'Keep the place to 120 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  insert into public.physical_inventory_audit_followups (line_id, outcome, found_location, notes, created_by, is_demo)
  values (l.id, p_outcome, case when p_outcome = 'found_elsewhere' then v_place end, v_notes, auth.uid(), l.is_demo);
  if p_outcome = 'found_expected' then -- at its recorded place: the follow-up is closed. The audit's own result stays.
    update public.physical_inventory_audit_items set resolved_at = now(), resolved_by = auth.uid(), resolution_notes = v_notes, resolution_outcome = p_outcome where id = l.id;
  end if;
  return jsonb_build_object('closed', p_outcome = 'found_expected', 'checks', n + 1);
end $$;

-- none was closed as found_elsewhere before this (0046 is from the same day), but keep the rule in the table too
alter table public.physical_inventory_audit_items drop constraint if exists physical_inventory_audit_items_resolution_outcome_check;
alter table public.physical_inventory_audit_items add constraint physical_inventory_audit_items_resolution_outcome_check
  check (resolution_outcome is null or resolution_outcome = 'found_expected');

-- the 0046 self-test, with the new rule
create or replace function public.ctm_selftest_0046() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  a uuid; l uuid; l2 uuid; s text; n int; r jsonb; h1 text; h2 text; t0 int; k text;
begin
  test := 'Old follow-ups kept: every line that was marked found before has one history row';
  select count(*) into n from physical_inventory_audit_items x where x.resolved_at is not null
    and not exists (select 1 from physical_inventory_audit_followups f where f.line_id = x.id);
  outcome := case when n = 0 then 'PASS' else 'FAIL ' || n || ' without history' end;
  return next;

  test := 'Review: only after submit; still not located, escalated and found elsewhere keep it open; found at its place closes it; every check is kept; the audit result, items and loans are not changed';
  begin
    select md5(string_agg(i::text, '|' order by i.id)) into h1 from inventory_items i;
    select md5(string_agg(x::text, '|' order by x.id)) into h2 from loans x;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    t0 := (audit_followup_list(100)->>'total')::int;
    a := start_inventory_audit('Safe 1', null);
    select x.id into l from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    perform record_audit_result(l, 'not_located', 0, 'not_at_location', 'TEST');
    begin perform review_audit_discrepancy(l, 'found_expected', 'TEST checked the shelf again', null, 0); s := 'draft reviewed';
    exception when others then s := case when sqlerrm like '%not submitted%' then 'draft refused' else sqlerrm end; end;
    perform submit_audit_session(a, true);
    s := s || '/' || ((audit_followup_list(100)->>'total')::int - t0);
    r := review_audit_discrepancy(l, 'still_not_located', 'TEST looked again, not on the shelf', null, 0);
    s := s || '/' || (r->>'closed');
    r := review_audit_discrepancy(l, 'escalated', 'TEST told the Admin about it', null, 1);
    s := s || '/' || (r->>'closed') || '/' || ((audit_followup_list(100)->>'total')::int - t0);
    r := review_audit_discrepancy(l, 'found_elsewhere', 'TEST it was in the other vault', 'Vault B shelf 2', 2);
    s := s || '/' || (r->>'closed') || '/' || ((audit_followup_list(100)->>'total')::int - t0); -- 0047: the wrong place keeps it open
    r := review_audit_discrepancy(l, 'found_expected', 'TEST put back and matched the tag', null, 3);
    s := s || '/' || (r->>'closed') || '/' || ((audit_followup_list(100)->>'total')::int - t0) || '/' || jsonb_array_length(audit_followups_for(a));
    execute 'reset role';
    select x.result || ',' || x.resolution_outcome || ',' || (x.resolved_by = op_id) into k from physical_inventory_audit_items x where x.id = l;
    s := s || '|' || k || '|' || ((select md5(string_agg(i::text, '|' order by i.id)) from inventory_items i) = h1) || '/' || ((select md5(string_agg(x::text, '|' order by x.id)) from loans x) = h2);
    outcome := case when s = 'draft refused/1/false/false/1/false/1/true/0/4|not_located,found_expected,true|true/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Checks: an older screen is refused; a closed follow-up can''t be done again; a short note, no place and a made-up outcome are refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select x.id into l from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    select x.id into l2 from physical_inventory_audit_items x where x.audit_id = a order by x.id desc limit 1;
    perform record_audit_result(l, 'not_located', 0, 'not_at_location', 'TEST');
    perform record_audit_result(l2, 'found', 0);
    perform submit_audit_session(a, true);
    s := '';
    begin perform review_audit_discrepancy(l, 'found_expected', 'short', null, 0); s := s || 'short saved';
    exception when others then s := s || case when sqlerrm like 'Write what you checked%' then 'n' else sqlerrm end; end;
    begin perform review_audit_discrepancy(l, 'found_elsewhere', 'TEST found it somewhere else', ' ', 0); s := s || '/no place saved';
    exception when others then s := s || case when sqlerrm like 'Write where%' then '/p' else '/' || sqlerrm end; end;
    begin perform review_audit_discrepancy(l, 'sold', 'TEST made-up outcome here', null, 0); s := s || '/made-up saved';
    exception when others then s := s || case when sqlerrm like 'Pick what you found%' then '/o' else '/' || sqlerrm end; end;
    begin perform review_audit_discrepancy(l2, 'found_expected', 'TEST this one had no problem', null, 0); s := s || '/no-problem saved';
    exception when others then s := s || case when sqlerrm like '%no problem%' then '/x' else '/' || sqlerrm end; end;
    perform review_audit_discrepancy(l, 'still_not_located', 'TEST first person looked again', null, 0);
    begin perform review_audit_discrepancy(l, 'found_expected', 'TEST second person, old screen', null, 0); s := s || '/stale saved';
    exception when others then s := s || case when sqlerrm like 'Someone else added%' then '/s' else '/' || sqlerrm end; end;
    perform review_audit_discrepancy(l, 'found_expected', 'TEST found it on its shelf', null, 1);
    begin perform review_audit_discrepancy(l, 'found_expected', 'TEST pressed a second time', null, 2); s := s || '/twice saved';
    exception when others then s := s || case when sqlerrm like '%already closed%' then '/c' else '/' || sqlerrm end; end;
    execute 'reset role';
    select count(*) into n from physical_inventory_audit_followups f where f.line_id = l;
    outcome := case when s = 'n/p/o/x/s/c' and n = 2 then 'PASS' else 'FAIL ' || s || ' rows=' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Roles: a Cashier can''t review, read the list or write a follow-up row; an Operator can''t write a row directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select x.id into l from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    perform record_audit_result(l, 'not_located', 0, 'not_at_location', 'TEST');
    perform submit_audit_session(a, true);
    s := '';
    begin insert into physical_inventory_audit_followups (line_id, outcome, notes) values (l, 'found_expected', 'TEST direct insert'); s := s || 'op insert saved';
    exception when others then s := s || 'i'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform review_audit_discrepancy(l, 'found_expected', 'TEST cashier tries this', null, 0); s := s || '/cash review saved'; exception when others then s := s || '/r'; end;
    begin perform audit_followup_list(); s := s || '/cash list read'; exception when others then s := s || '/l'; end;
    begin perform audit_followups_for(a); s := s || '/cash history read'; exception when others then s := s || '/h'; end;
    execute 'reset role';
    outcome := case when s = 'i/r/l/h' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;

create or replace function public.ctm_selftest_0047() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  a uuid; a2 uuid; l uuid; l2 uuid; it uuid; s text; r jsonb; t0 int; v0 text; who uuid;
begin
  test := 'Wrong place stays open: an audit''s Found elsewhere, and a follow-up answered Found at another location, stay on the list; the item''s location in the system is not changed';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    t0 := (audit_followup_list(100)->>'total')::int;
    a := start_inventory_audit('Safe 1', null);
    select x.id, x.inventory_item_id into l, it from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    select vault_location into v0 from inventory_items where id = it;
    perform record_audit_result(l, 'found_elsewhere', 0, null, 'TEST', 'Vault B shelf 9');
    perform submit_audit_session(a, true);
    s := ((audit_followup_list(100)->>'total')::int - t0)::text;
    r := review_audit_discrepancy(l, 'found_elsewhere', 'TEST still in the other vault', 'Vault B shelf 9', 0);
    s := s || '/' || (r->>'closed') || '/' || ((audit_followup_list(100)->>'total')::int - t0);
    execute 'reset role';
    s := s || '/' || ((select vault_location from inventory_items where id = it) = v0) || '/' || ((select result from physical_inventory_audit_items where id = l) = 'found_elsewhere')
           || '/' || ((select resolved_at from physical_inventory_audit_items where id = l) is null);
    outcome := case when s = '1/false/1/true/true/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'History: a closed problem stays in its audit; the same item can get a NEW problem in a later audit; each check keeps who did it';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select x.id, x.inventory_item_id into l, it from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    perform record_audit_result(l, 'not_located', 0, 'not_at_location', 'TEST first time');
    perform submit_audit_session(a, true);
    perform review_audit_discrepancy(l, 'found_expected', 'TEST found on its shelf', null, 0);
    a2 := start_inventory_audit('Safe 1', null);
    select x.id into l2 from physical_inventory_audit_items x where x.audit_id = a2 and x.inventory_item_id = it;
    perform record_audit_result(l2, 'not_located', 0, 'label_mismatch', 'TEST second time');
    perform submit_audit_session(a2, true);
    r := audit_followup_list(100);
    execute 'reset role';
    select f.created_by into who from physical_inventory_audit_followups f where f.line_id = l;
    s := (a <> a2)::text || '/' || (select x.result || ',' || (x.resolved_at is not null) from physical_inventory_audit_items x where x.id = l)
         || '/' || (select x.result || ',' || (x.resolved_at is null) from physical_inventory_audit_items x where x.id = l2)
         || '/' || (exists (select 1 from jsonb_array_elements(r->'rows') e where (e->>'id')::uuid = l2))::text
         || '/' || (not exists (select 1 from jsonb_array_elements(r->'rows') e where (e->>'id')::uuid = l))::text
         || '/' || (who = op_id);
    outcome := case when s = 'true/not_located,true/not_located,true/true/true/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Roles, straight at the database: Cashier and Appraiser are refused by every audit function; they can''t change audit rows directly either';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select x.id into l from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    perform record_audit_result(l, 'not_located', 0, 'not_at_location', 'TEST');
    s := '';
    foreach who in array array[cash_id, appr_id] loop
      perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
      begin perform start_inventory_audit('Vault B', null); s := s || 'S'; exception when others then s := s || '1'; end;
      begin perform record_audit_result(l, 'found', 1); s := s || 'R'; exception when others then s := s || '2'; end;
      begin perform submit_audit_session(a, true); s := s || 'B'; exception when others then s := s || '3'; end;
      begin perform discard_audit_session(a, 'TEST reason'); s := s || 'D'; exception when others then s := s || '4'; end;
      begin perform audit_session_page(a); s := s || 'P'; exception when others then s := s || '5'; end;
      begin perform audit_scope_options(); s := s || 'O'; exception when others then s := s || '6'; end;
      begin perform audit_followup_list(); s := s || 'L'; exception when others then s := s || '7'; end;
      begin perform review_audit_discrepancy(l, 'found_expected', 'TEST not allowed to', null, 0); s := s || 'V'; exception when others then s := s || '8'; end;
      begin update physical_inventory_audit_items set result = 'found' where id = l; if found then s := s || 'U'; else s := s || '9'; end if; exception when others then s := s || '9'; end;
      begin update physical_inventory_audits set status = 'submitted' where id = a; if found then s := s || 'A'; else s := s || '0'; end if; exception when others then s := s || '0'; end;
      s := s || ' ';
    end loop;
    execute 'reset role';
    outcome := case when s = '1234567890 1234567890 ' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0047() from public, anon, authenticated;

-- applied only if these still pass (the whole migration rolls back otherwise)
do $guard$
declare r text;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 60), E'\n') into r from (
    select '0033' t, * from public.ctm_selftest_0033() union all select '0044' t, * from public.ctm_selftest_0044()
    union all select '0045' t, * from public.ctm_selftest_0045() union all select '0046' t, * from public.ctm_selftest_0046()
    union all select '0047' t, * from public.ctm_selftest_0047()) z where outcome not like 'PASS%';
  if r is not null then raise exception E'0047 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
