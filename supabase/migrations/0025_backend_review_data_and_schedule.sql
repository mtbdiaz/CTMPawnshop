-- Backend review: capitalize rule, data fixes, uniqueness and the daily default check.
do $$
declare f text;
begin
  -- #30 capitalize: new term starts where the charged interest ends (same as renew_loan)
  f := pg_get_functiondef('public.capitalize_loan(uuid)'::regprocedure);
  f := replace(f, 'v_new_maturity := case when l.maturity_date >= public.ctm_today() then l.maturity_date + 30 else public.ctm_today() + 30 end;',
                  'v_new_maturity := greatest(l.maturity_date, l.interest_accrued_through) + 30;');
  execute f;

  perform set_config('ctm.system', 'on', true);
  -- #1 data: a fully paid loan (PT-20260915073651-G9M0) had been defaulted by mistake; back to active
  update public.loans set status = 'active', defaulted_at = null
  where ticket_number = 'PT-20260915073651-G9M0' and status = 'defaulted' and principal_balance = 0 and interest_owed = 0;
  update public.inventory_items i set status = 'pawned' from public.loans l
  where l.inventory_item_id = i.id and l.ticket_number = 'PT-20260915073651-G9M0' and i.status = 'forfeited';
  -- #2 data: defaulted loans keep their item in the vault until an Admin forfeits them
  update public.inventory_items i set status = case when l.extension_count > 0 then 'extended'::public.inventory_status else 'pawned'::public.inventory_status end
  from public.loans l where l.inventory_item_id = i.id and l.status = 'defaulted' and i.status = 'forfeited';
  -- cleanup from the review: archive test customers with no open loans
  update public.customers c set archived_at = now(), archive_reason = 'Test record, archived during backend review cleanup'
  where c.archived_at is null and c.id::text not like 'dede0000-%' and c.full_name in ('TEST', 'TEST Duplicate 2', 'jhomyr trial', 'Helloo World', 'Ena')
    and not exists (select 1 from public.loans l where l.customer_id = c.id and l.status in ('active', 'extended', 'reinstated', 'defaulted'));
end $$;

-- #10 one active customer per ID (ignoring dashes, spaces and letter case); archived records don't count
create unique index if not exists customers_unique_id on public.customers (id_type, upper(regexp_replace(id_number, '[^A-Za-z0-9]', '', 'g'))) where archived_at is null;
-- #6 at most one open suspicious-activity flag per customer
create unique index if not exists suspicious_one_open_per_customer on public.suspicious_activity_flags (customer_id) where status = 'open';

-- #7 run default detection every day at 00:05 Manila time (16:05 UTC)
create extension if not exists pg_cron;
select cron.schedule('ctm-default-detection', '5 16 * * *', 'select public.run_default_detection_job()');
