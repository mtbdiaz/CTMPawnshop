-- 0066 (Nov 12, 2026, Wush): Reports, totals worked out in the database, and the audit log read only through a
-- function that masks ID numbers.
-- No loan, item, customer, ledger entry, flag or audit entry is changed by this migration.
--
-- 1. Reports. The pages used to read their rows and add them up in the app. Trends read only the first 1,000 of
--    1,262 loans (the database's limit per request), and the first fix (reading 1,000 at a time) still moved every
--    row to the app server. Now five Admin-only functions count, total, group and cut the page in the database, and
--    only the rows of the page shown leave it:
--      report_loans('outstanding' | 'overdue', search, filter, page, size)
--      report_inventory_aging(custody, age group, page, size)
--      report_loan_analytics()
--      report_cash_breakdown(from, to)
--    They use the same rules as the operational pages:
--      - owed now = owed_now(loan) (the database's own rule, the one the loan page shows);
--      - Paid, ready to release = an open loan that owes less than 1 centavo; Overdue = an open loan past its due
--        date that still owes; Due soon = due today up to 7 days from now (the Loans page rules, lib/loans/status.ts);
--      - Overdue report: In grace until due date + grace days, then Past grace; Defaulted loans that still owe;
--      - days held = Manila calendar days from the day the item came in (Inventory page);
--      - cash: not archived, capitalized interest (is_memo) is never cash, Manila days from 00:00 on the first day to
--        00:00 after the last day (exactly as cash_ledger_page, which the Cash & ledger page uses).
--
-- 2. Audit log. Every saved customer row in the audit log has the customer's full ID number (468 entries), while the
--    database stops every staff login, Admins too, from reading customers.id_number. Masking on the page wasn't
--    enough: an Admin calling the database directly could still read the audit log rows in full. Now:
--      - audit_log_page(...) (Admin only) returns the entries with ID numbers masked to the last 4 ("•••• 0418");
--      - the direct read grant on audit_log is removed for every login (the Admin rule stays, but without the grant
--        nothing can be read directly). The stored audit log is not changed; nothing can write to it from a login.
--
-- The flag guard (0064) now asks the audit log through a small helper instead of reading it directly.
-- 3. Indexes on the dates the reports filter by (cash entries, audit log), so the reports stay quick as data grows.
--
-- Self-test: select * from public.ctm_selftest_0066();   (every test rolls back; test 6 adds 20,000 ledger rows and
-- 10,000 loans inside the test only, to time the reports on a bigger dataset)

-- ---------- 3. indexes ----------
create index if not exists cash_flow_entries_created_at_idx on public.cash_flow_entries (created_at);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc, id desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor, created_at desc);

-- ---------- 2. audit log: masked, read through one function ----------
create or replace function public.ctm_mask_audit(j jsonb) returns jsonb language sql immutable as $$
  select case
    when j is null or jsonb_typeof(j) <> 'object' or coalesce(j->>'id_number', '') = '' then j
    else jsonb_set(j, '{id_number}', to_jsonb('•••• ' || right(j->>'id_number', 4)))
  end
$$;

create or replace function public.audit_log_page(p_table text default null, p_action text default null, p_by text default null,
  p_from date default null, p_to date default null, p_find_kind text default null, p_find text default null,
  p_page integer default 1, p_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_size int := least(greatest(coalesce(p_size, 50), 5), 100);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_by uuid; res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only
  if p_action is not null and p_action not in ('INSERT', 'UPDATE', 'DELETE') then raise exception 'Unknown action.'; end if;
  if p_find_kind is not null and p_find_kind not in ('id', 'ticket', 'receipt', 'customer', 'appraisal') then raise exception 'Unknown search.'; end if;
  if p_by is not null and p_by <> 'system' then v_by := p_by::uuid; end if;
  with matching as (
    select a.* from public.audit_log a
    where (p_table is null or a.table_name = p_table)
      and (p_action is null or a.action = p_action)
      and (p_by is null or (p_by = 'system' and a.actor is null) or a.actor = v_by)
      and (p_from is null or a.created_at >= p_from::timestamp at time zone 'Asia/Manila')
      and (p_to is null or a.created_at < (p_to + 1)::timestamp at time zone 'Asia/Manila')
      and (p_find is null or case p_find_kind
            when 'id' then a.record_id = p_find
            when 'ticket' then a.changed_data->>'ticket_number' = p_find
            when 'receipt' then a.changed_data->>'receipt_number' = p_find
            when 'customer' then a.table_name = 'customers' and a.changed_data->>'customer_no' = p_find
            when 'appraisal' then a.table_name = 'appraisal_items' and a.changed_data->>'appraisal_no' = p_find
            else true end)
  )
  select jsonb_build_object(
    'total', (select count(*) from matching),
    'page', v_page, 'size', v_size,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'table_name', x.table_name, 'record_id', x.record_id, 'action', x.action,
                      'actor', x.actor, 'created_at', x.created_at,
                      'changed_data', public.ctm_mask_audit(x.changed_data), 'old_data', public.ctm_mask_audit(x.old_data)) order by x.created_at desc, x.id desc), '[]'::jsonb)
             from (select * from matching m order by m.created_at desc, m.id desc offset (v_page - 1) * v_size limit v_size) x)
  ) into res;
  return res;
end $$;
revoke all on function public.audit_log_page(text, text, text, date, date, text, text, integer, integer) from public, anon;
grant execute on function public.audit_log_page(text, text, text, date, date, text, text, integer, integer) to authenticated;

-- the old-page allowance (0064) asked the audit log, as the signed-in Admin, "did I just blacklist this customer?".
-- With the read grant gone that question goes through this helper, which answers only yes or no about the caller's
-- own recent saves (found by the 0066 guard: 0062, 0063 and 0064 failed with "permission denied for table audit_log").
create or replace function public.ctm_blacklisted_by_me_recently(p_customer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.audit_log a
                  where a.table_name = 'customers' and a.record_id = p_customer::text and a.action = 'UPDATE'
                    and a.actor = auth.uid() and a.created_at > now() - interval '10 minutes'
                    and (a.changed_data->>'is_blacklisted')::boolean)
$$;
revoke all on function public.ctm_blacklisted_by_me_recently(uuid) from public, anon;
grant execute on function public.ctm_blacklisted_by_me_recently(uuid) to authenticated;

create or replace function public.guard_suspicious_flag() returns trigger language plpgsql set search_path = public as $$
declare v_reason text;
begin
  if public.ctm_is_system() then return new; end if; -- review_suspicious_flag, archive_record, restore_record
  if old.status not in ('open', 'investigating') then
    raise exception 'This flag was already decided (%). It can''t be changed. Reload the page.', old.status using errcode = '42501';
  end if;
  if (new.reason, new.customer_id, new.loan_id, new.created_at, new.archived_at, new.archived_by, new.archive_reason, new.is_demo)
     is distinct from (old.reason, old.customer_id, old.loan_id, old.created_at, old.archived_at, old.archived_by, old.archive_reason, old.is_demo) then
    raise exception 'Only the decision and its note can be saved on a flag.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'open' and new.status in ('investigating', 'dismissed', 'blacklisted'))
    or (old.status = 'investigating' and new.status in ('dismissed', 'blacklisted'))) then
    raise exception 'A flag can''t go from % to %.', old.status, new.status using errcode = '42501';
  end if;
  if new.resolved_by is distinct from old.resolved_by and new.resolved_by is distinct from auth.uid() then
    raise exception 'A decision can only be saved in your own name.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status in ('dismissed', 'blacklisted') and not public.ctm_flag_reason_ok(new.resolution_notes) then
    -- the old page's second save: only right after the same Admin blacklisted this customer, and only until the end date
    select c.blacklist_reason into v_reason from public.customers c
     where c.id = new.customer_id and c.is_blacklisted
       and now() < public.ctm_old_flag_page_until()
       and public.ctm_blacklisted_by_me_recently(c.id); -- 0066: through the helper (no direct audit log reads)
    if new.status = 'blacklisted' and found then
      new.resolution_notes := left(coalesce(public.ctm_clean_note(new.resolution_notes) || ' ', '')
        || '(Saved from the old page, which did not ask for a reason.) Customer''s blacklist reason: ' || coalesce(v_reason, 'none on file'), 500);
    else
      raise exception 'Write the reason for this decision (at least 10 characters).' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- no direct reads of the stored audit log from any login (the policy "admin can select" stays, the grant goes)
revoke all on public.audit_log from authenticated, anon;

-- ---------- 1a. loans: Outstanding and Overdue ----------
create or replace function public.report_loans(p_report text, p_q text default null, p_filter text default null,
  p_page integer default 1, p_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.ctm_today();
  v_size int := least(greatest(coalesce(p_size, 50), 5), 1000);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_like text; v_cno int; res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only (the reports are Admin only)
  if p_report is null or p_report not in ('outstanding', 'overdue') then raise exception 'Unknown report.'; end if;
  if p_filter is not null and not (
       (p_report = 'outstanding' and p_filter in ('overdue', 'due_soon', 'not_due', 'paid'))
    or (p_report = 'overdue' and p_filter in ('in_grace', 'past_grace', 'defaulted'))) then raise exception 'Unknown filter.'; end if;
  if v_q is not null then
    v_q := left(v_q, 80);
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; -- typed % or _ are plain letters
    if v_q ~* '^c[\s-]?\d{1,9}$' then v_cno := regexp_replace(v_q, '\D', '', 'g')::int; end if; -- "C-0012" = customer 12
  end if;
  with classified as (
    select l.id, l.ticket_number, l.principal_amount, l.principal_balance, l.maturity_date, l.status::text as status,
           coalesce(l.grace_period_days, 0) as grace_period_days, o.owed,
           round(o.owed - l.principal_balance, 2) as interest_now,
           c.full_name as customer_name, c.customer_no, c.contact_number,
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
    where (p_filter is null or (p_report = 'outstanding' and s.situation = p_filter) or (p_report = 'overdue' and s.stage = p_filter))
      and (v_q is null or s.customer_name ilike v_like or s.ticket_number ilike v_like or s.customer_no = v_cno)
  ), numbered as (
    select m.*, row_number() over (order by m.maturity_date, m.id) as rn from matching m
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
    -- running loans past their due date that are fully paid (waiting for release): not overdue, said under the list
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
revoke all on function public.report_loans(text, text, text, integer, integer) from public, anon;
grant execute on function public.report_loans(text, text, text, integer, integer) to authenticated;

-- ---------- 1b. inventory aging ----------
create or replace function public.report_inventory_aging(p_custody text default null, p_band text default null,
  p_page integer default 1, p_size integer default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.ctm_today();
  v_size int := least(greatest(coalesce(p_size, 50), 5), 1000);
  v_page int := greatest(coalesce(p_page, 1), 1);
  res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only
  if p_custody is not null and p_custody not in ('vault', 'forfeited', 'auction') then raise exception 'Unknown filter.'; end if;
  if p_band is not null and p_band not in ('0_30', '31_60', '61_90', 'over_90') then raise exception 'Unknown filter.'; end if;
  with items as (
    select i.id, i.vault_location, i.status::text as status, i.created_at,
           (i.created_at at time zone 'Asia/Manila')::date as received,
           v_today - (i.created_at at time zone 'Asia/Manila')::date as days,
           case when i.status in ('pawned', 'extended') then 'vault' when i.status = 'forfeited' then 'forfeited' else 'auction' end as custody,
           a.appraisal_no, a.category::text as category, a.category_other, a.karat, a.weight_grams, c.full_name as customer_name
    from public.inventory_items i
    left join public.appraisal_items a on a.id = i.appraisal_item_id
    left join public.customers c on c.id = a.customer_id
    where i.archived_at is null and i.status in ('pawned', 'extended', 'forfeited', 'queued_for_auction')
  ), banded as (
    select x.*, case when x.days <= 30 then '0_30' when x.days <= 60 then '31_60' when x.days <= 90 then '61_90' else 'over_90' end as band from items x
  ), in_group as (
    select * from banded b where p_custody is null or b.custody = p_custody
  ), matching as (
    select * from in_group g where p_band is null or g.band = p_band
  ), numbered as (
    select m.*, row_number() over (order by m.created_at, m.id) as rn from matching m
  ), pg as (
    select greatest(1, least(v_page, ceil((select count(*) from matching)::numeric / v_size)::int)) as p
  )
  select jsonb_build_object(
    'today', v_today,
    'all_count', (select count(*) from banded),
    'aged_count', (select count(*) from banded where days > 60),
    'custody_counts', (select jsonb_object_agg(custody, n) from (select custody, count(*) n from banded group by 1) z),
    'band_counts', (select jsonb_object_agg(band, n) from (select band, count(*) n from in_group group by 1) z),
    'total', (select count(*) from matching),
    'page', (select p from pg), 'size', v_size,
    'rows', (select coalesce(jsonb_agg(to_jsonb(n) - 'rn' order by n.rn), '[]'::jsonb) from numbered n, pg
              where n.rn > (pg.p - 1) * v_size and n.rn <= pg.p * v_size)
  ) into res;
  return res;
end $$;
revoke all on function public.report_inventory_aging(text, text, integer, integer) from public, anon;
grant execute on function public.report_inventory_aging(text, text, integer, integer) to authenticated;

-- ---------- 1c. trends & analytics ----------
create or replace function public.report_loan_analytics() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.ctm_today(); res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only
  with l as (select principal_amount, status::text as status, loan_date from public.loans where archived_at is null),
  months as (
    select to_char(m, 'YYYY-MM') as month, m::date as first_day
    from generate_series(date_trunc('month', v_today) - interval '11 months', date_trunc('month', v_today), interval '1 month') m
  )
  select jsonb_build_object(
    'today', v_today,
    'total', (select count(*) from l),
    'principal_sum', (select coalesce(sum(principal_amount), 0) from l),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from l group by 1) z),
    'months', (select jsonb_agg(jsonb_build_object('month', mo.month,
                 'count', (select count(*) from l where date_trunc('month', l.loan_date) = mo.first_day),
                 'totalPrincipal', (select coalesce(sum(principal_amount), 0) from l where date_trunc('month', l.loan_date) = mo.first_day)) order by mo.month)
               from months mo)
  ) into res;
  return res;
end $$;
revoke all on function public.report_loan_analytics() from public, anon;
grant execute on function public.report_loan_analytics() to authenticated;

-- ---------- 1d. financial summary: the breakdown by entry type ----------
create or replace function public.report_cash_breakdown(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Pick a start date on or before the end date.'; end if;
  with e as (
    select entry_type::text as entry_type, direction::text as direction, amount, is_memo from public.cash_flow_entries
    where archived_at is null
      and created_at >= p_from::timestamp at time zone 'Asia/Manila'
      and created_at < (p_to + 1)::timestamp at time zone 'Asia/Manila'
  )
  select jsonb_build_object(
    'entries', (select count(*) from e),
    'cash_in', (select coalesce(sum(amount), 0) from e where not is_memo and direction = 'in'),
    'cash_out', (select coalesce(sum(amount), 0) from e where not is_memo and direction = 'out'),
    'non_cash_count', (select count(*) from e where is_memo),
    'non_cash_amount', (select coalesce(sum(amount), 0) from e where is_memo),
    'by_type', (select coalesce(jsonb_agg(jsonb_build_object('entry_type', t.entry_type, 'count', t.n, 'cash_in', t.cin, 'cash_out', t.cout) order by t.entry_type), '[]'::jsonb)
                from (select entry_type, count(*) n,
                             coalesce(sum(amount) filter (where direction = 'in'), 0) cin,
                             coalesce(sum(amount) filter (where direction = 'out'), 0) cout
                      from e where not is_memo group by entry_type) t)
  ) into res;
  return res;
end $$;
revoke all on function public.report_cash_breakdown(date, date) from public, anon;
grant execute on function public.report_cash_breakdown(date, date) to authenticated;

-- ---------- 4. self-test ----------
create or replace function public.ctm_selftest_0066() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  admin_id uuid; s text; r jsonb; r2 jsonb; n int; n2 int; t0 timestamptz; ms text := ''; v_today date := ctm_today(); loan_src uuid; d date;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;

  test := 'Roles: Operator, Cashier and Appraiser can''t run any report function or read the audit log; nobody (not even an Admin) reads the stored audit log directly; signed-out is refused';
  begin
    execute 'set local role authenticated';
    s := '';
    foreach n in array array[1, 2, 3] loop
      perform set_config('request.jwt.claims', json_build_object('sub', (array[op_id, cash_id, appr_id])[n], 'role', 'authenticated')::text, true);
      begin perform report_loans('outstanding'); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '1' else '?' end; end;
      begin perform report_inventory_aging(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '2' else '?' end; end;
      begin perform report_loan_analytics(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '3' else '?' end; end;
      begin perform report_cash_breakdown(v_today, v_today); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '4' else '?' end; end;
      begin perform audit_log_page(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '5' else '?' end; end;
      s := s || '/';
    end loop;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin select count(*) into n from audit_log; s := s || 'admin direct ' || n; exception when insufficient_privilege then s := s || 'admin direct refused'; end;
    execute 'reset role';
    execute 'set local role anon';
    begin select count(*) into n from audit_log; s := s || '/anon ' || n; exception when insufficient_privilege then s := s || '/anon refused'; end;
    execute 'reset role';
    outcome := case when s = '12345/12345/12345/admin direct refused/anon refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Audit log for an Admin: every entry is reachable through audit_log_page, ID numbers show only the last 4 (before and after), other fields are untouched, and the stored entries still have the full numbers';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := audit_log_page(p_table => 'customers', p_size => 100);
    r2 := audit_log_page(p_size => 5);
    execute 'reset role';
    s := ((r2->>'total')::int = (select count(*) from audit_log))::text
      || ',' || ((r->>'total')::int = (select count(*) from audit_log where table_name = 'customers'))::text
      -- no shown ID number is longer than the mask
      || ',' || (select bool_and(coalesce(x->'changed_data'->>'id_number', '') = '' or x->'changed_data'->>'id_number' like '•••• %') and
                        bool_and(coalesce(x->'old_data'->>'id_number', '') = '' or x->'old_data'->>'id_number' like '•••• %')
                 from jsonb_array_elements(r->'rows') x)::text
      -- the masked value is the real last 4, and the name is unchanged
      || ',' || coalesce((select bool_and(x->'changed_data'->>'id_number' = '•••• ' || right(a.changed_data->>'id_number', 4) and x->'changed_data'->>'full_name' is not distinct from a.changed_data->>'full_name')
                 from jsonb_array_elements(r->'rows') x join audit_log a on a.id = (x->>'id')::uuid where coalesce(a.changed_data->>'id_number', '') <> ''), true)::text
      || ',' || ((select count(*) from audit_log where table_name = 'customers' and coalesce(changed_data->>'id_number', '') <> '' and changed_data->>'id_number' not like '•••• %') > 0)::text;
    outcome := case when s = 'true,true,true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Outstanding and Overdue: counts and totals equal the loan records worked out another way; a fully paid loan is never overdue; the rows of all pages add up to the totals; search and filters work';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_loans('outstanding', p_size => 1000);
    r2 := report_loans('overdue', p_size => 1000);
    s := ((r->>'all_count')::int = (select count(*) from loans where archived_at is null and status in ('active', 'extended', 'reinstated')))::text
      || ',' || ((r->>'all_owed')::numeric = (select coalesce(sum(owed_now(l)), 0) from loans l where archived_at is null and status in ('active', 'extended', 'reinstated')))::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r->'counts')) = (r->>'all_count')::int)::text
      || ',' || ((r->'totals'->>'owed')::numeric = (select sum((x->>'owed')::numeric) from jsonb_array_elements(r->'rows') x))::text
      || ',' || ((r2->>'all_count')::int = (select count(*) from loans l where archived_at is null and owed_now(l) >= 0.01 and
                   (status = 'defaulted' or (status in ('active', 'extended', 'reinstated') and maturity_date < ctm_today()))))::text
      || ',' || (not exists (select 1 from jsonb_array_elements(r2->'rows') x where (x->>'owed')::numeric < 0.01))::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r2->'counts')) = (r2->>'all_count')::int)::text
      || ',' || (coalesce((r->'counts'->>'overdue')::int, 0) + coalesce((r2->'counts'->>'defaulted')::int, 0) = (r2->>'all_count')::int)::text
      || ',' || ((report_loans('outstanding', p_filter => 'paid')->>'total')::int = coalesce((r->'counts'->>'paid')::int, 0))::text;
    -- search by ticket finds that loan
    s := s || ',' || ((report_loans('outstanding', p_q => (select ticket_number from loans where archived_at is null and status = 'active' limit 1))->>'total')::int >= 1)::text;
    -- a page past the end shows the last page
    s := s || ',' || ((report_loans('outstanding', p_page => 9999, p_size => 50)->>'page')::int = greatest(1, ceil((r->>'all_count')::numeric / 50)::int))::text;
    execute 'reset role';
    outcome := case when s not like '%false%' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Inventory aging and Trends: counts equal the records (items still in the shop; loans not archived), age groups add up, days held are Manila days, and the 12 months add up to the loans of those months';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_inventory_aging(p_size => 1000);
    r2 := report_loan_analytics();
    s := ((r->>'all_count')::int = (select count(*) from inventory_items where archived_at is null and status in ('pawned', 'extended', 'forfeited', 'queued_for_auction')))::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r->'band_counts')) = (r->>'all_count')::int)::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r->'custody_counts')) = (r->>'all_count')::int)::text
      || ',' || coalesce((select bool_and((x->>'days')::int = ctm_today() - ((x->>'created_at')::timestamptz at time zone 'Asia/Manila')::date) from jsonb_array_elements(r->'rows') x), true)::text
      || ',' || ((r2->>'total')::int = (select count(*) from loans where archived_at is null))::text
      || ',' || ((select sum(value::int) from jsonb_each_text(r2->'by_status')) = (r2->>'total')::int)::text
      || ',' || (jsonb_array_length(r2->'months') = 12)::text
      || ',' || ((select sum((m->>'totalPrincipal')::numeric) from jsonb_array_elements(r2->'months') m)
                 = (select coalesce(sum(principal_amount), 0) from loans where archived_at is null and loan_date >= date_trunc('month', ctm_today()) - interval '11 months'))::text;
    execute 'reset role';
    outcome := case when s not like '%false%' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Financial summary = Cash & ledger: for this month, Jan 1 to today, one day and the whole ledger, Cash in, Cash out and the entry count equal cash_ledger_page; capitalized interest is never cash; a backwards range is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := '';
    foreach d in array array[date_trunc('month', v_today)::date, make_date(extract(year from v_today)::int, 1, 1), v_today, date '2000-01-01'] loop
      r := report_cash_breakdown(d, v_today);
      r2 := cash_ledger_page(p_from => d, p_to => v_today, p_page => 1, p_size => 5);
      s := s || ((r->>'cash_in')::numeric = (r2->>'sum_in')::numeric and (r->>'cash_out')::numeric = (r2->>'sum_out')::numeric
                 and (r->>'entries')::int = (r2->>'total')::int
                 and (select coalesce(sum((t->>'cash_in')::numeric), 0) from jsonb_array_elements(r->'by_type') t) = (r->>'cash_in')::numeric
                 -- every entry is either in the cash breakdown or counted as non-cash (capitalized interest), never both
                 and (select coalesce(sum((t->>'count')::int), 0) from jsonb_array_elements(r->'by_type') t) + (r->>'non_cash_count')::int = (r->>'entries')::int
                 and (r->>'non_cash_count')::int = (select count(*) from cash_flow_entries where archived_at is null and is_memo
                       and created_at >= d::timestamp at time zone 'Asia/Manila' and created_at < (v_today + 1)::timestamp at time zone 'Asia/Manila'))::text || ',';
    end loop;
    begin perform report_cash_breakdown(v_today, v_today - 1); s := s || 'backwards saved'; exception when others then s := s || 'backwards refused'; end;
    execute 'reset role';
    outcome := case when s = 'true,true,true,true,backwards refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Bigger dataset (inside the test only, rolled back): 20,000 more ledger rows and 10,000 more open loans; every report still adds them all up and answers quickly';
  begin
    select id into loan_src from loans where archived_at is null and status = 'active' and principal_balance > 0 order by created_at desc limit 1;
    if loan_src is null then outcome := 'SKIP (needs an active loan)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    n := (report_loans('outstanding')->>'all_count')::int;
    r := report_cash_breakdown(date '2000-01-01', v_today);
    execute 'reset role';
    -- the extra rows (TEST data, never saved: the whole test rolls back)
    insert into cash_flow_entries (entry_type, direction, amount, description, created_at, is_memo, created_by)
      select 'expense', 'out', 1.00, 'TEST perf row ' || g, now() - (g || ' minutes')::interval, false, admin_id from generate_series(1, 20000) g;
    insert into loans select r.* from loans l cross join generate_series(1, 10000) g
      cross join lateral jsonb_populate_record(null::loans, to_jsonb(l) || jsonb_build_object('id', gen_random_uuid(), 'ticket_number', 'TEST-PERF-' || g)) r
      where l.id = loan_src;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    t0 := clock_timestamp(); r2 := report_loans('outstanding'); ms := ms || 'outstanding ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    n2 := (r2->>'all_count')::int;
    t0 := clock_timestamp(); perform report_loans('overdue'); ms := ms || ', overdue ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    t0 := clock_timestamp(); perform report_inventory_aging(); ms := ms || ', aging ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    t0 := clock_timestamp(); r2 := report_loan_analytics(); ms := ms || ', trends ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    t0 := clock_timestamp(); s := (report_cash_breakdown(date '2000-01-01', v_today)->>'cash_out'); ms := ms || ', cash ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    t0 := clock_timestamp(); perform audit_log_page(p_size => 50); ms := ms || ', audit ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || 'ms';
    execute 'reset role';
    s := (n2 = n + 10000)::text || ',' || (s::numeric = (r->>'cash_out')::numeric + 20000)::text || ',' || ((r2->>'total')::int >= 10000)::text;
    outcome := case when s = 'true,true,true' then 'PASS (' || ms || ')' else 'FAIL ' || s || ' ' || ms end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0066() from public, anon, authenticated;

-- applied only if these pass, and the earlier ledger, flag and appraisal tests still pass with the audit grant removed
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0066' t, * from public.ctm_selftest_0066() union all select '0065' t, * from public.ctm_selftest_0065()
    union all select '0064' t, * from public.ctm_selftest_0064() union all select '0063' t, * from public.ctm_selftest_0063()
    union all select '0062' t, * from public.ctm_selftest_0062() union all select '0058' t, * from public.ctm_selftest_0058()
    union all select '0038' t, * from public.ctm_selftest_0038()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0066 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
