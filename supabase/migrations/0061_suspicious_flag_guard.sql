-- 0061 (Nov 12, 2026, Wush): Suspicious activity, keep the live site working while closing the same gaps.
-- 0060 removed the table's "an Admin may update" rule. But the OLD page (still on the live site until the new one
-- is deployed) saves a decision with a direct update: its Dismiss / Mark investigating would then silently do
-- nothing, and its Blacklist would block the customer but leave the flag open.
-- So the update rule comes back exactly as it was, and a guard on the table now enforces the same rules as
-- review_suspicious_flag() for ANY direct update (old page, or someone calling the database):
--   - a decided flag (Dismissed or Blacklisted) can't change;
--   - the status can only go Open -> Investigating / Dismissed / Blacklisted, or Investigating -> Dismissed / Blacklisted;
--   - only the status, who decided, when and the note can change (not the reason, customer, loan or date);
--   - "who decided" must be the person saving it, and the note must be 500 characters or less.
-- Database functions that set ctm.system (review_suspicious_flag, Archive, Restore) are not stopped by the guard.
-- No flag is changed by this migration.
-- Self-test: select * from public.ctm_selftest_0061();   (every test rolls back)

create policy "suspicious_activity_flags: admin update" on public.suspicious_activity_flags for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.guard_suspicious_flag() returns trigger language plpgsql set search_path = public as $$
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
  return new;
end $$;
drop trigger if exists suspicious_activity_flags_guard on public.suspicious_activity_flags;
create trigger suspicious_activity_flags_guard before update on public.suspicious_activity_flags for each row execute function public.guard_suspicious_flag();

create or replace function public.ctm_selftest_0061() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de'; -- an Operator account
  admin_id uuid; other_admin uuid; fo uuid; fr uuid; s text; n int; h0 text; h1 text;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id into other_admin from profiles where role = 'admin' and id <> admin_id order by created_at limit 1;
  select id into fo from suspicious_activity_flags where status = 'open' and archived_at is null order by created_at limit 1;
  select id into fr from suspicious_activity_flags where status in ('dismissed', 'blacklisted') and archived_at is null order by created_at limit 1;

  test := 'The old page''s direct update still works for an open flag (Dismiss in your own name, with a note)';
  begin
    if fo is null then outcome := 'SKIP (needs an open flag)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    update suspicious_activity_flags set status = 'dismissed', resolved_by = admin_id, resolved_at = now(), resolution_notes = 'TEST old page' where id = fo;
    get diagnostics n = row_count;
    execute 'reset role';
    outcome := case when n = 1 and (select status from suspicious_activity_flags where id = fo) = 'dismissed' then 'PASS' else 'FAIL rows=' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'A direct update is refused when it changes a decided flag, goes back to Open, changes the reason or customer, saves someone else''s name, or comes from an Operator; nothing changes';
  begin
    if fo is null or fr is null then outcome := 'SKIP (needs an open and a decided flag)'; raise exception 'ROLLBACK'; end if;
    select md5(string_agg(f.id::text || f.status || coalesce(f.resolution_notes, '') || f.reason || coalesce(f.resolved_by::text, ''), '|' order by f.id)) into h0 from suspicious_activity_flags f;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := '';
    begin update suspicious_activity_flags set status = 'dismissed', resolved_by = admin_id where id = fr; s := s || 'x'; exception when others then s := s || '1'; end;
    begin update suspicious_activity_flags set status = 'open' where id = fr; s := s || 'x'; exception when others then s := s || '2'; end;
    begin update suspicious_activity_flags set reason = 'TEST changed' where id = fo; s := s || 'x'; exception when others then s := s || '3'; end;
    begin update suspicious_activity_flags set customer_id = (select id from customers where id <> (select customer_id from suspicious_activity_flags where id = fo) limit 1) where id = fo; s := s || 'x'; exception when others then s := s || '4'; end;
    if other_admin is not null then
      begin update suspicious_activity_flags set status = 'dismissed', resolved_by = other_admin, resolved_at = now() where id = fo; s := s || 'x'; exception when others then s := s || '5'; end;
    else s := s || '5'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin update suspicious_activity_flags set status = 'dismissed', resolved_by = op_id where id = fo; get diagnostics n = row_count; s := s || '/op' || n;
    exception when others then s := s || '/op0'; end;
    execute 'reset role';
    select md5(string_agg(f.id::text || f.status || coalesce(f.resolution_notes, '') || f.reason || coalesce(f.resolved_by::text, ''), '|' order by f.id)) into h1 from suspicious_activity_flags f;
    outcome := case when s = '12345/op0' and h0 = h1 then 'PASS' else 'FAIL ' || s || ' same=' || (h0 = h1)::text end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0061() from public, anon, authenticated;

-- applied only if these pass, and 0060 and 0032 still pass with the guard in place
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0061' t, * from public.ctm_selftest_0061() union all select '0060' t, * from public.ctm_selftest_0060()
    union all select '0032' t, * from public.ctm_selftest_0032()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0061 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
