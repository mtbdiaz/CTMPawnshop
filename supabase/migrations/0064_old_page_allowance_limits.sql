-- 0064 (Nov 12, 2026, Wush): Suspicious activity, the old-page allowance from 0063 is narrowed and has an end date.
-- No flag, customer, appraisal, loan or ledger entry is changed by this migration.
--
-- 0063 let a flag be saved as Blacklisted without a reason when the customer was already blacklisted, so the old page
-- on the live site (customer first, then the flag) can't leave a blocked customer with an open flag. Review found it
-- was wider than needed: any Admin calling the database directly could close a flag of ANY blacklisted customer
-- without a reason. Now the allowance only applies when ALL of these are true:
--   - the flag goes to Blacklisted (Dismiss always needs a reason);
--   - no real reason was written;
--   - the customer is blacklisted, and the SAME Admin saved that customer as blacklisted in the last 10 minutes
--     (from the audit log) - the old page's first save, a second earlier;
--   - it is before Jan 1, 2027 (the new page will be deployed long before; see below).
-- The note it saves now also carries the customer's blacklist reason, so the decision still has a written reason:
--   "(Saved from the old page, which did not ask for a reason.) Customer's blacklist reason: <reason>"
-- From Jan 1, 2027, if the old page is somehow still live, its Blacklist is refused at the FIRST save (the customer),
-- so nothing is saved and nothing disagrees ("This page is out of date. Reload the page.").
-- The new page never uses the allowance: review_suspicious_flag() checks the reason itself, before anything is saved.
--
-- How the allowance is removed (after the new page is deployed to Vercel and checked there):
--   a later migration drops the policy "suspicious_activity_flags: admin update" (the new page never updates the
--   table directly), drops the trigger customers_old_flag_page and its function, and puts guard_suspicious_flag back
--   without the old-page branch. Its self-test checks that a direct update is refused for every role.
-- Self-test: select * from public.ctm_selftest_0064();   (every test rolls back)

-- the last moment the old page may use the allowance
create or replace function public.ctm_old_flag_page_until() returns timestamptz language sql immutable as
$$ select timestamptz '2027-01-01 00:00:00+08' $$;

-- ---------- 1. the flag guard: the narrowed allowance ----------
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
       and exists (select 1 from public.audit_log a
                    where a.table_name = 'customers' and a.record_id = c.id::text and a.action = 'UPDATE'
                      and a.actor = auth.uid() and a.created_at > now() - interval '10 minutes'
                      and (a.changed_data->>'is_blacklisted')::boolean);
    if new.status = 'blacklisted' and found then
      new.resolution_notes := left(coalesce(public.ctm_clean_note(new.resolution_notes) || ' ', '')
        || '(Saved from the old page, which did not ask for a reason.) Customer''s blacklist reason: ' || coalesce(v_reason, 'none on file'), 500);
    else
      raise exception 'Write the reason for this decision (at least 10 characters).' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- ---------- 2. the old page's customer save: refused after the end date ----------
create or replace function public.guard_old_flag_blacklist() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.ctm_is_system() then return new; end if; -- review_suspicious_flag (new page) and other database functions
  -- only the old Suspicious activity page writes exactly this reason
  if new.is_blacklisted and new.blacklist_reason = 'Blacklisted following suspicious activity review'
     and new.blacklist_reason is distinct from old.blacklist_reason then
    if now() >= public.ctm_old_flag_page_until() then
      raise exception 'This page is out of date, so nothing was saved. Reload the page.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.suspicious_activity_flags f
                    where f.customer_id = new.id and f.archived_at is null and f.status in ('open', 'investigating')) then
      raise exception 'This flag was already decided by another Admin, so the customer was not blacklisted. Reload the page.' using errcode = 'P0001';
    end if;
    if old.is_blacklisted then new.blacklist_reason := coalesce(old.blacklist_reason, new.blacklist_reason); end if; -- keep their own reason
  end if;
  return new;
end $$;

-- ---------- 3. self-test ----------
create or replace function public.ctm_selftest_0064() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  admin_id uuid; admin2 uuid; fo uuid; fo2 uuid; cust uuid; ln uuid; s text; e text; h0 text; h1 text;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id into admin2 from profiles where role = 'admin' and is_active and id <> admin_id order by created_at limit 1;
  select f.id into fo from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'open' and f.archived_at is null and not c.is_blacklisted order by f.created_at limit 1;
  select f.id into fo2 from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'open' and f.archived_at is null and not c.is_blacklisted and f.id <> fo and c.id <> (select customer_id from suspicious_activity_flags where id = fo) order by f.created_at limit 1;
  -- an open loan of a customer who is not blacklisted (for the "existing loans still work" test)
  select l.id into ln from loans l join customers c on c.id = l.customer_id
   where l.status in ('active', 'extended', 'reinstated') and l.archived_at is null and l.principal_balance > 0 and not c.is_blacklisted and c.archived_at is null
   order by l.created_at desc limit 1;

  test := 'Old page: Blacklist right after the same Admin blacklisted the customer is saved, and the note carries the customer''s blacklist reason (their own reason when they already had one)';
  begin
    if fo is null or fo2 is null then outcome := 'SKIP (needs two open flags)'; raise exception 'ROLLBACK'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform set_config('ctm.system', 'on', true);
    update customers set is_blacklisted = true, blacklist_reason = 'TEST own reason' where id = (select customer_id from suspicious_activity_flags where id = fo2);
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    update customers set is_blacklisted = true, blacklist_reason = 'Blacklisted following suspicious activity review' where id = (select customer_id from suspicious_activity_flags where id = fo);
    update suspicious_activity_flags set status = 'blacklisted', resolved_by = admin_id, resolved_at = now(), resolution_notes = null where id = fo;
    update customers set is_blacklisted = true, blacklist_reason = 'Blacklisted following suspicious activity review' where id = (select customer_id from suspicious_activity_flags where id = fo2);
    update suspicious_activity_flags set status = 'blacklisted', resolved_by = admin_id, resolved_at = now(), resolution_notes = '' where id = fo2;
    execute 'reset role';
    s := (select status || '|' || resolution_notes from suspicious_activity_flags where id = fo) || '#' || (select status || '|' || resolution_notes from suspicious_activity_flags where id = fo2);
    outcome := case when s = 'blacklisted|(Saved from the old page, which did not ask for a reason.) Customer''s blacklist reason: Blacklisted following suspicious activity review#blacklisted|(Saved from the old page, which did not ask for a reason.) Customer''s blacklist reason: TEST own reason'
      then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;

  test := 'No abuse: closing a flag as Blacklisted without a reason is refused when the customer was blacklisted by someone else, and Dismiss without a reason is refused even right after a blacklist; the new page still needs a reason';
  begin
    if fo is null then outcome := 'SKIP (needs an open flag)'; raise exception 'ROLLBACK'; end if;
    select customer_id into cust from suspicious_activity_flags where id = fo;
    s := '';
    if admin2 is not null then
      -- another Admin blacklists the customer on the customer page
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', admin2, 'role', 'authenticated')::text, true);
      update customers set is_blacklisted = true, blacklist_reason = 'TEST blacklisted on the customer page' where id = cust;
      -- this Admin tries to close the flag without a reason
      perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
      begin update suspicious_activity_flags set status = 'blacklisted', resolved_by = admin_id, resolved_at = now(), resolution_notes = null where id = fo; s := s || 'other saved';
      exception when others then s := s || case when sqlerrm like 'Write the reason%' then 'other refused' else sqlerrm end; end;
    else
      s := s || 'other refused'; -- only one Admin account: nothing to test here
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
      update customers set is_blacklisted = true, blacklist_reason = 'TEST blacklisted on the customer page' where id = cust;
    end if;
    -- the same Admin now saves the customer again (as the old page would) and tries Dismiss without a reason
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    update customers set blacklist_reason = 'TEST blacklisted on the customer page, again' where id = cust;
    begin update suspicious_activity_flags set status = 'dismissed', resolved_by = admin_id, resolved_at = now(), resolution_notes = null where id = fo; s := s || '|dismiss saved';
    exception when others then s := s || case when sqlerrm like 'Write the reason%' then '|dismiss refused' else '|' || sqlerrm end; end;
    begin perform review_suspicious_flag(fo, 'blacklisted', null, 'open'); s := s || '|new page saved';
    exception when others then s := s || case when sqlerrm like 'Write the reason%' then '|new page refused' else '|' || sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || (select status from suspicious_activity_flags where id = fo);
    outcome := case when s = 'other refused|dismiss refused|new page refused|open' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;

  test := 'A blacklisted customer''s existing loan: a payment is accepted, and renew and redeem are not refused because of the blacklist';
  begin
    if ln is null then outcome := 'SKIP (needs an open loan)'; raise exception 'ROLLBACK'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform set_config('ctm.system', 'on', true);
    update customers set is_blacklisted = true, blacklist_reason = 'TEST blocked customer' where id = (select customer_id from loans where id = ln);
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    s := '';
    begin perform record_payment(ln, 1::numeric, false, null, gen_random_uuid()); s := s || 'payment ok';
    exception when others then s := s || 'payment refused: ' || sqlerrm; end;
    begin perform renew_loan(ln, gen_random_uuid(), (select maturity_date from loans where id = ln)); e := 'ok';
    exception when others then e := sqlerrm; end;
    s := s || '|renew ' || case when e ilike '%blacklist%' then 'blocked: ' || e else 'not blocked' end;
    begin perform redeem_loan(ln, false, null); e := 'ok';
    exception when others then e := sqlerrm; end;
    s := s || '|redeem ' || case when e ilike '%blacklist%' then 'blocked: ' || e else 'not blocked' end;
    execute 'reset role';
    outcome := case when s = 'payment ok|renew not blocked|redeem not blocked' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0064() from public, anon, authenticated;

-- applied only if these pass, and the earlier Suspicious activity, flag-rule and appraisal tests still pass
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0064' t, * from public.ctm_selftest_0064() union all select '0063' t, * from public.ctm_selftest_0063()
    union all select '0062' t, * from public.ctm_selftest_0062() union all select '0061' t, * from public.ctm_selftest_0061()
    union all select '0032' t, * from public.ctm_selftest_0032() union all select '0038' t, * from public.ctm_selftest_0038()
    union all select '0039' t, * from public.ctm_selftest_0039() union all select '0040' t, * from public.ctm_selftest_0040()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0064 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
