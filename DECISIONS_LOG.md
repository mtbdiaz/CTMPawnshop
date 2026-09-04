# CTM PawnTrack — Autonomous Decisions Log

Every assumption, ambiguity resolution, and non-trivial fix made without
stopping to ask, per the full-autonomy directive. Newest entries at the
bottom of each section's run.

## Pre-flight (2026-09-04)

- **Vercel deployment access**: user asked me to "connect Vercel access now."
  I have no tool that can create/manage Vercel deployments, set project env
  vars, or promote to production — the only Vercel MCP connector available
  in this environment (`directoryUuid 7eb42afe...`) is read-only
  (`list_projects`, `get_deployment`, `list_deployments`, `search docs` —
  no write/deploy/env tools), and it isn't even installed for this org.
  I cannot install connectors myself. **Resolution**: proceeding on the
  fallback the user also approved ("preview-only, you promote") — I keep
  pushing to `claude/pawntrack-initial-setup-ql2wye`, the existing GitHub→
  Vercel integration keeps auto-deploying previews (confirmed working
  through Sprint 1), and at final completion I hand over an exact checklist
  of what needs setting in the Vercel dashboard (production env vars,
  promote-to-production) since I cannot do those steps myself.
- **Branch strategy**: harness constrains all pushes in this session to
  `claude/pawntrack-initial-setup-ql2wye`. User confirmed "everything on
  this one branch" as the fallback. All 10 sprints are committed there in
  sequence; PR #1 stays open and updates on every push. `dev`/`main` merges
  are left for the user to do themselves — I cannot push to `main`.
- **Valuation formula (PB-14)**: no real figures provided. Using
  `value = weight_grams × (purity_percent / 100) × gold_price_per_gram`,
  `suggested_loan = value × (ltv_percent / 100)`, clearly commented
  `// TODO: confirm formula with CTM Pawnshop` in code. **Flagged for real
  client confirmation before production use.**
- **Domain/project**: kept the existing Vercel project (`ctm-pawnshop`), no
  change needed.

## Sprint 7 — Financial and Accounting

- PB-27's core mechanic (auto cash-flow entry on loan/payment/extension)
  was already built in Sprints 4-5. **Forfeiture does not generate a cash
  flow entry** — a defaulted/forfeited loan is a loss of collateral, not a
  cash movement, so there's nothing to log there; documented as a
  deliberate reading of "cash flow" (money in/out), not "event log" (that's
  PB-31's job in Sprint 8).
- PB-28 (daily cash position) and PB-30 (formal ledger) are one screen
  (`app/dashboard/finance`) over the same `cash_flow_entries` table — a
  running-balance ledger view IS the daily position at any point in it, so
  building them separately would duplicate the same data. Pure calculation
  logic (`lib/finance/ledger.ts`) is unit-tested to reconcile: the ledger's
  last running balance equals the cash-position net for the same entries.
- PB-29: relaxed the `cash_flow_entries` insert RLS policy (Sprint 4 had it
  cashier/admin only, since only loan actions wrote to it then) to also
  allow `operator`, per PB-29's user story ("As an Operator...").

## Sprint 6 — Inventory and Collateral Tracking

- PB-23/24's core mechanics (auto-create on loan, auto-update status through
  the lifecycle) were already built in Sprints 4-5 since PB-17/19/20/21's
  own AC required it. This sprint added the screens on top: the Vault
  Inventory list, and a `inventory_status_history` table + trigger so every
  status change is timestamped and logged (PB-24 AC2), not just reflected
  in `updated_at`.
- PB-25 physical audit: one `physical_inventory_audits` header row +
  `physical_inventory_audit_items` lines (expected status, found y/n,
  notes). `discrepancy_count` is computed from unchecked ("not found")
  items — pure logic extracted to `lib/inventory/audit.ts` for testing.
  No automatic remediation (e.g. auto-flagging a loan) on a discrepancy —
  out of scope; an Admin reviews audit notes manually.
- PB-26 auction batches: only `forfeited` items are selectable; batching
  moves them to `queued_for_auction` (a status already added to the enum
  in Sprint 4 for exactly this).

## Sprint 5 — Loan and Transaction Management, part 2

- **PB-21 default detection has no scheduler**: this environment has no
  cron/background-job infrastructure available to me. Implemented
  `runDefaultDetection()` (`app/dashboard/loans/actions.ts`) as a pure
  scan over active/extended loans that runs opportunistically on every
  Loans list page load rather than on a real timer. **Known limitation** —
  a production deployment should replace this with a Supabase Edge
  Function + `pg_cron` (or a Vercel Cron Job) running e.g. hourly. Noted
  again in Sprint 10 as a follow-up.
- **PB-20 redemption condition**: "fully paid" is interpreted as
  `principal_balance <= 0`; since `calculateInterestDue(0, rate) = 0`,
  there's no separate "current period interest" to also clear.
- **PB-22 lost-ticket verification**: implemented as a checkbox + ID-number
  confirmation on both the payment and redemption forms, checked against
  `customers.id_number` server-side (`lib/loans/lost-ticket.ts`). Logged via
  a `verified_via_lost_ticket` flag on `loan_payments` and a `lost_ticket_used`
  flag on `loans` — a real audit-trail entry (who/when) is added when PB-31
  (Sprint 8) is built; this is the data these entries will feed.

## Sprint 4 — Loan and Transaction Management, part 1

- **PB-17 flagged not Small**: did not split into smaller stories mid-build
  per instruction — combined loan creation + inventory record + cash flow
  entry into one server action (`app/dashboard/loans/actions.ts:createLoan`)
  since the three writes are transactionally related (AC2 requires them
  together); kept each concern in its own table/function for testability.
- **`inventory_items` and `cash_flow_entries` tables introduced early**
  (nominally Sprints 6 and 7): PB-17 AC2 explicitly requires loan creation
  to auto-create both. Built minimal versions now; Sprints 6-7 add the full
  audit/reporting UI on top of these same tables rather than duplicating.
- **Loan term assumption**: no explicit loan term/cycle length in `/docs`.
  PB-6's "monthly interest rate" implies a 30-day cycle — used
  `LOAN_TERM_DAYS = 30` (`lib/loans/calculations.ts`), standard PH pawnshop
  convention. Flagged as an assumption pending client confirmation.
- **Payment application order**: interest is settled first, remainder
  reduces principal (standard pawnshop/lending convention; not specified
  in `/docs`).
- **Extension = pay-and-renew**: PB-19 AC says additional interest is
  "calculated and applied" without specifying whether it's paid immediately
  or capitalized into principal. Assumed immediate payment at the counter
  (standard practice) — `processExtension` logs a `cash_flow_entries`
  "payment_received" for the additional interest and leaves
  `principal_balance` unchanged, rather than capitalizing it.
- Loan amount is capped at the appraisal's `suggested_loan_max` (derived
  from PB-14's placeholder formula) — a Cashier cannot create a loan above
  what the system suggested.
- Redemption (PB-20) and default/forfeiture (PB-21) are deliberately not
  implemented yet — Sprint 5.

## Sprint 3 — Appraisal and Valuation

- **PB-14 valuation formula (flagged not Estimable — no client figures
  provided)**: `value = weight_grams × (purity_percent/100) × gold_price_per_gram`,
  `suggested_loan_max = value × (ltv_percent/100)`, `suggested_loan_min =
  suggested_loan_max × 0.9` (placeholder 10% appraiser-negotiation buffer,
  also unconfirmed). Implemented in `lib/appraisal/valuation.ts` with
  `// TODO: confirm formula with CTM Pawnshop`. **Needs real client
  confirmation before production use — flagged per project ground rules.**
- **PB-15 counterfeit tolerance ranges**: no client-provided tolerance
  bands, so used standard gold fineness tables (24k≈99.9%, 22k≈91.6%,
  21k≈87.5%, 18k≈75%, 14k≈58.3%, 10k≈41.7%) with a ±3-5 point band per
  karat as the "expected range." Also a placeholder pending confirmation.
- Photo storage: private Supabase Storage bucket `item-photos`, RLS
  mirrors `appraisal_items` (any authenticated staff read/write). Detail
  page uses 1-hour signed URLs rather than public URLs.
- PB-11 blacklist guard (`lib/customers/blacklist.ts`, built in Sprint 2)
  is now wired into appraisal creation as its first real caller.

## Sprint 2 — Customer Management
