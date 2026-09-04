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

A screen you don't have permission for simply won't appear in your navigation
bar, and opening its URL directly redirects you back to the dashboard.

## The typical transaction flow

1. **Customers** → Register the customer (or find their existing profile). The
   system automatically runs an AML check and blocks the flow if they're
   blacklisted.
2. **Appraisals** → Record the item's weight/karat/purity, attach photos. The
   system calculates a suggested value and loan range from the current gold
   price. If the purity looks wrong for the claimed karat, the item is
   flagged and an Admin must clear or confirm it before a loan can be made.
3. **Loans** → Create the loan against the appraised item (amount capped at
   the suggested maximum), print the pawn ticket.
4. **Payments** → Record customer payments as they come in — interest is
   settled first, any remainder reduces principal.
5. **Extensions** → If the customer isn't ready to redeem but wants to keep
   the item pawned, extend the loan (recalculates the due date, charges one
   more interest period).
6. **Redemption** → Once the balance reaches ₱0, redeem the item — it's
   marked released in the vault.
7. If a loan passes its due date **and** its grace period with no payment or
   extension, it's automatically marked defaulted and the item moves toward
   forfeiture — no manual tracking needed.

If a customer has lost their physical ticket, both the payment and
redemption forms have a "lost ticket" checkbox that verifies their identity
against the ID number on file instead.

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
  no email/SMS sending configured, so "Send reminder" just logs that a
  reminder was issued (see a staff member should still call/text the
  customer directly for now).
- **Audit Trail** — a read-only log of every create/update/delete across the
  system, for dispute resolution or compliance review.

## Reports (Admin)

Outstanding Loans, Overdue Loans, Inventory Aging, Financial Summary,
Compliance/AML, and a Trends & Analytics dashboard. Every report has a
**Print** button — choose "Save as PDF" in your browser's print dialog to
export a copy.

## System Settings (Admin)

Set the current gold price, monthly interest rate, loan-to-value percentage,
and grace period here. These drive every appraisal and loan calculation
system-wide — update the gold price regularly.

## User Accounts (Admin)

Create staff accounts (a temporary password is shown once — share it
securely), edit a staff member's name/role, or deactivate an account when
someone leaves (this immediately blocks their login).
