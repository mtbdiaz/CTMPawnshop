// PR7: the help texts for the (i) buttons, in one place so the Customers list and the customer profile say the same thing.
// AML check (i) on the Customers list
export const AML_HELP =
  "Checked once, when the customer is registered: the name and ID number are compared with the watchlist. Clear = no match. Flagged = possible match, so an Admin should review before lending. The check date shows when you hover the badge.";
// Score (i) on the Customers list and next to the score on the profile
export const SCORE_HELP =
  "A guide from this customer's own loans at this shop, worked out each time the page opens. It is not a credit rating. Everyone with at least one loan starts at 60 (Fair). On-time redemptions and renewals add points; late payments, reinstated or defaulted loans, and loans overdue now take points away. Results older than 2 years count half. Excellent 85+, Good 70 to 84, Fair 50 to 69, Risky below 50. No history = no loans yet, not a bad score.";
// Flags / Compliance (i) on the Customers list
export const FLAGS_HELP =
  "Blacklisted = cannot get new loans. History warning = has paid late, been reinstated or defaulted before. None = neither. On screens narrower than 1536px this column is called Compliance and also shows the AML result (AML clear or AML flagged).";
