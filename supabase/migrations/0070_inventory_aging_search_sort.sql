-- 0070 (Nov 13, 2026, Wush): Inventory aging report: search, vault location, sort, audit follow-ups, links.
-- No item, loan, audit finding, customer or any other record is changed by this migration. The rules for "still in
-- the shop" (In vault / Forfeited / Queued for auction), days held (Manila calendar days from the day the item came
-- in) and the age groups are exactly the same as in 0066, and the Admin-only check is unchanged.
--
-- Why a database change is needed (the page can't do this on its own): the page receives only the 10 items it
-- shows, so a search, a vault filter or a sort done in the page would only rearrange or cut those 10, and the
-- counts and page numbers would be wrong. They have to be done where all items are.
--
-- report_inventory_aging now also takes:
--   p_q         search: A-number (A-0045, a45) or C-number (C-0012) = only that appraisal or customer; any other
--               text = customer name, ticket number, category or vault location;
--   p_vault     one vault location, exactly as recorded on the items;
--   p_followup  true = only items with an unresolved physical-audit finding (same rule as the Physical audit page's
--               "Items to follow up": result Not located or Found elsewhere, not resolved, audit submitted);
--   p_sort      'oldest' (the default and the old order), 'newest', 'vault', 'category', 'customer';
--               the item ID breaks ties so pages never overlap.
-- and returns:
--   all_band_counts   items per age group for EVERYTHING in the shop (before any filter), for the summary;
--   vaults            each vault location in use with its number of items, for the Vault location filter;
--   followup_count    items in the shop with an unresolved audit finding;
--   in each row       appraisal_item_id, customer_id, customer_no, loan_id + ticket_number (the item's newest loan),
--                     followup (true/false), so the page can link the A-number, the customer and the loan.
-- The old 4-argument call still works (the new arguments are optional), so the deployed site keeps working.
-- Self-test: select * from public.ctm_selftest_0070();   (every test rolls back)

drop function if exists public.report_inventory_aging(text, text, integer, integer);

create or replace function public.report_inventory_aging(p_custody text default null, p_band text default null,
  p_page integer default 1, p_size integer default 50,
  p_q text default null, p_vault text default null, p_followup boolean default null, p_sort text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.ctm_today();
  v_size int := least(greatest(coalesce(p_size, 50), 5), 1000);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_vault text := nullif(btrim(coalesce(p_vault, '')), '');
  v_sort text := coalesce(p_sort, 'oldest');
  v_like text; v_ano int; v_cno int; res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only
  if p_custody is not null and p_custody not in ('vault', 'forfeited', 'auction') then raise exception 'Unknown filter.'; end if;
  if p_band is not null and p_band not in ('0_30', '31_60', '61_90', 'over_90') then raise exception 'Unknown filter.'; end if;
  if v_sort not in ('oldest', 'newest', 'vault', 'category', 'customer') then raise exception 'Unknown sort.'; end if;
  if v_q is not null then
    v_q := left(v_q, 80);
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; -- typed % or _ are plain letters
    if v_q ~* '^a[\s-]?\d{1,9}$' then v_ano := regexp_replace(v_q, '\D', '', 'g')::int; end if; -- "A-0045" = appraisal 45
    if v_q ~* '^c[\s-]?\d{1,9}$' then v_cno := regexp_replace(v_q, '\D', '', 'g')::int; end if; -- "C-0012" = customer 12
  end if;
  with items as (
    select i.id, i.vault_location, i.status::text as status, i.created_at,
           (i.created_at at time zone 'Asia/Manila')::date as received,
           v_today - (i.created_at at time zone 'Asia/Manila')::date as days,
           case when i.status in ('pawned', 'extended') then 'vault' when i.status = 'forfeited' then 'forfeited' else 'auction' end as custody,
           a.id as appraisal_item_id, a.appraisal_no, a.category::text as category, a.category_other, a.karat, a.weight_grams,
           c.id as customer_id, c.full_name as customer_name, c.customer_no,
           ln.id as loan_id, ln.ticket_number,
           exists (select 1 from public.physical_inventory_audit_items l join public.physical_inventory_audits au on au.id = l.audit_id
                   where l.inventory_item_id = i.id and l.result in ('not_located', 'found_elsewhere') and l.resolved_at is null
                     and au.status = 'submitted' and au.archived_at is null) as followup
    from public.inventory_items i
    left join public.appraisal_items a on a.id = i.appraisal_item_id
    left join public.customers c on c.id = a.customer_id
    left join lateral (select x.id, x.ticket_number from public.loans x where x.inventory_item_id = i.id and x.archived_at is null
                       order by x.created_at desc limit 1) ln on true
    where i.archived_at is null and i.status in ('pawned', 'extended', 'forfeited', 'queued_for_auction')
  ), banded as (
    select x.*, case when x.days <= 30 then '0_30' when x.days <= 60 then '31_60' when x.days <= 90 then '61_90' else 'over_90' end as band from items x
  ), in_group as (
    select * from banded b where p_custody is null or b.custody = p_custody
  ), matching as (
    select * from in_group g
    where (p_band is null or g.band = p_band)
      and (v_vault is null or g.vault_location = v_vault)
      and (p_followup is not true or g.followup)
      -- an A-number or C-number finds only that appraisal or customer; any other text looks in the names and words
      and (v_q is null or (v_ano is not null and g.appraisal_no = v_ano) or (v_cno is not null and g.customer_no = v_cno)
           or (v_ano is null and v_cno is null and (g.customer_name ilike v_like or g.ticket_number ilike v_like
               or g.vault_location ilike v_like or replace(g.category, '_', ' ') ilike v_like or g.category_other ilike v_like)))
  ), numbered as (
    select m.*, row_number() over (order by
        case when v_sort = 'newest' then m.created_at end desc,
        case when v_sort = 'vault' then lower(m.vault_location) end asc,
        case when v_sort = 'category' then m.category end asc,
        case when v_sort = 'category' then m.karat end asc,
        case when v_sort = 'customer' then lower(m.customer_name) end asc,
        m.created_at, m.id) as rn
    from matching m
  ), pg as (
    select greatest(1, least(v_page, ceil((select count(*) from matching)::numeric / v_size)::int)) as p
  )
  select jsonb_build_object(
    'today', v_today,
    'all_count', (select count(*) from banded),
    'aged_count', (select count(*) from banded where days > 60),
    'custody_counts', (select jsonb_object_agg(custody, n) from (select custody, count(*) n from banded group by 1) z),
    'band_counts', (select jsonb_object_agg(band, n) from (select band, count(*) n from in_group group by 1) z),
    'all_band_counts', (select jsonb_object_agg(band, n) from (select band, count(*) n from banded group by 1) z),
    'vaults', (select coalesce(jsonb_agg(jsonb_build_object('vault', vault_location, 'n', n) order by lower(vault_location)), '[]'::jsonb)
               from (select vault_location, count(*) n from banded group by 1) z),
    'followup_count', (select count(*) from banded where followup),
    'total', (select count(*) from matching),
    'page', (select p from pg), 'size', v_size,
    'rows', (select coalesce(jsonb_agg(to_jsonb(n) - 'rn' order by n.rn), '[]'::jsonb) from numbered n, pg
              where n.rn > (pg.p - 1) * v_size and n.rn <= pg.p * v_size)
  ) into res;
  return res;
end $$;
revoke all on function public.report_inventory_aging(text, text, integer, integer, text, text, boolean, text) from public, anon;
grant execute on function public.report_inventory_aging(text, text, integer, integer, text, text, boolean, text) to authenticated;

create or replace function public.ctm_selftest_0070() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  admin_id uuid; s text; r jsonb; r2 jsonb; n int; k int; v_items int; v_fu int; v_vault text; v_vn int; v_ano int; v_cno int; v_cnt int;
  v_today date := ctm_today();
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select count(*) into v_items from inventory_items;
  -- counted as the owner, before signing in as the test Admin (the same rules as the report, written another way)
  select count(*) into v_fu from inventory_items i where i.archived_at is null and i.status in ('pawned', 'extended', 'forfeited', 'queued_for_auction')
    and i.id in (select l.inventory_item_id from physical_inventory_audit_items l join physical_inventory_audits au on au.id = l.audit_id
                 where l.result in ('not_located', 'found_elsewhere') and l.resolved_at is null and au.status = 'submitted' and au.archived_at is null);
  select vault_location, count(*) into v_vault, v_vn from inventory_items
    where archived_at is null and status in ('pawned', 'extended', 'forfeited', 'queued_for_auction') group by 1 order by 2 desc limit 1;
  select a.appraisal_no, c.customer_no into v_ano, v_cno from inventory_items i join appraisal_items a on a.id = i.appraisal_item_id
    left join customers c on c.id = a.customer_id
    where i.archived_at is null and i.status in ('pawned', 'extended', 'forfeited', 'queued_for_auction') order by i.created_at limit 1;
  select count(*) into v_cnt from inventory_items i join appraisal_items a on a.id = i.appraisal_item_id join customers c on c.id = a.customer_id
    where i.archived_at is null and i.status in ('pawned', 'extended', 'forfeited', 'queued_for_auction') and c.customer_no = v_cno;

  test := 'Summary and old call: the age groups of everything in the shop add up to all items and equal the unfiltered groups; the old 4-argument call gives the same answer; the vault list adds up to all items; follow-ups equal the Physical audit rule';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_inventory_aging(p_size => 10);
    r2 := report_inventory_aging(null, null, 1, 10);
    s := ((select sum(value::int) from jsonb_each_text(r->'all_band_counts')) = (r->>'all_count')::int)::text
      || ',' || (r->'all_band_counts' = r->'band_counts')::text
      || ',' || (r->'all_band_counts' = (report_inventory_aging('forfeited', p_size => 5))->'all_band_counts')::text
      || ',' || ((r2->'rows') = (r->'rows') and (r2->>'total') = (r->>'total'))::text
      || ',' || ((select sum((e->>'n')::int) from jsonb_array_elements(r->'vaults') e) = (r->>'all_count')::int)::text
      || ',' || ((r->>'followup_count')::int = v_fu)::text
      || ',' || ((report_inventory_aging(p_followup => true, p_size => 5)->>'total')::int = v_fu)::text;
    execute 'reset role';
    outcome := case when s = 'true,true,true,true,true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Search and vault: one vault location lists exactly its items; an A-number finds that one item; a C-number finds that customer''s items; a search with no match gives 0; filters never change the summary';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_inventory_aging(p_vault => v_vault, p_size => 5);
    s := ((r->>'total')::int = v_vn)::text;
    r2 := report_inventory_aging(p_q => 'A-' || lpad(v_ano::text, 4, '0'), p_size => 5);
    s := s || ',' || ((r2->>'total')::int = 1 and (r2->'rows'->0->>'appraisal_no')::int = v_ano)::text;
    r2 := report_inventory_aging(p_q => 'c' || v_cno::text, p_size => 5);
    s := s || ',' || ((r2->>'total')::int = v_cnt)::text;
    r2 := report_inventory_aging(p_q => 'zz%no-match_', p_size => 5);
    s := s || ',' || ((r2->>'total')::int = 0 and r2->'all_band_counts' = r->'all_band_counts' and (r2->>'all_count') = (r->>'all_count'))::text;
    execute 'reset role';
    outcome := case when s = 'true,true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Sorting and paging: every sort keeps the same items; oldest first goes down in days held, newest first goes up; pages of 10 never overlap; an unknown sort is refused';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := report_inventory_aging(p_size => 1000);
    s := '';
    foreach k in array array[1, 2, 3, 4, 5] loop
      r2 := report_inventory_aging(p_sort => (array['oldest', 'newest', 'vault', 'category', 'customer'])[k], p_size => 1000);
      s := s || ((select array_agg(e->>'id' order by e->>'id') from jsonb_array_elements(r2->'rows') e)
               = (select array_agg(e->>'id' order by e->>'id') from jsonb_array_elements(r->'rows') e))::text || ',';
    end loop;
    s := s || (select bool_and(d1 <= d2) from (select (e->>'days')::int d1, lag((e->>'days')::int) over (order by o) d2
             from jsonb_array_elements(r->'rows') with ordinality t(e, o)) z where d2 is not null)::text;
    r2 := report_inventory_aging(p_sort => 'newest', p_size => 1000);
    s := s || ',' || (select bool_and(d1 >= d2) from (select (e->>'days')::int d1, lag((e->>'days')::int) over (order by o) d2
             from jsonb_array_elements(r2->'rows') with ordinality t(e, o)) z where d2 is not null)::text;
    r := report_inventory_aging(p_sort => 'vault', p_page => 1, p_size => 10);
    r2 := report_inventory_aging(p_sort => 'vault', p_page => 2, p_size => 10);
    s := s || ',' || (not exists (select 1 from jsonb_array_elements(r->'rows') a, jsonb_array_elements(r2->'rows') b where a->>'id' = b->>'id'))::text;
    begin perform report_inventory_aging(p_sort => 'random'); s := s || ',bad sort accepted'; exception when others then s := s || ',bad sort refused'; end;
    execute 'reset role';
    outcome := case when s = 'true,true,true,true,true,true,true,true,bad sort refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Still safe: Operator, Cashier and Appraiser are refused; signed-out visitors can''t call it; no item changes';
  begin
    execute 'set local role authenticated';
    s := '';
    foreach n in array array[1, 2, 3] loop
      perform set_config('request.jwt.claims', json_build_object('sub', (array[op_id, cash_id, appr_id])[n], 'role', 'authenticated')::text, true);
      begin perform report_inventory_aging(p_sort => 'vault'); s := s || 'x/'; exception when others then s := s || case when sqlerrm like '%not allowed%' then 'refused/' else '?/' end; end;
    end loop;
    execute 'reset role';
    s := s || 'anon ' || has_function_privilege('anon', 'public.report_inventory_aging(text, text, integer, integer, text, text, boolean, text)', 'execute')::text
      || '/' || ((select count(*) from inventory_items) = v_items)::text;
    outcome := case when s = 'refused/refused/refused/anon false/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0070() from public, anon, authenticated;

-- applied only if these pass, and the earlier Reports, audit, ledger and Suspicious activity tests still pass
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0070' t, * from public.ctm_selftest_0070() union all select '0069' t, * from public.ctm_selftest_0069()
    union all select '0068' t, * from public.ctm_selftest_0068() union all select '0067' t, * from public.ctm_selftest_0067()
    union all select '0066' t, * from public.ctm_selftest_0066() union all select '0065' t, * from public.ctm_selftest_0065()
    union all select '0064' t, * from public.ctm_selftest_0064() union all select '0063' t, * from public.ctm_selftest_0063()
    union all select '0062' t, * from public.ctm_selftest_0062() union all select '0058' t, * from public.ctm_selftest_0058()
    union all select '0038' t, * from public.ctm_selftest_0038()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0070 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
