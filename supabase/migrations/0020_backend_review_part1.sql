-- Backend review (Wush, Nov 5): default detection fixes.
-- #1  never default a loan that is already fully paid
-- #2  keep the vault item pawned/extended when a loan defaults; only forfeit_loan marks it forfeited
-- #32 return how many LOANS were defaulted, not how many vault items changed
-- #7  a role-free variant for the daily scheduler (owner-only)

create or replace function public.ctm_default_detection_core() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('ctm.system', 'on', true);
  update public.loans set status = 'defaulted', defaulted_at = now()
  where status in ('active', 'extended') and archived_at is null
    and (principal_balance > 0 or interest_owed > 0)
    and public.ctm_today() > maturity_date + grace_period_days;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.run_default_detection() returns integer
language plpgsql security definer set search_path = public as $$
begin
  perform public.ctm_assert_role(array['operator', 'cashier', 'appraiser']::public.staff_role[]);
  return public.ctm_default_detection_core();
end $$;

create or replace function public.run_default_detection_job() returns integer
language sql security definer set search_path = public as $$ select public.ctm_default_detection_core() $$;

revoke all on function public.ctm_default_detection_core() from public, anon, authenticated;
revoke all on function public.run_default_detection_job() from public, anon, authenticated;
grant execute on function public.run_default_detection() to authenticated;
