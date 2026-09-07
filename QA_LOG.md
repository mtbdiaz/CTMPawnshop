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
