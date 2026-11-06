-- Backend review part 2.
-- #26 loans, payments and renewals can only be written by the database functions (like updates since 0017)
alter policy "loans: cashier or admin insert" on public.loans with check (false);
alter policy "loan_payments: cashier or admin insert" on public.loan_payments with check (false);
alter policy "loan_extensions: cashier or admin insert" on public.loan_extensions with check (false);

-- #24 changing a cleared item's karat, weight or category sends it back to counterfeit review
-- #27 who appraised the item, and when, can't be changed
create or replace function public.guard_appraisal_locked() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.ctm_is_system() then return new; end if;
  if new.status is distinct from old.status or new.customer_id is distinct from old.customer_id
     or new.archived_at is distinct from old.archived_at or new.archive_reason is distinct from old.archive_reason then
    raise exception 'Status, customer and archive fields change only through pawning or archiving.' using errcode = '42501';
  end if;
  if new.appraised_by is distinct from old.appraised_by or new.created_at is distinct from old.created_at then
    raise exception 'Who appraised the item, and when, cannot be changed.' using errcode = '42501';
  end if;
  if not public.is_admin() and (new.counterfeit_resolution is distinct from old.counterfeit_resolution or (old.is_counterfeit_risk and not new.is_counterfeit_risk)) then
    raise exception 'Only an Admin can resolve a counterfeit flag.' using errcode = '42501';
  end if;
  if old.is_counterfeit_risk and old.counterfeit_resolution = 'cleared' and new.counterfeit_resolution = 'cleared'
     and (new.karat is distinct from old.karat or new.weight_grams is distinct from old.weight_grams
          or new.category is distinct from old.category or new.category_other is distinct from old.category_other) then
    new.counterfeit_resolution := 'pending';
    new.counterfeit_resolved_by := null;
    new.counterfeit_resolved_at := null;
  end if;
  return new;
end $$;

-- #11 staff can read each other's names (receipts "Received by", "Appraised by")
create policy "profiles: staff can read" on public.profiles for select to authenticated using (public.get_my_role() is not null);

-- #25 item photos: JPEG/PNG/WebP up to 5 MB, uploads only by Appraiser, Cashier or Admin
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'item-photos';
alter policy "item-photos: authenticated staff can upload" on storage.objects
  with check (bucket_id = 'item-photos' and public.get_my_role() in ('appraiser', 'cashier', 'admin'));

-- #12 keep the old row on updates and deletes, so the audit trail can show old -> new
alter table public.audit_log add column if not exists old_data jsonb;
create or replace function public.audit_trigger_fn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, actor, changed_data, old_data)
    values (tg_table_name, old.id::text, tg_op, auth.uid(), to_jsonb(old), to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, record_id, action, actor, changed_data, old_data)
    values (tg_table_name, new.id::text, tg_op, auth.uid(), to_jsonb(new), to_jsonb(old));
    return new;
  else
    insert into public.audit_log (table_name, record_id, action, actor, changed_data)
    values (tg_table_name, new.id::text, tg_op, auth.uid(), to_jsonb(new));
    return new;
  end if;
end $$;
