-- 0054 (Nov 12, 2026, Wush): Auction prep, the "details missing" block now also lives in the database.
-- The page (FI1) refuses to tick an item whose details are missing. That was only in the browser.
-- What the tables ALREADY guarantee (checked Nov 12): every vault item has an appraisal; every appraisal has a type,
--   a karat (1 to 24), a weight (more than 0), an A-number and an appraised value; every loan has a ticket number.
--   CTM only pawns gold jewelry, so karat and weight apply to every type (ring, chain, earrings, bracelet, pendant, others).
-- What they did NOT stop, and create_auction_batch / record_auction_sale now refuse, read from the records themselves
--   (nothing the browser sends is trusted):
--   - the appraisal was archived
--   - type "Others" with no description of what it is
--   - an appraised value of 0 or less
--   - no loan, or an empty ticket number
-- All 55 forfeited and queued items today pass these checks (the self-test checks that on every run).
-- Self-test: select * from public.ctm_selftest_0054();   (every test rolls back)

-- what is wrong with an item's own records for an auction (null = nothing)
create or replace function public.ctm_item_record_problem(p_item uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when ai.id is null then 'no appraisal record'
    when ai.archived_at is not null then 'the appraisal is archived'
    when ai.appraisal_no is null then 'no appraisal number'
    when ai.category is null then 'no item type'
    when ai.category::text = 'others' and coalesce(btrim(ai.category_other), '') = '' then 'type "Others" with no description'
    when ai.karat is null or ai.karat <= 0 then 'no karat'
    when ai.weight_grams is null or ai.weight_grams <= 0 then 'no weight'
    when ai.computed_value is null or ai.computed_value <= 0 then 'no appraised value'
    when ln.id is null then 'no loan'
    when coalesce(btrim(ln.ticket_number), '') = '' then 'no pawn ticket number'
  end
  from public.inventory_items i
  left join public.appraisal_items ai on ai.id = i.appraisal_item_id
  left join lateral (select x.id, x.ticket_number from public.loans x where x.inventory_item_id = i.id order by x.created_at desc limit 1) ln on true
  where i.id = p_item
$$;
revoke all on function public.ctm_item_record_problem(uuid) from public, anon, authenticated; -- only used inside the functions below

-- add the check to the two functions (the rest of each stays exactly as it is)
do $patch$
declare d text; d0 text;
begin
  select pg_get_functiondef('public.create_auction_batch(uuid[],text,numeric[],boolean[],date,text,uuid)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$  select count(*) into v_bad from unnest(p_item_ids) x(id) where public.ctm_item_audit_flag(x.id) = 'not_located';$a$,
    $b$  select count(*) into v_bad from unnest(p_item_ids) x(id) where public.ctm_item_record_problem(x.id) is not null;
  if v_bad > 0 then raise exception '% of the selected items have an incomplete appraisal or loan record and cannot go to auction. Ask an Admin to check the record.', v_bad; end if;
  select count(*) into v_bad from unnest(p_item_ids) x(id) where public.ctm_item_audit_flag(x.id) = 'not_located';$b$);
  if d = d0 then raise exception '0054: could not update create_auction_batch'; end if;
  execute d;

  select pg_get_functiondef('public.record_auction_sale(uuid,numeric,text,text,uuid)'::regprocedure) into d; d0 := d;
  d := replace(d, $a$  if public.ctm_item_audit_flag(i.id) = 'not_located' then$a$,
    $b$  if public.ctm_item_record_problem(i.id) is not null then
    raise exception 'This item''s record is incomplete (%). It can''t be sold until an Admin checks the record.', public.ctm_item_record_problem(i.id);
  end if;
  if public.ctm_item_audit_flag(i.id) = 'not_located' then$b$);
  if d = d0 then raise exception '0054: could not update record_auction_sale'; end if;
  execute d;
end $patch$;

create or replace function public.ctm_selftest_0054() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de'; -- an Operator account
  it uuid; it2 uuid; q uuid; ql uuid; b uuid; s text; n int; c0 int;
begin
  select i.id into it from inventory_items i where i.status = 'forfeited' and i.archived_at is null and ctm_item_audit_flag(i.id) is null order by i.id limit 1;
  select i.id into it2 from inventory_items i where i.status = 'forfeited' and i.archived_at is null and ctm_item_audit_flag(i.id) is null and i.id <> it order by i.id limit 1;
  select bi.inventory_item_id, bi.id into q, ql from auction_batch_items bi join inventory_items i on i.id = bi.inventory_item_id join loans l on l.inventory_item_id = i.id
    where bi.sold_at is null and bi.unsold_at is null and i.status = 'queued_for_auction' and bi.min_price is null and not bi.no_reserve
      and ctm_item_audit_flag(i.id) is null and ctm_loan_auction_revenue(l.id) is null order by bi.id limit 1;

  test := 'Existing records: every forfeited and queued item in the vault passes the record checks (nothing old is blocked by the new rule)';
  select count(*) into n from inventory_items i where i.status in ('forfeited', 'queued_for_auction') and i.archived_at is null and ctm_item_record_problem(i.id) is not null;
  outcome := case when n = 0 then 'PASS' else 'FAIL ' || n || ' items have an incomplete record' end;
  return next;

  test := 'Called straight at the database: an item with an incomplete record can''t be batched and can''t be sold, and nothing changes';
  begin
    if it is null or q is null then outcome := 'SKIP (needs a forfeited and a queued item)'; raise exception 'ROLLBACK'; end if;
    select count(*) into c0 from cash_flow_entries;
    perform set_config('ctm.system', 'on', true); -- break two records inside this test only (rolled back)
    update appraisal_items set category = 'others', category_other = null where id in (select appraisal_item_id from inventory_items where id in (it, q));
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    s := '';
    begin perform create_auction_batch(array[it], 'TEST', array[500]::numeric[], array[false]); s := s || 'batched';
    exception when others then s := s || case when sqlerrm like '%incomplete appraisal or loan record%' then '1' else sqlerrm end; end;
    begin perform create_auction_batch(array[it], 'TEST'); s := s || '/batched the old way';
    exception when others then s := s || case when sqlerrm like '%incomplete appraisal or loan record%' then '/2' else '/' || sqlerrm end; end;
    perform set_auction_reserve(ql, null, true);
    begin perform record_auction_sale(q, 5000, 'TEST buyer'); s := s || '/sold';
    exception when others then s := s || case when sqlerrm like 'This item''s record is incomplete (type "Others" with no description)%' then '/3' else '/' || sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || (select status from inventory_items where id = it) || '|' || (select status from inventory_items where id = q) || '|' || ((select count(*) from cash_flow_entries) - c0);
    outcome := case when s = '1/2/3|forfeited|queued_for_auction|0' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'The old page (still on the live site): its Create batch works; a typed price is kept, an empty one is saved as Not set (never as No reserve); its Record sale is refused safely';
  begin
    if it is null or it2 is null then outcome := 'SKIP (needs two forfeited items)'; raise exception 'ROLLBACK'; end if;
    select count(*) into c0 from cash_flow_entries;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    b := create_auction_batch(array[it, it2], 'TEST old page', array[5000, null]::numeric[]); -- exactly what the old page sends
    s := (select string_agg(coalesce(bi.min_price::text, 'null') || ',' || bi.no_reserve || ',' || (bi.reserve_set_at is not null), ';' order by (bi.inventory_item_id = it) desc) from auction_batch_items bi where bi.batch_id = b);
    begin perform record_auction_sale(it2, 1000); s := s || '/sold with no reserve decision';
    exception when others then s := s || case when sqlerrm like '%reserve price is not set yet%' then '/1' else '/' || sqlerrm end; end;
    begin perform record_auction_sale(it, 6000); s := s || '/sold with no buyer';
    exception when others then s := s || case when sqlerrm like 'Write the buyer%' then '/2' else '/' || sqlerrm end; end;
    begin perform record_auction_sale(it, 4000, 'TEST buyer'); s := s || '/sold below the price';
    exception when others then s := s || case when sqlerrm like '%below this item''s minimum price%' then '/3' else '/' || sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || (select string_agg(status::text, ',') from inventory_items where id in (it, it2)) || '|' || ((select count(*) from cash_flow_entries) - c0);
    outcome := case when s = '5000.00,false,true;null,false,false/1/2/3|queued_for_auction,queued_for_auction|0' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Ledger guard is exact: it only looks at entries linked to THIS item''s own loan (not at ticket text), and every item has one loan';
  outcome := case when (select coalesce(max(c), 0) from (select count(*) c from loans where inventory_item_id is not null group by inventory_item_id) z) <= 1
    and (select count(*) from inventory_items i join loans l on l.inventory_item_id = i.id where i.status = 'queued_for_auction' and ctm_loan_auction_revenue(l.id) is not null)
      = (select count(distinct c.related_loan_id) from cash_flow_entries c join loans l on l.id = c.related_loan_id join inventory_items i on i.id = l.inventory_item_id
         where c.entry_type = 'revenue' and c.direction = 'in' and c.description like 'Auction sale%' and c.archived_at is null and i.status = 'queued_for_auction')
    then 'PASS' else 'FAIL' end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0054() from public, anon, authenticated;

-- applied only if every auction and audit self-test passes (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0054' t, * from public.ctm_selftest_0054() union all select '0053' t, * from public.ctm_selftest_0053() union all select '0052' t, * from public.ctm_selftest_0052()
    union all select 'audit' t, * from public.ctm_selftest_audit() union all select '0031' t, * from public.ctm_selftest_0031()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0054 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
