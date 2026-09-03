# CTM PawnTrack — Project Memory

Persistent context for this project. Read this before starting work instead of
re-deriving context from scratch. Update it the moment a real decision is made.

## What this is

A pawnshop management web app for CTM Pawnshop (Philippines, BSP-regulated gold
pawnshop). Replaces an earlier JavaFX desktop plan. The repo's `index.html` is a
static HTML prototype — **UX reference only** (screen names, fields, flows). Do
not port its code structure.

## Tech stack

- **Frontend/Backend**: Next.js (App Router, TypeScript), Tailwind CSS
- **Database/Auth**: Supabase (Postgres + Auth + Row Level Security)
  - Project ref: `qrbopdbpmwjjsjdwoawz`
- **Hosting**: Vercel
- **Testing**: to be decided in Sprint 0 scaffold (likely Vitest + React Testing Library)

## Folder structure (planned, set up in Sprint 0)

```
app/                    # Next.js App Router routes
  (auth)/               # login, password reset
  (dashboard)/          # role-gated screens per module
lib/
  supabase/
    client.ts           # browser client (anon key)
    server.ts           # server client (service_role, server-only)
  validation/           # shared zod/validation schemas
components/             # shared UI components
supabase/
  migrations/           # SQL migrations (tables + RLS policies)
docs/                   # source-of-truth backlog docs (do not edit)
```

## Branch strategy

Harness constraint: all work in this session happens on
`claude/pawntrack-initial-setup-ql2wye` (never push elsewhere without
explicit permission). Within that constraint we still branch per feature
locally/via PR discipline where practical, but the actual push target for
this session is the designated branch. Never commit directly to `main`.

## Security rules (non-negotiable)

- Every access-controlled table has a matching RLS policy — RLS is the real
  enforcement, UI hiding is cosmetic only.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only (API routes / server components),
  never shipped to the browser.
- `.env.local` is gitignored, never committed. Real secrets live only in the
  Vercel/Supabase dashboards + local `.env.local`.

## Source of truth for scope

`/docs/2026-SoftEng-CTMPawnshop-Sprint.xlsx` (sheets: UAC, Product Backlog,
Sprint Backlog) is authoritative for sprint numbering and PB IDs — it
supersedes any sprint numbering mentioned elsewhere. `/docs/CTM_PawnTrack_Comprehensive_Feature_List.docx`
is a narrative companion, useful for feature descriptions but not for sprint
numbers (it groups differently — ignore its sprint labels).

## Sprint → Module map (authoritative, from Sprint Backlog sheet)

| Sprint | Module | PB IDs |
|---|---|---|
| 1 | Authentication & Access + System Configuration | PB1–PB6 |
| 2 | Customer Management | PB7–PB11 |
| 3 | Appraisal and Valuation | PB12–PB16 |
| 4 | Loan and Transaction Management (part 1) | PB17–PB19 |
| 5 | Loan and Transaction Management (part 2) | PB20–PB22 |
| 6 | Inventory and Collateral Tracking | PB23–PB26 |
| 7 | Financial and Accounting | PB27–PB30 |
| 8 | Compliance and Security | PB31–PB33 |
| 9 | Reporting and Management Insights | PB34–PB40 |
| 10 | UAT, bug fixing, backup verification, deployment, docs (cross-module, no new PB IDs — items 41–46 in Sprint Backlog) | — |

Four roles throughout: **Admin, Operator, Cashier, Appraiser**.

## Known open gaps (flagged by SAD/INVEST review — do not silently resolve)

- **PB-14 (Calculate Valuation & Loan Range)** — marked **not Estimable**.
  The exact karat/purity-to-value formula was never numerically confirmed
  with CTM Pawnshop. Implement with a clearly marked placeholder formula and
  a `// TODO: confirm formula with CTM Pawnshop` comment. Flag explicitly
  when reached.
- **PB-3 (RBAC)** and **PB-17→ re-mapped as PB-17 "Create Pawn Loan & Issue
  Ticket"** — both marked **not Small**. Stop and report if either feels too
  large mid-build rather than pushing through untested.
- **PB-31 (Audit Trail)** — marked **not Small/Independent**, cross-cutting.
  Build as a shared logging utility/trigger used by every table's
  insert/update/delete, not bolted on per-module, from the start.
- **PB-39 (Trends & Analytics Dashboard)** — marked **not Testable** as
  written ("spot patterns" is subjective). Chosen concrete metrics: TBD,
  will be defined before building in Sprint 9 (candidates: redemption rate,
  average loan size, forfeiture rate).

## Decisions log

- Printed pawn ticket / receipts (PB-17, PB-18): implemented as browser
  print (`window.print()`) with a print-optimized layout — no PDF library
  dependency needed for MVP. (Confirmed in Batch B.)
- Backups (Sprint 10, PB-43): Supabase handles backups server-side —
  documented, not custom-built.

## Token discipline reminders

- Don't re-read files already in context unless changed.
- Refer to this file instead of re-explaining the project each turn.
- Short, specific commit messages: `feat(pb1): add login page + Supabase session check`.
- Build only what the current sprint's backlog rows specify — no speculative
  future-sprint code.
- Stop after each sprint batch and wait for review before continuing.
