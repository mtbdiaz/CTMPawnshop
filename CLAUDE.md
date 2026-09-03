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

## Folder structure (scaffolded in Sprint 0)

```
app/                    # Next.js App Router routes
  (auth)/               # login, password reset — added per-feature
  (dashboard)/          # role-gated screens per module — added per-feature
lib/
  supabase/
    client.ts           # browser client (anon key)
    server.ts           # createClient() = session-bound (RLS); createAdminClient() = service_role, server-only
    middleware.ts        # session-refresh helper used by proxy.ts
  validation/           # shared zod/validation schemas — added as needed
components/             # shared UI components — added as needed
proxy.ts                # Next.js 16 middleware equivalent; refreshes Supabase session cookie
supabase/
  migrations/           # SQL migrations (tables + RLS policies) — added per-feature
docs/                   # source-of-truth backlog docs (do not edit)
```

Scaffolded with `create-next-app` (TypeScript, Tailwind, ESLint, App Router,
no `src/` dir). Next.js 16.3.4 — middleware file convention is `proxy.ts`
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
  client-side timer + `signOut()`. Login lockout (PB-1 AC3): 3 consecutive
  failed attempts locks that email for 60s, tracked client-side in
  localStorage (`lib/auth/login-attempts.ts`) — acceptable for a
  single-location, small-staff shop; revisit if brute-force risk grows.
- Testing: Vitest for unit tests (no React Testing Library yet — Sprint 1
  tests target pure logic: validation schemas, RBAC role checks, login
  lockout). Run with `npm test`.

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
