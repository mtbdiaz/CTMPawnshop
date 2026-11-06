-- Demo seed, part 2b: customer / appraisal / loan generators and the day-by-day driver.
-- Run order: 01_helpers, 02_sim_loan, 02b_generators, then select demo_seed.gen_days(from, to) in windows
-- (1 Jul-15 Aug, 16 Aug-30 Sep, 1-27 Oct), then 03_extras functions, 04_load functions.

create or replace function demo_seed.mk_customer(p_n int, p_ts timestamptz, p_tier text) returns void language plpgsql as $$
declare fn text; ln text; muni text; brgy text; addr text; idt text; nm text; staff uuid;
begin
  fn := demo_seed.pk(array['Maria','Jose','Juan','Ana','Rosario','Antonio','Elena','Roberto','Teresita','Ricardo','Liza','Mark','Jennifer','Angelo','Cristina','Ronaldo','Marites','Dennis','Gloria','Rodel','Jocelyn','Armando','Cherry','Eduardo','Imelda','Noel','Vilma','Reynaldo','Arlene','Joel','Lourdes','Emmanuel','Janice','Ferdinand','Maribel','Renato','Sheila','Allan','Evelyn','Jerome','Carmela','Rey','Michelle','Leonardo','Nancy','Danilo','Rowena','Jun','Aileen','Bernardo','Fe','Ramil','Lorna','Gilbert','Cynthia','Alvin','Daisy','Nelson','Corazon','Efren']);
  ln := demo_seed.pk(array['Abella','Alcantara','Bacalso','Baguio','Cabahug','Cadayona','Dacanay','Dagohoy','Estrada','Fernandez','Gonzales','Hernandez','Ibarra','Jimenez','Laurente','Lumacad','Magallanes','Mercado','Navarro','Ocampo','Pacquiao','Quizon','Ramos','Sabandal','Tiempo','Ugsad','Villamor','Yap','Zamora','Alvarez','Bautista','Castillo','Dela Cruz','Esteban','Flores','Garcia','Lim','Macaraeg','Natividad','Ortega','Padilla','Rivera','Salazar','Tan','Valdez','Aquino','Cruz','Delos Santos','Mangubat','Sumagaysay']);
  nm := fn || ' ' || chr(64 + demo_seed.ri(1, 26)) || '. ' || ln;
  muni := demo_seed.wpk(array['Kiblawan','Digos City','Sta. Cruz','Bansalan','Matanao','Hagonoy','Davao City'], array[40,15,10,8,6,5,16]);
  brgy := case muni
    when 'Kiblawan' then demo_seed.pk(array['Poblacion','Abnate','Bagong Negros','Bagong Silang','Bonifacio','Molopolo','Pasig','Sibulan','Tacub','Tuban','Waterfall'])
    when 'Digos City' then demo_seed.pk(array['Zone 1','Zone 2','Zone 3','Matti','Kapatagan','Aplaya','San Jose','Dulangan'])
    when 'Sta. Cruz' then demo_seed.pk(array['Poblacion','Astorga','Darong','Inawayan','Zone II','Coronon'])
    when 'Bansalan' then demo_seed.pk(array['Poblacion','Darapuay','Managa','Kinuskusan','Mabuhay'])
    when 'Matanao' then demo_seed.pk(array['Poblacion','Asbang','Kauswagan','Camanchiles','Saboy'])
    when 'Hagonoy' then demo_seed.pk(array['Poblacion','Guihing','Lapulabao','Maliit Digos','Sinayawan'])
    else demo_seed.pk(array['Matina','Talomo','Toril','Buhangin','Bajada','Lanang','Agdao','Mintal','Catalunan Grande','Ecoland','Maa','Bangkal','Sasa','Tugbok'])
  end;
  addr := case when muni = 'Davao City' then 'Blk ' || demo_seed.ri(1, 30) || ' Lot ' || demo_seed.ri(1, 25) || ', Brgy. ' || brgy || ', Davao City'
          else 'Purok ' || demo_seed.ri(1, 9) || ', Brgy. ' || brgy || ', ' || muni || ', Davao del Sur' end;
  idt := demo_seed.wpk(array['PhilSys National ID','UMID','Driver''s License','Passport','SSS ID','Postal ID','Voter''s ID','PRC ID','Senior Citizen ID'], array[30,12,20,6,12,6,6,4,4]);
  staff := demo_seed.u(1, case when demo_seed.ch(0.5) then 2 else 3 + demo_seed.ri(0, 2) end);
  insert into demo_seed.s_cust (n, id, full_name, address, contact_number, email, date_of_birth, id_type, id_number, created_by, created_at, updated_at, tier)
  values (p_n, demo_seed.u(2, p_n), nm, addr, '0900000' || lpad(p_n::text, 4, '0'),
    case when demo_seed.ch(0.3) then replace(lower(fn || '.' || ln), ' ', '') || p_n || '@example.test' end,
    date '1962-01-01' + demo_seed.ri(0, 15000), idt, '0000-' || lpad(p_n::text, 6, '0'), staff, p_ts, p_ts, p_tier);
end $$;

create or replace function demo_seed.cust_weights(p_ts timestamptz) returns table(n int, w double precision) language sql stable as $$
  select c.n,
    (case c.tier when 'vip' then 9.0 when 'regular' then 4.0 when 'delinquent' then 2.5 when 'ordinary' then 1.0 else 0.12 end)
    * (case when coalesce(a.act, 0) >= (case when c.tier = 'vip' then 5 else 3 end) then 0 else 1 end)
    * (case when coalesce(a.bad, 0) > 0 and c.tier <> 'delinquent' then 0.3 else 1 end)
  from demo_seed.s_cust c
  left join (select l.cust_n,
      count(*) filter (where l.created_at <= p_ts and (l.redeemed_at is null or l.redeemed_at > p_ts) and (l.defaulted_at is null or l.defaulted_at > p_ts)) act,
      count(*) filter (where l.defaulted_at is not null and l.defaulted_at < p_ts) bad
    from demo_seed.s_loan l group by l.cust_n) a on a.cust_n = c.n
  where c.archived_at is null $$;

create or replace function demo_seed.pick_customer(p_ts timestamptz) returns int language plpgsql as $$
declare tot double precision; x double precision; chosen int;
begin
  select coalesce(sum(w), 0) into tot from demo_seed.cust_weights(p_ts);
  if tot <= 0 then return null; end if;
  x := demo_seed.r() * tot;
  select z.n into chosen from (select cw.n, sum(cw.w) over (order by cw.n) cs from demo_seed.cust_weights(p_ts) cw where cw.w > 0) z where z.cs >= x order by z.n limit 1;
  return chosen;
end $$;

create or replace function demo_seed.mk_loan(p_n int, p_cust int, p_ts timestamptz, p_void boolean) returns void language plpgsql as $$
declare
  ctier text; cat text; kt int; wt numeric; lo numeric; hi numeric; price numeric; v numeric; mx numeric; mn numeric; pr numeric;
  d date := (p_ts at time zone 'Asia/Manila')::date; vip numeric; note text; apr_ts timestamptz; vault text;
begin
  select tier into ctier from demo_seed.s_cust where n = p_cust;
  vip := case when ctier = 'vip' then 1.3 else 1 end;
  cat := demo_seed.wpk(array['ring','chain','earrings','bracelet','pendant','pendant_with_chain','others'], array[28,22,14,12,10,9,5]);
  kt := demo_seed.wpk(array['18','21','24'], array[55,30,15])::int;
  select l, h into lo, hi from (values ('ring',1.2,9.0),('chain',3.0,38.0),('earrings',0.8,6.0),('bracelet',4.0,26.0),('pendant',0.8,9.0),('pendant_with_chain',5.0,30.0),('others',1.5,16.0)) t(c, l, h) where c = cat;
  wt := round(lo + (hi - lo) * power(demo_seed.r()::numeric, 2.3) * vip, 3);
  price := round(demo_seed.gold24(d) * kt / 24, 2);
  v := round(wt * price, 2); mx := round(v * 0.70, 2); mn := round(mx * 0.9, 2);
  pr := greatest(500, floor(mx * (0.5 + 0.4 * demo_seed.r()) / 50) * 50);
  if pr > mx then pr := floor(mx / 50) * 50; end if;
  if p_void then pr := least(pr, 6000); end if;
  note := case when demo_seed.ch(0.6) then demo_seed.pk(array['Minor scratches','With pawn tag','Hallmarked, acid tested','Slightly bent clasp','Heavy wear','Good condition','Tested on stone, genuine gold','No visible damage','Engraved initials','Missing one stone']) end;
  apr_ts := p_ts - make_interval(mins => demo_seed.ri(8, 45));
  insert into demo_seed.s_appr (n, id, customer_n, weight, karat, notes, gold_price, ltv, value, minl, maxl, appraised_by, created_at, updated_at, category, category_other, status, pawned_at)
  values (p_n, demo_seed.u(5, p_n), p_cust, wt, kt, note, price, 70, v, mn, mx, demo_seed.u(1, 6 + demo_seed.ri(0, 1)), apr_ts, p_ts, cat,
    case when cat = 'others' then demo_seed.pk(array['Anklet','Rosary','Baby bangle','Wedding band set','Brooch','Gold coin','Gold tooth cap']) end, 'pawned', p_ts);
  vault := case when pr > 30000 then 'Safe 1' else demo_seed.wpk(array['Vault A','Vault B'], array[75,25]) end;
  insert into demo_seed.s_loan (n, id, inv_id, cust_n, appr_n, principal, rate, balance, owed, through, loan_date, maturity, grace, status, ticket, created_by, created_at, updated_at, vault, inv_status, tier, voided)
  values (p_n, demo_seed.u(3, p_n), demo_seed.u(4, p_n), p_cust, p_n, pr, 5, pr, round(pr * 5 / 100, 2), d + 30, d, d + 30, 7, 'active', demo_seed.tkt(p_ts, p_n),
    demo_seed.u(1, 3 + demo_seed.ri(0, 2)), p_ts, p_ts, vault, 'pawned', case when ctier = 'onetimer' then 'ordinary' else ctier end, p_void);
  update demo_seed.s_cust set nloans = nloans + 1, last_loan_date = d where n = p_cust;
  perform demo_seed.sim_loan(p_n);
end $$;

create or replace function demo_seed.reset() returns void language plpgsql as $$
begin
  truncate demo_seed.s_ev, demo_seed.s_loan, demo_seed.s_appr, demo_seed.s_cust restart identity;
end $$;

create or replace function demo_seed.gen_days(p_from date, p_to date, p_seed int default 20260711) returns jsonb language plpgsql as $$
#variable_conflict use_column
declare
  d date; start_d date := date '2026-07-01';
  cutoff timestamptz := timestamptz '2026-10-27 15:30:00+08';
  n_loan int; n_cust int; cnt int; k int; mins int[]; base numeric[] := array[11, 9, 9, 9, 10, 12, 15];
  mult numeric; dom int; dow int; ts timestamptz; cust int; pnew double precision; tier text; voided boolean; open_days int := 0;
begin
  if p_from = start_d then
    if exists (select 1 from demo_seed.s_loan) then raise exception 'Staging is not empty; run demo_seed.reset() first.'; end if;
    perform set_config('demo.s', p_seed::text, false);
    perform set_config('demo.fixes', '0', false);
  else
    perform set_config('demo.s', (select v from demo_seed.kv where k = 'rng'), false);
    perform set_config('demo.fixes', (select v from demo_seed.kv where k = 'fixes'), false);
  end if;
  select coalesce(max(n), 0) into n_loan from demo_seed.s_loan;
  select coalesce(max(n), 0) into n_cust from demo_seed.s_cust;
  d := p_from;
  while d <= p_to loop
    if not demo_seed.is_closed(d) then
      open_days := open_days + 1;
      dow := extract(dow from d)::int; dom := extract(day from d)::int;
      mult := 0.93;
      if dom in (14, 15, 16, 29, 30, 31) then mult := mult * 1.3; elsif dom in (1, 2) then mult := mult * 1.1; end if;
      if d between date '2026-08-10' and date '2026-09-05' then mult := mult * 1.2; end if;
      cnt := greatest(3, round(base[dow + 1] * mult * (0.75 + 0.5 * demo_seed.r()))::int);
      mins := array[]::int[];
      for k in 1..cnt loop
        mins := mins || case when dow = 0 then demo_seed.ri(540, 870) else demo_seed.ri(485, 1010) end;
      end loop;
      select array_agg(m order by m) into mins from unnest(mins) m;
      for k in 1..cnt loop
        ts := demo_seed.mkts(d, mins[k]) + make_interval(secs => demo_seed.ri(0, 59));
        exit when ts > cutoff;
        pnew := greatest(0.2, 0.5 - 0.0025 * (d - start_d));
        cust := null;
        if n_cust > 0 and demo_seed.r() >= pnew then cust := demo_seed.pick_customer(ts); end if;
        if cust is null then
          n_cust := n_cust + 1;
          tier := demo_seed.wpk(array['ordinary','regular','vip','delinquent','onetimer'], array[60,14,6,4,16]);
          perform demo_seed.mk_customer(n_cust, ts - interval '3 minutes', tier);
          cust := n_cust;
        end if;
        n_loan := n_loan + 1;
        voided := n_loan in (211, 667);
        perform demo_seed.mk_loan(n_loan, cust, ts, voided);
      end loop;
    end if;
    d := d + 1;
  end loop;
  insert into demo_seed.kv (k, v) values ('rng', current_setting('demo.s')), ('fixes', current_setting('demo.fixes'))
    on conflict (k) do update set v = excluded.v;
  return jsonb_build_object('open_days', open_days, 'loans', n_loan, 'customers', n_cust);
end $$;
