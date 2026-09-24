# CTM PawnTrack — QA Audit Log (Post-Sprint-10 Full Sweep)

Consolidated from a full audit of all 40 backlog items (PB-1..PB-40) against
`/docs/2026-SoftEng-CTMPawnshop-Sprint.xlsx` and
`/docs/CTM_PawnTrack_Comprehensive_Feature_List.docx`, verified against
actual code, live RLS policies, and the live Supabase project's seeded demo
data. Full per-item detail lives in the three source files this consolidates:
`QA_LOG_part1_auth_customer_appraisal.md`, `QA_LOG_part2_loan_inventory.md`,
`QA_LOG_part3_finance_compliance_reporting.md` — kept for detailed evidence,
this file is the authoritative summary.

**Result: 40/40 PB items PASS.** 4 real defects found and fixed (2 RLS
authorization gaps, 1 non-atomic multi-table write, 1 missing audit-trigger
coverage), 1 previously-missing feature built, several already-documented
placeholders reconfirmed and correctly left flagged (not silently finalized).

## Sprint 1 — Authentication & Access + System Configuration

| PB | Item | Status |
|---|---|---|
| PB-1 | Login | PASS — note: client-side lockout feature was intentionally removed by the project owner (commits `e2546e2`/`3965be8`/`737009e`); CLAUDE.md/SPRINT_PROGRESS.md text describing it is now stale, corrected below. Real Supabase auth error now surfaces on failure. |
| PB-2 | Password Reset (Admin-assisted) | PASS |
| PB-3 | RBAC | PASS — verified both UI (`requireRole`) and RLS on every table; `profiles` update policy correctly blocks self role-escalation at the DB level. |
| PB-4 | Manage User Accounts | PASS |
| PB-5 | Session Timeout | PASS |
| PB-6 | Configure Business Rules | PASS |

## Sprint 2 — Customer Management

| PB | Item | Status |
|---|---|---|
| PB-7 | Register New Customer | PASS |
| PB-8 | Verify Customer Identity (AML) | PASS (documented placeholder, unchanged) |
| PB-9 | Update Customer Profile | PASS |
| PB-10 | View Transaction History | **MISSING → FIXED.** Page still showed a hardcoded "coming in Sprint 4-5" placeholder despite loan data existing since Sprint 4/5. Now queries `loans`/`loan_payments`/`loan_extensions` per customer. |
| PB-11 | Check Blacklist Status | **PARTIAL → FIXED.** RLS gap: `customers` UPDATE policy (operator/admin, needed for PB-9) allowed a non-admin session to change `is_blacklisted`/`blacklist_reason` directly, bypassing the admin-only app guard. Fixed with a `BEFORE UPDATE` trigger blocking non-admin changes to those two columns specifically. |

## Sprint 3 — Appraisal and Valuation

| PB | Item | Status |
|---|---|---|
| PB-12 | Record Gold Item Details | PASS |
| PB-13 | Capture Item Photo and Notes | PASS |
| PB-14 | Calculate Valuation & Loan Range | PASS **(placeholder formula confirmed still in place, correctly flagged — not finalized; needs real figures from CTM Pawnshop)** |
| PB-15 | Flag Counterfeit Risk | PASS (placeholder purity-tolerance table confirmed still flagged, unchanged) |
| PB-16 | Resolve Counterfeit Flag | **PARTIAL → FIXED.** Same RLS-gap pattern as PB-11: `appraisal_items` UPDATE policy allowed appraiser-or-admin; only admin should resolve a flag. Narrowed to admin-only. |

## Sprint 4 — Loan and Transaction Management (part 1)

| PB | Item | Status |
|---|---|---|
| PB-17 | Create Pawn Loan & Issue Ticket | **PARTIAL → FIXED (critical).** The loan/inventory/cash-flow triple-write was three independent, non-transactional client inserts — a mid-sequence failure could silently orphan an inventory row or a loan with no cash entry. Replaced with a single `security invoker` Postgres function (`create_pawn_loan`, migration `0012`) called via `.rpc()`, so all three writes commit or roll back together. RLS authorization unchanged (still enforced per-table). Swept every other trigger function in the schema for the same missing-`security definer` pattern that caused the earlier `inventory_status_history` bug — no other instance found; that fix (migration `0011`) confirmed solid. |
| PB-18 | Record Customer Payment | PASS (a lower-risk non-atomic multi-write noted but not fixed — see Known Limitations) |
| PB-19 | Process Loan Extension | PASS (same note as PB-18) |

## Sprint 5 — Loan and Transaction Management (part 2)

| PB | Item | Status |
|---|---|---|
| PB-20 | Redeem Pawned Item | PASS |
| PB-21 | Process Loan Default & Forfeiture | PASS **(known limitation confirmed unchanged: runs on page load, not a real scheduler — correctly kept flagged, not silently resolved)** |
| PB-22 | Lost Ticket Alternate Verification | PASS — confirmed the audit-trail requirement (AC2) is genuinely satisfied via PB-31's generic trigger logging the `lost_ticket_used` flag, not just a UI-level check. |

## Sprint 6 — Inventory and Collateral Tracking

| PB | Item | Status |
|---|---|---|
| PB-23 | Register Pawned Item in Inventory | PASS (now backed by the atomic RPC from PB-17) |
| PB-24 | Update Item Status | PASS — `inventory_status_history` `SECURITY DEFINER` trigger fix (migration `0011`) reconfirmed live and firing correctly; no sibling bugs found. |
| PB-25 | Perform Physical Inventory Audit | PASS (non-atomic multi-write noted, lower risk, not fixed) |
| PB-26 | Prepare Forfeited Items for Auction | PASS (same note) |

## Sprint 7 — Financial and Accounting

| PB | Item | Status |
|---|---|---|
| PB-27 | Record Cash Flow Transaction | PASS |
| PB-28 | Track Daily Cash Position | PASS — verified against 16 live seeded cash-flow rows |
| PB-29 | Record Operating Expenses & Revenue | PASS |
| PB-30 | Generate Financial Ledger Entries | PASS |

## Sprint 8 — Compliance and Security

| PB | Item | Status |
|---|---|---|
| PB-31 | Log System Transaction (Audit Trail) | **BROKEN → FIXED (critical).** Original Sprint 8 migration wired the audit trigger to only 11 tables; 5 tables added in later sprints (`inventory_status_history`, `physical_inventory_audit_items`, `auction_batch_items`, `suspicious_activity_flags`, `reminder_log`) had zero audit coverage despite having real seeded rows — confirmed via `audit_log` row counts (0 vs. expected). Fixed with migration `0013`, adding the same trigger pattern to all 5 tables; verified live. Historical pre-fix changes to those 5 tables are not retroactively logged (never captured, cannot be reconstructed) — noted as a permanent historical gap, not a live one. |
| PB-32 | Flag & Review Suspicious Activity | PASS |
| PB-33 | Send Due-Date Reminder Notification | PASS **(known limitation confirmed unchanged: in-app log only, no email/SMS provider available — correctly kept flagged)** |

## Sprint 9 — Reporting and Management Insights

| PB | Item | Status |
|---|---|---|
| PB-34 | Outstanding Loans Report | PASS |
| PB-35 | Overdue Loans Report | PASS |
| PB-36 | Inventory Aging Report | PASS |
| PB-37 | Financial Summary | PASS |
| PB-38 | Compliance/AML Report | PASS |
| PB-39 | Trends & Analytics Dashboard | PASS — all four chosen metrics (redemption rate, forfeiture rate, average loan size, monthly volume) hand-verified against live seeded data (e.g. redemption rate 1/2 concluded = 50.0%, avg loan size ₱15,562.50 across 8 loans) and matched exactly. |
| PB-40 | Export or Print Reports | PASS |

## Sprint 10 — UAT, bug fixing, backup verification, deployment, docs

Re-verified as part of this sweep rather than re-audited item by item (no new PB IDs): full test suite (82/82), `tsc`/`next build` typecheck, lint, and a live-data Supabase security advisor pass all clean after every fix above. Production deployment and Vercel env vars were previously fixed (framework preset, table grants) and are re-verified in Phase 5 below.

## Fixes applied this sweep (all live in Supabase + committed as migrations)

1. `supabase/migrations/0012_qa_part1_rls_fixes.sql` — `appraisal_items` UPDATE narrowed to admin-only (PB-16); `customers` blacklist-column guard trigger (PB-11).
2. `supabase/migrations/0012_atomic_create_loan.sql` — atomic `create_pawn_loan()` RPC (PB-17).
3. `supabase/migrations/0013_qa_part3_audit_trigger_coverage.sql` — audit triggers added to 5 previously-uncovered tables (PB-31).
4. `app/dashboard/customers/[id]/page.tsx` — real transaction history query replacing placeholder (PB-10).
5. `app/dashboard/loans/actions.ts` — `createLoan` now calls the atomic RPC instead of three separate inserts.

## Known Limitations (intentionally left flagged, not silently resolved)

- **PB-14** valuation formula and **PB-15** purity-tolerance ranges are still placeholders (`// TODO: confirm ... with CTM Pawnshop`) — need real figures from the client before production use with real loan amounts.
- **PB-21** default/forfeiture detection runs on page load, not a real scheduler — needs a Supabase Edge Function + `pg_cron` or Vercel Cron Job before production.
- **PB-33** reminders are in-app log only — no email/SMS provider configured (none available in this environment; needs a provider + credentials from the client).
- **PB-8** AML check is a keyword-based placeholder, not a real sanctions-list integration.
- **PB-18/19/25/26** perform their multi-table writes as separate non-transactional statements (same class of risk as the PB-17 bug that was fixed, but lower blast radius: single financial event or an audit record, not a 3-table state machine). Not fixed in this pass since PB-17 was the specific item flagged as critical; a natural follow-up would wrap each in its own atomic RPC the same way.
- `lib/auth/login-attempts.ts` is now dead code (the login-lockout feature it implements was deliberately removed from `app/login/page.tsx` by the project owner) — left in place as unused/harmless, flagged for cleanup.
- A `service_role` key was previously committed to `.env.local` on `main` in an earlier session and later removed from the working tree; if it has not yet been rotated in the Supabase dashboard, it should be — git history retains it regardless of the later removal commit.

## Secrets scan

Full-repo grep for `service_role` values, `sb_secret_`, JWT-prefix `eyJ`, and inline password literals found **no live secrets in tracked source** — all matches were docs/comments describing the pattern, SQL role-name grants, or test fixtures. `.env.local` confirmed gitignored.

---

# Pass 3 — System Re-Scan, Navigation & Frontend Polish (2026-09-24)

Prior functional audit (40/40 PASS) trusted as the baseline. This pass re-ran
the suite, re-scanned every screen × role for broken behaviour, then did a
full navigation/UX and visual redesign.

## Verification method & known blocker

- **Known blocker — live click-through from this environment:** the sandbox's
  network policy denies both `*.supabase.co` and `*.vercel.app`, so no browser
  in this session can sign in to the live app. Verification instead used:
  full Vitest suite, `tsc`, `eslint`, `next build`, a route-by-route read of
  every page's role guard against what it renders, a local Chromium render of
  the new design system with sample data (desktop 1440px, tablet 820px, print
  media, login) with zero console errors, Supabase SQL checks, and Vercel
  runtime-error logs after deploy. **Recommended follow-up:** a 10-minute
  manual click-through on the live URL with each of the 4 test accounts.

## Phase 1 — Functional issues found & fixed

| # | Area | Problem | Fix |
|---|---|---|---|
| 1 | Nav / PB-3 | Top nav showed every module to every role. Appraisers saw Finance, and Cashiers/Operators/Appraisers saw Compliance (Admin-only) — clicking just bounced them to the dashboard. Cashiers had **no** link to Due-date reminders, the one compliance screen they're allowed to use. | Single nav config (`lib/nav.ts`) filtered per role. `lib/nav.test.ts` reads every page's `requireRole()` and fails if a nav item and its page guard ever disagree. |
| 2 | Customers | Cashiers & Appraisers were shown "Register customer" and the editable profile form, but the server only allows Operator/Admin — every submit failed. | Register panel and edit form only render for Operator/Admin; others get a read-only profile. |
| 3 | Appraisals | Cashiers & Operators were shown "New appraisal" (server: Appraiser/Admin only). | Gated to Appraiser/Admin. |
| 4 | Loans | Operators & Appraisers were shown "New loan" and payment/renew/redeem forms (server: Cashier/Admin only). | Gated; read-only notice for others. |
| 5 | Inventory | Cashiers & Appraisers saw Physical audit / Auction prep buttons (Operator/Admin only). | Gated. |
| 6 | **PB-19 renewal (regression from the Sept 15 interest fix)** | Extending a loan logged the interest as cash **received** *and* added it to `interest_owed`, so the customer was billed for it twice. | Renewal is now pay-and-renew (`calculateRenewal`): collect the expiring term's unpaid interest (logged as a payment with a receipt and cash entry), move maturity +30 days, owe one fresh term's interest. No live extensions had happened since the regression (checked via SQL), so no data repair was needed. 4 new tests. |
| 7 | Finance / PB-30 | Ledger loaded the **oldest** 200 entries, so once there were more than 200 entries, all recent activity (and the true running balance) was hidden. | Full ledger loaded oldest→newest in 1000-row chunks for a correct running balance, then displayed newest-first with pagination. |
| 8 | Timezone | "Today" used the server's UTC midnight (08:00 in Manila). Finance/dashboard "today" totals reset at 8 AM, Financial Summary ranges were 8 hours off, and loans created before 8 AM were dated the previous day. | `manilaToday()` / `manilaDayStart()` / `manilaDayEnd()` in `lib/format.ts` (+ tests) used for loan dates, today's cash, summary ranges, overdue checks. |
| 9 | PB-33 reminders | Compared maturity at UTC midnight with *now*, so a loan due **today** fell off the reminders list after 8 AM, when it matters most. | Calendar-day comparison (`daysUntilDue`) + tests. |
| 10 | PB-17 item reuse | New-loan picker offered items already redeemed/defaulted/forfeited (a forfeited item belongs to the shop; a returned item needs re-appraisal at today's price). | Picker and `createLoan` server check both require a fresh appraisal per loan. |
| 11 | Inventory aging report | Included redeemed items that are no longer in the vault. | Only items physically held (pawned/renewed/forfeited/queued). |
| 12 | Dark-mode OS users | `globals.css` switched body text to near-white under `prefers-color-scheme: dark` while cards stayed white, making some text invisible. | Light-only theme with explicit colors. |
| 13 | Forms (all) | React 19 wipes `<form action>` inputs on every submit, so a validation error erased everything typed. Errors were a single generic line. | Shared `ActionForm`: keeps values on error, per-field messages next to each input (`validationFailure()` in every action), focuses the first invalid field, disables submit while pending. |
| 14 | User accounts | An Admin could deactivate or demote **their own** account and lock themselves out. | Server guard + role select disabled on your own row. |
| 15 | Printing | The nav header printed on every ticket/report; payments had no printable receipt (PB-18 "issue receipt"). | App shell hidden in print; formal pawn-ticket print layout with terms and signature lines; new receipt page per payment; report letterhead with generated timestamp. |
| 16 | Dashboard | Home was a placeholder paragraph referencing SPRINT_PROGRESS.md. | Real role-aware dashboard (see below). |
| 17 | Missing states | No loading, error, or not-found screens; DB errors silently rendered empty tables. | `loading.tsx` skeleton, `error.tsx` with **Try again**, `not-found.tsx`; list queries now throw to the error boundary instead of looking empty. |

## Phase 2 — Navigation & information architecture

- **Persistent sidebar** on every authenticated screen, grouped Overview /
  Pawn operations / Vault / Finance / Oversight / Administration, with a gold
  active-page indicator (`aria-current`). Collapses to a menu button below 1024px.
- **Role-filtered menus** — each role only sees what it can open.
- **Breadcrumbs + page titles** on every screen; Dashboard is one click away
  (sidebar logo, "Dashboard" item, first breadcrumb).
- **Task chains shortened**:
  - Cashier, "take a payment": dashboard → *Needs attention* row or Loans search
    (ticket # **or** customer name) → ticket → **Interest only / Pay in full**
    buttons → receipt. 2–3 clicks; previously required finding the customer and
    then hunting for the loan (customer history didn't link to loans).
  - New customer → profile opens automatically → **New appraisal** button
    (customer pre-selected) → appraisal result → **Create loan** button (item
    pre-selected) → ticket opens with a "print it now" banner.
  - Customer profile now links every loan and appraisal; loans link to the
    customer; inventory rows link to their loan; ledger rows link to their loan;
    report rows link to the record.
- **No dead ends:** every empty state explains what's next; every detail page has
  breadcrumbs back; error pages offer Try again / Back to dashboard.
- **Lists**: search (customers by name/phone/ID; loans by ticket/customer),
  status filter tabs (loans, inventory, appraisals, compliance), sortable
  columns (customers, loans), pagination (25–50/page) on customers, loans,
  appraisals, inventory, ledger, audit trail.

## Phase 3 — Visual polish (design decisions made autonomously)

- **Brand**: extended the original HTML prototype's identity: navy
  (`#0f2040` family) + gold (`#d4a429` family), Playfair Display for page
  titles, DM Sans for UI, DM Mono for ticket/receipt numbers, tabular figures
  for money. Defined once as Tailwind theme tokens in `app/globals.css`.
- **One component system** (`components/ui.tsx`, `components/form.tsx`):
  buttons (primary navy / secondary / danger red / success green), cards,
  stat tiles, tables, badges, alerts, empty states, pagination, filter tabs.
  Every screen was rebuilt on these, so the sprint-by-sprint styling drift is gone.
- **Status visibility**: danger states (blacklisted, defaulted/forfeited,
  counterfeit pending, overdue) use **solid red badges with a warning icon**
  plus row highlighting and never rely on color alone. Warnings (AML flag,
  queued for auction, in grace) use amber with text labels.
- **Money** is always `₱1,234.50` (2 decimals, en-PH); dates `Sep 24, 2026` in Manila time.
- **Destructive/irreversible actions confirm in a modal**: blacklist / remove
  from blacklist, confirm/clear counterfeit, deactivate account, reset password,
  renew loan, redeem item, create auction batch, save business rules.
- **Toasts** confirm every successful action (bottom-right, auto-dismiss, `aria-live`).
- **Live previews**: new appraisal shows the valuation and a counterfeit
  warning while typing; new loan shows a ticket summary (principal + interest
  = amount to redeem); renewal shows exactly what's collected and the new due date.
- **Accessibility**: labelled controls, `aria-invalid`/`aria-describedby` on
  errors, visible focus rings, keyboard-operable dialogs (native `<dialog>`,
  Esc to close), `sr-only` labels on icon/inline inputs, active nav marked `aria-current`.
- **Copy**: "Extend" is now "Renew" in the UI (PH pawnshop terminology), and
  "Send reminder" is "Mark reminded" with a note to call/text, because no SMS
  provider exists and the old label implied a message was sent.

## Final validation (local)

- `npm test`: **112/112** passing (was 77; +35 new: nav/permission sync,
  formatting & Manila dates, validation errors, renewal math, reminder days).
- `npx tsc --noEmit`: clean (only the known `LayoutProps` generated-type artifact).
- `npm run lint`: clean. `npm run build`: clean, 27 routes (new receipt route).

## Remaining known limitations (unchanged, still flagged)

PB-14 valuation formula & PB-15 purity bands are placeholders; PB-21 default
detection runs on Loans page load (no scheduler); PB-33 has no SMS/email
provider; PB-8 AML is a keyword placeholder; PB-18/25/26 multi-table writes
aren't wrapped in a transaction (lower-risk than the fixed PB-17 case).
