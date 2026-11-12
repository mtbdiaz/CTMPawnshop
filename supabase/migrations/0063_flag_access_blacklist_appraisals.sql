-- 0063 (Nov 12, 2026, Wush): Suspicious activity, who can read flags; the blacklist also blocks new appraisals;
-- and the old page on the live site can't leave a blocked customer with an open flag.
-- No flag, customer, appraisal or loan is changed by this migration.
--
-- 1. Reading flags. The rule was "any signed-in staff can read every flag" (a leftover from the first version).
--    Every page that reads flags is Admin only (Suspicious activity, the Dashboard's open-flag count, the
--    Compliance report, Archive), and create_pawn_loan / review_suspicious_flag / suspicious_flag_page / archive /
--    restore are database functions that don't depend on this rule. So: Admins only. Signed-out visitors (anon)
--    lose the table grant too (before, they got 0 rows from the rule; now the database refuses outright).
--
-- 2. Blacklist and appraisals. SAD UC5: "Loan or appraisal request initiated ... If blacklisted, system prevents
--    transaction and shows reason." Only new loans were blocked (create_pawn_loan). Now a new appraisal for a
--    blacklisted customer is refused, and so is moving an unpawned appraisal onto a blacklisted customer
--    (set_appraisal_customer). This applies to every save, including database functions. Appraisals and loans the
--    customer already has are not touched: they can still be paid, renewed and redeemed.
--
-- 3. The old page on the live site (until the new one is deployed). Its Blacklist saves the customer first
--    (reason "Blacklisted following suspicious activity review"), then the flag. With 0062 the second save could be
--    refused (no reason), leaving a blocked customer and an open flag. Now:
--    - the flag save is accepted when the customer is already blacklisted, and the note says it came from the old
--      page without a reason (so the two always agree);
--    - the old page's customer save is refused when the customer has no Open or Investigating flag any more (another
--      Admin decided it), so it can't block a customer for a flag that is already closed;
--    - if the customer was already blacklisted, the old page keeps their own reason instead of replacing it.
--    The old page's Dismiss without a reason is still refused (one save, nothing else changes, so nothing disagrees).
--    After the new page is deployed, a later migration removes the direct-update rule and these old-page allowances.
-- Self-test: select * from public.ctm_selftest_0063();   (every test rolls back)

-- ---------- 1. flags: Admins only ----------
drop policy if exists "suspicious_activity_flags: staff select" on public.suspicious_activity_flags;
create policy "suspicious_activity_flags: admin select" on public.suspicious_activity_flags for select to authenticated using (public.is_admin());
revoke all on public.suspicious_activity_flags from anon;

-- ---------- 2. no new appraisal for a blacklisted customer ----------
create or replace function public.guard_appraisal_blacklist() returns trigger language plpgsql security definer set search_path = public as $$
declare v_bl boolean; v_reason text;
begin
  -- an update that keeps the same customer (status, archive, notes...) is never stopped: existing appraisals stay usable
  if tg_op = 'UPDATE' and new.customer_id is not distinct from old.customer_id then return new; end if;
  if new.customer_id is null then return new; end if;
  select is_blacklisted, blacklist_reason into v_bl, v_reason from public.customers where id = new.customer_id;
  if coalesce(v_bl, false) then
    raise exception 'This customer is blacklisted, so new appraisals are blocked. Reason: %', coalesce(v_reason, 'no reason on file') using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists appraisal_items_blacklist_check on public.appraisal_items;
create trigger appraisal_items_blacklist_check before insert or update of customer_id on public.appraisal_items
  for each row execute function public.guard_appraisal_blacklist();

-- ---------- 3a. the flag guard: the old page's Blacklist is accepted once the customer is blocked ----------
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
  if new.status is distinct from old.status and new.status in ('dismissed', 'blacklisted') and not public.ctm_flag_reason_ok(new.resolution_notes) then
    -- 0063: the old page blocks the customer first. Refusing the flag now would leave a blocked customer with an open
    -- flag, so the flag is closed to match, and the note says where it came from.
    if new.status = 'blacklisted' and exists (select 1 from public.customers c where c.id = new.customer_id and c.is_blacklisted) then
      new.resolution_notes := left(coalesce(public.ctm_clean_note(new.resolution_notes) || ' ', '') || '(Saved from the old page, which did not ask for a reason.)', 500);
    else
      raise exception 'Write the reason for this decision (at least 10 characters).' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- ---------- 3b. the old page's customer save ----------
create or replace function public.guard_old_flag_blacklist() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.ctm_is_system() then return new; end if; -- review_suspicious_flag (new page) and other database functions
  -- only the old Suspicious activity page writes exactly this reason
  if new.is_blacklisted and new.blacklist_reason = 'Blacklisted following suspicious activity review'
     and new.blacklist_reason is distinct from old.blacklist_reason then
    if not exists (select 1 from public.suspicious_activity_flags f
                    where f.customer_id = new.id and f.archived_at is null and f.status in ('open', 'investigating')) then
      raise exception 'This flag was already decided by another Admin, so the customer was not blacklisted. Reload the page.' using errcode = 'P0001';
    end if;
    if old.is_blacklisted then new.blacklist_reason := coalesce(old.blacklist_reason, new.blacklist_reason); end if; -- keep their own reason
  end if;
  return new;
end $$;
drop trigger if exists customers_old_flag_page on public.customers;
create trigger customers_old_flag_page before update of is_blacklisted, blacklist_reason on public.customers
  for each row execute function public.guard_old_flag_blacklist();

-- ---------- 4. self-test ----------
create or replace function public.ctm_selftest_0063() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  admin_id uuid; fo uuid; fo2 uuid; fi uuid; cx uuid; cy uuid; cd uuid; item uuid; newitem uuid; s text; n int; total int; h0 text; h1 text;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select f.id into fo from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'open' and f.archived_at is null and not c.is_blacklisted order by f.created_at limit 1;
  select f.id into fo2 from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'open' and f.archived_at is null and not c.is_blacklisted and f.id <> fo and c.id <> (select customer_id from suspicious_activity_flags where id = fo) order by f.created_at limit 1;
  select f.id into fi from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'investigating' and f.archived_at is null and not c.is_blacklisted order by f.created_at limit 1;
  -- a customer (not blacklisted) whose flags are all decided
  select c.id into cd from customers c where not c.is_blacklisted and c.archived_at is null
     and exists (select 1 from suspicious_activity_flags f where f.customer_id = c.id and f.archived_at is null)
     and not exists (select 1 from suspicious_activity_flags f where f.customer_id = c.id and f.archived_at is null and f.status in ('open', 'investigating')) limit 1;
  select c.id into cx from customers c where not c.is_blacklisted and c.archived_at is null order by c.customer_no limit 1;
  select c.id into cy from customers c where not c.is_blacklisted and c.archived_at is null and c.id <> cx order by c.customer_no limit 1;

  test := 'Reading flags: an Admin sees every flag; Operator, Cashier and Appraiser see none; a signed-out visitor is refused; staff can still read customers';
  begin
    select count(*) into total from suspicious_activity_flags;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := 'admin ' || ((select count(*) from suspicious_activity_flags) = total)::text;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    s := s || '/op ' || (select count(*) from suspicious_activity_flags);
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    s := s || '/cash ' || (select count(*) from suspicious_activity_flags) || ',' || ((select count(*) from customers) > 0)::text;
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    s := s || '/appr ' || (select count(*) from suspicious_activity_flags);
    execute 'reset role';
    execute 'set local role anon';
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    begin select count(*) into n from suspicious_activity_flags; s := s || '/anon ' || n; exception when insufficient_privilege then s := s || '/anon refused'; end;
    execute 'reset role';
    outcome := case when s = 'admin true/op 0/cash 0,true/appr 0/anon refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Blacklist blocks new appraisals: a new appraisal for a blacklisted customer and moving an item onto one are refused; a normal customer still works; the customer''s existing appraisals don''t change; a new loan is refused too';
  begin
    if cx is null or cy is null then outcome := 'SKIP (needs two customers)'; raise exception 'ROLLBACK'; end if;
    -- an item the customer brought in before the blacklist (for the loan check below)
    insert into appraisal_items (category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appraised_by, customer_id)
    select category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appr_id, cx from appraisal_items where archived_at is null limit 1
    returning id into item;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); -- only an Admin may blacklist
    perform set_config('ctm.system', 'on', true);
    update customers set is_blacklisted = true, blacklist_reason = 'TEST blocked customer' where id = cx;
    perform set_config('ctm.system', 'off', true);
    select md5(coalesce(string_agg(a.id::text || a.status || coalesce(a.archived_at::text, '') || a.updated_at, '|' order by a.id), '')) into h0 from appraisal_items a where a.customer_id = cx;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    s := '';
    begin
      insert into appraisal_items (category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appraised_by, customer_id)
      select category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appr_id, cx from appraisal_items where archived_at is null limit 1;
      s := s || 'saved';
    exception when others then s := s || case when sqlerrm like 'This customer is blacklisted, so new appraisals are blocked. Reason: TEST blocked customer' then 'refused' else sqlerrm end; end;
    insert into appraisal_items (category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appraised_by, customer_id)
    select category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appr_id, cy from appraisal_items where archived_at is null limit 1
    returning id into newitem;
    s := s || '|normal ' || (newitem is not null)::text;
    begin perform set_appraisal_customer(newitem, cx); s := s || '|moved';
    exception when others then s := s || case when sqlerrm like 'This customer is blacklisted%' then '|move refused' else '|' || sqlerrm end; end;
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform create_pawn_loan(cx, item, 1000::numeric, 'TEST', gen_random_uuid()); s := s || '|loan saved';
    exception when others then s := s || case when sqlerrm ilike '%blacklisted%' then '|loan refused' else '|' || sqlerrm end; end;
    execute 'reset role';
    select md5(coalesce(string_agg(a.id::text || a.status || coalesce(a.archived_at::text, '') || a.updated_at, '|' order by a.id), '')) into h1 from appraisal_items a where a.customer_id = cx;
    s := s || '|existing ' || case when h0 = h1 then 'same' else 'changed' end;
    outcome := case when s = 'refused|normal true|move refused|loan refused|existing same' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;

  test := 'The old page: Blacklist (customer first, then the flag without a reason) ends with both blocked and the flag Blacklisted; it can''t block a customer whose flag is already decided; it keeps an existing reason; its Dismiss without a reason is refused and changes nothing';
  begin
    if fo is null or fo2 is null or fi is null or cd is null then outcome := 'SKIP (needs two open flags, an investigating flag and a customer with only decided flags)'; raise exception 'ROLLBACK'; end if;
    -- customer of fo2 already blacklisted for something else
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); -- only an Admin may blacklist
    perform set_config('ctm.system', 'on', true);
    update customers set is_blacklisted = true, blacklist_reason = 'TEST own reason' where id = (select customer_id from suspicious_activity_flags where id = fo2);
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    -- a) the old page's two saves, no reason
    update customers set is_blacklisted = true, blacklist_reason = 'Blacklisted following suspicious activity review' where id = (select customer_id from suspicious_activity_flags where id = fo);
    update suspicious_activity_flags set status = 'blacklisted', resolved_by = admin_id, resolved_at = now(), resolution_notes = null where id = fo;
    s := (select f.status || ',' || (f.resolution_notes like '(Saved from the old page%')::text || ',' || c.is_blacklisted from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.id = fo);
    -- b) a customer whose flags are all decided
    begin update customers set is_blacklisted = true, blacklist_reason = 'Blacklisted following suspicious activity review' where id = cd; s := s || '|saved';
    exception when others then s := s || case when sqlerrm like 'This flag was already decided%' then '|refused' else '|' || sqlerrm end; end;
    s := s || ',' || (select is_blacklisted from customers where id = cd)::text;
    -- c) already blacklisted: the reason stays
    update customers set is_blacklisted = true, blacklist_reason = 'Blacklisted following suspicious activity review' where id = (select customer_id from suspicious_activity_flags where id = fo2);
    s := s || '|' || (select blacklist_reason from customers where id = (select customer_id from suspicious_activity_flags where id = fo2));
    -- d) Dismiss without a reason
    begin update suspicious_activity_flags set status = 'dismissed', resolved_by = admin_id, resolved_at = now(), resolution_notes = null where id = fi; s := s || '|saved';
    exception when others then s := s || case when sqlerrm like 'Write the reason%' then '|refused' else '|' || sqlerrm end; end;
    s := s || ',' || (select status from suspicious_activity_flags where id = fi);
    execute 'reset role';
    outcome := case when s = 'blacklisted,true,true|refused,false|TEST own reason|refused,investigating' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;

  test := 'The new page still works with these rules: a Blacklist decision blocks the customer with the Admin''s reason, and then a new appraisal for that customer is refused';
  begin
    if fo is null then outcome := 'SKIP (needs an open flag)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform review_suspicious_flag(fo, 'blacklisted', 'TEST used two different IDs', 'open');
    s := (select f.status || ',' || c.blacklist_reason from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.id = fo);
    begin
      insert into appraisal_items (category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appraised_by, customer_id)
      select category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, admin_id, (select customer_id from suspicious_activity_flags where id = fo) from appraisal_items where archived_at is null limit 1;
      s := s || '|appraisal saved';
    exception when others then s := s || case when sqlerrm like 'This customer is blacklisted%' then '|appraisal refused' else '|' || sqlerrm end; end;
    execute 'reset role';
    outcome := case when s = 'blacklisted,Suspicious activity review: TEST used two different IDs|appraisal refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0063() from public, anon, authenticated;

-- applied only if these pass, and the earlier Suspicious activity, flag-rule and appraisal-customer tests still pass
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0063' t, * from public.ctm_selftest_0063() union all select '0062' t, * from public.ctm_selftest_0062()
    union all select '0061' t, * from public.ctm_selftest_0061() union all select '0032' t, * from public.ctm_selftest_0032()
    union all select '0038' t, * from public.ctm_selftest_0038() union all select '0039' t, * from public.ctm_selftest_0039()
    union all select '0040' t, * from public.ctm_selftest_0040()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0063 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
