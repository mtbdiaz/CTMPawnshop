-- 0031 (Nov 9, 2026, Wush): #43 + SAD UC16/UC18. Forfeited items in an auction batch can now be marked Sold,
-- with the sale price, buyer and who recorded it; Auction prep can set a minimum price per item (UC18 step 2).
-- Nothing here changes existing data: the 53 queued items stay queued until someone records a sale.
-- Self-test: select * from public.ctm_selftest_0031();   (every test rolls back)

-- 1. The minimum price and the sale details live on the batch line (one line per item in a batch)
alter table public.auction_batch_items
  add column min_price numeric(12,2) check (min_price is null or min_price > 0),           -- UC18: lowest price allowed
  add column sold_at timestamptz,                                                            -- when the sale was recorded
  add column sale_price numeric(12,2) check (sale_price is null or sale_price > 0),         -- what it sold for
  add column sold_by uuid references public.profiles(id),                                   -- who recorded the sale
  add column buyer_name text check (buyer_name is null or char_length(buyer_name) <= 120),  -- optional
  add column sale_notes text check (sale_notes is null or char_length(sale_notes) <= 500);  -- optional
-- a sale is all-or-nothing: price, time and staff are saved together
alter table public.auction_batch_items add constraint auction_sale_complete
  check ((sold_at is null and sale_price is null and sold_by is null) or (sold_at is not null and sale_price is not null and sold_by is not null));

-- 2. create_auction_batch: + optional minimum prices (same order as the item ids). Old calls (2 inputs) still work.
drop function public.create_auction_batch(uuid[], text);
create function public.create_auction_batch(p_item_ids uuid[], p_notes text, p_min_prices numeric[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_batch uuid; v_bad int;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  if p_item_ids is null or array_length(p_item_ids, 1) is null then raise exception 'Select at least one forfeited item'; end if;
  if p_min_prices is not null and array_length(p_min_prices, 1) is distinct from array_length(p_item_ids, 1) then
    raise exception 'Each selected item needs its own minimum price box. Reload the page and try again.';
  end if;
  if exists (select 1 from unnest(p_min_prices) p where p is not null and p <= 0) then raise exception 'A minimum price must be more than 0, or left empty.'; end if;
  select count(*) into v_bad from unnest(p_item_ids) x(id)
  where not exists (select 1 from public.inventory_items i join public.loans l on l.inventory_item_id = i.id
                    where i.id = x.id and i.status = 'forfeited' and l.status = 'forfeited' and i.archived_at is null);
  if v_bad > 0 then raise exception '% of the selected items are not forfeited by an Admin and cannot go to auction', v_bad; end if;
  perform set_config('ctm.system', 'on', true);
  insert into public.auction_batches (created_by, notes) values (auth.uid(), nullif(trim(p_notes), '')) returning id into v_batch;
  -- one line per item (a repeated id is saved once); its minimum price is the one in the same position
  insert into public.auction_batch_items (batch_id, inventory_item_id, min_price)
  select distinct on (x.id) v_batch, x.id, case when p_min_prices is null then null else p_min_prices[x.n] end
  from unnest(p_item_ids) with ordinality x(id, n) order by x.id, x.n;
  update public.inventory_items set status = 'queued_for_auction' where id = any (p_item_ids);
  return v_batch;
end $$;
revoke execute on function public.create_auction_batch(uuid[], text, numeric[]) from public, anon;
grant execute on function public.create_auction_batch(uuid[], text, numeric[]) to authenticated;

-- 3. record_auction_sale: UC16 "Sold". Operator or Admin (same as Auction prep). Checks the item is queued in a
--    batch that isn't archived, the price is at least the minimum, then in one go: batch line gets the sale,
--    item becomes Sold (the status history trigger logs it), and the money goes into the cash ledger (UC19).
create function public.record_auction_sale(p_item_id uuid, p_sale_price numeric, p_buyer text default null, p_notes text default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.inventory_items; b public.auction_batch_items; l public.loans; v_seen jsonb; v_result jsonb; v_entry uuid;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into i from public.inventory_items where id = p_item_id for update; -- one sale at a time per item
  if not found or i.archived_at is not null then raise exception 'Item not found'; end if;
  select * into l from public.loans where inventory_item_id = i.id;
  v_seen := public.ctm_request_seen(p_request_id, 'sale', l.id);
  if v_seen is not null then return v_seen; end if; -- same form sent again: already saved
  if i.status = 'sold' then raise exception 'This item is already marked sold.'; end if;
  if i.status <> 'queued_for_auction' then raise exception 'Only items queued for auction can be sold. Put it in an auction batch first.'; end if;
  select bi.* into b from public.auction_batch_items bi join public.auction_batches ab on ab.id = bi.batch_id
  where bi.inventory_item_id = i.id and ab.archived_at is null and bi.sold_at is null order by ab.created_at desc limit 1;
  if not found then raise exception 'This item is not in an open auction batch.'; end if;
  if p_sale_price is null or p_sale_price <= 0 then raise exception 'Enter the sale price (more than 0).'; end if;
  if b.min_price is not null and p_sale_price < b.min_price then
    raise exception 'The sale price is below this item''s minimum price (₱%).', to_char(b.min_price, 'FM999,999,990.00');
  end if;
  if p_buyer is not null and char_length(trim(p_buyer)) > 120 then raise exception 'Keep the buyer name to 120 characters or less.'; end if;
  if p_notes is not null and char_length(trim(p_notes)) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  update public.auction_batch_items set sold_at = now(), sale_price = round(p_sale_price, 2), sold_by = auth.uid(),
    buyer_name = nullif(trim(p_buyer), ''), sale_notes = nullif(trim(p_notes), '')
  where id = b.id;
  update public.inventory_items set status = 'sold' where id = i.id;
  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
  values ('revenue', 'in', round(p_sale_price, 2), 'Auction sale of the item from ' || l.ticket_number, l.id, auth.uid())
  returning id into v_entry;
  v_result := jsonb_build_object('item_id', i.id, 'sale_price', round(p_sale_price, 2), 'cash_entry_id', v_entry);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'sale', l.id, v_result); end if;
  return v_result;
end $$;
revoke execute on function public.record_auction_sale(uuid, numeric, text, text, uuid) from public, anon;
grant execute on function public.record_auction_sale(uuid, numeric, text, text, uuid) to authenticated;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0031() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  q_item uuid; f_item uuid; batch uuid; r1 jsonb; r2 jsonb; rid uuid := gen_random_uuid(); n int; st text; s text;
begin
  -- a queued item in an open batch, and a forfeited item not in any batch yet
  select bi.inventory_item_id into q_item from auction_batch_items bi join auction_batches ab on ab.id = bi.batch_id
    join inventory_items ii on ii.id = bi.inventory_item_id where ab.archived_at is null and ii.status = 'queued_for_auction' limit 1;
  select i.id into f_item from inventory_items i join loans l on l.inventory_item_id = i.id
    where i.status = 'forfeited' and l.status = 'forfeited' and i.archived_at is null limit 1;

  test := 'operator records a sale: item Sold, batch line filled, money in the ledger, status history';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    r1 := record_auction_sale(q_item, 12345.50, 'SELFTEST buyer', 'SELFTEST', rid);
    r2 := record_auction_sale(q_item, 12345.50, 'SELFTEST buyer', 'SELFTEST', rid); -- the same form sent again
    execute 'reset role';
    select status::text into st from inventory_items where id = q_item;
    select count(*) into n from cash_flow_entries where id = (r1->>'cash_entry_id')::uuid and amount = 12345.50 and entry_type = 'revenue';
    select count(*)::text into s from inventory_status_history where inventory_item_id = q_item and new_status = 'sold';
    outcome := case when st = 'sold' and n = 1 and r1 = r2 and s = '1'
      and exists (select 1 from auction_batch_items where inventory_item_id = q_item and sale_price = 12345.50 and sold_by = op_id)
      then 'PASS (sold once, ₱12,345.50 in the ledger)' else 'FAIL status=' || coalesce(st, '?') || ' cash=' || n || ' history=' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'a cashier cannot record a sale';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform record_auction_sale(q_item, 1000);
    raise exception 'ROWS:sold';
  exception when others then outcome := case when sqlerrm not like 'ROWS:%' and sqlerrm not like '%column%' then 'PASS (refused: ' || left(sqlerrm, 60) || ')' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'a forfeited item that is not queued cannot be sold';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform record_auction_sale(f_item, 1000);
    raise exception 'ROWS:sold';
  exception when others then outcome := case when sqlerrm like 'Only items queued for auction%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'UC18: a batch with a minimum price refuses a lower sale and accepts the minimum';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    batch := create_auction_batch(array[f_item], 'SELFTEST', array[5000.00]::numeric[]);
    begin
      perform record_auction_sale(f_item, 4999.99);
      s := 'sold below';
    exception when others then s := case when sqlerrm like '%below this item''s minimum price (₱5,000.00)%' then 'refused' else sqlerrm end; end;
    perform record_auction_sale(f_item, 5000);
    execute 'reset role';
    select status::text into st from inventory_items where id = f_item;
    outcome := case when s = 'refused' and st = 'sold' then 'PASS' else 'FAIL below=' || s || ' status=' || coalesce(st, '?') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'old 2-input create_auction_batch call still works (no minimum price)';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    batch := create_auction_batch(array[f_item], 'SELFTEST');
    execute 'reset role';
    select count(*) into n from auction_batch_items where batch_id = batch and min_price is null;
    outcome := case when n = 1 then 'PASS' else 'FAIL ' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'an operator cannot change a batch line directly (e.g. fake a sale price)';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    update auction_batch_items set sale_price = 1 where inventory_item_id = q_item;
    get diagnostics n = row_count;
    outcome := case when n = 0 then 'PASS (0 rows changed)' else 'FAIL changed ' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0031() from public, anon, authenticated;
