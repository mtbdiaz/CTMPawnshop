-- 0041 (Nov 11, 2026, Wush): a Cashier may register a new customer.
-- Why: Matt asked for a "Register new customer" button on New Loan, for when the customer search finds nobody, so
--      the Cashier at the counter can register the person and go straight on with the loan. New Loan is a Cashier
--      page, but until now only an Operator or Admin could add a customer (owner decision, Nov 11: Cashier too).
-- What changes: only the INSERT rule on customers. Updating a customer stays Operator or Admin; identity fixes stay
--      Admin only; blacklisting stays Admin only (guard_blacklist_columns is not touched).
-- SAD note: UC1 (Register Customer) now has Operator and Cashier as actors.
-- Existing data: nothing changes.
-- Self-test: select * from public.ctm_selftest_0041();   (every test rolls back)

-- 1. the insert rule: Operator, Cashier or Admin (was Operator or Admin)
drop policy "customers: operator or admin can insert" on public.customers;
create policy "customers: operator, cashier or admin can insert" on public.customers
  for insert to authenticated
  with check (public.get_my_role() = any (array['operator', 'cashier', 'admin']::public.staff_role[]));

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
-- Note: each test insert uses up one customer number (C-number), because numbers are not given back on a rollback.
create or replace function public.ctm_selftest_0041() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  new_id uuid; s text; n int;
begin
  test := 'a Cashier can register a customer; an Appraiser still cannot';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    insert into customers (full_name, address, contact_number, id_type, id_number, aml_status, created_by)
    values ('SELFTEST Cashier Customer', 'SELFTEST', '09990000041', 'Postal ID', 'SELFTEST-0041-A', 'clear', cash_id)
    returning id into new_id;
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    begin
      insert into customers (full_name, address, contact_number, id_type, id_number, aml_status, created_by)
      values ('SELFTEST Appraiser Customer', 'SELFTEST', '09990000042', 'Postal ID', 'SELFTEST-0041-B', 'clear', appr_id);
      s := 'appraiser saved';
    exception when insufficient_privilege then s := 'appraiser refused'; end;
    execute 'reset role';
    outcome := case when new_id is not null and s = 'appraiser refused' then 'PASS' else 'FAIL ' || coalesce(s, 'cashier insert failed') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'a Cashier still cannot change a customer or blacklist one (0 rows changed)';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin
      update customers set address = address || ' SELFTEST' where id = (select x.id from customers x where x.archived_at is null order by x.customer_no limit 1);
      get diagnostics n = row_count;
      s := n || ' address';
    exception when others then s := 'address refused'; end;
    begin
      update customers set is_blacklisted = true where id = (select x.id from customers x where x.archived_at is null order by x.customer_no limit 1);
      get diagnostics n = row_count;
      s := s || '/' || n || ' blacklist';
    exception when others then s := s || '/blacklist refused'; end;
    execute 'reset role';
    outcome := case when s in ('0 address/0 blacklist', 'address refused/blacklist refused', '0 address/blacklist refused', 'address refused/0 blacklist') then 'PASS (' || s || ')' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0041() from public, anon, authenticated;
