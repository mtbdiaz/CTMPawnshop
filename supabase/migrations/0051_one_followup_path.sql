-- 0051 (Nov 12, 2026, Wush): the old "Mark found" function uses the new follow-up rules, word for word.
-- Why (Physical Audit security check): resolve_audit_item (from before audit sessions) is not used by any page, but
--   an Operator could still call it. 0050 gave it the same checks as the new follow-up, written a second time.
--   Two copies of the same rules can drift apart, so now it has NO rules of its own: it calls
--   review_audit_discrepancy with the answer "at its recorded location". Whatever that function allows or refuses
--   (role, submitted audit only, a line with a problem, not closed yet, a real note, who and when saved as a
--   follow-up row), this one allows or refuses too. It can't close anything the new flow would not.
--   Two messages keep their old wording, because older self-tests look for them.
-- No audit record is changed. Nothing here touches an item, a loan, a custody status or money.
-- Self-test: select * from public.ctm_selftest_audit();  (everything rolls back)

create or replace function public.resolve_audit_item(p_line_id uuid, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- the one and only set of rules; the role is checked in there first (Operator or Admin, by auth.uid())
  perform public.review_audit_discrepancy(p_line_id, 'found_expected', p_notes, null, null);
exception when others then
  if sqlerrm like 'This follow-up is already closed%' then raise exception 'This missing item was already marked found.'; end if;
  if sqlerrm like 'Write what you checked and saw%' then raise exception 'Write where the item was found (at least 10 characters).'; end if;
  raise; -- every other refusal as it is (not allowed for the role, not submitted, no problem on that line, ...)
end $$;
revoke all on function public.resolve_audit_item(uuid, text) from public, anon;
grant execute on function public.resolve_audit_item(uuid, text) to authenticated;

create or replace function public.ctm_selftest_0051() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  a uuid; a2 uuid; l uuid; l2 uuid; l3 uuid; s text; who uuid;
begin
  test := 'The old Mark found can do nothing the new follow-up can''t: refused for Cashier and Appraiser, on a draft, on a line with no problem, with a short note and twice; when it does close, it leaves a follow-up row with who and when and keeps the audit''s own result';
  begin
    perform set_config('ctm.system', 'on', true); -- a clean slate inside this test only (rolled back)
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit('Safe 1', null);
    select x.id into l from physical_inventory_audit_items x where x.audit_id = a order by x.id limit 1;
    select x.id into l2 from physical_inventory_audit_items x where x.audit_id = a order by x.id desc limit 1;
    perform record_audit_result(l, 'not_located', 0, 'not_at_location', 'TEST');
    perform record_audit_result(l2, 'found', 0);
    s := '';
    begin perform resolve_audit_item(l, 'TEST found on its shelf again'); s := s || 'draft closed';
    exception when others then s := s || case when sqlerrm like '%not submitted%' then '1' else sqlerrm end; end;
    perform submit_audit_session(a, true);
    foreach who in array array[cash_id, appr_id] loop
      perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
      begin perform resolve_audit_item(l, 'TEST found on its shelf again'); s := s || '/role closed';
      exception when others then s := s || case when sqlerrm like '%not allowed%' then '/2' else '/' || sqlerrm end; end;
    end loop;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform resolve_audit_item(l2, 'TEST this line had no problem'); s := s || '/no-problem closed';
    exception when others then s := s || case when sqlerrm like '%no problem%' then '/3' else '/' || sqlerrm end; end;
    begin perform resolve_audit_item(l, 'short'); s := s || '/short closed';
    exception when others then s := s || case when sqlerrm like 'Write where the item was found (at least 10%' then '/4' else '/' || sqlerrm end; end;
    begin perform resolve_audit_item(gen_random_uuid(), 'TEST no such line at all'); s := s || '/made-up line closed';
    exception when others then s := s || case when sqlerrm like 'Audit line not found%' then '/5' else '/' || sqlerrm end; end;
    perform resolve_audit_item(l, 'TEST found on its shelf again');
    begin perform resolve_audit_item(l, 'TEST pressed a second time'); s := s || '/closed twice';
    exception when others then s := s || case when sqlerrm like '%already marked found%' then '/6' else '/' || sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || (select x.result || ',' || x.resolution_outcome || ',' || (x.resolved_by = op_id) from physical_inventory_audit_items x where x.id = l)
           || '|' || (select count(*) || ',' || bool_and(f.created_by = op_id and f.outcome = 'found_expected') from physical_inventory_audit_followups f where f.line_id = l);
    outcome := case when s = '1/2/2/3/4/5/6|not_located,found_expected,true|1,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0051() from public, anon, authenticated;

-- all the audit self-tests on a clean slate (see 0048), now with 0051
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
      union all select '0049' t, * from ctm_selftest_0049() union all select '0050' t, * from ctm_selftest_0050()
      union all select '0051' t, * from ctm_selftest_0051()) z;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then raise; end if; end;
  return query select e->>'t', e->>'o' from jsonb_array_elements(res) e;
end $$;

-- applied only if every audit self-test passes (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from public.ctm_selftest_audit() where outcome not like 'PASS%';
  if n > 0 then raise exception E'0051 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
