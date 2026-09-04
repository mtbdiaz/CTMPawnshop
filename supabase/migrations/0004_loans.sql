create type public.loan_status as enum ('active', 'extended', 'redeemed', 'defaulted', 'forfeited');
create type public.cash_flow_type as enum ('loan_disbursement', 'payment_received', 'expense', 'revenue', 'forfeiture');
create type public.cash_flow_direction as enum ('in', 'out');
create type public.inventory_status as enum ('pawned', 'extended', 'redeemed', 'forfeited', 'queued_for_auction');

-- Introduced ahead of their nominal sprints (6=Inventory, 7=Financial)
-- because PB-17's own acceptance criteria requires loan creation to
-- automatically create a matching inventory record and cash flow entry.
-- Sprints 6/7 build the full audit/reporting screens on top of these
-- same tables rather than duplicating them.
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  appraisal_item_id uuid not null references public.appraisal_items(id),
  vault_location text not null,
  status public.inventory_status not null default 'pawned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cash_flow_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type public.cash_flow_type not null,
  direction public.cash_flow_direction not null,
  amount numeric(12,2) not null check (amount > 0),
  description text,
  related_loan_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  appraisal_item_id uuid not null references public.appraisal_items(id),
  inventory_item_id uuid references public.inventory_items(id),
  principal_amount numeric(12,2) not null check (principal_amount > 0),
  interest_rate_percent numeric(5,2) not null,
  principal_balance numeric(12,2) not null,
  loan_date date not null default current_date,
  maturity_date date not null,
  grace_period_days integer not null,
  extension_count integer not null default 0,
  status public.loan_status not null default 'active',
  ticket_number text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cash_flow_entries
  add constraint cash_flow_entries_loan_fkey foreign key (related_loan_id) references public.loans(id);

create table public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id),
  amount numeric(12,2) not null check (amount > 0),
  principal_portion numeric(12,2) not null default 0,
  interest_portion numeric(12,2) not null default 0,
  receipt_number text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.loan_extensions (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id),
  previous_maturity_date date not null,
  new_maturity_date date not null,
  additional_interest_amount numeric(12,2) not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.inventory_items enable row level security;
alter table public.cash_flow_entries enable row level security;
alter table public.loans enable row level security;
alter table public.loan_payments enable row level security;
alter table public.loan_extensions enable row level security;

create policy "inventory_items: staff select" on public.inventory_items for select to authenticated using (true);
create policy "inventory_items: system insert" on public.inventory_items for insert to authenticated with check (public.get_my_role() in ('cashier','operator','admin'));
create policy "inventory_items: staff update" on public.inventory_items for update to authenticated using (public.get_my_role() in ('cashier','operator','admin')) with check (public.get_my_role() in ('cashier','operator','admin'));

create policy "cash_flow_entries: staff select" on public.cash_flow_entries for select to authenticated using (true);
create policy "cash_flow_entries: system insert" on public.cash_flow_entries for insert to authenticated with check (public.get_my_role() in ('cashier','operator','admin'));

create policy "loans: staff select" on public.loans for select to authenticated using (true);
create policy "loans: cashier or admin insert" on public.loans for insert to authenticated with check (public.get_my_role() in ('cashier','admin'));
create policy "loans: cashier or admin update" on public.loans for update to authenticated using (public.get_my_role() in ('cashier','admin')) with check (public.get_my_role() in ('cashier','admin'));

create policy "loan_payments: staff select" on public.loan_payments for select to authenticated using (true);
create policy "loan_payments: cashier or admin insert" on public.loan_payments for insert to authenticated with check (public.get_my_role() in ('cashier','admin'));

create policy "loan_extensions: staff select" on public.loan_extensions for select to authenticated using (true);
create policy "loan_extensions: cashier or admin insert" on public.loan_extensions for insert to authenticated with check (public.get_my_role() in ('cashier','admin'));

create trigger inventory_items_set_updated_at before update on public.inventory_items for each row execute function public.set_updated_at();
create trigger loans_set_updated_at before update on public.loans for each row execute function public.set_updated_at();

create index loans_customer_idx on public.loans (customer_id);
create index loan_payments_loan_idx on public.loan_payments (loan_id);
create index loan_extensions_loan_idx on public.loan_extensions (loan_id);
create index cash_flow_entries_loan_idx on public.cash_flow_entries (related_loan_id);
