-- 0039 (Nov 10, 2026, Wush): Batch 7, part B of Matt's list (1 of 2).
-- #38 (rest): set_appraisal_customer() = an Appraiser or Admin can put or correct the customer on an appraisal that
--      is not pawned yet (a direct change of customer_id stays locked, as before). The rule "a new appraisal must
--      have a customer" is in 0040, which is applied after the new form is live, so the old form keeps working until then.
-- #36: reminder_queue() = the Reminders list in one call: the loans due today up to 3 days from now that still owe
--      money, each with its contact logs (newest first). The page asked for the loans and then for the logs in groups.
-- Existing data: nothing changes. No new tables or columns.
-- Self-test: select * from public.ctm_selftest_0039();   (every test rolls back)

-- 1. #38 put or correct the customer on an appraisal that is not pawned yet. Appraiser or Admin only.
--    p_expected_updated_at = when the page loaded the appraisal; if someone changed it since, nothing is saved.
create function public.set_appraisal_customer(p_appraisal_id uuid, p_customer_id uuid, p_expected_updated_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.appraisal_items;
begin
  perform public.ctm_assert_role(array['appraiser']::public.staff_role[]); -- Admin always passes
  select * into a from public.appraisal_items where id = p_appraisal_id for update;
  if not found then raise exception 'Appraisal not found.'; end if;
  if a.status <> 'available' or a.archived_at is not null then
    raise exception 'This item is already pawned or archived, so its customer can''t be changed.';
  end if;
  if p_expected_updated_at is not null and a.updated_at <> p_expected_updated_at then
    raise exception 'Someone changed this appraisal after you opened the page. Reload the page, then try again.';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.archived_at is null) then
    raise exception 'Customer not found. Choose the customer again.';
  end if;
  if a.customer_id = p_customer_id then
    raise exception 'This item already belongs to that customer, so nothing was changed.';
  end if;
  perform set_config('ctm.system', 'on', true);  -- lets this one change through the lock on customer_id
  update public.appraisal_items set customer_id = p_customer_id where id = p_appraisal_id; -- the audit trail records old and new
  perform set_config('ctm.system', 'off', true);
end $$;
revoke execute on function public.set_appraisal_customer(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.set_appraisal_customer(uuid, uuid, timestamptz) to authenticated;

-- 2. #36 the Reminders list. Runs as the person who calls it, so the normal read rules on loans and reminder_log apply.
--    Same rules as the page had: running loans (Active, Renewed, Reinstated), not archived, due today up to
--    p_lead_days from now (Manila date), still owing money; archived logs don't count.
create function public.reminder_queue(p_lead_days integer default 3)
returns table(id uuid, customer_id uuid, maturity_date date, logs jsonb)
language sql stable set search_path = public as $$
  select l.id, l.customer_id, l.maturity_date,
         coalesce((select jsonb_agg(jsonb_build_object('loan_id', r.loan_id, 'sent_at', r.sent_at, 'created_by', r.created_by,
                                                       'contact_method', r.contact_method, 'outcome', r.outcome, 'notes', r.notes)
                                    order by r.sent_at desc) -- newest first
                   from public.reminder_log r where r.loan_id = l.id and r.archived_at is null), '[]'::jsonb)
  from public.loans l
  where l.status in ('active', 'extended', 'reinstated') and l.archived_at is null
    and l.maturity_date between public.ctm_today() and public.ctm_today() + least(greatest(p_lead_days, 0), 30)
    and (l.principal_balance > 0 or l.interest_owed > 0) -- fully paid loans waiting for release are left out
  order by l.maturity_date, l.id
$$;
revoke execute on function public.reminder_queue(integer) from public, anon;
grant execute on function public.reminder_queue(integer) to authenticated;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0039() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  cust uuid; cust2 uuid; item uuid; pawned uuid; n int; m int; s text;
begin
  select x.id into cust from customers x where x.archived_at is null and not x.is_blacklisted order by x.customer_no limit 1;
  select x.id into cust2 from customers x where x.archived_at is null and not x.is_blacklisted and x.id <> cust order by x.customer_no limit 1;
  select x.id into item from appraisal_items x where x.status = 'available' and x.archived_at is null and x.customer_id is null order by x.appraisal_no limit 1;
  select x.id into pawned from appraisal_items x where x.status = 'pawned' and x.archived_at is null limit 1;

  test := '#38 an Appraiser can set and correct the customer on an unpawned item; the same customer again is refused';
  begin
    if item is null or cust2 is null then outcome := 'SKIP (needs an available item without a customer and 2 customers)'; else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    perform set_appraisal_customer(item, cust);
    perform set_appraisal_customer(item, cust2); -- a correction
    begin perform set_appraisal_customer(item, cust2); s := 'same saved';
    exception when others then s := case when sqlerrm like '%already belongs%' then 'same refused' else sqlerrm end; end;
    execute 'reset role';
    outcome := case when s = 'same refused' and (select customer_id from appraisal_items where id = item) = cust2 then 'PASS' else 'FAIL ' || s end;
    end if;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;

  test := '#38 a Cashier cannot change the customer; a pawned item and a stale page are refused; a direct change stays locked';
  begin
    if item is null or pawned is null then outcome := 'SKIP (needs an available and a pawned item)'; else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform set_appraisal_customer(item, cust); s := 'cashier saved';
    exception when others then s := 'cashier refused'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    begin perform set_appraisal_customer(pawned, cust2); s := s || '/pawned saved';
    exception when others then s := s || case when sqlerrm like '%already pawned or archived%' then '/pawned refused' else '/' || sqlerrm end; end;
    begin perform set_appraisal_customer(item, cust, now() - interval '1 year'); s := s || '/stale saved';
    exception when others then s := s || case when sqlerrm like 'Someone changed this appraisal%' then '/stale refused' else '/' || sqlerrm end; end;
    begin update appraisal_items set customer_id = cust where id = item; s := s || '/direct saved';
    exception when others then s := s || '/direct refused'; end;
    execute 'reset role';
    outcome := case when s = 'cashier refused/pawned refused/stale refused/direct refused' then 'PASS' else 'FAIL ' || s end;
    end if;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;

  test := '#36 reminder_queue gives exactly the loans the page listed, each with all its unarchived logs, newest first';
  begin
    -- the same rules written out again, to compare with
    select count(*) into n from loans l where l.status in ('active', 'extended', 'reinstated') and l.archived_at is null
      and l.maturity_date between ctm_today() and ctm_today() + 3 and (l.principal_balance > 0 or l.interest_owed > 0);
    select count(*) into m from reminder_queue() q join loans l on l.id = q.id
      where l.status in ('active', 'extended', 'reinstated') and l.archived_at is null
        and l.maturity_date between ctm_today() and ctm_today() + 3 and (l.principal_balance > 0 or l.interest_owed > 0)
        and jsonb_array_length(q.logs) = (select count(*) from reminder_log r where r.loan_id = q.id and r.archived_at is null)
        and (jsonb_array_length(q.logs) < 2 or (q.logs -> 0 ->> 'sent_at')::timestamptz >= (q.logs -> 1 ->> 'sent_at')::timestamptz);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    s := (select count(*) from reminder_queue())::text; -- a Cashier sees the same list
    execute 'reset role';
    outcome := case when n = m and (select count(*) from reminder_queue()) = n and s = n::text and (select count(*) from reminder_queue(0)) <= n
                    then 'PASS (' || n || ' loans)' else 'FAIL expected=' || n || ' matching=' || m || ' cashier=' || s end;
  exception when others then execute 'reset role'; outcome := 'FAIL ' || sqlerrm; end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0039() from public, anon, authenticated;
