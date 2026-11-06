-- Demo seed, part 1: staging schema, deterministic RNG and calendar helpers.
-- Everything lives in schema demo_seed and can be removed with: drop schema demo_seed cascade.
create schema if not exists demo_seed;

-- Deterministic RNG (Park-Miller). Seed with: select set_config('demo.s', '20260711', false);
create or replace function demo_seed.r() returns double precision language plpgsql as $$
declare s bigint;
begin
  s := current_setting('demo.s', true)::bigint;
  s := (s * 48271) % 2147483647;
  perform set_config('demo.s', s::text, false);
  return s::double precision / 2147483647;
end $$;

create or replace function demo_seed.ri(a int, b int) returns int language sql as $$ select a + floor(demo_seed.r() * (b - a + 1))::int $$;
create or replace function demo_seed.ch(p double precision) returns boolean language sql as $$ select demo_seed.r() < p $$;
create or replace function demo_seed.pk(arr text[]) returns text language sql as $$ select arr[1 + floor(demo_seed.r() * array_length(arr, 1))::int] $$;

create or replace function demo_seed.wpk(arr text[], w double precision[]) returns text language plpgsql as $$
declare tot double precision := 0; x double precision; acc double precision := 0; i int;
begin
  for i in 1..array_length(w, 1) loop tot := tot + w[i]; end loop;
  x := demo_seed.r() * tot;
  for i in 1..array_length(w, 1) loop
    acc := acc + w[i];
    if x <= acc then return arr[i]; end if;
  end loop;
  return arr[array_length(arr, 1)];
end $$;

-- Recognisable UUIDs for demo rows: dede0000-<kind>-4000-8000-<n>
create or replace function demo_seed.u(kind int, n int) returns uuid language sql immutable as $$
  select ('dede0000-' || lpad(to_hex(kind), 4, '0') || '-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $$;

create or replace function demo_seed.is_closed(d date) returns boolean language sql immutable as $$
  select d = any (array['2026-08-17','2026-08-21','2026-08-31','2026-09-14','2026-10-05','2026-10-19']::date[]) $$;

create or replace function demo_seed.nopen(d date) returns date language plpgsql immutable as $$
begin
  while demo_seed.is_closed(d) loop d := d + 1; end loop;
  return d;
end $$;

-- Manila local date + minutes after midnight -> timestamptz
create or replace function demo_seed.mkts(d date, mins int) returns timestamptz language sql immutable as $$
  select ((d + make_interval(mins => mins)) at time zone 'Asia/Manila') $$;

create or replace function demo_seed.rcpt(ts timestamptz, n int, salt int) returns text language sql immutable as $$
  select 'RC-' || to_char(ts at time zone 'Asia/Manila', 'YYYYMMDDHH24MISS') || '-' || upper(substr(md5(n::text || '-' || salt::text), 1, 4)) $$;

create or replace function demo_seed.tkt(ts timestamptz, n int) returns text language sql immutable as $$
  select 'PT-' || to_char(ts at time zone 'Asia/Manila', 'YYYYMMDDHH24MISS') || '-' || upper(substr(md5('t' || n::text), 1, 4)) $$;

-- 24K price per gram on a date: rises from about 3,320 (Jul 1) to 3,550 (Oct 27), with small daily noise.
create or replace function demo_seed.gold24(d date) returns numeric language sql immutable as $$
  select round(3320 + 230 * ((d - date '2026-07-01')::numeric / 118) + (((d - date '2026-07-01') * 37) % 11 - 5) * 2.0, 2) $$;

-- Staging tables (kept apart from the real ones until load).
create table if not exists demo_seed.s_cust (
  n int primary key, id uuid not null, full_name text, address text, contact_number text, email text, date_of_birth date,
  id_type text, id_number text, aml_status text default 'clear', aml_notes text, aml_checked_at timestamptz,
  is_blacklisted boolean default false, blacklist_reason text, bl_at timestamptz,
  created_by uuid, created_at timestamptz, updated_at timestamptz,
  archived_at timestamptz, archived_by uuid, archive_reason text,
  tier text, nloans int default 0, nactive int default 0, last_loan_date date
);
create table if not exists demo_seed.s_appr (
  n int primary key, id uuid, customer_n int, weight numeric(10,3), karat int, notes text, gold_price numeric(10,2), ltv numeric(5,2),
  value numeric(12,2), minl numeric(12,2), maxl numeric(12,2), counterfeit boolean default false, resolution text,
  resolved_by uuid, resolved_at timestamptz, appraised_by uuid, created_at timestamptz, updated_at timestamptz,
  category text, category_other text, status text, pawned_at timestamptz, archived_at timestamptz, archived_by uuid, archive_reason text
);
create table if not exists demo_seed.s_loan (
  n int primary key, id uuid, inv_id uuid, cust_n int, appr_n int, principal numeric(12,2), rate numeric(5,2), balance numeric(12,2), owed numeric(12,2),
  through date, loan_date date, maturity date, grace int, ext int default 0, status text, ticket text, created_by uuid, created_at timestamptz, updated_at timestamptz,
  lost boolean default false, defaulted_at timestamptz, reinstated_at timestamptz, redeemed_at timestamptz, forfeited_at timestamptz, late int default 0,
  vault text, inv_status text, tier text, voided boolean default false, archived_at timestamptz, archived_by uuid, archive_reason text
);
create table if not exists demo_seed.s_ev (
  seq serial primary key, loan_n int, at timestamptz, kind text, actor uuid,
  amount numeric(12,2), ipart numeric(12,2), ppart numeric(12,2), receipt text, lost boolean default false, extra jsonb,
  bal numeric(12,2), owed numeric(12,2), through date, maturity date, ext int, status text, late int,
  prev_maturity date, inv_new text, note text
);
create index if not exists s_ev_loan on demo_seed.s_ev (loan_n, at);
