-- Supabase security advisor cleanup (2026-11-10).
-- rls_auto_enable() is the event-trigger function that turns on RLS for every new public table.
-- It can't do anything when called through the API, but anon/authenticated don't need EXECUTE on it.
-- (Event triggers still fire: they don't check the caller's EXECUTE grant.)
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- owner-only self-test: pin its search path like the others
alter function public.ctm_selftest_decisions() set search_path = public;
