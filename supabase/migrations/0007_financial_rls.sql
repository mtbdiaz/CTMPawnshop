drop policy "cash_flow_entries: system insert" on public.cash_flow_entries;
create policy "cash_flow_entries: cashier, operator or admin insert"
  on public.cash_flow_entries for insert
  to authenticated
  with check (public.get_my_role() in ('cashier','operator','admin'));
