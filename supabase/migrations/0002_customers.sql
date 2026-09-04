create type public.aml_status as enum ('clear', 'flagged');

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  address text not null,
  contact_number text not null,
  email text,
  date_of_birth date,
  id_type text not null,
  id_number text not null,
  aml_status public.aml_status not null default 'clear',
  aml_checked_at timestamptz,
  aml_notes text,
  is_blacklisted boolean not null default false,
  blacklist_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customers is 'Customer registry (PB-7..PB-11): profile, AML status, blacklist flag.';

alter table public.customers enable row level security;

-- All authenticated staff can view customers (needed for blacklist checks at
-- loan/appraisal time by Cashier/Appraiser too), but only Operator/Admin can
-- register or edit them.
create policy "customers: any authenticated staff can select"
  on public.customers for select
  to authenticated
  using (true);

create policy "customers: operator or admin can insert"
  on public.customers for insert
  to authenticated
  with check (public.get_my_role() in ('operator', 'admin'));

create policy "customers: operator or admin can update"
  on public.customers for update
  to authenticated
  using (public.get_my_role() in ('operator', 'admin'))
  with check (public.get_my_role() in ('operator', 'admin'));

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create index customers_full_name_idx on public.customers using gin (to_tsvector('simple', full_name));
