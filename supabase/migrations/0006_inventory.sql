-- PB-24 AC2: every inventory status change is timestamped and logged.
create table public.inventory_status_history (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id),
  old_status public.inventory_status,
  new_status public.inventory_status not null,
  changed_at timestamptz not null default now()
);

create or replace function public.log_inventory_status_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') or (old.status is distinct from new.status) then
    insert into public.inventory_status_history (inventory_item_id, old_status, new_status)
    values (new.id, case when tg_op = 'INSERT' then null else old.status end, new.status);
  end if;
  return new;
end;
$$;

create trigger inventory_items_log_status_change
  after insert or update on public.inventory_items
  for each row execute function public.log_inventory_status_change();

-- PB-25: physical inventory audit — reconcile vault count vs system records.
create table public.physical_inventory_audits (
  id uuid primary key default gen_random_uuid(),
  performed_by uuid references public.profiles(id),
  notes text,
  discrepancy_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.physical_inventory_audit_items (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.physical_inventory_audits(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  expected_status public.inventory_status not null,
  found boolean not null,
  notes text
);

-- PB-26: batch forfeited items for the next auction cycle.
create table public.auction_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

create table public.auction_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.auction_batches(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id)
);

alter table public.inventory_status_history enable row level security;
alter table public.physical_inventory_audits enable row level security;
alter table public.physical_inventory_audit_items enable row level security;
alter table public.auction_batches enable row level security;
alter table public.auction_batch_items enable row level security;

create policy "inventory_status_history: staff select" on public.inventory_status_history for select to authenticated using (true);

create policy "physical_inventory_audits: staff select" on public.physical_inventory_audits for select to authenticated using (true);
create policy "physical_inventory_audits: operator or admin insert" on public.physical_inventory_audits for insert to authenticated with check (public.get_my_role() in ('operator','admin'));

create policy "physical_inventory_audit_items: staff select" on public.physical_inventory_audit_items for select to authenticated using (true);
create policy "physical_inventory_audit_items: operator or admin insert" on public.physical_inventory_audit_items for insert to authenticated with check (public.get_my_role() in ('operator','admin'));

create policy "auction_batches: staff select" on public.auction_batches for select to authenticated using (true);
create policy "auction_batches: operator or admin insert" on public.auction_batches for insert to authenticated with check (public.get_my_role() in ('operator','admin'));

create policy "auction_batch_items: staff select" on public.auction_batch_items for select to authenticated using (true);
create policy "auction_batch_items: operator or admin insert" on public.auction_batch_items for insert to authenticated with check (public.get_my_role() in ('operator','admin'));

create index inventory_status_history_item_idx on public.inventory_status_history (inventory_item_id);
create index physical_inventory_audit_items_audit_idx on public.physical_inventory_audit_items (audit_id);
create index auction_batch_items_batch_idx on public.auction_batch_items (batch_id);
