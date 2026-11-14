# CTM PawnTrack — User Guide

A quick reference for CTM Pawnshop staff. For technical/deployment details see `CLAUDE.md`.

## Signing in

Go to the app URL and sign in with the email and password your Admin gave you.
If you forgot your password, ask an Admin to reset it from **User Accounts** —
you'll be asked to set a new password the next time you log in.

Your session automatically signs you out after 15 minutes of inactivity, so
sensitive data isn't left on an unattended screen.

## Roles

| Role | Can do |
|---|---|
| **Admin** | Everything — plus System Settings, User Accounts, Compliance review, Reports |
| **Operator** | Register/edit customers, record inventory audits, prepare auction batches, record non-loan expenses/revenue |
| **Cashier** | Create loans, record payments, process extensions/redemptions, send reminders |
| **Appraiser** | Record item appraisals, capture photos |

The left sidebar only shows the screens your role can use. Your **Dashboard**
shows what needs attention today (overdue loans, loans due this week, flagged
items) plus quick-action buttons for your role. Every page has a breadcrumb
trail at the top so you can step back.

## The typical transaction flow

1. **Customers** → Register the customer (or find their existing profile). The
   system automatically runs an AML check and blocks the flow if they're
   blacklisted.
2. **Appraisals** → Record the item's weight/karat/purity, attach photos. The
   system calculates a suggested value and loan range from the current gold
   price. If the purity looks wrong for the claimed karat, the item is
   flagged and an Admin must clear or confirm it before a loan can be made.
3. **Loans** → From the appraisal, click **Create loan** (amount capped at
   the suggested maximum). The ticket opens — click **Print pawn ticket**.
4. **Payments** → Find the ticket (Loans search by ticket number or name),
   use the quick button or **Pay in full**, or type an amount. The quick
   button is **Interest only** on a normal loan and **Damages and interest**
   when the loan owes liquidated damages (see below). A payment is used in
   this order: **liquidated damages → interest → principal**. The confirm
   box shows exactly how the payment is split before you save it. Each
   payment has a **Print receipt** button in the payment history.
5. **Renewals** → If the customer isn't ready to redeem, **Renew loan** on the
   ticket: collect the amount shown, which is all the interest owed plus any
   liquidated damages owed (one receipt is recorded), and the due date moves
   out 30 days. Renew works until the grace days end; after that, only a
   loan that was Defaulted and then Reinstated can still be renewed.
   **Capitalize** (adding unpaid interest to the principal) is refused while
   liquidated damages are owed; collect them with Record payment first.
6. **Redemption** → Once the balance reaches ₱0, redeem the item — it's
   marked released in the vault.
7. If a loan passes its due date **and** its grace period with no payment or
   extension, it's automatically marked defaulted and the item moves toward
   forfeiture — no manual tracking needed.

If a customer has lost their physical ticket, both the payment and
redemption forms have a "lost ticket" checkbox that verifies their identity
against the ID number on file instead.

### Liquidated damages (late charge)

This is the clause on CTM's pawn ticket: if the loan is not paid on time,
the customer pays liquidated damages on top of the interest.

- **When it starts:** the day after the grace days end (due date + grace
  days). During the grace days there are no liquidated damages, only
  interest.
- **How much:** the loan's liquidated damages rate (2% for loans so far) of
  the **principal still unpaid**, for every 30 days. Any part of 30 days
  counts as a full 30 days. Example: ₱10,000 unpaid, 1 day after the grace
  days end = ₱200; 31 days after = ₱400.
- **Where you see it:** "To redeem today" on the loan page, Owed now on the
  Loans list, Dashboard and reports, the payment confirm box and the
  receipt ("To liq. damages").
- **Paying it:** every payment clears liquidated damages first. Redeem needs
  the principal, interest and liquidated damages all paid. A renewal
  collects them with the interest and starts the count again from the new
  due date.
- It keeps adding up while a loan is Defaulted. It stops when the loan is
  redeemed or forfeited.

## Inventory

**Inventory** shows every pawned item's vault location and status. Admin and
Operator can run a **Physical Audit** (check items in the vault against the
system) and batch **forfeited** items for the next auction.

## Finance

**Finance** shows today's cash position and the full running-balance ledger.
Operators can log non-loan expenses/revenue there too.

## Compliance (Admin)

- **Suspicious Activity** — the system automatically flags unusually rapid
  loan activity by one customer; Admin reviews and dismisses, marks for
  investigation, or blacklists.
- **Due-Date Reminders** — loans maturing within 3 days appear here; there's
  no email/SMS sending configured — call or text the customer (the phone
  number is on the list), then click **Mark reminded**. Cashiers can open
  this screen from their sidebar.
- **Audit Trail** — a read-only log of every create/update/delete across the
  system, for dispute resolution or compliance review.

## Reports (Admin)

Outstanding Loans, Overdue Loans, Inventory Aging, Financial Summary,
Compliance/AML, and a Trends & Analytics dashboard. Every report has a
**Print** button — choose "Save as PDF" in your browser's print dialog to
export a copy.

## System Settings (Admin)

Set the current gold price, monthly interest rate, loan-to-value percentage,
grace period and **liquidated damages (% per 30 days)** here. These drive
every appraisal and loan calculation system-wide — update the gold price
regularly.

Interest rate, grace days and liquidated damages % are copied onto each loan
when it is created, so changing them affects **new loans only**; existing
loans keep the values they were issued with. (Loans that existed when
liquidated damages were added on Nov 14, 2026 were given 2%.) The liquidated
damages % can be 0 to 100; 0 turns the charge off for new loans.

## User Accounts (Admin)

Create staff accounts (a temporary password is shown once — share it
securely), edit a staff member's name/role, or deactivate an account when
someone leaves (this immediately blocks their login).
