-- 0062 (Nov 12, 2026, Wush): Suspicious activity, a written reason for final decisions, a check for an outdated
-- screen, and more evidence and history in the review popup.
-- No flag, customer or loan is changed by this migration.
-- What was missing:
--   1. Dismiss and Blacklist could be saved with no reason. SAD UC25 says "If false positive, Admin dismisses with
--      documented reason", and the customer page already requires a reason to blacklist. Now both need a reason of at
--      least 10 characters with some letters in it (spaces only, or "..........", is refused). Mark investigating
--      stays optional (UC25 asks for nothing there).
--   2. An outdated screen: Admin A opens a flag while it is Open; Admin B marks it Investigating; A presses Dismiss
--      on the old popup. 0060 allowed that (Investigating -> Dismissed is a valid step), so A decided something A had
--      not seen. Now the page sends the status it showed (p_expected_status) and the database refuses if it changed,
--      saying what it is now and who changed it.
--   3. A blacklist from a flag saved a generic customer reason ("Blacklisted following suspicious activity review").
--      Now the customer's reason is "Suspicious activity review: <the Admin's reason>", which UC5 shows to staff when
--      a loan is refused. A customer who is already blacklisted still keeps their own reason.
--   4. The popup showed only the latest note; earlier notes were kept only in the audit log. suspicious_flag_page now
--      returns each flag's history from the audit log (who, when, status, note), so nothing is overwritten from the
--      reviewer's point of view.
--   5. More evidence for the popup, all read from the records: the customer's loan history (total, active, redeemed,
--      defaulted), other flags on the same customer, the customer's AML status and ID type on file, and for a lost
--      ticket the redemption date and the payment that was accepted with a lost-ticket check (amount, receipt, who).
-- The guard on direct updates (0061, the old page on the live site) gets the same reason rule.
-- review_suspicious_flag(uuid, text, text) is replaced by review_suspicious_flag(uuid, text, text, text). Only the new
-- page (not deployed yet) called the old one. ctm_selftest_0060 called it without reasons, so it is replaced by
-- ctm_selftest_0062, which keeps its checks (steps, two Admins, refused blacklist saves nothing, roles, list) and adds
-- the new ones.
-- Self-test: select * from public.ctm_selftest_0062();   (every test rolls back)

-- a note with extra spaces squeezed out (and NULL when there is nothing left)
create or replace function public.ctm_clean_note(p text) returns text language sql immutable as
$$ select nullif(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '') $$;

-- is this a real reason? at least 10 characters and at least one letter
create or replace function public.ctm_flag_reason_ok(p text) returns boolean language sql immutable as
$$ select char_length(coalesce(public.ctm_clean_note(p), '')) >= 10 and coalesce(p, '') ~ '[[:alpha:]]' $$;

-- ---------- 1. deciding a flag ----------
drop function if exists public.review_suspicious_flag(uuid, text, text);
create or replace function public.review_suspicious_flag(p_flag uuid, p_decision text, p_notes text default null, p_expected_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.suspicious_activity_flags; who text; v_notes text := public.ctm_clean_note(p_notes); v_bl boolean;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only
  if p_decision is null or p_decision not in ('investigating', 'dismissed', 'blacklisted') then raise exception 'Pick a decision: Mark investigating, Dismiss or Blacklist.'; end if;
  if char_length(coalesce(v_notes, '')) > 500 then raise exception 'Keep the note to 500 characters or less.'; end if;
  if p_expected_status is not null and p_expected_status not in ('open', 'investigating') then raise exception 'Reload the page and try again.'; end if;
  select * into f from public.suspicious_activity_flags where id = p_flag for update; -- two Admins can't decide it at the same moment
  if not found or f.archived_at is not null then raise exception 'Flag not found. Reload the page.'; end if;
  select full_name into who from public.profiles where id = f.resolved_by;
  if f.status not in ('open', 'investigating') then
    raise exception 'This flag was already decided: % on % by %. Reload the page.', initcap(f.status::text),
      to_char(f.resolved_at at time zone 'Asia/Manila', 'Mon FMDD, YYYY HH12:MI AM'), coalesce(who, 'another Admin');
  end if;
  -- the screen showed another status: someone changed it after the popup was opened
  if p_expected_status is not null and f.status::text <> p_expected_status then
    raise exception 'This flag changed after you opened it: it is now % (since % by %). Reload the page and review it again.', initcap(f.status::text),
      coalesce(to_char(f.resolved_at at time zone 'Asia/Manila', 'Mon FMDD, YYYY HH12:MI AM'), 'just now'), coalesce(who, 'another Admin');
  end if;
  if p_decision = 'investigating' and f.status = 'investigating' then raise exception 'This flag is already being investigated. Reload the page.'; end if;
  -- UC25: a final decision needs a documented reason
  if p_decision in ('dismissed', 'blacklisted') and not public.ctm_flag_reason_ok(v_notes) then
    raise exception 'Write the reason for this decision (at least 10 characters).';
  end if;

  -- blacklist and the flag together: if one fails, neither is saved
  if p_decision = 'blacklisted' and f.customer_id is not null then
    select is_blacklisted into v_bl from public.customers where id = f.customer_id for update;
    if not coalesce(v_bl, false) then -- a customer who is already blacklisted keeps their own reason
      update public.customers set is_blacklisted = true, blacklist_reason = left('Suspicious activity review: ' || v_notes, 500) where id = f.customer_id;
    end if;
  end if;
  perform set_config('ctm.system', 'on', true);
  update public.suspicious_activity_flags
     set status = p_decision::public.suspicious_flag_status, resolved_by = auth.uid(), resolved_at = now(), resolution_notes = v_notes
   where id = f.id;
  return jsonb_build_object('status', p_decision, 'customer_id', f.customer_id);
end $$;
revoke all on function public.review_suspicious_flag(uuid, text, text, text) from public, anon;
grant execute on function public.review_suspicious_flag(uuid, text, text, text) to authenticated;

-- ---------- 2. the guard on direct updates (the old page) gets the same reason rule ----------
create or replace function public.guard_suspicious_flag() returns trigger language plpgsql set search_path = public as $$
begin
  if public.ctm_is_system() then return new; end if; -- review_suspicious_flag, archive_record, restore_record
  if old.status not in ('open', 'investigating') then
    raise exception 'This flag was already decided (%). It can''t be changed. Reload the page.', old.status using errcode = '42501';
  end if;
  if (new.reason, new.customer_id, new.loan_id, new.created_at, new.archived_at, new.archived_by, new.archive_reason, new.is_demo)
     is distinct from (old.reason, old.customer_id, old.loan_id, old.created_at, old.archived_at, old.archived_by, old.archive_reason, old.is_demo) then
    raise exception 'Only the decision and its note can be saved on a flag.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'open' and new.status in ('investigating', 'dismissed', 'blacklisted'))
    or (old.status = 'investigating' and new.status in ('dismissed', 'blacklisted'))) then
    raise exception 'A flag can''t go from % to %.', old.status, new.status using errcode = '42501';
  end if;
  if new.resolved_by is distinct from old.resolved_by and new.resolved_by is distinct from auth.uid() then
    raise exception 'A decision can only be saved in your own name.' using errcode = '42501';
  end if;
  -- 0062: Dismissed or Blacklisted needs a written reason (UC25)
  if new.status is distinct from old.status and new.status in ('dismissed', 'blacklisted') and not public.ctm_flag_reason_ok(new.resolution_notes) then
    raise exception 'Write the reason for this decision (at least 10 characters).' using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------- 3. the list for the page, with the evidence and history ----------
create or replace function public.suspicious_flag_page(p_view text default 'open', p_q text default null, p_status text default null,
  p_page integer default 1, p_size integer default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_size int := least(greatest(coalesce(p_size, 10), 5), 100);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_like text; v_cno int; res jsonb;
begin
  perform public.ctm_assert_role(array[]::public.staff_role[]); -- Admin only (the page is Admin only)
  if p_view not in ('open', 'resolved') then raise exception 'Unknown view.'; end if;
  if p_status is not null and p_status not in ('open', 'investigating') then raise exception 'Unknown filter.'; end if;
  if v_q is not null then
    v_q := left(v_q, 80);
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; -- typed % or _ are plain letters
    if v_q ~* '^c[\s-]?\d{1,9}$' then v_cno := regexp_replace(v_q, '\D', '', 'g')::int; end if; -- "C-0012" = customer 12
  end if;
  with base as (
    select f.id, f.status::text as status, f.reason, f.created_at, f.resolved_at, f.resolution_notes, rp.full_name as resolved_by_name,
           f.customer_id, c.full_name as customer_name, c.customer_no, c.is_blacklisted as customer_blacklisted, c.blacklist_reason,
           c.aml_status::text as customer_aml_status, c.id_type::text as customer_id_type,
           f.loan_id, l.ticket_number, l.principal_amount as loan_principal, l.created_at as loan_created_at, l.status::text as loan_status,
           l.lost_ticket_used, l.redeemed_at as loan_redeemed_at,
           (f.reason = public.ctm_flag_rule_reason()) as rule_flag,
           -- for the automatic rule only: the loans this customer opened in the 24 hours up to the flag (+1 minute:
           -- the flag is saved in the same moment as the loan)
           case when f.reason = public.ctm_flag_rule_reason() then
             (select count(*) from public.loans x where x.customer_id = f.customer_id and x.created_at > f.created_at - interval '24 hours' and x.created_at <= f.created_at + interval '1 minute') end as loans_24h,
           case when f.reason = public.ctm_flag_rule_reason() then
             (select coalesce(sum(x.principal_amount), 0) from public.loans x where x.customer_id = f.customer_id and x.created_at > f.created_at - interval '24 hours' and x.created_at <= f.created_at + interval '1 minute') end as loans_24h_sum
    from public.suspicious_activity_flags f
    left join public.customers c on c.id = f.customer_id
    left join public.loans l on l.id = f.loan_id
    left join public.profiles rp on rp.id = f.resolved_by
    where f.archived_at is null
  ), filtered as (
    select * from base b
    where case when p_view = 'open' then b.status in ('open', 'investigating') else b.status in ('dismissed', 'blacklisted') end
      and (p_status is null or b.status = p_status)
      and (v_q is null or b.customer_name ilike v_like or b.customer_no = v_cno or b.ticket_number ilike v_like or b.reason ilike v_like)
  )
  select jsonb_build_object(
    'counts', (select jsonb_build_object(
        'open', count(*) filter (where status = 'open'),
        'investigating', count(*) filter (where status = 'investigating'),
        'needs_review', count(*) filter (where status in ('open', 'investigating')),
        'resolved', count(*) filter (where status in ('dismissed', 'blacklisted'))) from base),
    'rule_reason', public.ctm_flag_rule_reason(),
    'total', (select count(*) from filtered),
    'page', v_page, 'size', v_size,
    'rows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) from (
        select y.*,
          row_number() over (order by case when p_view = 'resolved' then y.resolved_at end desc nulls last, y.created_at desc, y.id) as ord,
          -- the flag's history from the audit log: when it was made and every change of status or note, oldest first
          (select coalesce(jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'status', a.changed_data->>'status',
                    'note', a.changed_data->>'resolution_notes', 'by', ap.full_name) order by a.created_at), '[]'::jsonb)
             from (select * from public.audit_log a0
                    where a0.table_name = 'suspicious_activity_flags' and a0.record_id = y.id::text
                      and (a0.action = 'INSERT' or a0.old_data is null
                           or (a0.old_data->>'status') is distinct from (a0.changed_data->>'status')
                           or (a0.old_data->>'resolution_notes') is distinct from (a0.changed_data->>'resolution_notes'))
                    order by a0.created_at desc limit 20) a
             left join public.profiles ap on ap.id = a.actor) as history,
          -- the customer's loans, counted from the loan records (the same view as the customer's page)
          (select jsonb_build_object('total', h.total_loans, 'active', h.active_loans, 'redeemed', h.redeemed_loans, 'defaulted', h.defaulted_loans)
             from public.customer_history_summary h where h.customer_id = y.customer_id) as customer_loans,
          -- other flags on the same customer (not archived), and how many of those ended in Blacklisted
          (select count(*) from public.suspicious_activity_flags o where o.customer_id = y.customer_id and o.id <> y.id and o.archived_at is null) as other_flags,
          (select count(*) from public.suspicious_activity_flags o where o.customer_id = y.customer_id and o.id <> y.id and o.archived_at is null and o.status = 'blacklisted') as other_flags_blacklisted,
          -- a lost-ticket redemption: the payment that was accepted with the lost-ticket check
          (select jsonb_build_object('amount', p.amount, 'at', p.created_at, 'receipt', p.receipt_number, 'by', pp.full_name)
             from public.loan_payments p left join public.profiles pp on pp.id = p.created_by
            where p.loan_id = y.loan_id and p.verified_via_lost_ticket and p.archived_at is null
            order by p.created_at desc limit 1) as lost_ticket_payment
        from filtered y
        order by case when p_view = 'resolved' then y.resolved_at end desc nulls last, y.created_at desc, y.id
        offset (v_page - 1) * v_size limit v_size) x)
  ) into res;
  return res;
end $$;
revoke all on function public.suspicious_flag_page(text, text, text, integer, integer) from public, anon;
grant execute on function public.suspicious_flag_page(text, text, text, integer, integer) to authenticated;

-- ---------- 4. self-test (replaces ctm_selftest_0060) ----------
create or replace function public.ctm_selftest_0062() returns table(test text, outcome text)
language plpgsql set search_path = public as $$
declare
  op_id uuid := 'd948de31-6df6-413b-82b3-a1e68630f6de';   -- an Operator account
  cash_id uuid := 'cd7e8dd5-ba86-475b-b488-e7899ee6b33a'; -- a Cashier account
  appr_id uuid := '6a29bbbc-d230-4c0e-98e2-a203322990dd'; -- an Appraiser account
  admin_id uuid; admin2 uuid; fo uuid; fo2 uuid; fi uuid; fr uuid; cust uuid; s text; n int; r jsonb; h0 text; h1 text; e jsonb;
begin
  select id into admin_id from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id into admin2 from profiles where role = 'admin' and is_active and id <> admin_id order by created_at limit 1;
  select f.id into fo from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'open' and f.archived_at is null and not c.is_blacklisted order by f.created_at limit 1;
  select f.id into fo2 from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'open' and f.archived_at is null and not c.is_blacklisted and f.id <> fo and c.id <> (select customer_id from suspicious_activity_flags where id = fo) order by f.created_at limit 1;
  select f.id into fi from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.status = 'investigating' and f.archived_at is null and not c.is_blacklisted order by f.created_at limit 1;
  select id into fr from suspicious_activity_flags where status in ('dismissed', 'blacklisted') and archived_at is null order by created_at limit 1;

  test := 'Reasons and steps: Dismiss/Blacklist without a reason, with spaces only, with under 10 characters, with no letters, or over 500 characters is refused; Mark investigating needs no note; extra spaces are squeezed; Investigating twice and a decided flag are refused';
  begin
    if fo is null or fi is null or fr is null then outcome := 'SKIP (needs an open, an investigating and a decided flag)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := '';
    begin perform review_suspicious_flag(fo, 'dismissed'); s := s || 'x'; exception when others then s := s || case when sqlerrm like 'Write the reason%' then '1' else sqlerrm end; end;
    begin perform review_suspicious_flag(fo, 'dismissed', '      '); s := s || 'x'; exception when others then s := s || case when sqlerrm like 'Write the reason%' then '2' else sqlerrm end; end;
    begin perform review_suspicious_flag(fo, 'blacklisted', 'too short'); s := s || 'x'; exception when others then s := s || case when sqlerrm like 'Write the reason%' then '3' else sqlerrm end; end;
    begin perform review_suspicious_flag(fo, 'dismissed', '.......... !!'); s := s || 'x'; exception when others then s := s || case when sqlerrm like 'Write the reason%' then '4' else sqlerrm end; end;
    begin perform review_suspicious_flag(fo, 'dismissed', repeat('x', 501)); s := s || 'x'; exception when others then s := s || case when sqlerrm like 'Keep the note%' then '5' else sqlerrm end; end;
    begin perform review_suspicious_flag(fo, 'reopen', 'TEST a valid reason'); s := s || 'x'; exception when others then s := s || '6'; end;
    begin perform review_suspicious_flag(fi, 'investigating'); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%already being investigated%' then '7' else sqlerrm end; end;
    begin perform review_suspicious_flag(fr, 'dismissed', 'TEST a valid reason'); s := s || 'x'; exception when others then s := s || case when sqlerrm like 'This flag was already decided:%' then '8' else sqlerrm end; end;
    perform review_suspicious_flag(fo, 'investigating');
    s := s || '|' || (select status || ',' || (resolution_notes is null) || ',' || (resolved_by = admin_id) from suspicious_activity_flags where id = fo);
    perform review_suspicious_flag(fo, 'dismissed', '  TEST   normal pattern,   customer explained  ', 'investigating');
    s := s || '|' || (select status || ',' || resolution_notes from suspicious_activity_flags where id = fo)
      || ',' || (select c.is_blacklisted from customers c join suspicious_activity_flags f on f.customer_id = c.id where f.id = fo)::text;
    execute 'reset role';
    outcome := case when s = '12345678|investigating,true,true|dismissed,TEST normal pattern, customer explained,false' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Two Admins and an outdated popup: B''s Dismiss from a popup opened while Open is refused after A marked it Investigating (names A); after reloading B can dismiss; A''s later Blacklist is refused (already decided by B); the customer is not blocked';
  begin
    if fo is null then outcome := 'SKIP (needs an open flag)'; raise exception 'ROLLBACK'; end if;
    select customer_id into cust from suspicious_activity_flags where id = fo;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform review_suspicious_flag(fo, 'investigating', 'TEST admin A is checking', 'open');
    perform set_config('request.jwt.claims', json_build_object('sub', coalesce(admin2, admin_id), 'role', 'authenticated')::text, true);
    s := '';
    begin perform review_suspicious_flag(fo, 'dismissed', 'TEST admin B old popup', 'open'); s := s || 'saved';
    exception when others then s := s || case when sqlerrm like 'This flag changed after you opened it: it is now Investigating%' || (select full_name from profiles where id = admin_id) || '%' then 'stale' else sqlerrm end; end;
    perform review_suspicious_flag(fo, 'dismissed', 'TEST admin B after reloading', 'investigating');
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin perform review_suspicious_flag(fo, 'blacklisted', 'TEST admin A late blacklist', 'investigating'); s := s || '|saved';
    exception when others then s := s || case when sqlerrm like 'This flag was already decided: Dismissed%' then '|decided' else '|' || sqlerrm end; end;
    execute 'reset role';
    s := s || '|' || (select status || ',' || resolution_notes from suspicious_activity_flags where id = fo) || ',' || (select is_blacklisted from customers where id = cust)::text;
    outcome := case when s = 'stale|decided|dismissed,TEST admin B after reloading,false' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Blacklist effects: without a reason nothing is saved; with a reason the customer is blocked with "Suspicious activity review: <reason>"; an already blacklisted customer keeps their reason; Dismiss never lifts a separate blacklist; the customer''s loans are not touched';
  begin
    if fo is null or fo2 is null or fi is null then outcome := 'SKIP (needs two open flags and an investigating flag)'; raise exception 'ROLLBACK'; end if;
    select customer_id into cust from suspicious_activity_flags where id = fo;
    select md5(coalesce(string_agg(l.id::text || l.status || l.principal_amount || coalesce(l.archived_at::text, ''), '|' order by l.id), '')) into h0 from loans l;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := '';
    begin perform review_suspicious_flag(fo, 'blacklisted'); s := s || 'saved'; exception when others then s := s || 'refused'; end;
    s := s || ',' || (select is_blacklisted from customers where id = cust)::text || ',' || (select status from suspicious_activity_flags where id = fo);
    perform review_suspicious_flag(fo, 'blacklisted', 'TEST presented a mismatched ID twice', 'open');
    s := s || '|' || (select is_blacklisted || ',' || blacklist_reason from customers where id = cust);
    execute 'reset role';
    -- a customer already blacklisted for something else
    select customer_id into cust from suspicious_activity_flags where id = fo2;
    perform set_config('ctm.system', 'on', true);
    update customers set is_blacklisted = true, blacklist_reason = 'TEST presented a fake ID' where id = cust;
    update customers set is_blacklisted = true, blacklist_reason = 'TEST independent blacklist' where id = (select customer_id from suspicious_activity_flags where id = fi);
    perform set_config('ctm.system', 'off', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform review_suspicious_flag(fo2, 'blacklisted', 'TEST confirmed by the manager');
    s := s || '|' || (select blacklist_reason from customers where id = cust) || ',' || (select status from suspicious_activity_flags where id = fo2);
    perform review_suspicious_flag(fi, 'dismissed', 'TEST false alarm after the review');
    execute 'reset role';
    s := s || '|' || (select c.is_blacklisted || ',' || c.blacklist_reason from customers c join suspicious_activity_flags f on f.customer_id = c.id where f.id = fi)
      || ',' || (select status from suspicious_activity_flags where id = fi);
    select md5(coalesce(string_agg(l.id::text || l.status || l.principal_amount || coalesce(l.archived_at::text, ''), '|' order by l.id), '')) into h1 from loans l;
    s := s || '|loans ' || case when h0 = h1 then 'same' else 'changed' end;
    outcome := case when s = 'refused,false,open|true,Suspicious activity review: TEST presented a mismatched ID twice|TEST presented a fake ID,blacklisted|true,TEST independent blacklist,dismissed|loans same' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Roles: Operator, Cashier and Appraiser can''t decide a flag or read the list; an Operator''s direct update changes nothing; flags and customers are unchanged';
  begin
    if fo is null then outcome := 'SKIP (needs an open flag)'; raise exception 'ROLLBACK'; end if;
    select md5(string_agg(f.id::text || f.status || coalesce(f.resolution_notes, '') || f.reason || coalesce(f.customer_id::text, ''), '|' order by f.id))
      || md5(string_agg(c.id::text || c.is_blacklisted || coalesce(c.blacklist_reason, ''), '|' order by c.id)) into h0
      from suspicious_activity_flags f full join customers c on false;
    execute 'set local role authenticated';
    s := '';
    perform set_config('request.jwt.claims', json_build_object('sub', op_id, 'role', 'authenticated')::text, true);
    begin perform review_suspicious_flag(fo, 'dismissed', 'TEST should not save'); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '1' else '?' end; end;
    begin perform suspicious_flag_page(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '2' else '?' end; end;
    begin update suspicious_activity_flags set status = 'dismissed', resolved_by = op_id, resolution_notes = 'TEST should not save' where id = fo; get diagnostics n = row_count; s := s || '/o' || n;
    exception when others then s := s || '/o0'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', cash_id, 'role', 'authenticated')::text, true);
    begin perform review_suspicious_flag(fo, 'blacklisted', 'TEST should not save'); s := s || '/x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '/3' else '/?' end; end;
    begin perform suspicious_flag_page(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '4' else '?' end; end;
    perform set_config('request.jwt.claims', json_build_object('sub', appr_id, 'role', 'authenticated')::text, true);
    begin perform review_suspicious_flag(fo, 'investigating'); s := s || '/x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '/5' else '/?' end; end;
    begin perform suspicious_flag_page(); s := s || 'x'; exception when others then s := s || case when sqlerrm like '%not allowed%' then '6' else '?' end; end;
    execute 'reset role';
    select md5(string_agg(f.id::text || f.status || coalesce(f.resolution_notes, '') || f.reason || coalesce(f.customer_id::text, ''), '|' order by f.id))
      || md5(string_agg(c.id::text || c.is_blacklisted || coalesce(c.blacklist_reason, ''), '|' order by c.id)) into h1
      from suspicious_activity_flags f full join customers c on false;
    outcome := case when s = '12/o0/34/56' and h0 = h1 then 'PASS' else 'FAIL ' || s || ' same=' || (h0 = h1)::text end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'Direct updates (the old page) also need a reason to Dismiss: none or a short one is refused, a real one is saved';
  begin
    if fo is null then outcome := 'SKIP (needs an open flag)'; raise exception 'ROLLBACK'; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    s := '';
    begin update suspicious_activity_flags set status = 'dismissed', resolved_by = admin_id, resolved_at = now(), resolution_notes = null where id = fo; s := s || 'x';
    exception when others then s := s || case when sqlerrm like 'Write the reason%' then '1' else sqlerrm end; end;
    begin update suspicious_activity_flags set status = 'dismissed', resolved_by = admin_id, resolved_at = now(), resolution_notes = 'ok' where id = fo; s := s || 'x';
    exception when others then s := s || case when sqlerrm like 'Write the reason%' then '2' else sqlerrm end; end;
    update suspicious_activity_flags set status = 'dismissed', resolved_by = admin_id, resolved_at = now(), resolution_notes = 'TEST old page reason' where id = fo;
    get diagnostics n = row_count;
    execute 'reset role';
    outcome := case when s || '/' || n = '12/1' then 'PASS' else 'FAIL ' || s || '/' || n end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;

  test := 'The list: counts equal the table; search by name, C-number and ticket; 24-hour count only for the rule; every row has a history; lost-ticket flags show the loan''s lost-ticket mark; after two decisions the history keeps both notes with who saved them';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    r := suspicious_flag_page('open', null, null, 1, 100);
    s := ((r->'counts'->>'needs_review')::int = (select count(*) from suspicious_activity_flags where archived_at is null and status in ('open', 'investigating')))::text
      || ',' || ((r->'counts'->>'resolved')::int = (select count(*) from suspicious_activity_flags where archived_at is null and status in ('dismissed', 'blacklisted')))::text
      || ',' || ((r->'counts'->>'open')::int + (r->'counts'->>'investigating')::int = (r->'counts'->>'needs_review')::int)::text
      || ',' || ((suspicious_flag_page('open', null, 'investigating')->>'total')::int = (r->'counts'->>'investigating')::int)::text
      || ',' || ((suspicious_flag_page('resolved', null, null, 1, 100)->>'total')::int = (r->'counts'->>'resolved')::int)::text;
    if fo is not null then
      s := s || ',' || ((suspicious_flag_page('open', (select c.full_name from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.id = fo))->'rows') @> jsonb_build_array(jsonb_build_object('id', fo)))::text
        || ',' || ((suspicious_flag_page('open', (select 'C-' || lpad(c.customer_no::text, 4, '0') from suspicious_activity_flags f join customers c on c.id = f.customer_id where f.id = fo))->'rows') @> jsonb_build_array(jsonb_build_object('id', fo)))::text
        || ',' || ((suspicious_flag_page('open', (select l.ticket_number from suspicious_activity_flags f join loans l on l.id = f.loan_id where f.id = fo))->'rows') @> jsonb_build_array(jsonb_build_object('id', fo)))::text;
    end if;
    s := s || ',' || (select bool_and(case when (x->>'rule_flag')::boolean then (x->>'loans_24h') is not null else (x->>'loans_24h') is null end) from jsonb_array_elements(r->'rows') x)::text
      || ',' || (select bool_and(jsonb_typeof(x->'history') = 'array' and jsonb_array_length(x->'history') >= 1) from jsonb_array_elements(r->'rows') x)::text
      || ',' || coalesce((select bool_and((x->>'lost_ticket_used')::boolean) from jsonb_array_elements(r->'rows') x where x->>'reason' ilike 'Lost ticket%' and x->>'loan_id' is not null), true)::text
      || ',' || coalesce((select bool_and((x->'customer_loans'->>'total')::int >= 1) from jsonb_array_elements(r->'rows') x where x->>'loan_id' is not null), true)::text
      || ',' || ((suspicious_flag_page('open', '%')->>'total')::int = 0)::text;
    if fo is not null then
      perform review_suspicious_flag(fo, 'investigating', 'TEST note one', 'open');
      perform review_suspicious_flag(fo, 'dismissed', 'TEST note two is the final reason', 'investigating');
      select x into e from jsonb_array_elements(suspicious_flag_page('resolved', null, null, 1, 100)->'rows') x where x->>'id' = fo::text;
      -- (both changes are in one test transaction, so they share a time; check both are there, not their order)
      s := s || ',' || ((e->'history') @> jsonb_build_array(jsonb_build_object('note', 'TEST note one', 'status', 'investigating'))
                    and (e->'history') @> jsonb_build_array(jsonb_build_object('note', 'TEST note two is the final reason', 'status', 'dismissed',
                          'by', (select full_name from profiles where id = admin_id))))::text;
    end if;
    execute 'reset role';
    outcome := case when s not like '%false%' and s not like '%,,%' then 'PASS' else 'FAIL ' || s end;
    raise exception 'ROLLBACK';
  exception when others then if sqlerrm <> 'ROLLBACK' then outcome := 'FAIL ' || sqlerrm; end if; end;
  execute 'reset role'; return next;
end $$;
revoke all on function public.ctm_selftest_0062() from public, anon, authenticated;

-- 0060's test called the old 3-argument function without reasons; its checks now live in ctm_selftest_0062
drop function if exists public.ctm_selftest_0060();

-- applied only if these pass, and 0061 and 0032 still pass (the whole migration rolls back otherwise)
do $guard$
declare r text; n int;
begin
  select string_agg(t || ' ' || outcome || ' | ' || left(test, 70), E'\n'), count(*) into r, n from (
    select '0062' t, * from public.ctm_selftest_0062() union all select '0061' t, * from public.ctm_selftest_0061()
    union all select '0032' t, * from public.ctm_selftest_0032()) z
  where outcome not like 'PASS%' and outcome not like 'SKIP%';
  if n > 0 then raise exception E'0062 NOT APPLIED (rolled back), failing tests:\n%', r; end if;
end $guard$;
