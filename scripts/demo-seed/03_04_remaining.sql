-- Demo seed, part 3: everything around the loans (pool items, auction batches, vault audits,
-- flags, reminders, operating costs, capital) and the dry-run report. Staging only; no real tables are touched.

create table if not exists demo_seed.s_batch (n int primary key, id uuid, at timestamptz, notes text, created_by uuid);
create table if not exists demo_seed.s_batch_item (batch_n int, loan_n int, primary key (batch_n, loan_n));
create table if not exists demo_seed.s_cashx (seq serial primary key, at timestamptz, typ text, dir text, amount numeric(12,2), descr text, loan_n int, actor uuid);
create table if not exists demo_seed.s_audit (n int primary key, id uuid, at timestamptz, performed_by uuid, notes text, disc int default 0);
create table if not exists demo_seed.s_audit_item (audit_n int, loan_n int, found boolean, expected text, note text);
create table if not exists demo_seed.s_flag (n int primary key, id uuid, cust_n int, loan_n int, reason text, status text, created_at timestamptz, resolved_by uuid, resolved_at timestamptz);
create table if not exists demo_seed.s_rem (seq serial primary key, loan_n int, sent_at timestamptz, actor uuid);

create or replace function demo_seed.mk_pool_item(p_n int, p_ts timestamptz, p_flag text) returns void language plpgsql as $$
declare cat text; kt int; wt numeric; lo numeric; hi numeric; price numeric; v numeric; mx numeric; d date := (p_ts at time zone 'Asia/Manila')::date;
begin
  cat := demo_seed.wpk(array['ring','chain','earrings','bracelet','pendant','pendant_with_chain','others'], array[28,22,14,12,10,9,5]);
  kt := demo_seed.wpk(array['18','21','24'], array[55,30,15])::int;
  select l, h into lo, hi from (values ('ring',1.2,9.0),('chain',3.0,38.0),('earrings',0.8,6.0),('bracelet',4.0,26.0),('pendant',0.8,9.0),('pendant_with_chain',5.0,30.0),('others',1.5,16.0)) t(c, l, h) where c = cat;
  wt := round(lo + (hi - lo) * power(demo_seed.r()::numeric, 2.3), 3);
  price := round(demo_seed.gold24(d) * kt / 24, 2);
  v := round(wt * price, 2); mx := round(v * 0.70, 2);
  insert into demo_seed.s_appr (n, id, customer_n, weight, karat, notes, gold_price, ltv, value, minl, maxl, counterfeit, resolution, resolved_by, resolved_at, appraised_by, created_at, updated_at, category, category_other, status)
  values (p_n, demo_seed.u(5, p_n), null, wt, kt,
    case p_flag when 'pending' then 'Magnet and acid test inconclusive; plating suspected' when 'confirmed' then 'Failed acid test; base metal under gold plating' end,
    price, 70, v, round(mx * 0.9, 2), mx, p_flag is not null,
    case p_flag when 'pending' then 'pending' when 'confirmed' then 'confirmed' end,
    case p_flag when 'confirmed' then demo_seed.u(1, 1) end, case p_flag when 'confirmed' then p_ts + interval '1 day 2 hours' end,
    demo_seed.u(1, 6 + demo_seed.ri(0, 1)), p_ts, p_ts, cat,
    case when cat = 'others' then demo_seed.pk(array['Anklet','Rosary','Baby bangle','Brooch','Gold coin']) end, 'available');
end $$;

create or replace function demo_seed.cx(d date, typ text, dir text, amt numeric, descr text) returns void language plpgsql as $$
declare ts timestamptz;
begin
  if d > date '2026-10-27' then return; end if;
  ts := demo_seed.mkts(d, demo_seed.ri(560, 960));
  if ts > timestamptz '2026-10-27 15:30:00+08' then return; end if;
  insert into demo_seed.s_cashx (at, typ, dir, amount, descr, actor) values (ts, typ, dir, amt, descr, demo_seed.u(1, 2));
end $$;

create or replace function demo_seed.gen_misc1() returns jsonb language plpgsql as $$
#variable_conflict use_column
declare i int; d date; n_cust int; ts timestamptz; bl record;
begin
  perform set_config('demo.s', (select v from demo_seed.kv where k = 'rng'), false);
  select max(n) into n_cust from demo_seed.s_cust;
  for i in 1..2 loop
    ts := demo_seed.mkts(case i when 1 then date '2026-08-12' else date '2026-09-20' end, 670);
    perform demo_seed.mk_customer(n_cust + i, ts, 'onetimer');
    update demo_seed.s_cust set archived_at = ts + interval '1 day 1 hour', archived_by = demo_seed.u(1, 1),
      archive_reason = 'Duplicate registration; customer already on file' where n = n_cust + i;
  end loop;
  update demo_seed.s_cust set aml_status = 'flagged', aml_checked_at = created_at,
    aml_notes = 'Name closely matches an entry on the internal watch list; ID re-verified by Admin, cleared for transactions'
  where n in (select n from demo_seed.s_cust where archived_at is null order by md5(n::text || 'aml') limit 4);
  for bl in
    select c.n, (max(l.defaulted_at) + interval '3 days') as bl_at
    from demo_seed.s_cust c join demo_seed.s_loan l on l.cust_n = c.n
    where l.defaulted_at is not null and l.defaulted_at < timestamptz '2026-10-10'
    group by c.n
    having not exists (select 1 from demo_seed.s_loan x where x.cust_n = c.n and x.created_at > max(l.defaulted_at) + interval '3 days')
    order by md5(c.n::text || 'bl') limit 3
  loop
    update demo_seed.s_cust set is_blacklisted = true, bl_at = bl.bl_at,
      blacklist_reason = demo_seed.pk(array['Defaulted on pawned item and could not be reached', 'Presented a fake ID at redemption', 'Repeated defaults; account closed by management'])
    where n = bl.n;
  end loop;
  update demo_seed.s_appr a set counterfeit = true, resolution = 'cleared', resolved_by = demo_seed.u(1, 1),
    created_at = a.pawned_at - interval '2 days 3 hours', resolved_at = a.pawned_at - interval '1 day 20 hours',
    notes = coalesce(a.notes || '. ', '') || 'Flagged for purity check; Admin cleared after XRF test'
  where a.n in (select n from demo_seed.s_appr where pawned_at >= timestamptz '2026-08-05' order by md5(n::text || 'cf') limit 2);
  for i in 1..49 loop
    d := demo_seed.nopen(date '2026-09-28' + demo_seed.ri(0, 29));
    ts := demo_seed.mkts(d, demo_seed.ri(560, 960));
    if ts > timestamptz '2026-10-27 15:30:00+08' then ts := timestamptz '2026-10-27 11:00:00+08' - make_interval(mins => i); end if;
    perform demo_seed.mk_pool_item(5000 + i, ts, case when i <= 2 then 'pending' when i <= 4 then 'confirmed' end);
  end loop;
  update demo_seed.s_appr set archived_at = created_at + interval '30 minutes', archived_by = appraised_by, archive_reason = 'Appraised twice by mistake'
  where n in (5010, 5020);
  insert into demo_seed.kv (k, v) values ('rng', current_setting('demo.s')) on conflict (k) do update set v = excluded.v;
  return jsonb_build_object('blacklisted', (select count(*) from demo_seed.s_cust where is_blacklisted), 'aml', (select count(*) from demo_seed.s_cust where aml_status = 'flagged'),
    'pool', (select count(*) from demo_seed.s_appr where status = 'available'), 'cleared_flags', (select count(*) from demo_seed.s_appr where resolution = 'cleared'));
end $$;

create or replace function demo_seed.gen_batches() returns jsonb language plpgsql as $$
#variable_conflict use_column
declare b int := 0; bd date; ts timestamptz; r record; sd date; amt numeric; cutoff timestamptz := timestamptz '2026-10-27 15:30:00+08';
begin
  perform set_config('demo.s', (select v from demo_seed.kv where k = 'rng'), false);
  foreach bd in array array['2026-08-29','2026-09-12','2026-09-26','2026-10-10','2026-10-17','2026-10-24']::date[] loop
    b := b + 1;
    ts := demo_seed.mkts(bd, 600 + demo_seed.ri(0, 40));
    insert into demo_seed.s_batch (n, id, at, notes, created_by) values (b, demo_seed.u(6, b), ts, 'Auction prep batch of ' || to_char(bd, 'FMMon DD'), demo_seed.u(1, 2));
    insert into demo_seed.s_batch_item (batch_n, loan_n)
    select b, l.n from demo_seed.s_loan l
    where l.status = 'forfeited' and l.forfeited_at <= ts - interval '1 day' and not exists (select 1 from demo_seed.s_batch_item i where i.loan_n = l.n)
    order by l.forfeited_at limit 30;
    insert into demo_seed.s_ev (loan_n, at, kind, actor, bal, owed, through, maturity, ext, status, late, inv_new)
    select l.n, ts + interval '1 minute', 'queue', demo_seed.u(1, 2), l.balance, l.owed, l.through, l.maturity, l.ext, l.status, l.late, 'queued_for_auction'
    from demo_seed.s_loan l join demo_seed.s_batch_item i on i.loan_n = l.n and i.batch_n = b;
    update demo_seed.s_loan set inv_status = 'queued_for_auction' where n in (select loan_n from demo_seed.s_batch_item where batch_n = b);
  end loop;
  for r in select i.loan_n, bt.at as bat, l.ticket, a.value from demo_seed.s_batch_item i join demo_seed.s_batch bt on bt.n = i.batch_n
           join demo_seed.s_loan l on l.n = i.loan_n join demo_seed.s_appr a on a.n = l.appr_n order by bt.n, i.loan_n loop
    if r.bat <= cutoff - interval '6 days' and demo_seed.ch(0.65) then
      sd := demo_seed.nopen((r.bat at time zone 'Asia/Manila')::date + demo_seed.ri(5, 14));
      ts := demo_seed.mkts(sd, demo_seed.ri(600, 900));
      if ts <= cutoff then
        amt := round(r.value * (0.8 + 0.2 * demo_seed.r()), 2);
        insert into demo_seed.s_cashx (at, typ, dir, amount, descr, loan_n, actor)
        values (ts, 'revenue', 'in', amt, 'Auction sale of forfeited item for ' || r.ticket, r.loan_n, demo_seed.u(1, 2));
      end if;
    end if;
  end loop;
  insert into demo_seed.kv (k, v) values ('rng', current_setting('demo.s')) on conflict (k) do update set v = excluded.v;
  return jsonb_build_object('batches', b, 'items', (select count(*) from demo_seed.s_batch_item), 'sales', (select count(*) from demo_seed.s_cashx where descr like 'Auction sale%'));
end $$;

create or replace function demo_seed.gen_audits() returns jsonb language plpgsql as $$
#variable_conflict use_column
declare a int := 0; sp record; tt timestamptz;
begin
  for sp in select * from (values
      (date '2026-07-31', 'Monthly vault count', 0, null::text[]),
      (date '2026-08-29', 'Monthly vault count', 0, null::text[]),
      (date '2026-09-12', 'Spot check: Vault B and Safe 1', 1, array['Vault B', 'Safe 1']),
      (date '2026-09-30', 'Monthly vault count', 2, null::text[]),
      (date '2026-10-15', 'Spot check: Safe 1 after auction prep', 1, array['Safe 1'])) v(d, nt, disc, vaults) loop
    a := a + 1;
    tt := demo_seed.mkts(sp.d, 1000);
    insert into demo_seed.s_audit (n, id, at, performed_by, notes, disc) values (a, demo_seed.u(15, a), tt, demo_seed.u(1, 2), sp.nt, sp.disc);
    insert into demo_seed.s_audit_item (audit_n, loan_n, found, expected, note)
    select a, x.n, true, x.st, null from (
      select l.n, l.vault, (select e.inv_new from demo_seed.s_ev e where e.loan_n = l.n and e.inv_new is not null and e.at <= tt order by e.at desc, e.seq desc limit 1) as st
      from demo_seed.s_loan l where l.created_at <= tt) x
    where x.st in ('pawned', 'extended') and (sp.vaults is null or x.vault = any (sp.vaults));
    update demo_seed.s_audit_item set found = false, note = 'Not found at the expected shelf; located in the wrong vault and re-shelved the next morning'
    where audit_n = a and loan_n in (select loan_n from demo_seed.s_audit_item where audit_n = a order by md5(loan_n::text || 'a' || a::text) limit sp.disc);
  end loop;
  return jsonb_build_object('audits', a, 'items', (select count(*) from demo_seed.s_audit_item), 'missing', (select count(*) from demo_seed.s_audit_item where not found));
end $$;

create or replace function demo_seed.gen_flags_rem() returns jsonb language plpgsql as $$
#variable_conflict use_column
declare r record; d date; ts timestamptz; cutoff timestamptz := timestamptz '2026-10-27 15:30:00+08';
begin
  perform set_config('demo.s', (select v from demo_seed.kv where k = 'rng'), false);
  with cand as (
    (select l.n as loan_n, l.cust_n, 'Unusually high number of loans opened by this customer in a short window'::text as reason, l.created_at + interval '6 minutes' as ts
       from demo_seed.s_loan l where l.tier in ('vip', 'regular') and not l.voided order by md5(l.n::text || 'v') limit 6)
    union all
    (select l.n, l.cust_n, 'High-value loan (PHP ' || to_char(l.principal, 'FM999,999') || ') for a customer with little history', l.created_at + interval '6 minutes'
       from demo_seed.s_loan l join demo_seed.s_cust c on c.n = l.cust_n where l.principal >= 30000 and c.nloans <= 2 order by md5(l.n::text || 'h') limit 4)
    union all
    (select l.n, l.cust_n, 'Lost ticket used at redemption; ID checked against records', l.redeemed_at
       from demo_seed.s_loan l where l.lost and l.redeemed_at is not null order by md5(l.n::text || 't') limit 4)
    union all
    (select l.n, l.cust_n, 'Repeated defaults; recommend blacklisting', l.defaulted_at + interval '2 days'
       from demo_seed.s_loan l join demo_seed.s_cust c on c.n = l.cust_n where c.is_blacklisted and l.defaulted_at is not null order by l.defaulted_at desc limit 3)
  ), numbered as (
    select row_number() over (order by c.ts) as n, c.*, row_number() over (partition by (c.reason like 'Repeated defaults%') order by c.ts desc) as rk from cand c
  )
  insert into demo_seed.s_flag (n, id, cust_n, loan_n, reason, status, created_at, resolved_by, resolved_at)
  select z.n::int, demo_seed.u(7, z.n::int), z.cust_n, z.loan_n, z.reason, z.st, z.ts,
    case when z.st in ('dismissed', 'blacklisted') then demo_seed.u(1, 1) end,
    case when z.st in ('dismissed', 'blacklisted') then least(z.ts + interval '3 days', timestamptz '2026-10-26 12:00:00+08') end
  from (select numbered.*, case when numbered.reason like 'Repeated defaults%' then 'blacklisted' when numbered.rk <= 6 then 'open' when numbered.rk <= 9 then 'investigating' else 'dismissed' end as st from numbered) z;
  for r in select l.n, l.created_at, l.redeemed_at, l.defaulted_at, x.m
           from demo_seed.s_loan l cross join lateral (select e.prev_maturity as m from demo_seed.s_ev e where e.loan_n = l.n and e.prev_maturity is not null union select l.maturity) x
           where not l.voided loop
    if r.m <= date '2026-10-30' and demo_seed.ch(0.22) then
      d := demo_seed.nopen(r.m - demo_seed.ri(1, 3));
      ts := demo_seed.mkts(d, demo_seed.ri(560, 650));
      if ts > r.created_at and ts <= cutoff and (r.redeemed_at is null or ts < r.redeemed_at) and (r.defaulted_at is null or ts < r.defaulted_at) then
        insert into demo_seed.s_rem (loan_n, sent_at, actor) values (r.n, ts, demo_seed.u(1, 3 + demo_seed.ri(0, 2)));
      end if;
    end if;
  end loop;
  insert into demo_seed.kv (k, v) values ('rng', current_setting('demo.s')) on conflict (k) do update set v = excluded.v;
  return jsonb_build_object('flags', (select count(*) from demo_seed.s_flag), 'reminders', (select count(*) from demo_seed.s_rem));
end $$;

create or replace function demo_seed.gen_opex_capital() returns jsonb language plpgsql as $$
#variable_conflict use_column
declare m date; d date; bal numeric := 0; r record; amt numeric; n_cap int := 0;
begin
  perform set_config('demo.s', (select v from demo_seed.kv where k = 'rng'), false);
  foreach m in array array['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']::date[] loop
    perform demo_seed.cx(demo_seed.nopen(m), 'expense', 'out', 12000, 'Shop rent for ' || to_char(m, 'FMMonth YYYY'));
    perform demo_seed.cx(demo_seed.nopen(m), 'expense', 'out', 6500, 'Security guard service');
    perform demo_seed.cx(demo_seed.nopen(m + 2), 'expense', 'out', 1499, 'Internet and phone');
    perform demo_seed.cx(demo_seed.nopen(m + 7), 'expense', 'out', 600 + demo_seed.ri(0, 120), 'Water bill');
    perform demo_seed.cx(demo_seed.nopen(m + 19), 'expense', 'out', 3800 + demo_seed.ri(-500, 900), 'Electricity bill');
    perform demo_seed.cx(demo_seed.nopen(m + 14), 'expense', 'out', 50000 + demo_seed.ri(-2000, 3000), 'Staff payroll, first half of ' || to_char(m, 'FMMonth'));
    perform demo_seed.cx(demo_seed.nopen((m + interval '1 month')::date - 1), 'expense', 'out', 50000 + demo_seed.ri(-2000, 3000), 'Staff payroll, second half of ' || to_char(m, 'FMMonth'));
  end loop;
  d := date '2026-07-04';
  while d <= date '2026-10-27' loop
    perform demo_seed.cx(demo_seed.nopen(d), 'expense', 'out', 700 + demo_seed.ri(0, 700), 'Receipt paper, pawn ticket stock and cleaning supplies');
    perform demo_seed.cx(demo_seed.nopen(d), 'revenue', 'in', 400 + demo_seed.ri(0, 800), 'Jewelry cleaning and polishing fees');
    d := d + 7;
  end loop;
  perform demo_seed.cx(date '2026-08-05', 'expense', 'out', 2200, 'Acid test kit refill');
  perform demo_seed.cx(date '2026-10-08', 'expense', 'out', 2200, 'Acid test kit refill');
  perform demo_seed.cx(date '2026-09-02', 'expense', 'out', 3500, 'Vault door lock service');
  perform demo_seed.cx(demo_seed.nopen(date '2026-09-16'), 'expense', 'out', 8500, 'Roof repair after typhoon');
  -- owner capital top-ups keep the cash on hand from going below PHP 100,000
  for r in select q.at, q.dir, q.amount from (
      select e.at, 'out'::text as dir, e.amount, e.seq * 2 as o from demo_seed.s_ev e where e.kind = 'create'
      union all select e.at, 'in', e.amount, e.seq * 2 from demo_seed.s_ev e where e.kind = 'pay'
      union all select e.at, 'in', e.amount, e.seq * 2 from demo_seed.s_ev e where e.kind = 'renew' and e.amount > 0
      union all select e.at, 'out', e.amount, e.seq * 2 from demo_seed.s_ev e where e.kind = 'pay_fix'
      union all select e.at, 'in', e.amount, e.seq * 2 from demo_seed.s_ev e where e.kind = 'void'
      union all select x.at, x.dir, x.amount, 0 from demo_seed.s_cashx x) q order by q.at, q.o loop
    if r.dir = 'out' and bal - r.amount < 100000 then
      amt := ceil((500000 - (bal - r.amount)) / 250000) * 250000;
      insert into demo_seed.s_cashx (at, typ, dir, amount, descr, actor) values (r.at - interval '1 second', 'revenue', 'in', amt, 'Owner capital top-up', demo_seed.u(1, 1));
      bal := bal + amt; n_cap := n_cap + 1;
    end if;
    bal := bal + case when r.dir = 'in' then r.amount else -r.amount end;
  end loop;
  insert into demo_seed.kv (k, v) values ('rng', current_setting('demo.s')) on conflict (k) do update set v = excluded.v;
  return jsonb_build_object('cash_extras', (select count(*) from demo_seed.s_cashx), 'capital_topups', n_cap, 'ending_balance', round(bal, 2));
end $$;

-- Dry run: what the real load would insert, per table.
create or replace function demo_seed.dry_run() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'profiles (staff)', 7,
    'customers', (select count(*) from demo_seed.s_cust),
    'appraisal_items', (select count(*) from demo_seed.s_appr),
    'inventory_items', (select count(*) from demo_seed.s_loan),
    'inventory_status_history', (select count(*) from (select e.inv_new, lag(e.inv_new) over (partition by e.loan_n order by e.at, e.seq) p from demo_seed.s_ev e where e.inv_new is not null) q where q.p is distinct from q.inv_new),
    'loans', (select count(*) from demo_seed.s_loan),
    'loan_payments', (select count(*) from demo_seed.s_ev where kind = 'pay' or (kind = 'renew' and amount > 0)),
    'loan_extensions', (select count(*) from demo_seed.s_ev where kind in ('renew', 'cap')),
    'cash_flow_entries', (select count(*) from demo_seed.s_ev where kind in ('create', 'cap', 'pay_fix', 'void') or kind = 'pay' or (kind = 'renew' and amount > 0)) + (select count(*) from demo_seed.s_cashx),
    'auction_batches', (select count(*) from demo_seed.s_batch),
    'auction_batch_items', (select count(*) from demo_seed.s_batch_item),
    'physical_inventory_audits', (select count(*) from demo_seed.s_audit),
    'physical_inventory_audit_items', (select count(*) from demo_seed.s_audit_item),
    'suspicious_activity_flags', (select count(*) from demo_seed.s_flag),
    'reminder_log', (select count(*) from demo_seed.s_rem)) $$;
-- Demo seed, part 4: load staged data into the real tables, write the audit log, verify, and unload.
-- Nothing here runs until you call it: select demo_seed.load_staff('<password>'); select demo_seed.load_core(); select demo_seed.load_audit();
-- All seeded rows have ids starting dede0000- (kept out of sight), so demo_seed.unload() can find them.

create or replace function demo_seed.load_staff(p_password text) returns jsonb language plpgsql set search_path = public, extensions, auth as $$
declare s record; n int := 0;
begin
  perform set_config('session_replication_role', 'replica', true);
  for s in select * from (values
      (1, 'Rowena Abella', 'admin', 'rowena.abella'), (2, 'Jerome Bacalso', 'operator', 'jerome.bacalso'), (3, 'Liza Mae Dacanay', 'cashier', 'liza.dacanay'),
      (4, 'Ronnie Tiempo', 'cashier', 'ronnie.tiempo'), (5, 'Grace Villamor', 'cashier', 'grace.villamor'),
      (6, 'Arnel Quizon', 'appraiser', 'arnel.quizon'), (7, 'Jocelyn Sumagaysay', 'appraiser', 'jocelyn.sumagaysay')) v(i, nm, rl, em) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', demo_seed.u(1, s.i), 'authenticated', 'authenticated', s.em || '@ctmpawnshop.test',
      crypt(p_password, gen_salt('bf')), timestamptz '2026-06-25 09:00+08', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      timestamptz '2026-06-25 09:00+08', timestamptz '2026-06-25 09:00+08', '', '', '', '', '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), demo_seed.u(1, s.i),
      jsonb_build_object('sub', demo_seed.u(1, s.i)::text, 'email', s.em || '@ctmpawnshop.test', 'email_verified', true, 'phone_verified', false),
      'email', demo_seed.u(1, s.i)::text, now(), timestamptz '2026-06-25 09:00+08', timestamptz '2026-06-25 09:00+08')
    on conflict do nothing;
    insert into public.profiles (id, full_name, role, is_active, created_at, updated_at)
    values (demo_seed.u(1, s.i), s.nm, s.rl::public.staff_role, true, timestamptz '2026-06-25 09:00+08', timestamptz '2026-06-25 09:00+08')
    on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
    n := n + 1;
  end loop;
  return jsonb_build_object('staff', n);
end $$;

create or replace function demo_seed.load_core() returns jsonb language plpgsql as $$
declare res jsonb := '{}'::jsonb; rc int;
begin
  perform set_config('session_replication_role', 'replica', true);
  if exists (select 1 from public.loans where id::text like 'dede0000-%') then raise exception 'Seeded rows already loaded; run demo_seed.unload() first.'; end if;

  insert into public.customers (id, full_name, address, contact_number, email, date_of_birth, id_type, id_number, aml_status, aml_checked_at, aml_notes,
    is_blacklisted, blacklist_reason, created_by, created_at, updated_at, archived_at, archived_by, archive_reason)
  select s.id, s.full_name, s.address, s.contact_number, s.email, s.date_of_birth, s.id_type, s.id_number, s.aml_status::public.aml_status, coalesce(s.aml_checked_at, s.created_at), s.aml_notes,
    coalesce(s.is_blacklisted, false), s.blacklist_reason, s.created_by, s.created_at, coalesce(s.bl_at, s.archived_at, s.created_at), s.archived_at, s.archived_by, s.archive_reason
  from demo_seed.s_cust s;
  get diagnostics rc = row_count; res := res || jsonb_build_object('customers', rc);

  insert into public.appraisal_items (id, customer_id, weight_grams, karat, condition_notes, photo_paths, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max,
    is_counterfeit_risk, counterfeit_resolution, counterfeit_resolved_by, counterfeit_resolved_at, appraised_by, created_at, updated_at, archived_at, archived_by, archive_reason, category, category_other, status)
  select a.id, c.id, a.weight, a.karat, a.notes, '{}'::text[], a.gold_price, a.ltv, a.value, a.minl, a.maxl,
    a.counterfeit, a.resolution::public.counterfeit_resolution, a.resolved_by, a.resolved_at, a.appraised_by, a.created_at, coalesce(a.pawned_at, a.created_at), a.archived_at, a.archived_by, a.archive_reason,
    a.category::public.item_category, a.category_other, a.status::public.appraisal_status
  from demo_seed.s_appr a left join demo_seed.s_cust c on c.n = a.customer_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('appraisal_items', rc);

  insert into public.inventory_items (id, appraisal_item_id, vault_location, status, created_at, updated_at, archived_at, archived_by, archive_reason)
  select l.inv_id, a.id, l.vault, l.inv_status::public.inventory_status, l.created_at,
    coalesce((select max(e.at) from demo_seed.s_ev e where e.loan_n = l.n and e.inv_new is not null), l.created_at), l.archived_at, l.archived_by, l.archive_reason
  from demo_seed.s_loan l join demo_seed.s_appr a on a.n = l.appr_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('inventory_items', rc);

  insert into public.loans (id, customer_id, appraisal_item_id, inventory_item_id, principal_amount, interest_rate_percent, principal_balance, loan_date, maturity_date, grace_period_days,
    extension_count, status, ticket_number, created_by, created_at, updated_at, lost_ticket_used, interest_owed, interest_accrued_through, defaulted_at, reinstated_at, redeemed_at, forfeited_at,
    late_payment_count, archived_at, archived_by, archive_reason)
  select l.id, c.id, a.id, l.inv_id, l.principal, l.rate, l.balance, l.loan_date, l.maturity, l.grace, l.ext, l.status::public.loan_status, l.ticket, l.created_by, l.created_at, l.updated_at,
    l.lost, l.owed, l.through, l.defaulted_at, l.reinstated_at, l.redeemed_at, l.forfeited_at, l.late, l.archived_at, l.archived_by, l.archive_reason
  from demo_seed.s_loan l join demo_seed.s_cust c on c.n = l.cust_n join demo_seed.s_appr a on a.n = l.appr_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('loans', rc);

  insert into public.loan_payments (id, loan_id, amount, principal_portion, interest_portion, receipt_number, created_by, created_at, verified_via_lost_ticket)
  select demo_seed.u(8, e.seq), l.id, coalesce((e.extra->>'final_amount')::numeric, e.amount), coalesce((e.extra->>'final_p')::numeric, e.ppart),
    coalesce((e.extra->>'final_i')::numeric, e.ipart), e.receipt, e.actor, e.at, coalesce(e.lost, false) and e.kind = 'pay'
  from demo_seed.s_ev e join demo_seed.s_loan l on l.n = e.loan_n where e.kind = 'pay' or (e.kind = 'renew' and e.amount > 0);
  get diagnostics rc = row_count; res := res || jsonb_build_object('loan_payments', rc);

  insert into public.loan_extensions (id, loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, created_by, created_at, extension_type, capitalized_amount)
  select demo_seed.u(9, e.seq), l.id, e.prev_maturity, e.maturity, (e.extra->>'new_interest')::numeric, e.actor, e.at,
    (case e.kind when 'renew' then 'renewal' else 'capitalized' end)::public.extension_type, case when e.kind = 'cap' then e.amount else 0 end
  from demo_seed.s_ev e join demo_seed.s_loan l on l.n = e.loan_n where e.kind in ('renew', 'cap');
  get diagnostics rc = row_count; res := res || jsonb_build_object('loan_extensions', rc);

  insert into public.inventory_status_history (id, inventory_item_id, old_status, new_status, changed_at)
  select demo_seed.u(10, q.seq), q.inv_id, q.p::public.inventory_status, q.inv_new::public.inventory_status, q.at
  from (select e.seq, e.at, e.inv_new, l.inv_id, lag(e.inv_new) over (partition by e.loan_n order by e.at, e.seq) as p
        from demo_seed.s_ev e join demo_seed.s_loan l on l.n = e.loan_n where e.inv_new is not null) q
  where q.p is distinct from q.inv_new;
  get diagnostics rc = row_count; res := res || jsonb_build_object('inventory_status_history', rc);

  insert into public.cash_flow_entries (id, entry_type, direction, amount, description, related_loan_id, created_by, created_at, is_memo)
  select demo_seed.u(11, e.seq),
    (case e.kind when 'create' then 'loan_disbursement' when 'pay' then 'payment_received' when 'renew' then 'payment_received' when 'cap' then 'capitalization' else 'adjustment' end)::public.cash_flow_type,
    (case when e.kind in ('create', 'pay_fix') then 'out' else 'in' end)::public.cash_flow_direction, e.amount,
    case e.kind when 'create' then 'Loan disbursed' when 'pay' then 'Payment ' || e.receipt || ' for ' || l.ticket
      when 'renew' then 'Renewal interest ' || e.receipt || ' for ' || l.ticket
      when 'cap' then 'Interest capitalized into principal (non-cash) for ' || l.ticket
      when 'pay_fix' then 'Admin correction to payment ' || e.receipt || ': ' || (e.extra->>'reason')
      else 'Void of ticket ' || l.ticket || ': disbursement reversed' end,
    l.id, e.actor, e.at, e.kind = 'cap'
  from demo_seed.s_ev e join demo_seed.s_loan l on l.n = e.loan_n
  where e.kind in ('create', 'pay', 'cap', 'pay_fix', 'void') or (e.kind = 'renew' and e.amount > 0);
  get diagnostics rc = row_count; res := res || jsonb_build_object('cash_from_loans', rc);

  insert into public.cash_flow_entries (id, entry_type, direction, amount, description, related_loan_id, created_by, created_at, is_memo)
  select demo_seed.u(12, x.seq), x.typ::public.cash_flow_type, x.dir::public.cash_flow_direction, x.amount, x.descr, l.id, x.actor, x.at, false
  from demo_seed.s_cashx x left join demo_seed.s_loan l on l.n = x.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('cash_other', rc);

  insert into public.auction_batches (id, created_by, notes, created_at) select b.id, b.created_by, b.notes, b.at from demo_seed.s_batch b;
  get diagnostics rc = row_count; res := res || jsonb_build_object('auction_batches', rc);
  insert into public.auction_batch_items (id, batch_id, inventory_item_id)
  select demo_seed.u(13, (row_number() over (order by i.batch_n, i.loan_n))::int), b.id, l.inv_id
  from demo_seed.s_batch_item i join demo_seed.s_batch b on b.n = i.batch_n join demo_seed.s_loan l on l.n = i.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('auction_batch_items', rc);

  insert into public.physical_inventory_audits (id, performed_by, notes, discrepancy_count, created_at) select a.id, a.performed_by, a.notes, a.disc, a.at from demo_seed.s_audit a;
  get diagnostics rc = row_count; res := res || jsonb_build_object('physical_inventory_audits', rc);
  insert into public.physical_inventory_audit_items (id, audit_id, inventory_item_id, expected_status, found, notes)
  select demo_seed.u(14, (row_number() over (order by i.audit_n, i.loan_n))::int), au.id, l.inv_id, i.expected::public.inventory_status, i.found, i.note
  from demo_seed.s_audit_item i join demo_seed.s_audit au on au.n = i.audit_n join demo_seed.s_loan l on l.n = i.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('physical_inventory_audit_items', rc);

  insert into public.suspicious_activity_flags (id, customer_id, loan_id, reason, status, resolved_by, resolved_at, created_at)
  select f.id, c.id, l.id, f.reason, f.status::public.suspicious_flag_status, f.resolved_by, f.resolved_at, f.created_at
  from demo_seed.s_flag f join demo_seed.s_cust c on c.n = f.cust_n join demo_seed.s_loan l on l.n = f.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('suspicious_activity_flags', rc);

  insert into public.reminder_log (id, loan_id, sent_at, created_by)
  select demo_seed.u(16, r.seq), l.id, r.sent_at, r.actor from demo_seed.s_rem r join demo_seed.s_loan l on l.n = r.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('reminder_log', rc);
  return res;
end $$;

create or replace function demo_seed.aud_insert(p_table text, p_actor_expr text, p_ts_col text) returns int language plpgsql as $$
declare c int;
begin
  execute format('insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at) select %L, t.id::text, ''INSERT'', %s, to_jsonb(t) - ''is_demo'', t.%I from public.%I t where t.id::text like ''dede0000-%%''',
    p_table, p_actor_expr, p_ts_col, p_table);
  get diagnostics c = row_count;
  return c;
end $$;

create or replace function demo_seed.load_audit() returns jsonb language plpgsql as $$
declare res jsonb := '{}'::jsonb; rc int;
begin
  perform set_config('session_replication_role', 'replica', true);
  res := res || jsonb_build_object('profiles', demo_seed.aud_insert('profiles', 'null::uuid', 'created_at'));
  res := res || jsonb_build_object('loan_extensions', demo_seed.aud_insert('loan_extensions', 't.created_by', 'created_at'));
  res := res || jsonb_build_object('auction_batches', demo_seed.aud_insert('auction_batches', 't.created_by', 'created_at'));
  res := res || jsonb_build_object('physical_inventory_audits', demo_seed.aud_insert('physical_inventory_audits', 't.performed_by', 'created_at'));
  res := res || jsonb_build_object('suspicious_activity_flags', demo_seed.aud_insert('suspicious_activity_flags', 'null::uuid', 'created_at'));

  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'customers', t.id::text, 'INSERT', t.created_by,
    (to_jsonb(t) - 'is_demo') || jsonb_build_object('is_blacklisted', false, 'blacklist_reason', null, 'archived_at', null, 'archived_by', null, 'archive_reason', null, 'updated_at', t.created_at), t.created_at
  from public.customers t where t.id::text like 'dede0000-%';
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'customers', t.id::text, 'UPDATE', coalesce(t.archived_by, demo_seed.u(1, 1)), to_jsonb(t) - 'is_demo', t.updated_at
  from public.customers t where t.id::text like 'dede0000-%' and (t.is_blacklisted or t.archived_at is not null);
  get diagnostics rc = row_count; res := res || jsonb_build_object('customer_updates', rc);

  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'appraisal_items', t.id::text, 'INSERT', t.appraised_by,
    (to_jsonb(t) - 'is_demo') || jsonb_build_object('status', 'available', 'customer_id', null, 'updated_at', t.created_at, 'archived_at', null, 'archived_by', null, 'archive_reason', null), t.created_at
  from public.appraisal_items t where t.id::text like 'dede0000-%';
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'appraisal_items', t.id::text, 'UPDATE', l.created_by, to_jsonb(t) - 'is_demo', t.updated_at
  from public.appraisal_items t join public.loans l on l.appraisal_item_id = t.id where t.id::text like 'dede0000-%' and t.status = 'pawned';
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'appraisal_items', t.id::text, 'UPDATE', t.archived_by, to_jsonb(t) - 'is_demo', t.archived_at
  from public.appraisal_items t where t.id::text like 'dede0000-%' and t.archived_at is not null;

  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'loans', l.id::text, case when e.kind = 'create' then 'INSERT' else 'UPDATE' end, e.actor,
    (to_jsonb(l) - 'is_demo') || jsonb_build_object('status', e.status, 'principal_balance', e.bal, 'interest_owed', e.owed, 'maturity_date', e.maturity,
      'interest_accrued_through', e.through, 'extension_count', e.ext, 'late_payment_count', e.late, 'updated_at', e.at,
      'defaulted_at', case when l.defaulted_at <= e.at then l.defaulted_at end, 'reinstated_at', case when l.reinstated_at <= e.at then l.reinstated_at end,
      'redeemed_at', case when l.redeemed_at <= e.at then l.redeemed_at end, 'forfeited_at', case when l.forfeited_at <= e.at then l.forfeited_at end,
      'archived_at', case when e.kind = 'void' then l.archived_at end), e.at
  from demo_seed.s_ev e join public.loans l on l.id = demo_seed.u(3, e.loan_n) where e.kind <> 'queue';
  get diagnostics rc = row_count; res := res || jsonb_build_object('loans', rc);

  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'loan_payments', p.id::text, 'INSERT', p.created_by, (to_jsonb(p) - 'is_demo') || jsonb_build_object('amount', e.amount, 'principal_portion', e.ppart, 'interest_portion', e.ipart), p.created_at
  from public.loan_payments p join demo_seed.s_ev e on demo_seed.u(8, e.seq) = p.id where p.id::text like 'dede0000-%';
  get diagnostics rc = row_count; res := res || jsonb_build_object('loan_payments', rc);
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'loan_payments', p.id::text, 'UPDATE', e.actor,
    jsonb_build_object('admin_edit', true, 'reason', e.extra->>'reason',
      'before', (to_jsonb(p) - 'is_demo') || jsonb_build_object('amount', p.amount + e.amount, 'principal_portion', p.principal_portion + e.amount),
      'after', to_jsonb(p) - 'is_demo'), e.at
  from demo_seed.s_ev e join public.loan_payments p on p.receipt_number = e.receipt where e.kind = 'pay_fix';
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'suspicious_activity_flags', t.id::text, 'UPDATE', t.resolved_by, to_jsonb(t) - 'is_demo', t.resolved_at
  from public.suspicious_activity_flags t where t.id::text like 'dede0000-%' and t.resolved_at is not null;

  select count(*) into rc from public.audit_log where record_id like 'dede0000-%';
  return res || jsonb_build_object('audit_rows_total', rc);
end $$;

create or replace function demo_seed.unload() returns jsonb language plpgsql set search_path = public, auth as $$
declare t text; c int; res jsonb := '{}'::jsonb;
begin
  perform set_config('session_replication_role', 'replica', true);
  foreach t in array array['audit_log', 'reminder_log', 'suspicious_activity_flags', 'physical_inventory_audit_items', 'physical_inventory_audits', 'auction_batch_items', 'auction_batches',
      'cash_flow_entries', 'inventory_status_history', 'loan_extensions', 'loan_payments', 'loans', 'inventory_items', 'appraisal_items', 'customers', 'profiles'] loop
    execute format('delete from public.%I where %s like %L', t, case when t = 'audit_log' then 'record_id' else 'id::text' end, 'dede0000-%');
    get diagnostics c = row_count; res := res || jsonb_build_object(t, c);
  end loop;
  delete from auth.users where id::text like 'dede0000-%';
  return res;
end $$;

create or replace function demo_seed.verify() returns table (chk text, result text) language sql stable as $$
  select 'count ' || t.n, t.c::text from (
    select 'customers' n, count(*) c from public.customers where id::text like 'dede0000-%'
    union all select 'appraisal_items', count(*) from public.appraisal_items where id::text like 'dede0000-%'
    union all select 'inventory_items', count(*) from public.inventory_items where id::text like 'dede0000-%'
    union all select 'loans', count(*) from public.loans where id::text like 'dede0000-%'
    union all select 'loan_payments', count(*) from public.loan_payments where id::text like 'dede0000-%'
    union all select 'loan_extensions', count(*) from public.loan_extensions where id::text like 'dede0000-%'
    union all select 'inventory_status_history', count(*) from public.inventory_status_history where id::text like 'dede0000-%'
    union all select 'cash_flow_entries', count(*) from public.cash_flow_entries where id::text like 'dede0000-%'
    union all select 'auction_batches', count(*) from public.auction_batches where id::text like 'dede0000-%'
    union all select 'auction_batch_items', count(*) from public.auction_batch_items where id::text like 'dede0000-%'
    union all select 'physical_inventory_audits', count(*) from public.physical_inventory_audits where id::text like 'dede0000-%'
    union all select 'physical_inventory_audit_items', count(*) from public.physical_inventory_audit_items where id::text like 'dede0000-%'
    union all select 'suspicious_activity_flags', count(*) from public.suspicious_activity_flags where id::text like 'dede0000-%'
    union all select 'reminder_log', count(*) from public.reminder_log where id::text like 'dede0000-%'
    union all select 'profiles', count(*) from public.profiles where id::text like 'dede0000-%'
    union all select 'audit_log', count(*) from public.audit_log where record_id like 'dede0000-%') t
  union all select 'orphan loans (no customer/appraisal/inventory)', count(*)::text from public.loans l where l.id::text like 'dede0000-%'
    and (not exists (select 1 from public.customers c where c.id = l.customer_id) or not exists (select 1 from public.appraisal_items a where a.id = l.appraisal_item_id) or not exists (select 1 from public.inventory_items i where i.id = l.inventory_item_id))
  union all select 'orphan payments/extensions/cash', ((select count(*) from public.loan_payments p where p.id::text like 'dede0000-%' and not exists (select 1 from public.loans l where l.id = p.loan_id))
    + (select count(*) from public.loan_extensions x where x.id::text like 'dede0000-%' and not exists (select 1 from public.loans l where l.id = x.loan_id))
    + (select count(*) from public.cash_flow_entries x where x.id::text like 'dede0000-%' and x.related_loan_id is not null and not exists (select 1 from public.loans l where l.id = x.related_loan_id)))::text
  union all select 'orphan staff references', ((select count(*) from public.loans l where l.id::text like 'dede0000-%' and not exists (select 1 from public.profiles p where p.id = l.created_by))
    + (select count(*) from public.loan_payments l where l.id::text like 'dede0000-%' and not exists (select 1 from public.profiles p where p.id = l.created_by)))::text
  union all select 'principal does not reconcile (excluding voids)', count(*)::text from public.loans l where l.id::text like 'dede0000-%' and l.archived_at is null
    and l.principal_balance <> l.principal_amount + coalesce((select sum(x.capitalized_amount) from public.loan_extensions x where x.loan_id = l.id), 0) - coalesce((select sum(p.principal_portion) from public.loan_payments p where p.loan_id = l.id), 0)
  union all select 'redeemed loans with a balance', count(*)::text from public.loans l where l.id::text like 'dede0000-%' and l.status = 'redeemed' and (l.principal_balance <> 0 or l.interest_owed <> 0)
  union all select 'disbursements minus principal (should be 0)', (coalesce((select sum(amount) from public.cash_flow_entries where id::text like 'dede0000-%' and entry_type = 'loan_disbursement'), 0)
    - coalesce((select sum(principal_amount) from public.loans where id::text like 'dede0000-%'), 0))::text
  union all select 'payments vs ledger (should be 0)', (coalesce((select sum(amount) from public.cash_flow_entries where id::text like 'dede0000-%' and entry_type = 'payment_received'), 0)
    - coalesce((select sum(amount) from public.cash_flow_entries where id::text like 'dede0000-%' and entry_type = 'adjustment' and direction = 'out' and description like 'Admin correction to payment%'), 0)
    - coalesce((select sum(amount) from public.loan_payments where id::text like 'dede0000-%'), 0))::text
  union all select 'date order problems', ((select count(*) from public.loans l where l.id::text like 'dede0000-%' and (l.redeemed_at <= l.created_at or l.forfeited_at <= l.defaulted_at or l.maturity_date < l.loan_date))
    + (select count(*) from public.loan_payments p join public.loans l on l.id = p.loan_id where p.id::text like 'dede0000-%' and p.created_at < l.created_at)
    + (select count(*) from public.loans l where l.id::text like 'dede0000-%' and l.status = 'forfeited' and l.forfeited_at < (l.maturity_date + l.grace_period_days)::timestamptz))::text
  union all select 'status ' || status::text, count(*)::text from public.loans where id::text like 'dede0000-%' group by status
  union all select 'month ' || to_char(loan_date, 'YYYY-MM'), count(*) || ' loans, PHP ' || round(sum(principal_amount)) || ' lent' from public.loans where id::text like 'dede0000-%' group by to_char(loan_date, 'YYYY-MM')
  union all select 'collected ' || to_char(created_at at time zone 'Asia/Manila', 'YYYY-MM'), 'PHP ' || round(sum(amount)) from public.loan_payments where id::text like 'dede0000-%' group by to_char(created_at at time zone 'Asia/Manila', 'YYYY-MM')
  union all select 'duplicate ticket or receipt numbers', ((select count(*) - count(distinct ticket_number) from public.loans) + (select count(*) - count(distinct receipt_number) from public.loan_payments))::text
  order by 1 $$;
