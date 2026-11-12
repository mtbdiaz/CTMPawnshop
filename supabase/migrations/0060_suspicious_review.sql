-- 0060 (Nov 12, 2026, Wush): Suspicious activity, a decision is saved in ONE step and can't overwrite another one.
-- No flag and no customer is changed by this migration.
-- What was wrong:
--   1. Two Admins could overwrite each other. If one blacklisted a flag and another, on an older screen, pressed
--      Dismiss, the flag ended up "Dismissed" while the customer stayed blacklisted. Nothing checked that the flag
--      was still open.
--   2. Blacklist was two separate saves (the customer first, then the flag). If the second failed, the customer was
--      blocked but the flag still said Open.
--   3. The only rule on the table was "an Admin may update", so an Admin calling the database directly could reopen
--      a decided flag, or change its reason, customer or decision maker.
--   4. Blacklisting replaced the customer's existing blacklist reason (e.g. "Presented a fake ID") with a generic one.
-- What this adds:
--   - review_suspicious_flag(): the only way to decide a flag. Admin only. Locks the flag, refuses a flag that was
--     already decided (and says who decided it and when), allows Open -> Investigating, and Open or Investigating ->
--     Dismissed or Blacklisted. Blacklisting the customer and closing the flag happen together or not at all. A
--     customer who is already blacklisted keeps their own reason. The same fields are saved as before (status, who,
--     when, note).
--   - The table's UPDATE rule is removed, so a direct update is refused for every role. Archive / Restore (Admin)
--     still work, they run as database functions. (0061 puts the rule back with a guard, so the old page on the
--     live site keeps working until the new one is deployed.)
--   - suspicious_flag_page(): the list for the page (Admin only), with the tab counts, search, the Open /
--     Investigating filter and 10 rows a page, and for each flag: the customer, the loan the flag was saved with,
--     and, for the automatic "many loans" rule only, how many loans the customer opened in the 24 hours up to the
--     flag, counted from the loan records.
-- Self-test: select * from public.ctm_selftest_0060();   (every test rolls back)

-- the reason text the automatic rule in create_pawn_loan writes (PB-32 placeholder: 3 or more loans in 24 hours)
create or replace function public.ctm_flag_rule_reason() returns text language sql immutable as
$$ select 'Unusually high number of loans opened by this customer in a short window'::text $$;

-- ---------- 1. deciding a flag ----------
create or replace function public.review_suspicious_flag(p_flag uuid, p_decision text, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f public.suspicious_activity_flags; who text; v_notes text := nullif(btrim(coalesce(p_notes, '')), ''); v_bl boolean;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only (the same as before)
  if p_decision is null or p_decision not in ('investigating', 'dismissed', 'blacklisted') then raise exception 'Pick a decision: Mark investigating, Dismiss or Blacklist.'; end if;
  if char_length(coalesce(v_notes, '')) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  select * into f from public.suspicious_activity_flags where id = p_flag for update; -- the lock: two Admins can't decide it at the same moment
  if not found or f.archived_at is not null then raise exception 'Flag not found. Reload the page.'; end if;
  if f.status not in ('open', 'investigating') then
    select full_name into who from public.profiles where id = f.resolved_by;
    raise exception 'This flag was already decided: % on % by %. Reload the page.', initcap(f.status::text),
      to_char(f.resolved_at at time zone 'Asia/Manila', 'Mon FMDD, YYYY HH12:MI AM'), coalesce(who, 'another Admin');
  end if;
  if p_decision = 'investigating' and f.status = 'investigating' then raise exception 'This flag is already being investigated. Reload the page.'; end if;

  -- blacklist and the flag together: if one fails, neither is saved
  if p_decision = 'blacklisted' and f.customer_id is not null then
    select is_blacklisted into v_bl from public.customers where id = f.customer_id for update;
    if not coalesce(v_bl, false) then -- a customer who is already blacklisted keeps their own reason
      update public.customers set is_blacklisted = true, blacklist_reason = 'Blacklisted following suspicious activity review' where id = f.customer_id;
    end if;
  end if;
  perform set_config('ctm.system', 'on', true);
  update public.suspicious_activity_flags
     set status = p_decision::public.suspicious_flag_status, resolved_by = auth.uid(), resolved_at = now(), resolution_notes = v_notes
   where id = f.id;
  return jsonb_build_object('status', p_decision, 'customer_id', f.customer_id);
end $$;
revoke all on function public.review_suspicious_flag(uuid, text, text) from public, anon;
grant execute on function public.review_suspicious_flag(uuid, text, text) to authenticated;

-- ---------- 2. no direct edits of a flag ----------
drop policy if exists "suspicious_activity_flags: admin update" on public.suspicious_activity_flags;

-- ---------- 3. the list for the page ----------
create or replace function public.suspicious_flag_page(p_view text default 'open', p_q text default null, p_status text default null,
  p_page integer default 1, p_size integer default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_size int := least(greatest(coalesce(p_size, 10), 5), 100);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_like text; v_cno int; res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only (the page is Admin only)
  if p_view not in ('open', 'resolved') then raise exception 'Unknown view.'; end if;
  if p_status is not null and p_status not in ('open', 'investigating') then raise exception 'Unknown filter.'; end if;
  if v_q is not null then
    v_q := left(v_q, 80);
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; -- typed % or _ are plain letters
    if v_q ~* '^c[\s-]?\d{1,9}$' then v_cno := regexp_replace(v_q, '\D', '', 'g')::int; end if; -- "C-0012" = customer 12
  end if;
  with base as (
    select f.id, f.status::text as status, f.reason, f.created_at, f.resolved_at, f.resolution_notes, rp.full_name as resolved_by_name,
           f.customer_id, c.full_name as customer_name, c.customer_no, c.is_blacklisted as customer_blacklisted, c.blacklist_reason,
           f.loan_id, l.ticket_number, l.principal_amount as loan_principal, l.created_at as loan_created_at, l.status::text as loan_status,
           (f.reason = public.ctm_flag_rule_reason()) as rule_flag,
           -- for the automatic rule only: the loans this customer opened in the 24 hours up to the flag (+1 minute:
           -- the flag is saved in the same moment as the loan)
           case when f.reason = public.ctm_flag_rule_reason() then
             (select count(*) from public.loans x where x.customer_id = f.customer_id and x.created_at > f.created_at - interval '24 hours' and x.created_at <= f.created_at + interval '1 minute') end as loans_24h,
           case when f.reason = public.ctm_flag_rule_reason() then
             (select coalesce(sum(x.principal_amount), 0) from public.loans x where x.customer_id = f.customer_id and x.created_at > f.created_at - interval '24 hours' and x.created_at <= f.created_at + interval '1 minute') end as loans_24h_sum
    from public.suspicious_activity_flags f
    left join public.customers c on c.id = f.customer_id
    left join public.loans l on l.id = f.loan_id
    left join public.profiles rp on rp.id = f.resolved_by
    where f.archived_at is null
  ), filtered as (
    select * from base b
    where case when p_view = 'open' then b.status in ('open', 'investigating') else b.status in ('dismissed', 'blacklisted') end
      and (p_status is null or b.status = p_status)
      and (v_q is null or b.customer_name ilike v_like or b.customer_no = v_cno or b.ticket_number ilike v_like or b.reason ilike v_like)
  )
  select jsonb_build_object(
    'counts', (select jsonb_build_object(
        'open', count(*) filter (where status = 'open'),
        'investigating', count(*) filter (where status = 'investigating'),
        'needs_review', count(*) filter (where status in ('open', 'investigating')),
        'resolved', count(*) filter (where status in ('dismissed', 'blacklisted'))) from base),
    'rule_reason', public.ctm_flag_rule_reason(),
    'total', (select count(*) from filtered),
    'page', v_page, 'size', v_size,
    'rows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from (
        select y.*, row_number() over (order by case when p_view = 'resolved' then y.resolved_at end desc nulls last, y.created_at desc, y.id) as ord
        from filtered y
        order by case when p_view = 'resolved' then y.resolved_at end desc nulls last, y.created_at desc, y.id
        offset (v_page - 1) * v_size limit v_size) x)
  ) into res;
  return res;
end $$;
revoke all on function public.suspicious_flag_page(text, text, text, integer, integer) from public, anon;
grant execute on function public.suspicious_flag_page(text, text, text, integer, integer) to authenticated;

-- ---------- 4. self-test ----------
create or replace function public.ctm_selftest_0060() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  admin_id uuid; admin2 uuid; fo uuid; fo2 uuid; fi uuid; fr uuid; cust uuid; s text; n int; r jsonb; bl_reason text; h0 text; h1 text;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id into admin2 from profiles where role = 'admin' and is_active and id <> admin_id order by created_at limit 1;
  select f.id into fo from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'open' and f.archived_at is null and not c.is_blacklisted order by f.created_at limit 1;
  select f.id into fo2 from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'open' and f.archived_at is null and not c.is_blacklisted and f.id <> fo order by f.created_at limit 1;
  select id into fi from suspicious_activity_flags where status = 'investigating' and archived_at is null order by created_at limit 1;
  select id into fr from suspicious_activity_flags where status in ('dismissed', 'blacklisted') and archived_at is null order by created_at limit 1;

  test := 'Steps: Open can go to Investigating, Dismissed or Blacklisted; Investigating can go to Dismissed or Blacklisted but not Investigating again; a decided flag can''t change; a bad decision or a note over 500 characters is refused';
  begin
    if fo is null or fi is null or fr is null then outcome := 'SKIP (needs an open, an investigating and a decided flag)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := '';
    begin perform review_suspicious_flag(fo, 'reopen'); s := s || 'x'; exception when others then s := s || '1'; end;
    begin perform review_suspicious_flag(fo, 'dismissed', repeat('x', 501)); s := s || 'x'; exception when others then s := s || '2'; end;
    begin perform review_suspicious_flag(fi, 'investigating'); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%already being investigated%' then '3' else sqlerrm end; end;
    begin perform review_suspicious_flag(fr, 'dismissed'); s := s || 'x'; exception when others then s := s || case when sqlerrm like 'This flag was already decided:%' then '4' else sqlerrm end; end;
    perform review_suspicious_flag(fo, 'investigating', 'TEST checking with the customer');
    s := s || '|' || (select status || ',' || (resolved_by = admin_id) || ',' || resolution_notes from suspicious_activity_flags where id = fo);
    perform review_suspicious_flag(fo, 'dismissed', '  ');
    s := s || '|' || (select status || ',' || (resolution_notes is null) from suspicious_activity_flags where id = fo);
    begin perform review_suspicious_flag(fo, 'blacklisted'); s := s || '/changed after dismiss'; exception when others then s := s || '/5'; end;
    execute 'reset role';
    outcome := case when s = '1234|investigating,true,TEST checking with the customer|dismissed,true/5' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Two Admins: after one blacklists, the other''s Dismiss (from an older screen) is refused and says who decided; the flag stays Blacklisted and the customer stays blocked';
  begin
    if fo is null then outcome := 'SKIP (needs an open flag)'; raise exception 'ROLLBACK'; end if;
    select customer_id into cust from suspicious_activity_flags where id = fo;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform review_suspicious_flag(fo, 'blacklisted', 'TEST first admin');
    perform set_config('request.jwt.claims', json_build_object('sub', coalesce(admin2, admin_id), 'role', 'authenticated')::text, true);
    s := '';
    begin perform review_suspicious_flag(fo, 'dismissed', 'TEST second admin'); s := s || 'overwritten';
    exception when others then s := s || case when sqlerrm like 'This flag was already decided: Blacklisted%' then 'refused' else sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || (select status || ',' || resolution_notes from suspicious_activity_flags where id = fo) || '|' || (select is_blacklisted || ',' || blacklist_reason from customers where id = cust);
    outcome := case when s = 'refused|blacklisted,TEST first admin|true,Blacklisted following suspicious activity review' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Blacklist: a refused decision saves nothing (the customer is not blacklisted and the flag stays open); a customer already blacklisted keeps their own reason';
  begin
    if fo is null or fo2 is null then outcome := 'SKIP (needs two open flags)'; raise exception 'ROLLBACK'; end if;
    select customer_id into cust from suspicious_activity_flags where id = fo;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := '';
    -- a refused Blacklist (note too long) must leave both the customer and the flag as they were
    begin perform review_suspicious_flag(fo, 'blacklisted', repeat('y', 501)); s := s || 'saved'; exception when others then s := s || 'refused'; end;
    execute 'reset role';
    s := s || ',' || (select is_blacklisted from customers where id = cust)::text || ',' || (select status from suspicious_activity_flags where id = fo);
    -- already blacklisted customer
    select customer_id into cust from suspicious_activity_flags where id = fo2;
    perform set_config('ctm.system', 'on', true);
    update customers set is_blacklisted = true, blacklist_reason = 'TEST presented a fake ID' where id = cust;
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform review_suspicious_flag(fo2, 'blacklisted');
    execute 'reset role';
    s := s || '|' || (select blacklist_reason from customers where id = cust) || ',' || (select status from suspicious_activity_flags where id = fo2);
    outcome := case when s = 'refused,false,open|TEST presented a fake ID,blacklisted' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Roles and direct writes: Operator and Cashier can''t decide or read the list; nobody, not even an Admin, can change a flag directly (0 rows); flags and customers are unchanged';
  begin
    if fo is null then outcome := 'SKIP (needs an open flag)'; raise exception 'ROLLBACK'; end if;
    select md5(string_agg(f.id::text || f.status || coalesce(f.resolution_notes, '') || f.reason || coalesce(f.customer_id::text, ''), '|' order by f.id)) into h0 from suspicious_activity_flags f;
    execute 'set local role authenticated';
    s := '';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform review_suspicious_flag(fo, 'dismissed'); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '1' else '?' end; end;
    begin perform suspicious_flag_page(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '2' else '?' end; end;
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform review_suspicious_flag(fo, 'blacklisted'); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '3' else '?' end; end;
    begin perform suspicious_flag_page(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '4' else '?' end; end;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin update suspicious_activity_flags set status = 'open', reason = 'TEST changed' where id = coalesce(fr, fo); get diagnostics n = row_count; s := s || '/a' || n;
    exception when others then s := s || '/a0'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin update suspicious_activity_flags set status = 'dismissed' where id = fo; get diagnostics n = row_count; s := s || '/o' || n;
    exception when others then s := s || '/o0'; end;
    execute 'reset role';
    select md5(string_agg(f.id::text || f.status || coalesce(f.resolution_notes, '') || f.reason || coalesce(f.customer_id::text, ''), '|' order by f.id)) into h1 from suspicious_activity_flags f;
    outcome := case when s = '1234/a0/o0' and h0 = h1 then 'PASS' else 'FAIL ' || s || ' same=' || (h0 = h1)::text end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  execute 'reset role'; return next;

  test := 'The list: tab counts equal the table; Open + Investigating = Needs review; search by name, C-number and ticket finds the flag; the 24-hour loan count is given only for the automatic rule and matches the loan records';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := suspicious_flag_page('open', null, null, 1, 100);
    s := ((r->'counts'->>'needs_review')::int = (select count(*) from suspicious_activity_flags where archived_at is null and status in ('open', 'investigating')))::text
      || ',' || ((r->'counts'->>'resolved')::int = (select count(*) from suspicious_activity_flags where archived_at is null and status in ('dismissed', 'blacklisted')))::text
      || ',' || ((r->'counts'->>'open')::int + (r->'counts'->>'investigating')::int = (r->'counts'->>'needs_review')::int)::text
      || ',' || ((suspicious_flag_page('open', null, 'investigating')->>'total')::int = (r->'counts'->>'investigating')::int)::text
      || ',' || ((suspicious_flag_page('resolved', null, null, 1, 100)->>'total')::int = (r->'counts'->>'resolved')::int)::text;
    if fo is not null then
      s := s || ',' || ((suspicious_flag_page('open', (select c.full_name from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.id = fo))->'rows') @> jsonb_build_array(jsonb_build_object('id', fo)))::text
        || ',' || ((suspicious_flag_page('open', (select 'C-' || lpad(c.customer_no::text, 4, '0') from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.id = fo))->'rows') @> jsonb_build_array(jsonb_build_object('id', fo)))::text
        || ',' || ((suspicious_flag_page('open', (select l.ticket_number from suspicious_activity_flags f join loans l on l.id = f.loan_id where f.id = fo))->'rows') @> jsonb_build_array(jsonb_build_object('id', fo)))::text;
    end if;
    s := s || ',' || (select bool_and(case when (e->>'rule_flag')::boolean then (e->>'loans_24h') is not null else (e->>'loans_24h') is null end) from jsonb_array_elements(r->'rows') e)::text
      || ',' || coalesce((select bool_and((e->>'loans_24h')::int = (select count(*) from loans x where x.customer_id = (e->>'customer_id')::uuid
            and x.created_at > (e->>'created_at')::timestamptz - interval '24 hours' and x.created_at <= (e->>'created_at')::timestamptz + interval '1 minute'))
          from jsonb_array_elements(r->'rows') e where (e->>'rule_flag')::boolean), true)::text
      || ',' || ((suspicious_flag_page('open', '%')->>'total')::int = 0)::text;
    execute 'reset role';
    outcome := case when s not like '%false%' then 'PASS' else 'FAIL ' || s end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0060() from public, anon, authenticated;

-- applied only if these pass (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0060' t, * from public.ctm_selftest_0060() union all select '0032' t, * from public.ctm_selftest_0032()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0060 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
