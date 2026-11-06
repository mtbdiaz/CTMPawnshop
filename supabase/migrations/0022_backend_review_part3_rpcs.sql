-- Backend review #5: the physical audit and the auction batch are each one database call
-- (all rows saved together or none). Only items an Admin has forfeited can go to auction.
create or replace function public.create_auction_batch(p_item_ids uuid[], p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_batch uuid; v_bad int;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  if p_item_ids is null or array_length(p_item_ids, 1) is null then raise exception 'Select at least one forfeited item'; end if;
  select count(*) into v_bad from unnest(p_item_ids) x(id)
  where not exists (select 1 from public.inventory_items i join public.loans l on l.inventory_item_id = i.id
                    where i.id = x.id and i.status = 'forfeited' and l.status = 'forfeited' and i.archived_at is null);
  if v_bad > 0 then raise exception '% of the selected items are not forfeited by an Admin and cannot go to auction', v_bad; end if;
  perform set_config('ctm.system', 'on', true);
  insert into public.auction_batches (created_by, notes) values (auth.uid(), nullif(trim(p_notes), '')) returning id into v_batch;
  insert into public.auction_batch_items (batch_id, inventory_item_id) select v_batch, x.id from (select distinct unnest(p_item_ids) id) x;
  update public.inventory_items set status = 'queued_for_auction' where id = any (p_item_ids);
  return v_batch;
end $$;

create or replace function public.submit_inventory_audit(p_items jsonb, p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_audit uuid; v_disc int;
begin
  perform public.ctm_assert_role(array['operator']::public.staff_role[]);
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'No inventory items to audit'; end if;
  select count(*) into v_disc from jsonb_array_elements(p_items) e where not coalesce((e->>'found')::boolean, false);
  insert into public.physical_inventory_audits (performed_by, notes, discrepancy_count) values (auth.uid(), nullif(trim(p_notes), ''), v_disc) returning id into v_audit;
  insert into public.physical_inventory_audit_items (audit_id, inventory_item_id, expected_status, found, notes)
  select v_audit, (e->>'inventory_item_id')::uuid, (e->>'expected_status')::public.inventory_status, coalesce((e->>'found')::boolean, false), nullif(e->>'notes', '')
  from jsonb_array_elements(p_items) e;
  return v_audit;
end $$;

grant execute on function public.create_auction_batch(uuid[], text) to authenticated;
grant execute on function public.submit_inventory_audit(jsonb, text) to authenticated;
