-- 0071 (Nov 14, 2026, Wush): Compliance / AML report: AML screening matches and blacklisted customers with their
-- history from the audit trail (when and by whom), for the report only.
-- No customer, flag, loan, audit entry or any other record is changed by this migration. Nothing about who may
-- blacklist, how AML checks are saved, or how flags are reviewed changes.
--
-- Why a database change is needed (the page can't do this on its own): "when was this customer blacklisted, and
-- by whom" is only in the audit trail, and since 0066 nobody (not even an Admin) reads the stored audit log
-- directly. The report showed "Record last changed" (customers.updated_at) instead, which is not the blacklist
-- date. This function reads it for the Admin, the same way the Audit Trail does (through a security definer
-- function, Admin only), and sends no ID number or other ID details at all.
--
-- report_compliance_records() returns:
--   aml          customers whose AML check is "flagged" (not archived): name, C-number, when the check was saved
--                (aml_checked_at), the note as written, who saved the record that set it to flagged and when (from the
--                audit trail; null if the audit trail doesn't have it), whether the customer is blacklisted now, and
--                how many of their suspicious-activity flags still need review. There is no separate "outcome"
--                field: the page says so and shows the note as written.
--   blacklisted  customers blacklisted now (not archived): name, C-number, the recorded reason, when and by whom the
--                blacklist was set (the first audit entry with is_blacklisted = true after the last one with false;
--                null if the audit trail doesn't have it), the newest suspicious-activity flag decided as Blacklisted
--                for this customer (when, by whom, its reason and note; null if none), and their open loans.
--   counts       aml and blacklisted.
-- Self-test: select * from public.ctm_selftest_0071();   (every test rolls back)

create or replace function public.report_compliance_records() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only (the reports are Admin only)
  with aml as (
    select c.id as customer_id, c.customer_no, c.full_name, c.aml_checked_at, c.aml_notes, c.is_blacklisted,
           (select count(*) from public.suspicious_activity_flags f where f.customer_id = c.id and f.archived_at is null
              and f.status in ('open', 'investigating')) as flags_needing_review,
           ev.created_at as flagged_saved_at, ev.by_name as flagged_saved_by
    from public.customers c
    left join lateral (
      -- the first audit entry that has aml_status = flagged after the last one that had another value
      select a.created_at, p.full_name as by_name
      from public.audit_log a left join public.profiles p on p.id = a.actor
      where a.table_name = 'customers' and a.record_id = c.id::text and a.action in ('INSERT', 'UPDATE')
        and a.changed_data->>'aml_status' = 'flagged'
        and a.created_at > coalesce((select max(b.created_at) from public.audit_log b
                                     where b.table_name = 'customers' and b.record_id = c.id::text and b.action in ('INSERT', 'UPDATE')
                                       and b.changed_data ? 'aml_status' and b.changed_data->>'aml_status' <> 'flagged'), '-infinity'::timestamptz)
      order by a.created_at limit 1) ev on true
    where c.aml_status = 'flagged' and c.archived_at is null
  ), bl as (
    select c.id as customer_id, c.customer_no, c.full_name, c.blacklist_reason,
           ev.created_at as blacklisted_at, ev.by_name as blacklisted_by,
           fl.resolved_at as flag_decided_at, fl.by_name as flag_decided_by, fl.reason as flag_reason, fl.resolution_notes as flag_note,
           coalesce((select h.active_loans from public.customer_history_summary h where h.customer_id = c.id), 0) as open_loans
    from public.customers c
    left join lateral (
      -- the first audit entry with is_blacklisted = true after the last one with false
      select a.created_at, p.full_name as by_name
      from public.audit_log a left join public.profiles p on p.id = a.actor
      where a.table_name = 'customers' and a.record_id = c.id::text and a.action in ('INSERT', 'UPDATE')
        and a.changed_data->>'is_blacklisted' = 'true'
        and a.created_at > coalesce((select max(b.created_at) from public.audit_log b
                                     where b.table_name = 'customers' and b.record_id = c.id::text and b.action in ('INSERT', 'UPDATE')
                                       and b.changed_data->>'is_blacklisted' = 'false'), '-infinity'::timestamptz)
      order by a.created_at limit 1) ev on true
    left join lateral (
      select f.resolved_at, p.full_name as by_name, f.reason, f.resolution_notes
      from public.suspicious_activity_flags f left join public.profiles p on p.id = f.resolved_by
      where f.customer_id = c.id and f.status = 'blacklisted' and f.archived_at is null
      order by f.resolved_at desc nulls last limit 1) fl on true
    where c.is_blacklisted and c.archived_at is null
  )
  select jsonb_build_object(
    'counts', jsonb_build_object('aml', (select count(*) from aml), 'blacklisted', (select count(*) from bl)),
    'aml', (select coalesce(jsonb_agg(to_jsonb(x) order by x.aml_checked_at desc nulls last, x.full_name), '[]'::jsonb) from aml x),
    'blacklisted', (select coalesce(jsonb_agg(to_jsonb(x) order by x.blacklisted_at desc nulls last, x.full_name), '[]'::jsonb) from bl x)
  ) into res;
  return res;
end $$;
revoke all on function public.report_compliance_records() from public, anon;
grant execute on function public.report_compliance_records() to authenticated;

create or replace function public.ctm_selftest_0071() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  admin_id uuid; s text; r jsonb; n int; v_aml int; v_bl int; v_cust int; v_flags int; v_audit int; v_missing int;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  -- counted as the owner, before signing in as the test Admin
  select count(*) into v_aml from customers where aml_status = 'flagged' and archived_at is null;
  select count(*) into v_bl from customers where is_blacklisted and archived_at is null;
  select count(*) into v_cust from customers; select count(*) into v_flags from suspicious_activity_flags; select count(*) into v_audit from audit_log;
  -- blacklisted customers whose audit trail has an entry setting the blacklist (the report must find each one)
  select count(*) into v_missing from customers c where c.is_blacklisted and c.archived_at is null
    and exists (select 1 from audit_log a where a.table_name = 'customers' and a.record_id = c.id::text and a.changed_data->>'is_blacklisted' = 'true');

  test := 'Counts and lists: AML matches and blacklisted customers equal the customer records (archived left out); every blacklisted customer whose audit trail has the blacklist gets its date and Admin; no ID number or ID detail is sent';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_compliance_records();
    execute 'reset role';
    s := ((r->'counts'->>'aml')::int = v_aml and jsonb_array_length(r->'aml') = v_aml)::text
      || ',' || ((r->'counts'->>'blacklisted')::int = v_bl and jsonb_array_length(r->'blacklisted') = v_bl)::text
      || ',' || ((select count(*) from jsonb_array_elements(r->'blacklisted') e where e->>'blacklisted_at' is not null and e->>'blacklisted_by' is not null) = v_missing)::text
      || ',' || (r::text not like '%id_number%' and r::text not like '%id_type%')::text;
    outcome := case when s = 'true,true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Blacklist date is the blacklist, not the last change: for each listed customer the date equals the audit entry that set is_blacklisted to true (not customers.updated_at when they differ)';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_compliance_records();
    execute 'reset role';
    select count(*) into n from jsonb_array_elements(r->'blacklisted') e
      where e->>'blacklisted_at' is not null and not exists (
        select 1 from audit_log a where a.table_name = 'customers' and a.record_id = e->>'customer_id' and a.changed_data->>'is_blacklisted' = 'true'
          and a.created_at = (e->>'blacklisted_at')::timestamptz);
    outcome := case when n = 0 then 'PASS' else 'FAIL ' || n || ' dates not from the audit trail' end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Still safe: Operator, Cashier and Appraiser are refused; signed-out visitors can''t call it; no customer, flag or audit entry changes';
  begin
    execute 'set local role authenticated';
    s := '';
    foreach n in array array[1, 2, 3] loop
      perform set_config('request.jwt.claims', json_build_object('sub', (array[op_id, cash_id, appr_id])[n], 'role', 'authenticated')::text, true);
      begin perform report_compliance_records(); s := s || 'x/'; exception when others then s := s || case when sqlerrm like '%not allowed%' then 'refused/' else '?/' end; end;
    end loop;
    execute 'reset role';
    s := s || 'anon ' || has_function_privilege('anon', 'public.report_compliance_records()', 'execute')::text
      || '/' || ((select count(*) from customers) = v_cust and (select count(*) from suspicious_activity_flags) = v_flags and (select count(*) from audit_log) = v_audit)::text;
    outcome := case when s = 'refused/refused/refused/anon false/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0071() from public, anon, authenticated;

-- applied only if these pass, and the earlier Reports, audit, ledger and Suspicious activity tests still pass
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0071' t, * from public.ctm_selftest_0071() union all select '0070' t, * from public.ctm_selftest_0070()
    union all select '0069' t, * from public.ctm_selftest_0069() union all select '0068' t, * from public.ctm_selftest_0068()
    union all select '0067' t, * from public.ctm_selftest_0067() union all select '0066' t, * from public.ctm_selftest_0066()
    union all select '0065' t, * from public.ctm_selftest_0065() union all select '0064' t, * from public.ctm_selftest_0064()
    union all select '0063' t, * from public.ctm_selftest_0063() union all select '0062' t, * from public.ctm_selftest_0062()
    union all select '0058' t, * from public.ctm_selftest_0058() union all select '0038' t, * from public.ctm_selftest_0038()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0071 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
