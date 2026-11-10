-- 0036 (Nov 10, 2026, Wush): Batch 5 of Matt's list.
-- #23: loans.owed_now          = the amount owed today, worked out by the database, so the Loans list can sort by it.
-- #20: customers.history_score = the customer score, worked out by the database, so the Customers list can sort by it.
-- #16: pg_trgm                 = faster "contains" searches on customers, and a search that still finds a name typed
--                                with a typo ("Bautsita" finds "Bautista").
-- Both numbers are worked out fresh every time they are read (they are NOT saved columns). The score and the amount
-- owed change with the date (a loan becomes overdue, interest is added every 30 days), so a saved copy would go stale.
-- The formulas are the same as the app's: lib/loans/status.ts (owedNow) and lib/customers/score.ts.
-- Existing data: nothing changes. No table gets a new column.
-- Self-test: select * from public.ctm_selftest_0036();   (every test rolls back)

-- 1. #23 amount owed today for one loan. PostgREST treats a function that takes a table row as an extra column,
--    so the app can write .order("owed_now") on loans.
--    Same rules as the app: forfeited = nothing to collect (null), redeemed = 0, otherwise principal left + interest,
--    plus one full term of interest for every 30 days (or part of 30 days) since interest was last added
--    (the same rule as ctm_accrue_interest, without changing the loan).
create function public.owed_now(l public.loans) returns numeric
language sql stable set search_path = public as $$
  select case
    when l.status = 'forfeited' then null::numeric
    when l.status = 'redeemed' then 0::numeric
    else round(
      l.principal_balance + l.interest_owed
      + case
          when l.status in ('active', 'extended', 'reinstated', 'defaulted') and l.principal_balance > 0
               and public.ctm_today() > coalesce(l.interest_accrued_through, l.maturity_date)
          then ceil((public.ctm_today() - coalesce(l.interest_accrued_through, l.maturity_date))::numeric / 30)
               * round(l.principal_balance * l.interest_rate_percent / 100, 2)
          else 0
        end, 2)
  end
$$;
revoke execute on function public.owed_now(public.loans) from public, anon;
grant execute on function public.owed_now(public.loans) to authenticated, service_role;

-- 2. #20 the customer score (0 to 100, or null when the customer has no loans), from the score_weights table.
--    Same formula as lib/customers/score.ts. Archived loans count too, on purpose (they are still history).
create function public.ctm_customer_score(p_customer uuid) returns integer
language sql stable set search_path = public as $$
  with w as ( -- the weights as one row (the defaults are the seeded values, used only if a row is missing)
    select
      coalesce(max(value) filter (where key = 'base'), 60) as base,
      coalesce(max(value) filter (where key = 'redeemed_on_time'), 8) as redeemed_on_time,
      coalesce(max(value) filter (where key = 'renewal'), 3) as renewal,
      coalesce(max(value) filter (where key = 'renewal_cap'), 15) as renewal_cap,
      coalesce(max(value) filter (where key = 'delinquent'), -6) as delinquent,
      coalesce(max(value) filter (where key = 'reinstated'), -15) as reinstated,
      coalesce(max(value) filter (where key = 'defaulted'), -25) as defaulted,
      coalesce(max(value) filter (where key = 'currently_overdue'), -10) as currently_overdue,
      coalesce(max(value) filter (where key = 'old_outcome_months'), 24) as old_outcome_months,
      coalesce(max(value) filter (where key = 'old_outcome_factor'), 0.5) as old_outcome_factor
    from public.score_weights
  ),
  l as ( -- every loan of this customer, with the facts the score needs
    select
      lo.status, lo.extension_count, lo.late_payment_count, lo.reinstated_at,
      (lo.defaulted_at is not null or lo.status in ('defaulted', 'forfeited')) as is_defaulted,
      -- overdue now = still running, past the due date and still owes money (a paid loan waiting for release is not overdue)
      (lo.status in ('active', 'extended', 'reinstated') and lo.maturity_date < public.ctm_today() and public.owed_now(lo) >= 0.01) as is_overdue,
      -- the day the loan ended (redeemed or defaulted), or the day it started if it is still running.
      -- "at time zone 'UTC'" because the app reads these times in UTC and takes the date part
      coalesce((lo.redeemed_at at time zone 'UTC')::date, (lo.defaulted_at at time zone 'UTC')::date, lo.loan_date) as outcome
    from public.loans lo
    where lo.customer_id = p_customer
  ),
  f as ( -- old results count for less: after old_outcome_months full months, points are multiplied by old_outcome_factor
    select l.*,
      case when (extract(year from d.today) - extract(year from l.outcome)) * 12
                + (extract(month from d.today) - extract(month from l.outcome))
                - case when extract(day from d.today) < extract(day from l.outcome) then 1 else 0 end
                >= w.old_outcome_months
           then w.old_outcome_factor else 1 end as factor
    from l, w, (select public.ctm_today() as today) d
  )
  select case when count(*) = 0 then null
    else greatest(0, least(100, floor(
      max(w.base)
      + sum(
          case when f.status = 'redeemed' and f.late_payment_count = 0 and not f.is_defaulted then w.redeemed_on_time * f.factor else 0 end
          + case when f.late_payment_count > 0 then w.delinquent * f.factor else 0 end
          + case when f.reinstated_at is not null then w.reinstated * f.factor else 0 end
          + case when f.is_defaulted then w.defaulted * f.factor else 0 end
          + case when f.is_overdue then w.currently_overdue else 0 end)
      + least(sum(w.renewal * f.extension_count * f.factor), max(w.renewal_cap)) -- renewal points have a cap
      + 0.5)))::integer -- floor(x + 0.5) = round half up, the same as JavaScript's Math.round
    end
  from f, w
$$;
revoke execute on function public.ctm_customer_score(uuid) from public, anon;
grant execute on function public.ctm_customer_score(uuid) to authenticated, service_role;

-- the same score as an extra column on customers, so the list can write .order("history_score").
-- Only for the server (service role): a staff login can't pass a whole customers row, because it can't read
-- id_number since 0027. Staff logins can still call ctm_customer_score(id).
create function public.history_score(c public.customers) returns integer
language sql stable set search_path = public as $$
  select public.ctm_customer_score(c.id)
$$;
revoke execute on function public.history_score(public.customers) from public, anon, authenticated;
grant execute on function public.history_score(public.customers) to service_role;

-- 3. #16 pg_trgm: indexes that make "contains" searches (ilike '%text%') fast on the three searched columns
create extension if not exists pg_trgm with schema extensions;
create index customers_full_name_trgm on public.customers using gin (full_name extensions.gin_trgm_ops);
create index customers_contact_number_trgm on public.customers using gin (contact_number extensions.gin_trgm_ops);
create index customers_id_number_trgm on public.customers using gin (id_number extensions.gin_trgm_ops);

-- names that look like what was typed, best match first. The app uses it only when the normal search finds nothing,
-- so a typo still finds the customer. It only reads id, full_name and archived_at (columns every staff login may read).
create function public.search_customers_fuzzy(p_q text, p_limit integer default 8)
returns table(id uuid, similarity real)
language sql stable set search_path = public, extensions as $$
  select c.id, word_similarity(lower(trim(p_q)), lower(c.full_name)) as similarity
  from public.customers c
  where c.archived_at is null
    and char_length(trim(coalesce(p_q, ''))) >= 3 -- too short to guess from
    and word_similarity(lower(trim(p_q)), lower(c.full_name)) >= 0.40 -- tested on our names: catches swapped or missing letters, and nonsense finds nobody
  order by similarity desc, c.full_name
  limit least(greatest(coalesce(p_limit, 8), 1), 50)
$$;
revoke execute on function public.search_customers_fuzzy(text, integer) from public, anon;
grant execute on function public.search_customers_fuzzy(text, integer) to authenticated, service_role;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0036() returns table(test text, outcome text)
language plpgsql set search_path = public, extensions as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  r record; lo public.loans; n int; m int; bad int; s text; nm text; typo text; c_id uuid;
begin
  test := '#23 owed_now gives the same amount the database charges when it adds the interest (up to 40 past-due loans)';
  begin
    n := 0; bad := 0;
    for r in select x.id, public.owed_now(x) as expected from loans x
             where x.status in ('active','extended','reinstated','defaulted') and x.principal_balance > 0
               and ctm_today() > coalesce(x.interest_accrued_through, x.maturity_date) limit 40 loop
      lo := ctm_accrue_interest(r.id); -- really adds the interest (rolled back below)
      n := n + 1;
      if lo.principal_balance + lo.interest_owed <> r.expected then bad := bad + 1; end if;
    end loop;
    outcome := case when n = 0 then 'SKIP (no past-due loans)' when bad = 0 then 'PASS (' || n || ' loans)' else 'FAIL ' || bad || ' of ' || n || ' differ' end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true); -- ctm_accrue_interest switched "system mode" on; the rollback keeps settings, so switch it off
  return next;

  test := '#23 forfeited = nothing to collect, redeemed = 0, a loan not yet due = principal left + interest';
  begin
    select count(*) into bad from loans x where
      (x.status = 'forfeited' and public.owed_now(x) is not null)
      or (x.status = 'redeemed' and public.owed_now(x) <> 0)
      or (x.status in ('active','extended','reinstated') and ctm_today() <= coalesce(x.interest_accrued_through, x.maturity_date)
          and public.owed_now(x) <> round(x.principal_balance + x.interest_owed, 2));
    outcome := case when bad = 0 then 'PASS' else 'FAIL ' || bad || ' loans differ' end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  return next;

  test := '#20 no loans = no score; every score is 0 to 100; customers with only clean recent redemptions get base + points each';
  begin
    select count(*) into bad from customers c where not exists (select 1 from loans x where x.customer_id = c.id) and ctm_customer_score(c.id) is not null;
    select bad + count(*) into bad from customers c where ctm_customer_score(c.id) not between 0 and 100;
    -- an independent check of the formula on the simplest case: only on-time redemptions in the last 2 years,
    -- no renewals, no late payments, never defaulted or reinstated -> 60 + 8 for each loan, at most 100
    select count(*), count(*) filter (where ctm_customer_score(q.customer_id) <> least(100, 60 + 8 * q.loans)) into n, m
    from (select x.customer_id, count(*)::int as loans from loans x group by x.customer_id
          having bool_and(x.status = 'redeemed' and x.late_payment_count = 0 and x.extension_count = 0 and x.defaulted_at is null
                          and x.reinstated_at is null and x.redeemed_at > now() - interval '23 months')) q;
    outcome := case when bad = 0 and m = 0 then 'PASS (' || n || ' simple customers checked by hand formula)' else 'FAIL bad=' || bad || ' simple mismatches=' || m end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  return next;

  test := '#20 a cashier can read a score and sort loans by owed_now; the history_score column is for the server only';
  begin
    select c.id into c_id from customers c join loans x on x.customer_id = c.id limit 1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform ctm_customer_score(c_id);
    perform x.id from loans x order by public.owed_now(x) desc nulls last limit 5;
    begin perform public.history_score(c) from customers c limit 1; s := 'allowed';
    exception when insufficient_privilege then s := 'refused'; end;
    execute 'reset role';
    outcome := case when s = 'refused' then 'PASS' else 'FAIL history_score was ' || s end;
  exception when others then execute 'reset role'; outcome := 'FAIL ' || sqlerrm; end;
  return next;

  test := '#16 a name typed with two letters swapped still finds the customer (cashier login)';
  begin
    -- take a real customer whose last name has 7+ letters and swap its 3rd and 4th letters
    select c.id, w.word into c_id, nm from customers c, lateral (select (regexp_split_to_array(c.full_name, '\s+'))[array_length(regexp_split_to_array(c.full_name, '\s+'), 1)] as word) w
      where c.archived_at is null and w.word ~ '^[A-Za-z]{7,}$' and substr(w.word, 3, 1) <> substr(w.word, 4, 1) order by c.customer_no limit 1;
    typo := substr(nm, 1, 2) || substr(nm, 4, 1) || substr(nm, 3, 1) || substr(nm, 5);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    select count(*) into n from search_customers_fuzzy(typo, 50) f where f.id = c_id;
    select count(*) into bad from search_customers_fuzzy('zzqqxxyy', 8);
    execute 'reset role';
    outcome := case when c_id is null then 'SKIP (no suitable name)' when n = 1 and bad = 0 then 'PASS (typo of a ' || char_length(nm) || '-letter name found; nonsense finds nobody)' else 'FAIL found=' || n || ' nonsense=' || bad end;
  exception when others then execute 'reset role'; outcome := 'FAIL ' || sqlerrm; end;
  return next;

  test := '#16 the three search indexes exist';
  select count(*) into n from pg_indexes where schemaname = 'public' and indexname in ('customers_full_name_trgm', 'customers_contact_number_trgm', 'customers_id_number_trgm');
  outcome := case when n = 3 then 'PASS' else 'FAIL ' || n || ' of 3' end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0036() from public, anon, authenticated;
