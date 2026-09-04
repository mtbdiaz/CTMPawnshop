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

- [ ] PB-12 Record Gold Item Details
- [ ] PB-13 Capture Item Photo and Notes
- [ ] PB-14 Calculate Valuation & Loan Range (⚠ not Estimable — placeholder formula + TODO, flag when reached)
- [ ] PB-15 Flag Counterfeit Risk
- [ ] PB-16 Resolve Counterfeit Flag

## Sprint 4 — Loan and Transaction Management (part 1)

- [ ] PB-17 Create Pawn Loan & Issue Ticket (⚠ flagged not Small — watch for oversized PR)
- [ ] PB-18 Record Customer Payment
- [ ] PB-19 Process Loan Extension

## Sprint 5 — Loan and Transaction Management (part 2)

- [ ] PB-20 Redeem Pawned Item
- [ ] PB-21 Process Loan Default & Forfeiture
- [ ] PB-22 Lost Ticket Alternate Verification

## Sprint 6 — Inventory and Collateral Tracking

- [ ] PB-23 Register Pawned Item in Inventory
- [ ] PB-24 Update Item Status
- [ ] PB-25 Perform Physical Inventory Audit
- [ ] PB-26 Prepare Forfeited Items for Auction

## Sprint 7 — Financial and Accounting

- [ ] PB-27 Record Cash Flow Transaction
- [ ] PB-28 Track Daily Cash Position
- [ ] PB-29 Record Operating Expenses & Revenue
- [ ] PB-30 Generate Financial Ledger Entries

## Sprint 8 — Compliance and Security

- [ ] PB-31 Log System Transaction (Audit Trail) (⚠ cross-cutting — shared logging utility from the start)
- [ ] PB-32 Flag & Review Suspicious Activity
- [ ] PB-33 Send Due-Date Reminder Notification

## Sprint 9 — Reporting and Management Insights

- [ ] PB-34 Generate Outstanding Loans Report
- [ ] PB-35 Generate Overdue Loans Report
- [ ] PB-36 Generate Inventory Aging Report
- [ ] PB-37 Generate Financial Summary
- [ ] PB-38 Generate Compliance/AML Report
- [ ] PB-39 View Trends & Analytics Dashboard (⚠ not Testable as written — define concrete metrics first, report choice)
- [ ] PB-40 Export or Print Reports

## Sprint 10 — UAT, Bug Fixing, Deployment, Handoff

- [ ] Item 41: User Acceptance Testing (UAT)
- [ ] Item 42: Final Bug Fixing
- [ ] Item 43: Backup & Restore Setup (document Supabase's built-in backups, no custom feature)
- [ ] Item 44: Production Deployment (Vercel)
- [ ] Item 45: User Manual & Training
- [ ] Item 46: Final Documentation Handoff
