-- 0034 (Nov 9, 2026, Wush): #18 + #29 short numbers staff can say and write down.
-- customers.customer_no -> shown as C-0001; appraisal_items.appraisal_no -> shown as A-0001 (the app adds the
-- letter and zeros). Existing rows get numbers in the order they were created (oldest = 1). New rows get the next
-- number automatically. The number never changes once given.
-- Existing data: only the two new columns are filled. Nothing else changes.
-- Self-test: select * from public.ctm_selftest_0034();   (every test rolls back)

-- 1. the columns, filled oldest first (id breaks ties so the order is always the same)
alter table public.customers add column customer_no integer;
alter table public.appraisal_items add column appraisal_no integer;
-- The fill skips this table's own triggers (audit trail, updated_at, guards) on purpose: giving every old record
-- a number isn't a change to the customer or item, so it shouldn't add 1,744 audit entries or make every record
-- look "just changed" (Batch 2's stale-page check and the appraisal page compare updated_at). Switched back on right after.
alter table public.customers disable trigger user;
alter table public.appraisal_items disable trigger user;
update public.customers c set customer_no = x.n
from (select id, row_number() over (order by created_at, id) n from public.customers) x where x.id = c.id;
update public.appraisal_items a set appraisal_no = x.n
from (select id, row_number() over (order by created_at, id) n from public.appraisal_items) x where x.id = a.id;
alter table public.customers enable trigger user;
alter table public.appraisal_items enable trigger user;

-- 2. new rows: the next number from a sequence that starts after the highest one given above
create sequence public.customer_no_seq;
create sequence public.appraisal_no_seq;
select setval('public.customer_no_seq', coalesce((select max(customer_no) from public.customers), 0) + 1, false);
select setval('public.appraisal_no_seq', coalesce((select max(appraisal_no) from public.appraisal_items), 0) + 1, false);
alter table public.customers alter column customer_no set default nextval('public.customer_no_seq'), alter column customer_no set not null;
alter table public.appraisal_items alter column appraisal_no set default nextval('public.appraisal_no_seq'), alter column appraisal_no set not null;
alter sequence public.customer_no_seq owned by public.customers.customer_no;
alter sequence public.appraisal_no_seq owned by public.appraisal_items.appraisal_no;
alter table public.customers add constraint customers_customer_no_key unique (customer_no);
alter table public.appraisal_items add constraint appraisal_items_appraisal_no_key unique (appraisal_no);
-- staff insert rows through the API; they need to use the sequences for the default to work
grant usage on sequence public.customer_no_seq, public.appraisal_no_seq to authenticated;

-- 3. a number never changes once given (not even by an Admin), so a written-down number always finds the same record
create or replace function public.guard_short_number() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'customers' and new.customer_no is distinct from old.customer_no then
    raise exception 'The customer number cannot be changed.' using errcode = '42501';
  end if;
  if tg_table_name = 'appraisal_items' and new.appraisal_no is distinct from old.appraisal_no then
    raise exception 'The appraisal number cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger customers_guard_short_number before update on public.customers for each row execute function public.guard_short_number();
create trigger appraisal_items_guard_short_number before update on public.appraisal_items for each row execute function public.guard_short_number();

-- 4. Matt's 0027 note: staff can only read the customer columns granted to them, so the new one is added here
grant select (customer_no) on public.customers to authenticated;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
create or replace function public.ctm_selftest_0034() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  n int; m int; c uuid; a uuid; nc int; na int;
begin
  test := 'every customer and appraisal has a unique number';
  select count(*) - count(distinct customer_no) + count(*) filter (where customer_no is null) into n from customers;
  select count(*) - count(distinct appraisal_no) + count(*) filter (where appraisal_no is null) into m from appraisal_items;
  outcome := case when n = 0 and m = 0 then 'PASS' else 'FAIL customers=' || n || ' appraisals=' || m end;
  return next;

  test := 'a new customer and a new appraisal get the next number';
  begin
    select max(customer_no) into nc from customers;
    select max(appraisal_no) into na from appraisal_items;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    insert into customers (full_name, address, contact_number, id_type, id_number, date_of_birth)
    values ('SELFTEST Number', 'SELFTEST', '09990000000', 'Postal ID', 'SELFTEST0034', '1990-01-01') returning id into c;
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    insert into appraisal_items (weight_grams, karat, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max, appraised_by, category, status)
    values (5, 18, 2662.5, 70, 13312.5, 8386.88, 9318.75, appr_id, 'ring', 'available') returning id into a;
    execute 'reset role';
    select customer_no into n from customers where id = c;
    select appraisal_no into m from appraisal_items where id = a;
    outcome := case when n > nc and m > na then 'PASS (C-' || n || ', A-' || m || ')' else 'FAIL ' || n || '/' || m end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'staff can read the customer number (column grant), and nobody can change a number';
  begin
    select id into c from customers where archived_at is null limit 1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    select customer_no into n from customers where id = c;
    begin
      update customers set customer_no = customer_no + 100000 where id = c;
      outcome := 'FAIL changed';
    exception when others then
      outcome := case when n is not null and sqlerrm like '%cannot be changed%' then 'PASS (read C-' || n || ', change refused)' else 'FAIL ' || sqlerrm end;
    end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0034() from public, anon, authenticated;
