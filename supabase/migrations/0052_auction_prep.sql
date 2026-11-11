-- 0052 (Nov 12, 2026, Wush): Auction prep, made safer. Matt's flow stays the same:
--   forfeited items -> create_auction_batch -> queued -> record_auction_sale -> sold (+ money in the cash ledger).
-- What is added on top (Wush's choices, Nov 12):
--   1. Reserve (minimum) price: before, an empty box quietly meant "no minimum". Now every item in a NEW batch needs
--      a price OR a deliberate "No reserve". Items queued before this have neither ("Not set"); someone sets it
--      (set_auction_reserve) before the item can be sold.
--   2. Unsold: before, an item that did not sell stayed "queued" forever. mark_auction_unsold puts it back to
--      Forfeited (still in the vault, ready for a later batch). The old batch keeps the line: reserve, unsold, who, why.
--   3. Record sale: still ONE step (sold + cash ledger, as Matt built it), but the buyer's name is now required and
--      an item whose reserve is "Not set" can't be sold.
--   4. Physical audit: an item marked Not located in a submitted audit (not followed up yet) can't be batched or
--      sold. Found elsewhere is only a warning on the page.
--   5. Batches get a number (AB-0001), an auction date and a place (both optional), and a one-time request id so
--      a double click makes one batch. One item can be in only one open batch line at a time.
-- NOT added: legal checks (P.D. 114 / BSP notices and publication). The system has no data for them; that needs
--   the group and the shop. Nothing here forfeits a loan or runs the default check.
-- Self-test: select * from public.ctm_selftest_0052();   (every test rolls back)

-- ---------- 1. new columns ----------
create sequence if not exists public.auction_batch_no_seq;
alter table public.auction_batches
  add column batch_no integer,                                                              -- shown as AB-0001
  add column auction_date date,                                                             -- when the auction is / was (optional)
  add column auction_place text check (auction_place is null or char_length(auction_place) <= 120),
  add column request_id uuid unique;                                                        -- the same Create sent twice = one batch
-- number the batches that exist, oldest first, then new ones get the next number
select set_config('ctm.system', 'on', true);
update public.auction_batches b set batch_no = z.n
from (select id, row_number() over (order by created_at, id) n from public.auction_batches) z where z.id = b.id;
select setval('public.auction_batch_no_seq', coalesce((select max(batch_no) from public.auction_batches), 0) + 1, false);
alter table public.auction_batches alter column batch_no set default nextval('public.auction_batch_no_seq'), alter column batch_no set not null;
create unique index auction_batches_batch_no on public.auction_batches (batch_no);

alter table public.auction_batch_items
  add column no_reserve boolean not null default false,                                     -- true = "No reserve" was chosen on purpose
  add column reserve_set_by uuid references public.profiles(id),
  add column reserve_set_at timestamptz,
  add column unsold_at timestamptz,                                                         -- the item did not sell in this batch
  add column unsold_by uuid references public.profiles(id),
  add column unsold_reason text check (unsold_reason is null or char_length(unsold_reason) between 5 and 300),
  add constraint auction_batch_items_reserve_one check (not (no_reserve and min_price is not null)),      -- a price or No reserve, never both
  add constraint auction_batch_items_one_outcome check (not (sold_at is not null and unsold_at is not null)), -- sold or unsold, never both
  add constraint auction_batch_items_unsold_whole check ((unsold_at is null) = (unsold_by is null) and (unsold_at is null) = (unsold_reason is null));
-- the items queued before this keep "Not set" (min_price null, no_reserve false); the ones that had a price keep it
update public.auction_batch_items set reserve_set_at = (select created_at from public.auction_batches b where b.id = batch_id),
  reserve_set_by = (select created_by from public.auction_batches b where b.id = batch_id) where min_price is not null;
select set_config('ctm.system', 'off', true);
-- one open line per item (not sold, not unsold): the same item can't be waiting in two batches
create unique index auction_batch_items_one_open on public.auction_batch_items (inventory_item_id) where sold_at is null and unsold_at is null;

-- ---------- 2. the Physical audit link ----------
-- 'not_located' = blocked (a submitted audit could not find it and nobody followed up); 'found_elsewhere' = warning
create or replace function public.ctm_item_audit_flag(p_item uuid) returns text
language sql stable security definer set search_path = public as $$
  select l.result from public.physical_inventory_audit_items l
  join public.physical_inventory_audits a on a.id = l.audit_id
  where l.inventory_item_id = p_item and a.status = 'submitted' and a.archived_at is null
    and l.result in ('not_located', 'found_elsewhere') and l.resolved_at is null
  order by (l.result = 'not_located') desc limit 1
$$;
revoke all on function public.ctm_item_audit_flag(uuid) from public, anon, authenticated; -- only used inside the functions below

-- ---------- 3. create a batch (Matt's function, with the new checks) ----------
drop function if exists public.create_auction_batch(uuid[], text, numeric[]);
create or replace function public.create_auction_batch(p_item_ids uuid[], p_notes text default null, p_min_prices numeric[] default null,
  p_no_reserve boolean[] default null, p_auction_date date default null, p_auction_place text default null, p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_batch uuid; v_bad int; n int := coalesce(array_length(p_item_ids, 1), 0); k int;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]); -- Operator or Admin
  if p_request_id is not null then -- the same Create sent twice (double click, retry)
    select id into v_batch from public.auction_batches where request_id = p_request_id;
    if found then return v_batch; end if;
  end if;
  if n = 0 then raise exception 'Select at least one forfeited item'; end if;
  if (select count(distinct x) from unnest(p_item_ids) x) <> n then raise exception 'An item was selected twice. Reload the page and try again.'; end if;
  if coalesce(array_length(p_min_prices, 1), 0) <> n or coalesce(array_length(p_no_reserve, 1), 0) <> n then
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
  for k in 1..n loop -- a price (more than 0) or No reserve for every item, never both, never neither
    if coalesce(p_no_reserve[k], false) then
      if p_min_prices[k] is not null then raise exception 'An item has both a reserve price and "No reserve". Pick one.'; end if;
    elsif p_min_prices[k] is null then raise exception 'Every item needs a reserve price, or "No reserve" ticked on purpose.';
    elsif p_min_prices[k] <= 0 or p_min_prices[k] > 10000000 then raise exception 'A reserve price must be more than 0 (and not more than 10,000,000).';
    end if;
  end loop;
  if char_length(coalesce(p_notes, '')) > 500 then raise exception 'Keep the batch note to 500 characters or less.'; end if;
  if char_length(btrim(coalesce(p_auction_place, ''))) > 120 then raise exception 'Keep the auction place to 120 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  insert into public.auction_batches (created_by, notes, auction_date, auction_place, request_id)
  values (auth.uid(), nullif(trim(p_notes), ''), p_auction_date, nullif(btrim(coalesce(p_auction_place, '')), ''), p_request_id) returning id into v_batch;
  insert into public.auction_batch_items (batch_id, inventory_item_id, min_price, no_reserve, reserve_set_by, reserve_set_at)
  select v_batch, x.id, round(p_min_prices[x.n], 2), coalesce(p_no_reserve[x.n], false), auth.uid(), now()
  from unnest(p_item_ids) with ordinality x(id, n);
  update public.inventory_items set status = 'queued_for_auction' where id = any (p_item_ids);
  return v_batch;
end $$;
revoke all on function public.create_auction_batch(uuid[], text, numeric[], boolean[], date, text, uuid) from public, anon;
grant execute on function public.create_auction_batch(uuid[], text, numeric[], boolean[], date, text, uuid) to authenticated;

-- ---------- 4. set the reserve of an item that is already queued ("Not set" from before 0052) ----------
-- Operator or Admin can set it once. Changing a reserve that is already set is for an Admin only.
create or replace function public.set_auction_reserve(p_line uuid, p_min_price numeric, p_no_reserve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare b public.auction_batch_items; r public.staff_role;
begin
  r := public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into b from public.auction_batch_items where id = p_line for update;
  if not found then raise exception 'Item not found in a batch. Reload the page.'; end if;
  if b.sold_at is not null or b.unsold_at is not null then raise exception 'This item is no longer waiting in that batch.'; end if;
  if (b.min_price is not null or b.no_reserve) and r <> 'admin' then raise exception 'The reserve is already set. Only an Admin can change it.'; end if;
  if coalesce(p_no_reserve, false) then
    if p_min_price is not null then raise exception 'Pick a reserve price or "No reserve", not both.'; end if;
  elsif p_min_price is null or p_min_price <= 0 or p_min_price > 10000000 then raise exception 'Enter a reserve price of more than 0, or tick "No reserve".';
  end if;
  perform set_config('ctm.system', 'on', true);
  update public.auction_batch_items set min_price = round(p_min_price, 2), no_reserve = coalesce(p_no_reserve, false), reserve_set_by = auth.uid(), reserve_set_at = now() where id = b.id;
end $$;
revoke all on function public.set_auction_reserve(uuid, numeric, boolean) from public, anon;
grant execute on function public.set_auction_reserve(uuid, numeric, boolean) to authenticated;

-- ---------- 5. record a sale (Matt's function; new: reserve must be decided, buyer required, audit block) ----------
create or replace function public.record_auction_sale(p_item_id uuid, p_sale_price numeric, p_buyer text default null, p_notes text default null, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.inventory_items; b public.auction_batch_items; l public.loans; v_seen jsonb; v_result jsonb; v_entry uuid;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into i from public.inventory_items where id = p_item_id for update; -- the lock: two people can't sell it at once
  if not found or i.archived_at is not null then raise exception 'Item not found'; end if;
  select * into l from public.loans where inventory_item_id = i.id;
  v_seen := public.ctm_request_seen(p_request_id, 'sale', l.id);
  if v_seen is not null then return v_seen; end if;
  if i.status = 'sold' then raise exception 'This item is already marked sold.'; end if;
  if i.status <> 'queued_for_auction' then raise exception 'Only items queued for auction can be sold. Put it in an auction batch first.'; end if;
  select bi.* into b from public.auction_batch_items bi join public.auction_batches ab on ab.id = bi.batch_id
  where bi.inventory_item_id = i.id and ab.archived_at is null and bi.sold_at is null and bi.unsold_at is null order by ab.created_at desc limit 1;
  if not found then raise exception 'This item is not in an open auction batch.'; end if;
  if b.min_price is null and not b.no_reserve then raise exception 'This item''s reserve price is not set yet. Set a price or "No reserve" first.'; end if;
  if public.ctm_item_audit_flag(i.id) = 'not_located' then raise exception 'This item could not be located in the last physical audit. Follow that up on the Physical audit page first.'; end if;
  if p_sale_price is null or p_sale_price <= 0 then raise exception 'Enter the sale price (more than 0).'; end if;
  if b.min_price is not null and p_sale_price < b.min_price then
    raise exception 'The sale price is below this item''s minimum price (₱%).', to_char(b.min_price, 'FM999,999,990.00');
  end if;
  if char_length(btrim(coalesce(p_buyer, ''))) < 2 then raise exception 'Write the buyer''s name.'; end if;
  if char_length(trim(p_buyer)) > 120 then raise exception 'Keep the buyer name to 120 characters or less.'; end if;
  if p_notes is not null and char_length(trim(p_notes)) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  update public.auction_batch_items set sold_at = now(), sale_price = round(p_sale_price, 2), sold_by = auth.uid(),
    buyer_name = trim(p_buyer), sale_notes = nullif(trim(p_notes), '')
  where id = b.id;
  update public.inventory_items set status = 'sold' where id = i.id;
  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
  values ('revenue', 'in', round(p_sale_price, 2), 'Auction sale of the item from ' || l.ticket_number, l.id, auth.uid())
  returning id into v_entry;
  v_result := jsonb_build_object('item_id', i.id, 'sale_price', round(p_sale_price, 2), 'cash_entry_id', v_entry);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'sale', l.id, v_result); end if;
  return v_result;
end $$;

-- ---------- 6. the item did not sell ----------
-- It goes back to Forfeited: still in the vault, and it can be put in a later batch. No money is recorded.
create or replace function public.mark_auction_unsold(p_item_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inventory_items; b public.auction_batch_items;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  select * into i from public.inventory_items where id = p_item_id for update;
  if not found or i.archived_at is not null then raise exception 'Item not found'; end if;
  if i.status = 'sold' then raise exception 'This item is already marked sold.'; end if;
  if i.status <> 'queued_for_auction' then raise exception 'This item is not queued for auction any more. Reload the page.'; end if;
  select bi.* into b from public.auction_batch_items bi where bi.inventory_item_id = i.id and bi.sold_at is null and bi.unsold_at is null for update;
  if not found then raise exception 'This item is not in an open auction batch.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Write why it was not sold (at least 5 characters).'; end if;
  if char_length(btrim(p_reason)) > 300 then raise exception 'Keep the reason to 300 characters or less.'; end if;
  perform set_config('ctm.system', 'on', true);
  update public.auction_batch_items set unsold_at = now(), unsold_by = auth.uid(), unsold_reason = btrim(p_reason) where id = b.id;
  update public.inventory_items set status = 'forfeited' where id = i.id; -- back on the Prepare items list
end $$;
revoke all on function public.mark_auction_unsold(uuid, text) from public, anon;
grant execute on function public.mark_auction_unsold(uuid, text) to authenticated;

-- ---------- 7. reading: one function for the three lists of batch lines, with search and pages ----------
-- p_kind: 'queued' (waiting), 'sold', 'batch' (every line of one batch). The search runs in the database, so the
-- browser only gets the rows of one page.
create or replace function public.auction_lines(p_kind text, p_q text default null, p_batch uuid default null, p_page integer default 1, p_size integer default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_size int := least(greatest(coalesce(p_size, 10), 5), 100);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_like text; v_ano int; res jsonb;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  if p_kind not in ('queued', 'sold', 'batch') then raise exception 'Unknown list.'; end if;
  if v_q is not null then
    v_q := left(v_q, 80);
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; -- typed % or _ are plain letters
    if v_q ~* '^a[\s-]?\d{1,9}$' then v_ano := regexp_replace(v_q, '\D', '', 'g')::int; end if; -- "A-0045" = appraisal 45
  end if;
  with base as (
    select bi.id, bi.batch_id, ab.batch_no, ab.created_at as batch_at, ab.notes as batch_notes, ab.auction_date,
           bi.min_price, bi.no_reserve, bi.sold_at, bi.sale_price, bi.buyer_name, bi.sale_notes, sp.full_name as sold_by_name,
           bi.unsold_at, bi.unsold_reason, up.full_name as unsold_by_name,
           i.id as inventory_item_id, i.status::text as item_status, i.vault_location,
           ai.id as appraisal_item_id, ai.appraisal_no, ai.category::text as category, ai.category_other, ai.karat, ai.weight_grams, ai.computed_value,
           coalesce(array_length(ai.photo_paths, 1), 0) as photo_count, c.full_name as customer_name,
           ln.id as loan_id, ln.ticket_number, public.ctm_item_audit_flag(i.id) as audit_flag
    from public.auction_batch_items bi
    join public.auction_batches ab on ab.id = bi.batch_id
    join public.inventory_items i on i.id = bi.inventory_item_id
    left join public.appraisal_items ai on ai.id = i.appraisal_item_id
    left join public.customers c on c.id = ai.customer_id
    left join public.profiles sp on sp.id = bi.sold_by
    left join public.profiles up on up.id = bi.unsold_by
    left join lateral (select x.id, x.ticket_number from public.loans x where x.inventory_item_id = i.id order by x.created_at desc limit 1) ln on true
    where ab.archived_at is null
      and case p_kind when 'queued' then bi.sold_at is null and bi.unsold_at is null and i.status = 'queued_for_auction'
                      when 'sold' then bi.sold_at is not null
                      else bi.batch_id = p_batch end
      and (p_batch is null or bi.batch_id = p_batch)
  ), filtered as (
    select * from base b
    where v_q is null or b.appraisal_no = v_ano or b.ticket_number ilike v_like or b.category ilike v_like or b.category_other ilike v_like
       or b.customer_name ilike v_like or b.vault_location ilike v_like or b.buyer_name ilike v_like or lower(v_q) = b.karat || 'k'
       or ('ab-' || lpad(b.batch_no::text, 4, '0')) ilike v_like
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'sum', (select coalesce(sum(sale_price), 0) from filtered),
    'page', v_page, 'size', v_size,
    'rows', (select coalesce(jsonb_agg(to_jsonb(f) order by f.ord), '[]'::jsonb) from (
        select x.*, row_number() over (order by case when p_kind = 'sold' then x.sold_at end desc nulls last, x.batch_at, x.appraisal_no nulls last, x.id) as ord
        from filtered x
        order by case when p_kind = 'sold' then x.sold_at end desc nulls last, x.batch_at, x.appraisal_no nulls last, x.id
        offset (v_page - 1) * v_size limit v_size) f)
  ) into res;
  return res;
end $$;
revoke all on function public.auction_lines(text, text, uuid, integer, integer) from public, anon;
grant execute on function public.auction_lines(text, text, uuid, integer, integer) to authenticated;

-- the forfeited items waiting for a batch, each with whether it can go in one (the same checks create_auction_batch does)
create or replace function public.auction_prepare_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  return coalesce((
    select jsonb_agg(to_jsonb(z) order by z.vault_location, z.appraisal_no nulls last, z.id) from (
      select i.id, i.vault_location, ai.id as appraisal_item_id, ai.appraisal_no, ai.category::text as category, ai.category_other, ai.karat, ai.weight_grams,
             ai.computed_value, coalesce(array_length(ai.photo_paths, 1), 0) as photo_count, c.full_name as customer_name,
             ln.id as loan_id, ln.ticket_number, ln.status::text as loan_status, ln.forfeited_at,
             public.ctm_item_audit_flag(i.id) as audit_flag,
             exists (select 1 from public.auction_batch_items bi where bi.inventory_item_id = i.id and bi.sold_at is null and bi.unsold_at is null) as in_open_batch,
             -- the last time it was in a batch and did not sell
             (select jsonb_build_object('batch_no', ab.batch_no, 'at', bi.unsold_at, 'reason', bi.unsold_reason, 'min_price', bi.min_price, 'no_reserve', bi.no_reserve)
              from public.auction_batch_items bi join public.auction_batches ab on ab.id = bi.batch_id
              where bi.inventory_item_id = i.id and bi.unsold_at is not null order by bi.unsold_at desc limit 1) as last_unsold
      from public.inventory_items i
      left join public.appraisal_items ai on ai.id = i.appraisal_item_id
      left join public.customers c on c.id = ai.customer_id
      left join lateral (select x.id, x.ticket_number, x.status, x.forfeited_at from public.loans x where x.inventory_item_id = i.id order by x.created_at desc limit 1) ln on true
      where i.status = 'forfeited' and i.archived_at is null
      limit 1000) z), '[]'::jsonb);
end $$;
revoke all on function public.auction_prepare_list() from public, anon;
grant execute on function public.auction_prepare_list() to authenticated;

-- ---------- 8. self-test ----------
create or replace function public.ctm_selftest_0052() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  admin_id uuid; who uuid;
  it uuid; it2 uuid; q uuid; ql uuid; b uuid; b2 uuid; a uuid; l uuid; s text; n int; c0 int; r jsonb; rid uuid := gen_random_uuid();
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  -- two forfeited items (the Prepare list) and one queued item with its open batch line
  select i.id into it from inventory_items i where i.status = 'forfeited' and i.archived_at is null and ctm_item_audit_flag(i.id) is null order by i.id limit 1;
  select i.id into it2 from inventory_items i where i.status = 'forfeited' and i.archived_at is null and i.id <> it order by i.id limit 1;
  select bi.inventory_item_id, bi.id into q, ql from auction_batch_items bi join inventory_items i on i.id = bi.inventory_item_id
    where bi.sold_at is null and bi.unsold_at is null and i.status = 'queued_for_auction' and bi.min_price is null and not bi.no_reserve and ctm_item_audit_flag(i.id) is null order by bi.id limit 1;

  test := 'Old batches kept: every batch has its own number; no item waits in two batches; items queued before this show Not set';
  select count(*) into n from auction_batches where batch_no is null;
  outcome := case when n = 0 and (select count(*) = count(distinct batch_no) from auction_batches)
    and not exists (select 1 from auction_batch_items group by inventory_item_id having count(*) filter (where sold_at is null and unsold_at is null) > 1)
    then 'PASS' else 'FAIL' end;
  return next;

  test := 'Create batch: needs a price or No reserve for every item (never both, never neither, never 0); a double click makes one batch; the same item can''t be batched twice';
  begin
    if it is null then outcome := 'SKIP (no forfeited item to test with)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    s := '';
    begin perform create_auction_batch(array[it], 'TEST'); s := s || 'no reserve info saved';
    exception when others then s := s || case when sqlerrm like 'Each selected item needs%' then '1' else sqlerrm end; end;
    begin perform create_auction_batch(array[it], 'TEST', array[null]::numeric[], array[false]); s := s || '/neither saved';
    exception when others then s := s || case when sqlerrm like 'Every item needs a reserve%' then '/2' else '/' || sqlerrm end; end;
    begin perform create_auction_batch(array[it], 'TEST', array[500]::numeric[], array[true]); s := s || '/both saved';
    exception when others then s := s || case when sqlerrm like '%both a reserve price%' then '/3' else '/' || sqlerrm end; end;
    begin perform create_auction_batch(array[it], 'TEST', array[0]::numeric[], array[false]); s := s || '/zero saved';
    exception when others then s := s || case when sqlerrm like 'A reserve price must be more than 0%' then '/4' else '/' || sqlerrm end; end;
    begin perform create_auction_batch(array[it, it], 'TEST', array[500, 500]::numeric[], array[false, false]); s := s || '/twice in one saved';
    exception when others then s := s || case when sqlerrm like 'An item was selected twice%' then '/5' else '/' || sqlerrm end; end;
    b := create_auction_batch(array[it], 'TEST batch', array[null]::numeric[], array[true], current_date + 7, 'TEST place', rid);
    b2 := create_auction_batch(array[it], 'TEST batch', array[null]::numeric[], array[true], current_date + 7, 'TEST place', rid); -- the same request again
    s := s || '/' || (b = b2)::text;
    begin perform create_auction_batch(array[it], 'TEST again', array[900]::numeric[], array[false]); s := s || '/batched again';
    exception when others then s := s || case when sqlerrm like '%not forfeited by an Admin%' then '/6' else '/' || sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || (select bi.no_reserve || ',' || (bi.min_price is null) || ',' || (bi.reserve_set_by = op_id) from auction_batch_items bi where bi.batch_id = b)
           || '|' || (select status from inventory_items where id = it) || '|' || (select (batch_no is not null) || ',' || auction_place from auction_batches where id = b);
    outcome := case when s = '1/2/3/4/5/true/6|true,true,true|queued_for_auction|true,TEST place' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Sale: refused while the reserve is Not set; an Operator sets it once, only an Admin changes it; below the reserve and no buyer are refused; a sale saves once, with one ledger entry, and the item can''t be sold or marked unsold after';
  begin
    if q is null then outcome := 'SKIP (no queued item with a reserve not set)'; raise exception 'ROLLBACK'; end if;
    select count(*) into c0 from cash_flow_entries;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    s := '';
    begin perform record_auction_sale(q, 5000, 'TEST buyer'); s := s || 'sold with no reserve decision';
    exception when others then s := s || case when sqlerrm like '%reserve price is not set yet%' then '1' else sqlerrm end; end;
    perform set_auction_reserve(ql, 4000, false);
    begin perform set_auction_reserve(ql, 100, false); s := s || '/operator changed it';
    exception when others then s := s || case when sqlerrm like '%Only an Admin can change it%' then '/2' else '/' || sqlerrm end; end;
    begin perform record_auction_sale(q, 3999.99, 'TEST buyer'); s := s || '/sold below reserve';
    exception when others then s := s || case when sqlerrm like '%below this item''s minimum price%' then '/3' else '/' || sqlerrm end; end;
    begin perform record_auction_sale(q, 5000, ' '); s := s || '/sold with no buyer';
    exception when others then s := s || case when sqlerrm like 'Write the buyer%' then '/4' else '/' || sqlerrm end; end;
    r := record_auction_sale(q, 5000, 'TEST buyer', 'TEST sale', rid);
    r := record_auction_sale(q, 5000, 'TEST buyer', 'TEST sale', rid); -- the same form again: nothing new
    begin perform record_auction_sale(q, 6000, 'TEST other buyer'); s := s || '/sold twice';
    exception when others then s := s || case when sqlerrm like '%already marked sold%' then '/5' else '/' || sqlerrm end; end;
    begin perform mark_auction_unsold(q, 'TEST not sold after all'); s := s || '/unsold after sale';
    exception when others then s := s || case when sqlerrm like '%already marked sold%' then '/6' else '/' || sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || ((select count(*) from cash_flow_entries) - c0) || '|' || (select status from inventory_items where id = q)
           || '|' || (select bi.sale_price || ',' || bi.buyer_name || ',' || (bi.sold_by = op_id) from auction_batch_items bi where bi.id = ql);
    outcome := case when s = '1/2/3/4/5/6|1|sold|5000.00,TEST buyer,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Unsold: needs a reason; the item goes back to Forfeited with no money recorded; the old batch keeps the line; it can go into a new batch; it can''t be sold from the old one';
  begin
    if q is null then outcome := 'SKIP (no queued item)'; raise exception 'ROLLBACK'; end if;
    select count(*) into c0 from cash_flow_entries;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    s := '';
    begin perform mark_auction_unsold(q, 'no'); s := s || 'no reason saved';
    exception when others then s := s || case when sqlerrm like 'Write why it was not sold%' then '1' else sqlerrm end; end;
    perform mark_auction_unsold(q, 'TEST no bids at the auction');
    begin perform mark_auction_unsold(q, 'TEST a second time'); s := s || '/twice';
    exception when others then s := s || case when sqlerrm like '%not queued for auction any more%' then '/2' else '/' || sqlerrm end; end;
    begin perform record_auction_sale(q, 5000, 'TEST buyer'); s := s || '/sold after unsold';
    exception when others then s := s || case when sqlerrm like 'Only items queued for auction%' then '/3' else '/' || sqlerrm end; end;
    b := create_auction_batch(array[q], 'TEST second try', array[3000]::numeric[], array[false]);
    execute 'reset role';
    s := s || '|' || ((select count(*) from cash_flow_entries) - c0) || '|' || (select status from inventory_items where id = q)
           || '|' || (select (bi.unsold_by = op_id) || ',' || bi.unsold_reason from auction_batch_items bi where bi.id = ql)
           || '|' || (select count(*) from auction_batch_items bi where bi.inventory_item_id = q);
    outcome := case when s = '1/2/3|0|queued_for_auction|true,TEST no bids at the auction|2' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Physical audit link: an item marked Not located in a submitted audit can''t be batched or sold; Found elsewhere is allowed';
  begin
    if it is null or q is null then outcome := 'SKIP (needs a forfeited and a queued item)'; raise exception 'ROLLBACK'; end if;
    perform set_config('ctm.system', 'on', true); -- a clean slate for audits inside this test only (rolled back)
    update physical_inventory_audits set status = 'discarded', archived_at = now() where status = 'in_progress' and archived_at is null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    a := start_inventory_audit(null, null);
    perform record_audit_result((select x.id from physical_inventory_audit_items x where x.audit_id = a and x.inventory_item_id = it), 'not_located', 0, 'not_at_location', 'TEST');
    perform record_audit_result((select x.id from physical_inventory_audit_items x where x.audit_id = a and x.inventory_item_id = q), 'not_located', 0, 'not_at_location', 'TEST');
    if it2 is not null then perform record_audit_result((select x.id from physical_inventory_audit_items x where x.audit_id = a and x.inventory_item_id = it2), 'found_elsewhere', 0, null, null, 'TEST other shelf'); end if;
    perform submit_audit_session(a, true);
    s := '';
    begin perform create_auction_batch(array[it], 'TEST', array[500]::numeric[], array[false]); s := s || 'missing item batched';
    exception when others then s := s || case when sqlerrm like '%could not be located in the last physical audit%' then '1' else sqlerrm end; end;
    perform set_auction_reserve(ql, null, true);
    begin perform record_auction_sale(q, 5000, 'TEST buyer'); s := s || '/missing item sold';
    exception when others then s := s || case when sqlerrm like '%could not be located in the last physical audit%' then '/2' else '/' || sqlerrm end; end;
    if it2 is not null then
      begin perform create_auction_batch(array[it2], 'TEST', array[500]::numeric[], array[false]); s := s || '/3';
      exception when others then s := s || '/' || sqlerrm; end;
    else s := s || '/3'; end if;
    execute 'reset role';
    outcome := case when s = '1/2/3' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Roles, straight at the database: Cashier and Appraiser are refused by every auction function; an Operator can''t write the batch tables directly';
  begin
    s := '';
    execute 'set local role authenticated';
    foreach who in array array[cash_id, appr_id] loop
      perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
      begin perform create_auction_batch(array[coalesce(it, gen_random_uuid())], 'TEST', array[500]::numeric[], array[false]); s := s || 'B'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '1' else '?' end; end;
      begin perform record_auction_sale(coalesce(q, gen_random_uuid()), 5000, 'TEST buyer'); s := s || 'S'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '2' else '?' end; end;
      begin perform mark_auction_unsold(coalesce(q, gen_random_uuid()), 'TEST reason'); s := s || 'U'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '3' else '?' end; end;
      begin perform set_auction_reserve(coalesce(ql, gen_random_uuid()), 500, false); s := s || 'R'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '4' else '?' end; end;
      begin perform auction_lines('queued'); s := s || 'L'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '5' else '?' end; end;
      begin perform auction_prepare_list(); s := s || 'P'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '6' else '?' end; end;
      s := s || ' ';
    end loop;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin insert into auction_batches (created_by, notes) values (op_id, 'TEST direct'); s := s || 'batch inserted'; exception when others then s := s || 'a'; end;
    begin update auction_batch_items set sold_at = now(), sale_price = 1, sold_by = op_id where id = ql; if found then s := s || 'line updated'; else s := s || 'b'; end if; exception when others then s := s || 'b'; end;
    begin update inventory_items set status = 'sold' where id = q; if found then s := s || 'item updated'; else s := s || 'c'; end if; exception when others then s := s || 'c'; end;
    r := auction_lines('queued', null, null, 1, 10);
    s := s || '|' || (jsonb_array_length(r->'rows') <= 10)::text;
    execute 'reset role';
    outcome := case when s = '123456 123456 abc|true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0052() from public, anon, authenticated;

-- ---------- 9. Matt's older self-test (0031) called the functions the old way; teach it the new rules ----------
-- (a sale now needs a reserve decision and a buyer; a batch needs a price or No reserve for every item)
do $patch$
declare d text; d0 text;
begin
  select pg_get_functiondef('public.ctm_selftest_0031()'::regprocedure) into d; d0 := d;
  d := replace(d, $a$r1 := record_auction_sale(q_item, 12345.50, 'SELFTEST buyer', 'SELFTEST', rid);$a$,
    $b$execute 'reset role'; perform set_config('ctm.system', 'on', true);
    update auction_batch_items set no_reserve = true where inventory_item_id = q_item and sold_at is null and unsold_at is null and min_price is null;
    execute 'set local role authenticated';
    r1 := record_auction_sale(q_item, 12345.50, 'SELFTEST buyer', 'SELFTEST', rid);$b$);
  d := replace(d, $a$create_auction_batch(array[f_item], 'SELFTEST', array[5000.00]::numeric[]);$a$, $b$create_auction_batch(array[f_item], 'SELFTEST', array[5000.00]::numeric[], array[false]);$b$);
  d := replace(d, $a$record_auction_sale(f_item, 4999.99);$a$, $b$record_auction_sale(f_item, 4999.99, 'SELFTEST buyer');$b$);
  d := replace(d, $a$record_auction_sale(f_item, 5000);$a$, $b$record_auction_sale(f_item, 5000, 'SELFTEST buyer');$b$);
  d := replace(d, $a$old 2-input create_auction_batch call still works (no minimum price)$a$, $b$since 0052: a batch with No reserve chosen on purpose saves no minimum price$b$);
  d := replace(d, $a$create_auction_batch(array[f_item], 'SELFTEST');$a$, $b$create_auction_batch(array[f_item], 'SELFTEST', array[null]::numeric[], array[true]);$b$);
  if d = d0 then raise exception '0052: could not update ctm_selftest_0031'; end if;
  execute d;
end $patch$;

-- applied only if these pass (the whole migration rolls back otherwise); the audit self-tests run too, because
-- the auction functions now read the audit tables
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0052' t, * from public.ctm_selftest_0052() union all select 'audit' t, * from public.ctm_selftest_audit()
    union all select '0031' t, * from public.ctm_selftest_0031()) z where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0052 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
