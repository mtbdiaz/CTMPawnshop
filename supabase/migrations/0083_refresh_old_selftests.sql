-- 0083 (Nov 15, 2026, Matt + Claude): bring four old self-tests up to date with rules that were tightened after they were written.
-- None of this changes a rule. The tests asked questions the system no longer answers the old way:
--   - "cashier cannot read the audit trail" and "admin edit writes before/after audit": the audit trail can no longer be read
--     with a direct table select by anyone (it is read through functions), so the first test now accepts "permission denied"
--     and the second reads the table as the database owner after the Admin's edit.
--   - the lifecycle test and review test #24 saved an appraisal without a customer; an appraisal now needs one.
-- The lifecycle test is the end-to-end check of a loan (create, pay, capitalize, default, reinstate), so it matters for the
-- 2% liquidated damages. Safe to run twice (a test already updated is left as it is).
do $fix$
declare d text; n text;
begin
  -- 1. base test: the audit trail refuses a direct read
  d := pg_get_functiondef('public.ctm_selftest'::regproc);
  n := replace(d, $q$when sqlerrm = 'ROWS:0' then 'PASS (0 visible)' else$q$, $q$when sqlerrm = 'ROWS:0' then 'PASS (0 visible)' when sqlerrm like 'permission denied%' then 'PASS (permission denied)' else$q$);
  n := replace(n, $q$perform admin_edit_customer(a_cust, 'Selftest Name', 'UMID', 'ST-1', null, null, 'selftest');
    select count(*) into n from audit_log$q$, $q$perform admin_edit_customer(a_cust, 'Selftest Name', 'UMID', 'ST-1', null, null, 'selftest');
    execute 'reset role';
    select count(*) into n from audit_log$q$);
  if n <> d then execute n; end if;
  -- 2. lifecycle test: the appraisal belongs to the customer
  d := pg_get_functiondef('public.ctm_selftest_lifecycle'::regproc);
  n := replace(d, $q$insert into appraisal_items (weight_grams, karat, category,$q$, $q$insert into appraisal_items (customer_id, weight_grams, karat, category,$q$);
  n := replace(n, $q$values (10, 18, 'ring',$q$, $q$values (v_cust, 10, 18, 'ring',$q$);
  if n <> d then execute n; end if;
  -- 3. review test #24: same
  d := pg_get_functiondef('public.ctm_selftest_review'::regproc);
  n := replace(d, $q$insert into appraisal_items (weight_grams, karat, gold_price_used,$q$, $q$insert into appraisal_items (customer_id, weight_grams, karat, gold_price_used,$q$);
  n := replace(n, $q$values (5, 18, 2662.5,$q$, $q$values ((select id from customers where archived_at is null order by created_at limit 1), 5, 18, 2662.5,$q$);
  if n <> d then execute n; end if;
end $fix$;
