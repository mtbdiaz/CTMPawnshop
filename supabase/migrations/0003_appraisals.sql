create type public.counterfeit_resolution as enum ('pending', 'cleared', 'confirmed');

create table public.appraisal_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  weight_grams numeric(10,3) not null check (weight_grams > 0),
  karat integer not null check (karat > 0 and karat <= 24),
  purity_percent numeric(5,2) not null check (purity_percent > 0 and purity_percent <= 100),
  condition_notes text,
  photo_paths text[] not null default '{}',
  gold_price_used numeric(10,2) not null,
  ltv_percent_used numeric(5,2) not null,
  computed_value numeric(12,2) not null,
  suggested_loan_min numeric(12,2) not null,
  suggested_loan_max numeric(12,2) not null,
  is_counterfeit_risk boolean not null default false,
  counterfeit_resolution public.counterfeit_resolution,
  counterfeit_resolved_by uuid references public.profiles(id),
  counterfeit_resolved_at timestamptz,
  appraised_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.appraisal_items is 'Gold item appraisals (PB-12..PB-16): item details, photos, computed valuation, counterfeit flag.';

alter table public.appraisal_items enable row level security;

create policy "appraisal_items: any authenticated staff can select"
  on public.appraisal_items for select
  to authenticated
  using (true);

create policy "appraisal_items: appraiser or admin can insert"
  on public.appraisal_items for insert
  to authenticated
  with check (public.get_my_role() in ('appraiser', 'admin'));

create policy "appraisal_items: appraiser or admin can update"
  on public.appraisal_items for update
  to authenticated
  using (public.get_my_role() in ('appraiser', 'admin'))
  with check (public.get_my_role() in ('appraiser', 'admin'));

create trigger appraisal_items_set_updated_at
  before update on public.appraisal_items
  for each row execute function public.set_updated_at();

create index appraisal_items_customer_idx on public.appraisal_items (customer_id);

-- Storage bucket for item photos (PB-13). Private bucket; access mirrors
-- appraisal_items visibility (any authenticated staff can read/write).
insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', false)
on conflict (id) do nothing;

create policy "item-photos: authenticated staff can read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'item-photos');

create policy "item-photos: authenticated staff can upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'item-photos');
