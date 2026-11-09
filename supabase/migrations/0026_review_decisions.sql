-- Owner decisions on the backend review questions (2026-11-09).

-- #3/#4: a reinstated loan that misses its new due date + grace period defaults again, like any other loan.
create or replace function public.ctm_default_detection_core()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  perform set_config('ctm.system', 'on', true);
  update public.loans set status = 'defaulted', defaulted_at = now()
  where status in ('active', 'extended', 'reinstated') and archived_at is null
    and (principal_balance > 0 or interest_owed > 0)
    and public.ctm_today() > maturity_date + grace_period_days;
  get diagnostics n = row_count;
  return n;
end $function$;

-- #30: Capitalize is refused once the grace period is over (reinstate the loan, or let it default).
create or replace function public.capitalize_loan(p_loan_id uuid, p_request_id uuid default null::uuid, p_expected_maturity date default null::date)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare l public.loans; v_cap numeric; v_new_principal numeric; v_new_maturity date; v_new_interest numeric; v_seen jsonb; v_result jsonb;
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into l from public.loans where id = p_loan_id for update;
  if not found or l.archived_at is not null then raise exception 'Loan not found'; end if;
  v_seen := public.ctm_request_seen(p_request_id, 'capitalize', p_loan_id);
  if v_seen is not null then return v_seen; end if;
  if p_expected_maturity is not null and l.maturity_date <> p_expected_maturity then
    raise exception 'This loan changed since you opened the page (due date is now %). Reload the page before capitalizing.', to_char(l.maturity_date, 'Mon FMDD, YYYY');
  end if;
  if l.status not in ('active','extended','reinstated') then raise exception 'Loan is % and cannot be capitalized', l.status; end if;
  if public.ctm_today() > l.maturity_date + l.grace_period_days then
    raise exception 'The grace period ended on %. This loan can no longer be capitalized.', to_char(l.maturity_date + l.grace_period_days, 'Mon FMDD, YYYY');
  end if;
  l := public.ctm_accrue_interest(p_loan_id);
  v_cap := round(l.interest_owed, 2);
  if v_cap <= 0 then raise exception 'There is no unpaid interest to capitalize. Use Renew instead.'; end if;
  v_new_principal := round(l.principal_balance + v_cap, 2);
  v_new_maturity := greatest(l.maturity_date, l.interest_accrued_through) + 30;
  v_new_interest := round(v_new_principal * l.interest_rate_percent / 100, 2);
  insert into public.loan_extensions (loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, extension_type, capitalized_amount, created_by)
  values (l.id, l.maturity_date, v_new_maturity, v_new_interest, 'capitalized', v_cap, auth.uid());
  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by, is_memo)
  values ('capitalization', 'in', v_cap, 'Interest capitalized into principal (non-cash) for ' || l.ticket_number, l.id, auth.uid(), true);
  update public.loans set principal_balance = v_new_principal, interest_owed = v_new_interest, maturity_date = v_new_maturity,
    interest_accrued_through = v_new_maturity, extension_count = extension_count + 1, status = 'extended'
  where id = l.id;
  update public.inventory_items set status = 'extended' where id = l.inventory_item_id;
  v_result := jsonb_build_object('capitalized', v_cap, 'new_principal', v_new_principal, 'new_maturity', v_new_maturity, 'new_interest', v_new_interest);
  if p_request_id is not null then insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'capitalize', l.id, v_result); end if;
  return v_result;
end $function$;

-- Data: the item of PT-SEED-04 (defaulted, NOT forfeited) was queued for auction by the old #2 bug.
-- Send it back to the vault and archive its one-item batch (no hard delete).
do $$
begin
  perform set_config('ctm.system', 'on', true);
  update public.inventory_items i
     set status = case when l.extension_count > 0 then 'extended'::text else 'pawned'::text end::public.inventory_status
    from public.loans l
   where l.inventory_item_id = i.id and i.status = 'queued_for_auction' and l.status <> 'forfeited';
  update public.auction_batches b
     set archived_at = now(), archive_reason = 'Item belonged to a defaulted (not forfeited) loan; queued by the old default bug'
   where b.id = '5867884b-c23d-4fbf-9ca7-5eda3bbf9516' and b.archived_at is null;
end $$;
