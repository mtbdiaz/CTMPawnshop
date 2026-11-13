-- 0074 (Nov 14, 2026, Wush): an Admin correction of a loan's due date also moves the liquidated damages count (0073).
-- Found while testing 0073: admin_edit_loan() already moves interest_accrued_through when the due date changes
-- (greatest(old, new due date)), but not damages_accrued_through. So after damages were written down once, moving the due
-- date later kept counting damages from the old date (for example from Dec 7 on a loan now due Dec 11).
-- Now, the same way as the interest: when the due date changes and damages were already written down up to a day, they
-- continue from the later of that day and the new due date + grace days. Nothing else in the function changes, and no
-- loan is changed by this migration (no loan has damages written down yet).
-- Self-test: select * from public.ctm_selftest_0074();   (every test rolls back)

create or replace function public.admin_edit_loan(p_id uuid, p_principal_amount numeric, p_interest_rate_percent numeric, p_maturity_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.loans; a public.loans; v_delta numeric;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.loans where id = p_id for update;
  if not found then raise exception 'Loan not found'; end if;
  if p_principal_amount is null or p_principal_amount <= 0 then raise exception 'Principal must be greater than 0'; end if;
  if p_interest_rate_percent is null or p_interest_rate_percent < 0 then raise exception 'Interest rate cannot be negative'; end if;
  v_delta := round(p_principal_amount - b.principal_amount, 2);
  if b.principal_balance + v_delta < 0 then raise exception 'That principal is lower than what has already been repaid.'; end if;
  update public.loans set principal_amount = p_principal_amount, principal_balance = principal_balance + v_delta, interest_rate_percent = p_interest_rate_percent,
    maturity_date = coalesce(p_maturity_date, maturity_date),
    interest_accrued_through = case when p_maturity_date is not null and p_maturity_date <> b.maturity_date then greatest(interest_accrued_through, p_maturity_date) else interest_accrued_through end,
    -- 0074: the liquidated damages count follows a new due date too (null = not written down yet: it already starts from the new date)
    damages_accrued_through = case when p_maturity_date is not null and p_maturity_date <> b.maturity_date and b.damages_accrued_through is not null
                                   then greatest(b.damages_accrued_through, p_maturity_date + coalesce(b.grace_period_days, 0)) else damages_accrued_through end
  where id = p_id returning * into a;
  if v_delta <> 0 then
    insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by)
    values ('adjustment', case when v_delta > 0 then 'out'::public.cash_flow_direction else 'in'::public.cash_flow_direction end, abs(v_delta), 'Admin correction to disbursement for ' || b.ticket_number || ': ' || trim(p_reason), p_id, auth.uid());
  end if;
  perform public.ctm_log_admin_edit('loans', p_id, trim(p_reason), to_jsonb(b), to_jsonb(a));
end $$;

create or replace function public.ctm_selftest_0074() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare admin_id uuid; l public.loans; a public.loans; s text; v_loans int; v_audit int; v_ledger int;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select count(*) into v_loans from loans; select count(*) into v_audit from audit_log; select count(*) into v_ledger from cash_flow_entries;
  select * into l from loans where status in ('active', 'extended') and archived_at is null and principal_balance > 0 order by maturity_date, id limit 1;

  test := 'Admin due-date correction: damages written down up to a day continue from the later of that day and the new due date + grace days; not written down = unchanged (null); same due date = unchanged; principal, rate and interest rules as before';
  begin
    update loans set damages_accrued_through = l.maturity_date + 20 where id = l.id; -- as if damages were written down once
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform admin_edit_loan(l.id, l.principal_amount, l.interest_rate_percent, l.maturity_date + 60, 'selftest 0074');
    execute 'reset role';
    select * into a from loans where id = l.id;
    s := (a.damages_accrued_through = l.maturity_date + 60 + l.grace_period_days and a.maturity_date = l.maturity_date + 60
          and a.interest_accrued_through = greatest(coalesce(l.interest_accrued_through, l.maturity_date), l.maturity_date + 60) and a.principal_balance = l.principal_balance)::text;
    -- moving it earlier keeps the later day already counted
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform admin_edit_loan(l.id, l.principal_amount, l.interest_rate_percent, l.maturity_date, 'selftest 0074');
    execute 'reset role';
    select * into a from loans where id = l.id;
    s := s || ',' || (a.damages_accrued_through = l.maturity_date + 60 + l.grace_period_days)::text;
    -- not written down: stays null
    update loans set damages_accrued_through = null where id = l.id;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform admin_edit_loan(l.id, l.principal_amount, l.interest_rate_percent, l.maturity_date + 30, 'selftest 0074');
    execute 'reset role';
    select * into a from loans where id = l.id;
    s := s || ',' || (a.damages_accrued_through is null)::text;
    outcome := case when s = 'true,true,true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role';
  if (select count(*) from loans) <> v_loans or (select count(*) from audit_log) <> v_audit or (select count(*) from cash_flow_entries) <> v_ledger then
    outcome := 'FAIL something changed after the test';
  end if;
  return next;
end $$;
revoke all on function public.ctm_selftest_0074() from public, anon, authenticated;

do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0074' t, * from public.ctm_selftest_0074() union all select '0073' t, * from public.ctm_selftest_0073()
    union all select '0043' t, * from public.ctm_selftest_0043() union all select '0036' t, * from public.ctm_selftest_0036()
    union all select '0066' t, * from public.ctm_selftest_0066() union all select '0038' t, * from public.ctm_selftest_0038()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0074 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
