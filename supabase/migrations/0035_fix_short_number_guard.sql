-- 0035 (Nov 9, 2026, Wush): fixes the number lock from 0034.
-- Bug: guard_short_number() checked "tg_table_name = 'customers' and new.customer_no ..." in one line. Postgres
-- doesn't skip the second half, so on an appraisal row it still read new.customer_no (a column appraisal_items
-- doesn't have) and every UPDATE on customers and appraisal_items failed with
-- 'record "new" has no field "customer_no"' (or "appraisal_no"). Inserts were fine, so only edits broke.
-- Fix: one small function per table, so each one only reads its own column.
-- Existing data: nothing changes.
-- Self-test: select * from public.ctm_selftest_0035();   (every test rolls back)

-- 1. one lock function per table
create or replace function public.guard_customer_no() returns trigger
language plpgsql set search_path = public as $$
begin
  -- the customer number is given out once and never changes
  if new.customer_no is distinct from old.customer_no then
    raise exception 'The customer number cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.guard_appraisal_no() returns trigger
language plpgsql set search_path = public as $$
begin
  -- the appraisal number is given out once and never changes
  if new.appraisal_no is distinct from old.appraisal_no then
    raise exception 'The appraisal number cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;

-- 2. point the two triggers at their own function (same trigger names as 0034)
drop trigger customers_guard_short_number on public.customers;
create trigger customers_guard_short_number before update on public.customers
  for each row execute function public.guard_customer_no();
drop trigger appraisal_items_guard_short_number on public.appraisal_items;
create trigger appraisal_items_guard_short_number before update on public.appraisal_items
  for each row execute function public.guard_appraisal_no();

-- 3. the old shared function isn't used any more
drop function public.guard_short_number();

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0035() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  c_id uuid; a_id uuid; n int; s text;
begin
  select c.id into c_id from customers c where c.archived_at is null order by c.customer_no limit 1;
  select a.id into a_id from appraisal_items a where a.status = 'available' and a.archived_at is null and not a.is_counterfeit_risk limit 1;

  test := 'an ordinary change to a customer saves again';
  begin
    update customers set address = coalesce(address, '') || ' SELFTEST' where id = c_id;
    get diagnostics n = row_count;
    outcome := case when n = 1 then 'PASS' else 'FAIL rows=' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'an ordinary change to an appraisal saves again (Appraiser login)';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    update appraisal_items set condition_notes = coalesce(condition_notes, '') || ' SELFTEST' where id = a_id;
    get diagnostics n = row_count;
    execute 'reset role';
    outcome := case when n = 1 then 'PASS' else 'FAIL rows=' || n || ' (RLS may hide it from this appraiser)' end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'changing a customer number is refused with the right message';
  begin
    begin update customers set customer_no = customer_no + 100000 where id = c_id; s := 'saved';
    exception when others then s := sqlerrm; end;
    outcome := case when s = 'The customer number cannot be changed.' then 'PASS (refused)' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;

  test := 'changing an appraisal number is refused with the right message';
  begin
    begin update appraisal_items set appraisal_no = appraisal_no + 100000 where id = a_id; s := 'saved';
    exception when others then s := sqlerrm; end;
    outcome := case when s = 'The appraisal number cannot be changed.' then 'PASS (refused)' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0035() from public, anon, authenticated;
