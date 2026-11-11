-- 0053 (Nov 12, 2026, Wush): Auction prep, after the safety review. Three things.
--   1. The live site (old page) and the new page can both use the database while the new page is not deployed yet.
--      0052 refused the old page's "Create batch" (it sends no "No reserve" list). Now an old-style call is accepted
--      again, but an item with no price is saved as "Not set" (NOT as "no minimum" like before 0052), so it still
--      can't be sold until someone decides its reserve. The new page always sends the list, so its rule is the same:
--      a price or a deliberate "No reserve" for every item.
--   2. Found while checking the money: the cash ledger already has 22 "Auction sale..." entries (Sep 17 to Oct 27,
--      ₱493,062.26) for 22 items that are still Queued and have no sale record. Recording a sale for one of them
--      would put the money in the ledger a second time. record_auction_sale now refuses when the ledger already
--      has an auction sale for that ticket. Nothing in the ledger is changed here; an Admin / Matt decides what
--      those 22 entries are.
--   3. auction_lines tells the page about such a ledger entry, so the row can say it instead of offering "Record sale".
-- Self-test: select * from public.ctm_selftest_0053();   (every test rolls back)

-- the amount of auction-sale revenue already in the cash ledger for a loan (null = none)
create or replace function public.ctm_loan_auction_revenue(p_loan uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select sum(c.amount) from public.cash_flow_entries c
  where c.related_loan_id = p_loan and c.entry_type = 'revenue' and c.direction = 'in'
    and c.description like 'Auction sale%' and c.archived_at is null
$$;
revoke all on function public.ctm_loan_auction_revenue(uuid) from public, anon, authenticated; -- only used inside the functions below

-- ---------- 1. create a batch: the old call shape works again, safely ----------
create or replace function public.create_auction_batch(p_item_ids uuid[], p_notes text default null, p_min_prices numeric[] default null,
  p_no_reserve boolean[] default null, p_auction_date date default null, p_auction_place text default null, p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_batch uuid; v_bad int; n int := coalesce(array_length(p_item_ids, 1), 0); k int;
  v_old boolean := p_no_reserve is null; -- true = the old page (before 0052) is calling: it has no "No reserve" tick
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]); -- Operator or Admin
  if p_request_id is not null then -- the same Create sent twice (double click, retry)
    select id into v_batch from public.auction_batches where request_id = p_request_id;
    if found then return v_batch; end if;
  end if;
  if n = 0 then raise exception 'Select at least one forfeited item'; end if;
  if (select count(distinct x) from unnest(p_item_ids) x) <> n then raise exception 'An item was selected twice. Reload the page and try again.'; end if;
  if v_old then
    if p_min_prices is not null and coalesce(array_length(p_min_prices, 1), 0) <> n then raise exception 'Send one minimum price per item (or none at all)'; end if;
  elsif coalesce(array_length(p_min_prices, 1), 0) <> n or coalesce(array_length(p_no_reserve, 1), 0) <> n then
    raise exception 'Each selected item needs a reserve price or "No reserve". Reload the page and try again.';
  end if;
  -- lock the items, so two people can't batch the same item at the same moment
  perform 1 from public.inventory_items where id = any (p_item_ids) order by id for update;
  select count(*) into v_bad from unnest(p_item_ids) x(id)
  where not exists (select 1 from public.inventory_items i join public.loans l on l.inventory_item_id = i.id
                    where i.id = x.id and i.status = 'forfeited' and l.status = 'forfeited' and i.archived_at is null);
  if v_bad > 0 then raise exception '% of the selected items are not forfeited by an Admin and cannot go to auction', v_bad; end if;
  select count(*) into v_bad from unnest(p_item_ids) x(id) where public.ctm_item_audit_flag(x.id) = 'not_located';
  if v_bad > 0 then raise exception '% of the selected items could not be located in the last physical audit. Follow that up on the Physical audit page first.', v_bad; end if;
  for k in 1..n loop
    if not v_old and coalesce(p_no_reserve[k], false) then
      if p_min_prices[k] is not null then raise exception 'An item has both a reserve price and "No reserve". Pick one.'; end if;
    elsif p_min_prices is null or p_min_prices[k] is null then
      -- new page: a missing price is refused. Old page: allowed, saved as "Not set" (can't be sold until decided)
      if not v_old then raise exception 'Every item needs a reserve price, or "No reserve" ticked on purpose.'; end if;
    elsif p_min_prices[k] <= 0 or p_min_prices[k] > 10000000 then raise exception 'A reserve price must be more than 0 (and not more than 10,000,000).';
    end if;
  end loop;
  if char_length(coalesce(p_notes, '')) > 500 then raise exception 'Keep the batch note to 500 characters or less.'; end if;
  if char_length(btrim(coalesce(p_auction_place, ''))) > 120 then raise exception 'Keep the auction place to 120 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  insert into public.auction_batches (created_by, notes, auction_date, auction_place, request_id)
  values (auth.uid(), nullif(trim(p_notes), ''), p_auction_date, nullif(btrim(coalesce(p_auction_place, '')), ''), p_request_id) returning id into v_batch;
  -- who decided the reserve and when is only filled when a decision was made (a price or No reserve)
  insert into public.auction_batch_items (batch_id, inventory_item_id, min_price, no_reserve, reserve_set_by, reserve_set_at)
  select v_batch, x.id, round(p_min_prices[x.n], 2), coalesce(p_no_reserve[x.n], false),
         case when p_min_prices[x.n] is not null or coalesce(p_no_reserve[x.n], false) then auth.uid() end,
         case when p_min_prices[x.n] is not null or coalesce(p_no_reserve[x.n], false) then now() end
  from unnest(p_item_ids) with ordinality x(id, n);
  update public.inventory_items set status = 'queued_for_auction' where id = any (p_item_ids);
  return v_batch;
end $$;

-- ---------- 2 + 3. small changes inside two long functions (the rest of each stays exactly as in 0052) ----------
do $patch$
declare d text; d0 text;
begin
  -- record_auction_sale: refuse when the ledger already has an auction sale for this ticket
  select pg_get_functiondef('public.record_auction_sale(uuid,numeric,text,text,uuid)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$  if p_sale_price is null or p_sale_price <= 0 then$a$,
    $b$  if public.ctm_loan_auction_revenue(l.id) is not null then
    raise exception 'The cash ledger already has an auction sale for this ticket (₱%). Ask an Admin to check the ledger before recording a sale.', to_char(public.ctm_loan_auction_revenue(l.id), 'FM999,999,990.00');
  end if;
  if p_sale_price is null or p_sale_price <= 0 then$b$);
  if d = d0 then raise exception '0053: could not update record_auction_sale'; end if;
  execute d;

  -- auction_lines: each waiting line also says how much auction revenue the ledger already has for its ticket
  select pg_get_functiondef('public.auction_lines(text,text,uuid,integer,integer)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$public.ctm_item_audit_flag(i.id) as audit_flag$a$,
    $b$public.ctm_item_audit_flag(i.id) as audit_flag,
           case when bi.sold_at is null then public.ctm_loan_auction_revenue(ln.id) end as ledger_sale$b$);
  if d = d0 then raise exception '0053: could not update auction_lines'; end if;
  execute d;

  -- the 0052 self-test: an old-style call now makes a "Not set" line; and it tests with an item the ledger has no sale for
  select pg_get_functiondef('public.ctm_selftest_0052()'::regprocedure) into d; d0 := d;
  d := replace(d, $a$perform create_auction_batch(array[it], 'TEST'); s := s || 'no reserve info saved';$a$,
    $b$perform create_auction_batch(array[it], 'TEST');
      if (select bi.min_price is null and not bi.no_reserve and bi.reserve_set_at is null from auction_batch_items bi where bi.inventory_item_id = it and bi.sold_at is null and bi.unsold_at is null)
      then raise exception 'OLDOK'; end if; -- the old page's call: saved as Not set (this inner block undoes it)
      raise exception 'old call saved a reserve decision';$b$);
  d := replace(d, $a$case when sqlerrm like 'Each selected item needs%' then '1' else sqlerrm end$a$, $b$case when sqlerrm = 'OLDOK' then '1' else sqlerrm end$b$);
  d := replace(d, $a$and bi.min_price is null and not bi.no_reserve and ctm_item_audit_flag(i.id) is null order by bi.id limit 1;$a$,
    $b$and bi.min_price is null and not bi.no_reserve and ctm_item_audit_flag(i.id) is null
      and not exists (select 1 from loans l2 where l2.inventory_item_id = i.id and ctm_loan_auction_revenue(l2.id) is not null) order by bi.id limit 1;$b$);
  d := replace(d, $a$Create batch: needs a price or No reserve for every item (never both, never neither, never 0)$a$,
    $b$Create batch: the new page needs a price or No reserve for every item (never both, never neither, never 0); an old-style call saves Not set$b$);
  if d = d0 then raise exception '0053: could not update ctm_selftest_0052'; end if;
  execute d;

  -- Matt's 0031 self-test: use a queued item the ledger has no sale for
  select pg_get_functiondef('public.ctm_selftest_0031()'::regprocedure) into d; d0 := d;
  d := replace(d, $a$and ii.status = 'queued_for_auction' limit 1;$a$,
    $b$and ii.status = 'queued_for_auction'
      and not exists (select 1 from loans l2 where l2.inventory_item_id = ii.id and ctm_loan_auction_revenue(l2.id) is not null) limit 1;$b$);
  if d = d0 then raise exception '0053: could not update ctm_selftest_0031'; end if;
  execute d;
end $patch$;

-- ---------- 4. self-test ----------
create or replace function public.ctm_selftest_0053() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de'; -- an Operator account
  admin_id uuid; q uuid; ql uuid; ln uuid; s text; c0 int; a0 int; r jsonb;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  -- a queued item with its open line, reserve not set, no audit problem, and no auction sale in the ledger
  select bi.inventory_item_id, bi.id, l.id into q, ql, ln from auction_batch_items bi join inventory_items i on i.id = bi.inventory_item_id join loans l on l.inventory_item_id = i.id
    where bi.sold_at is null and bi.unsold_at is null and i.status = 'queued_for_auction' and bi.min_price is null and not bi.no_reserve
      and ctm_item_audit_flag(i.id) is null and ctm_loan_auction_revenue(l.id) is null order by bi.id limit 1;

  test := 'A refused sale changes nothing: still queued, no ledger entry, no sale on the batch line (below the reserve, no buyer, price 0)';
  begin
    if q is null then outcome := 'SKIP (no queued item to test with)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform set_auction_reserve(ql, 4000, false);
    execute 'reset role';
    select count(*) into c0 from cash_flow_entries;
    execute 'set local role authenticated';
    s := '';
    begin perform record_auction_sale(q, 3999, 'TEST buyer'); s := s || 'sold'; exception when others then s := s || '1'; end;
    begin perform record_auction_sale(q, 5000, null); s := s || 'sold'; exception when others then s := s || '2'; end;
    begin perform record_auction_sale(q, 0, 'TEST buyer'); s := s || 'sold'; exception when others then s := s || '3'; end;
    begin perform record_auction_sale(q, -5, 'TEST buyer'); s := s || 'sold'; exception when others then s := s || '4'; end;
    execute 'reset role';
    s := s || '|' || ((select count(*) from cash_flow_entries) - c0) || '|' || (select status from inventory_items where id = q)
           || '|' || (select (sold_at is null and sale_price is null and buyer_name is null)::text from auction_batch_items where id = ql);
    outcome := case when s = '1234|0|queued_for_auction|true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Ledger: a sale is refused when the cash ledger already has an auction sale for that ticket; after a real sale the ledger has exactly one entry with the sale price';
  begin
    if q is null then outcome := 'SKIP (no queued item to test with)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform set_auction_reserve(ql, null, true);
    r := record_auction_sale(q, 7777.77, 'TEST buyer');
    execute 'reset role';
    s := (select count(*) || ',' || sum(amount) from cash_flow_entries where related_loan_id = ln and description like 'Auction sale%');
    -- now the other way round: an item that is still queued but whose ticket already has an auction sale in the ledger
    perform set_config('ctm.system', 'on', true);
    update auction_batch_items set sold_at = null, sale_price = null, sold_by = null, buyer_name = null, sale_notes = null where id = ql;
    update inventory_items set status = 'queued_for_auction' where id = q;
    execute 'set local role authenticated';
    begin perform record_auction_sale(q, 8000, 'TEST buyer'); s := s || '/sold again';
    exception when others then s := s || case when sqlerrm like 'The cash ledger already has an auction sale for this ticket (₱7,777.77)%' then '/refused' else '/' || sqlerrm end; end;
    r := auction_lines('queued', (select ticket_number from loans where id = ln), null, 1, 10);
    execute 'reset role';
    s := s || '/' || coalesce((r->'rows'->0->>'ledger_sale'), 'null') || '/' || (select count(*) from cash_flow_entries where related_loan_id = ln and description like 'Auction sale%');
    outcome := case when s = '1,7777.77/refused/7777.77/1' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Reserve decisions leave a trail: setting it (Operator) and changing it (Admin) each add a row to the audit log with who did it';
  begin
    if q is null or admin_id is null then outcome := 'SKIP (needs a queued item and an Admin)'; raise exception 'ROLLBACK'; end if;
    select count(*) into a0 from audit_log where table_name = 'auction_batch_items' and record_id::text = ql::text;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    perform set_auction_reserve(ql, 4000, false);
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform set_auction_reserve(ql, 4500, false);
    execute 'reset role';
    s := ((select count(*) from audit_log where table_name = 'auction_batch_items' and record_id::text = ql::text) - a0)
      || '|' || (select string_agg(actor::text, ',') from audit_log where table_name = 'auction_batch_items' and record_id::text = ql::text)
      || '|' || (select min_price || ',' || (reserve_set_by = admin_id) from auction_batch_items where id = ql);
    outcome := case when s like '2|%' and s like '%' || op_id || '%' and s like '%' || admin_id || '%' and s like '%|4500.00,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'The books agree: every sold item has a sale on a batch line, and no item is Sold without one (and the other way round)';
  outcome := case when
    not exists (select 1 from inventory_items i where i.status = 'sold' and not exists (select 1 from auction_batch_items bi where bi.inventory_item_id = i.id and bi.sold_at is not null))
    and not exists (select 1 from auction_batch_items bi join inventory_items i on i.id = bi.inventory_item_id where bi.sold_at is not null and i.status <> 'sold')
    then 'PASS' else 'FAIL' end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0053() from public, anon, authenticated;

-- applied only if every auction and audit self-test passes (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0053' t, * from public.ctm_selftest_0053() union all select '0052' t, * from public.ctm_selftest_0052()
    union all select 'audit' t, * from public.ctm_selftest_audit() union all select '0031' t, * from public.ctm_selftest_0031()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0053 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
