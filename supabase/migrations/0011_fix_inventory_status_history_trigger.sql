create or replace function public.log_inventory_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') or (old.status is distinct from new.status) then
    insert into public.inventory_status_history (inventory_item_id, old_status, new_status)
    values (new.id, case when tg_op = 'INSERT' then null else old.status end, new.status);
  end if;
  return new;
end;
$$;

revoke execute on function public.log_inventory_status_change() from public;
