-- 0080: the self-test of 0078 compared against the word true, but Postgres prints a boolean as t when it is put in a
-- message. The checks themselves were right (every value came back as expected); only the expected text was wrong.
-- 0079 in the repo is already corrected; this patches the copy that was applied first. Safe to run twice.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.ctm_selftest_0078'::regproc);
  d := replace(d, '''R:true true true 2''', '''R:t t t 2''');
  d := replace(d, '''R:true true true 0''', '''R:t t t 0''');
  d := replace(d, '''R:true true true''', '''R:t t t''');
  d := replace(d, '''R:true true 1 1''', '''R:t t 1 1''');
  d := replace(d, '''R:true 1 true''', '''R:t 1 t''');
  execute d;
end $$;
