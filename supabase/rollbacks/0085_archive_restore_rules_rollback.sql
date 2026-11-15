-- Rollback for 0085 (only if 0085 has to be undone). Puts archive_record() and restore_record(table, id) back exactly
-- as they were before 0085 (copied from the live database on Nov 15, 2026) and removes the new functions.
-- archive_events is KEPT on purpose: it is history and must not be deleted. It simply stops getting new rows.
-- Run as one transaction.
begin;

drop function if exists public.ctm_selftest_0085();
drop function if exists public.archive_restore_check(text, uuid);
drop function if exists public.restore_record(text, uuid, text);
drop function if exists public.ctm_restore_blocker(text, uuid);

CREATE OR REPLACE FUNCTION public.archive_record(p_table text, p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.staff_role; v_status text; v_open integer;
begin
  r := public.ctm_assert_role(array['appraiser']::public.staff_role[]);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to archive a record.'; end if;
  if p_table not in ('customers','appraisal_items','loans','loan_payments','loan_extensions','inventory_items','cash_flow_entries','auction_batches','physical_inventory_audits','suspicious_activity_flags','reminder_log') then
    raise exception 'Records of type % cannot be archived', p_table;
  end if;
  if r <> 'admin' and p_table <> 'appraisal_items' then raise exception 'Only an Admin can archive this record.' using errcode = '42501'; end if;
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
  execute format('update public.%I set archived_at = now(), archived_by = $1, archive_reason = $2 where id = $3 and archived_at is null', p_table) using auth.uid(), trim(p_reason), p_id;
  if not found then raise exception 'Record not found or already archived'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_record(p_table text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]);
  if p_table not in ('customers','appraisal_items','loans','loan_payments','loan_extensions','inventory_items','cash_flow_entries','auction_batches','physical_inventory_audits','suspicious_activity_flags','reminder_log') then
    raise exception 'Records of type % cannot be restored', p_table;
  end if;
  if p_table = 'cash_flow_entries' and public.ctm_ledger_locked() then raise exception 'Correcting, archiving and restoring ledger entries is switched off for now, for every role, until a reversal workflow is approved. Nothing was changed.'; end if;
  perform set_config('ctm.system', 'on', true);
  execute format('update public.%I set archived_at = null, archived_by = null, archive_reason = null where id = $1 and archived_at is not null', p_table) using p_id;
  if not found then raise exception 'Record not found or not archived'; end if;
end $function$;

commit;
