-- 0038 (Nov 10, 2026, Wush): Batch 7, part A of Matt's list: the New Loan backend.
-- #37: vault_locations = the official list of vault locations. create_pawn_loan refuses a location that is not on
--      the list. The list starts with Vault A, Vault B and Safe 1 (owner decision); an Admin manages it in Settings.
-- #40: create_pawn_loan takes a one-time id (p_request_id), like payments since 0028: the same form sent twice
--      makes one loan.
-- #39: preview_pawn_loan = the interest, due date and amount to redeem for an amount, worked out by the database
--      with the same helper (ctm_loan_terms) the loan itself uses, so the screen and the loan can't disagree.
-- #38 (database side): an item appraised for one customer can't be pawned under another (owner decision: refuse).
--      Today only 2 of the 49 available items have a customer; part B adds the customer to New appraisal.
-- Existing data: nothing changes. Items already in the vault keep the location text they have (also the odd ones
-- like "123"). One new table (vault_locations) with 3 rows.
-- Self-test: select * from public.ctm_selftest_0038();   (every test rolls back)

-- 1. #37 the list
create table public.vault_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 2 and 40), -- no spaces at the ends, 2 to 40 characters
  is_active boolean not null default true, -- switched off = not offered for new loans any more (never deleted)
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index vault_locations_name_key on public.vault_locations (lower(name)); -- "vault a" and "Vault A" are the same place
insert into public.vault_locations (name) values ('Vault A'), ('Vault B'), ('Safe 1');

alter table public.vault_locations enable row level security;
create policy "vault_locations: staff select" on public.vault_locations for select to authenticated using (true);
create policy "vault_locations: admin insert" on public.vault_locations for insert to authenticated with check (public.is_admin());
create policy "vault_locations: admin update" on public.vault_locations for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.vault_locations from anon;
grant select, insert, update on public.vault_locations to authenticated; -- no delete: a location is switched off, not removed

-- a location can be switched on or off, but not renamed: stored items keep the name as text, so a rename would
-- make old records point at a name that is no longer on the list
create function public.guard_vault_location() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.name is distinct from old.name then
    raise exception 'A vault location can''t be renamed. Switch it off and add a new one.';
  end if;
  return new;
end $$;
create trigger vault_locations_guard before update on public.vault_locations
  for each row execute function public.guard_vault_location();
create trigger vault_locations_set_updated_at before update on public.vault_locations
  for each row execute function public.set_updated_at();
create trigger vault_locations_audit after insert or update or delete on public.vault_locations
  for each row execute function public.audit_trigger_fn(); -- every change is in the audit trail

-- 2. #39 the terms of a new loan for an amount: ONE place for the math, used by the loan and by the preview
create function public.ctm_loan_terms(p_principal numeric)
returns table(interest_rate_percent numeric, interest numeric, maturity_date date, grace_period_days integer)
language sql stable set search_path = public as $$
  select s.interest_rate_percent,
         round(p_principal * s.interest_rate_percent / 100, 2), -- one term of interest
         public.ctm_today() + 30,                               -- due 30 days from today (Manila date)
         s.grace_period_days
  from public.system_settings s where s.id = 1
$$;
revoke execute on function public.ctm_loan_terms(numeric) from public, anon;
grant execute on function public.ctm_loan_terms(numeric) to authenticated, service_role;

-- what the New Loan screen shows before the loan is made. It only reads.
create function public.preview_pawn_loan(p_appraisal_item_id uuid, p_principal_amount numeric)
returns table(max_loan numeric, interest_rate_percent numeric, interest numeric, maturity_date date, redeem_on_time numeric)
language sql stable set search_path = public as $$
  select a.suggested_loan_max, t.interest_rate_percent, t.interest, t.maturity_date, round(p_principal_amount + t.interest, 2)
  from public.appraisal_items a, public.ctm_loan_terms(p_principal_amount) t
  where a.id = p_appraisal_item_id
$$;
revoke execute on function public.preview_pawn_loan(uuid, numeric) from public, anon;
grant execute on function public.preview_pawn_loan(uuid, numeric) to authenticated;

-- 3. create_pawn_loan: the same as before, plus #37 (vault on the list), #38 (the item's customer), #40 (one-time id).
--    The old 4-input version is replaced (calls with 4 inputs still work: the 5th has a default).
drop function public.create_pawn_loan(uuid, uuid, numeric, text);
create function public.create_pawn_loan(p_customer_id uuid, p_appraisal_item_id uuid, p_principal_amount numeric, p_vault_location text default 'Vault A', p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  a public.appraisal_items; c public.customers; t record; r public.ctm_requests;
  v_vault text; v_asked text; v_inventory uuid; v_loan uuid; v_today date := public.ctm_today();
begin
  perform public.ctm_assert_role(array['cashier']::public.staff_role[]);
  perform set_config('ctm.system', 'on', true);
  select * into c from public.customers where id = p_customer_id;
  if not found or c.archived_at is not null then raise exception 'Customer not found'; end if;
  if c.is_blacklisted then raise exception 'Customer is blacklisted: %. Loan blocked.', coalesce(c.blacklist_reason, 'no reason on file'); end if;
  select * into a from public.appraisal_items where id = p_appraisal_item_id for update; -- two requests for one item wait in line here
  if not found or a.archived_at is not null then raise exception 'Appraised item not found'; end if;
  -- #40: this form was already saved (a retry, or Save pressed twice) -> return the first loan, save nothing new.
  -- Checked after the lock above, so the second of two requests at the same moment sees the first one's result
  if p_request_id is not null then
    select * into r from public.ctm_requests where id = p_request_id;
    if found then
      if r.kind <> 'new_loan' then raise exception 'This form was already used for something else. Reload the page.'; end if;
      return r.loan_id;
    end if;
  end if;
  if a.status <> 'available' then raise exception 'This item is already pawned. Record a new appraisal.'; end if;
  if a.is_counterfeit_risk and a.counterfeit_resolution is distinct from 'cleared' then raise exception 'This item is flagged as a counterfeit risk and has not been cleared by an Admin.'; end if;
  -- #38: an item appraised for one customer can't be pawned under another (an item with no customer is open to anyone)
  if a.customer_id is not null and a.customer_id <> c.id then
    raise exception 'This item was appraised for % (C-%). Choose that customer, or ask an Appraiser or Admin to change the customer on the appraisal.',
      (select x.full_name from public.customers x where x.id = a.customer_id),
      (select lpad(x.customer_no::text, 4, '0') from public.customers x where x.id = a.customer_id);
  end if;
  if p_principal_amount is null or p_principal_amount <= 0 then raise exception 'Loan amount must be greater than 0'; end if;
  if p_principal_amount > a.suggested_loan_max then raise exception 'Loan amount exceeds the maximum of %', a.suggested_loan_max; end if;
  -- #37: the vault location must be an active one on the list (capitals and spaces at the ends don't matter).
  -- Empty = Vault A, as before
  v_asked := coalesce(nullif(btrim(p_vault_location), ''), 'Vault A');
  select v.name into v_vault from public.vault_locations v where v.is_active and lower(v.name) = lower(v_asked);
  if v_vault is null then
    raise exception 'Vault location "%" is not on the list. Choose one from the list, or ask an Admin to add it in Settings.', v_asked;
  end if;
  select * into t from public.ctm_loan_terms(p_principal_amount); -- #39: the same math the preview shows
  insert into public.inventory_items (appraisal_item_id, vault_location, status) values (a.id, v_vault, 'pawned') returning id into v_inventory;
  insert into public.loans (customer_id, appraisal_item_id, inventory_item_id, principal_amount, principal_balance, interest_rate_percent, interest_owed, interest_accrued_through, grace_period_days, loan_date, maturity_date, ticket_number, created_by)
  values (c.id, a.id, v_inventory, p_principal_amount, p_principal_amount, t.interest_rate_percent, t.interest, t.maturity_date, t.grace_period_days, v_today, t.maturity_date,
    'PT-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDDHH24MISS') || '-' || upper(substr(md5(random()::text), 1, 4)), auth.uid()) returning id into v_loan;
  update public.appraisal_items set status = 'pawned', customer_id = c.id where id = a.id;
  insert into public.cash_flow_entries (entry_type, direction, amount, description, related_loan_id, created_by) values ('loan_disbursement', 'out', p_principal_amount, 'Loan disbursed', v_loan, auth.uid());
  -- #6: PB-32 placeholder AML rule (3+ loans within 24 hours), saved with the loan. The unique index allows one open flag per customer
  if (select count(*) from public.loans where customer_id = c.id and created_at > now() - interval '24 hours') >= 3 then
    insert into public.suspicious_activity_flags (customer_id, loan_id, reason)
    values (c.id, v_loan, 'Unusually high number of loans opened by this customer in a short window')
    on conflict (customer_id) where status = 'open' do nothing;
  end if;
  -- #40: remember this form's id, so the same form can't make a second loan
  if p_request_id is not null then
    insert into public.ctm_requests (id, kind, loan_id, result) values (p_request_id, 'new_loan', v_loan, jsonb_build_object('loan_id', v_loan));
  end if;
  return v_loan;
end $$;
revoke execute on function public.create_pawn_loan(uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.create_pawn_loan(uuid, uuid, numeric, text, uuid) to authenticated;

-- 4. the 0032 self-test made its loans in a vault called 'SELFTEST', which is not on the list, and it could pick an
--    item that was appraised for a different customer (now refused). Same test, real vault, items with no customer yet.
do $$
declare f text;
begin
  f := pg_get_functiondef('public.ctm_selftest_0032()'::regprocedure);
  if position('''SELFTEST'')' in f) = 0 then raise exception '0038: the SELFTEST vault was not found in ctm_selftest_0032'; end if;
  if position('and suggested_loan_max >= 100 limit 3) x' in f) = 0 then raise exception '0038: the item pick was not found in ctm_selftest_0032'; end if;
  f := replace(f, ', 100, ''SELFTEST'')', ', 100, ''Vault A'')');
  f := replace(f, 'and suggested_loan_max >= 100 limit 3) x', 'and customer_id is null and suggested_loan_max >= 100 limit 3) x');
  execute f;
end $$;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0038() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  admin_id uuid; cust uuid; cust2 uuid; items uuid[]; l uuid; l2 uuid; n int; s text; req uuid := gen_random_uuid();
  p record; lo public.loans;
begin
  select x.id into admin_id from profiles x where x.role = 'admin' and x.is_active order by x.created_at limit 1;
  -- two customers who may borrow, and three items anyone may pawn (available, not flagged, no customer yet)
  select x.id into cust from customers x where not x.is_blacklisted and x.archived_at is null order by x.customer_no limit 1;
  select x.id into cust2 from customers x where not x.is_blacklisted and x.archived_at is null and x.id <> cust order by x.customer_no limit 1;
  select array_agg(q.id) into items from (select x.id from appraisal_items x where x.status = 'available' and x.archived_at is null
    and not x.is_counterfeit_risk and x.customer_id is null and x.suggested_loan_max >= 100 order by x.appraisal_no limit 3) q;

  test := '#37 the list has the 3 locations; a cashier can read it but not add to it; a rename and a duplicate are refused';
  begin
    select count(*) into n from vault_locations where is_active and name in ('Vault A', 'Vault B', 'Safe 1');
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    s := (select count(*) from vault_locations)::text || ' readable';
    begin insert into vault_locations (name) values ('SELFTEST Vault'); s := s || '/cashier added';
    exception when insufficient_privilege then s := s || '/cashier refused'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    insert into vault_locations (name) values ('SELFTEST Vault'); -- an Admin may add
    begin update vault_locations set name = 'SELFTEST Other' where name = 'SELFTEST Vault'; s := s || '/renamed';
    exception when others then s := s || case when sqlerrm like '%can''t be renamed%' then '/rename refused' else '/' || sqlerrm end; end;
    begin insert into vault_locations (name) values ('vault a'); s := s || '/duplicate added';
    exception when unique_violation then s := s || '/duplicate refused'; end;
    execute 'reset role';
    outcome := case when n = 3 and s like '% readable/cashier refused/rename refused/duplicate refused' then 'PASS' else 'FAIL seeded=' || n || ' ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#37 a loan in a vault that is not on the list, or is switched off, is refused; " vault b " is saved as "Vault B"';
  begin
    if items is null or array_length(items, 1) < 3 then outcome := 'SKIP (needs 3 available items)'; else
    update vault_locations set is_active = false where name = 'Safe 1'; -- switched off for this test only
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform create_pawn_loan(cust, items[1], 100, '123'); s := 'unknown saved';
    exception when others then s := case when sqlerrm like '%is not on the list%' then 'unknown refused' else sqlerrm end; end;
    begin perform create_pawn_loan(cust, items[1], 100, 'Safe 1'); s := s || '/off saved';
    exception when others then s := s || case when sqlerrm like '%is not on the list%' then '/off refused' else '/' || sqlerrm end; end;
    l := create_pawn_loan(cust, items[1], 100, ' vault b ');
    execute 'reset role';
    select i.vault_location into s from inventory_items i join loans x on x.inventory_item_id = i.id where x.id = l and s = 'unknown refused/off refused';
    outcome := case when s = 'Vault B' then 'PASS' else 'FAIL ' || coalesce(s, 'refusals did not happen') end;
    end if;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#40 the same New Loan form sent twice makes one loan (same loan back, one cash entry); calls without an id still work';
  begin
    if items is null or array_length(items, 1) < 3 then outcome := 'SKIP (needs 3 available items)'; else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    l := create_pawn_loan(cust, items[1], 100, 'Vault A', req);
    l2 := create_pawn_loan(cust, items[1], 100, 'Vault A', req); -- the retry
    perform create_pawn_loan(cust, items[2], 100); -- old-style call: 3 inputs, no id
    execute 'reset role';
    select count(*) into n from cash_flow_entries where related_loan_id = l;
    outcome := case when l = l2 and n = 1 and (select count(*) from loans where appraisal_item_id = items[1]) = 1 then 'PASS' else 'FAIL same=' || (l = l2) || ' cash entries=' || n end;
    end if;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := '#38 an item appraised for one customer is refused for another customer and accepted for its own';
  begin
    if items is null or cust2 is null then outcome := 'SKIP (needs an item and 2 customers)'; else
    perform set_config('ctm.system', 'on', true);
    update appraisal_items set customer_id = cust where id = items[1]; -- as if the Appraiser picked this customer
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform create_pawn_loan(cust2, items[1], 100); s := 'other customer saved';
    exception when others then s := case when sqlerrm like 'This item was appraised for %' then 'refused' else sqlerrm end; end;
    l := create_pawn_loan(cust, items[1], 100);
    execute 'reset role';
    outcome := case when s = 'refused' and l is not null then 'PASS' else 'FAIL ' || s end;
    end if;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;

  test := '#39 the preview shows exactly what the loan gets (interest, due date, amount to redeem) and the item''s maximum';
  begin
    if items is null then outcome := 'SKIP (needs an available item)'; else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    select * into p from preview_pawn_loan(items[1], 100);
    l := create_pawn_loan(cust, items[1], 100);
    execute 'reset role';
    select * into lo from loans where id = l;
    outcome := case when p.interest = lo.interest_owed and p.maturity_date = lo.maturity_date and p.redeem_on_time = lo.principal_balance + lo.interest_owed
                         and p.interest_rate_percent = lo.interest_rate_percent and p.max_loan = (select suggested_loan_max from appraisal_items where id = items[1])
                    then 'PASS (interest ' || p.interest || ', due ' || p.maturity_date || ')' else 'FAIL preview ' || p.interest || '/' || p.maturity_date || ' loan ' || lo.interest_owed || '/' || lo.maturity_date end;
    end if;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0038() from public, anon, authenticated;
