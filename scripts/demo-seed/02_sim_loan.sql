-- Demo seed, part 2: simulate one loan's life exactly as the app's functions would
-- (record_payment, renew_loan, capitalize_loan, redeem_loan, reinstate_loan, forfeit_loan, run_default_detection).

create or replace function demo_seed.accrue(p numeric, i numeric, thr date, rate numeric, ond date, out i2 numeric, out thr2 date)
language plpgsql immutable as $$
declare n int; t numeric;
begin
  i2 := i; thr2 := thr;
  if p > 0 and ond > thr then
    n := ceil((ond - thr)::numeric / 30)::int;
    t := round(p * rate / 100, 2);
    i2 := i + n * t;
    thr2 := thr + n * 30;
  end if;
end $$;

create or replace function demo_seed.ev(p_n int, p_at timestamptz, p_kind text, p_actor uuid, p_amount numeric, p_ipart numeric, p_ppart numeric,
  p_receipt text, p_lost boolean, p_extra jsonb, p_bal numeric, p_owed numeric, p_thr date, p_mat date, p_ext int, p_st text, p_late int,
  p_prevmat date, p_inv text, p_note text) returns void language sql as $$
  insert into demo_seed.s_ev (loan_n, at, kind, actor, amount, ipart, ppart, receipt, lost, extra, bal, owed, through, maturity, ext, status, late, prev_maturity, inv_new, note)
  values (p_n, p_at, p_kind, p_actor, p_amount, p_ipart, p_ppart, p_receipt, p_lost, p_extra, p_bal, p_owed, p_thr, p_mat, p_ext, p_st, p_late, p_prevmat, p_inv, p_note) $$;

-- time of an event on date d (09:05-16:40 Manila), always after the previous event
create or replace function demo_seed.evts(d date, after_ts timestamptz) returns timestamptz language plpgsql as $$
declare ts timestamptz;
begin
  ts := demo_seed.mkts(d, demo_seed.ri(545, 1000)) + make_interval(secs => demo_seed.ri(0, 59));
  if ts <= after_ts then ts := after_ts + interval '4 minutes'; end if;
  return ts;
end $$;

create or replace function demo_seed.sim_loan(p_n int) returns void language plpgsql as $$
declare
  L demo_seed.s_loan%rowtype;
  today date := date '2026-10-27';
  cutoff timestamptz := timestamptz '2026-10-27 15:30:00+08';
  admin_id uuid := demo_seed.u(1, 1);
  rate numeric; grace int;
  P numeric; I numeric; thr date; mat date; ext int := 0; late int := 0; st text := 'active';
  lastd date; lastts timestamptz; ts timestamptz;
  terms int := 0; partials int := 0; guard int := 0;
  w double precision[]; act text; adate date; amt numeric; ip numeric; pp numeric; chunk numeric; rcp text; lostf boolean; lostany boolean := false;
  actor uuid; inv text := 'pawned'; salt int := 0;
  newmat date; ddate date; rdate date; fdate date; capv numeric; newp numeric; newi numeric; fixd date;
  defaulted_at timestamptz; reinstated_at timestamptz; redeemed_at timestamptz; forfeited_at timestamptz;
  rp double precision; a record; nfix int; wrong numeric;
begin
  select * into L from demo_seed.s_loan where n = p_n;
  rate := L.rate; grace := L.grace; P := L.principal; I := L.owed; thr := L.through; mat := L.maturity;
  lastd := L.loan_date; lastts := L.created_at;
  perform demo_seed.ev(p_n, L.created_at, 'create', L.created_by, L.principal, 0, 0, null, false, null, P, I, thr, mat, 0, 'active', 0, null, 'pawned', null);

  if L.voided then
    ts := L.created_at + make_interval(mins => demo_seed.ri(18, 55));
    perform demo_seed.ev(p_n, ts, 'void', admin_id, L.principal, 0, 0, null, false, jsonb_build_object('reason', 'VOID: wrong item attached to ticket; cancelled and item returned to customer'), 0, 0, thr, mat, 0, 'redeemed', 0, null, 'redeemed', null);
    update demo_seed.s_loan set balance = 0, owed = 0, status = 'redeemed', redeemed_at = ts, inv_status = 'redeemed', updated_at = ts,
      archived_at = ts + interval '2 minutes', archived_by = admin_id, archive_reason = 'VOID: wrong item attached to ticket; cancelled and item returned to customer' where n = p_n;
    return;
  end if;

  loop
    guard := guard + 1;
    exit when guard > 14 or terms > 5;
    -- ---- decide what the customer does next ----
    if st = 'reinstated' then
      w := array[0.55, 0.25, 0.05, 0, 0, 0.15];
    elsif L.tier = 'vip' then w := array[0.50, 0.34, 0.06, 0.06, 0.03, 0.01];
    elsif L.tier = 'regular' then w := array[0.45, 0.32, 0.08, 0.07, 0.05, 0.03];
    elsif L.tier = 'delinquent' then w := array[0.12, 0.18, 0.10, 0.20, 0.10, 0.30];
    else w := array[0.42, 0.28, 0.08, 0.08, 0.06, 0.08];
    end if;
    if terms > 0 and st <> 'reinstated' then w[1] := w[1] * 1.4; w[2] := w[2] * 0.7; end if;
    if partials >= 2 or mat - lastd < 4 or st = 'reinstated' then w[3] := case when st = 'reinstated' then w[3] else 0 end; end if;
    act := demo_seed.wpk(array['redeem','renew','partial','late_redeem','late_renew','abandon'], w);

    if act = 'abandon' then
      if st = 'reinstated' then exit; end if;
    else
      if st = 'reinstated' then
        adate := lastd + demo_seed.ri(0, 20);
      elsif act = 'redeem' then
        adate := least(mat, lastd + demo_seed.ri(2, greatest(2, mat - lastd)));
      elsif act = 'renew' then
        adate := greatest(lastd + 1, mat - demo_seed.ri(0, 3));
      elsif act = 'partial' then
        adate := lastd + demo_seed.ri(2, greatest(2, mat - lastd - 1));
      else
        adate := greatest(lastd + 1, mat + demo_seed.ri(1, grace));
      end if;
      adate := demo_seed.nopen(adate);
      if adate > today then exit; end if;
      if st <> 'reinstated' and adate > mat + grace then act := 'abandon'; end if;
    end if;

    -- ---- the default path (no payment before the grace period ended) ----
    if act = 'abandon' then
      ddate := demo_seed.nopen(mat + grace + 1);
      if ddate > today then exit; end if;
      ts := greatest(demo_seed.mkts(ddate, 500 + demo_seed.ri(0, 40)), lastts + interval '5 minutes');
      if ts > cutoff then exit; end if;
      st := 'defaulted'; inv := 'forfeited'; defaulted_at := ts;
      perform demo_seed.ev(p_n, ts, 'default', null, null, null, null, null, false, null, P, I, thr, mat, ext, st, late, null, inv, null);
      rp := case L.tier when 'vip' then 0.5 when 'regular' then 0.35 when 'delinquent' then 0.10 else 0.18 end;
      if demo_seed.ch(rp) then
        rdate := demo_seed.nopen(ddate + demo_seed.ri(1, 14));
        if rdate > today then exit; end if;
        ts := demo_seed.evts(rdate, ts);
        if ts > cutoff then exit; end if;
        select a2.i2, a2.thr2 into I, thr from demo_seed.accrue(P, I, thr, rate, rdate) a2;
        st := 'reinstated'; inv := 'pawned'; reinstated_at := ts; lastd := rdate; lastts := ts;
        actor := demo_seed.u(1, 3 + demo_seed.ri(0, 2));
        perform demo_seed.ev(p_n, ts, 'reinstate', actor, null, null, null, null, false, null, P, I, thr, mat, ext, st, late, null, inv, null);
        continue;
      else
        fdate := demo_seed.nopen(ddate + demo_seed.ri(12, 45));
        if fdate <= today then
          ts := demo_seed.mkts(fdate, 940 + demo_seed.ri(0, 25));
          if ts <= cutoff then
            st := 'forfeited'; forfeited_at := ts;
            perform demo_seed.ev(p_n, ts, 'forfeit', admin_id, null, null, null, null, false, null, P, I, thr, mat, ext, st, late, null, inv, null);
            lastts := ts;
          end if;
        end if;
        exit;
      end if;
    end if;

    ts := demo_seed.evts(adate, lastts);
    if ts > cutoff then
      ts := cutoff - make_interval(mins => demo_seed.ri(1, 40));
      if ts <= lastts then exit; end if;
    end if;
    actor := demo_seed.u(1, 3 + demo_seed.ri(0, 2));
    salt := salt + 1;
    select a2.i2, a2.thr2 into I, thr from demo_seed.accrue(P, I, thr, rate, adate) a2;

    if act in ('renew', 'late_renew') and demo_seed.ch(0.07) and I > 0 and st <> 'reinstated' then
      -- capitalize: unpaid interest becomes principal, no cash moves
      capv := round(I, 2); newp := round(P + capv, 2);
      newmat := case when mat >= adate then mat + 30 else adate + 30 end;
      newi := round(newp * rate / 100, 2);
      perform demo_seed.ev(p_n, ts, 'cap', actor, capv, 0, 0, null, false, jsonb_build_object('new_interest', newi), newp, newi, newmat, newmat, ext + 1, 'extended', late, mat, 'extended', null);
      P := newp; I := newi; mat := newmat; thr := newmat; ext := ext + 1; st := 'extended'; inv := 'extended'; terms := terms + 1;
      lastd := adate; lastts := ts;
    elsif act in ('renew', 'late_renew') then
      newmat := greatest(mat, thr) + 30;
      newi := round(P * rate / 100, 2);
      amt := I;
      rcp := case when amt > 0 then demo_seed.rcpt(ts, p_n, salt) end;
      if adate > mat then late := late + 1; end if;
      perform demo_seed.ev(p_n, ts, 'renew', actor, amt, amt, 0, rcp, false, jsonb_build_object('new_interest', newi), P, newi, newmat, newmat, ext + 1, 'extended', late, mat, 'extended', null);
      I := newi; mat := newmat; thr := newmat; ext := ext + 1; st := 'extended'; inv := 'extended'; terms := terms + 1;
      lastd := adate; lastts := ts;
    elsif act in ('redeem', 'late_redeem') then
      amt := round(P + I, 2); ip := I; pp := P;
      lostf := demo_seed.ch(0.03); lostany := lostany or lostf;
      rcp := demo_seed.rcpt(ts, p_n, salt);
      if adate > mat then late := late + 1; end if;
      perform demo_seed.ev(p_n, ts, 'pay', actor, amt, ip, pp, rcp, lostf, null, 0, 0, thr, mat, ext, st, late, null, inv, null);
      P := 0; I := 0;
      ts := ts + interval '2 minutes';
      st := 'redeemed'; inv := 'redeemed'; redeemed_at := ts;
      perform demo_seed.ev(p_n, ts, 'redeem', actor, null, null, null, null, lostf, null, 0, 0, thr, mat, ext, st, late, null, inv, null);
      lastts := ts;
      exit;
    else
      -- partial payment
      partials := partials + 1;
      rp := demo_seed.r();
      if rp < 0.06 and I > 200 then
        amt := greatest(100, round(I * (0.3 + 0.5 * demo_seed.r()) / 50) * 50); ip := amt; pp := 0;
      elsif rp < 0.55 or P < 1500 then
        amt := I; ip := I; pp := 0;
      else
        chunk := greatest(500, round(P * (0.1 + 0.4 * demo_seed.r()) / 500) * 500);
        if chunk > P - 500 then chunk := 0; end if;
        amt := I + chunk; ip := I; pp := chunk;
      end if;
      if amt <= 0 then lastd := adate; continue; end if;
      rcp := demo_seed.rcpt(ts, p_n, salt);
      if adate > mat then late := late + 1; end if;
      nfix := coalesce(nullif(current_setting('demo.fixes', true), ''), '0')::int;
      fixd := demo_seed.nopen(adate + 1);
      if pp >= 1000 and nfix < 3 and fixd <= today and P - pp - 1000 >= 0 and demo_seed.ch(0.12) then
        -- cashier typed 1,000 too much; an Admin corrects it the next day (payment edited, ledger adjusted)
        wrong := 1000;
        perform demo_seed.ev(p_n, ts, 'pay', actor, amt + wrong, ip, pp + wrong, rcp, false,
          jsonb_build_object('final_amount', amt, 'final_p', pp, 'final_i', ip), P - pp - wrong, I - ip, thr, mat, ext, st, late, null, inv, null);
        P := P - pp - wrong; I := I - ip;
        lastts := ts;
        ts := demo_seed.mkts(fixd, 600 + demo_seed.ri(0, 120));
        P := P + wrong;
        perform demo_seed.ev(p_n, ts, 'pay_fix', admin_id, wrong, 0, 0, rcp, false,
          jsonb_build_object('reason', 'Cashier keyed ' || to_char(amt + wrong, 'FM999,990.00') || ' instead of ' || to_char(amt, 'FM999,990.00'), 'old_amount', amt + wrong, 'new_amount', amt),
          P, I, thr, mat, ext, st, late, null, inv, null);
        perform set_config('demo.fixes', (nfix + 1)::text, false);
        lastd := fixd; lastts := ts;
      else
        perform demo_seed.ev(p_n, ts, 'pay', actor, amt, ip, pp, rcp, false, null, P - pp, I - ip, thr, mat, ext, st, late, null, inv, null);
        P := P - pp; I := I - ip;
        lastd := adate; lastts := ts;
      end if;
    end if;
  end loop;

  update demo_seed.s_loan set balance = P, owed = I, through = thr, maturity = mat, ext = sim_loan.ext, status = st, late = sim_loan.late,
    lost = lostany, defaulted_at = sim_loan.defaulted_at, reinstated_at = sim_loan.reinstated_at, redeemed_at = sim_loan.redeemed_at,
    forfeited_at = sim_loan.forfeited_at, inv_status = inv, updated_at = lastts where n = p_n;
end $$;
