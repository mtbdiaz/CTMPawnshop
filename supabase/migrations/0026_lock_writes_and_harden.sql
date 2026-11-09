-- 0026 (Nov 9, 2026, Wush): lock tables that only the database functions should change, and small hardening.
-- Nothing here changes data. Same pattern as #26 in 0021: the policy stays, but it always says no,
-- so only the SECURITY DEFINER functions (which run as the table owner) can write.
-- Self-test: select * from public.ctm_selftest_0026();   (every test rolls back)

-- 1. Physical audit and Auction prep functions: can't be called without signing in.
--    (They already refuse inside through ctm_assert_role; this removes the anon/public entry point too.)
revoke execute on function public.create_auction_batch(uuid[], text) from public, anon;
revoke execute on function public.submit_inventory_audit(jsonb, text) from public, anon;
grant execute on function public.create_auction_batch(uuid[], text) to authenticated;
grant execute on function public.submit_inventory_audit(jsonb, text) to authenticated;

-- 2. #41 inventory items: status and vault location change only through the loan functions
--    (create_pawn_loan, renew, capitalize, redeem, reinstate, forfeit, create_auction_batch, archive/restore).
--    The app never writes inventory_items directly (checked: only selects).
alter policy "inventory_items: system insert" on public.inventory_items with check (false);
alter policy "inventory_items: staff update" on public.inventory_items using (false) with check (false);

-- 3. Physical audits and auction batches: only submit_inventory_audit / create_auction_batch write them
--    (since 0022 the app uses those functions), so a fake audit or batch can't be inserted through the API.
alter policy "physical_inventory_audits: operator or admin insert" on public.physical_inventory_audits with check (false);
alter policy "physical_inventory_audit_items: operator or admin insert" on public.physical_inventory_audit_items with check (false);
alter policy "auction_batches: operator or admin insert" on public.auction_batches with check (false);
alter policy "auction_batch_items: operator or admin insert" on public.auction_batch_items with check (false);

-- 4. Fixed search_path on the helper functions the security advisor listed (they only use public objects).
alter function public.ctm_is_system() set search_path = public;
alter function public.ctm_today() set search_path = public;
alter function public.guard_appraisal_karat() set search_path = public;
alter function public.ctm_norm_id(text) set search_path = public;
alter function public.ctm_receipt_number() set search_path = public;
alter function public.ctm_selftest() set search_path = public;
alter function public.ctm_selftest_lifecycle() set search_path = public;
alter function public.ctm_selftest_review() set search_path = public;

-- Self-test (owner only). Pretends to be real staff accounts, like ctm_selftest_review.
create or replace function public.ctm_selftest_0026() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  an_item uuid; a_loan uuid; n integer; st text;
begin
  select id into an_item from inventory_items where status in ('pawned','extended') and archived_at is null limit 1;

  test := '#41 cashier cannot change an item directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    update inventory_items set status = 'redeemed', vault_location = 'SELFTEST' where id = an_item;
    get diagnostics n = row_count;
    outcome := case when n = 0 then 'PASS (0 rows changed)' else 'FAIL changed ' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#41 operator cannot insert an item directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    insert into inventory_items (appraisal_item_id, vault_location, status) select appraisal_item_id, 'SELFTEST', 'pawned' from inventory_items where id = an_item;
    raise exception 'ROWS:inserted';
  exception when others then outcome := case when sqlerrm like '%row-level security%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'renewing through renew_loan still updates the item';
  begin
    select l.id into a_loan from loans l join inventory_items i on i.id = l.inventory_item_id
      where l.status = 'active' and l.archived_at is null and l.maturity_date >= current_date and l.principal_balance > 0 limit 1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform renew_loan(a_loan);
    execute 'reset role';
    select i.status::text into st from inventory_items i join loans l on l.inventory_item_id = i.id where l.id = a_loan;
    outcome := case when st = 'extended' then 'PASS (item now Renewed)' else 'FAIL item status ' || coalesce(st, 'none') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'operator cannot insert an audit directly';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    insert into physical_inventory_audits (performed_by, notes, discrepancy_count) values (op_id, 'SELFTEST', 0);
    raise exception 'ROWS:inserted';
  exception when others then outcome := case when sqlerrm like '%row-level security%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'submit_inventory_audit still works for an operator';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform submit_inventory_audit(jsonb_build_array(jsonb_build_object('inventory_item_id', an_item, 'expected_status', 'pawned', 'found', true)), 'SELFTEST');
    outcome := 'PASS (saved, then rolled back)';
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'not signed in (anon) cannot call create_auction_batch';
  begin
    execute 'set local role anon';
    perform create_auction_batch(array[an_item], 'SELFTEST');
    raise exception 'ROWS:created';
  exception when others then outcome := case when sqlerrm like '%permission denied%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0026() from public, anon, authenticated;
