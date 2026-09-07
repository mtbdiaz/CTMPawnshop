-- PB-31 QA fix (part 3 finance/compliance/reporting audit pass):
-- 5 business tables were missing from the original audit_log trigger
-- rollout in 0008_compliance.sql — inventory_status_history,
-- physical_inventory_audit_items, auction_batch_items,
-- suspicious_activity_flags, and reminder_log never got an
-- insert/update/delete trigger, so activity on them was never recorded in
-- audit_log even though every other business table was covered from
-- Sprint 8 onward. CLAUDE.md requires PB-31 to be a shared logging utility
-- used by every table, so this closes the gap.
do $$
declare
  t text;
begin
  foreach t in array array[
    'inventory_status_history',
    'physical_inventory_audit_items',
    'auction_batch_items',
    'suspicious_activity_flags',
    'reminder_log'
  ]
  loop
    if not exists (
      select 1 from information_schema.triggers
      where event_object_table = t and trigger_name = t || '_audit'
    ) then
      execute format(
        'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger_fn();',
        t, t
      );
    end if;
  end loop;
end $$;
