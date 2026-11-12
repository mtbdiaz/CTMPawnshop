-- 0057 (Nov 12, 2026, Wush): Cash & ledger, one more gap found in the financial-safety review. No entry is changed.
-- admin_edit_cash_entry ("Correct", Admin) refused loan entries by looking at the TYPE only (Expense / Revenue allowed).
-- An auction sale is saved as type Revenue WITH a loan, so an Admin calling the database directly could change the
-- amount of an auction-sale entry (also the 22 that are under review). The page never offered that, but the database
-- allowed it. Now Correct follows the same rule as Archive (0056): only a MANUAL entry (Expense or Revenue, no loan,
-- not a memo). Entries made by a loan, a payment or a sale are corrected from that loan (an Adjustment entry).
-- Self-test: select * from public.ctm_selftest_0057();   (rolls back)

do $patch$
declare d text; d0 text;
begin
  select pg_get_functiondef('public.admin_edit_cash_entry(uuid,numeric,text,text)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$if b.entry_type not in ('expense','revenue') then$a$, $b$if b.entry_type not in ('expense','revenue') or b.related_loan_id is not null or b.is_memo then$b$);
  if d = d0 then raise exception '0057: could not update admin_edit_cash_entry'; end if;
  execute d;
end $patch$;

create or replace function public.ctm_selftest_0057() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare admin_id uuid; e record; s text := ''; n int := 0; c0 numeric; c1 numeric;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  test := 'Called straight at the database as an Admin: no entry made by a loan, a payment, an auction sale, an adjustment or a memo can be corrected or archived; the amounts stay the same';
  begin
    select sum(amount) into c0 from cash_flow_entries where related_loan_id is not null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    -- one entry of every kind the system makes
    for e in select distinct on (k) k, id from (select case when description like 'Auction sale%' then 'auction' when is_memo then 'memo' else entry_type::text end k, id
                                               from cash_flow_entries where related_loan_id is not null and archived_at is null) z order by k, id loop
      n := n + 1;
      begin perform admin_edit_cash_entry(e.id, 1, 'TEST', 'TEST direct call'); s := s || e.k || ' corrected; '; exception when others then null; end;
      begin perform archive_record('cash_flow_entries', e.id, 'TEST direct call'); s := s || e.k || ' archived; '; exception when others then null; end;
    end loop;
    execute 'reset role';
    select sum(amount) into c1 from cash_flow_entries where related_loan_id is not null and archived_at is null;
    outcome := case when s = '' and n >= 4 and c0 = c1 then 'PASS (' || n || ' kinds of system entry tried)' else 'FAIL ' || s || ' kinds=' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0057() from public, anon, authenticated;

-- applied only if these pass (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0057' t, * from public.ctm_selftest_0057() union all select '0056' t, * from public.ctm_selftest_0056() union all select '0055' t, * from public.ctm_selftest_0055()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0057 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
