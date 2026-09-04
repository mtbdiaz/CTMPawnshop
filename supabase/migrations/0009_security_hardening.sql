-- Postgres grants EXECUTE to PUBLIC by default on function creation; an
-- earlier revoke targeting just anon/authenticated left that PUBLIC grant
-- in place, so anon could still call these via /rest/v1/rpc/*. Revoke from
-- PUBLIC explicitly, then re-grant only what's actually needed:
-- get_my_role/is_admin must stay callable by `authenticated` (RLS policies
-- across the schema invoke them), audit_trigger_fn should never be called
-- directly by any client role — only by the triggers themselves.
revoke execute on function public.audit_trigger_fn() from public;
revoke execute on function public.get_my_role() from public;
revoke execute on function public.is_admin() from public;
grant execute on function public.get_my_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
