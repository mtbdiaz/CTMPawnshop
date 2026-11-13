-- 0069 (Nov 13, 2026, Wush): Outstanding loans report: sort, due-date range, "Owes money", whole-report totals.
-- No loan, payment, customer or any other record is changed by this migration. The rules for owed now, paid,
-- overdue, due soon, grace and the Admin-only check are exactly the same as in 0066.
--
-- Why a database change is needed (the page can't do this on its own): the page receives only the 10 loans it
-- shows, so sorting, a due-date range, or an "owes money" list done in the page would only rearrange or cut
-- those 10, and the totals and page numbers would be wrong. They have to be done where all loans are.
--
-- report_loans now also takes:
--   p_due_from / p_due_to  due date range (Manila dates, both days included); a start after the end is refused;
--   p_sort                 'due' (earliest first, the default and the old order), 'due_desc', 'owed_desc', 'owed',
--                          'customer' (A to Z), 'ticket'; the loan ID breaks ties so pages never overlap;
--   p_filter 'owing'       Outstanding only: open loans that still owe (Overdue + Due soon + Not due yet).
-- and returns:
--   all_totals             principal, principal left, interest now and owed now of ALL loans in the report
--                          (before search and filters), for the summary above the table;
--   customer_id            in each row, so the customer's name can link to their page.
-- The old 5-argument call still works (the new arguments are optional), so the Overdue report and the deployed
-- site keep working unchanged.
-- Self-test: select * from public.ctm_selftest_0069();   (every test rolls back)

drop function if exists public.report_loans(text, text, text, integer, integer);

create or replace function public.report_loans(p_report text, p_q text default null, p_filter text default null,
  p_page integer default 1, p_size integer default 50,
  p_due_from date default null, p_due_to date default null, p_sort text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.ctm_today();
  v_size int := least(greatest(coalesce(p_size, 50), 5), 1000);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_sort text := coalesce(p_sort, 'due');
  v_like text; v_cno int; res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only (the reports are Admin only)
  if p_report is null or p_report not in ('outstanding', 'overdue') then raise exception 'Unknown report.'; end if;
  if p_filter is not null and not (
       (p_report = 'outstanding' and p_filter in ('overdue', 'due_soon', 'not_due', 'paid', 'owing'))
    or (p_report = 'overdue' and p_filter in ('in_grace', 'past_grace', 'defaulted'))) then raise exception 'Unknown filter.'; end if;
  if v_sort not in ('due', 'due_desc', 'owed_desc', 'owed', 'customer', 'ticket') then raise exception 'Unknown sort.'; end if;
  if p_due_from is not null and p_due_to is not null and p_due_from > p_due_to then
    raise exception 'Pick a start date on or before the end date.';
  end if;
  if v_q is not null then
    v_q := left(v_q, 80);
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; -- typed % or _ are plain letters
    if v_q ~* '^c[\s-]?\d{1,9}$' then v_cno := regexp_replace(v_q, '\D', '', 'g')::int; end if; -- "C-0012" = customer 12
  end if;
  with classified as (
    select l.id, l.ticket_number, l.principal_amount, l.principal_balance, l.maturity_date, l.status::text as status,
           coalesce(l.grace_period_days, 0) as grace_period_days, o.owed,
           round(o.owed - l.principal_balance, 2) as interest_now,
           l.customer_id, c.full_name as customer_name, c.customer_no, c.contact_number,
           a.category::text as category, a.category_other, a.karat,
           v_today - l.maturity_date as days_late,
           l.maturity_date + coalesce(l.grace_period_days, 0) as grace_end,
           case when l.status = 'defaulted' then null
                when o.owed < 0.01 then 'paid'
                when l.maturity_date < v_today then 'overdue'
                when l.maturity_date - v_today between 0 and 7 then 'due_soon'
                else 'not_due' end as situation,
           case when l.status = 'defaulted' then case when o.owed >= 0.01 then 'defaulted' end
                when o.owed < 0.01 or l.maturity_date >= v_today then null
                when v_today > l.maturity_date + coalesce(l.grace_period_days, 0) then 'past_grace'
                else 'in_grace' end as stage
    from public.loans l
    cross join lateral (select public.owed_now(l) as owed) o
    left join public.customers c on c.id = l.customer_id
    left join public.appraisal_items a on a.id = l.appraisal_item_id
    where l.archived_at is null and l.status in ('active', 'extended', 'reinstated', 'defaulted')
  ), scoped as (
    select * from classified k where case when p_report = 'outstanding' then k.status <> 'defaulted' else k.stage is not null end
  ), matching as (
    select * from scoped s
    where (p_filter is null
           or (p_report = 'outstanding' and p_filter = 'owing' and s.situation in ('overdue', 'due_soon', 'not_due'))
           or (p_report = 'outstanding' and s.situation = p_filter) or (p_report = 'overdue' and s.stage = p_filter))
      and (v_q is null or s.customer_name ilike v_like or s.ticket_number ilike v_like or s.customer_no = v_cno)
      and (p_due_from is null or s.maturity_date >= p_due_from)
      and (p_due_to is null or s.maturity_date <= p_due_to)
  ), numbered as (
    select m.*, row_number() over (order by
        case when v_sort = 'due' then m.maturity_date end asc,
        case when v_sort = 'due_desc' then m.maturity_date end desc,
        case when v_sort = 'owed_desc' then m.owed end desc,
        case when v_sort = 'owed' then m.owed end asc,
        case when v_sort = 'customer' then lower(m.customer_name) end asc,
        case when v_sort = 'ticket' then m.ticket_number end asc,
        m.maturity_date, m.id) as rn
    from matching m
  ), pg as (
    select greatest(1, least(v_page, ceil((select count(*) from matching)::numeric / v_size)::int)) as p
  )
  select jsonb_build_object(
    'today', v_today,
    'counts', (select jsonb_object_agg(g.k, g.n) from (
        select case when p_report = 'outstanding' then s.situation else s.stage end as k, count(*) as n from scoped s group by 1) g),
    'sums', (select jsonb_object_agg(g.k, g.v) from (
        select case when p_report = 'outstanding' then s.situation else s.stage end as k, coalesce(sum(s.owed), 0) as v from scoped s group by 1) g),
    'all_count', (select count(*) from scoped),
    'all_owed', (select coalesce(sum(owed), 0) from scoped),
    'all_totals', (select jsonb_build_object('principal', coalesce(sum(principal_amount), 0), 'balance', coalesce(sum(principal_balance), 0),
                 'interest', coalesce(sum(interest_now), 0), 'owed', coalesce(sum(owed), 0)) from scoped),
    'paid_past_due', (select count(*) from classified k where k.status <> 'defaulted' and k.situation = 'paid' and k.maturity_date < v_today),
    'total', (select count(*) from matching),
    'totals', (select jsonb_build_object('principal', coalesce(sum(principal_amount), 0), 'balance', coalesce(sum(principal_balance), 0),
                 'interest', coalesce(sum(interest_now), 0), 'owed', coalesce(sum(owed), 0)) from matching),
    'page', (select p from pg), 'size', v_size,
    'rows', (select coalesce(jsonb_agg(to_jsonb(n) - 'rn' order by n.rn), '[]'::jsonb) from numbered n, pg
              where n.rn > (pg.p - 1) * v_size and n.rn <= pg.p * v_size)
  ) into res;
  return res;
end $$;
revoke all on function public.report_loans(text, text, text, integer, integer, date, date, text) from public, anon;
grant execute on function public.report_loans(text, text, text, integer, integer, date, date, text) to authenticated;

create or replace function public.ctm_selftest_0069() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  admin_id uuid; s text; r jsonb; r2 jsonb; n int; k int; v_today date := ctm_today(); d1 date; d2 date; v_loans int;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select count(*) into v_loans from loans;
  d1 := v_today - 10; d2 := v_today + 10;

  test := 'Owes money and totals: Owes money = Overdue + Due soon + Not due yet; with Ready to release it makes every open loan; the whole-report totals equal the unfiltered totals and the loans counted another way';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_loans('outstanding', p_size => 10);
    r2 := report_loans('outstanding', p_filter => 'owing', p_size => 10);
    s := ((r2->>'total')::int = coalesce((r->'counts'->>'overdue')::int, 0) + coalesce((r->'counts'->>'due_soon')::int, 0) + coalesce((r->'counts'->>'not_due')::int, 0))::text
      || ',' || ((r2->>'total')::int + coalesce((r->'counts'->>'paid')::int, 0) = (r->>'all_count')::int)::text
      || ',' || (r->'all_totals' = r->'totals')::text
      || ',' || ((r2->'all_totals') = (r->'all_totals'))::text
      || ',' || ((r->'all_totals'->>'owed')::numeric = (r->>'all_owed')::numeric)::text;
    execute 'reset role';
    s := s || ',' || ((r->'all_totals'->>'balance')::numeric = (select coalesce(sum(principal_balance), 0) from loans where archived_at is null and status in ('active', 'extended', 'reinstated')))::text
      || ',' || ((r->'all_totals'->>'principal')::numeric = (select coalesce(sum(principal_amount), 0) from loans where archived_at is null and status in ('active', 'extended', 'reinstated')))::text;
    outcome := case when s not like '%false%' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Due date range: the count equals the open loans due in the range (both days included); a start after the end is refused; the old 5-argument call gives the same answer as before';
  begin
    select count(*) into n from loans where archived_at is null and status in ('active', 'extended', 'reinstated') and maturity_date between d1 and d2;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_loans('outstanding', p_due_from => d1, p_due_to => d2, p_size => 1000);
    s := ((r->>'total')::int = n)::text
      || ',' || (not exists (select 1 from jsonb_array_elements(r->'rows') x where (x->>'maturity_date')::date not between d1 and d2))::text;
    begin perform report_loans('outstanding', p_due_from => d2, p_due_to => d1); s := s || ',backwards accepted'; exception when others then s := s || ',backwards refused'; end;
    r := report_loans('outstanding', null, 'overdue', 1, 50);
    r2 := report_loans('overdue', null, null, 1, 50);
    s := s || ',' || ((r->>'total')::int = (r->'counts'->>'overdue')::int and (r2->>'total')::int = (r2->>'all_count')::int)::text;
    execute 'reset role';
    outcome := case when s = 'true,true,backwards refused,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Sorting: every sort keeps the same loans and totals; highest owed first goes down, earliest due first goes up, customers A to Z; pages of 10 never overlap; an unknown sort is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_loans('outstanding', p_sort => 'owed_desc', p_size => 1000);
    r2 := report_loans('outstanding', p_sort => 'due', p_size => 1000);
    s := ((r->>'total') = (r2->>'total') and r->'totals' = r2->'totals')::text
      || ',' || (select bool_and(a.o >= b.o) from (select (x->>'owed')::numeric o, i from jsonb_array_elements(r->'rows') with ordinality t(x, i)) a
                 join (select (x->>'owed')::numeric o, i from jsonb_array_elements(r->'rows') with ordinality t(x, i)) b on b.i = a.i + 1)::text
      || ',' || (select bool_and(a.o <= b.o) from (select (x->>'maturity_date')::date o, i from jsonb_array_elements(r2->'rows') with ordinality t(x, i)) a
                 join (select (x->>'maturity_date')::date o, i from jsonb_array_elements(r2->'rows') with ordinality t(x, i)) b on b.i = a.i + 1)::text;
    r := report_loans('outstanding', p_sort => 'customer', p_size => 1000);
    s := s || ',' || (select bool_and(lower(coalesce(a.o, '')) <= lower(coalesce(b.o, ''))) from (select x->>'customer_name' o, i from jsonb_array_elements(r->'rows') with ordinality t(x, i)) a
                 join (select x->>'customer_name' o, i from jsonb_array_elements(r->'rows') with ordinality t(x, i)) b on b.i = a.i + 1)::text;
    r := report_loans('outstanding', p_sort => 'owed_desc', p_page => 1, p_size => 10);
    r2 := report_loans('outstanding', p_sort => 'owed_desc', p_page => 2, p_size => 10);
    s := s || ',' || (not exists (select 1 from jsonb_array_elements(r->'rows') a, jsonb_array_elements(r2->'rows') b where a->>'id' = b->>'id'))::text
      || ',' || ((r->'rows'->0->>'customer_id') is not null)::text;
    begin perform report_loans('outstanding', p_sort => 'random'); s := s || ',bad sort accepted'; exception when others then s := s || ',bad sort refused'; end;
    execute 'reset role';
    outcome := case when s = 'true,true,true,true,true,true,bad sort refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Still safe: Operator, Cashier and Appraiser are refused; signed-out visitors can''t call it; no loan changes';
  begin
    execute 'set local role authenticated';
    s := '';
    foreach n in array array[1, 2, 3] loop
      perform set_config('request.jwt.claims', json_build_object('sub', (array[op_id, cash_id, appr_id])[n], 'role', 'authenticated')::text, true);
      begin perform report_loans('outstanding', p_sort => 'owed_desc'); s := s || 'x/'; exception when others then s := s || case when sqlerrm like '%not allowed%' then 'refused/' else '?/' end; end;
    end loop;
    execute 'reset role';
    s := s || 'anon ' || has_function_privilege('anon', 'public.report_loans(text, text, text, integer, integer, date, date, text)', 'execute')::text
      || '/' || ((select count(*) from loans) = v_loans)::text;
    outcome := case when s = 'refused/refused/refused/anon false/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0069() from public, anon, authenticated;

-- applied only if these pass, and the earlier Reports, audit, ledger and Suspicious activity tests still pass
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0069' t, * from public.ctm_selftest_0069() union all select '0068' t, * from public.ctm_selftest_0068()
    union all select '0067' t, * from public.ctm_selftest_0067() union all select '0066' t, * from public.ctm_selftest_0066()
    union all select '0065' t, * from public.ctm_selftest_0065() union all select '0064' t, * from public.ctm_selftest_0064()
    union all select '0063' t, * from public.ctm_selftest_0063() union all select '0062' t, * from public.ctm_selftest_0062()
    union all select '0058' t, * from public.ctm_selftest_0058() union all select '0038' t, * from public.ctm_selftest_0038()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0069 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
