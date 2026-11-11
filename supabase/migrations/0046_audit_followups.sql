-- 0046 (Nov 11, 2026, Wush): "Review discrepancy" for the Physical audit follow-up list.
-- Why (Physical Audit refinement brief):
--   - "Mark found" took one note and closed the problem. That is not enough proof that the right item was seen, and
--     there was no way to write "I looked again and it is still not there" or to pass it to the Admin.
--   - Now every follow-up check is its own saved row (who, when, what they found, where, the note). The line from
--     the audit is never rewritten, so the audit report still shows what was found THAT day.
-- Outcomes: found_expected (found at its expected place), found_elsewhere (found at another place: the place is
--   required), still_not_located (looked again, not there), escalated (passed on for investigation).
--   The two "found" outcomes close the follow-up. The other two keep it open.
-- What it does NOT do: it never changes the item's vault location, its custody status or its loan. Moving an item
--   in the system stays a separate step on the Inventory page.
-- Self-test: select * from public.ctm_selftest_0046();   (every test rolls back)

-- 1. one row per follow-up check
create table public.physical_inventory_audit_followups (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.physical_inventory_audit_items(id), -- the audit line this is about
  outcome text not null check (outcome in ('found_expected', 'found_elsewhere', 'still_not_located', 'escalated')),
  found_location text check (found_location is null or char_length(found_location) between 2 and 120), -- for found_elsewhere
  notes text not null check (char_length(notes) between 5 and 500),
  created_by uuid references public.profiles(id), -- the person who did the check
  created_at timestamptz not null default now(),
  is_demo boolean not null default false
);
create index physical_inventory_audit_followups_line on public.physical_inventory_audit_followups (line_id, created_at);
alter table public.physical_inventory_audit_followups enable row level security;
-- staff can read; nobody writes directly (only review_audit_discrepancy below)
create policy "physical_inventory_audit_followups: staff select" on public.physical_inventory_audit_followups for select to authenticated using (true);
revoke insert, update, delete on public.physical_inventory_audit_followups from authenticated, anon;
create trigger physical_inventory_audit_followups_audit after insert or update or delete on public.physical_inventory_audit_followups
  for each row execute function public.audit_trigger_fn(); -- every change is in the audit trail

-- how the follow-up ended, on the line (the line's own result is not touched)
alter table public.physical_inventory_audit_items
  add column resolution_outcome text check (resolution_outcome is null or resolution_outcome in ('found_expected', 'found_elsewhere'));
-- the follow-ups saved before this (the old "Mark found") become history rows too
insert into public.physical_inventory_audit_followups (line_id, outcome, notes, created_by, created_at, is_demo)
select l.id, 'found_expected', case when char_length(coalesce(l.resolution_notes, '')) >= 5 then left(l.resolution_notes, 500) else 'Marked found' end, l.resolved_by, l.resolved_at, l.is_demo
from public.physical_inventory_audit_items l where l.resolved_at is not null;
update public.physical_inventory_audit_items set resolution_outcome = 'found_expected' where resolved_at is not null and resolution_outcome is null;

-- 2. save one follow-up check. p_seen = how many checks the screen showed for this line; if someone added one
--    since, the save is refused (no silent overwrite, and a double press saves once).
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
  if p_outcome in ('found_expected', 'found_elsewhere') then -- found: the follow-up is closed. The audit's own result stays.
    update public.physical_inventory_audit_items set resolved_at = now(), resolved_by = auth.uid(), resolution_notes = v_notes, resolution_outcome = p_outcome where id = l.id;
  end if;
  return jsonb_build_object('closed', p_outcome in ('found_expected', 'found_elsewhere'), 'checks', n + 1);
end $$;
revoke all on function public.review_audit_discrepancy(uuid, text, text, text, integer) from public, anon;
grant execute on function public.review_audit_discrepancy(uuid, text, text, text, integer) to authenticated;

-- the older "Mark found" (kept so nothing that calls it breaks): it now also leaves a history row
create or replace function public.resolve_audit_item(p_line_id uuid, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.physical_inventory_audit_items; s text;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into a from public.physical_inventory_audit_items where id = p_line_id for update;
  if not found then raise exception 'Audit line not found.'; end if;
  select status into s from public.physical_inventory_audits where id = a.audit_id;
  if s <> 'submitted' then raise exception 'This audit is not submitted yet.'; end if;
  if coalesce(a.result, case when a.found = false then 'not_located' end) is distinct from 'not_located'
     and a.result is distinct from 'found_elsewhere' then
    raise exception 'This item had no problem in that audit.';
  end if;
  if a.resolved_at is not null then raise exception 'This missing item was already marked found.'; end if;
  if coalesce(char_length(trim(p_notes)), 0) < 5 then raise exception 'Write where the item was found (at least 5 characters).'; end if;
  if char_length(trim(p_notes)) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  insert into public.physical_inventory_audit_followups (line_id, outcome, notes, created_by, is_demo) values (a.id, 'found_expected', trim(p_notes), auth.uid(), a.is_demo);
  update public.physical_inventory_audit_items set resolved_at = now(), resolved_by = auth.uid(), resolution_notes = trim(p_notes), resolution_outcome = 'found_expected' where id = a.id;
end $$;

-- 3. the follow-up list for the Physical audit page: open problems of submitted audits, oldest first, with what is
--    needed to recognise the item and every check done so far
create or replace function public.audit_followup_list(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select jsonb_build_object(
    'total', (select count(*) from public.physical_inventory_audit_items l join public.physical_inventory_audits a on a.id = l.audit_id
              where l.result in ('not_located', 'found_elsewhere') and l.resolved_at is null and a.status = 'submitted' and a.archived_at is null),
    'rows', coalesce((select jsonb_agg(to_jsonb(z) order by z.audit_at, z.id) from (
      select l.id, l.audit_id, l.result, l.reason, l.notes, l.found_location,
             coalesce(a.submitted_at, a.created_at) as audit_at,
             coalesce(cp.full_name, ap.full_name) as recorded_by,       -- who checked it (older audits: who did the audit)
             coalesce(l.expected_vault, i.vault_location) as expected_vault, i.vault_location as current_vault, i.status::text as item_status,
             ai.id as appraisal_item_id, ai.appraisal_no, ai.category::text as category, ai.category_other, ai.karat, ai.weight_grams,
             ai.condition_notes, coalesce(array_length(ai.photo_paths, 1), 0) as photo_count, c.full_name as customer_name,
             (select x.ticket_number from public.loans x where x.inventory_item_id = i.id and x.archived_at is null order by x.created_at desc limit 1) as ticket_number,
             coalesce((select jsonb_agg(jsonb_build_object('outcome', f.outcome, 'found_location', f.found_location, 'notes', f.notes, 'at', f.created_at,
                         'by', (select full_name from public.profiles where id = f.created_by)) order by f.created_at)
                       from public.physical_inventory_audit_followups f where f.line_id = l.id), '[]'::jsonb) as followups
      from public.physical_inventory_audit_items l
      join public.physical_inventory_audits a on a.id = l.audit_id
      join public.inventory_items i on i.id = l.inventory_item_id
      left join public.appraisal_items ai on ai.id = i.appraisal_item_id
      left join public.customers c on c.id = ai.customer_id
      left join public.profiles cp on cp.id = l.checked_by
      left join public.profiles ap on ap.id = a.performed_by
      where l.result in ('not_located', 'found_elsewhere') and l.resolved_at is null and a.status = 'submitted' and a.archived_at is null
      order by coalesce(a.submitted_at, a.created_at), l.id
      limit least(greatest(coalesce(p_limit, 50), 1), 100)) z), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.audit_followup_list(integer) from public, anon;
grant execute on function public.audit_followup_list(integer) to authenticated;

-- 4. the checks done AFTER an audit, for that audit's report (shown apart from the audit's own results)
create or replace function public.audit_followups_for(p_audit uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object('line_id', f.line_id, 'outcome', f.outcome, 'found_location', f.found_location, 'notes', f.notes, 'at', f.created_at,
             'by', (select full_name from public.profiles where id = f.created_by)) order by f.created_at)
    from public.physical_inventory_audit_followups f
    join public.physical_inventory_audit_items l on l.id = f.line_id
    where l.audit_id = p_audit), '[]'::jsonb);
end $$;
revoke all on function public.audit_followups_for(uuid) from public, anon;
grant execute on function public.audit_followups_for(uuid) to authenticated;

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

  test := 'Review: only after submit; still not located and escalated keep it open; found elsewhere closes it; every check is kept; the audit result, items and loans are not changed';
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
    s := s || '/' || (r->>'closed') || '/' || ((audit_followup_list(100)->>'total')::int - t0) || '/' || jsonb_array_length(audit_followups_for(a));
    execute 'reset role';
    select x.result || ',' || x.resolution_outcome || ',' || (x.resolved_by = op_id) into k from physical_inventory_audit_items x where x.id = l;
    s := s || '|' || k || '|' || ((select md5(string_agg(i::text, '|' order by i.id)) from inventory_items i) = h1) || '/' || ((select md5(string_agg(x::text, '|' order by x.id)) from loans x) = h2);
    outcome := case when s = 'draft refused/1/false/false/1/true/0/3|not_located,found_elsewhere,true|true/true' then 'PASS' else 'FAIL ' || s end;
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
revoke all on function public.ctm_selftest_0046() from public, anon, authenticated;

-- applied only if these still pass (the whole migration rolls back otherwise)
do $guard$
declare r text;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 60), E'\n') into r from (
    select '0033' t, * from public.ctm_selftest_0033() union all select '0044' t, * from public.ctm_selftest_0044()
    union all select '0045' t, * from public.ctm_selftest_0045() union all select '0046' t, * from public.ctm_selftest_0046()) z where outcome not like 'PASS%';
  if r is not null then raise exception E'0046 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
