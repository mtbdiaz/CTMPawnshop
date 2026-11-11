-- 0050 (Nov 12, 2026, Wush): close the old ways around the audit session rules.
-- Why (Physical Audit security check): two functions from before audit sessions were still callable by an Operator
--   straight from the API (the pages stopped using them in 0044 / 0046):
--   1. submit_inventory_audit(items, notes): saved a whole SUBMITTED audit in one call, with whatever "found" values
--      the caller sent, for any items. That skips everything the new flow is for (every item starts Not checked,
--      one saved check per item with who and when, reasons, Review, full / partial). Nothing uses it any more
--      except one old self-test, so it is REMOVED and that self-test now uses the supported flow.
--   2. resolve_audit_item(line, notes): the old "Mark found". It closed a follow-up with a 5-letter note. It is kept
--      (three self-tests still use it) but now has the same rules as "At its recorded location" in
--      review_audit_discrepancy: a note of at least 10 characters, a submitted audit, a line with a problem, once.
--      So there is no weaker second door.
-- No audit record is changed. Nothing here touches an item, a loan, a custody status or money.
-- Self-test: select * from public.ctm_selftest_audit();  (everything rolls back)

-- 1. the old one-step audit is gone
drop function if exists public.submit_inventory_audit(jsonb, text);

-- 2. the old "Mark found" follows the same rules as the new follow-up
create or replace function public.resolve_audit_item(p_line_id uuid, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.physical_inventory_audit_items; au public.physical_inventory_audits;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]); -- Operator or Admin
  select * into a from public.physical_inventory_audit_items where id = p_line_id for update;
  if not found then raise exception 'Audit line not found.'; end if;
  select * into au from public.physical_inventory_audits where id = a.audit_id;
  if au.status <> 'submitted' or au.archived_at is not null then raise exception 'This audit is not submitted yet.'; end if;
  if coalesce(a.result, case when a.found = false then 'not_located' end) is distinct from 'not_located'
     and a.result is distinct from 'found_elsewhere' then
    raise exception 'This item had no problem in that audit.';
  end if;
  if a.resolved_at is not null then raise exception 'This missing item was already marked found.'; end if;
  if coalesce(char_length(trim(p_notes)), 0) < 10 then raise exception 'Write where the item was found (at least 10 characters).'; end if;
  if char_length(trim(p_notes)) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  insert into public.physical_inventory_audit_followups (line_id, outcome, notes, created_by, is_demo) values (a.id, 'found_expected', trim(p_notes), auth.uid(), a.is_demo);
  update public.physical_inventory_audit_items set resolved_at = now(), resolved_by = auth.uid(), resolution_notes = trim(p_notes), resolution_outcome = 'found_expected' where id = a.id;
end $$;

-- 3. the old self-test (0026) that called the removed function now checks that it is gone and that an Operator
--    can start an audit the supported way. Only those lines of the test are swapped; the rest stays as it was.
do $patch$
declare d text;
  old_title text := 'submit_inventory_audit still works for an operator';
  -- the call and the line after it, exactly as they are in the test
  old_body text := 'perform submit_inventory_audit(jsonb_build_array(jsonb_build_object(''inventory_item_id'', an_item, ''expected_status'', ''pawned'', ''found'', true)), ''SELFTEST'');' || E'\n    ' || 'outcome := ''PASS (saved, then rolled back)'';';
begin
  d := pg_get_functiondef('public.ctm_selftest_0026()'::regprocedure);
  if position(old_title in d) = 0 or position(old_body in d) = 0 then
    raise exception 'ctm_selftest_0026: the lines to change were not found';
  end if;
  d := replace(d, old_title, 'the old one-step audit function is gone; an operator starts an audit the supported way');
  d := replace(d, old_body, 'perform start_inventory_audit(''Safe 1'', null, ''SELFTEST 0026 supported audit flow'');' || E'\n    ' || 'outcome := case when to_regprocedure(''public.submit_inventory_audit(jsonb,text)'') is null then ''PASS (old function gone; an audit starts the supported way)'' else ''FAIL the old function still exists'' end;');
  execute d;
end $patch$;

create or replace function public.ctm_selftest_0050() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  a uuid; l uuid; s text; n0 int; n1 int;
begin
  test := 'No way around the audit flow for an Operator: the old one-step function is gone; audits, lines and follow-ups can''t be inserted, changed or deleted directly; a submitted audit can''t be changed, discarded or checked again';
  begin
    perform set_config('ctm.system', 'on', true); -- a clean slate inside this test only (rolled back)
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    select count(*) into n0 from physical_inventory_audits where status = 'submitted';
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    s := '';
    begin execute 'select public.submit_inventory_audit(''[]''::jsonb, ''x'')'; s := s || 'old ran';
    exception when undefined_function then s := s || 'gone'; when others then s := s || sqlerrm; end;
    a := start_inventory_audit('Safe 1', null);
    select x.id into l from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    -- straight at the tables
    begin insert into physical_inventory_audits (performed_by, status, discrepancy_count, submitted_at) values (op_id, 'submitted', 0, now()); s := s || '/audit inserted';
    exception when others then s := s || '/1'; end;
    begin update physical_inventory_audit_items set result = 'found', found = true where audit_id = a; if found then s := s || '/lines updated'; else s := s || '/2'; end if;
    exception when others then s := s || '/2'; end;
    begin update physical_inventory_audits set status = 'submitted', submitted_at = now() where id = a; if found then s := s || '/status updated'; else s := s || '/3'; end if;
    exception when others then s := s || '/3'; end;
    begin delete from physical_inventory_audit_items where audit_id = a; if found then s := s || '/lines deleted'; else s := s || '/4'; end if;
    exception when others then s := s || '/4'; end;
    begin delete from physical_inventory_audits where id = a; if found then s := s || '/audit deleted'; else s := s || '/5'; end if;
    exception when others then s := s || '/5'; end;
    -- the supported way: one item checked, the rest stay Not checked
    perform record_audit_result(l, 'not_located', 0, 'not_at_location', 'TEST');
    begin perform submit_audit_session(a, false); s := s || '/full submitted with unchecked items';
    exception when others then s := s || case when sqlerrm like '%still not checked%' then '/6' else '/' || sqlerrm end; end;
    perform submit_audit_session(a, true);
    begin perform record_audit_result(l, 'found', 1); s := s || '/changed after submit'; exception when others then s := s || '/7'; end;
    begin perform discard_audit_session(a, 'TEST discard a submitted audit', true); s := s || '/submitted discarded'; exception when others then s := s || '/8'; end;
    begin perform resolve_audit_item(l, 'short'); s := s || '/short note closed it';
    exception when others then s := s || case when sqlerrm like 'Write where the item was found (at least 10%' then '/9' else '/' || sqlerrm end; end;
    begin insert into physical_inventory_audit_followups (line_id, outcome, notes) values (l, 'found_expected', 'TEST direct insert'); s := s || '/follow-up inserted';
    exception when others then s := s || '/10'; end;
    execute 'reset role';
    select count(*) into n1 from physical_inventory_audits where status = 'submitted';
    s := s || '|' || (n1 - n0) || '|' || (select count(*) from physical_inventory_audit_items x where x.audit_id = a and x.result is not null);
    outcome := case when s = 'gone/1/2/3/4/5/6/7/8/9/10|1|1' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0050() from public, anon, authenticated;

-- all the audit self-tests on a clean slate (see 0048), now with 0026 and 0050
create or replace function public.ctm_selftest_audit() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare res jsonb;
begin
  begin
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    perform set_config('ctm.system', 'off', true);
    select jsonb_agg(jsonb_build_object('t', z.t || ' ' || z.test, 'o', z.outcome) order by z.t) into res from (
      select '0026' t, * from ctm_selftest_0026() union all select '0033' t, * from ctm_selftest_0033()
      union all select '0044' t, * from ctm_selftest_0044()
      union all select '0045' t, * from ctm_selftest_0045() union all select '0046' t, * from ctm_selftest_0046()
      union all select '0047' t, * from ctm_selftest_0047() union all select '0048' t, * from ctm_selftest_0048()
      union all select '0049' t, * from ctm_selftest_0049() union all select '0050' t, * from ctm_selftest_0050()) z;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then raise; end if; end;
  return query select e->>'t', e->>'o' from jsonb_array_elements(res) e;
end $$;

-- applied only if every audit self-test passes (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from public.ctm_selftest_audit() where outcome not like 'PASS%';
  if n > 0 then raise exception E'0050 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
