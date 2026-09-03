-- Staff roles
create type public.staff_role as enum ('admin', 'operator', 'cashier', 'appraiser');

-- One profile row per auth.users row, carries the role RLS/UI decisions are based on.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.staff_role not null default 'operator',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Staff account profile: role + active flag. One row per auth.users row.';

-- Returns the calling user's role. SECURITY DEFINER so it can read profiles
-- without recursing into the RLS policies defined on profiles below.
create or replace function public.get_my_role()
returns public.staff_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

alter table public.profiles enable row level security;

create policy "profiles: self or admin can select"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles: admin can insert"
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

create policy "profiles: admin can update, self can update own name"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (id = auth.uid() and role = (select role from public.profiles p where p.id = auth.uid()) and is_active = (select is_active from public.profiles p where p.id = auth.uid()))
  );

-- Business rules singleton (PB-6): interest rate, gold price, LTV%, grace period.
create table public.system_settings (
  id smallint primary key default 1,
  interest_rate_percent numeric(5,2) not null check (interest_rate_percent >= 0),
  gold_price_per_gram numeric(10,2) not null check (gold_price_per_gram >= 0),
  ltv_percent numeric(5,2) not null check (ltv_percent > 0 and ltv_percent <= 100),
  grace_period_days integer not null check (grace_period_days >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint system_settings_singleton check (id = 1)
);

comment on table public.system_settings is 'Singleton row (id=1) of shop-wide configurable business rules (PB-6).';

insert into public.system_settings (id, interest_rate_percent, gold_price_per_gram, ltv_percent, grace_period_days)
values (1, 5.00, 0.00, 70.00, 7);

alter table public.system_settings enable row level security;

create policy "system_settings: any authenticated staff can select"
  on public.system_settings for select
  to authenticated
  using (true);

create policy "system_settings: admin can update"
  on public.system_settings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Keep updated_at fresh on every write.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger system_settings_set_updated_at
  before update on public.system_settings
  for each row execute function public.set_updated_at();

revoke execute on function public.get_my_role() from anon;
revoke execute on function public.is_admin() from anon;
