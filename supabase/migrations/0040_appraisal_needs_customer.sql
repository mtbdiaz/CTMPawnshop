-- 0040 (Nov 10, 2026, Wush): Batch 7, part B of Matt's list (2 of 2). Apply AFTER the New appraisal form with the
-- customer picker is live: the old form sends no customer and would be refused.
-- #38 (rest): a new appraisal must say which customer the item belongs to (owner decision). Until now the customer
--      was only filled in when the item was pawned, so nothing tied an appraised item to the person who brought it.
--      Old appraisals without a customer stay as they are and can still be pawned by anyone.
-- Existing data: nothing changes.
-- Self-test: select * from public.ctm_selftest_0040();   (every test rolls back)

-- 1. a new appraisal needs a customer who exists and is not archived
create function public.guard_appraisal_customer() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.ctm_is_system() then return new; end if; -- the database's own functions and the seed data are not held up
  if new.customer_id is null then
    raise exception 'Choose the customer this item belongs to.';
  end if;
  if not exists (select 1 from public.customers c where c.id = new.customer_id and c.archived_at is null) then
    raise exception 'Customer not found. Choose the customer again.';
  end if;
  return new;
end $$;
create trigger appraisal_items_require_customer before insert on public.appraisal_items
  for each row execute function public.guard_appraisal_customer();


-- 2. two older self-tests (0033, 0034) add a test appraisal without a customer, which is refused from now on.
--    Same tests, now with a customer on the test appraisal.
do $$
declare f text; fn text;
begin
  foreach fn in array array['public.ctm_selftest_0033()', 'public.ctm_selftest_0034()'] loop
    f := pg_get_functiondef(fn::regprocedure);
    if position('category, status)' in f) = 0 or position('''ring'', ''available'')' in f) = 0 then
      raise exception '0040: the appraisal insert was not found in %', fn;
    end if;
    f := replace(f, 'category, status)', 'category, status, customer_id)');
    f := replace(f, '''ring'', ''available'')', '''ring'', ''available'', (select x.id from customers x where x.archived_at is null order by x.customer_no limit 1))');
    execute f;
  end loop;
end $$;

-- Self-test (owner only). Pretends to be a real staff account; everything rolls back.
create or replace function public.ctm_selftest_0040() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  cust uuid; arch uuid; new_id uuid; s text;
begin
  select x.id into cust from customers x where x.archived_at is null and not x.is_blacklisted order by x.customer_no limit 1;
  select x.id into arch from customers x where x.archived_at is not null limit 1; -- an archived customer, if there is one

  test := '#38 a new appraisal without a customer is refused; with a customer it saves';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    begin
      insert into appraisal_items (category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appraised_by)
      values ('ring', 18, 1, 100, 50, 100, 0, 50, appr_id);
      s := 'saved without';
    exception when others then s := case when sqlerrm like 'Choose the customer%' then 'refused' else sqlerrm end; end;
    insert into appraisal_items (category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appraised_by, customer_id)
    values ('ring', 18, 1, 100, 50, 100, 0, 50, appr_id, cust) returning id into new_id;
    execute 'reset role';
    outcome := case when s = 'refused' and (select customer_id from appraisal_items where id = new_id) = cust then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'a new appraisal for an archived customer is refused';
  begin
    if arch is null then outcome := 'SKIP (no archived customer)'; else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    begin
      insert into appraisal_items (category, karat, weight_grams, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appraised_by, customer_id)
      values ('ring', 18, 1, 100, 50, 100, 0, 50, appr_id, arch);
      s := 'saved';
    exception when others then s := case when sqlerrm like 'Customer not found%' then 'refused' else sqlerrm end; end;
    execute 'reset role';
    outcome := case when s = 'refused' then 'PASS' else 'FAIL ' || s end;
    end if;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0040() from public, anon, authenticated;
