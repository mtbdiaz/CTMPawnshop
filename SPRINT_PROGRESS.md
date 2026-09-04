# CTM PawnTrack — Sprint Progress

Checklist mirrors the authoritative Sprint Backlog sheet in
`/docs/2026-SoftEng-CTMPawnshop-Sprint.xlsx`. Check items off the moment
they're done — don't batch updates.

## Sprint 0 — Project Scaffold (not in original backlog, required first)

- [x] Next.js + TypeScript + Tailwind (App Router) scaffolded
- [x] `@supabase/supabase-js` + `@supabase/ssr` installed
- [x] `.env.local` placeholders set up (gitignored) + `.env.example` committed
- [x] `lib/supabase/client.ts` (browser) + `lib/supabase/server.ts` (session + service_role admin) + `lib/supabase/middleware.ts` + `proxy.ts` (session refresh)
- [x] Branch strategy confirmed in CLAUDE.md
- [x] Scaffold committed, pushed to PR #1

## Sprint 1 — Authentication & Access + System Configuration

- [x] PB-1 Login (`app/login`) — Supabase Auth email/password, 3-fail client-side lockout (60s)
- [x] PB-2 Password Reset (Admin-assisted) — admin issues temp password from Users screen, forces password change on next login (`app/force-password-change`)
- [x] PB-3 Role-Based Access Control — `profiles.role` + RLS + `requireRole()` server guard + role-aware nav (did not feel oversized; scope was Auth/Settings screens only, more screens reuse the same guard in later sprints)
- [x] PB-4 Manage User Accounts (`app/dashboard/users`) — create/edit/deactivate staff accounts (deactivation also bans the Supabase Auth user, not just a UI flag)
- [x] PB-5 Session Timeout — 15 min inactivity auto sign-out (`components/session-timeout-watcher.tsx`)
- [x] PB-6 Configure Business Rules (`app/dashboard/settings`) — interest rate, gold price, LTV%, grace period, singleton `system_settings` row, admin-only RLS update

Tests: 22 unit tests (Vitest) covering RBAC role logic, login lockout, and
both validation schemas. `next build` + `tsc --noEmit` + `eslint` all clean.
Manual: dev server smoke-tested — `/` redirects to `/login`, login page
renders correctly.

## Sprint 2 — Customer Management

- [x] PB-7 Register New Customer (`app/dashboard/customers`)
- [x] PB-8 Verify Customer Identity (AML) — placeholder rule-based check (`lib/customers/aml.ts`), see DECISIONS_LOG.md
- [x] PB-9 Update Customer Profile (`app/dashboard/customers/[id]`)
- [x] PB-10 View Transaction History — screen scaffolded with empty state; wired to real loan data in Sprint 4-5
- [x] PB-11 Check Blacklist Status — `lib/customers/blacklist.ts` guard (reused at loan/appraisal creation), Admin-only toggle + banner on customer detail page

Tests: +9 unit tests (AML check, customer validation). Build+typecheck+lint clean.

## Sprint 3 — Appraisal and Valuation

- [x] PB-12 Record Gold Item Details (`app/dashboard/appraisals`)
- [x] PB-13 Capture Item Photo and Notes — Supabase Storage bucket `item-photos`
- [x] PB-14 Calculate Valuation & Loan Range — ⚠ PLACEHOLDER FORMULA, see DECISIONS_LOG.md, needs real client confirmation
- [x] PB-15 Flag Counterfeit Risk — placeholder purity-tolerance table, see DECISIONS_LOG.md
- [x] PB-16 Resolve Counterfeit Flag (Admin) (`app/dashboard/appraisals/[id]`)

Tests: +14 unit tests (valuation formula, counterfeit range logic, appraisal
validation). Build+typecheck+lint clean.

## Sprint 4 — Loan and Transaction Management (part 1)

- [x] PB-17 Create Pawn Loan & Issue Ticket (`app/dashboard/loans`) — auto-creates inventory_items + cash_flow_entries rows (see DECISIONS_LOG.md re: those tables built early); printable ticket via `window.print()`
- [x] PB-18 Record Customer Payment — interest settled first, remainder to principal
- [x] PB-19 Process Loan Extension — recalculates maturity, charges + logs one additional interest period

Tests: +9 unit tests (loan calculations: maturity date, interest, payment
application/validation, extension). Build+typecheck+lint clean.

## Sprint 5 — Loan and Transaction Management (part 2)

- [x] PB-20 Redeem Pawned Item — closes loan, releases inventory item
- [x] PB-21 Process Loan Default & Forfeiture — ⚠ runs on page load, not a real scheduler, see DECISIONS_LOG.md
- [x] PB-22 Lost Ticket Alternate Verification — ID-number check against customer record on payment/redemption

Tests: +7 unit tests (grace-period detection, lost-ticket ID matching).
Build+typecheck+lint clean.

## Sprint 6 — Inventory and Collateral Tracking

- [x] PB-23 Register Pawned Item in Inventory (`app/dashboard/inventory`) — auto-created in Sprint 4's loan creation, screen added here
- [x] PB-24 Update Item Status — auto-updated through Sprints 4-5's loan lifecycle actions; `inventory_status_history` trigger added for timestamped logging
- [x] PB-25 Perform Physical Inventory Audit (`app/dashboard/inventory/audit`)
- [x] PB-26 Prepare Forfeited Items for Auction (`app/dashboard/inventory/auction`)

Tests: +3 unit tests (audit discrepancy counting). Build+typecheck+lint clean.

## Sprint 7 — Financial and Accounting

- [x] PB-27 Record Cash Flow Transaction — auto-logged since Sprint 4/5 (loan/payment/extension); forfeiture deliberately produces no cash entry, see DECISIONS_LOG.md
- [x] PB-28 Track Daily Cash Position (`app/dashboard/finance`)
- [x] PB-29 Record Operating Expenses & Revenue
- [x] PB-30 Generate Financial Ledger Entries — same screen/table as PB-28, running-balance ledger

Tests: +4 unit tests (cash position, running balance, reconciliation).
Build+typecheck+lint clean.

## Sprint 8 — Compliance and Security

- [x] PB-31 Log System Transaction (Audit Trail) (`app/dashboard/compliance/audit`) — generic trigger on every business table, read-only even to Admin; known limitation for service_role writes, see DECISIONS_LOG.md
- [x] PB-32 Flag & Review Suspicious Activity (`app/dashboard/compliance`) — placeholder AML velocity rule, see DECISIONS_LOG.md
- [x] PB-33 Send Due-Date Reminder Notification (`app/dashboard/compliance/reminders`) — ⚠ no email/SMS provider configured, in-app log only, see DECISIONS_LOG.md

Tests: +6 unit tests (suspicious-activity velocity rule, reminder due-window).
Build+typecheck+lint clean.

## Sprint 9 — Reporting and Management Insights

- [x] PB-34 Generate Outstanding Loans Report
- [x] PB-35 Generate Overdue Loans Report
- [x] PB-36 Generate Inventory Aging Report
- [x] PB-37 Generate Financial Summary
- [x] PB-38 Generate Compliance/AML Report
- [x] PB-39 View Trends & Analytics Dashboard — metrics chosen: redemption rate, forfeiture rate, average loan size, monthly volume (see DECISIONS_LOG.md)
- [x] PB-40 Export or Print Reports — `window.print()` on every report page

Tests: +10 unit tests (overdue/aging day math, all 4 analytics metrics).
Build+typecheck+lint clean, all 26 routes compile.

## Sprint 10 — UAT, Bug Fixing, Deployment, Handoff

- [ ] Item 41: User Acceptance Testing (UAT)
- [ ] Item 42: Final Bug Fixing
- [ ] Item 43: Backup & Restore Setup (document Supabase's built-in backups, no custom feature)
- [ ] Item 44: Production Deployment (Vercel)
- [ ] Item 45: User Manual & Training
- [ ] Item 46: Final Documentation Handoff
