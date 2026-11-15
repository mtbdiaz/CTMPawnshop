-- 0085 (Nov 15, 2026, Wush): Archive Phase 2A, safe archive and restore rules (claude/archive-phase1-review.md,
-- decisions in claude/archive-phase2a.md).
--
-- Before: one archive_record() and one restore_record() for all 11 record types.
--   - Restore had NO rules: it put back VOID loans, auction batch #2 (its item is now under a reinstated loan),
--     appraisals made before appraisals needed a customer, test vault audits, and customers that duplicate an
--     active one (same ID = raw unique-constraint error; same person by name and phone = no warning at all).
--   - Archive let an Admin archive payments, renewals, reminders, items still in the vault, auction batches,
--     audits and undecided suspicious-activity flags by calling the function directly, with no rules.
--   - Both checked "if not found" after EXECUTE, which PostgreSQL never sets, so a missing, stale or already
--     restored record still answered "success" and nothing was recorded.
--   - Restore needed no reason and wiped who/when/why from the row; only the audit log kept it.
--   - restore_record left the "system" switch (ctm.system) on for the rest of the transaction.
-- Now:
--   - Default refuse. Each type has explicit rules; a type or case without established safety rules is refused
--     with a plain-language reason (no raw database messages).
--   - Payments, renewals and reminders: never archived or restored (permanent history).
--     Cash entries: unchanged, still locked for every role until a reversal workflow is approved.
--     Inventory items, auction batches, vault audits, suspicious-activity flags: no longer archived here.
--     Archived auction batches and vault audits are never restored here (kept read-only in history).
--   - VOID / cancelled loans and loans whose item is archived are never restored here. Cancellation is recognised from
--     the records, not only the reason text: a redeemed loan must have been repaid in full, and the loan and its item
--     must agree; anything else fails closed ("needs a manual review").
--   - A record archived by a one-time data cleanup (no staff member recorded) is never restored here; Matt reviews it.
--   - Customers: refused when it was archived as a duplicate, an active customer has the same ID, or the same name
--     (first + last, or full) plus the same phone, birth date or address.
--   - Appraisals: refused when there's no customer on it, it was used for a loan, it has an open or confirmed
--     counterfeit flag, its customer is archived or blacklisted, or an active appraisal looks like its twin.
--   - Inventory items: refused when the status would show it as in the vault, or its loan is archived. Restoring only
--     clears the archive mark: the status, the appraisal, the auction lists and every total stay exactly the same.
--   - Restoring needs a written reason (10+ characters with letters). The actor is always the signed-in session.
--   - Every archive and restore writes an archive_events row that can't be changed or deleted. A restore row keeps the
--     original archive date, actor and reason, so they survive the restore.
--   - Both functions lock the row, check its current state, and say exactly what happened: not found, already
--     archived, already restored by another Admin, or done.
--   - archive_restore_check() tells the page (Phase 2B) whether a record can be restored and why not, with the same
--     rules restore_record() uses.
--   - The old restore_record(table, id) (no reason) stays for old open pages: it checks the role and the ledger lock
--     as before, then refuses with "reload the page". So the database and app should go live together.
-- Records are not changed by this migration; it only adds archive_events rows for what is archived today.
-- Self-test: select * from public.ctm_selftest_0085();   (every test rolls back)

-- 1. Immutable history ---------------------------------------------------------------------------------------------
create table if not exists public.archive_events (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('archived', 'restored')),
  reason text not null,
  actor uuid references public.profiles(id), -- null only for records archived by old data fixes (backfill)
  created_at timestamptz not null default clock_timestamp(), -- the real moment, even inside one transaction
  original_archived_at timestamptz,          -- on a 'restored' row: the archive this restore undid
  original_archived_by uuid,
  original_archive_reason text,
  source text not null default 'app' check (source in ('app', 'backfill'))
);
create index if not exists archive_events_record on public.archive_events (table_name, record_id, created_at);

alter table public.archive_events enable row level security;
drop policy if exists "archive_events: admin select" on public.archive_events;
create policy "archive_events: admin select" on public.archive_events for select using ((select public.is_admin()));
revoke all on public.archive_events from anon;
revoke insert, update, delete, truncate on public.archive_events from authenticated;
grant select on public.archive_events to authenticated;

create or replace function public.guard_archive_events() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Archive history can''t be changed or deleted.' using errcode = '42501';
end $$;
drop trigger if exists archive_events_immutable on public.archive_events;
create trigger archive_events_immutable before update or delete on public.archive_events
  for each row execute function public.guard_archive_events();
drop trigger if exists archive_events_no_truncate on public.archive_events;
create trigger archive_events_no_truncate before truncate on public.archive_events
  for each statement execute function public.guard_archive_events();

-- what is archived today, so the history is complete from the start
insert into public.archive_events (table_name, record_id, action, reason, actor, created_at, source)
select t.tbl, t.id, 'archived', coalesce(public.ctm_clean_note(t.archive_reason), '(no reason recorded)'),
       (select p.id from public.profiles p where p.id = t.archived_by), t.archived_at, 'backfill'
from (
  select 'customers' tbl, id, archived_at, archived_by, archive_reason from public.customers where archived_at is not null
  union all select 'appraisal_items', id, archived_at, archived_by, archive_reason from public.appraisal_items where archived_at is not null
  union all select 'loans', id, archived_at, archived_by, archive_reason from public.loans where archived_at is not null
  union all select 'loan_payments', id, archived_at, archived_by, archive_reason from public.loan_payments where archived_at is not null
  union all select 'loan_extensions', id, archived_at, archived_by, archive_reason from public.loan_extensions where archived_at is not null
  union all select 'inventory_items', id, archived_at, archived_by, archive_reason from public.inventory_items where archived_at is not null
  union all select 'cash_flow_entries', id, archived_at, archived_by, archive_reason from public.cash_flow_entries where archived_at is not null
  union all select 'auction_batches', id, archived_at, archived_by, archive_reason from public.auction_batches where archived_at is not null
  union all select 'physical_inventory_audits', id, archived_at, archived_by, archive_reason from public.physical_inventory_audits where archived_at is not null
  union all select 'suspicious_activity_flags', id, archived_at, archived_by, archive_reason from public.suspicious_activity_flags where archived_at is not null
  union all select 'reminder_log', id, archived_at, archived_by, archive_reason from public.reminder_log where archived_at is not null
) t
where not exists (select 1 from public.archive_events e where e.table_name = t.tbl and e.record_id = t.id);

-- 2. Restore rules: one place, used by restore_record() and archive_restore_check() -----------------------------------
-- Returns null when the record may be restored, otherwise the reason in plain language.
-- Assumes the record exists and is archived (the callers check that first).
create or replace function public.ctm_restore_blocker(p_table text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c record; d record; a record; l record; i record; f record; v text;
begin
  if p_table in ('loan_payments', 'loan_extensions', 'reminder_log') then
    return 'Payments, renewals and reminders are permanent history. They can''t be archived or restored.';
  elsif p_table = 'cash_flow_entries' then
    if public.ctm_ledger_locked() then
      return 'Correcting, archiving and restoring ledger entries is switched off for now, for every role, until a reversal workflow is approved. Nothing was changed.';
    end if;
    return 'Ledger entries can only be corrected through the approved reversal process.';
  elsif p_table = 'auction_batches' then
    return 'Archived auction batches stay archived. Their items have moved on since (for example back under a loan), so putting the batch back could show items for auction that aren''t.';
  elsif p_table = 'physical_inventory_audits' then
    return 'Archived vault audits stay in history as they are. They can''t be put back into active audits.';

  elsif p_table = 'customers' then
    select * into c from public.customers where id = p_id;
    if coalesce(c.archive_reason, '') ~* 'duplicate' then
      return 'This record was archived as a duplicate, so the customer is already on file under another record. Use that record; this one stays archived.';
    end if;
    select x.customer_no, x.full_name into d from public.customers x
     where x.id <> c.id and x.archived_at is null and x.id_type = c.id_type
       and upper(regexp_replace(x.id_number, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(c.id_number, '[^A-Za-z0-9]', '', 'g'))
     limit 1;
    if found then
      return format('Customer #%s (%s) is already active with the same ID. Keep using that record; this one stays archived.', d.customer_no, d.full_name);
    end if;
    -- the same person under another record: same first and last name (or the same full name) plus the same phone, birth date or address
    select x.customer_no, x.full_name,
           case when regexp_replace(x.contact_number, '\D', '', 'g') = regexp_replace(c.contact_number, '\D', '', 'g') then 'phone number'
                when x.date_of_birth = c.date_of_birth then 'birth date' else 'address' end as what
      into d from public.customers x
     where x.id <> c.id and x.archived_at is null
       and (lower(regexp_replace(btrim(x.full_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(c.full_name), '\s+', ' ', 'g'))
            or (c.first_name is not null and c.last_name is not null
                and lower(btrim(x.first_name)) = lower(btrim(c.first_name)) and lower(btrim(x.last_name)) = lower(btrim(c.last_name))))
       and (regexp_replace(x.contact_number, '\D', '', 'g') = regexp_replace(c.contact_number, '\D', '', 'g')
            or (x.date_of_birth is not null and x.date_of_birth = c.date_of_birth)
            or (nullif(btrim(x.address), '') is not null and lower(regexp_replace(btrim(x.address), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(c.address), '\s+', ' ', 'g'))))
     limit 1;
    if found then
      return format('Customer #%s (%s) has the same name and %s, so this looks like the same person. This record stays archived; the records are not merged.', d.customer_no, d.full_name, d.what);
    end if;
    if c.archived_by is null then return 'This record was archived by a one-time data cleanup (no staff member is recorded), so there''s no decision to undo here. It stays archived until Matt reviews it.'; end if;
    return null;

  elsif p_table = 'appraisal_items' then
    select * into a from public.appraisal_items where id = p_id;
    if a.customer_id is null then
      return 'This appraisal was made before appraisals needed a customer, so it can''t go back into the pool. Make a new appraisal instead.';
    end if;
    if a.status <> 'available' or exists (select 1 from public.loans x where x.appraisal_item_id = a.id) then
      return 'This appraisal was already used for a loan, so it can''t go back into the pool.';
    end if;
    if a.is_counterfeit_risk and coalesce(a.counterfeit_resolution::text, 'pending') <> 'cleared' then
      return 'This appraisal has an open or confirmed counterfeit flag, so it can''t go back into the pool.';
    end if;
    select * into c from public.customers where id = a.customer_id;
    if c.archived_at is not null then return 'Its customer is archived. Restore the customer first.'; end if;
    if c.is_blacklisted then return 'Its customer is blacklisted, so this appraisal can''t go back into the pool.'; end if;
    select x.appraisal_no into v from public.appraisal_items x
     where x.id <> a.id and x.archived_at is null and x.customer_id = a.customer_id and x.category = a.category
       and x.karat = a.karat and x.weight_grams = a.weight_grams
     limit 1;
    if found then
      return format('Appraisal #%s for the same customer has the same item details (category, karat and weight), so this one looks like a duplicate and stays archived.', v);
    end if;
    if a.archived_by is null then return 'This record was archived by a one-time data cleanup (no staff member is recorded), so there''s no decision to undo here. It stays archived until Matt reviews it.'; end if;
    return null;

  elsif p_table = 'loans' then
    select * into l from public.loans where id = p_id;
    if coalesce(l.archive_reason, '') ~* '^\s*(void|cancel)' then
      return 'This loan was cancelled (VOID). Cancelled loans can''t be restored here; a correction needs a separate approved process that checks the item and the payments.';
    end if;
    if l.status not in ('redeemed', 'forfeited') then
      return 'Only closed loans (redeemed or forfeited) can be restored.';
    end if;
    select * into i from public.inventory_items x where x.id = l.inventory_item_id;
    if not found then
      return 'This loan has no item on record, so it needs a manual review and can''t be restored here.';
    end if;
    if i.archived_at is not null then
      return 'Its item is archived too. A loan and its item can''t be split, so this loan stays archived.';
    end if;
    -- cancellation is recognised from the records themselves, not only from the reason text (fail closed):
    -- every normal redeemed loan was repaid in full (principal payments = principal + any capitalized amount)
    if l.status = 'redeemed' and
       (select coalesce(sum(p.principal_portion), 0) from public.loan_payments p where p.loan_id = l.id)
       <> l.principal_amount + (select coalesce(sum(e.capitalized_amount), 0) from public.loan_extensions e where e.loan_id = l.id) then
      return 'This loan was closed without the payments that would repay it (for example a cancelled ticket), so it needs a manual review and can''t be restored here.';
    end if;
    if (l.status = 'redeemed' and i.status::text <> 'redeemed')
       or (l.status = 'forfeited' and i.status::text not in ('forfeited', 'queued_for_auction', 'sold')) then
      return 'The loan and its item don''t agree (the item''s status doesn''t match the loan), so it needs a manual review and can''t be restored here.';
    end if;
    if exists (select 1 from public.customers x where x.id = l.customer_id and x.archived_at is not null) then
      return 'Its customer is archived. Restore the customer first.';
    end if;
    if l.archived_by is null then return 'This record was archived by a one-time data cleanup (no staff member is recorded), so there''s no decision to undo here. It stays archived until Matt reviews it.'; end if;
    return null;

  elsif p_table = 'inventory_items' then
    select * into i from public.inventory_items where id = p_id;
    if i.status::text not in ('redeemed', 'sold') then
      return format('This item''s status is "%s", so restoring it would show it as stored in the vault. That needs an approved custody check.', replace(i.status::text, '_', ' '));
    end if;
    select x.ticket_number, x.archived_at into l from public.loans x where x.inventory_item_id = i.id order by x.created_at desc limit 1;
    if found and l.archived_at is not null then
      return format('Its loan %s is archived, so the item stays archived with it.', l.ticket_number);
    end if;
    if i.archived_by is null then return 'This record was archived by a one-time data cleanup (no staff member is recorded), so there''s no decision to undo here. It stays archived until Matt reviews it.'; end if;
    return null;

  elsif p_table = 'suspicious_activity_flags' then
    select * into f from public.suspicious_activity_flags where id = p_id;
    if f.status in ('open', 'investigating') then
      return 'An undecided flag can''t be restored here. Raise a new flag if it''s still needed.';
    end if;
    if f.archived_by is null then return 'This record was archived by a one-time data cleanup (no staff member is recorded), so there''s no decision to undo here. It stays archived until Matt reviews it.'; end if;
    return null;
  end if;

  return 'Records of this type can''t be restored.';
end $$;
revoke all on function public.ctm_restore_blocker(text, uuid) from public, anon, authenticated;

-- 3. Archive ---------------------------------------------------------------------------------------------------------
create or replace function public.archive_record(p_table text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.staff_role; v_status text; v_open integer; v_reason text := public.ctm_clean_note(p_reason);
  v_id uuid; v_at timestamptz; n integer;
begin
  r := public.ctm_assert_role(array['appraiser']::public.staff_role[]);
  if v_reason is null or char_length(v_reason) < 3 then raise exception 'Write a short reason for archiving.'; end if;
  if p_table in ('loan_payments', 'loan_extensions', 'reminder_log') then
    raise exception 'Payments, renewals and reminders are permanent history. They can''t be archived or restored.';
  elsif p_table = 'inventory_items' then
    raise exception 'Inventory items can''t be archived. Their custody is tracked through loans, audits and auctions.';
  elsif p_table = 'auction_batches' then
    raise exception 'Auction batches can''t be archived here.';
  elsif p_table = 'physical_inventory_audits' then
    raise exception 'Vault audits are set aside with Discard draft on the Physical audit page, not archived here.';
  elsif p_table = 'suspicious_activity_flags' then
    raise exception 'Suspicious-activity flags are compliance history and can''t be archived.';
  elsif p_table not in ('customers', 'appraisal_items', 'loans', 'cash_flow_entries') then
    raise exception 'Records of this type can''t be archived.';
  end if;
  if r <> 'admin' and p_table <> 'appraisal_items' then raise exception 'Only an Admin can archive this record.' using errcode = '42501'; end if;

  -- lock the row first, so two people can't archive it at the same time and the checks see the current state
  execute format('select id, archived_at from public.%I where id = $1 for update', p_table) into v_id, v_at using p_id;
  if v_id is null then raise exception 'This record no longer exists. Reload the page.'; end if;
  if v_at is not null then raise exception 'This record is already archived (maybe by someone else just now). Reload the page.'; end if;

  if p_table = 'appraisal_items' then
    select status::text into v_status from public.appraisal_items where id = p_id;
    if v_status is distinct from 'available' then raise exception 'Only items still in the appraisal pool can be archived.'; end if;
  elsif p_table = 'loans' then
    select status::text into v_status from public.loans where id = p_id;
    if v_status not in ('redeemed','forfeited') then raise exception 'Only closed loans (redeemed or forfeited) can be archived.'; end if;
  elsif p_table = 'customers' then
    select count(*) into v_open from public.loans where customer_id = p_id and status in ('active','extended','reinstated','defaulted');
    if v_open > 0 then raise exception 'This customer has open loans and cannot be archived.'; end if;
  elsif p_table = 'cash_flow_entries' then
    if public.ctm_ledger_locked() then raise exception 'Correcting, archiving and restoring ledger entries is switched off for now, for every role, until a reversal workflow is approved. Nothing was changed.'; end if;
    if exists (select 1 from public.cash_flow_entries c where c.id = p_id and (c.related_loan_id is not null or c.entry_type not in ('expense', 'revenue') or c.is_memo)) then
      raise exception 'Only a manual Expense or Revenue entry can be archived. An entry made by a loan, a payment or a sale is corrected from that loan.';
    end if;
  end if;

  perform set_config('ctm.system', 'on', true);
  execute format('update public.%I set archived_at = now(), archived_by = $1, archive_reason = $2 where id = $3 and archived_at is null', p_table)
    using auth.uid(), v_reason, p_id;
  get diagnostics n = row_count; -- EXECUTE doesn't set FOUND, so count the rows
  perform set_config('ctm.system', 'off', true);
  if n <> 1 then raise exception 'This record changed while you were archiving it. Reload the page.'; end if;

  insert into public.archive_events (table_name, record_id, action, reason, actor)
  values (p_table, p_id, 'archived', v_reason, auth.uid());
end $$;

-- 4. Restore (with a reason) -----------------------------------------------------------------------------------------
create or replace function public.restore_record(p_table text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_reason text := public.ctm_clean_note(p_reason); v_id uuid; v_at timestamptz; v_by uuid; v_why text; v_block text; n integer;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- an active Admin only (0084)
  if p_table not in ('customers','appraisal_items','loans','loan_payments','loan_extensions','inventory_items','cash_flow_entries',
                     'auction_batches','physical_inventory_audits','suspicious_activity_flags','reminder_log') then
    raise exception 'Records of this type can''t be restored.';
  end if;
  if not public.ctm_flag_reason_ok(v_reason) then
    raise exception 'Write the reason for restoring (at least 10 characters).' using errcode = '23514';
  end if;

  execute format('select id, archived_at, archived_by, archive_reason from public.%I where id = $1 for update', p_table)
    into v_id, v_at, v_by, v_why using p_id;
  if v_id is null then raise exception 'This record no longer exists. Reload the page.'; end if;
  if v_at is null then raise exception 'This record isn''t archived any more (maybe another Admin restored it just now). Reload the page.'; end if;

  v_block := public.ctm_restore_blocker(p_table, p_id);
  if v_block is not null then raise exception '%', v_block; end if;

  begin
    perform set_config('ctm.system', 'on', true);
    execute format('update public.%I set archived_at = null, archived_by = null, archive_reason = null where id = $1 and archived_at is not null', p_table)
      using p_id;
    get diagnostics n = row_count;
    perform set_config('ctm.system', 'off', true);
  exception when unique_violation then
    perform set_config('ctm.system', 'off', true);
    raise exception 'Another active record already uses the same details (for example the same ID), so this one stays archived. Nothing was changed.';
  end;
  if n <> 1 then raise exception 'This record changed while you were restoring it. Reload the page.'; end if;

  insert into public.archive_events (table_name, record_id, action, reason, actor, original_archived_at, original_archived_by, original_archive_reason)
  values (p_table, p_id, 'restored', v_reason, auth.uid(), v_at, v_by, v_why);
end $$;
revoke all on function public.restore_record(text, uuid, text) from public, anon;
grant execute on function public.restore_record(text, uuid, text) to authenticated;

-- the old call without a reason: same role and ledger checks as before, then it asks for a reason
create or replace function public.restore_record(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if p_table = 'cash_flow_entries' and public.ctm_ledger_locked() then raise exception 'Correcting, archiving and restoring ledger entries is switched off for now, for every role, until a reversal workflow is approved. Nothing was changed.'; end if;
  raise exception 'Restoring now needs a written reason. Reload the page and try again. Nothing was changed.';
end $$;

-- 5. Can this record be restored? (for the Review dialog) ------------------------------------------------------------
create or replace function public.archive_restore_check(p_table text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid; v_at timestamptz; v_block text;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if p_table not in ('customers','appraisal_items','loans','loan_payments','loan_extensions','inventory_items','cash_flow_entries',
                     'auction_batches','physical_inventory_audits','suspicious_activity_flags','reminder_log') then
    return jsonb_build_object('exists', false, 'archived', false, 'can_restore', false, 'reason', 'Records of this type can''t be restored.');
  end if;
  execute format('select id, archived_at from public.%I where id = $1', p_table) into v_id, v_at using p_id;
  if v_id is null then
    return jsonb_build_object('exists', false, 'archived', false, 'can_restore', false, 'reason', 'This record no longer exists.');
  end if;
  if v_at is null then
    return jsonb_build_object('exists', true, 'archived', false, 'can_restore', false, 'reason', 'This record isn''t archived.');
  end if;
  v_block := public.ctm_restore_blocker(p_table, p_id);
  return jsonb_build_object('exists', true, 'archived', true, 'can_restore', v_block is null, 'reason', v_block);
end $$;
revoke all on function public.archive_restore_check(text, uuid) from public, anon;
grant execute on function public.archive_restore_check(text, uuid) to authenticated;

-- 6. Self-test -------------------------------------------------------------------------------------------------------
create or replace function public.ctm_selftest_0085() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  adm uuid; adm2 uuid; csh uuid; opr uuid; apr uuid;
  s text; e text; x uuid; y uuid; n int; n2 int; j jsonb;
  fp0 text; fp1 text; ev0 int; ev1 int;
  a_void uuid[]; a_item uuid[]; a_batch uuid[]; a_audit uuid[]; a_appr uuid[]; a_cust uuid[]; ok boolean;
begin
  select id into adm from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id into adm2 from profiles where role = 'admin' and is_active and id <> adm order by created_at limit 1;
  select id into csh from profiles where role = 'cashier' and is_active order by created_at limit 1;
  select id into opr from profiles where role = 'operator' and is_active order by created_at limit 1;
  select id into apr from profiles where role = 'appraiser' and is_active order by created_at limit 1;
  -- fingerprint of everything an archive or restore could touch, plus money
  select md5(string_agg(k, '|' order by k)) into fp0 from (
    select 'c' || id || coalesce(archived_at::text, '') k from customers union all select 'a' || id || coalesce(archived_at::text, '') from appraisal_items
    union all select 'l' || id || coalesce(archived_at::text, '') || principal_balance || interest_owed || status from loans
    union all select 'p' || id || coalesce(archived_at::text, '') || amount from loan_payments union all select 'x' || id || coalesce(archived_at::text, '') from loan_extensions
    union all select 'i' || id || coalesce(archived_at::text, '') || status from inventory_items union all select 'f' || id || coalesce(archived_at::text, '') || amount from cash_flow_entries
    union all select 'b' || id || coalesce(archived_at::text, '') from auction_batches union all select 'u' || id || coalesce(archived_at::text, '') || status from physical_inventory_audits
    union all select 's' || id || coalesce(archived_at::text, '') || status from suspicious_activity_flags union all select 'r' || id || coalesce(archived_at::text, '') from reminder_log) q;
  select count(*) into ev0 from archive_events;

  test := 'Archive is refused for payments, renewals, reminders, inventory items, auction batches, vault audits and suspicious flags (even for an Admin); customers with open loans and open loans are refused too';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    s := '';
    begin perform archive_record('loan_payments', (select id from loan_payments where archived_at is null limit 1), 'TEST reason'); s := s || 'P!'; exception when others then s := s || case when sqlerrm like 'Payments, renewals and reminders%' then 'p' else 'P?' end; end;
    begin perform archive_record('loan_extensions', (select id from loan_extensions where archived_at is null limit 1), 'TEST reason'); s := s || 'X!'; exception when others then s := s || case when sqlerrm like 'Payments, renewals and reminders%' then 'x' else 'X?' end; end;
    begin perform archive_record('reminder_log', (select id from reminder_log where archived_at is null limit 1), 'TEST reason'); s := s || 'R!'; exception when others then s := s || case when sqlerrm like 'Payments, renewals and reminders%' then 'r' else 'R?' end; end;
    begin perform archive_record('inventory_items', (select id from inventory_items where status = 'pawned' and archived_at is null limit 1), 'TEST reason'); s := s || 'I!'; exception when others then s := s || case when sqlerrm like 'Inventory items can''t be archived%' then 'i' else 'I?' end; end;
    begin perform archive_record('auction_batches', (select id from auction_batches where archived_at is null limit 1), 'TEST reason'); s := s || 'B!'; exception when others then s := s || case when sqlerrm like 'Auction batches can''t%' then 'b' else 'B?' end; end;
    begin perform archive_record('physical_inventory_audits', (select id from physical_inventory_audits where archived_at is null limit 1), 'TEST reason'); s := s || 'U!'; exception when others then s := s || case when sqlerrm like 'Vault audits are set aside%' then 'u' else 'U?' end; end;
    begin perform archive_record('suspicious_activity_flags', (select id from suspicious_activity_flags where archived_at is null limit 1), 'TEST reason'); s := s || 'S!'; exception when others then s := s || case when sqlerrm like 'Suspicious-activity flags are compliance%' then 's' else 'S?' end; end;
    begin perform archive_record('loans', (select id from loans where status = 'active' and archived_at is null limit 1), 'TEST reason'); s := s || 'L!'; exception when others then s := s || case when sqlerrm like 'Only closed loans%' then 'l' else 'L?' end; end;
    begin perform archive_record('customers', (select customer_id from loans where status = 'active' and archived_at is null limit 1), 'TEST reason'); s := s || 'C!'; exception when others then s := s || case when sqlerrm like '%has open loans%' then 'c' else 'C?' end; end;
    execute 'reset role';
    outcome := case when s = 'pxribuslc' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Restore is refused, with a plain reason, for VOID loans, items of VOID loans, auction batches, vault audits, appraisals without a customer, duplicate customers (same ID; same person; archived as a duplicate; archived by a data cleanup), and cash entries';
  begin
    -- pick the records first (staff can't read ID numbers directly)
    select coalesce(array_agg(id), '{}') into a_void from loans where archived_at is not null and archive_reason ~* '^\s*void';
    select coalesce(array_agg(i.id), '{}') into a_item from loans l join inventory_items i on i.id = l.inventory_item_id where l.id = any (a_void) and i.archived_at is not null;
    select coalesce(array_agg(id), '{}') into a_batch from auction_batches where archived_at is not null;
    select coalesce(array_agg(id), '{}') into a_audit from (select id from physical_inventory_audits where archived_at is not null limit 3) q;
    select coalesce(array_agg(id), '{}') into a_appr from appraisal_items where archived_at is not null and customer_id is null;
    select coalesce(array_agg(c.id), '{}') into a_cust from customers c where c.archived_at is not null and public.ctm_restore_blocker('customers', c.id) is not null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    s := '';
    foreach x in array a_void loop
      begin perform restore_record('loans', x, 'TEST restore for the self-test'); s := s || 'L!'; exception when others then s := s || case when sqlerrm like 'This loan was cancelled (VOID)%' then 'l' else 'L?' end; end;
    end loop;
    foreach x in array a_item loop
      begin perform restore_record('inventory_items', x, 'TEST restore for the self-test'); s := s || 'I!'; exception when others then s := s || case when sqlerrm like 'Its loan % is archived%' or sqlerrm like 'This item''s status is%' then 'i' else 'I?' end; end;
    end loop;
    foreach x in array a_batch loop
      begin perform restore_record('auction_batches', x, 'TEST restore for the self-test'); s := s || 'B!'; exception when others then s := s || case when sqlerrm like 'Archived auction batches stay archived%' then 'b' else 'B?' end; end;
    end loop;
    foreach x in array a_audit loop
      begin perform restore_record('physical_inventory_audits', x, 'TEST restore for the self-test'); s := s || 'U!'; exception when others then s := s || case when sqlerrm like 'Archived vault audits stay%' then 'u' else 'U?' end; end;
    end loop;
    foreach x in array a_appr loop
      begin perform restore_record('appraisal_items', x, 'TEST restore for the self-test'); s := s || 'A!'; exception when others then s := s || case when sqlerrm like 'This appraisal was made before%' then 'a' else 'A?' end; end;
    end loop;
    foreach x in array a_cust loop
      begin perform restore_record('customers', x, 'TEST restore for the self-test'); s := s || 'D!';
      exception when others then s := s || case when sqlerrm like '%already active with the same ID%' or sqlerrm like '%looks like the same person%' or sqlerrm like '%archived as a duplicate%' or sqlerrm like '%one-time data cleanup%' then 'd' else 'D?' end; end;
    end loop;
    begin perform restore_record('cash_flow_entries', (select id from cash_flow_entries limit 1), 'TEST restore for the self-test'); s := s || 'F!'; exception when others then s := s || case when sqlerrm like '%switched off for now%' or sqlerrm like '%isn''t archived%' then 'f' else 'F?' end; end;
    execute 'reset role';
    outcome := case when s !~ '[A-Z]' and s <> '' then 'PASS (' || s || ')' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Allowed case: an Admin archives a customer with no loans and restores it with a reason; the history keeps both events with the Admin as actor, and the restore event keeps the original archive date, actor and reason';
  begin
    select c.id into x from customers c where c.archived_at is null and not exists (select 1 from loans l where l.customer_id = c.id) order by c.created_at limit 1;
    if x is null then outcome := 'SKIP (no customer without loans)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform archive_record('customers', x, 'TEST archived for the self-test');
    perform restore_record('customers', x, 'TEST restored for the self-test');
    execute 'reset role';
    select count(*) into n from archive_events where table_name = 'customers' and record_id = x and actor = adm and source = 'app';
    select (archived_at is null)::text into s from customers where id = x;
    select original_archive_reason || '|' || (original_archived_by = adm) || '|' || (original_archived_at is not null) into e
      from archive_events where table_name = 'customers' and record_id = x and action = 'restored';
    outcome := case when n = 2 and s = 'true' and e = 'TEST archived for the self-test|true|true' then 'PASS' else 'FAIL ' || n || ' ' || s || ' ' || coalesce(e, '-') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Accurate answers: a second restore says it isn''t archived any more, a missing record says it no longer exists, archiving twice says already archived, a short restore reason is refused, and the old two-argument restore asks for a reason';
  begin
    select c.id into x from customers c where c.archived_at is null and not exists (select 1 from loans l where l.customer_id = c.id) order by c.created_at limit 1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform archive_record('customers', x, 'TEST archived for the self-test');
    s := '';
    begin perform archive_record('customers', x, 'TEST again'); s := s || 'A!'; exception when others then s := s || case when sqlerrm like 'This record is already archived%' then 'a' else 'A?' end; end;
    begin perform restore_record('customers', x, 'short'); s := s || 'S!'; exception when others then s := s || case when sqlerrm like 'Write the reason for restoring%' then 's' else 'S?' end; end;
    begin perform restore_record('customers', x); s := s || 'O!'; exception when others then s := s || case when sqlerrm like 'Restoring now needs a written reason%' then 'o' else 'O?' end; end;
    perform restore_record('customers', x, 'TEST restored for the self-test');
    begin perform restore_record('customers', x, 'TEST restored for the self-test'); s := s || 'T!'; exception when others then s := s || case when sqlerrm like 'This record isn''t archived any more%' then 't' else 'T?' end; end;
    begin perform restore_record('customers', gen_random_uuid(), 'TEST restored for the self-test'); s := s || 'M!'; exception when others then s := s || case when sqlerrm like 'This record no longer exists%' then 'm' else 'M?' end; end;
    begin perform archive_record('customers', gen_random_uuid(), 'TEST reason'); s := s || 'N!'; exception when others then s := s || case when sqlerrm like 'This record no longer exists%' then 'n' else 'N?' end; end;
    execute 'reset role';
    outcome := case when s = 'asotmn' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Roles: Cashier, Operator and Appraiser can''t restore or call the check; an Appraiser can''t archive a loan; a switched-off Admin is refused (0084)';
  begin
    select id into x from customers where archived_at is not null limit 1;
    execute 'set local role authenticated';
    s := '';
    foreach y in array array[csh, opr, apr] loop
      perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
      begin perform restore_record('customers', x, 'TEST restored for the self-test'); s := s || 'R!'; exception when others then s := s || case when sqlerrm like 'Your role%' then 'r' else 'R?' end; end;
      begin perform archive_restore_check('customers', x); s := s || 'C!'; exception when others then s := s || case when sqlerrm like 'Your role%' then 'c' else 'C?' end; end;
    end loop;
    perform set_config('request.jwt.claims', json_build_object('sub', apr, 'role', 'authenticated')::text, true);
    begin perform archive_record('loans', (select id from loans where status = 'redeemed' and archived_at is null limit 1), 'TEST reason'); s := s || 'L!'; exception when others then s := s || case when sqlerrm like 'Only an Admin%' then 'l' else 'L?' end; end;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', adm2, 'role', 'authenticated')::text, true);
    update profiles set is_active = false where id = adm;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin perform restore_record('customers', x, 'TEST restored for the self-test'); s := s || 'D!'; exception when others then s := s || case when sqlerrm like 'Not signed in, or the account is inactive%' then 'd' else 'D?' end; end;
    execute 'reset role';
    outcome := case when s = 'rcrcrcld' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'History can''t be changed or deleted, not even by the database owner; staff other than Admins can''t read it';
  begin
    s := '';
    begin update archive_events set reason = 'changed' where id = (select id from archive_events limit 1); s := s || 'U!'; exception when others then s := s || case when sqlerrm like 'Archive history can''t be changed%' then 'u' else 'U?' end; end;
    begin execute 'de' || 'lete from archive_events where id = $1' using (select id from archive_events limit 1); s := s || 'D!'; exception when others then s := s || case when sqlerrm like 'Archive history can''t be changed%' then 'd' else 'D?' end; end;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', csh, 'role', 'authenticated')::text, true);
    select count(*) into n from archive_events;
    execute 'reset role';
    outcome := case when s = 'ud' and n = 0 then 'PASS' else 'FAIL ' || s || ' cashier sees ' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'The check function gives the same answer as restore_record (Admin): VOID loan not restorable with the reason; an archived restorable customer is restorable';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    j := archive_restore_check('loans', (select id from loans where archived_at is not null and archive_reason ~* '^\s*void' limit 1));
    s := (j->>'can_restore') || '|' || left(j->>'reason', 30);
    select c.id into x from customers c where c.archived_at is null and not exists (select 1 from loans l where l.customer_id = c.id) order by c.created_at limit 1;
    perform archive_record('customers', x, 'TEST archived for the self-test');
    j := archive_restore_check('customers', x);
    s := s || '|' || (j->>'can_restore');
    execute 'reset role';
    outcome := case when s = 'false|This loan was cancelled (VOID)|true' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Cancelled loans are recognised from the records, not only the words: a VOID loan with its reason text changed is still refused (closed without repaying payments)';
  begin
    select id into x from loans where archived_at is not null and archive_reason ~* '^\s*void' limit 1;
    if x is null then outcome := 'SKIP (no VOID loan)'; raise exception 'ROLLBACK'; end if;
    perform set_config('ctm.system', 'on', true);
    update loans set archive_reason = 'Tidy-up of old closed tickets' where id = x;
    update inventory_items set archived_at = null where id = (select inventory_item_id from loans where id = x); -- even with its item visible
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    j := archive_restore_check('loans', x);
    begin perform restore_record('loans', x, 'TEST restore for the self-test'); s := 'RESTORED'; exception when others then s := 'refused'; end;
    execute 'reset role';
    outcome := case when (j->>'can_restore') = 'false' and j->>'reason' like 'This loan was closed without the payments%' and s = 'refused' then 'PASS' else 'FAIL ' || s || ' ' || coalesce(j->>'reason', '-') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Records archived by a one-time data cleanup (no staff member recorded) are never restored here, even when nothing else blocks them';
  begin
    select coalesce(array_agg(c.id), '{}') into a_cust from customers c where c.archived_at is not null and c.archived_by is null;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    s := ''; n := 0;
    foreach x in array a_cust loop
      j := archive_restore_check('customers', x);
      if (j->>'can_restore')::boolean then s := s || 'R!'; else s := s || 'r'; end if;
      if j->>'reason' like 'This record was archived by a one-time data cleanup%' then n := n + 1; end if;
    end loop;
    execute 'reset role';
    outcome := case when cardinality(a_cust) = 0 then 'SKIP (none archived by a data cleanup)' when s !~ '!' and n > 0 then 'PASS (' || cardinality(a_cust) || ' refused, ' || n || ' for the cleanup reason)' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Restoring a redeemed item only clears the archive mark: its status, its appraisal, its status history, the auction list and the cash and loan reports are exactly as before it was archived';
  begin
    select i.id into x from inventory_items i join loans l on l.inventory_item_id = i.id
     where i.status = 'redeemed' and i.archived_at is null and l.archived_at is null order by i.created_at limit 1;
    if x is null then outcome := 'SKIP (no redeemed item)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    e := (select i.status::text || '|' || a.status::text || '|' || (select count(*) from inventory_status_history h where h.inventory_item_id = i.id)
            from inventory_items i left join appraisal_items a on a.id = i.appraisal_item_id where i.id = x)
         || '|' || md5(auction_prepare_list()::text) || '|' || md5(report_cash_breakdown('2000-01-01', '2100-01-01')::text) || '|' || md5(report_loan_analytics()::text)
         || '|' || (select count(*) from appraisal_items where status = 'available' and archived_at is null)
         || '|' || (select string_agg(status::text || count, ',' order by status) from (select status, count(*) from inventory_items where archived_at is null group by status) q);
    execute 'reset role';
    perform set_config('ctm.system', 'on', true);
    update inventory_items set archived_at = now(), archived_by = adm, archive_reason = 'TEST archived for the self-test' where id = x;
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform restore_record('inventory_items', x, 'TEST restore for the self-test');
    s := (select i.status::text || '|' || a.status::text || '|' || (select count(*) from inventory_status_history h where h.inventory_item_id = i.id)
            from inventory_items i left join appraisal_items a on a.id = i.appraisal_item_id where i.id = x)
         || '|' || md5(auction_prepare_list()::text) || '|' || md5(report_cash_breakdown('2000-01-01', '2100-01-01')::text) || '|' || md5(report_loan_analytics()::text)
         || '|' || (select count(*) from appraisal_items where status = 'available' and archived_at is null)
         || '|' || (select string_agg(status::text || count, ',' order by status) from (select status, count(*) from inventory_items where archived_at is null group by status) q);
    execute 'reset role';
    outcome := case when s = e and e like 'redeemed|pawned|%' then 'PASS' else 'FAIL before=' || left(e, 60) || ' after=' || left(s, 60) end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Each restore is its own history row: archive, restore, archive again, restore again = 4 rows by the signed-in Admin, and each restore row keeps the archive it undid';
  begin
    select c.id into x from customers c where c.archived_at is null and not exists (select 1 from loans l where l.customer_id = c.id) order by c.created_at limit 1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform archive_record('customers', x, 'TEST first archive');
    perform restore_record('customers', x, 'TEST first restore for the self-test');
    perform archive_record('customers', x, 'TEST second archive');
    perform restore_record('customers', x, 'TEST second restore for the self-test');
    execute 'reset role';
    select count(*), string_agg(coalesce(original_archive_reason, '-'), ',' order by original_archive_reason) filter (where action = 'restored'), bool_and(actor = adm)
      into n, s, ok from archive_events where record_id = x and source = 'app';
    outcome := case when n = 4 and s = 'TEST first archive,TEST second archive' and ok then 'PASS' else 'FAIL ' || n || ' ' || coalesce(s, '-') end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Nothing outside the tests changed (archive state of all 11 types, loan balances, payments, ledger amounts, item and audit statuses, archive history)';
  select md5(string_agg(k, '|' order by k)) into fp1 from (
    select 'c' || id || coalesce(archived_at::text, '') k from customers union all select 'a' || id || coalesce(archived_at::text, '') from appraisal_items
    union all select 'l' || id || coalesce(archived_at::text, '') || principal_balance || interest_owed || status from loans
    union all select 'p' || id || coalesce(archived_at::text, '') || amount from loan_payments union all select 'x' || id || coalesce(archived_at::text, '') from loan_extensions
    union all select 'i' || id || coalesce(archived_at::text, '') || status from inventory_items union all select 'f' || id || coalesce(archived_at::text, '') || amount from cash_flow_entries
    union all select 'b' || id || coalesce(archived_at::text, '') from auction_batches union all select 'u' || id || coalesce(archived_at::text, '') || status from physical_inventory_audits
    union all select 's' || id || coalesce(archived_at::text, '') || status from suspicious_activity_flags union all select 'r' || id || coalesce(archived_at::text, '') from reminder_log) q;
  select count(*) into ev1 from archive_events;
  outcome := case when fp0 = fp1 and ev0 = ev1 then 'PASS' else 'FAIL same=' || (fp0 = fp1)::text || ' events+' || (ev1 - ev0) end;
  return next;
end $$;
revoke all on function public.ctm_selftest_0085() from public, anon, authenticated;
