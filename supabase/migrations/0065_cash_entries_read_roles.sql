-- 0065 (Nov 12, 2026, Wush): Cash ledger rows can be read only by the roles that use them.
-- No ledger entry or any other record is changed by this migration.
--
-- Found during the Reports review: the rule on cash_flow_entries was "any signed-in staff can read every entry".
-- An Appraiser, who has no Cash & ledger page, could read every cash entry straight from the database (checked in
-- the browser with the Appraiser's own login). The app reads cash entries only for:
--   - Operator and Cashier: the Dashboard's "Net cash today" card (canSeeCash);
--   - Operator, Cashier and Admin: Cash & ledger (through cash_ledger_page, a database function that checks the role);
--   - Admin: the Financial summary report.
-- So the rule is now "Operator, Cashier or Admin". Nobody loses a screen they use. Database functions that write or
-- read the ledger (record_payment, create_pawn_loan, renew_loan, redeem_loan, cash_ledger_page, ...) don't depend on
-- this rule. Signed-out visitors (anon) lose the table grant (the rule already gave them nothing).
-- Self-test: select * from public.ctm_selftest_0065();   (every test rolls back)

drop policy if exists "cash_flow_entries: staff select" on public.cash_flow_entries;
create policy "cash_flow_entries: cash roles select" on public.cash_flow_entries for select to authenticated
  using (public.get_my_role() = any (array['operator', 'cashier', 'admin']::public.staff_role[]));
revoke all on public.cash_flow_entries from anon;

create or replace function public.ctm_selftest_0065() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  admin_id uuid; total int; n int; s text; r jsonb;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;

  test := 'Reading cash entries: Admin, Operator and Cashier see every entry; an Appraiser sees none; a signed-out visitor is refused';
  begin
    select count(*) into total from cash_flow_entries;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := 'admin ' || ((select count(*) from cash_flow_entries) = total)::text;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    s := s || '/op ' || ((select count(*) from cash_flow_entries) = total)::text;
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    s := s || '/cash ' || ((select count(*) from cash_flow_entries) = total)::text;
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    s := s || '/appr ' || (select count(*) from cash_flow_entries);
    execute 'reset role';
    execute 'set local role anon';
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    begin select count(*) into n from cash_flow_entries; s := s || '/anon ' || n; exception when insufficient_privilege then s := s || '/anon refused'; end;
    execute 'reset role';
    outcome := case when s = 'admin true/op true/cash true/appr 0/anon refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Cash & ledger still works for a Cashier and an Admin, and its balance still equals the sum of the entries';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page(p_page => 1, p_size => 5);
    s := 'cashier ' || ((r->>'total')::int > 0)::text;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page(p_page => 1, p_size => 5);
    s := s || '/admin ' || (((r->'summary'->>'balance')::numeric) = (select coalesce(sum(case when is_memo then 0 when direction = 'in' then amount else -amount end), 0) from cash_flow_entries where archived_at is null))::text;
    execute 'reset role';
    outcome := case when s = 'cashier true/admin true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0065() from public, anon, authenticated;

-- applied only if these pass, and the earlier ledger and New Loan tests still pass
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0065' t, * from public.ctm_selftest_0065() union all select '0038' t, * from public.ctm_selftest_0038()
    union all select '0057' t, * from public.ctm_selftest_0057() union all select '0058' t, * from public.ctm_selftest_0058()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0065 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
