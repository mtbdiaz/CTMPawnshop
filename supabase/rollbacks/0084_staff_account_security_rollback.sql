-- EMERGENCY ROLLBACK for 0084_staff_account_security (Nov 15, 2026). Run ONLY if, after 0084, active staff can't see
-- or do their normal work. It puts the role helpers and the read rules back exactly as they were before 0084
-- (checked: the catalog after 0084 + this file = the catalog before 0084, in a rolled-back test).
-- It removes the last-active-Admin trigger too. It KEEPS staff_account_events and record_staff_account_event (history
-- is never deleted; the app code also works without them). After running it, redeploy the previous app version.

create or replace function public.get_my_role() returns public.staff_role
language sql stable security definer set search_path to 'public' as $$
  select role from public.profiles where id = auth.uid();
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;
alter policy "appraisal_items: any authenticated staff can select" on public.appraisal_items using (true);
alter policy "auction_batch_items: staff select" on public.auction_batch_items using (true);
alter policy "auction_batches: staff select" on public.auction_batches using (true);
alter policy "customers: any authenticated staff can select" on public.customers using (true);
alter policy "inventory_items: staff select" on public.inventory_items using (true);
alter policy "inventory_location_moves: staff select" on public.inventory_location_moves using (true);
alter policy "inventory_status_history: staff select" on public.inventory_status_history using (true);
alter policy "loan_extensions: staff select" on public.loan_extensions using (true);
alter policy "loan_payments: staff select" on public.loan_payments using (true);
alter policy "loans: staff select" on public.loans using (true);
alter policy "loan_penalty_waivers: staff select" on public.loan_penalty_waivers using (true);
alter policy "physical_inventory_audit_followups: staff select" on public.physical_inventory_audit_followups using (true);
alter policy "physical_inventory_audit_items: staff select" on public.physical_inventory_audit_items using (true);
alter policy "physical_inventory_audits: staff select" on public.physical_inventory_audits using (true);
alter policy "reminder_log: staff select" on public.reminder_log using (true);
alter policy "score_weights: staff select" on public.score_weights using (true);
alter policy "system_settings: any authenticated staff can select" on public.system_settings using (true);
alter policy "vault_locations: staff select" on public.vault_locations using (true);
alter policy "item-photos: authenticated staff can read" on storage.objects using (bucket_id = 'item-photos'::text);
alter policy "item-photos: uploader can delete own unattached photo" on storage.objects
  using ((bucket_id = 'item-photos'::text) and (owner_id = ((select auth.uid() as uid))::text) and (not public.ctm_photo_in_use(name)));
alter policy "profiles: admin can update, self can update own name" on public.profiles using ((id = auth.uid()) or public.is_admin());
drop trigger if exists profiles_guard_last_admin on public.profiles;
drop function if exists public.guard_last_admin();
