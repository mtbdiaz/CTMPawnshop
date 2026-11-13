-- 0068 (Nov 13, 2026, Wush): Audit Trail: "All activity / Changes only / Views", and a search that finds every
-- entry linked to a ticket, customer, appraisal or auction batch.
-- No audit entry or any other record is changed by this migration. Masking (0066 + 0067) and the Admin-only rule
-- stay exactly the same.
--
-- Why a database change is needed (the page can't do this on its own):
--   1. audit_log_page refused p_action = 'VIEW' ("Unknown action."), so the 5 "ID number viewed" entries could only
--      be seen mixed in with 11,377 changes. A filter in the page would only filter the 10 rows it received, not
--      the whole history, and the total and page numbers would be wrong.
--   2. Searching a pawn ticket found only the loan's own entries. Its payments, renewals and cash entries store the
--      loan's ID, not the ticket number, so an Admin investigating PT-... missed most of what happened to it.
--      Same for a customer (their loans, appraisals, flags and ID views) and an appraisal (its item and loan).
--
-- audit_log_page now also takes p_kind ('changes' = Created/Updated/Deleted, 'views' = Viewed, null = all),
-- accepts p_action 'VIEW', understands p_find_kind 'batch' (AB-0007), returns counts for the three activity
-- filters (with the other filters applied), and shows the last page when asked for a page past the end.
-- The old 9-argument call still works (p_kind is optional), so the deployed site keeps working.
-- Self-test: select * from public.ctm_selftest_0068();   (every test rolls back)

drop function if exists public.audit_log_page(text, text, text, date, date, text, text, integer, integer);

create or replace function public.audit_log_page(p_table text default null, p_action text default null, p_by text default null,
  p_from date default null, p_to date default null, p_find_kind text default null, p_find text default null,
  p_page integer default 1, p_size integer default 50, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_size int := least(greatest(coalesce(p_size, 50), 5), 100); -- 5 to 100 entries per page
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_by uuid; v_target text; res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admins only
  if p_action is not null and p_action not in ('INSERT', 'UPDATE', 'DELETE', 'VIEW') then raise exception 'Unknown action.'; end if;
  if p_kind is not null and p_kind not in ('changes', 'views') then raise exception 'Unknown activity filter.'; end if;
  if p_find_kind is not null and p_find_kind not in ('id', 'ticket', 'receipt', 'customer', 'appraisal', 'batch') then raise exception 'Unknown search.'; end if;
  if p_by is not null and p_by <> 'system' then v_by := p_by::uuid; end if;

  -- the record a search points to, so the entries linked to it can be found too (numbers only for C-, A-, AB-)
  if p_find is not null then
    v_target := case
      when p_find_kind = 'ticket' then (select l.id::text from public.loans l where l.ticket_number = p_find limit 1)
      when p_find_kind = 'customer' and p_find ~ '^\d{1,9}$' then (select c.id::text from public.customers c where c.customer_no = p_find::int limit 1)
      when p_find_kind = 'appraisal' and p_find ~ '^\d{1,9}$' then (select a.id::text from public.appraisal_items a where a.appraisal_no = p_find::int limit 1)
      when p_find_kind = 'batch' and p_find ~ '^\d{1,9}$' then (select b.id::text from public.auction_batches b where b.batch_no = p_find::int limit 1)
    end;
  end if;

  with base as (
    -- every filter except the activity filter (so its three counts can be shown)
    select a.* from public.audit_log a
    where (p_table is null or a.table_name = p_table)
      and (p_action is null or a.action = p_action)
      and (p_by is null or (p_by = 'system' and a.actor is null) or a.actor = v_by)
      and (p_from is null or a.created_at >= p_from::timestamp at time zone 'Asia/Manila')
      and (p_to is null or a.created_at < (p_to + 1)::timestamp at time zone 'Asia/Manila')
      and (p_find is null or case p_find_kind
            when 'id' then a.record_id = p_find
            -- the loan itself, and its payments, renewals, cash entries, reminders and flags (an Admin correction keeps the row in "after")
            when 'ticket' then a.changed_data->>'ticket_number' = p_find or (v_target is not null and (
                   (a.table_name = 'loans' and a.record_id = v_target) or a.changed_data->>'loan_id' = v_target
                or a.changed_data->>'related_loan_id' = v_target or a.changed_data->'after'->>'loan_id' = v_target))
            when 'receipt' then a.changed_data->>'receipt_number' = p_find or a.changed_data->'after'->>'receipt_number' = p_find
            -- the customer, their ID views, and their loans, appraisals and flags
            when 'customer' then (a.table_name = 'customers' and a.changed_data->>'customer_no' = p_find) or (v_target is not null and (
                   (a.table_name = 'customers' and a.record_id = v_target) or a.changed_data->>'customer_id' = v_target))
            -- the appraisal, its inventory item and its loan
            when 'appraisal' then (a.table_name = 'appraisal_items' and a.changed_data->>'appraisal_no' = p_find) or (v_target is not null and (
                   (a.table_name = 'appraisal_items' and a.record_id = v_target) or a.changed_data->>'appraisal_item_id' = v_target))
            -- the batch and its items
            when 'batch' then v_target is not null and ((a.table_name = 'auction_batches' and a.record_id = v_target) or a.changed_data->>'batch_id' = v_target)
            else true end)
  ), matching as (
    select * from base b
    where p_kind is null or (p_kind = 'views' and b.action = 'VIEW') or (p_kind = 'changes' and b.action <> 'VIEW')
  ), pg as (
    -- a page past the end shows the last page
    select greatest(1, least(v_page, ceil((select count(*) from matching)::numeric / v_size)::int)) as p
  )
  select jsonb_build_object(
    'total', (select count(*) from matching),
    'counts', (select jsonb_build_object('all', count(*), 'changes', count(*) filter (where action <> 'VIEW'), 'views', count(*) filter (where action = 'VIEW')) from base),
    'page', (select p from pg), 'size', v_size,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'table_name', x.table_name, 'record_id', x.record_id, 'action', x.action,
                      'actor', x.actor, 'created_at', x.created_at,
                      'changed_data', public.ctm_mask_audit(x.changed_data), 'old_data', public.ctm_mask_audit(x.old_data)) order by x.created_at desc, x.id desc), '[]'::jsonb)
             from (select m.* from matching m order by m.created_at desc, m.id desc offset ((select p from pg) - 1) * v_size limit v_size) x)
  ) into res;
  return res;
end $$;
revoke all on function public.audit_log_page(text, text, text, date, date, text, text, integer, integer, text) from public, anon;
grant execute on function public.audit_log_page(text, text, text, date, date, text, text, integer, integer, text) to authenticated;

create or replace function public.ctm_selftest_0068() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a';
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  admin_id uuid; s text; r jsonb; r2 jsonb; n int; k int;
  v_loan uuid; v_ticket text; v_cust uuid; v_cno int; v_appr uuid; v_ano int; v_batch uuid; v_bno int; v_receipt text;
  v_all int; v_views int; v_bcount int;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  -- test records already in the database (nothing is created or changed)
  select l.id, l.ticket_number into v_loan, v_ticket from loans l
   where exists (select 1 from loan_payments p where p.loan_id = l.id) and exists (select 1 from loan_extensions e where e.loan_id = l.id) order by l.created_at limit 1;
  select c.id, c.customer_no into v_cust, v_cno from customers c where exists (select 1 from audit_log a where a.action = 'VIEW' and a.table_name = 'customers' and a.record_id = c.id::text) limit 1;
  select a.id, a.appraisal_no into v_appr, v_ano from appraisal_items a where exists (select 1 from loans l where l.appraisal_item_id = a.id) order by a.created_at limit 1;
  select b.id, b.batch_no into v_batch, v_bno from auction_batches b where b.batch_no is not null order by b.batch_no limit 1;
  select p.receipt_number into v_receipt from loan_payments p where p.receipt_number is not null order by p.created_at limit 1;
  -- counted here, as the database owner, because a signed-in login can't read audit_log directly (0066)
  select count(*), count(*) filter (where action = 'VIEW') into v_all, v_views from audit_log;
  select count(*) into v_bcount from audit_log a where (a.table_name = 'auction_batches' and a.record_id = v_batch::text) or a.changed_data->>'batch_id' = v_batch::text;

  test := 'Activity filter: All = Changes only + Views = every entry; Views lists only Viewed entries and Changes only none; Action "VIEW" works; a page past the end shows the last page; pages of 10 never overlap';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := audit_log_page(p_size => 10);
    s := ((r->'counts'->>'all')::int = v_all)::text
      || ',' || ((r->'counts'->>'all')::int = (r->'counts'->>'changes')::int + (r->'counts'->>'views')::int)::text
      || ',' || ((r->'counts'->>'views')::int = v_views)::text;
    r2 := audit_log_page(p_kind => 'views', p_size => 100);
    s := s || ',' || ((r2->>'total')::int = (r->'counts'->>'views')::int and not exists (select 1 from jsonb_array_elements(r2->'rows') x where x->>'action' <> 'VIEW'))::text;
    r2 := audit_log_page(p_kind => 'changes', p_size => 100);
    s := s || ',' || ((r2->>'total')::int = (r->'counts'->>'changes')::int and not exists (select 1 from jsonb_array_elements(r2->'rows') x where x->>'action' = 'VIEW'))::text;
    s := s || ',' || ((audit_log_page(p_action => 'VIEW')->>'total')::int = (r->'counts'->>'views')::int)::text;
    r2 := audit_log_page(p_size => 10, p_page => 999999);
    s := s || ',' || ((r2->>'page')::int = ceil((r->>'total')::numeric / 10)::int and jsonb_array_length(r2->'rows') > 0)::text;
    r2 := audit_log_page(p_size => 10, p_page => 2);
    s := s || ',' || (not exists (select 1 from jsonb_array_elements(r->'rows') a, jsonb_array_elements(r2->'rows') b where a->>'id' = b->>'id')
                 and ((r->'rows'->-1)->>'created_at')::timestamptz >= ((r2->'rows'->0)->>'created_at')::timestamptz)::text;
    begin perform audit_log_page(p_kind => 'everything'); s := s || ',bad kind accepted'; exception when others then s := s || ',bad kind refused'; end;
    execute 'reset role';
    outcome := case when s = 'true,true,true,true,true,true,true,true,bad kind refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Linked search: a ticket finds the loan with its payments and renewals; a C-number finds the customer, their ID views and their loans; an A-number finds the appraisal and its loan; AB- finds the batch; a receipt is found; each total equals the entries counted another way';
  begin
    if v_loan is null or v_cust is null or v_appr is null then outcome := 'SKIP (needs a loan with payments and a renewal, a viewed customer and an appraisal with a loan)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := audit_log_page(p_find_kind => 'ticket', p_find => v_ticket, p_size => 100);
    execute 'reset role';
    select count(*) into n from audit_log a where a.changed_data->>'ticket_number' = v_ticket or (a.table_name = 'loans' and a.record_id = v_loan::text)
      or a.changed_data->>'loan_id' = v_loan::text or a.changed_data->>'related_loan_id' = v_loan::text or a.changed_data->'after'->>'loan_id' = v_loan::text;
    s := ((r->>'total')::int = n)::text
      || ',' || exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'table_name' = 'loan_payments')::text
      || ',' || exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'table_name' = 'loan_extensions')::text;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := audit_log_page(p_find_kind => 'customer', p_find => v_cno::text, p_size => 100);
    r2 := audit_log_page(p_find_kind => 'appraisal', p_find => v_ano::text, p_size => 100);
    execute 'reset role';
    select count(*) into n from audit_log a where (a.table_name = 'customers' and (a.changed_data->>'customer_no' = v_cno::text or a.record_id = v_cust::text)) or a.changed_data->>'customer_id' = v_cust::text;
    select count(*) into k from audit_log a where (a.table_name = 'appraisal_items' and (a.changed_data->>'appraisal_no' = v_ano::text or a.record_id = v_appr::text)) or a.changed_data->>'appraisal_item_id' = v_appr::text;
    s := s || ',' || ((r->>'total')::int = n)::text
      || ',' || exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'action' = 'VIEW')::text
      || ',' || ((r2->>'total')::int = k and exists (select 1 from jsonb_array_elements(r2->'rows') x where x->>'table_name' = 'loans'))::text;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    if v_batch is not null then
      s := s || ',' || ((audit_log_page(p_find_kind => 'batch', p_find => v_bno::text)->>'total')::int = v_bcount)::text;
    end if;
    if v_receipt is not null then s := s || ',' || ((audit_log_page(p_find_kind => 'receipt', p_find => v_receipt)->>'total')::int >= 1)::text; end if;
    s := s || ',' || ((audit_log_page(p_find_kind => 'customer', p_find => 'abc')->>'total')::int = 0)::text;
    begin perform audit_log_page(p_find_kind => 'everything', p_find => 'x'); s := s || ',bad search accepted'; exception when others then s := s || ',bad search refused'; end;
    execute 'reset role';
    outcome := case when s not like '%false%' and s like '%bad search refused' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Still safe: the customer search and the Views list send no full ID number at any level; Operator, Cashier and Appraiser are refused; signed-out visitors can''t call it; the stored entries are unchanged';
  begin
    select count(*) into k from audit_log;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := audit_log_page(p_find_kind => 'customer', p_find => coalesce(v_cno, 0)::text, p_size => 100);
    r2 := audit_log_page(p_kind => 'views', p_size => 100);
    s := (select count(*) from (select jsonb_array_elements(r->'rows') x union all select jsonb_array_elements(r2->'rows')) z, jsonb_path_query(z.x, 'strict $.**.id_number') v
          where v #>> '{}' <> '' and v #>> '{}' not like '••••%')::text;
    foreach n in array array[1, 2, 3] loop
      perform set_config('request.jwt.claims', json_build_object('sub', (array[op_id, cash_id, appr_id])[n], 'role', 'authenticated')::text, true);
      begin perform audit_log_page(p_kind => 'views'); s := s || '/x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '/refused' else '/?' end; end;
    end loop;
    execute 'reset role';
    s := s || '/anon ' || has_function_privilege('anon', 'public.audit_log_page(text, text, text, date, date, text, text, integer, integer, text)', 'execute')::text
      || '/' || ((select count(*) from audit_log) = k)::text;
    outcome := case when s = '0/refused/refused/refused/anon false/true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0068() from public, anon, authenticated;

-- applied only if these pass, and the earlier Reports, masking, ledger and Suspicious activity tests still pass
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0068' t, * from public.ctm_selftest_0068() union all select '0067' t, * from public.ctm_selftest_0067()
    union all select '0066' t, * from public.ctm_selftest_0066() union all select '0065' t, * from public.ctm_selftest_0065()
    union all select '0064' t, * from public.ctm_selftest_0064() union all select '0063' t, * from public.ctm_selftest_0063()
    union all select '0062' t, * from public.ctm_selftest_0062() union all select '0058' t, * from public.ctm_selftest_0058()
    union all select '0038' t, * from public.ctm_selftest_0038()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0068 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
