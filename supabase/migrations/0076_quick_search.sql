-- 0076 (Nov 15, 2026, Matt + Claude): the Ctrl+K quick search in ONE database call.
-- Before: the app made 6 to 8 trips to the database one after another (rate limit, customers + loans + payments,
-- the similar-names fallback, the customers' loans, appraisals). With the web server far from the database each trip
-- costs about 0.2 s, so a search took over a second even though every query ran in a few milliseconds.
-- Now: quick_search() does the role check, the rate limit (60 a minute, the same counter), the customer ranking
-- (the same rules as lib/customers/search.ts matchRank), the similar-names fallback, loans, payments and appraisals,
-- and returns them as one JSON. The app still reads the typed text and makes the labels. No full ID number is returned.
-- A new database function only: no table, column or row changes. Self-test: select * from public.ctm_selftest_0076();

create or replace function public.quick_search(
  p_q text, p_safe text, p_compact text, p_phone text, p_ref text, p_rank_q text,
  p_short_kind text default null, p_short_n integer default null,
  p_categories text[] default '{}', p_karat integer default null, p_other text default '', p_appr boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_q text := lower(btrim(coalesce(p_rank_q, '')));
  v_qd text := regexp_replace(lower(btrim(coalesce(p_rank_q, ''))), '[^a-z0-9]', '', 'g');
  v_ref text := lower(coalesce(p_ref, ''));
  v_cust jsonb := '[]'; v_ids uuid[] := '{}'; v_loans jsonb := '[]'; v_pay jsonb := '[]'; v_appr jsonb := '[]';
  v_similar boolean := false;
begin
  perform public.ctm_assert_role(array['cashier', 'operator', 'appraiser']::public.staff_role[]); -- Admin always passes
  if not public.ctm_rate_check('search') then return jsonb_build_object('limited', true); end if;

  -- customers: a C-number is exact; otherwise name / phone / ID contains the text, ranked like matchRank, best 4
  with cand as (
    select c.id, c.customer_no, c.full_name, c.contact_number, c.id_number
    from public.customers c
    where c.archived_at is null and (
      (p_short_kind = 'C' and c.customer_no = p_short_n)
      or (p_short_kind is distinct from 'C' and (
        c.full_name ilike '%' || p_safe || '%' or c.contact_number ilike '%' || p_phone || '%'
        or c.id_number ilike '%' || p_safe || '%' or (p_compact <> p_safe and c.id_number ilike '%' || p_compact || '%'))))
    order by c.created_at limit 40
  ), ranked as (
    select cand.*, case
      when p_short_kind = 'C' then 0
      when v_q = '' then null
      when starts_with(lower(cand.full_name), v_q) then 0
      when exists (select 1 from unnest(regexp_split_to_array(lower(cand.full_name), '\s+')) w where starts_with(w, v_q)) then 1
      when v_qd <> '' and (starts_with(regexp_replace(lower(cand.contact_number), '[^a-z0-9]', '', 'g'), v_qd)
                        or starts_with(regexp_replace(lower(cand.id_number), '[^a-z0-9]', '', 'g'), v_qd)) then 2
      when strpos(lower(cand.full_name), v_q) > 0 then 3
      when length(v_qd) >= 3 and (strpos(regexp_replace(lower(cand.contact_number), '[^a-z0-9]', '', 'g'), v_qd) > 0
                               or strpos(regexp_replace(lower(cand.id_number), '[^a-z0-9]', '', 'g'), v_qd) > 0) then 4
    end as rk from cand
  ), top as (
    select * from ranked where rk is not null order by rk, lower(full_name), full_name limit 4
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'customer_no', customer_no, 'full_name', full_name,
           'contact_number', contact_number, 'similar', false) order by rk, lower(full_name), full_name), '[]'),
         coalesce(array_agg(id), '{}')
  into v_cust, v_ids from top;

  -- nobody found by name, phone or ID and no short number typed: up to 3 similar names (typos)
  if jsonb_array_length(v_cust) = 0 and p_short_kind is null and p_q ~* '[a-z]' then
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'customer_no', c.customer_no, 'full_name', c.full_name,
             'contact_number', c.contact_number, 'similar', true) order by f.similarity desc, c.full_name), '[]'),
           coalesce(array_agg(c.id), '{}')
    into v_cust, v_ids
    from public.search_customers_fuzzy(p_q, 3) f join public.customers c on c.id = f.id and c.archived_at is null;
    v_similar := jsonb_array_length(v_cust) > 0;
  end if;

  -- how many open loans each found customer has
  select coalesce(jsonb_agg(e.c || jsonb_build_object('open_loans', (
           select count(*) from public.loans l where l.customer_id = (e.c ->> 'id')::uuid and l.archived_at is null
             and l.status in ('active', 'extended', 'reinstated'))) order by e.n), '[]')
  into v_cust from jsonb_array_elements(v_cust) with ordinality as e(c, n);

  -- loans: ticket number contains the text (newest 10) + the found customers' loans (newest 30); exact ticket first, best 5
  with t as (
    select l.id from public.loans l where l.archived_at is null and l.ticket_number ilike '%' || p_ref || '%'
    order by l.created_at desc limit 10
  ), cl as (
    select l.id from public.loans l where l.archived_at is null and l.customer_id = any(v_ids)
    order by l.created_at desc limit 30
  ), pick as (
    select l.*, case when lower(l.ticket_number) = v_ref then 0 when starts_with(lower(l.ticket_number), v_ref) then 1
                     when strpos(lower(l.ticket_number), v_ref) > 0 then 2 else 3 end as rk
    from public.loans l where l.id in (select id from t union select id from cl)
    order by rk, l.created_at desc limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'ticket_number', p.ticket_number, 'status', p.status,
           'maturity_date', p.maturity_date, 'principal_balance', p.principal_balance, 'interest_owed', p.interest_owed,
           'interest_rate_percent', p.interest_rate_percent, 'interest_accrued_through', p.interest_accrued_through,
           'grace_period_days', p.grace_period_days, 'liquidated_damages_percent', p.liquidated_damages_percent,
           'damages_owed', p.damages_owed, 'damages_accrued_through', p.damages_accrued_through,
           'customer_name', c.full_name) order by p.rk, p.created_at desc), '[]')
  into v_loans from pick p left join public.customers c on c.id = p.customer_id;

  -- payments: receipt number contains the text
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'receipt_number', x.receipt_number, 'amount', x.amount,
           'created_at', x.created_at, 'loan_id', x.loan_id, 'ticket_number', x.ticket_number, 'customer_name', x.customer_name)
           order by x.created_at desc), '[]')
  into v_pay from (
    select p.id, p.receipt_number, p.amount, p.created_at, l.id as loan_id, l.ticket_number, c.full_name as customer_name
    from public.loan_payments p left join public.loans l on l.id = p.loan_id left join public.customers c on c.id = l.customer_id
    where p.archived_at is null and p.receipt_number ilike '%' || p_ref || '%'
    order by p.created_at desc limit 4) x;

  -- appraisals: an A-number is exact; otherwise karat and / or category words and / or the custom "Others" name
  if p_appr then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'appraisal_no', x.appraisal_no, 'category', x.category,
             'category_other', x.category_other, 'karat', x.karat, 'weight_grams', x.weight_grams,
             'computed_value', x.computed_value, 'status', x.status, 'customer_name', x.customer_name)
             order by x.created_at desc), '[]')
    into v_appr from (
      select a.id, a.appraisal_no, a.category, a.category_other, a.karat, a.weight_grams, a.computed_value, a.status,
             a.created_at, c.full_name as customer_name
      from public.appraisal_items a left join public.customers c on c.id = a.customer_id
      where a.archived_at is null and (
        (p_short_kind = 'A' and a.appraisal_no = p_short_n)
        or (p_short_kind is distinct from 'A'
            and (p_karat is null or a.karat = p_karat)
            and (coalesce(cardinality(p_categories), 0) = 0 and length(coalesce(p_other, '')) < 3
                 or a.category::text = any(p_categories)
                 or (length(coalesce(p_other, '')) >= 3 and a.category_other ilike '%' || p_other || '%'))))
      order by a.created_at desc limit 4) x;
  end if;

  return jsonb_build_object('limited', false, 'similar', v_similar, 'customers', v_cust, 'loans', v_loans,
                            'payments', v_pay, 'appraisals', v_appr);
end $$;

revoke all on function public.quick_search(text, text, text, text, text, text, text, integer, text[], integer, text, boolean) from public, anon;
grant execute on function public.quick_search(text, text, text, text, text, text, text, integer, text[], integer, text, boolean) to authenticated;
