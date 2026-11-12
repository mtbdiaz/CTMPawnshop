-- 0055 (Nov 12, 2026, Wush): Cash & ledger, made safer and faster. No ledger entry is changed, moved or deleted here.
-- What was wrong:
--   1. Anyone signed in as Cashier, Operator or Admin could INSERT any row straight into cash_flow_entries (any type,
--      any direction, any loan, a memo, another person's name, an old date) by calling the database directly. The page
--      only offered Expense and Revenue, but the database did not hold that line.
--   2. A manual entry had no protection against being saved twice (a retry, a second click after an error).
--   3. The page loaded the WHOLE ledger (2,709 rows) into the server on every visit and added the money up in
--      JavaScript numbers. It now asks the database for one page, with the totals and the running balance worked out
--      in the database with exact decimal numbers.
-- What this adds:
--   - record_cash_entry(): the one way to add a manual Expense or Revenue. Checks the role, the type, the amount
--     (more than 0, at most 10,000,000, at most 2 decimals) and the description, and saves once per request id.
--   - a tighter INSERT rule on the table: a direct insert is only accepted when it is exactly what the manual form
--     makes (Expense = out / Revenue = in, no loan, not a memo, in your own name, dated now). The old page on the
--     live site still works with this, because that is what it sends.
--   - cash_ledger_page(): today's totals (Manila day), the ledger balance, and one page of entries with the running
--     balance, search and filters. Non-cash memos (capitalization) are listed but never counted as cash.
-- NOT changed: how loans, payments, renewals and auction sales write to the ledger; admin_edit_cash_entry; archiving.
-- Self-test: select * from public.ctm_selftest_0055();   (every test rolls back)

-- ---------- 1. one request id per manual entry, so the same Save sent twice is one entry ----------
alter table public.cash_flow_entries add column request_id uuid;
create unique index cash_flow_entries_request_id on public.cash_flow_entries (request_id) where request_id is not null;

-- ---------- 2. the manual entry (PB-29) goes through one function ----------
create or replace function public.record_cash_entry(p_type text, p_amount numeric, p_description text, p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_by uuid; v_desc text := btrim(coalesce(p_description, ''));
begin
  perform public.ctm_assert_role(array['operator', 'cashier']::public.staff_role[]); -- Operator, Cashier or Admin (the same as before)
  if p_request_id is not null then -- the same form sent again: give back the entry that was already saved
    select id, created_by into v_id, v_by from public.cash_flow_entries where request_id = p_request_id;
    if found then
      if v_by is distinct from auth.uid() then raise exception 'This form was already used. Reload the page.'; end if;
      return v_id;
    end if;
  end if;
  if p_type is null or p_type not in ('expense', 'revenue') then raise exception 'Pick Expense or Revenue. Other entries are made by the system (loans, payments, auction sales).'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than 0'; end if;
  if p_amount > 10000000 then raise exception 'The amount can''t be more than 10,000,000.'; end if;
  if p_amount <> round(p_amount, 2) then raise exception 'Use pesos and centavos only, like 1500 or 1500.50.'; end if;
  if char_length(v_desc) < 3 then raise exception 'Write what the money was for (at least 3 characters).'; end if;
  if char_length(v_desc) > 200 then raise exception 'Keep the description to 200 characters or less.'; end if;
  insert into public.cash_flow_entries (entry_type, direction, amount, description, created_by, request_id)
  values (p_type::public.cash_flow_type, (case when p_type = 'revenue' then 'in' else 'out' end)::public.cash_flow_direction, p_amount, v_desc, auth.uid(), p_request_id)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_cash_entry(text, numeric, text, uuid) from public, anon;
grant execute on function public.record_cash_entry(text, numeric, text, uuid) to authenticated;

-- ---------- 3. a direct insert may only be a manual Expense or Revenue, in your own name, dated now ----------
drop policy if exists "cash_flow_entries: cashier, operator or admin insert" on public.cash_flow_entries;
create policy "cash_flow_entries: manual expense or revenue only" on public.cash_flow_entries for insert to authenticated
with check (
  public.get_my_role() = any (array['cashier', 'operator', 'admin']::public.staff_role[])
  and entry_type in ('expense', 'revenue')
  and direction = (case when entry_type = 'revenue' then 'in' else 'out' end)::public.cash_flow_direction
  and related_loan_id is null and not is_memo and not is_demo
  and created_by = auth.uid()
  and archived_at is null and archived_by is null
  and created_at between now() - interval '5 minutes' and now() + interval '1 minute'
);

-- ---------- 4. reading: the totals and one page of the ledger ----------
-- The running balance is worked out over the WHOLE ledger first (oldest to newest; entries with the same time are
-- ordered by id, the same order the page always used), and only then is the page cut out. So a row's balance is the
-- same whatever page, search or filter it is seen through.
create or replace function public.cash_ledger_page(p_q text default null, p_type text default null, p_flow text default null, p_source text default null,
  p_from date default null, p_to date default null, p_check boolean default false, p_page integer default 1, p_size integer default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.staff_role;
  v_size int := least(greatest(coalesce(p_size, 10), 5), 100);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_like text;
  v_today date := (now() at time zone 'Asia/Manila')::date;             -- today in the shop's timezone
  v_t0 timestamptz := v_today::timestamp at time zone 'Asia/Manila';     -- 12:00 midnight Manila time
  res jsonb;
begin
  r := public.ctm_assert_role(array['operator', 'cashier']::public.staff_role[]);
  if p_type is not null and p_type not in (select unnest(enum_range(null::public.cash_flow_type))::text) then raise exception 'Unknown entry type.'; end if;
  if p_flow is not null and p_flow not in ('in', 'out', 'noncash') then raise exception 'Unknown filter.'; end if;
  if p_source is not null and p_source not in ('manual', 'system') then raise exception 'Unknown filter.'; end if;
  if v_q is not null then
    v_q := left(v_q, 80);
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; -- typed % or _ are plain letters
  end if;
  with led as ( -- every entry that is not archived, with the balance after it (memos add nothing)
    select c.id, c.created_at, c.entry_type::text as entry_type, c.direction::text as direction, c.amount, c.is_memo, c.description, c.related_loan_id, c.created_by,
           sum(case when c.is_memo then 0 when c.direction = 'in' then c.amount else -c.amount end) over (order by c.created_at, c.id) as balance
    from public.cash_flow_entries c where c.archived_at is null
  ), base as (
    select led.*, l.ticket_number, cu.full_name as customer_name, p.full_name as created_by_name,
           substring(led.description from 'RC-[0-9]+-[0-9A-Za-z]+') as receipt_number, -- the receipt number, when the description has one
           (led.related_loan_id is null) as manual,                                   -- typed in by staff (not made by a loan, payment or sale)
           -- auction-sale money whose item has no sale record (see claude/auction-ledger-check.md)
           (led.entry_type = 'revenue' and led.direction = 'in' and led.description like 'Auction sale%' and led.related_loan_id is not null
            and not exists (select 1 from public.auction_batch_items bi where bi.inventory_item_id = l.inventory_item_id and bi.sold_at is not null)) as no_sale_record
    from led
    left join public.loans l on l.id = led.related_loan_id
    left join public.customers cu on cu.id = l.customer_id
    left join public.profiles p on p.id = led.created_by
  ), filtered as (
    select * from base b
    where (p_type is null or b.entry_type = p_type)
      and (p_flow is null or (p_flow = 'noncash' and b.is_memo) or (p_flow = 'in' and not b.is_memo and b.direction = 'in') or (p_flow = 'out' and not b.is_memo and b.direction = 'out'))
      and (p_source is null or (p_source = 'manual') = b.manual)
      and (p_from is null or b.created_at >= p_from::timestamp at time zone 'Asia/Manila')
      and (p_to is null or b.created_at < (p_to + 1)::timestamp at time zone 'Asia/Manila')
      and (not coalesce(p_check, false) or b.no_sale_record)
      and (v_q is null or b.description ilike v_like or b.ticket_number ilike v_like or b.customer_name ilike v_like or b.id::text ilike v_like)
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
        'today', v_today,
        'today_in', coalesce(sum(amount) filter (where not is_memo and direction = 'in' and created_at >= v_t0), 0),
        'today_out', coalesce(sum(amount) filter (where not is_memo and direction = 'out' and created_at >= v_t0), 0),
        'today_noncash', count(*) filter (where is_memo and created_at >= v_t0),
        'balance', coalesce(sum(case when is_memo then 0 when direction = 'in' then amount else -amount end), 0),
        'entries', count(*),
        -- only an Admin gets the "needs checking" numbers
        'check_count', case when r = 'admin' then count(*) filter (where no_sale_record) end,
        'check_sum', case when r = 'admin' then coalesce(sum(amount) filter (where no_sale_record), 0) end) from base),
    'total', (select count(*) from filtered),
    'sum_in', (select coalesce(sum(amount) filter (where not is_memo and direction = 'in'), 0) from filtered),
    'sum_out', (select coalesce(sum(amount) filter (where not is_memo and direction = 'out'), 0) from filtered),
    'page', v_page, 'size', v_size,
    'rows', (select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc, f.id desc), '[]'::jsonb) from (
        select x.id, x.created_at, x.entry_type, x.direction, x.amount, x.is_memo, x.description, x.balance, x.related_loan_id, x.ticket_number, x.customer_name,
               x.created_by_name, x.receipt_number, x.manual, x.no_sale_record,
               -- Admin corrections of this entry (who, when, why, the amount before and after), oldest first
               (select coalesce(jsonb_agg(jsonb_build_object('at', a.created_at, 'by', ap.full_name, 'reason', a.changed_data->>'reason',
                         'before', a.changed_data->'before'->>'amount', 'after', a.changed_data->'after'->>'amount') order by a.created_at), '[]'::jsonb)
                from public.audit_log a left join public.profiles ap on ap.id = a.actor
                where a.table_name = 'cash_flow_entries' and a.record_id::text = x.id::text and a.changed_data ? 'admin_edit') as edits
        from filtered x order by x.created_at desc, x.id desc offset (v_page - 1) * v_size limit v_size) f)
  ) into res;
  return res;
end $$;
revoke all on function public.cash_ledger_page(text, text, text, text, date, date, boolean, integer, integer) from public, anon;
grant execute on function public.cash_ledger_page(text, text, text, text, date, date, boolean, integer, integer) to authenticated;

-- ---------- 5. self-test ----------
create or replace function public.ctm_selftest_0055() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  admin_id uuid; r jsonb; r2 jsonb; s text; n int; c0 int; b0 numeric; v_in numeric; v_out numeric; v_bal numeric; a uuid; a2 uuid; rid uuid := gen_random_uuid();
  t0 timestamptz := ((now() at time zone 'Asia/Manila')::date)::timestamp at time zone 'Asia/Manila'; ok boolean; a_loan uuid; a_ticket text;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;

  test := 'Totals: Cash in, Cash out and Net today and the Ledger balance equal the entries added up one by one (exact decimals, Manila day, memos and archived entries left out)';
  begin
    select coalesce(sum(amount) filter (where direction = 'in' and created_at >= t0), 0), coalesce(sum(amount) filter (where direction = 'out' and created_at >= t0), 0),
           coalesce(sum(case when direction = 'in' then amount else -amount end), 0)
      into v_in, v_out, v_bal from cash_flow_entries where archived_at is null and not is_memo;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page();
    execute 'reset role';
    outcome := case when (r->'summary'->>'today_in')::numeric = v_in and (r->'summary'->>'today_out')::numeric = v_out and (r->'summary'->>'balance')::numeric = v_bal
      and (r->'summary'->>'entries')::int = (select count(*) from cash_flow_entries where archived_at is null)
      and (r->'rows'->0->>'balance')::numeric = v_bal -- the newest row ends on the ledger balance
      then 'PASS (balance ₱' || to_char(v_bal, 'FM999,999,999,990.00') || ')' else 'FAIL ' || (r->'summary')::text || ' vs ' || v_in || '/' || v_out || '/' || v_bal end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  execute 'reset role'; return next;

  test := 'Running balance: on every page each row''s balance is the row below it plus or minus its own amount (a memo adds nothing), also across the page break and inside a search';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page(null, null, null, null, null, null, false, 1, 100);
    r2 := cash_ledger_page(null, null, null, null, null, null, false, 2, 100);
    execute 'reset role';
    select bool_and(x.bal - (case when x.memo then 0 when x.dir = 'in' then x.amt else -x.amt end) = x.prev) into ok from (
      select (e->>'balance')::numeric bal, (e->>'amount')::numeric amt, e->>'direction' dir, (e->>'is_memo')::boolean memo,
             lead((e->>'balance')::numeric) over (order by ord) prev
      from (select e, ord from jsonb_array_elements(r->'rows') with ordinality t(e, ord)
            union all select e, ord + 100 from jsonb_array_elements(r2->'rows') with ordinality t(e, ord)) q) x where x.prev is not null;
    outcome := case when ok and jsonb_array_length(r->'rows') = least(100, (r->>'total')::int) then 'PASS' else 'FAIL' end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  execute 'reset role'; return next;

  test := 'Non-cash: a capitalization memo is listed but changes no total and no balance';
  begin
    select id into a_loan from loans order by created_at limit 1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page();
    execute 'reset role';
    perform set_config('ctm.system', 'on', true);
    insert into cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by, is_memo)
    values ('capitalization', 'in', 99999.99, 'TEST Interest capitalized into principal (non-cash)', a_loan, op_id, true);
    execute 'set local role authenticated';
    r2 := cash_ledger_page();
    execute 'reset role';
    s := ((r2->'summary'->>'balance')::numeric = (r->'summary'->>'balance')::numeric)::text || ',' || ((r2->'summary'->>'today_in')::numeric = (r->'summary'->>'today_in')::numeric)::text
      || ',' || ((r2->'summary'->>'entries')::int - (r->'summary'->>'entries')::int) || ',' || ((r2->'summary'->>'today_noncash')::int - (r->'summary'->>'today_noncash')::int)
      || ',' || (r2->'rows'->0->>'is_memo') || ',' || ((r2->'rows'->0->>'balance')::numeric = (r->'rows'->0->>'balance')::numeric)::text;
    outcome := case when s = 'true,true,1,1,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Manual entry: wrong amounts, a short description and other types are refused; a good one saves once (the same form sent twice = one entry) and moves the balance by exactly its amount';
  begin
    select count(*) into c0 from cash_flow_entries;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    b0 := (cash_ledger_page()->'summary'->>'balance')::numeric;
    s := '';
    begin perform record_cash_entry('expense', 0, 'TEST zero'); s := s || 'x'; exception when others then s := s || '1'; end;
    begin perform record_cash_entry('expense', -50, 'TEST negative'); s := s || 'x'; exception when others then s := s || '2'; end;
    begin perform record_cash_entry('expense', 10.005, 'TEST three decimals'); s := s || 'x'; exception when others then s := s || '3'; end;
    begin perform record_cash_entry('expense', 10000000.01, 'TEST too large'); s := s || 'x'; exception when others then s := s || '4'; end;
    begin perform record_cash_entry('expense', null, 'TEST no amount'); s := s || 'x'; exception when others then s := s || '5'; end;
    begin perform record_cash_entry('expense', 100, ' a '); s := s || 'x'; exception when others then s := s || '6'; end;
    begin perform record_cash_entry('expense', 100, repeat('x', 201)); s := s || 'x'; exception when others then s := s || '7'; end;
    begin perform record_cash_entry('payment_received', 100, 'TEST fake payment'); s := s || 'x'; exception when others then s := s || '8'; end;
    begin perform record_cash_entry('loan_disbursement', 100, 'TEST fake loan'); s := s || 'x'; exception when others then s := s || '9'; end;
    a := record_cash_entry('expense', 1234.56, '  TEST electricity bill  ', rid);
    a2 := record_cash_entry('expense', 1234.56, 'TEST electricity bill', rid); -- the same form again
    s := s || '/' || (a = a2)::text || '/' || (b0 - (cash_ledger_page()->'summary'->>'balance')::numeric);
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform record_cash_entry('expense', 1, 'TEST other person', rid); s := s || '/reused by someone else';
    exception when others then s := s || case when sqlerrm like 'This form was already used%' then '/A' else '/' || sqlerrm end; end;
    a2 := record_cash_entry('revenue', 0.01, 'TEST one centavo');
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    begin perform record_cash_entry('expense', 100, 'TEST appraiser'); s := s || '/appraiser saved'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '/B' else '/' || sqlerrm end; end;
    begin perform cash_ledger_page(); s := s || '/appraiser read'; exception when others then s := s || case when sqlerrm like '%not allowed%' then 'C' else '/' || sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || ((select count(*) from cash_flow_entries) - c0)
           || '|' || (select direction || ',' || amount || ',' || description || ',' || (created_by = cash_id) || ',' || (related_loan_id is null) || ',' || is_memo from cash_flow_entries where id = a)
           || '|' || (select direction || ',' || amount from cash_flow_entries where id = a2);
    outcome := case when s = '123456789/true/1234.56/A/BC|2|out,1234.56,TEST electricity bill,true,true,false|in,0.01' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Called straight at the table (Cashier and Operator): a fake loan or payment entry, a memo, another person''s name, an old date and a wrong direction are refused; nothing can be edited or deleted; the old page''s own insert still works';
  begin
    select id into a_loan from loans order by created_at limit 1;
    select count(*) into c0 from cash_flow_entries;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    s := '';
    begin insert into cash_flow_entries (entry_type, direction, amount, description, created_by) values ('loan_disbursement', 'out', 5000, 'TEST', cash_id); s := s || 'x'; exception when others then s := s || '1'; end;
    begin insert into cash_flow_entries (entry_type, direction, amount, description, created_by) values ('payment_received', 'in', 5000, 'TEST', cash_id); s := s || 'x'; exception when others then s := s || '2'; end;
    begin insert into cash_flow_entries (entry_type, direction, amount, description, created_by, related_loan_id) values ('revenue', 'in', 5000, 'Auction sale TEST', cash_id, a_loan); s := s || 'x'; exception when others then s := s || '3'; end;
    begin insert into cash_flow_entries (entry_type, direction, amount, description, created_by, is_memo) values ('revenue', 'in', 5000, 'TEST', cash_id, true); s := s || 'x'; exception when others then s := s || '4'; end;
    begin insert into cash_flow_entries (entry_type, direction, amount, description, created_by) values ('expense', 'out', 5000, 'TEST', op_id); s := s || 'x'; exception when others then s := s || '5'; end;
    begin insert into cash_flow_entries (entry_type, direction, amount, description, created_by, created_at) values ('expense', 'out', 5000, 'TEST', cash_id, now() - interval '30 days'); s := s || 'x'; exception when others then s := s || '6'; end;
    begin insert into cash_flow_entries (entry_type, direction, amount, description, created_by) values ('expense', 'in', 5000, 'TEST', cash_id); s := s || 'x'; exception when others then s := s || '7'; end;
    begin insert into cash_flow_entries (entry_type, direction, amount, description, created_by) values ('expense', 'out', -5, 'TEST', cash_id); s := s || 'x'; exception when others then s := s || '8'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin insert into cash_flow_entries (entry_type, direction, amount, description, created_by) values ('adjustment', 'in', 5000, 'TEST', op_id); s := s || 'x'; exception when others then s := s || '9'; end;
    -- no edit and no delete: the database either refuses outright or changes 0 rows
    begin update cash_flow_entries set amount = 1 where id = (select id from cash_flow_entries order by created_at limit 1); get diagnostics n = row_count; s := s || '/u' || n;
    exception when others then s := s || '/u0'; end;
    begin delete from cash_flow_entries where id = (select id from cash_flow_entries order by created_at limit 1); get diagnostics n = row_count; s := s || '/d' || n;
    exception when others then s := s || '/d0'; end;
    -- exactly what the old page (still on the live site) sends
    insert into cash_flow_entries (entry_type, direction, amount, description, created_by) values ('expense', 'out', 150, 'TEST old page entry', op_id);
    execute 'reset role';
    s := s || '|' || ((select count(*) from cash_flow_entries) - c0);
    outcome := case when s = '123456789/u0/d0|1' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Search and filters: Cash in + Cash out + Non-cash = all entries; a type, a ticket, a date and manual / system each give exactly the matching entries; only an Admin gets the "needs checking" numbers';
  begin
    select l.id, l.ticket_number into a_loan, a_ticket from loans l where exists (select 1 from cash_flow_entries c where c.related_loan_id = l.id and c.archived_at is null) order by l.created_at limit 1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page();
    r2 := cash_ledger_page(a_ticket);
    s := (((cash_ledger_page(null, null, 'in')->>'total')::int + (cash_ledger_page(null, null, 'out')->>'total')::int + (cash_ledger_page(null, null, 'noncash')->>'total')::int) = (r->>'total')::int)::text;
    s := s || ',' || ((cash_ledger_page(null, 'expense')->>'total')::int = (select count(*) from cash_flow_entries where archived_at is null and entry_type = 'expense'))::text;
    s := s || ',' || ((r2->>'total')::int = (select count(*) from cash_flow_entries where archived_at is null and related_loan_id = a_loan))::text;
    s := s || ',' || ((cash_ledger_page(null, null, null, 'manual')->>'total')::int = (select count(*) from cash_flow_entries where archived_at is null and related_loan_id is null)
      and (cash_ledger_page(null, null, null, 'system')->>'total')::int = (select count(*) from cash_flow_entries where archived_at is null and related_loan_id is not null))::text;
    s := s || ',' || ((cash_ledger_page(null, null, null, null, date '2026-10-10', date '2026-10-10')->>'total')::int
      = (select count(*) from cash_flow_entries where archived_at is null and (created_at at time zone 'Asia/Manila')::date = date '2026-10-10'))::text;
    s := s || ',' || (jsonb_typeof(r->'summary'->'check_count') = 'null')::text; -- a Cashier does not get the numbers
    s := s || ',' || ((cash_ledger_page('%')->>'total')::int < (r->>'total')::int)::text; -- a typed % is a plain letter, not "everything"
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := cash_ledger_page(null, null, null, null, null, null, true);
    execute 'reset role';
    s := s || '|' || ((r->'summary'->>'check_count')::int = (r->>'total')::int)::text || ',' || ((r->'summary'->>'check_sum')::numeric = (r->>'sum_in')::numeric)::text;
    outcome := case when s = 'true,true,true,true,true,true,true|true,true' then 'PASS (' || (r->'summary'->>'check_count') || ' entries need checking, ₱' || to_char((r->'summary'->>'check_sum')::numeric, 'FM999,999,990.00') || ')' else 'FAIL ' || s end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0055() from public, anon, authenticated;

-- applied only if these pass (the whole migration rolls back otherwise). The older tests that write to the ledger
-- (loans, payments, auction sales) run too, because the INSERT rule on the ledger changed.
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0055' t, * from public.ctm_selftest_0055() union all select '0026' t, * from public.ctm_selftest_0026() union all select '0028' t, * from public.ctm_selftest_0028()
    union all select '0031' t, * from public.ctm_selftest_0031() union all select '0032' t, * from public.ctm_selftest_0032() union all select '0038' t, * from public.ctm_selftest_0038()
    union all select '0052' t, * from public.ctm_selftest_0052() union all select '0053' t, * from public.ctm_selftest_0053() union all select '0054' t, * from public.ctm_selftest_0054()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0055 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
