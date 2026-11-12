-- 0059 (Nov 12, 2026, Wush): Physical audit self-tests 0044 to 0047 can run on their own again. Tests only: no
-- audit rule, no audit and no draft is changed.
-- What was wrong: these four were written before the overlap rule of migration 0048 ("an audit in progress already
--   lists some of these items"). They start audits of their own, so with real drafts open in the shop (there are 6
--   test drafts now) they stopped with OVERLAP. They only passed inside ctm_selftest_audit(), which first sets the
--   open drafts aside inside its own rolled-back block. Run one by one they failed (15 tests).
-- The fix: each test block in these four now does the same thing the newer tests (0048 to 0051) do at their start:
--   inside the block, which is always rolled back, it marks the drafts in progress as discarded, runs, and the
--   rollback puts every draft back exactly as it was. The production rule is not weakened: the tests work around
--   real drafts the way a clean test shop would, and the rule itself is still tested by 0048.
-- Checked in the guard below: the audits table is byte-for-byte the same before and after the tests run.

do $patch$
declare f text; d text; d0 text;
begin
  foreach f in array array['ctm_selftest_0044', 'ctm_selftest_0045', 'ctm_selftest_0046', 'ctm_selftest_0047'] loop
    select pg_get_functiondef(('public.' || f || '()')::regprocedure) into d; d0 := d;
    if d like '%status = ''discarded'', archived_at = now() where status = ''in_progress''%' then continue; end if; -- already done
    -- after every "test := '...';  begin" line: set the open drafts aside for this block only
    d := regexp_replace(d, E'(\n  test := \'[^\n]*\';\n  begin\n)',
      E'\\1    perform set_config(\'ctm.system\', \'on\', true); update physical_inventory_audits set status = \'discarded\', archived_at = now() where status = \'in_progress\' and archived_at is null; perform set_config(\'ctm.system\', \'off\', true);\n', 'g');
    if d = d0 then raise exception '0059: could not update %', f; end if;
    execute d;
  end loop;
end $patch$;

-- applied only if the four now pass on their own AND the audits are untouched afterwards
do $guard$
declare r text; n int; h0 text; h1 text;
begin
  select md5(string_agg(a.id::text || a.status || coalesce(a.archived_at::text, ''), ',' order by a.id)) into h0 from public.physical_inventory_audits a;
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0044' t, * from public.ctm_selftest_0044() union all select '0045' t, * from public.ctm_selftest_0045()
    union all select '0046' t, * from public.ctm_selftest_0046() union all select '0047' t, * from public.ctm_selftest_0047()
    union all select 'audit' t, * from public.ctm_selftest_audit()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  select md5(string_agg(a.id::text || a.status || coalesce(a.archived_at::text, ''), ',' order by a.id)) into h1 from public.physical_inventory_audits a;
  if n > 0 then raise exception E'0059 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
  if h0 is distinct from h1 then raise exception '0059 NOT APPLIED (rolled back): the audits changed while the tests ran'; end if;
end $guard$;
