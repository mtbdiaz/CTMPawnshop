-- PB-31: cross-cutting audit trail. Read-only even to Admin (no update/delete
-- policy exists at all); trigger function is SECURITY DEFINER so it bypasses
-- RLS to insert regardless of the acting role's own insert permissions.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor uuid,
  changed_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;
create policy "audit_log: admin can select" on public.audit_log for select to authenticated using (public.is_admin());

create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log(table_name, record_id, action, actor, changed_data)
    values (tg_table_name, old.id::text, tg_op, auth.uid(), to_jsonb(old));
    return old;
  else
    insert into public.audit_log(table_name, record_id, action, actor, changed_data)
    values (tg_table_name, new.id::text, tg_op, auth.uid(), to_jsonb(new));
    return new;
  end if;
end;
$$;

revoke execute on function public.audit_trigger_fn() from anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','system_settings','customers','appraisal_items','inventory_items',
    'loans','loan_payments','loan_extensions','cash_flow_entries',
    'physical_inventory_audits','auction_batches'
  ]
  loop
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger_fn();',
      t, t
    );
  end loop;
end $$;

-- PB-32: suspicious activity flags.
create type public.suspicious_flag_status as enum ('open', 'dismissed', 'investigating', 'blacklisted');

create table public.suspicious_activity_flags (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  loan_id uuid references public.loans(id),
  reason text not null,
  status public.suspicious_flag_status not null default 'open',
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.suspicious_activity_flags enable row level security;
create policy "suspicious_activity_flags: staff select" on public.suspicious_activity_flags for select to authenticated using (true);
create policy "suspicious_activity_flags: cashier or admin insert" on public.suspicious_activity_flags for insert to authenticated with check (public.get_my_role() in ('cashier','admin'));
create policy "suspicious_activity_flags: admin update" on public.suspicious_activity_flags for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- PB-33: due-date reminders (in-app log; no email/SMS provider configured
-- in this environment, see DECISIONS_LOG.md).
create table public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id),
  sent_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

alter table public.reminder_log enable row level security;
create policy "reminder_log: staff select" on public.reminder_log for select to authenticated using (true);
create policy "reminder_log: cashier or admin insert" on public.reminder_log for insert to authenticated with check (public.get_my_role() in ('cashier','admin'));

create index suspicious_activity_flags_customer_idx on public.suspicious_activity_flags (customer_id);
create index reminder_log_loan_idx on public.reminder_log (loan_id);
create index audit_log_table_record_idx on public.audit_log (table_name, record_id);
