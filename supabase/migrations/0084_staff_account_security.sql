-- 0084 (Nov 15, 2026, Wush): staff account security (Settings → Users review, claude/users-review.md, U1, U2, U4).
--
-- U1 Before: get_my_role() and is_admin() looked only at the role, not at is_active, and 17 tables (customers, loans,
--    payments, the cash ledger...) plus the item photos let ANY signed-in token read them. So a deactivated person
--    kept database access until their sign-in token ran out (up to 1 hour): a deactivated Admin could switch
--    themselves back on, and a deactivated Cashier could still read every customer (rolled-back test, Nov 15). Numbered 0084 because Matt's 0076-0083 went in first on Nov 15.
--    Now: both helpers answer "no role" for an inactive account, every staff read rule asks for an active staff role,
--    and a person can only edit their own name while active. The pages and the ctm_assert_role functions already
--    blocked inactive accounts; nothing changes for active staff.
-- U2 Before: nothing kept an active Admin. An Admin could demote the other Admins and then themselves straight in the
--    database (0 Admins left), and two Admins deactivating each other at the same moment would both succeed.
--    Now: a change that would leave no active Admin is refused, one change at a time (a lock), and nobody can remove
--    their own Admin rights or deactivate themselves, even through the database.
-- U4 Before: password resets and the Supabase login block were not recorded anywhere we can see.
--    Now: staff_account_events (who did it, to whom, what, when), written only through record_staff_account_event,
--    which takes the actor from the signed-in session (never from the browser) and never stores a password.
--    Name, role and active changes are already in the audit log; the app now writes them as the signed-in Admin so the
--    log shows who did it (server code, not this migration).
-- No staff account, role or status is changed by this migration.
-- Self-test: select * from public.ctm_selftest_0084();   (every test rolls back)

-- U1 -----------------------------------------------------------------------------------------------------------------
create or replace function public.get_my_role() returns public.staff_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and is_active), false);
$$;

-- every "any signed-in staff may read" rule now needs an ACTIVE staff role ((select ...) = worked out once per query)
alter policy "appraisal_items: any authenticated staff can select" on public.appraisal_items using ((select public.get_my_role()) is not null);
alter policy "auction_batch_items: staff select" on public.auction_batch_items using ((select public.get_my_role()) is not null);
alter policy "auction_batches: staff select" on public.auction_batches using ((select public.get_my_role()) is not null);
alter policy "customers: any authenticated staff can select" on public.customers using ((select public.get_my_role()) is not null);
alter policy "inventory_items: staff select" on public.inventory_items using ((select public.get_my_role()) is not null);
alter policy "inventory_location_moves: staff select" on public.inventory_location_moves using ((select public.get_my_role()) is not null);
alter policy "inventory_status_history: staff select" on public.inventory_status_history using ((select public.get_my_role()) is not null);
alter policy "loan_extensions: staff select" on public.loan_extensions using ((select public.get_my_role()) is not null);
alter policy "loan_payments: staff select" on public.loan_payments using ((select public.get_my_role()) is not null);
alter policy "loans: staff select" on public.loans using ((select public.get_my_role()) is not null);
alter policy "loan_penalty_waivers: staff select" on public.loan_penalty_waivers using ((select public.get_my_role()) is not null); -- Matt's 0078
alter policy "physical_inventory_audit_followups: staff select" on public.physical_inventory_audit_followups using ((select public.get_my_role()) is not null);
alter policy "physical_inventory_audit_items: staff select" on public.physical_inventory_audit_items using ((select public.get_my_role()) is not null);
alter policy "physical_inventory_audits: staff select" on public.physical_inventory_audits using ((select public.get_my_role()) is not null);
alter policy "reminder_log: staff select" on public.reminder_log using ((select public.get_my_role()) is not null);
alter policy "score_weights: staff select" on public.score_weights using ((select public.get_my_role()) is not null);
alter policy "system_settings: any authenticated staff can select" on public.system_settings using ((select public.get_my_role()) is not null);
alter policy "vault_locations: staff select" on public.vault_locations using ((select public.get_my_role()) is not null);

-- item photos: read and remove-own-unused only while active (upload already asked for a role)
alter policy "item-photos: authenticated staff can read" on storage.objects
  using (bucket_id = 'item-photos' and (select public.get_my_role()) is not null);
alter policy "item-photos: uploader can delete own unattached photo" on storage.objects
  using (bucket_id = 'item-photos' and owner_id = ((select auth.uid()))::text and (select public.get_my_role()) is not null and not public.ctm_photo_in_use(name));

-- a person may change their own name only while their account is active (role and status stay locked as before)
alter policy "profiles: admin can update, self can update own name" on public.profiles
  using ((id = auth.uid() and (select public.get_my_role()) is not null) or public.is_admin());

-- U2 -----------------------------------------------------------------------------------------------------------------
create or replace function public.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old_admin boolean := old.role = 'admin' and old.is_active;
begin
  if tg_op = 'UPDATE' then
    if not (v_old_admin and (new.role <> 'admin' or not new.is_active)) then return new; end if;
  elsif not v_old_admin then
    return old; -- deleting someone who is not an active Admin
  end if;
  -- the same rule as the Users page: never your own account (the session's account; empty for system jobs)
  if old.id = auth.uid() then
    raise exception 'You can''t deactivate or remove Admin rights from your own account. Ask another Admin.' using errcode = '42501';
  end if;
  -- one Admin change at a time, so two Admins removing each other at the same moment can't both pass
  perform pg_advisory_xact_lock(hashtext('ctm_profiles_active_admins'));
  if not exists (select 1 from public.profiles p where p.role = 'admin' and p.is_active and p.id <> old.id) then
    raise exception 'At least one active Admin must remain. Make another account Admin first.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists profiles_guard_last_admin on public.profiles;
create trigger profiles_guard_last_admin before update of role, is_active or delete on public.profiles
  for each row execute function public.guard_last_admin();

-- U4 -----------------------------------------------------------------------------------------------------------------
create table if not exists public.staff_account_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),  -- the staff account it happened to
  action text not null check (action in ('password_reset', 'login_blocked', 'login_unblocked', 'login_block_failed', 'login_unblock_failed')),
  note text check (note is null or char_length(note) <= 300),  -- e.g. the Supabase error; never a password
  actor uuid not null references public.profiles(id),       -- the signed-in Admin (from the session)
  created_at timestamptz not null default now(),
  is_demo boolean not null default false
);
create index if not exists staff_account_events_profile_idx on public.staff_account_events (profile_id, created_at desc);
alter table public.staff_account_events enable row level security;
drop policy if exists "staff_account_events: admin select" on public.staff_account_events;
create policy "staff_account_events: admin select" on public.staff_account_events for select to authenticated using (public.is_admin());
revoke all on public.staff_account_events from anon;
revoke insert, update, delete, truncate on public.staff_account_events from authenticated;
grant select on public.staff_account_events to authenticated;
drop trigger if exists staff_account_events_audit on public.staff_account_events;
create trigger staff_account_events_audit after insert or update or delete on public.staff_account_events
  for each row execute function public.audit_trigger_fn();

create or replace function public.record_staff_account_event(p_profile uuid, p_action text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.ctm_assert_role(array['admin']::public.staff_role[]); -- an ACTIVE Admin; auth.uid() is the session's
  if not exists (select 1 from public.profiles where id = p_profile) then raise exception 'Staff account not found.'; end if;
  insert into public.staff_account_events (profile_id, action, note, actor)
  values (p_profile, p_action, nullif(left(btrim(coalesce(p_note, '')), 300), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_staff_account_event(uuid, text, text) from public, anon;
grant execute on function public.record_staff_account_event(uuid, text, text) to authenticated;

-- Self-test ----------------------------------------------------------------------------------------------------------
create or replace function public.ctm_selftest_0084() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  adm uuid; adm2 uuid; adm3 uuid; op uuid; csh uuid; apr uuid; who uuid; s text; n int; n2 int; ok boolean; v_role text;
  fp_profiles text; fp_events int; fp_log int;
begin
  select id into adm from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id into adm2 from profiles where role = 'admin' and is_active and id <> adm order by created_at limit 1;
  select id into adm3 from profiles where role = 'admin' and is_active and id not in (adm, adm2) order by created_at limit 1;
  select id into op from profiles where role = 'operator' and is_active order by created_at limit 1;
  select id into csh from profiles where role = 'cashier' and is_active order by created_at limit 1;
  select id into apr from profiles where role = 'appraiser' and is_active order by created_at limit 1;
  select md5(string_agg(id::text || full_name || role || is_active, ',' order by id)) into fp_profiles from profiles;
  select count(*) into fp_events from staff_account_events;

  test := 'U1 Active staff keep their access: each role reads customers, loans, items and the staff list; cash for Operator/Cashier/Admin only; is_admin() only for the Admin';
  begin
    s := '';
    foreach who in array array[adm, op, csh, apr] loop
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
      v_role := get_my_role()::text;
      select count(*) into n from customers; if n = 0 then s := s || v_role || ':no-customers '; end if;
      select count(*) into n from loans; if n = 0 then s := s || v_role || ':no-loans '; end if;
      select count(*) into n from inventory_items; if n = 0 then s := s || v_role || ':no-items '; end if;
      select count(*) into n from cash_flow_entries; if (n > 0) <> (v_role in ('admin', 'operator', 'cashier')) then s := s || v_role || ':cash=' || n || ' '; end if;
      if is_admin() <> (v_role = 'admin') then s := s || v_role || ':is_admin=' || is_admin() || ' '; end if;
      select count(*) into n from profiles; if n < 12 then s := s || v_role || ':staff=' || n || ' '; end if;
      execute 'reset role';
    end loop;
    outcome := case when s = '' then 'PASS' else 'FAIL ' || s end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  return next;

  test := 'U1 A deactivated Admin, Operator, Cashier and Appraiser with a still-valid session: no role, no customers, loans, payments, items, cash, settings, photos or other staff; no direct changes; the Admin can''t switch themselves back on; ctm_assert_role refuses';
  begin
    s := '';
    update profiles set is_active = false where id in (adm, op, csh, apr);
    foreach who in array array[adm, op, csh, apr] loop
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
      if get_my_role() is not null or is_admin() then s := s || 'role-still-there '; end if;
      select count(*) into n from customers; if n > 0 then s := s || 'customers=' || n || ' '; end if;
      select count(*) into n from loans; if n > 0 then s := s || 'loans '; end if;
      select count(*) into n from loan_payments; if n > 0 then s := s || 'payments '; end if;
      select count(*) into n from loan_penalty_waivers; if n > 0 then s := s || 'waivers '; end if;
      select count(*) into n from inventory_items; if n > 0 then s := s || 'items '; end if;
      select count(*) into n from cash_flow_entries; if n > 0 then s := s || 'cash '; end if;
      select count(*) into n from system_settings; if n > 0 then s := s || 'settings '; end if;
      select count(*) into n from storage.objects where bucket_id = 'item-photos'; if n > 0 then s := s || 'photos '; end if;
      select count(*) into n from profiles where id <> who; if n > 0 then s := s || 'other-staff '; end if;
      update profiles set is_active = true where id = who; get diagnostics n = row_count; if n > 0 then s := s || 'self-reactivated '; end if;
      update profiles set full_name = full_name || ' x' where id = who; get diagnostics n = row_count; if n > 0 then s := s || 'self-renamed '; end if;
      update customers set address = address where true; get diagnostics n = row_count; if n > 0 then s := s || 'customer-update '; end if;
      begin perform ctm_assert_role(array['operator', 'cashier', 'appraiser']::staff_role[]); s := s || 'assert-passed '; exception when others then null; end;
      execute 'reset role';
    end loop;
    outcome := case when s = '' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'U2 Admins: demoting or deactivating other Admins works until one is left; the last active Admin can''t be demoted, deactivated or deleted (also by the system); nobody can remove their own Admin rights; the check takes the lock';
  begin
    s := '';
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin update profiles set role = 'operator' where id = adm; s := s || 'self-demote-ok '; exception when others then if sqlerrm not like '%your own account%' then s := s || 'wrong:' || sqlerrm || ' '; end if; end;
    begin update profiles set is_active = false where id = adm; s := s || 'self-deactivate-ok '; exception when others then null; end;
    update profiles set role = 'operator' where id = adm2; get diagnostics n = row_count;
    ok := exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid());
    update profiles set is_active = false where id = adm3; get diagnostics n2 = row_count;
    if n <> 1 or n2 <> 1 then s := s || 'others-not-changed '; end if;
    if not ok then s := s || 'no-lock '; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true); -- no session from here on (a system job)
    -- adm is now the only active Admin: the system (no session) can't remove them either
    begin update profiles set role = 'cashier' where id = adm; s := s || 'last-demoted '; exception when others then if sqlerrm not like '%At least one active Admin%' then s := s || 'wrong:' || sqlerrm || ' '; end if; end;
    begin update profiles set is_active = false where id = adm; s := s || 'last-deactivated '; exception when others then null; end;
    begin delete from profiles where id = adm; s := s || 'last-deleted '; exception when others then if sqlerrm not like '%At least one active Admin%' then s := s || 'wrong-delete:' || left(sqlerrm, 60) || ' '; end if; end;
    -- making someone else Admin again lets the change through
    update profiles set role = 'admin' where id = adm2;
    update profiles set role = 'cashier' where id = adm; get diagnostics n = row_count; if n <> 1 then s := s || 'blocked-with-another-admin '; end if;
    outcome := case when s = '' and (select count(*) from profiles where role = 'admin' and is_active) = 1 then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'U3 A change made from an old page (an older updated_at) changes 0 rows; with the current updated_at it changes 1 row and moves updated_at on';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    select count(*) into n from profiles where id = op;
    update profiles set full_name = full_name || ' (A)' where id = op and updated_at = (select updated_at from profiles where id = op); get diagnostics n = row_count;
    update profiles set is_active = false where id = op and updated_at = (select updated_at - interval '1 second' from profiles where id = op); get diagnostics n2 = row_count;
    execute 'reset role';
    outcome := case when n = 1 and n2 = 0 and (select is_active from profiles where id = op) then 'PASS' else 'FAIL first=' || n || ' stale=' || n2 end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'U4 An active Admin records a staff event: the actor is the session''s Admin and it is in the audit log; a Cashier, a deactivated Admin and a direct insert are refused; unknown actions and notes over 300 characters are refused';
  begin
    s := '';
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform record_staff_account_event(csh, 'password_reset', null);
    execute 'reset role';
    select count(*) into n from staff_account_events where profile_id = csh and action = 'password_reset' and actor = adm;
    if n <> 1 then s := s || 'not-saved '; end if;
    select count(*) into n from audit_log where table_name = 'staff_account_events' and actor = adm and action = 'INSERT' and changed_data->>'profile_id' = csh::text;
    if n <> 1 then s := s || 'no-audit-log '; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', csh, 'role', 'authenticated')::text, true);
    begin perform record_staff_account_event(op, 'password_reset', null); s := s || 'cashier-ok '; exception when others then null; end;
    begin insert into staff_account_events (profile_id, action, actor) values (op, 'password_reset', csh); s := s || 'direct-insert-ok '; exception when others then null; end;
    select count(*) into n from staff_account_events; if n > 0 then s := s || 'cashier-reads-events '; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin perform record_staff_account_event(op, 'password_was_Ctm-1234', null); s := s || 'bad-action-ok '; exception when others then null; end;
    begin perform record_staff_account_event(op, 'login_block_failed', repeat('x', 400)); exception when others then s := s || 'long-note-error '; end;
    select count(*) into n from staff_account_events where profile_id = op and char_length(note) = 300; if n <> 1 then s := s || 'note-not-cut '; end if;
    execute 'reset role';
    update profiles set is_active = false where id = adm2;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm2, 'role', 'authenticated')::text, true);
    begin perform record_staff_account_event(op, 'password_reset', null); s := s || 'inactive-admin-ok '; exception when others then null; end;
    execute 'reset role';
    outcome := case when s = '' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'Nothing outside the tests changed (staff names, roles and status; staff events)';
  outcome := case when (select md5(string_agg(id::text || full_name || role || is_active, ',' order by id)) from profiles) = fp_profiles
                   and (select count(*) from staff_account_events) = fp_events then 'PASS' else 'FAIL something changed after the tests' end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0084() from public, anon, authenticated;

-- applied only if these self-tests pass (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0084' t, * from public.ctm_selftest_0084()
    union all select '0075' t, * from public.ctm_selftest_0075()
    union all select '0038' t, * from public.ctm_selftest_0038()
    union all select 'audit' t, * from public.ctm_selftest_audit()
    union all select '0070' t, * from public.ctm_selftest_0070()
    union all select '0076' t, * from public.ctm_selftest_0076()   -- quick search (Matt, 0076/0077)
    union all select '0078' t, * from public.ctm_selftest_0078()   -- penalty waivers (Matt, 0078-0080)
    union all select '0081' t, * from public.ctm_selftest_0081()) z -- penalty consistency (Matt, 0081)
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0084 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
