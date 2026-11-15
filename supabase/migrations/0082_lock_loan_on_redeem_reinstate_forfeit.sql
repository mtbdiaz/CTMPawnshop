-- 0082 (Nov 15, 2026, Matt + Claude): review of the 2% liquidated damages (0073), part 2.
-- record_payment, renew_loan, capitalize_loan and waive_penalty lock the loan row (FOR UPDATE) before they read it, so two
-- people acting on the same loan at the same moment wait for each other. redeem_loan, reinstate_loan and forfeit_loan did
-- not: both could read "defaulted" and then one would overwrite the other (for example an Admin forfeits while a Cashier
-- reinstates, or a payment lands while a loan is being redeemed). They now lock the row first, like the others.
-- No other change; the checks and messages are the same. Safe to run twice.
do $lock$
declare f text; d text;
begin
  foreach f in array array['redeem_loan', 'reinstate_loan', 'forfeit_loan'] loop
    d := pg_get_functiondef(('public.' || f)::regproc);
    if position('where id = p_loan_id for update;' in d) = 0 then
      if position('select * into l from public.loans where id = p_loan_id;' in d) = 0 then
        raise exception '0082: the loan read was not found in %', f;
      end if;
      execute replace(d, 'select * into l from public.loans where id = p_loan_id;', 'select * into l from public.loans where id = p_loan_id for update;');
    end if;
  end loop;
end $lock$;
