-- 0043 (Nov 11, 2026, Wush): a payment that clears the interest on an OVERDUE loan renews the loan by itself.
-- Why: Matt (Nov 11): "dapat automatically na siya ma mark ang renew pag na pay na ang interest". Before this, a
--      Cashier could take the interest with Record payment, but the due date stayed in the past, so the loan still
--      showed Overdue and the nightly 12:05 AM check would mark it Defaulted after the grace period, even though the
--      customer had paid. To renew, the Cashier had to also press Renew.
-- Owner decisions (Wush, Nov 11):
--   - only when the loan is past its due date (an early interest payment stays a normal payment, so the customer is
--     not billed next month's interest early)
--   - the renewal is exactly what the Renew button does (renew_loan): new due date = 30 days after the date the
--     interest is paid up to, and one term of interest is billed for the new term
--   - the same eligibility as Renew: not after the grace period (reinstated loans have no grace limit)
-- Existing data: loans that are already in that state (overdue, interest fully paid, principal still owed, within
--   grace) are renewed now, credited to the staff member who recorded their last payment. Today that is one loan.
-- Self-test: select * from public.ctm_selftest_0043();   (every test rolls back)

-- 1. the renewal itself, used by record_payment and by the clean-up below.
--    Returns the new due date, or null when the loan doesn't qualify (then nothing changes).
create function public.ctm_auto_renew(p_loan uuid, p_by uuid) returns date
language plpgsql security definer set search_path = public as $$
declare l public.loans; v_new date; v_interest numeric;
begin
  perform set_config('ctm.system', 'on', true); -- past the loan lock (only functions may change loans)
  select * into l from public.loans where id = p_loan for update;
  if not found
     or l.archived_at is not null
     or l.status not in ('active', 'extended', 'reinstated') -- an open loan
     or l.principal_balance <= 0                              -- fully paid: Redeem, not renew
     or l.interest_owed > 0                                   -- interest not fully paid yet
     or public.ctm_today() <= l.maturity_date                 -- not overdue: a normal payment
     or (l.status <> 'reinstated' and public.ctm_today() > l.maturity_date + coalesce(l.grace_period_days, 0)) -- past grace: Renew refuses too
  then
    return null;
  end if;
  -- same numbers as renew_loan: the new term starts where the paid interest ends
  v_new := greatest(l.maturity_date, coalesce(l.interest_accrued_through, l.maturity_date)) + 30;
  v_interest := round(l.principal_balance * l.interest_rate_percent / 100, 2);
  insert into public.loan_extensions (loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, extension_type, created_by)
  values (l.id, l.maturity_date, v_new, v_interest, 'renewal', p_by);
  update public.loans set maturity_date = v_new, interest_accrued_through = v_new, interest_owed = v_interest,
    extension_count = extension_count + 1, status = 'extended'
  where id = l.id;
  update public.inventory_items set status = 'extended' where id = l.inventory_item_id;
  return v_new;
end $$;
revoke all on function public.ctm_auto_renew(uuid, uuid) from public, anon, authenticated; -- only other functions call it

-- 2. record_payment: unchanged, plus the renewal at the end. It also says if it renewed ("renewed_to").
create or replace function public.record_payment(p_loan_id uuid, p_amount numeric, p_lost_ticket boolean default false, p_id_confirm text default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.loans; v_id text; v_interest numeric; v_principal numeric; v_total numeric; v_receipt text; v_payment uuid; v_seen jsonb; v_result jsonb; v_renewed date;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id for update;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  v_seen := public.ctm_request_seen(p_request_id, 'payment', p_loan_id);
  if v_seen is not null then return v_seen; end if;
  if l.status not in ('active','extended','reinstated') then raise exception 'Loan is % and accepts no further payments', l.status; end if;
  if p_lost_ticket then
    select id_number into v_id from public.customers where id = l.customer_id;
    if v_id is null or public.ctm_norm_id(v_id) <> public.ctm_norm_id(p_id_confirm) then raise exception 'ID number does not match our records for this customer.'; end if;
  end if;
  l := public.ctm_accrue_interest(p_loan_id);
  v_total := round(l.principal_balance + l.interest_owed, 2);
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than 0'; end if;
  if p_amount > v_total then raise exception 'Payment of % exceeds the total owed (%)', p_amount, v_total; end if;
  v_receipt := public.ctm_receipt_number();
  v_interest := least(p_amount, l.interest_owed);
  v_principal := least(p_amount - v_interest, l.principal_balance);
  insert into public.loan_payments (loan_id, amount, principal_portion, interest_portion, receipt_number, verified_via_lost_ticket, created_by)
  values (l.id, p_amount, v_principal, v_interest, v_receipt, coalesce(p_lost_ticket, false), auth.uid()) returning id into v_payment;
  update public.loans set principal_balance = principal_balance - v_principal, interest_owed = interest_owed - v_interest,
    lost_ticket_used = lost_ticket_used or coalesce(p_lost_ticket, false),
    late_payment_count = late_payment_count + case when public.ctm_today() > maturity_date then 1 else 0 end
  where id = l.id;
  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
  values ('payment_received', 'in', p_amount, 'Payment ' || v_receipt || ' for ' || l.ticket_number, l.id, auth.uid());
  -- 0043: an overdue loan whose interest is now fully paid is renewed, like pressing Renew (null = not renewed)
  v_renewed := public.ctm_auto_renew(l.id, auth.uid());
  v_result := jsonb_build_object('payment_id', v_payment, 'receipt_number', v_receipt, 'renewed_to', v_renewed);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'payment', l.id, v_result); end if;
  return v_result;
end $$;

-- 3. loans already in that state today (interest paid past the due date, still overdue, within grace)
do $$
declare r record;
begin
  for r in
    select l.id, (select p.created_by from public.loan_payments p where p.loan_id = l.id order by p.created_at desc limit 1) as paid_by
    from public.loans l
    where l.archived_at is null and l.status in ('active', 'extended', 'reinstated') and l.principal_balance > 0
      and l.interest_owed = 0 and l.interest_accrued_through > l.maturity_date and public.ctm_today() > l.maturity_date
  loop
    perform public.ctm_auto_renew(r.id, r.paid_by); -- checks the grace period itself
  end loop;
  perform set_config('ctm.system', 'off', true);
end $$;

-- Self-test (owner only). Pretends to be a real Cashier account; everything rolls back.
-- Note: each test payment uses up one receipt number, because numbers are not given back on a rollback.
create or replace function public.ctm_selftest_0043() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  lid uuid; p numeric; rate numeric; grace int; term numeric; t date := ctm_today(); res jsonb; m date; st text; io numeric; ext int; ext0 int;
begin
  -- an open loan to bend into each situation (as the owner; the changes roll back)
  select x.id, x.principal_balance, x.interest_rate_percent, coalesce(x.grace_period_days, 0) into lid, p, rate, grace
  from loans x where x.archived_at is null and x.status in ('active', 'extended') and x.principal_balance > 100 order by x.created_at limit 1;
  term := round(p * rate / 100, 2);

  test := 'overdue, the payment clears the interest: renewed like Renew (new due date, one term billed, Renewed)';
  begin
    perform set_config('ctm.system', 'on', true);
    update loans set maturity_date = t - 3, interest_accrued_through = t - 3, interest_owed = 0, status = 'active' where id = lid;
    select count(*) into ext0 from loan_extensions where loan_id = lid;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    res := record_payment(lid, term); -- the accrual adds one term (3 days late), the payment clears it
    execute 'reset role';
    select maturity_date, status::text, interest_owed into m, st, io from loans where id = lid;
    select count(*) into ext from loan_extensions where loan_id = lid;
    outcome := case when (res->>'renewed_to')::date = t + 57 and m = t + 57 and st = 'extended' and io = term and ext = ext0 + 1
                    then 'PASS (due ' || m || ')' else 'FAIL ' || res::text || ' ' || m || ' ' || st || ' ' || io || ' ' || ext || '/' || ext0 end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'overdue, only part of the interest paid: a normal payment, still overdue';
  begin
    perform set_config('ctm.system', 'on', true);
    update loans set maturity_date = t - 3, interest_accrued_through = t - 3, interest_owed = 0, status = 'active' where id = lid;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    res := record_payment(lid, round(term / 2, 2));
    execute 'reset role';
    select maturity_date into m from loans where id = lid;
    outcome := case when res->>'renewed_to' is null and m = t - 3 then 'PASS' else 'FAIL ' || res::text || ' ' || m end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'not due yet, the interest is paid early: a normal payment, nothing new billed';
  begin
    perform set_config('ctm.system', 'on', true);
    update loans set maturity_date = t + 10, interest_accrued_through = t + 10, interest_owed = term, status = 'active' where id = lid;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    res := record_payment(lid, term);
    execute 'reset role';
    select maturity_date, interest_owed into m, io from loans where id = lid;
    outcome := case when res->>'renewed_to' is null and m = t + 10 and io = 0 then 'PASS' else 'FAIL ' || res::text || ' ' || m || ' ' || io end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'past the grace period: the payment is saved but the loan is not renewed (same as Renew)';
  begin
    perform set_config('ctm.system', 'on', true);
    update loans set maturity_date = t - grace - 2, interest_accrued_through = t - grace - 2, interest_owed = 0, status = 'active' where id = lid;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    res := record_payment(lid, term);
    execute 'reset role';
    select maturity_date into m from loans where id = lid;
    outcome := case when res->>'renewed_to' is null and m = t - grace - 2 and res->>'receipt_number' is not null then 'PASS' else 'FAIL ' || res::text || ' ' || m end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'overdue and paid in full: not renewed (the item is redeemed instead)';
  begin
    perform set_config('ctm.system', 'on', true);
    update loans set maturity_date = t - 3, interest_accrued_through = t - 3, interest_owed = 0, status = 'active' where id = lid;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    res := record_payment(lid, p + term);
    execute 'reset role';
    select maturity_date, principal_balance into m, io from loans where id = lid;
    outcome := case when res->>'renewed_to' is null and m = t - 3 and io = 0 then 'PASS' else 'FAIL ' || res::text || ' ' || m || ' ' || io end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0043() from public, anon, authenticated;
