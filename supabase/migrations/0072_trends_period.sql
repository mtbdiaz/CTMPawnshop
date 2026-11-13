-- 0072 (Nov 14, 2026, Wush): Trends & analytics by period (PB-39 acceptance criterion 2: "Given a date range filter is
-- applied, then the visualizations update accordingly"). Before this, the report could only show all loans.
-- No loan, payment, ledger entry or any other record is changed by this migration. report_loan_analytics() (0066)
-- stays exactly as it is, so the site that is live now keeps working until the new page is deployed.
--
-- report_loan_trends(p_from, p_to) (Admin only, read only). The period is whole calendar months by loan date
-- (the date the loan was made): p_from and p_to are any day in the first and last month (null = from the month of
-- the first loan / up to this month). Archived loans are left out, the same as every report.
-- Returns:
--   today, current_month, first_month (month of the first loan, 'YYYY-MM'), from_month, to_month
--   total, principal_sum, by_status   loans made in the period (the same counts report_loan_analytics gives for
--                                     all loans; the rates are worked out from these on the page, PB-39 rules)
--   months   every month from 11 months before to_month (or from from_month if that is earlier) up to to_month, months
--            with no loans included (count 0, ₱0), oldest first; in_range = inside the chosen period. At most 36
--            months are sent (the newest); months_capped says when older ones were left out of the chart.
-- Self-test: select * from public.ctm_selftest_0072();   (every test rolls back)

create or replace function public.report_loan_trends(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.ctm_today();
  v_cur date := date_trunc('month', public.ctm_today())::date;
  v_first date;
  v_from date; v_to date; v_win date; v_capped boolean := false; res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only (the reports are Admin only)
  select coalesce(date_trunc('month', min(loan_date))::date, v_cur) into v_first from public.loans where archived_at is null;
  v_from := coalesce(date_trunc('month', p_from)::date, least(v_first, v_cur));
  v_to := coalesce(date_trunc('month', p_to)::date, v_cur);
  if v_from > v_to then raise exception 'Pick a start month on or before the end month.'; end if;
  if v_to > v_cur then raise exception 'The end month is after this month. Pick this month or an earlier one.'; end if;
  -- the chart: at least the 12 months up to the end month, and every month of the period; at most the newest 36
  v_win := least(v_from, (v_to - interval '11 months')::date);
  if v_win < (v_to - interval '35 months')::date then v_win := (v_to - interval '35 months')::date; v_capped := true; end if;

  with l as (
    select principal_amount, status::text as status, date_trunc('month', loan_date)::date as m
    from public.loans
    where archived_at is null and loan_date >= v_win and loan_date < (v_to + interval '1 month')::date
  ), p as (
    -- the loans made in the period (read on their own: the period can start before the chart's first month)
    select principal_amount, status::text as status from public.loans
    where archived_at is null and loan_date >= v_from and loan_date < (v_to + interval '1 month')::date
  ), months as (
    select g::date as first_day from generate_series(v_win, v_to, interval '1 month') g
  )
  select jsonb_build_object(
    'today', v_today,
    'current_month', to_char(v_cur, 'YYYY-MM'),
    'first_month', to_char(v_first, 'YYYY-MM'),
    'from_month', to_char(v_from, 'YYYY-MM'),
    'to_month', to_char(v_to, 'YYYY-MM'),
    'total', (select count(*) from p),
    'principal_sum', (select coalesce(sum(principal_amount), 0) from p),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from p group by 1) z),
    'months', (select jsonb_agg(jsonb_build_object(
                 'month', to_char(mo.first_day, 'YYYY-MM'),
                 'count', (select count(*) from l where l.m = mo.first_day),
                 'totalPrincipal', (select coalesce(sum(principal_amount), 0) from l where l.m = mo.first_day),
                 'in_range', mo.first_day >= v_from) order by mo.first_day)
               from months mo),
    'months_capped', v_capped
  ) into res;
  return res;
end $$;
revoke all on function public.report_loan_trends(date, date) from public, anon;
grant execute on function public.report_loan_trends(date, date) to authenticated;

create or replace function public.ctm_selftest_0072() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  admin_id uuid; s text; r jsonb; a jsonb; n int; v_loans int; v_audit int; v_ledger int; v_cur date; v_aug int; v_aug_p numeric;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select count(*) into v_loans from loans; select count(*) into v_audit from audit_log; select count(*) into v_ledger from cash_flow_entries;
  v_cur := date_trunc('month', ctm_today())::date;

  test := 'All loans (no period): the same totals, status counts and last-12-month figures as report_loan_analytics (0066); archived loans left out; empty months included';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_loan_trends(); a := report_loan_analytics();
    execute 'reset role';
    select count(*) into n from jsonb_array_elements(a->'months') am
      where not exists (select 1 from jsonb_array_elements(r->'months') rm where rm->>'month' = am->>'month'
                          and (rm->>'count')::int = (am->>'count')::int and (rm->>'totalPrincipal')::numeric = (am->>'totalPrincipal')::numeric);
    s := ((r->>'total')::int = (a->>'total')::int and (r->>'principal_sum')::numeric = (a->>'principal_sum')::numeric and r->'by_status' = a->'by_status')::text
      || ',' || ((r->>'total')::int = (select count(*) from loans where archived_at is null))::text
      || ',' || (n = 0)::text
      || ',' || (jsonb_array_length(r->'months') >= 12 and (r->'months'->-1->>'month') = to_char(v_cur, 'YYYY-MM'))::text;
    outcome := case when s = 'true,true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'A period (one month, two months ago): only loans made in that month are counted, the status counts add up to the total, the chart still has 12 months with the rest outside the period';
  begin
    select count(*), coalesce(sum(principal_amount), 0) into v_aug, v_aug_p from loans
      where archived_at is null and loan_date >= (v_cur - interval '2 months')::date and loan_date < (v_cur - interval '1 month')::date;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_loan_trends((v_cur - interval '2 months')::date + 14, (v_cur - interval '2 months')::date + 3); -- any day in the month works
    execute 'reset role';
    s := ((r->>'total')::int = v_aug and (r->>'principal_sum')::numeric = v_aug_p)::text
      || ',' || ((select coalesce(sum(value::int), 0) from jsonb_each_text(r->'by_status')) = v_aug)::text
      || ',' || ((select count(*) from jsonb_array_elements(r->'months') m where (m->>'in_range')::boolean) = 1
                 and (select sum((m->>'count')::int) from jsonb_array_elements(r->'months') m where (m->>'in_range')::boolean) = v_aug
                 and jsonb_array_length(r->'months') = 12)::text;
    outcome := case when s = 'true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Refused: start after end, end after this month, Operator / Cashier / Appraiser, signed-out visitors; nothing changes (loans, ledger, audit log)';
  begin
    execute 'set local role authenticated';
    s := '';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin perform report_loan_trends(v_cur, (v_cur - interval '1 month')::date); s := s || 'x/'; exception when others then s := s || case when sqlerrm like 'Pick a start month%' then 'order/' else '?/' end; end;
    begin perform report_loan_trends(null, (v_cur + interval '1 month')::date); s := s || 'x/'; exception when others then s := s || case when sqlerrm like 'The end month is after%' then 'future/' else '?/' end; end;
    foreach n in array array[1, 2, 3] loop
      perform set_config('request.jwt.claims', json_build_object('sub', (array[op_id, cash_id, appr_id])[n], 'role', 'authenticated')::text, true);
      begin perform report_loan_trends(); s := s || 'x/'; exception when others then s := s || case when sqlerrm like '%not allowed%' then 'refused/' else '?/' end; end;
    end loop;
    execute 'reset role';
    s := s || 'anon ' || has_function_privilege('anon', 'public.report_loan_trends(date, date)', 'execute')::text
      || '/' || ((select count(*) from loans) = v_loans and (select count(*) from audit_log) = v_audit and (select count(*) from cash_flow_entries) = v_ledger)::text;
    outcome := case when s = 'order/future/refused/refused/refused/anon false/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0072() from public, anon, authenticated;

-- applied only if these pass, and the earlier Reports, audit, ledger and Suspicious activity tests still pass
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0072' t, * from public.ctm_selftest_0072() union all select '0071' t, * from public.ctm_selftest_0071()
    union all select '0070' t, * from public.ctm_selftest_0070() union all select '0069' t, * from public.ctm_selftest_0069()
    union all select '0068' t, * from public.ctm_selftest_0068() union all select '0067' t, * from public.ctm_selftest_0067()
    union all select '0066' t, * from public.ctm_selftest_0066() union all select '0065' t, * from public.ctm_selftest_0065()
    union all select '0064' t, * from public.ctm_selftest_0064() union all select '0063' t, * from public.ctm_selftest_0063()
    union all select '0062' t, * from public.ctm_selftest_0062() union all select '0058' t, * from public.ctm_selftest_0058()
    union all select '0038' t, * from public.ctm_selftest_0038()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0072 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
