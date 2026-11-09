-- 0032 (Nov 9, 2026, Wush): Batch 2 of Matt's list. Nothing here changes existing data.
-- #6 (rest): the suspicious-activity flag (3 or more loans by one customer within 24 hours, the placeholder AML rule
--    from PB-32) is now saved by create_pawn_loan itself, in the same transaction as the loan. Before, the app
--    saved it afterwards with a second call, so a failure could leave a loan without its flag.
-- #21: an Admin identity correction is refused if the customer was changed after the Admin opened the page
--    (two Admins correcting the same customer: the second one gets a warning instead of silently overwriting).
-- Self-test: select * from public.ctm_selftest_0032();   (every test rolls back)

-- 1. create_pawn_loan: same as before, plus the flag at the end (one open flag per customer: a second is skipped)
do $$
declare f text;
begin
  f := pg_get_functiondef('public.create_pawn_loan(uuid,uuid,numeric,text)'::regprocedure);
  f := replace(f, '  return v_loan;
end',
'  -- #6: PB-32 placeholder AML rule (3+ loans within 24 hours), saved with the loan. The unique index allows one open flag per customer
  if (select count(*) from public.loans where customer_id = c.id and created_at > now() - interval ''24 hours'') >= 3 then
    insert into public.suspicious_activity_flags (customer_id, loan_id, reason)
    values (c.id, v_loan, ''Unusually high number of loans opened by this customer in a short window'')
    on conflict (customer_id) where status = ''open'' do nothing;
  end if;
  return v_loan;
end');
  if position('#6: PB-32' in f) = 0 then raise exception '0032: create_pawn_loan text not found'; end if;
  execute f;
end $$;

-- 2. Flags are only added by the database now (create_pawn_loan). Same lock pattern as #26 / #41.
alter policy "suspicious_activity_flags: cashier or admin insert" on public.suspicious_activity_flags with check (false);

-- 3. admin_edit_customer: + p_expected_updated_at (when the page loaded the customer). Old calls still work.
drop function public.admin_edit_customer(uuid, text, text, text, text, text, text);
create function public.admin_edit_customer(p_id uuid, p_full_name text, p_id_type text, p_id_number text, p_contact_number text, p_address text, p_reason text, p_expected_updated_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare b public.customers; a public.customers;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  if coalesce(trim(p_full_name), '') = '' or coalesce(trim(p_id_type), '') = '' or coalesce(trim(p_id_number), '') = '' then raise exception 'Name, ID type and ID number are required.'; end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.customers where id = p_id for update;
  if not found then raise exception 'Customer not found'; end if;
  -- #21: someone saved a change to this customer after the page was opened
  if p_expected_updated_at is not null and b.updated_at is distinct from p_expected_updated_at then
    raise exception 'Someone changed this customer after you opened the page. Reload the page, check the details, then correct again.';
  end if;
  update public.customers set full_name = trim(p_full_name), id_type = trim(p_id_type), id_number = trim(p_id_number),
    contact_number = coalesce(nullif(trim(p_contact_number), ''), contact_number), address = coalesce(nullif(trim(p_address), ''), address)
  where id = p_id returning * into a;
  perform public.ctm_log_admin_edit('customers', p_id, trim(p_reason), to_jsonb(b), to_jsonb(a));
end $$;
revoke execute on function public.admin_edit_customer(uuid, text, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.admin_edit_customer(uuid, text, text, text, text, text, text, timestamptz) to authenticated;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0032() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  admin_id uuid; cust uuid; items uuid[]; l uuid; n int; upd timestamptz; s text;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  -- a customer with no open flag and no loans today, and 3 available, unflagged items that fit a ₱100 loan
  select c.id into cust from customers c where c.archived_at is null and not c.is_blacklisted
    and not exists (select 1 from suspicious_activity_flags f where f.customer_id = c.id and f.status = 'open')
    and not exists (select 1 from loans x where x.customer_id = c.id and x.created_at > now() - interval '24 hours') limit 1;
  select array_agg(id) into items from (select id from appraisal_items where status = 'available' and archived_at is null
    and (not is_counterfeit_risk or counterfeit_resolution = 'cleared') and suggested_loan_max >= 100 limit 3) x;

  test := '#6 the 3rd loan within 24 hours saves a flag in the same call (and only one)';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    perform create_pawn_loan(cust, items[1], 100, 'SELFTEST');
    perform create_pawn_loan(cust, items[2], 100, 'SELFTEST');
    select count(*) into n from suspicious_activity_flags where customer_id = cust and status = 'open';
    s := n::text;
    l := create_pawn_loan(cust, items[3], 100, 'SELFTEST');
    execute 'reset role';
    select count(*) into n from suspicious_activity_flags where customer_id = cust and status = 'open' and loan_id = l;
    outcome := case when s = '0' and n = 1 then 'PASS (no flag after 2 loans, 1 flag after the 3rd)' else 'FAIL after2=' || s || ' after3=' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#6 a cashier cannot add a flag directly any more';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    insert into suspicious_activity_flags (customer_id, reason) values (cust, 'SELFTEST');
    raise exception 'ROWS:inserted';
  exception when others then outcome := case when sqlerrm like '%row-level security%' then 'PASS (refused)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := '#21 a correction from a page opened before another change is refused; with the current time it saves';
  begin
    select updated_at into upd from customers where id = cust;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin
      perform admin_edit_customer(cust, (select full_name from customers where id = cust) || ' X', (select id_type from customers where id = cust), 'SELFTEST1', '', '', 'SELFTEST stale', upd - interval '1 minute');
      s := 'saved';
    exception when others then s := case when sqlerrm like 'Someone changed this customer%' then 'refused' else sqlerrm end; end;
    perform admin_edit_customer(cust, (select full_name from customers where id = cust), (select id_type from customers where id = cust), 'SELFTEST2', '', '', 'SELFTEST current', upd);
    execute 'reset role';
    select count(*) into n from customers where id = cust and id_number = 'SELFTEST2';
    outcome := case when s = 'refused' and n = 1 then 'PASS' else 'FAIL stale=' || s || ' current=' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#21 an old-style call (no page time) still works';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform admin_edit_customer(cust, (select full_name from customers where id = cust), (select id_type from customers where id = cust), 'SELFTEST3', '', '', 'SELFTEST old call');
    outcome := 'PASS';
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0032() from public, anon, authenticated;
