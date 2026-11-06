-- Demo seed, part 4: load staged data into the real tables, write the audit log, verify, and unload.
-- Nothing here runs until you call it: select demo_seed.load_staff('<password>'); select demo_seed.load_core(); select demo_seed.load_audit();
-- All seeded rows have ids starting dede0000- (kept out of sight), so demo_seed.unload() can find them.

create or replace function demo_seed.load_staff(p_password text) returns jsonb language plpgsql set search_path = public, extensions, auth as $$
declare s record; n int := 0;
begin
  perform set_config('session_replication_role', 'replica', true);
  for s in select * from (values
      (1, 'Rowena Abella', 'admin', 'rowena.abella'), (2, 'Jerome Bacalso', 'operator', 'jerome.bacalso'), (3, 'Liza Mae Dacanay', 'cashier', 'liza.dacanay'),
      (4, 'Ronnie Tiempo', 'cashier', 'ronnie.tiempo'), (5, 'Grace Villamor', 'cashier', 'grace.villamor'),
      (6, 'Arnel Quizon', 'appraiser', 'arnel.quizon'), (7, 'Jocelyn Sumagaysay', 'appraiser', 'jocelyn.sumagaysay')) v(i, nm, rl, em) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', demo_seed.u(1, s.i), 'authenticated', 'authenticated', s.em || '@ctmpawnshop.test',
      crypt(p_password, gen_salt('bf')), timestamptz '2026-06-25 09:00+08', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      timestamptz '2026-06-25 09:00+08', timestamptz '2026-06-25 09:00+08', '', '', '', '', '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), demo_seed.u(1, s.i),
      jsonb_build_object('sub', demo_seed.u(1, s.i)::text, 'email', s.em || '@ctmpawnshop.test', 'email_verified', true, 'phone_verified', false),
      'email', demo_seed.u(1, s.i)::text, now(), timestamptz '2026-06-25 09:00+08', timestamptz '2026-06-25 09:00+08')
    on conflict do nothing;
    insert into public.profiles (id, full_name, role, is_active, created_at, updated_at)
    values (demo_seed.u(1, s.i), s.nm, s.rl::public.staff_role, true, timestamptz '2026-06-25 09:00+08', timestamptz '2026-06-25 09:00+08')
    on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
    n := n + 1;
  end loop;
  return jsonb_build_object('staff', n);
end $$;

create or replace function demo_seed.load_core() returns jsonb language plpgsql as $$
declare res jsonb := '{}'::jsonb; rc int;
begin
  perform set_config('session_replication_role', 'replica', true);
  if exists (select 1 from public.loans where id::text like 'dede0000-%') then raise exception 'Seeded rows already loaded; run demo_seed.unload() first.'; end if;

  insert into public.customers (id, full_name, address, contact_number, email, date_of_birth, id_type, id_number, aml_status, aml_checked_at, aml_notes,
    is_blacklisted, blacklist_reason, created_by, created_at, updated_at, archived_at, archived_by, archive_reason)
  select s.id, s.full_name, s.address, s.contact_number, s.email, s.date_of_birth, s.id_type, s.id_number, s.aml_status::public.aml_status, coalesce(s.aml_checked_at, s.created_at), s.aml_notes,
    coalesce(s.is_blacklisted, false), s.blacklist_reason, s.created_by, s.created_at, coalesce(s.bl_at, s.archived_at, s.created_at), s.archived_at, s.archived_by, s.archive_reason
  from demo_seed.s_cust s;
  get diagnostics rc = row_count; res := res || jsonb_build_object('customers', rc);

  insert into public.appraisal_items (id, customer_id, weight_grams, karat, condition_notes, photo_paths, gold_price_used, ltv_percent_used, computed_value, suggested_loan_min, suggested_loan_max,
    is_counterfeit_risk, counterfeit_resolution, counterfeit_resolved_by, counterfeit_resolved_at, appraised_by, created_at, updated_at, archived_at, archived_by, archive_reason, category, category_other, status)
  select a.id, c.id, a.weight, a.karat, a.notes, '{}'::text[], a.gold_price, a.ltv, a.value, a.minl, a.maxl,
    a.counterfeit, a.resolution::public.counterfeit_resolution, a.resolved_by, a.resolved_at, a.appraised_by, a.created_at, coalesce(a.pawned_at, a.created_at), a.archived_at, a.archived_by, a.archive_reason,
    a.category::public.item_category, a.category_other, a.status::public.appraisal_status
  from demo_seed.s_appr a left join demo_seed.s_cust c on c.n = a.customer_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('appraisal_items', rc);

  insert into public.inventory_items (id, appraisal_item_id, vault_location, status, created_at, updated_at, archived_at, archived_by, archive_reason)
  select l.inv_id, a.id, l.vault, l.inv_status::public.inventory_status, l.created_at,
    coalesce((select max(e.at) from demo_seed.s_ev e where e.loan_n = l.n and e.inv_new is not null), l.created_at), l.archived_at, l.archived_by, l.archive_reason
  from demo_seed.s_loan l join demo_seed.s_appr a on a.n = l.appr_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('inventory_items', rc);

  insert into public.loans (id, customer_id, appraisal_item_id, inventory_item_id, principal_amount, interest_rate_percent, principal_balance, loan_date, maturity_date, grace_period_days,
    extension_count, status, ticket_number, created_by, created_at, updated_at, lost_ticket_used, interest_owed, interest_accrued_through, defaulted_at, reinstated_at, redeemed_at, forfeited_at,
    late_payment_count, archived_at, archived_by, archive_reason)
  select l.id, c.id, a.id, l.inv_id, l.principal, l.rate, l.balance, l.loan_date, l.maturity, l.grace, l.ext, l.status::public.loan_status, l.ticket, l.created_by, l.created_at, l.updated_at,
    l.lost, l.owed, l.through, l.defaulted_at, l.reinstated_at, l.redeemed_at, l.forfeited_at, l.late, l.archived_at, l.archived_by, l.archive_reason
  from demo_seed.s_loan l join demo_seed.s_cust c on c.n = l.cust_n join demo_seed.s_appr a on a.n = l.appr_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('loans', rc);

  insert into public.loan_payments (id, loan_id, amount, principal_portion, interest_portion, receipt_number, created_by, created_at, verified_via_lost_ticket)
  select demo_seed.u(8, e.seq), l.id, coalesce((e.extra->>'final_amount')::numeric, e.amount), coalesce((e.extra->>'final_p')::numeric, e.ppart),
    coalesce((e.extra->>'final_i')::numeric, e.ipart), e.receipt, e.actor, e.at, coalesce(e.lost, false) and e.kind = 'pay'
  from demo_seed.s_ev e join demo_seed.s_loan l on l.n = e.loan_n where e.kind = 'pay' or (e.kind = 'renew' and e.amount > 0);
  get diagnostics rc = row_count; res := res || jsonb_build_object('loan_payments', rc);

  insert into public.loan_extensions (id, loan_id, previous_maturity_date, new_maturity_date, additional_interest_amount, created_by, created_at, extension_type, capitalized_amount)
  select demo_seed.u(9, e.seq), l.id, e.prev_maturity, e.maturity, (e.extra->>'new_interest')::numeric, e.actor, e.at,
    (case e.kind when 'renew' then 'renewal' else 'capitalized' end)::public.extension_type, case when e.kind = 'cap' then e.amount else 0 end
  from demo_seed.s_ev e join demo_seed.s_loan l on l.n = e.loan_n where e.kind in ('renew', 'cap');
  get diagnostics rc = row_count; res := res || jsonb_build_object('loan_extensions', rc);

  insert into public.inventory_status_history (id, inventory_item_id, old_status, new_status, changed_at)
  select demo_seed.u(10, q.seq), q.inv_id, q.p::public.inventory_status, q.inv_new::public.inventory_status, q.at
  from (select e.seq, e.at, e.inv_new, l.inv_id, lag(e.inv_new) over (partition by e.loan_n order by e.at, e.seq) as p
        from demo_seed.s_ev e join demo_seed.s_loan l on l.n = e.loan_n where e.inv_new is not null) q
  where q.p is distinct from q.inv_new;
  get diagnostics rc = row_count; res := res || jsonb_build_object('inventory_status_history', rc);

  insert into public.cash_flow_entries (id, entry_type, direction, amount, description, related_loan_id, created_by, created_at, is_memo)
  select demo_seed.u(11, e.seq),
    (case e.kind when 'create' then 'loan_disbursement' when 'pay' then 'payment_received' when 'renew' then 'payment_received' when 'cap' then 'capitalization' else 'adjustment' end)::public.cash_flow_type,
    (case when e.kind in ('create', 'pay_fix') then 'out' else 'in' end)::public.cash_flow_direction, e.amount,
    case e.kind when 'create' then 'Loan disbursed' when 'pay' then 'Payment ' || e.receipt || ' for ' || l.ticket
      when 'renew' then 'Renewal interest ' || e.receipt || ' for ' || l.ticket
      when 'cap' then 'Interest capitalized into principal (non-cash) for ' || l.ticket
      when 'pay_fix' then 'Admin correction to payment ' || e.receipt || ': ' || (e.extra->>'reason')
      else 'Void of ticket ' || l.ticket || ': disbursement reversed' end,
    l.id, e.actor, e.at, e.kind = 'cap'
  from demo_seed.s_ev e join demo_seed.s_loan l on l.n = e.loan_n
  where e.kind in ('create', 'pay', 'cap', 'pay_fix', 'void') or (e.kind = 'renew' and e.amount > 0);
  get diagnostics rc = row_count; res := res || jsonb_build_object('cash_from_loans', rc);

  insert into public.cash_flow_entries (id, entry_type, direction, amount, description, related_loan_id, created_by, created_at, is_memo)
  select demo_seed.u(12, x.seq), x.typ::public.cash_flow_type, x.dir::public.cash_flow_direction, x.amount, x.descr, l.id, x.actor, x.at, false
  from demo_seed.s_cashx x left join demo_seed.s_loan l on l.n = x.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('cash_other', rc);

  insert into public.auction_batches (id, created_by, notes, created_at) select b.id, b.created_by, b.notes, b.at from demo_seed.s_batch b;
  get diagnostics rc = row_count; res := res || jsonb_build_object('auction_batches', rc);
  insert into public.auction_batch_items (id, batch_id, inventory_item_id)
  select demo_seed.u(13, (row_number() over (order by i.batch_n, i.loan_n))::int), b.id, l.inv_id
  from demo_seed.s_batch_item i join demo_seed.s_batch b on b.n = i.batch_n join demo_seed.s_loan l on l.n = i.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('auction_batch_items', rc);

  insert into public.physical_inventory_audits (id, performed_by, notes, discrepancy_count, created_at) select a.id, a.performed_by, a.notes, a.disc, a.at from demo_seed.s_audit a;
  get diagnostics rc = row_count; res := res || jsonb_build_object('physical_inventory_audits', rc);
  insert into public.physical_inventory_audit_items (id, audit_id, inventory_item_id, expected_status, found, notes)
  select demo_seed.u(14, (row_number() over (order by i.audit_n, i.loan_n))::int), au.id, l.inv_id, i.expected::public.inventory_status, i.found, i.note
  from demo_seed.s_audit_item i join demo_seed.s_audit au on au.n = i.audit_n join demo_seed.s_loan l on l.n = i.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('physical_inventory_audit_items', rc);

  insert into public.suspicious_activity_flags (id, customer_id, loan_id, reason, status, resolved_by, resolved_at, created_at)
  select f.id, c.id, l.id, f.reason, f.status::public.suspicious_flag_status, f.resolved_by, f.resolved_at, f.created_at
  from demo_seed.s_flag f join demo_seed.s_cust c on c.n = f.cust_n join demo_seed.s_loan l on l.n = f.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('suspicious_activity_flags', rc);

  insert into public.reminder_log (id, loan_id, sent_at, created_by)
  select demo_seed.u(16, r.seq), l.id, r.sent_at, r.actor from demo_seed.s_rem r join demo_seed.s_loan l on l.n = r.loan_n;
  get diagnostics rc = row_count; res := res || jsonb_build_object('reminder_log', rc);
  return res;
end $$;

create or replace function demo_seed.aud_insert(p_table text, p_actor_expr text, p_ts_col text) returns int language plpgsql as $$
declare c int;
begin
  execute format('insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at) select %L, t.id::text, ''INSERT'', %s, to_jsonb(t) - ''is_demo'', t.%I from public.%I t where t.id::text like ''dede0000-%%''',
    p_table, p_actor_expr, p_ts_col, p_table);
  get diagnostics c = row_count;
  return c;
end $$;

create or replace function demo_seed.load_audit() returns jsonb language plpgsql as $$
declare res jsonb := '{}'::jsonb; rc int;
begin
  perform set_config('session_replication_role', 'replica', true);
  res := res || jsonb_build_object('profiles', demo_seed.aud_insert('profiles', 'null::uuid', 'created_at'));
  res := res || jsonb_build_object('loan_extensions', demo_seed.aud_insert('loan_extensions', 't.created_by', 'created_at'));
  res := res || jsonb_build_object('auction_batches', demo_seed.aud_insert('auction_batches', 't.created_by', 'created_at'));
  res := res || jsonb_build_object('physical_inventory_audits', demo_seed.aud_insert('physical_inventory_audits', 't.performed_by', 'created_at'));
  res := res || jsonb_build_object('suspicious_activity_flags', demo_seed.aud_insert('suspicious_activity_flags', 'null::uuid', 'created_at'));

  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'customers', t.id::text, 'INSERT', t.created_by,
    (to_jsonb(t) - 'is_demo') || jsonb_build_object('is_blacklisted', false, 'blacklist_reason', null, 'archived_at', null, 'archived_by', null, 'archive_reason', null, 'updated_at', t.created_at), t.created_at
  from public.customers t where t.id::text like 'dede0000-%';
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'customers', t.id::text, 'UPDATE', coalesce(t.archived_by, demo_seed.u(1, 1)), to_jsonb(t) - 'is_demo', t.updated_at
  from public.customers t where t.id::text like 'dede0000-%' and (t.is_blacklisted or t.archived_at is not null);
  get diagnostics rc = row_count; res := res || jsonb_build_object('customer_updates', rc);

  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'appraisal_items', t.id::text, 'INSERT', t.appraised_by,
    (to_jsonb(t) - 'is_demo') || jsonb_build_object('status', 'available', 'customer_id', null, 'updated_at', t.created_at, 'archived_at', null, 'archived_by', null, 'archive_reason', null), t.created_at
  from public.appraisal_items t where t.id::text like 'dede0000-%';
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'appraisal_items', t.id::text, 'UPDATE', l.created_by, to_jsonb(t) - 'is_demo', t.updated_at
  from public.appraisal_items t join public.loans l on l.appraisal_item_id = t.id where t.id::text like 'dede0000-%' and t.status = 'pawned';
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'appraisal_items', t.id::text, 'UPDATE', t.archived_by, to_jsonb(t) - 'is_demo', t.archived_at
  from public.appraisal_items t where t.id::text like 'dede0000-%' and t.archived_at is not null;

  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'loans', l.id::text, case when e.kind = 'create' then 'INSERT' else 'UPDATE' end, e.actor,
    (to_jsonb(l) - 'is_demo') || jsonb_build_object('status', e.status, 'principal_balance', e.bal, 'interest_owed', e.owed, 'maturity_date', e.maturity,
      'interest_accrued_through', e.through, 'extension_count', e.ext, 'late_payment_count', e.late, 'updated_at', e.at,
      'defaulted_at', case when l.defaulted_at <= e.at then l.defaulted_at end, 'reinstated_at', case when l.reinstated_at <= e.at then l.reinstated_at end,
      'redeemed_at', case when l.redeemed_at <= e.at then l.redeemed_at end, 'forfeited_at', case when l.forfeited_at <= e.at then l.forfeited_at end,
      'archived_at', case when e.kind = 'void' then l.archived_at end), e.at
  from demo_seed.s_ev e join public.loans l on l.id = demo_seed.u(3, e.loan_n) where e.kind <> 'queue';
  get diagnostics rc = row_count; res := res || jsonb_build_object('loans', rc);

  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'loan_payments', p.id::text, 'INSERT', p.created_by, (to_jsonb(p) - 'is_demo') || jsonb_build_object('amount', e.amount, 'principal_portion', e.ppart, 'interest_portion', e.ipart), p.created_at
  from public.loan_payments p join demo_seed.s_ev e on demo_seed.u(8, e.seq) = p.id where p.id::text like 'dede0000-%';
  get diagnostics rc = row_count; res := res || jsonb_build_object('loan_payments', rc);
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'loan_payments', p.id::text, 'UPDATE', e.actor,
    jsonb_build_object('admin_edit', true, 'reason', e.extra->>'reason',
      'before', (to_jsonb(p) - 'is_demo') || jsonb_build_object('amount', p.amount + e.amount, 'principal_portion', p.principal_portion + e.amount),
      'after', to_jsonb(p) - 'is_demo'), e.at
  from demo_seed.s_ev e join public.loan_payments p on p.receipt_number = e.receipt where e.kind = 'pay_fix';
  insert into public.audit_log (table_name, record_id, action, actor, changed_data, created_at)
  select 'suspicious_activity_flags', t.id::text, 'UPDATE', t.resolved_by, to_jsonb(t) - 'is_demo', t.resolved_at
  from public.suspicious_activity_flags t where t.id::text like 'dede0000-%' and t.resolved_at is not null;

  select count(*) into rc from public.audit_log where record_id like 'dede0000-%';
  return res || jsonb_build_object('audit_rows_total', rc);
end $$;

create or replace function demo_seed.unload() returns jsonb language plpgsql set search_path = public, auth as $$
declare t text; c int; res jsonb := '{}'::jsonb;
begin
  perform set_config('session_replication_role', 'replica', true);
  foreach t in array array['audit_log', 'reminder_log', 'suspicious_activity_flags', 'physical_inventory_audit_items', 'physical_inventory_audits', 'auction_batch_items', 'auction_batches',
      'cash_flow_entries', 'inventory_status_history', 'loan_extensions', 'loan_payments', 'loans', 'inventory_items', 'appraisal_items', 'customers', 'profiles'] loop
    execute format('delete from public.%I where %s like %L', t, case when t = 'audit_log' then 'record_id' else 'id::text' end, 'dede0000-%');
    get diagnostics c = row_count; res := res || jsonb_build_object(t, c);
  end loop;
  delete from auth.users where id::text like 'dede0000-%';
  return res;
end $$;

create or replace function demo_seed.verify() returns table (chk text, result text) language sql stable as $$
  select 'count ' || t.n, t.c::text from (
    select 'customers' n, count(*) c from public.customers where id::text like 'dede0000-%'
    union all select 'appraisal_items', count(*) from public.appraisal_items where id::text like 'dede0000-%'
    union all select 'inventory_items', count(*) from public.inventory_items where id::text like 'dede0000-%'
    union all select 'loans', count(*) from public.loans where id::text like 'dede0000-%'
    union all select 'loan_payments', count(*) from public.loan_payments where id::text like 'dede0000-%'
    union all select 'loan_extensions', count(*) from public.loan_extensions where id::text like 'dede0000-%'
    union all select 'inventory_status_history', count(*) from public.inventory_status_history where id::text like 'dede0000-%'
    union all select 'cash_flow_entries', count(*) from public.cash_flow_entries where id::text like 'dede0000-%'
    union all select 'auction_batches', count(*) from public.auction_batches where id::text like 'dede0000-%'
    union all select 'auction_batch_items', count(*) from public.auction_batch_items where id::text like 'dede0000-%'
    union all select 'physical_inventory_audits', count(*) from public.physical_inventory_audits where id::text like 'dede0000-%'
    union all select 'physical_inventory_audit_items', count(*) from public.physical_inventory_audit_items where id::text like 'dede0000-%'
    union all select 'suspicious_activity_flags', count(*) from public.suspicious_activity_flags where id::text like 'dede0000-%'
    union all select 'reminder_log', count(*) from public.reminder_log where id::text like 'dede0000-%'
    union all select 'profiles', count(*) from public.profiles where id::text like 'dede0000-%'
    union all select 'audit_log', count(*) from public.audit_log where record_id like 'dede0000-%') t
  union all select 'orphan loans (no customer/appraisal/inventory)', count(*)::text from public.loans l where l.id::text like 'dede0000-%'
    and (not exists (select 1 from public.customers c where c.id = l.customer_id) or not exists (select 1 from public.appraisal_items a where a.id = l.appraisal_item_id) or not exists (select 1 from public.inventory_items i where i.id = l.inventory_item_id))
  union all select 'orphan payments/extensions/cash', ((select count(*) from public.loan_payments p where p.id::text like 'dede0000-%' and not exists (select 1 from public.loans l where l.id = p.loan_id))
    + (select count(*) from public.loan_extensions x where x.id::text like 'dede0000-%' and not exists (select 1 from public.loans l where l.id = x.loan_id))
    + (select count(*) from public.cash_flow_entries x where x.id::text like 'dede0000-%' and x.related_loan_id is not null and not exists (select 1 from public.loans l where l.id = x.related_loan_id)))::text
  union all select 'orphan staff references', ((select count(*) from public.loans l where l.id::text like 'dede0000-%' and not exists (select 1 from public.profiles p where p.id = l.created_by))
    + (select count(*) from public.loan_payments l where l.id::text like 'dede0000-%' and not exists (select 1 from public.profiles p where p.id = l.created_by)))::text
  union all select 'principal does not reconcile (excluding voids)', count(*)::text from public.loans l where l.id::text like 'dede0000-%' and l.archived_at is null
    and l.principal_balance <> l.principal_amount + coalesce((select sum(x.capitalized_amount) from public.loan_extensions x where x.loan_id = l.id), 0) - coalesce((select sum(p.principal_portion) from public.loan_payments p where p.loan_id = l.id), 0)
  union all select 'redeemed loans with a balance', count(*)::text from public.loans l where l.id::text like 'dede0000-%' and l.status = 'redeemed' and (l.principal_balance <> 0 or l.interest_owed <> 0)
  union all select 'disbursements minus principal (should be 0)', (coalesce((select sum(amount) from public.cash_flow_entries where id::text like 'dede0000-%' and entry_type = 'loan_disbursement'), 0)
    - coalesce((select sum(principal_amount) from public.loans where id::text like 'dede0000-%'), 0))::text
  union all select 'payments vs ledger (should be 0)', (coalesce((select sum(amount) from public.cash_flow_entries where id::text like 'dede0000-%' and entry_type = 'payment_received'), 0)
    - coalesce((select sum(amount) from public.cash_flow_entries where id::text like 'dede0000-%' and entry_type = 'adjustment' and direction = 'out' and description like 'Admin correction to payment%'), 0)
    - coalesce((select sum(amount) from public.loan_payments where id::text like 'dede0000-%'), 0))::text
  union all select 'date order problems', ((select count(*) from public.loans l where l.id::text like 'dede0000-%' and (l.redeemed_at <= l.created_at or l.forfeited_at <= l.defaulted_at or l.maturity_date < l.loan_date))
    + (select count(*) from public.loan_payments p join public.loans l on l.id = p.loan_id where p.id::text like 'dede0000-%' and p.created_at < l.created_at)
    + (select count(*) from public.loans l where l.id::text like 'dede0000-%' and l.status = 'forfeited' and l.forfeited_at < (l.maturity_date + l.grace_period_days)::timestamptz))::text
  union all select 'status ' || status::text, count(*)::text from public.loans where id::text like 'dede0000-%' group by status
  union all select 'month ' || to_char(loan_date, 'YYYY-MM'), count(*) || ' loans, PHP ' || round(sum(principal_amount)) || ' lent' from public.loans where id::text like 'dede0000-%' group by to_char(loan_date, 'YYYY-MM')
  union all select 'collected ' || to_char(created_at at time zone 'Asia/Manila', 'YYYY-MM'), 'PHP ' || round(sum(amount)) from public.loan_payments where id::text like 'dede0000-%' group by to_char(created_at at time zone 'Asia/Manila', 'YYYY-MM')
  union all select 'duplicate ticket or receipt numbers', ((select count(*) - count(distinct ticket_number) from public.loans) + (select count(*) - count(distinct receipt_number) from public.loan_payments))::text
  order by 1 $$;
