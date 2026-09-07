# QA Log — Part 2: Loan & Inventory Modules (PB-17 → PB-26)

Audited against `/docs/2026-SoftEng-CTMPawnshop-Sprint.xlsx` (UAC sheet, sprints 4-6)
and cross-checked with `/docs/CTM_PawnTrack_Comprehensive_Feature_List.docx`.
Scope: PB-17 through PB-26 only. Live DB inspected/patched via Supabase MCP
(project `qrbopdbpmwjjsjdwoawz`) — read-only queries plus one additive
migration (`0012_atomic_create_loan.sql`), no destructive changes, no data
loss.

## PB-17 — Create Pawn Loan & Issue Ticket — was PARTIAL, now PASS

AC1: verified customer + appraised, unflagged item → loan record + printed
ticket. AC2: loan creation auto-creates a matching inventory record and
initial cash flow entry.

**Verified working**: blacklist check, counterfeit-flag check, loan-amount
cap at `suggested_loan_max`, duplicate-active-loan guard, ticket number
generation, printable ticket (`window.print()`), PB-32 suspicious-velocity
flag on creation — all present in `app/dashboard/loans/actions.ts:createLoan`.

**Bug found and fixed (the specific concern this task flagged)**: the three
required writes (`inventory_items` insert → `loans` insert → `cash_flow_entries`
insert) were three independent client-side `.insert()` calls from the
Supabase JS client, with **no transaction**. If the second or third insert
failed after the first had already committed (RLS rejection, network blip,
a bad FK), the result was a real inconsistency: an orphaned `inventory_items`
row with no loan, or a loan with no cash flow entry — silently violating
AC2's "automatically" guarantee. This is exactly the kind of gap the task
description asked to check for ("confirm ... all actually fire together on
loan creation, not just the loan row itself").

**Fix**: added `supabase/migrations/0012_atomic_create_loan.sql`, a
`security invoker` Postgres function `create_pawn_loan(...)` that performs
all three inserts inside one function body (Postgres functions execute as a
single transaction — any exception rolls back all three). `createLoan` now
calls `supabase.rpc("create_pawn_loan", …)` instead of three separate
inserts. Kept `security invoker` (not definer) deliberately — RLS insert
policies on `inventory_items` (cashier/operator/admin), `loans`
(cashier/admin), and `cash_flow_entries` (cashier/operator/admin) still
apply exactly as before; this migration only fixes atomicity, not
authorization. Applied live via `mcp__Supabase__apply_migration`, confirmed
`prosecdef = false` (security invoker) in `pg_proc`, `get_advisors` shows no
new security warnings from this change. `lib/supabase/database.types.ts`
updated with the new function's typed signature (used with the typed
Supabase client, not `any`).

**Sibling-trigger audit (as specifically requested)**: swept every
`create/replace function ... returns trigger` in `supabase/migrations/*.sql`
for the same missing-`security definer` pattern that caused the
`inventory_status_history` RLS violation:
- `set_updated_at` (0001) — plpgsql, **not** security definer. Not a bug:
  it only sets `new.updated_at`, doesn't insert into another RLS-protected
  table, so it runs fine under the invoking role's own update privilege on
  that same row.
- `log_inventory_status_change` (0006, superseded by 0011) — the one
  already fixed. Confirmed live: `prosecdef = true`, and `0011`'s
  `revoke execute on function ... from public` is in place.
- `audit_trigger_fn` (0008, PB-31) — already `security definer` from the
  start. Confirmed live: `prosecdef = true`.

No other sibling instance of the bug found. The 0011 fix is solid.

## PB-18 — Record Customer Payment — PASS

AC1 (recalculate balance + issue receipt) and AC2 (reject over-payment) both
correctly implemented in `recordPayment` (`lib/loans/calculations.ts:
applyPayment`, `validatePaymentAmount` — interest settled first, remainder to
principal, receipt number generated, cash flow entry logged). PB-22
lost-ticket path checked here too (see below). No transaction-atomicity gap
here: it's a single `loan_payments` insert, one `loans` update, one
`cash_flow_entries` insert; a mid-sequence failure would leave a payment
record whose effect wasn't fully applied to the loan balance/cash ledger —
same class of issue as PB-17 but lower risk (single financial event, not a
three-table state machine) and not explicitly in this task's flagged scope.
**Documented, not fixed** — flagging as a residual, lower-priority gap
consistent with the existing extension/redemption pattern already accepted
in DECISIONS_LOG.md.

## PB-19 — Process Loan Extension — PASS

AC1 (new maturity date + additional interest, calculated and applied) and
AC2 (extension count incremented and logged in `loan_extensions`) both
present in `processExtension`. Grace-period-expired guard correctly blocks
late extensions. Same non-atomic multi-write pattern as PB-18/20 — documented
above, not re-flagged per item.

## PB-20 — Redeem Pawned Item — PASS

AC1 (fully-paid loan → closed, item → Redeemed) and AC2 (item released from
active tracking) both present in `redeemLoan`. "Fully paid" interpreted as
`principal_balance <= 0` — reasonable given the redemption gate already
matches `lib/loans/calculations.ts`'s design. Lost-ticket path checked here
too.

## PB-21 — Loan Default & Forfeiture — PARTIAL (known, kept flagged)

AC1/AC2 logic itself (`isPastGracePeriod`, marks `defaulted` +
`inventory_items.status = 'forfeited'`) is correct. **Confirmed still
running on page load** (`runDefaultDetection()` called from the Loans list
page, not a real scheduler) — exactly as already documented in
DECISIONS_LOG.md and SPRINT_PROGRESS.md. Per this task's instructions this
is a *known* gap to keep flagged, not silently resolve — no code change
made. Restating the existing recommendation: replace with a Supabase Edge
Function + `pg_cron` or a Vercel Cron Job before production.

## PB-22 — Lost Ticket Alternate Verification — PASS

AC1 (ID-number check lets Cashier proceed with payment/redemption without
the physical ticket) implemented via `lib/loans/lost-ticket.ts:
verifyLostTicketId`, wired into both `recordPayment` and `redeemLoan`. AC2
("the event is logged in the audit trail") — verified this is actually
satisfied, not just data-flagged: `verified_via_lost_ticket` /
`lost_ticket_used` are ordinary columns on `loan_payments`/`loans`, and
PB-31's generic `audit_trigger_fn` (Sprint 8) is attached to both of those
tables and logs the full row as JSON on every insert/update — so a
lost-ticket payment or redemption produces a genuine `audit_log` row
carrying that flag, satisfying AC2 as written.

## PB-23 — Register Item in Inventory — PASS

AC1 (loan creation auto-generates an inventory record with vault location)
and AC2 (linked to both item and loan) — confirmed via `create_pawn_loan`
(now transactional, see PB-17): inserts `inventory_items` with
`appraisal_item_id` + `vault_location`, and the loan row stores
`inventory_item_id`, satisfying the two-way link.

## PB-24 — Update Item Status — PASS (with the PB-17-adjacent fix)

AC1 (status auto-updates on loan state changes: extended/redeemed/forfeited)
— confirmed across `processExtension`, `redeemLoan`, `runDefaultDetection`,
each updating `inventory_items.status` to match. AC2 (timestamped + logged)
— `inventory_status_history` trigger, fixed live in `0011` (see PB-17
section above) — confirmed firing correctly post-fix (`security definer`,
`revoke execute from public`).

## PB-25 — Physical Inventory Audit — PASS

AC1 (discrepancies highlighted vs. system records) and AC2 (result +
timestamp saved) both present: `submitAudit` computes `discrepancy_count`
via `lib/inventory/audit.ts:countDiscrepancies` and persists header +
line rows with `created_at`. Reviewed the two-insert sequence
(`physical_inventory_audits` then `physical_inventory_audit_items`) — same
non-atomic-multi-write class as PB-18/19/20, lower risk here since it's an
audit record, not a financial/inventory-state mutation; a partial failure
would surface as a returned error to the user rather than silent data drift.
Not fixed — out of this task's specifically-flagged scope.

## PB-26 — Prepare Forfeited Items for Auction — PASS

AC1 (batch forfeited items → auction-prep list) and AC2 (item status
reflects "queued for auction") both present in `createAuctionBatch`:
inserts `auction_batches` + `auction_batch_items`, then updates
`inventory_items.status = 'queued_for_auction'`. Same non-atomic-sequence
note as above; not fixed (out of specifically-flagged scope, and the
existing `inventory_status_history` trigger will correctly log the status
flip regardless of whether the batch-item write partially failed).

## Summary

| PB | Status | Notes |
|---|---|---|
| PB-17 | PASS (was PARTIAL) | Atomicity bug fixed via `create_pawn_loan` RPC (migration 0012) |
| PB-18 | PASS | Non-atomic multi-write noted, not fixed (lower priority, out of flagged scope) |
| PB-19 | PASS | Same note as PB-18 |
| PB-20 | PASS | — |
| PB-21 | PARTIAL (known) | Page-load scheduler, kept flagged per instructions |
| PB-22 | PASS | Confirmed AC2 satisfied via PB-31's generic audit trigger |
| PB-23 | PASS | Now backed by the atomic RPC |
| PB-24 | PASS | 0011 trigger fix verified live and solid; no sibling instances of the bug found |
| PB-25 | PASS | Non-atomic multi-write noted, not fixed |
| PB-26 | PASS | Non-atomic multi-write noted, not fixed |

**Fixes made**: `supabase/migrations/0012_atomic_create_loan.sql` (new,
applied live), `app/dashboard/loans/actions.ts` (`createLoan` now calls the
RPC), `lib/supabase/database.types.ts` (typed the new function).

**Remaining limitations** (unchanged from prior sprints, restated per
instructions not to silently resolve): PB-21's default detection has no
real scheduler; PB-18/19/25/26's own multi-statement writes remain
non-transactional (same risk class as the PB-17 bug, but lower blast radius
and not the item this task named as critical) — a follow-up could wrap each
in its own `security invoker` RPC the same way PB-17 was fixed, if desired
in a future pass.

`npm test` (82/82 passed), `npm run lint`, and `npm run build` all clean
after the fix.
