-- 0037 (Nov 10, 2026, Wush): Batch 6 of Matt's list.
-- #25 (rest): clean up item photos that were uploaded but never saved with an appraisal.
--   a) the person who uploaded a photo may delete it while it is not attached to any appraisal (the Remove button)
--   b) ctm_unused_photos() lists unattached photos older than 24 hours, so the server can delete them
--      (files must be deleted through the Storage API: Supabase refuses a direct "delete from storage.objects")
-- #22: rate limiting. ctm_rate_check('search' | 'save') counts what one staff account does each minute and
--      answers false when it is over the limit: 60 searches or 30 saves a minute (owner decision, Nov 10).
-- Existing data: nothing changes. One new table (ctm_rate_counters), which starts empty.
-- Self-test: select * from public.ctm_selftest_0037();   (every test rolls back)

-- 1. #25 is this photo attached to an appraisal? (archived appraisals count too: their photos are kept)
--    SECURITY DEFINER so the storage rule below gets the same answer for every role.
create function public.ctm_photo_in_use(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.appraisal_items a where p_name = any(a.photo_paths))
$$;
revoke execute on function public.ctm_photo_in_use(text) from public, anon;
grant execute on function public.ctm_photo_in_use(text) to authenticated, service_role;

-- a) the Remove button: you may delete a photo only if YOU uploaded it and it is not attached to any appraisal.
--    Once an appraisal is saved with the photo, nobody can delete it this way.
create policy "item-photos: uploader can delete own unattached photo"
  on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos' and owner_id = (select auth.uid())::text and not public.ctm_photo_in_use(name));

-- b) the list for the server's clean-up: unattached photos older than the given age (24 hours by default,
--    so a photo on a form that is still open is never touched). Server only (service role).
create function public.ctm_unused_photos(p_older_than interval default interval '24 hours')
returns table(name text)
language sql stable security definer set search_path = public as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'item-photos'
    and o.created_at < now() - greatest(p_older_than, interval '1 hour') -- never younger than 1 hour, whatever is asked
    and not public.ctm_photo_in_use(o.name)
  order by o.created_at
  limit 200
$$;
revoke execute on function public.ctm_unused_photos(interval) from public, anon, authenticated;
grant execute on function public.ctm_unused_photos(interval) to service_role;

-- 2. #22 the counters: one row per account, kind of action and minute. Nobody reads or writes it directly
--    (RLS on, no policies); only ctm_rate_check() below does.
create table public.ctm_rate_counters (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('search', 'save')),
  window_start timestamptz not null, -- the start of the minute being counted
  count integer not null default 1,
  primary key (user_id, kind, window_start)
);
alter table public.ctm_rate_counters enable row level security;
revoke all on public.ctm_rate_counters from anon, authenticated;

-- adds 1 to this account's counter for the current minute and says if the action may go ahead.
-- true = allowed, false = over the limit ("Too many requests. Wait a minute, then try again.").
create function public.ctm_rate_check(p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lim integer;
  n integer;
begin
  if uid is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  -- the limits for one account in one minute (owner decision, Nov 10, 2026)
  lim := case p_kind when 'search' then 60 when 'save' then 30 end;
  if lim is null then raise exception 'Unknown kind of action: %', p_kind; end if;
  -- add 1 to this minute's row (or start it). "on conflict" keeps two requests at the same moment correct
  insert into public.ctm_rate_counters as c (user_id, kind, window_start)
  values (uid, p_kind, date_trunc('minute', now()))
  on conflict (user_id, kind, window_start) do update set count = c.count + 1
  returning c.count into n;
  -- tidy up: this account's old minutes aren't needed any more (only on the first action of a minute)
  if n = 1 then
    delete from public.ctm_rate_counters where user_id = uid and window_start < now() - interval '10 minutes';
  end if;
  return n <= lim;
end $$;
revoke execute on function public.ctm_rate_check(text) from public, anon;
grant execute on function public.ctm_rate_check(text) to authenticated;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0037() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  i int; n int; ok boolean; s text; attached text; loose text; loose_owner uuid;
begin
  test := '#22 a cashier gets 30 saves in a minute, the 31st is refused; another account is not affected';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    n := 0;
    for i in 1..30 loop if ctm_rate_check('save') then n := n + 1; end if; end loop;
    ok := ctm_rate_check('save'); -- the 31st
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    s := case when ctm_rate_check('save') then 'other account allowed' else 'other account blocked' end;
    execute 'reset role';
    outcome := case when n = 30 and not ok and s = 'other account allowed' then 'PASS' else 'FAIL allowed=' || n || ' 31st=' || ok || ' ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#22 60 searches in a minute are allowed, the 61st is refused; searches and saves are counted apart';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    n := 0;
    for i in 1..60 loop if ctm_rate_check('search') then n := n + 1; end if; end loop;
    ok := ctm_rate_check('search'); -- the 61st
    s := case when ctm_rate_check('save') then 'save still allowed' else 'save blocked' end;
    execute 'reset role';
    outcome := case when n = 60 and not ok and s = 'save still allowed' then 'PASS' else 'FAIL allowed=' || n || ' 61st=' || ok || ' ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#22 staff cannot read or change the counters directly, and an unknown kind is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform 1 from ctm_rate_counters limit 1; s := 'read allowed';
    exception when insufficient_privilege then s := 'read refused'; end;
    begin perform ctm_rate_check('other'); s := s || '/kind allowed';
    exception when others then s := s || case when sqlerrm like 'Unknown kind%' then '/kind refused' else '/' || sqlerrm end; end;
    execute 'reset role';
    outcome := case when s = 'read refused/kind refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  -- one photo that is attached to an appraisal, and one that is not (if there is one)
  select o.name into attached from storage.objects o where o.bucket_id = 'item-photos' and ctm_photo_in_use(o.name) limit 1;
  select o.name, o.owner_id::uuid into loose, loose_owner from storage.objects o where o.bucket_id = 'item-photos' and not ctm_photo_in_use(o.name) and o.owner_id is not null limit 1;

  test := '#25 an attached photo counts as in use and is never on the clean-up list; staff cannot call the list';
  begin
    select count(*) into n from ctm_unused_photos(interval '1 hour') u where ctm_photo_in_use(u.name);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform 1 from ctm_unused_photos(); s := 'allowed';
    exception when insufficient_privilege then s := 'refused'; end;
    execute 'reset role';
    outcome := case when attached is null then 'SKIP (no attached photos)'
                    when ctm_photo_in_use(attached) and not ctm_photo_in_use('selftest-no-such-file.jpg') and n = 0 and s = 'refused' then 'PASS'
                    else 'FAIL in_list=' || n || ' staff=' || s end;
  exception when others then execute 'reset role'; outcome := 'FAIL ' || sqlerrm; end;
  return next;

  test := '#25 the delete rule: only the uploader, and only while the photo is not attached to an appraisal';
  begin
    -- Supabase stops every direct "delete from storage.objects" before a rule is even looked at (files must go through
    -- the Storage API), so a real delete can't be tried here. This checks that the rule exists and what it answers.
    -- The real thing (Remove on the appraisal form) was tested through the app.
    select count(*) into n from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd = 'DELETE'
      and p.policyname = 'item-photos: uploader can delete own unattached photo'
      and p.qual like '%item-photos%' and p.qual like '%owner_id%' and p.qual like '%ctm_photo_in_use%';
    select count(*) into i from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd = 'DELETE'; -- no other delete rule
    if attached is null or loose is null then
      outcome := case when n = 1 and i = 1 then 'PASS (rule in place; no unattached photo to try it on)' else 'FAIL rule=' || n || ' delete rules=' || i end;
    else
      -- the same question the rule asks, for three cases: uploader + unattached, uploader + attached, someone else + unattached
      select (o.owner_id = loose_owner::text and not ctm_photo_in_use(o.name))::text into s from storage.objects o where o.bucket_id = 'item-photos' and o.name = loose;
      select s || '/' || (o.owner_id = loose_owner::text and not ctm_photo_in_use(o.name))::text into s from storage.objects o where o.bucket_id = 'item-photos' and o.name = attached;
      select s || '/' || (o.owner_id = cash_id::text and loose_owner <> cash_id and not ctm_photo_in_use(o.name))::text into s from storage.objects o where o.bucket_id = 'item-photos' and o.name = loose;
      outcome := case when n = 1 and i = 1 and s = 'true/false/false' then 'PASS' else 'FAIL rule=' || n || ' delete rules=' || i || ' answers=' || s end;
    end if;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0037() from public, anon, authenticated;
