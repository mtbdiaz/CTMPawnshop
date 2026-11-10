-- 0042 (Nov 11, 2026, Wush): customer names in parts: first, middle, last, suffix.
-- Why: Matt / Wush (Nov 11): every customer form asks for First name, Middle name and Last name separately.
--      The SAD's Customer class already has firstName and lastName. Owner decisions: separate columns; First and
--      Last required, Middle optional, optional Suffix (Jr., Sr., II, III, IV, V); staff accounts keep one name.
-- How it works:
--   - new columns first_name, middle_name, last_name, suffix
--   - full_name stays and is FILLED IN BY THE DATABASE from the parts ("Juan B. Dela Cruz Jr."), so search, lists,
--     receipts, the AML check and every report keep working unchanged
--   - an old-style insert or Admin correction that only sends full_name still works: the parts are split from it
--   - the parts are locked after registration like the name already was (only admin_edit_customer can change them)
-- Existing data: the 437 customers get their parts split from full_name. full_name itself does NOT change for any
--   of them (checked: rebuilt name = old name). 3 names can't be split into first + last ("Matthew", and the
--   archived "TEST" and "Ena"); they keep only a first name until an Admin corrects them.
--   The split is not written to the audit trail and does not change updated_at (it is a data-format change, not
--   a staff action); this file is the record.
-- Self-test: select * from public.ctm_selftest_0042();   (every test rolls back)

-- 1. the columns (55 + 55 characters keep the full name within its 120-character limit)
alter table public.customers
  add column first_name text check (first_name is null or char_length(first_name) between 1 and 55),
  add column middle_name text check (middle_name is null or char_length(middle_name) between 1 and 55),
  add column last_name text check (last_name is null or char_length(last_name) between 1 and 55),
  add column suffix text check (suffix is null or suffix in ('Jr.', 'Sr.', 'II', 'III', 'IV', 'V'));
-- staff can read the parts (the table is column-granted since 0027, so new columns need their own grant)
grant select (first_name, middle_name, last_name, suffix) on public.customers to authenticated;

-- 2. the two name rules. The app has the same rules (lib/validation/customer.ts joinName), so the screen and the
--    database always agree.
-- join: "Juan" + "Bautista" + "Dela Cruz" + "Jr." -> "Juan B. Dela Cruz Jr." (the middle name as its initial)
create function public.ctm_join_name(p_first text, p_middle text, p_last text, p_suffix text) returns text
language sql immutable set search_path = public as $$
  select concat_ws(' ',
    nullif(btrim(p_first), ''),
    case when nullif(btrim(p_middle), '') is null then null else upper(left(btrim(p_middle), 1)) || '.' end,
    nullif(btrim(p_last), ''),
    nullif(btrim(p_suffix), ''))
$$;
-- split: the reverse, for names saved as one text. "Ma. Teresa R. Cruz" -> Ma. Teresa / R. / Cruz;
-- "Juan Dela Cruz" -> Juan / - / Dela Cruz; "Pedro Reyes Jr." -> Pedro / - / Reyes / Jr.; "Matthew" -> Matthew only
create function public.ctm_split_name(p_full text, out first_name text, out middle_name text, out last_name text, out suffix text)
language plpgsql immutable set search_path = public as $$
declare s text := regexp_replace(btrim(coalesce(p_full, '')), '\s+', ' ', 'g'); m text[];
begin
  m := regexp_match(s, '^(.+) (Jr\.?|Sr\.?|II|III|IV|V)$'); -- a suffix at the end
  if m is not null then
    s := m[1];
    suffix := case m[2] when 'Jr' then 'Jr.' when 'Sr' then 'Sr.' else m[2] end;
  end if;
  m := regexp_match(s, '^(.+?) ([A-Za-z])\. (.+)$'); -- first name(s), a middle initial, last name
  if m is not null then
    first_name := m[1]; middle_name := upper(m[2]) || '.'; last_name := m[3];
    return;
  end if;
  m := regexp_match(s, '^(\S+) (.+)$'); -- no initial: the first word, then the rest as the last name
  if m is not null then
    first_name := m[1]; last_name := m[2];
    return;
  end if;
  first_name := nullif(s, ''); -- one word only
end $$;

-- 3. the trigger that keeps full_name and the parts in step (runs before the name lock, which then checks the result)
create function public.ctm_customer_name_parts() returns trigger
language plpgsql set search_path = public as $$
declare p record; parts_changed boolean;
begin
  -- tidy: no spaces at the ends, one space inside, empty = nothing
  new.first_name := nullif(regexp_replace(btrim(coalesce(new.first_name, '')), '\s+', ' ', 'g'), '');
  new.middle_name := nullif(regexp_replace(btrim(coalesce(new.middle_name, '')), '\s+', ' ', 'g'), '');
  new.last_name := nullif(regexp_replace(btrim(coalesce(new.last_name, '')), '\s+', ' ', 'g'), '');
  new.suffix := nullif(btrim(coalesce(new.suffix, '')), '');
  if tg_op = 'INSERT' then
    parts_changed := new.first_name is not null or new.last_name is not null;
  else
    parts_changed := (new.first_name, new.middle_name, new.last_name, new.suffix) is distinct from (old.first_name, old.middle_name, old.last_name, old.suffix);
  end if;
  if not parts_changed and (tg_op = 'INSERT' or new.full_name is distinct from old.full_name) then
    -- an old-style save with only full_name: split it into the parts
    select * into p from public.ctm_split_name(new.full_name);
    new.first_name := p.first_name; new.middle_name := p.middle_name; new.last_name := p.last_name; new.suffix := p.suffix;
    parts_changed := true;
  end if;
  if parts_changed then
    -- a new or corrected name needs at least a first and a last name
    if new.first_name is null or new.last_name is null then
      raise exception 'Enter the first name and the last name.';
    end if;
    new.full_name := public.ctm_join_name(new.first_name, new.middle_name, new.last_name, new.suffix);
  end if;
  return new;
end $$;
create trigger customers_build_name before insert or update on public.customers
  for each row execute function public.ctm_customer_name_parts();

-- 4. the parts are locked after registration like the full name (same message as before)
create or replace function public.guard_customer_locked() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.ctm_is_system() then return new; end if;
  if new.full_name is distinct from old.full_name or new.id_type is distinct from old.id_type or new.id_number is distinct from old.id_number
     or (new.first_name, new.middle_name, new.last_name, new.suffix) is distinct from (old.first_name, old.middle_name, old.last_name, old.suffix) then
    raise exception 'Name and ID are locked after registration. An Admin can correct them with Edit (Admin) and a reason.' using errcode = '42501';
  end if;
  if new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by or new.archive_reason is distinct from old.archive_reason then
    raise exception 'Use Archive or Restore to change archive status.' using errcode = '42501';
  end if;
  return new;
end $$;

-- 5. the Admin correction takes the parts too (the old 8-input calls still work: they send only the full name)
drop function public.admin_edit_customer(uuid, text, text, text, text, text, text, timestamptz);
create function public.admin_edit_customer(p_id uuid, p_full_name text, p_id_type text, p_id_number text, p_contact_number text, p_address text, p_reason text,
  p_expected_updated_at timestamptz default null, p_first_name text default null, p_middle_name text default null, p_last_name text default null, p_suffix text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b public.customers; a public.customers; by_parts boolean := nullif(btrim(coalesce(p_first_name, '')), '') is not null;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for an Admin edit.'; end if;
  if (not by_parts and coalesce(trim(p_full_name), '') = '') or coalesce(trim(p_id_type), '') = '' or coalesce(trim(p_id_number), '') = '' then
    raise exception 'Name, ID type and ID number are required.';
  end if;
  perform set_config('ctm.system', 'on', true);
  select * into b from public.customers where id = p_id for update;
  if not found then raise exception 'Customer not found'; end if;
  if p_expected_updated_at is not null and b.updated_at is distinct from p_expected_updated_at then
    raise exception 'Someone changed this customer after you opened the page. Reload the page, check the details, then correct again.';
  end if;
  if by_parts then
    -- the parts given: the trigger builds full_name from them
    update public.customers set first_name = p_first_name, middle_name = p_middle_name, last_name = p_last_name, suffix = p_suffix,
      id_type = trim(p_id_type), id_number = trim(p_id_number),
      contact_number = coalesce(nullif(trim(p_contact_number), ''), contact_number), address = coalesce(nullif(trim(p_address), ''), address)
    where id = p_id returning * into a;
  else
    -- old-style call with one full name: the trigger splits it into the parts
    update public.customers set full_name = trim(p_full_name), id_type = trim(p_id_type), id_number = trim(p_id_number),
      contact_number = coalesce(nullif(trim(p_contact_number), ''), contact_number), address = coalesce(nullif(trim(p_address), ''), address)
    where id = p_id returning * into a;
  end if;
  perform public.ctm_log_admin_edit('customers', p_id, trim(p_reason), to_jsonb(b), to_jsonb(a));
  perform set_config('ctm.system', 'off', true);
end $$;
revoke execute on function public.admin_edit_customer(uuid, text, text, text, text, text, text, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.admin_edit_customer(uuid, text, text, text, text, text, text, timestamptz, text, text, text, text) to authenticated;

-- 6. split the existing names. Only where putting the parts back together gives exactly the same full_name.
--    Audit and updated_at triggers are off for this one data change (see the top of this file).
alter table public.customers disable trigger customers_audit;
alter table public.customers disable trigger customers_set_updated_at;
alter table public.customers disable trigger customers_build_name;
do $$
begin
  perform set_config('ctm.system', 'on', true); -- past the name lock
  update public.customers c set first_name = p.first_name, middle_name = p.middle_name, last_name = p.last_name, suffix = p.suffix
  from public.customers x cross join lateral public.ctm_split_name(x.full_name) p
  where x.id = c.id and public.ctm_join_name(p.first_name, p.middle_name, p.last_name, p.suffix) = c.full_name;
  -- one-word names ("Matthew"): keep the first name so the form shows it; the last name stays empty
  update public.customers c set first_name = btrim(c.full_name)
  where c.first_name is null and btrim(c.full_name) !~ ' ';
  perform set_config('ctm.system', 'off', true);
end $$;
alter table public.customers enable trigger customers_build_name;
alter table public.customers enable trigger customers_set_updated_at;
alter table public.customers enable trigger customers_audit;

-- Self-test (owner only). Pretends to be real staff accounts; everything rolls back.
-- Note: the insert tests use up customer numbers (C-numbers), because numbers are not given back on a rollback.
create or replace function public.ctm_selftest_0042() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  admin_id uuid; c uuid; n int; s text; f1 text; f2 text; f3 text; idt text; idn text;
begin
  select x.id into admin_id from profiles x where x.role = 'admin' and x.is_active order by x.created_at limit 1;
  select x.id, x.id_type, x.id_number into c, idt, idn from customers x where x.archived_at is null and x.last_name is not null order by x.customer_no limit 1;
  -- (read here, as the owner: staff logins can't read id_number since 0027)

  test := 'every customer''s full name is unchanged and equals its parts put back together (except one-word names)';
  begin
    select count(*) into n from customers x where x.last_name is null or ctm_join_name(x.first_name, x.middle_name, x.last_name, x.suffix) is distinct from x.full_name;
    select string_agg(x.full_name, ', ') into s from customers x where x.last_name is null;
    outcome := case when n = (select count(*) from customers x where btrim(x.full_name) !~ ' ') then 'PASS (one-word: ' || coalesce(s, 'none') || ')' else 'FAIL ' || n || ' mismatched' end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  return next;

  test := 'the split and join rules: initials, two-word first names, Dela last names, suffixes';
  begin
    select string_agg(concat_ws('/', p.first_name, p.middle_name, p.last_name, p.suffix), ' | ' order by o) into s
    from (values (1, 'Ma. Teresa R. Cruz'), (2, 'Juan Dela Cruz'), (3, 'Pedro B. Reyes Jr.'), (4, 'Cynthia C. Delos Santos'), (5, 'Matthew')) v(o, f)
    cross join lateral ctm_split_name(v.f) p;
    outcome := case when s = 'Ma. Teresa/R./Cruz | Juan/Dela Cruz | Pedro/B./Reyes/Jr. | Cynthia/C./Delos Santos | Matthew'
                     and ctm_join_name('Juan', 'Bautista', 'Dela Cruz', 'Jr.') = 'Juan B. Dela Cruz Jr.'
                    then 'PASS' else 'FAIL ' || s end;
  exception when others then outcome := 'FAIL ' || sqlerrm; end;
  return next;

  test := 'a Cashier registers with the parts: full name is built; without a last name it is refused; old-style full_name still works';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    insert into customers (first_name, middle_name, last_name, suffix, full_name, address, contact_number, id_type, id_number, aml_status, created_by)
    values ('  Selftest ', 'Bautista', 'Dela  Cruz', 'Jr.', 'ignored', 'SELFTEST', '09990000421', 'Postal ID', 'SELFTEST-0042-A', 'clear', cash_id)
    returning full_name into s; -- only columns staff may read (not id_number)
    begin
      insert into customers (first_name, full_name, address, contact_number, id_type, id_number, aml_status, created_by)
      values ('Selftest', 'x', 'SELFTEST', '09990000422', 'Postal ID', 'SELFTEST-0042-B', 'clear', cash_id);
      s := s || '/no last saved';
    exception when others then s := s || case when sqlerrm like 'Enter the first name and the last name%' then '/no last refused' else '/' || sqlerrm end; end;
    insert into customers (full_name, address, contact_number, id_type, id_number, aml_status, created_by)
    values ('Selftest R. Oldstyle', 'SELFTEST', '09990000423', 'Postal ID', 'SELFTEST-0042-C', 'clear', cash_id)
    returning first_name, middle_name, last_name into f1, f2, f3;
    s := s || '/' || concat_ws(',', f1, f2, f3);
    execute 'reset role';
    outcome := case when s = 'Selftest B. Dela Cruz Jr./no last refused/Selftest,R.,Oldstyle' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'an Operator cannot change the name parts; an Admin correction with parts rebuilds the full name';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin update customers set middle_name = 'Zzz' where id = c; s := 'operator saved';
    exception when others then s := case when sqlerrm like 'Name and ID are locked%' then 'operator refused' else sqlerrm end; end;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform admin_edit_customer(c, '', idt, idn, '', '', 'SELFTEST correction',
      null, 'Selftest', 'Quinto', 'Admincheck', null);
    execute 'reset role';
    s := s || '/' || (select full_name from customers where id = c);
    outcome := case when s = 'operator refused/Selftest Q. Admincheck' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  perform set_config('ctm.system', 'off', true);
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0042() from public, anon, authenticated;
