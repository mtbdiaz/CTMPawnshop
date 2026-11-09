-- 0033 (Nov 9, 2026, Wush): Batch 3 of Matt's list.
-- #13: appraisal_items.counterfeit_flagged_at = when the item went into counterfeit review (the Dashboard used created_at).
-- #28: appraisal_items.counterfeit_resolution_notes = why the Admin cleared or confirmed it.
-- #14: suspicious_activity_flags.resolution_notes, and a "Resolved, found" follow-up for items marked missing in a
--      physical audit (resolve_audit_item, Operator/Admin).
-- Existing data: only the new counterfeit_flagged_at column is filled for the 8 already-flagged items, with their
-- appraisal time (the same date the Dashboard already showed). Nothing else changes.
-- Self-test: select * from public.ctm_selftest_0033();   (every test rolls back)

-- 1. #13 + #28 on appraisal_items
alter table public.appraisal_items
  add column counterfeit_flagged_at timestamptz,
  add column counterfeit_resolution_notes text check (counterfeit_resolution_notes is null or char_length(counterfeit_resolution_notes) <= 500);
do $$ begin
  perform set_config('ctm.system', 'on', true);
  update public.appraisal_items set counterfeit_flagged_at = created_at where is_counterfeit_risk and counterfeit_flagged_at is null;
  perform set_config('ctm.system', 'off', true); -- switch "system mode" off again so the rest of this migration runs the normal checks
end $$;

-- sets counterfeit_flagged_at when an item goes (back) into review: flagged at appraisal, flagged later on an edit,
-- or sent back to pending after a cleared item's karat/weight/category changed (#24)
create or replace function public.set_counterfeit_flagged_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_counterfeit_risk and new.counterfeit_resolution = 'pending'
     and (tg_op = 'INSERT' or not old.is_counterfeit_risk or old.counterfeit_resolution is distinct from 'pending') then
    new.counterfeit_flagged_at := now();
  end if;
  if not new.is_counterfeit_risk then new.counterfeit_flagged_at := null; end if;
  -- a new review starts without the old decision's reason
  if tg_op = 'UPDATE' and new.counterfeit_resolution = 'pending' and old.counterfeit_resolution is distinct from 'pending' then
    new.counterfeit_resolution_notes := null;
  end if;
  return new;
end $$;
-- runs AFTER guard_appraisal_locked (trigger names run in alphabetical order: "appraisal_items_guard..." < "appraisal_items_z...")
-- so it also sees the guard's #24 reset to pending
create trigger appraisal_items_zz_flagged_at before insert or update on public.appraisal_items
  for each row execute function public.set_counterfeit_flagged_at();

-- 2. #14 notes on suspicious-activity flags (the Admin writes why they dismissed, investigated or blacklisted)
alter table public.suspicious_activity_flags
  add column resolution_notes text check (resolution_notes is null or char_length(resolution_notes) <= 500);

-- 3. #14 "Resolved, found" for audit lines marked missing
alter table public.physical_inventory_audit_items
  add column resolved_at timestamptz,
  add column resolved_by uuid references public.profiles(id),
  add column resolution_notes text check (resolution_notes is null or char_length(resolution_notes) <= 500);
alter table public.physical_inventory_audit_items add constraint audit_item_resolved_complete
  check ((resolved_at is null and resolved_by is null) or (resolved_at is not null and resolved_by is not null));

create function public.resolve_audit_item(p_line_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.physical_inventory_audit_items;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into a from public.physical_inventory_audit_items where id = p_line_id for update;
  if not found then raise exception 'Audit line not found.'; end if;
  if a.found then raise exception 'This item was not marked missing in that audit.'; end if;
  if a.resolved_at is not null then raise exception 'This missing item was already marked found.'; end if;
  if coalesce(char_length(trim(p_notes)), 0) < 5 then raise exception 'Write where the item was found (at least 5 characters).'; end if;
  if char_length(trim(p_notes)) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  update public.physical_inventory_audit_items set resolved_at = now(), resolved_by = auth.uid(), resolution_notes = trim(p_notes) where id = a.id;
end $$;
revoke execute on function public.resolve_audit_item(uuid, text) from public, anon;
grant execute on function public.resolve_audit_item(uuid, text) to authenticated;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0033() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  t_item uuid; line uuid; n int; ts timestamptz; s text;
begin
  select x.id into line from physical_inventory_audit_items x where not x.found and x.resolved_at is null limit 1; -- x.found: "found" alone means something else inside plpgsql

  test := '#13 a new flagged appraisal gets counterfeit_flagged_at; an unflagged one does not';
  begin
    insert into appraisal_items (weight_grams, karat, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, is_counterfeit_risk, counterfeit_resolution, appraised_by, category, status)
    values (5, 18, 2662.5, 70, 13312.5, 8386.88, 9318.75, true, 'pending', appr_id, 'ring', 'available') returning id into t_item;
    select counterfeit_flagged_at into ts from appraisal_items where id = t_item;
    insert into appraisal_items (weight_grams, karat, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, is_counterfeit_risk, appraised_by, category, status)
    values (5, 18, 2662.5, 70, 13312.5, 8386.88, 9318.75, false, appr_id, 'ring', 'available') returning id into t_item;
    select count(*) into n from appraisal_items where id = t_item and counterfeit_flagged_at is null;
    outcome := case when ts is not null and n = 1 then 'PASS' else 'FAIL flagged_at=' || coalesce(ts::text, 'null') || ' unflagged_null=' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := '#13 #24 a cleared item whose karat changes goes back to review with a new flagged time and no old reason';
  begin
    insert into appraisal_items (weight_grams, karat, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, is_counterfeit_risk, counterfeit_resolution, counterfeit_resolution_notes, counterfeit_flagged_at, appraised_by, category, status)
    values (5, 18, 2662.5, 70, 13312.5, 8386.88, 9318.75, true, 'cleared', 'SELFTEST genuine', now() - interval '3 days', appr_id, 'ring', 'available') returning id into t_item;
    -- the item starts cleared, so the trigger keeps its 3-day-old flagged time; then an Appraiser changes the karat
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    update appraisal_items set karat = 21 where id = t_item;
    execute 'reset role';
    select count(*) into n from appraisal_items where id = t_item and counterfeit_resolution = 'pending'
      and counterfeit_flagged_at >= now() - interval '1 minute' and counterfeit_resolution_notes is null;
    select counterfeit_resolution || ' flagged=' || coalesce(counterfeit_flagged_at::text, 'null') || ' notes=' || coalesce(counterfeit_resolution_notes, 'null') into s from appraisal_items where id = t_item;
    outcome := case when n = 1 then 'PASS' else 'FAIL ' || coalesce(s, 'row not visible') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#14 an operator marks a missing audit item found, with a note';
  begin
    if line is null then outcome := 'SKIP (no missing audit lines)'; else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform resolve_audit_item(line, 'SELFTEST found on shelf 2');
    begin perform resolve_audit_item(line, 'SELFTEST again'); s := 'saved twice';
    exception when others then s := case when sqlerrm like '%already marked found%' then 'refused' else sqlerrm end; end;
    execute 'reset role';
    select count(*) into n from physical_inventory_audit_items where id = line and resolved_by = op_id and resolution_notes = 'SELFTEST found on shelf 2';
    outcome := case when n = 1 and s = 'refused' then 'PASS (saved once)' else 'FAIL n=' || n || ' second=' || s end;
    end if;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#14 a cashier cannot mark an audit item found, and a note is required';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform resolve_audit_item(line, 'SELFTEST cashier'); s := 'saved';
    exception when others then s := case when sqlerrm like '%not allowed%' then 'refused' else sqlerrm end; end;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform resolve_audit_item(line, ' '); s := s || '/saved';
    exception when others then s := s || case when sqlerrm like 'Write where the item was found%' then '/refused' else '/' || sqlerrm end; end;
    outcome := case when s = 'refused/refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0033() from public, anon, authenticated;
