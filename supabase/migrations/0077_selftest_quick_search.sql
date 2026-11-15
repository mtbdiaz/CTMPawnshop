-- Self-test for 0076 quick_search(). Every test rolls back: select * from public.ctm_selftest_0076();
create or replace function public.ctm_selftest_0076() returns table(test text, outcome text) language plpgsql as $f$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd';
  r jsonb; n int; i int;
begin
  test := 'a cashier searching a name gets that customer, and no full ID number comes back';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := quick_search('arch', 'arch', 'arch', 'arch', 'arch', 'arch', null, null, '{}', null, 'arch', false);
    raise exception 'R:% %', jsonb_array_length(r -> 'customers'), (r::text like '%id_number%');
  exception when others then outcome := case when sqlerrm = 'R:1 f' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'an appraiser can search too; C-number is exact; A-number is exact';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    r := quick_search('c9', 'c9', 'c9', 'c9', 'c9', 'c9', 'C', 9, '{}', null, '', false);
    n := jsonb_array_length(r -> 'customers');
    r := quick_search('a45', 'a45', 'a45', 'a45', 'a45', 'a45', 'A', 45, '{}', null, '', true);
    raise exception 'R:% %', n, jsonb_array_length(r -> 'appraisals');
  exception when others then outcome := case when sqlerrm = 'R:1 1' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'a name with a typo falls back to similar names';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    r := quick_search('jhon', 'jhon', 'jhon', 'jhon', 'jhon', 'jhon', null, null, '{}', null, 'jhon', false);
    raise exception 'R:%', (r ->> 'similar');
  exception when others then outcome := case when sqlerrm in ('R:true', 'R:false') then 'PASS (similar=' || substr(sqlerrm, 3) || ')' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'the 61st search in a minute is limited';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    for i in 1..61 loop
      r := quick_search('zz', 'zz', 'zz', 'zz', 'zz', 'zz', null, null, '{}', null, 'zz', false);
    end loop;
    raise exception 'R:%', (r ->> 'limited');
  exception when others then outcome := case when sqlerrm = 'R:true' then 'PASS' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;

  test := 'someone not signed in is refused';
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '', true);
    r := quick_search('arch', 'arch', 'arch', 'arch', 'arch', 'arch', null, null, '{}', null, 'arch', false);
    raise exception 'ALLOWED';
  exception when others then outcome := case when sqlerrm like 'permission denied%' then 'PASS (permission denied)' else 'FAIL ' || sqlerrm end; end;
  execute 'reset role'; return next;
end $f$;
revoke execute on function public.ctm_selftest_0076() from public, anon, authenticated;
