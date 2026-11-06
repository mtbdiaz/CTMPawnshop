-- Demo data support: every row created by the demo seed carries is_demo = true,
-- so it can be found and removed. Additive only; existing rows default to false.
alter table public.profiles add column if not exists is_demo boolean not null default false;
alter table public.customers add column if not exists is_demo boolean not null default false;
alter table public.appraisal_items add column if not exists is_demo boolean not null default false;
alter table public.inventory_items add column if not exists is_demo boolean not null default false;
alter table public.inventory_status_history add column if not exists is_demo boolean not null default false;
alter table public.loans add column if not exists is_demo boolean not null default false;
alter table public.loan_payments add column if not exists is_demo boolean not null default false;
alter table public.loan_extensions add column if not exists is_demo boolean not null default false;
alter table public.cash_flow_entries add column if not exists is_demo boolean not null default false;
alter table public.auction_batches add column if not exists is_demo boolean not null default false;
alter table public.auction_batch_items add column if not exists is_demo boolean not null default false;
alter table public.physical_inventory_audits add column if not exists is_demo boolean not null default false;
alter table public.physical_inventory_audit_items add column if not exists is_demo boolean not null default false;
alter table public.suspicious_activity_flags add column if not exists is_demo boolean not null default false;
alter table public.reminder_log add column if not exists is_demo boolean not null default false;
alter table public.audit_log add column if not exists is_demo boolean not null default false;
