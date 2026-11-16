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
- **Testing**: Vitest unit tests (48 files, 429 tests, pure logic only: validation, money rules, roles, formatting). No component, end-to-end or database integration tests yet; the database has `ctm_selftest_*` functions that run inside a rolled-back transaction. Run with `npm test`.
- **Install**: `npm install --legacy-peer-deps` (a plain `npm ci` fails: the lockfile is out of sync).

## Folder structure (current)

```
app/                    # Next.js App Router routes (no API routes: server actions only)
  login/, force-password-change/   # sign-in and the forced new password
  dashboard/            # all staff screens: customers, appraisals, loans, inventory (audit, auction),
                        # finance, compliance (reminders), reports, settings (users), archive
  print/                # ticket and receipt print pages
lib/                    # pure logic by area: loans, customers, appraisal, inventory, finance, reports,
                        # compliance, auth, validation, audit, calendar, format
  supabase/
    client.ts           # browser client (anon key)
    server.ts           # createClient() = session-bound (RLS); createAdminClient() = service_role, server-only
    middleware.ts        # session-refresh helper used by proxy.ts
  validation/           # shared zod/validation schemas — added as needed
components/             # shared UI: app shell and menu, forms, tables, toast, date and dropdown pop-ups (picker-enhancer)
proxy.ts                # Next.js 16 middleware equivalent; refreshes Supabase session cookie
supabase/
  migrations/           # SQL migrations 0001-0086 (tables, RLS, functions). Known drift: see QA report M-02
  rollbacks/            # rollback scripts for a few migrations
docs/                   # source-of-truth backlog docs (do not edit)
```

Scaffolded with `create-next-app` (TypeScript, Tailwind, ESLint, App Router,
no `src/` dir). Next.js 16.4.5 — middleware file convention is `proxy.ts`
(`middleware.ts` is deprecated in this version), function name `proxy`.

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
  Current rule (still to be confirmed with CTM Pawnshop): value = weight x
  the price per gram for the karat (24K/21K/18K prices in Settings; there is
  no purity multiplier any more), maximum loan = value x LTV %, and the
  minimum shown is a placeholder 90% of the maximum
  (`lib/appraisal/valuation.ts`, marked `TODO`).
- **PB-3 (RBAC)** and **PB-17→ re-mapped as PB-17 "Create Pawn Loan & Issue
  Ticket"** — both marked **not Small**. Stop and report if either feels too
  large mid-build rather than pushing through untested.
- **PB-31 (Audit Trail)** — marked **not Small/Independent**, cross-cutting.
  Build as a shared logging utility/trigger used by every table's
  insert/update/delete, not bolted on per-module, from the start.
- **PB-39 (Trends & Analytics Dashboard)** — marked **not Testable** as
  written ("spot patterns" is subjective). Defined and built: redemption
  rate, forfeiture rate, average loan size and monthly loan volume
  (`lib/reports/analytics.ts`).

## Other docs

- `DECISIONS_LOG.md` — every assumption/placeholder/fix made autonomously
  across Sprints 2-10, in detail. Read this for anything flagged ⚠ below.
- `USER_GUIDE.md` — staff-facing how-to.

## Decisions log

- Printed pawn ticket / receipts (PB-17, PB-18): implemented as browser
  print (`window.print()`) with a print-optimized layout — no PDF library
  dependency needed for MVP. (Confirmed in Batch B.)
- Backups (Sprint 10, PB-43): Supabase handles backups server-side —
  documented, not custom-built.
- Auth/RBAC (Sprint 1): `public.profiles` (id = auth.users.id, `role` enum,
  `is_active`) is the single source of truth for role checks. `get_my_role()`
  / `is_admin()` are `SECURITY DEFINER` SQL functions so RLS policies on
  `profiles` itself don't recurse. Server-side pages call
  `requireRole(['admin', ...])` (`lib/auth/require-role.ts`); admin always
  passes regardless of the list (PB-3 AC2).
- Account deactivation (PB-4) sets `profiles.is_active = false` **and** bans
  the Supabase Auth user (`ban_duration: '876000h'`) via the admin API, so
  login is blocked at the auth layer, not just hidden in the UI.
- Password reset / new accounts (PB-2, PB-4) issue a random temp password
  and set `user_metadata.force_password_change = true`; the user is routed
  to `/force-password-change` on next login until they set their own.
- Session timeout (PB-5): 15 minutes of inactivity (`lib/auth/session-timeout.ts`),
  client-side timer + `signOut()`. Login lockout (PB-1 AC3): the original
  3-fail/60s client-side lockout was **removed** by the project owner
  post-launch (login now surfaces the real Supabase auth error on every
  failed attempt instead) — see QA_LOG.md. Do not reintroduce it without
  being asked.
- Testing: Vitest for unit tests (no React Testing Library yet — Sprint 1
  tests target pure logic: validation schemas, RBAC role checks). Run with
  `npm test`.

## Bootstrapping the first Admin account

There's no self-service signup — the very first Admin has to be created
manually once, from the Supabase dashboard (Authentication → Users → Add
User), then given the `admin` role:

```sql
insert into public.profiles (id, full_name, role)
values ('<auth-user-uuid-from-dashboard>', 'Your Name', 'admin');
```

After that, all further accounts are created from `/dashboard/users` by an
Admin (PB-4) — no direct dashboard access needed.

## Token discipline reminders

- Don't re-read files already in context unless changed.
- Refer to this file instead of re-explaining the project each turn.
- Short, specific commit messages: `feat(pb1): add login page + Supabase session check`.
- Build only what the current sprint's backlog rows specify — no speculative
  future-sprint code.
- Stop after each sprint batch and wait for review before continuing.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Rules learned the hard way (Nov 2026)

- A **Defaulted** loan accepts no payment, renewal or redemption. It must be
  reinstated (Cashier or Admin) or forfeited (Admin only) first. A reinstated
  loan keeps its old due date, so the nightly job (00:05 Manila,
  `ctm-default-detection`) defaults it again unless it is renewed or paid.
- Late charges: interest 5% per 30 days (or part), 7 grace days, liquidated
  damages 2% of unpaid principal per 30 days after the grace days. Payment
  order: damages, interest, principal. Rates are copied onto each loan.
- Admin corrections (`admin_edit_loan`, `admin_edit_payment`) refuse closed or
  archived loans and amounts that break the balance (migration 0086).
- Demo data: all rows are marked `is_demo`. A 3-month demo set was loaded on
  Nov 16, 2026 (see DECISIONS_LOG.md). Test accounts and passwords are never
  written in the repo.
- Open QA findings and the owner questions are in `QA_REPORT.md` (if present)
  and DECISIONS_LOG.md; the ones that matter for go-live: the 90-day
  redemption period (PD 114) before forfeiture, staging environment, and a
  migration baseline.
