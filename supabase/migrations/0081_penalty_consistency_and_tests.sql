-- 0081 (Nov 15, 2026, Matt + Claude): review of the 2% liquidated damages (0073). The rule itself was checked and is right
-- (2% of the unpaid principal for each 30 days, or part of 30 days, after the grace days; the app and the database
-- agree on 216 test loans). One gap found: three database checks decided "does this loan still owe money?" from the
-- principal and the interest only, so a loan that owed ONLY liquidated damages was treated as fully paid by:
--   - the nightly default check (ctm_default_detection_core),
--   - the reminder list (reminder_queue) and
--   - the Log contact check (log_reminder).
-- The same question is answered everywhere else (record_payment, redeem_loan, the Loans "Ready to release" tab,
-- STILL_OWES_FILTER) with the damages included. Now these three agree: owes money = principal, interest or damages above 0.
-- Today no loan is in that state (0 loans owe only damages), so nothing changes in the data. Self-test: ctm_selftest_0081().

create or replace function public.ctm_default_detection_core()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  perform set_config('ctm.system', 'on', true);
  update public.loans set status = 'defaulted', defaulted_at = now()
  where status in ('active', 'extended', 'reinstated') and archived_at is null
    and (principal_balance > 0 or interest_owed > 0 or damages_owed > 0)   -- 0081: liquidated damages count as money owed
    and public.ctm_today() > maturity_date + grace_period_days;
  get diagnostics n = row_count;
  return n;
end $function$;

create or replace function public.reminder_queue(p_lead_days integer default 3)
returns table(id uuid, customer_id uuid, maturity_date date, logs jsonb)
language sql stable set search_path to 'public' as $function$
  select l.id, l.customer_id, l.maturity_date,
         coalesce((select jsonb_agg(jsonb_build_object('loan_id', r.loan_id, 'sent_at', r.sent_at, 'created_by', r.created_by,
                                                       'contact_method', r.contact_method, 'outcome', r.outcome, 'notes', r.notes)
                                    order by r.sent_at desc) -- newest first
                   from public.reminder_log r where r.loan_id = l.id and r.archived_at is null), '[]'::jsonb)
  from public.loans l
  where l.status in ('active', 'extended', 'reinstated') and l.archived_at is null
    and l.maturity_date between public.ctm_today() and public.ctm_today() + least(greatest(p_lead_days, 0), 30)
    and (l.principal_balance > 0 or l.interest_owed > 0 or l.damages_owed > 0) -- 0081: fully paid loans waiting for release are left out
  order by l.maturity_date, l.id
$function$;

do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.log_reminder'::regproc);
  if position('l.principal_balance <= 0 and l.interest_owed <= 0 then' in d) > 0 then
    execute replace(d, 'l.principal_balance <= 0 and l.interest_owed <= 0 then', 'l.principal_balance <= 0 and l.interest_owed <= 0 and l.damages_owed <= 0 then');
  elsif position('l.damages_owed <= 0 then' in d) = 0 then
    raise exception '0081: the log_reminder check was not found';
  end if;
end $patch$;

-- self-test: every test rolls back
create or replace function public.ctm_selftest_0081() returns table(test text, outcome text) language plpgsql as $f$
declare
  a uuid; b uuid; msg text; n int; sa text; sb text; bad int;
begin
  test := '2% rule at the day boundaries: 0 days after the grace days = 0; 1, 29, 30 days = 1 month; 31 = 2; 61 = 3; 91 = 4 (₱200 each on ₱10,000)';
  begin
    select count(*) into bad from unnest(array[0, 1, 29, 30, 31, 59, 60, 61, 90, 91]) d
    where ctm_pending_damages(jsonb_populate_record(null::public.loans, jsonb_build_object('status', 'defaulted', 'maturity_date', ctm_today() - (7 + d),
          'grace_period_days', 7, 'principal_balance', 10000, 'liquidated_damages_percent', 2))) <> ceil(d / 30.0) * 200;
    raise exception 'R:%', bad;
  exception when others then outcome := case when sqlerrm = 'R:0' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  return next;

  test := 'no damages for a paid-off principal, a closed loan or a 0% loan';
  begin
    select count(*) into bad from (values ('defaulted', 0, 2), ('redeemed', 10000, 2), ('forfeited', 10000, 2), ('defaulted', 10000, 0)) v(st, pb, pct)
    where ctm_pending_damages(jsonb_populate_record(null::public.loans, jsonb_build_object('status', v.st, 'maturity_date', ctm_today() - 100,
          'grace_period_days', 7, 'principal_balance', v.pb, 'liquidated_damages_percent', v.pct))) <> 0;
    raise exception 'R:%', bad;
  exception when others then outcome := case when sqlerrm = 'R:0' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  return next;

  test := 'the nightly default check defaults a loan that owes only liquidated damages, and not one that owes nothing';
  begin
    select id into a from loans where status = 'active' and archived_at is null order by created_at limit 1;
    select id into b from loans where status = 'active' and archived_at is null and id <> a order by created_at limit 1;
    perform set_config('ctm.system', 'on', true);
    update loans set maturity_date = ctm_today() - 40, interest_accrued_through = ctm_today() - 40, principal_balance = 0, interest_owed = 0, damages_owed = 50 where id = a;
    update loans set maturity_date = ctm_today() - 40, interest_accrued_through = ctm_today() - 40, principal_balance = 0, interest_owed = 0, damages_owed = 0 where id = b;
    n := ctm_default_detection_core();
    select status::text into sa from loans where id = a;
    select status::text into sb from loans where id = b;
    raise exception 'R:% %', sa, sb;
  exception when others then outcome := case when sqlerrm = 'R:defaulted active' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  perform set_config('ctm.system', 'off', true); return next;

  test := 'the reminder list includes a loan due soon that owes only liquidated damages, and not a fully paid one';
  begin
    select id into a from loans where status = 'active' and archived_at is null order by created_at limit 1;
    select id into b from loans where status = 'active' and archived_at is null and id <> a order by created_at limit 1;
    perform set_config('ctm.system', 'on', true);
    update loans set maturity_date = ctm_today() + 2, interest_accrued_through = ctm_today() + 2, principal_balance = 0, interest_owed = 0, damages_owed = 50 where id = a;
    update loans set maturity_date = ctm_today() + 2, interest_accrued_through = ctm_today() + 2, principal_balance = 0, interest_owed = 0, damages_owed = 0 where id = b;
    select count(*) filter (where q.id = a), count(*) filter (where q.id = b) into n, bad from reminder_queue(3) q;
    raise exception 'R:% %', n, bad;
  exception when others then outcome := case when sqlerrm = 'R:1 0' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  perform set_config('ctm.system', 'off', true); return next;
end $f$;
revoke execute on function public.ctm_selftest_0081() from public, anon, authenticated;
