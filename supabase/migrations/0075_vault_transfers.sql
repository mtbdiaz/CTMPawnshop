-- 0075 (Nov 15, 2026, Wush): vault location transfers with a move history, and three safety rules on vault_locations.
-- From the Vault locations review (claude/vault-locations-review.md, VL1, VL7, VL15, VL8) and
-- claude/vault-backend-for-matt.md. Owner decisions (Nov 15): Operator + Admin may move; a move needs a reason; an item
-- that is in an open (in progress) Physical audit can't be moved until that audit is submitted or discarded.
--
-- Before: an item's vault_location was set once by create_pawn_loan and could never change (nobody may update
-- inventory_items directly), so a physical move couldn't be recorded and a Physical audit "Found elsewhere" stayed
-- "Location to correct" for ever. The "keep one location switched on" rule was only in the Settings page's server code,
-- an Admin calling the database directly could change created_by / created_at on a location, and the database accepted
-- a new name with double spaces ("vault  a" next to "Vault A").
--
-- Now:
--   1. inventory_location_moves: one row per move (item, from, to, reason, who, when). Insert only through
--      move_inventory_item; nobody can change or delete a row.
--   2. move_inventory_item(item, to, reason, expected_from, request_id): Operator or Admin. The destination must be on
--      the list and switched on; the item must be in the shop; the reason 5-300 characters; the item's location must
--      still be the one the page showed; refused while the item is in an open audit; the same request twice = one move.
--   3. vault_locations: at least one location must stay switched on (checked in the database, one change at a time).
--   4. vault_locations: only is_active may change (name, id, created_by and created_at are locked).
--   5. vault_locations: no repeated spaces inside a name.
-- No existing item, location, loan or audit is changed by this migration.
-- Self-test: select * from public.ctm_selftest_0075();   (every test rolls back)

-- 1. the move history ---------------------------------------------------------------------------------------------
create table if not exists public.inventory_location_moves (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id),
  from_location text not null,               -- exactly as it was stored (old typed names stay as they were)
  to_location text not null,                 -- the list's own spelling
  reason text not null check (char_length(reason) between 5 and 300),
  moved_by uuid not null references public.profiles(id),
  moved_at timestamptz not null default now(),
  request_id uuid unique,                    -- the same form sent twice = one move
  is_demo boolean not null default false
);
create index if not exists inventory_location_moves_item_idx on public.inventory_location_moves (inventory_item_id, moved_at desc);

alter table public.inventory_location_moves enable row level security;
-- every signed-in staff member may read the history (like inventory_items); nobody writes to it directly
drop policy if exists "inventory_location_moves: staff select" on public.inventory_location_moves;
create policy "inventory_location_moves: staff select" on public.inventory_location_moves for select to authenticated using (true);
revoke all on public.inventory_location_moves from anon;
revoke insert, update, delete, truncate on public.inventory_location_moves from authenticated;
grant select on public.inventory_location_moves to authenticated;

drop trigger if exists inventory_location_moves_audit on public.inventory_location_moves;
create trigger inventory_location_moves_audit after insert or update or delete on public.inventory_location_moves
  for each row execute function public.audit_trigger_fn();

-- 2. the move itself -----------------------------------------------------------------------------------------------
create or replace function public.move_inventory_item(p_item uuid, p_to text, p_reason text, p_expected_from text, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item public.inventory_items; v_to text; v_reason text := btrim(coalesce(p_reason, '')); v_move public.inventory_location_moves;
  v_audit uuid;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]); -- Operator or Admin

  -- the same form sent twice (double click, a retry): give back the first move
  if p_request_id is not null then
    select * into v_move from public.inventory_location_moves where request_id = p_request_id;
    if found then
      return jsonb_build_object('id', v_move.id, 'from', v_move.from_location, 'to', v_move.to_location, 'repeat', true);
    end if;
  end if;

  select * into v_item from public.inventory_items where id = p_item for update; -- one change at a time per item
  if not found then raise exception 'Item not found.'; end if;
  if v_item.archived_at is not null or v_item.status not in ('pawned', 'extended', 'forfeited', 'queued_for_auction') then
    raise exception 'Only an item that is in the shop (in vault, forfeited or queued for auction) can be moved.';
  end if;
  if p_expected_from is null or v_item.vault_location is distinct from p_expected_from then
    raise exception 'This item''s location was changed after the page was opened (it is now "%"). Reload the page and check it again.', v_item.vault_location;
  end if;

  -- the destination: on the list and switched on (capitals and spaces at the ends don't matter, like New Loan)
  select v.name into v_to from public.vault_locations v where v.is_active and lower(v.name) = lower(btrim(coalesce(p_to, '')));
  if v_to is null then raise exception 'Choose a location that is on the list and switched on.'; end if;
  if v_to = v_item.vault_location then raise exception 'The item is already recorded in %.', v_to; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 300 then raise exception 'Write a reason of 5 to 300 characters.'; end if;

  -- not while the item is in an open Physical audit (owner decision): finish or discard that audit first
  select a.id into v_audit from public.physical_inventory_audit_items i join public.physical_inventory_audits a on a.id = i.audit_id
  where i.inventory_item_id = p_item and a.status = 'in_progress' and a.archived_at is null order by a.started_at limit 1;
  if v_audit is not null then
    raise exception 'This item is in an open Physical audit (%). Submit or discard that audit first, then move the item.', left(v_audit::text, 8);
  end if;

  update public.inventory_items set vault_location = v_to where id = p_item;
  insert into public.inventory_location_moves (inventory_item_id, from_location, to_location, reason, moved_by, request_id)
  values (p_item, v_item.vault_location, v_to, v_reason, auth.uid(), p_request_id) returning * into v_move;
  return jsonb_build_object('id', v_move.id, 'from', v_move.from_location, 'to', v_move.to_location, 'repeat', false);
end $$;
revoke all on function public.move_inventory_item(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.move_inventory_item(uuid, text, text, text, uuid) to authenticated;

-- 3 + 4. vault_locations: only On/Off may change, and at least one must stay switched on --------------------------------
create or replace function public.guard_vault_location() returns trigger language plpgsql set search_path = public as $$
begin
  if new.name is distinct from old.name then
    raise exception 'A vault location can''t be renamed. Switch it off and add a new one.';
  end if;
  -- 0075 (VL15): who added it and when can't be edited either; only is_active changes
  if new.id is distinct from old.id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Only a vault location''s On/Off setting can be changed.';
  end if;
  -- 0075 (VL7): switching one off is refused when no other location would stay switched on.
  -- The lock makes two Admins switching off the last two at the same moment wait for each other.
  if old.is_active and not new.is_active then
    perform pg_advisory_xact_lock(hashtext('ctm_vault_locations_active'));
    if not exists (select 1 from public.vault_locations v where v.is_active and v.id <> new.id) then
      raise exception 'At least one vault location must stay switched on. Add or switch on another one first.';
    end if;
  end if;
  return new;
end $$;

-- 5. no repeated spaces inside a name (VL8); the app already cleans "Vault  C" to "Vault C". All 3 names pass.
alter table public.vault_locations drop constraint if exists vault_locations_name_single_spaces;
alter table public.vault_locations add constraint vault_locations_name_single_spaces check (name !~ '\s{2,}');

-- self-test ---------------------------------------------------------------------------------------------------------
create or replace function public.ctm_selftest_0075() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  admin_id uuid; op_id uuid; cashier_id uuid; appr_id uuid;
  it public.inventory_items; it2 public.inventory_items; loan_before text; loan_after text; r jsonb; r2 jsonb; s text; n int; v_dest text; v_req uuid := gen_random_uuid();
  fp_items text; fp_moves int; fp_locs text; fp_audits text; fp_loans text;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id into op_id from profiles where role = 'operator' and is_active order by created_at limit 1;
  select id into cashier_id from profiles where role = 'cashier' and is_active order by created_at limit 1;
  select id into appr_id from profiles where role = 'appraiser' and is_active order by created_at limit 1;
  select md5(string_agg(id::text || vault_location || status, ',' order by id)) into fp_items from inventory_items;
  select count(*) into fp_moves from inventory_location_moves;
  select string_agg(name || is_active, ',' order by name) into fp_locs from vault_locations;
  select md5(string_agg(id::text || status || coalesce(archived_at::text, ''), ',' order by id)) into fp_audits from physical_inventory_audits;
  select md5(string_agg(id::text || status || principal_balance || maturity_date, ',' order by id)) into fp_loans from loans;

  test := 'An Operator moves an item in the shop to another switched-on location: the item''s location changes, one history row (from, to, reason, who), the loan and the item''s status don''t change; the same request again gives back the same move; an old page (wrong "from") is refused';
  begin
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null; -- set aside for this block
    perform set_config('ctm.system', 'off', true);
    select * into it from inventory_items where archived_at is null and status in ('pawned', 'extended') and vault_location = 'Vault A' order by id limit 1;
    select row(l.*)::text into loan_before from loans l where l.inventory_item_id = it.id;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    r := move_inventory_item(it.id, ' vault b ', 'Moved to Vault B shelf for the audit', 'Vault A', v_req);
    r2 := move_inventory_item(it.id, 'Vault B', 'Moved to Vault B shelf for the audit', 'Vault A', v_req); -- same request
    begin
      perform move_inventory_item(it.id, 'Safe 1', 'Second move from an old page', 'Vault A', gen_random_uuid());
      s := 'old page accepted';
    exception when others then s := case when sqlerrm like '%changed after the page was opened%' then 'ok' else 'wrong error: ' || sqlerrm end; end;
    execute 'reset role';
    select * into it2 from inventory_items where id = it.id;
    select row(l.*)::text into loan_after from loans l where l.inventory_item_id = it.id;
    select count(*) into n from inventory_location_moves where inventory_item_id = it.id and from_location = 'Vault A' and to_location = 'Vault B' and moved_by = op_id and reason = 'Moved to Vault B shelf for the audit';
    outcome := case when it2.vault_location = 'Vault B' and it2.status = it.status and n = 1 and (r->>'id') = (r2->>'id') and (r2->>'repeat')::boolean
                     and loan_after is not distinct from loan_before and s = 'ok' then 'PASS'
                    else 'FAIL loc=' || it2.vault_location || ' rows=' || n || ' repeat=' || coalesce(r2->>'repeat', '?') || ' ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'Refused: a Cashier, an Appraiser and a signed-out visitor; a switched-off or unknown destination; the same location; a reason under 5 characters; a released item. An Admin may move';
  begin
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    perform set_config('ctm.system', 'off', true);
    select * into it from inventory_items where archived_at is null and status in ('pawned', 'extended') and vault_location = 'Vault A' order by id limit 1;
    s := '';
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cashier_id, 'role', 'authenticated')::text, true);
    begin perform move_inventory_item(it.id, 'Vault B', 'cashier tries', 'Vault A'); s := s || 'cashier-ok '; exception when others then null; end;
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    begin perform move_inventory_item(it.id, 'Vault B', 'appraiser tries', 'Vault A'); s := s || 'appraiser-ok '; exception when others then null; end;
    execute 'reset role';
    execute 'set local role anon';
    begin perform move_inventory_item(it.id, 'Vault B', 'anon tries', 'Vault A'); s := s || 'anon-ok '; exception when others then null; end;
    execute 'reset role';
    update vault_locations set is_active = false where name = 'Safe 1'; -- (Vault A and Vault B stay on)
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform move_inventory_item(it.id, 'Safe 1', 'to a switched-off place', 'Vault A'); s := s || 'off-dest-ok '; exception when others then null; end;
    begin perform move_inventory_item(it.id, 'Vault Z', 'to an unknown place', 'Vault A'); s := s || 'unknown-ok '; exception when others then null; end;
    begin perform move_inventory_item(it.id, 'vault a', 'to the same place', 'Vault A'); s := s || 'same-ok '; exception when others then null; end;
    begin perform move_inventory_item(it.id, 'Vault B', 'abc', 'Vault A'); s := s || 'short-reason-ok '; exception when others then null; end;
    select * into it2 from inventory_items where archived_at is null and status = 'redeemed' order by id limit 1;
    begin perform move_inventory_item(it2.id, 'Vault B', 'a released item', it2.vault_location); s := s || 'released-ok '; exception when others then null; end;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform move_inventory_item(it.id, 'Vault B', 'Admin moves it', 'Vault A');
    execute 'reset role';
    select vault_location into v_dest from inventory_items where id = it.id;
    outcome := case when s = '' and v_dest = 'Vault B' then 'PASS' else 'FAIL accepted: ' || s || ' admin moved to ' || coalesce(v_dest, '?') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'An item that is in an open (in progress) Physical audit can''t be moved; after that audit is discarded it can';
  begin
    select i.* into it from inventory_items i
    where i.archived_at is null and i.status in ('pawned', 'extended') and i.vault_location = 'Vault A'
      and exists (select 1 from physical_inventory_audit_items l join physical_inventory_audits a on a.id = l.audit_id where l.inventory_item_id = i.id and a.status = 'in_progress' and a.archived_at is null)
    order by i.id limit 1;
    if it.id is null then
      -- no open audit has a Vault A item: start one just for this block (rolled back)
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
      perform start_inventory_audit('Vault A', gen_random_uuid(), null);
      execute 'reset role';
      select * into it from inventory_items where archived_at is null and status in ('pawned', 'extended') and vault_location = 'Vault A' order by id limit 1;
    end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform move_inventory_item(it.id, 'Vault B', 'during an open audit', 'Vault A'); s := 'accepted'; exception when others then s := case when sqlerrm like '%open Physical audit%' then 'refused' else 'wrong error: ' || sqlerrm end; end;
    execute 'reset role';
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform move_inventory_item(it.id, 'Vault B', 'after the audit was discarded', 'Vault A');
    execute 'reset role';
    select vault_location into v_dest from inventory_items where id = it.id;
    outcome := case when s = 'refused' and v_dest = 'Vault B' then 'PASS' else 'FAIL ' || s || ' / ' || coalesce(v_dest, '?') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'Vault locations: an Admin may switch off all but one; the last one is refused (also straight through the database); switching on works; renaming and changing who added it or when are refused; a name with double spaces is refused';
  begin
    s := '';
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    update vault_locations set is_active = false where name in ('Safe 1', 'Vault B');
    begin update vault_locations set is_active = false where name = 'Vault A'; s := s || 'last-off-ok '; exception when others then if sqlerrm not like '%must stay switched on%' then s := s || 'wrong:' || sqlerrm; end if; end;
    begin update vault_locations set is_active = false; s := s || 'all-off-ok '; exception when others then null; end;
    update vault_locations set is_active = true where name = 'Safe 1';
    get diagnostics n = row_count;
    begin update vault_locations set name = 'Safe One' where name = 'Safe 1'; s := s || 'rename-ok '; exception when others then null; end;
    begin update vault_locations set created_by = op_id where name = 'Safe 1'; s := s || 'created_by-ok '; exception when others then null; end;
    begin update vault_locations set created_at = now() - interval '1 year' where name = 'Safe 1'; s := s || 'created_at-ok '; exception when others then null; end;
    begin insert into vault_locations (name) values ('Vault  Z'); s := s || 'double-space-ok '; exception when others then null; end;
    insert into vault_locations (name) values ('Vault Z'); -- a normal new name still works
    execute 'reset role';
    outcome := case when s = '' and n = 1 and (select count(*) from vault_locations where is_active) = 3 then 'PASS' else 'FAIL ' || s || ' on=' || (select count(*) from vault_locations where is_active) end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'Nobody writes the history or the item directly: staff insert/update/delete on inventory_location_moves are refused, a direct update of an item''s location changes 0 rows, staff can read the history';
  begin
    s := '';
    perform set_config('ctm.system', 'on', true);
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    perform set_config('ctm.system', 'off', true);
    select * into it from inventory_items where archived_at is null and status in ('pawned', 'extended') and vault_location = 'Vault A' order by id limit 1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform move_inventory_item(it.id, 'Vault B', 'a real move to test the history', 'Vault A');
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin insert into inventory_location_moves (inventory_item_id, from_location, to_location, reason, moved_by) values (it.id, 'Vault B', 'Safe 1', 'fake move', admin_id); s := s || 'insert-ok '; exception when others then null; end;
    begin update inventory_location_moves set reason = 'changed' where inventory_item_id = it.id; get diagnostics n = row_count; if n > 0 then s := s || 'update-ok '; end if; exception when others then null; end;
    begin delete from inventory_location_moves where inventory_item_id = it.id; get diagnostics n = row_count; if n > 0 then s := s || 'delete-ok '; end if; exception when others then null; end;
    update inventory_items set vault_location = 'Safe 1' where id = it.id; get diagnostics n = row_count; if n > 0 then s := s || 'item-update-ok '; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', cashier_id, 'role', 'authenticated')::text, true);
    select count(*) into n from inventory_location_moves where inventory_item_id = it.id;
    execute 'reset role';
    outcome := case when s = '' and n = 1 then 'PASS' else 'FAIL ' || s || ' cashier sees ' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'Nothing outside the tests changed (items, moves, locations, audits, loans)';
  outcome := case when (select md5(string_agg(id::text || vault_location || status, ',' order by id)) from inventory_items) = fp_items
                   and (select count(*) from inventory_location_moves) = fp_moves
                   and (select string_agg(name || is_active, ',' order by name) from vault_locations) = fp_locs
                   and (select md5(string_agg(id::text || status || coalesce(archived_at::text, ''), ',' order by id)) from physical_inventory_audits) = fp_audits
                   and (select md5(string_agg(id::text || status || principal_balance || maturity_date, ',' order by id)) from loans) = fp_loans
                  then 'PASS' else 'FAIL something changed after the tests' end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0075() from public, anon, authenticated;

-- applied only if these self-tests pass (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0075' t, * from public.ctm_selftest_0075()
    union all select '0038' t, * from public.ctm_selftest_0038()
    union all select 'audit' t, * from public.ctm_selftest_audit()
    union all select '0070' t, * from public.ctm_selftest_0070()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0075 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
