# QA Log — Part 3: Finance, Compliance & Reporting (PB-27 → PB-40)

Audit performed against `/docs/2026-SoftEng-CTMPawnshop-Sprint.xlsx` and
`/docs/CTM_PawnTrack_Comprehensive_Feature_List.docx` acceptance criteria,
verified against the live Supabase project (`qrbopdbpmwjjsjdwoawz`) and its
real seeded demo data. Scope: PB-27 through PB-40 only.

## Sprint 7 — Financial & Accounting

### PB-27 Record Cash Flow Transaction — PASS
`app/dashboard/finance/actions.ts` (`recordCashEntry`) + `cash-entry-form.tsx`.
Role-gated (operator/cashier/admin via `requireRole`), validated by
`lib/validation/cashflow.ts` (`cashEntrySchema`), `direction` derived
server-side from `entry_type` so the client can't spoof in/out. RLS on
`cash_flow_entries` confirmed enabled. No issues found.

### PB-28 Track Daily Cash Position — PASS
`lib/finance/ledger.ts` `computeCashPosition()` — sums `in` vs `out`,
rounds to 2dp. Covered by `lib/finance/ledger.test.ts`. Logic verified
correct against seeded `cash_flow_entries` (16 rows).

### PB-29 Record Operating Expenses/Revenue — PASS
Same action as PB-27 (`entry_type: 'revenue' | 'expense'`), summarized
separately in `app/dashboard/reports/financial-summary/page.tsx`.

### PB-30 Generate Financial Ledger Entries — PASS
`computeRunningBalances()` in `lib/finance/ledger.ts`, tested. Financial
Summary report applies a date range filter and shows total in/out,
non-loan revenue/expense, and net position. Export is via `PrintButton`
(`window.print()`), consistent with the project's existing browser-print
decision for PB-17/18 receipts — no new PDF dependency needed.

## Sprint 8 — Compliance & Security

### PB-31 Log System Transaction (Audit Trail) — was BROKEN, now FIXED (CRITICAL)

**Finding**: `supabase/migrations/0008_compliance.sql` created
`audit_trigger_fn()` and looped triggers over only these 11 tables:
`profiles, system_settings, customers, appraisal_items, inventory_items,
loans, loan_payments, loan_extensions, cash_flow_entries,
physical_inventory_audits, auction_batches`.

Five business tables added across other sprints were **never wired up** and
had zero audit coverage despite having real seeded rows:
- `inventory_status_history` (9 rows, Sprint 6)
- `physical_inventory_audit_items` (4 rows, Sprint 6)
- `auction_batch_items` (1 row, Sprint 6)
- `suspicious_activity_flags` (1 row, Sprint 8 — ironic, this is itself a
  compliance table)
- `reminder_log` (1 row, Sprint 8)

Verified live via `information_schema.triggers`: these 5 tables had *no*
`<table>_audit` trigger at all, and `select table_name, count(*) from
audit_log group by 1` confirmed zero corresponding rows for any of them,
while every one of the original 11 tables had entries matching its row
count in the source table (e.g. `customers`: 9 audit rows / 9 customer
rows; `loans`: 8/8).

**Fix applied**: `supabase/migrations/0013_qa_part3_audit_trigger_coverage.sql`,
applied live via `apply_migration` and verified — all 5 tables now have a
`<table>_audit` trigger firing `audit_trigger_fn()` on
insert/update/delete, matching the pattern and `SECURITY DEFINER`
semantics of the original rollout. No data was dropped or altered; this
only adds triggers going forward (historical inserts/updates that
predate the fix on those 5 tables are not retroactively logged — that
data was never captured and can't be reconstructed).

**Remaining note**: confirmed with `get_advisors(type: security)` that no
new security issues were introduced.

### PB-32 Flag & Review Suspicious Activity — PASS
`suspicious_activity_flags` table + `lib/compliance/suspicious.ts` +
`app/dashboard/compliance/actions.ts` (`resolveSuspiciousFlag`). Admin-only
resolution; `blacklisted` decision correctly cascades to
`customers.is_blacklisted`. RLS: cashier/admin can insert, only admin can
update — matches the "flag then admin reviews" workflow.

### PB-33 Send Due-Date Reminder — PARTIAL (known, correctly flagged)
`reminder_log` + `sendReminder` action — in-app log only, no email/SMS
provider configured in this sandbox (no outbound provider credentials
available). This matches the existing, correctly-documented limitation in
DECISIONS_LOG.md. Left as-is per task instructions ("keep flagged"). Audit
coverage gap on `reminder_log` itself is fixed under PB-31 above.

## Sprint 9 — Reporting & Management Insights

### PB-34 Outstanding Loans Report — PASS
`app/dashboard/reports/outstanding/page.tsx`. Filters `status in (active,
extended)`, ordered by maturity date. Correct.

### PB-35 Overdue Loans Report — PASS
`app/dashboard/reports/overdue/page.tsx` + `lib/reports/loans.ts`
`daysOverdue()`. Filters `status in (active, extended, defaulted)` AND
`maturity_date < today`. Correct — includes defaulted loans still past due
for collections follow-up as documented.

### PB-36 Inventory Aging Report — PASS
`app/dashboard/reports/inventory-aging/page.tsx` + `daysInVault()`,
60-day highlight threshold. Correct.

### PB-37/38 Financial Summary Report — PASS (see PB-30 above, same page)

### PB-39 Trends & Analytics Dashboard — PASS (metrics verified against live data)
Chosen metrics (documented in DECISIONS_LOG.md as the objective
replacement for the not-Testable original story): redemption rate,
forfeiture rate, average loan size, monthly volume, in
`lib/reports/analytics.ts`.

Verified against live seeded `loans` table
(`select status, count(*), sum(principal_amount) from loans group by
status`): active=5/₱67,500, extended=1/₱18,000, redeemed=1/₱12,000,
defaulted=1/₱27,000 (8 loans, ₱124,500 total).

- Concluded loans (redeemed+defaulted+forfeited) = redeemed(1) +
  defaulted(1) = 2. Redemption rate = 1/2 = **50.0%** ✓ matches
  `computeRedemptionRate` logic (redeemed / concluded).
- Forfeiture rate = (defaulted+forfeited)/concluded = 1/2 = **50.0%** ✓.
- Average loan size = sum(all 8 loans)/8 = 124,500/8 = **₱15,562.50** ✓
  matches `computeAverageLoanSize` (uses *all* loans, not just concluded —
  correct per the metric's intent: portfolio-wide average ticket size).
- Monthly volume groups by `loan_date.slice(0,7)` — correct grouping,
  covered by `lib/reports/analytics.test.ts`.

All four metrics calculate correctly against real data; no fix needed.

### PB-40 Export/Print — PASS
Every report page (`financial-summary`, `outstanding`, `overdue`,
`inventory-aging`, `analytics`, `compliance`) has a `PrintButton`
(`components/print-button.tsx`, `window.print()`), consistent with the
project-wide browser-print decision for PB-17/18/30. No PDF library
dependency, matches existing precedent.

## Secrets scan

Ran `grep -rn` across the repo (excluding `node_modules`, `.next`, `.git`)
for: `service_role`, `sb_secret`, JWT prefix `eyJ`, and inline
`password = "..."` literals.

**Result: no hardcoded secrets found.** All `service_role` matches are
either comments/docs describing the admin client pattern
(`lib/supabase/server.ts`, `CLAUDE.md`, `DECISIONS_LOG.md`,
`SPRINT_PROGRESS.md`) or SQL grants using the Postgres role name
`service_role` (`supabase/migrations/0010_restore_table_grants.sql`), not
an actual key value. No `eyJ...` JWT strings or `sb_secret_...` keys are
present in tracked source. `.env.local` is confirmed gitignored and not
present in this working tree's git-tracked files. `password` matches were
all test fixtures (`lib/validation/account.test.ts`, temp-password schema
tests), not real credentials.

Note: git history (`git log`) shows a prior commit
`2ad5e06 security: remove accidentally committed .env.local (contained
live service_role key — rotate immediately)` from an earlier session —
that secret is no longer in the current working tree, but if it was ever
pushed to a remote and that key hasn't been rotated yet, it should be
rotated in the Supabase dashboard regardless of this scan's clean result
(git history retains it even after a later removal commit).

## Fixes made (summary)

1. `supabase/migrations/0013_qa_part3_audit_trigger_coverage.sql` — added
   missing `AFTER INSERT OR UPDATE OR DELETE` audit triggers on
   `inventory_status_history`, `physical_inventory_audit_items`,
   `auction_batch_items`, `suspicious_activity_flags`, `reminder_log`.
   Applied live and verified via `information_schema.triggers`.

No application code changes were needed — PB-27→30, 32, 34→40 all passed
as built. PB-33 remains correctly flagged as in-app-only per existing
documented limitation.

## Verification

- `npm test` — 82/82 passing.
- `npm run lint` — clean.
- `npm run build` — clean, all 26 routes compile.
- `mcp__Supabase__get_advisors(type: security)` — no new issues from the
  migration.
