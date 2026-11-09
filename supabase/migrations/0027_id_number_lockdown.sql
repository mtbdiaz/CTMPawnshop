-- #17 + #19: full customer ID numbers can no longer be read through the API with a staff login.
-- The app reads them only on the server (service role, after its own role check), and a staff member
-- who presses "reveal" goes through reveal_customer_id(), which writes a VIEW row to the audit trail.
-- NOTE: a new column added to customers later must be granted to authenticated here, or it is unreadable.

revoke select on public.customers from anon, authenticated;
grant select (id, full_name, address, contact_number, email, date_of_birth, id_type,
              aml_status, aml_checked_at, aml_notes, is_blacklisted, blacklist_reason,
              created_by, created_at, updated_at, archived_at, archived_by, archive_reason, is_demo)
  on public.customers to authenticated;

-- the audit trail can now also record that someone looked at a full ID
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action = any (array['INSERT', 'UPDATE', 'DELETE', 'VIEW']));

create or replace function public.reveal_customer_id(p_customer_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare v_id text;
begin
  perform public.ctm_assert_role(array['operator', 'cashier']::public.staff_role[]); -- Admin always passes
  select id_number into v_id from public.customers where id = p_customer_id;
  if v_id is null then raise exception 'Customer not found.'; end if;
  insert into public.audit_log (table_name, record_id, action, actor, changed_data)
  values ('customers', p_customer_id::text, 'VIEW', auth.uid(), jsonb_build_object('field', 'id_number', 'reason', 'ID revealed on screen'));
  return v_id;
end $function$;

revoke execute on function public.reveal_customer_id(uuid) from public, anon;
grant execute on function public.reveal_customer_id(uuid) to authenticated;
