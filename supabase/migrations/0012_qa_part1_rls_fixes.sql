-- QA pass (PB-1..PB-16 audit): close two RLS gaps where the UI/server-action
-- layer restricted an operation to a narrower role than the underlying RLS
-- policy actually allowed — meaning a client could bypass the app's guard by
-- calling PostgREST/Supabase directly with a valid session for the broader
-- role. RLS is the real enforcement per project rules; UI/action gating is
-- cosmetic only.

-- PB-16: "Resolve Counterfeit Flag" is an Admin-only action (confirmed by
-- resolveCounterfeitFlag's requireRole(["admin"]) and the AC), but the
-- existing update policy also allowed 'appraiser' to update appraisal_items
-- (needed historically only for the initial create flow, which is an
-- INSERT, not an UPDATE). Appraisers never update an appraisal row after
-- creation anywhere in the app — tighten UPDATE to admin only.
drop policy if exists "appraisal_items: appraiser or admin can update" on public.appraisal_items;

create policy "appraisal_items: admin can update"
  on public.appraisal_items for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- PB-11: blacklist toggle is Admin-only (setBlacklistStatus's
-- requireRole(["admin"])), but customers UPDATE is granted to
-- operator+admin (needed for PB-9 profile edits). Since RLS is row-level,
-- not column-level, an operator session could otherwise call
-- `.update({ is_blacklisted, blacklist_reason })` directly and bypass the
-- admin-only guard. Enforce column-level restriction with a trigger: only
-- an admin may change is_blacklisted/blacklist_reason; anyone permitted to
-- update the row at all may still edit the other profile fields.
create or replace function public.guard_customer_blacklist_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_blacklisted is distinct from old.is_blacklisted
      or new.blacklist_reason is distinct from old.blacklist_reason)
     and not public.is_admin() then
    raise exception 'Only an Admin may change blacklist status' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger customers_guard_blacklist_columns
  before update on public.customers
  for each row execute function public.guard_customer_blacklist_columns();

revoke execute on function public.guard_customer_blacklist_columns() from public;
