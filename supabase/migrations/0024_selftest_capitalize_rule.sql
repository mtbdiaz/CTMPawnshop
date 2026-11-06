-- #30: capitalize now starts the new term where the capitalized interest ends.
-- In the lifecycle self-test the loan is 40 days past due: 2 terms are charged
-- (paid up to today + 20), so the new due date is today + 50 (was today + 30).
do $$
declare f text;
begin
  f := pg_get_functiondef('public.ctm_selftest_lifecycle()'::regprocedure);
  f := replace(f, 'l.interest_owed, l.maturity_date = ctm_today() + 30, n);', 'l.interest_owed, l.maturity_date = ctm_today() + 50, n);');
  execute f;
end $$;
