# CTM PawnTrack

Pawnshop management web app for CTM Pawnshop (Philippines): customers, gold appraisal, pawn loans and tickets,
payments, renewals, redemption, default and forfeiture, vault inventory and audits, auctions, cash ledger, compliance
and reports. Four roles: Admin, Operator, Cashier, Appraiser.

**Stack:** Next.js 16 (App Router, server actions), React 19, TypeScript, Tailwind 4, Supabase (Postgres, Auth, Storage,
Row Level Security, pg_cron), Vitest, hosted on Vercel.

## Run it locally
1. `npm install --legacy-peer-deps` (a plain `npm ci` fails: the lockfile is out of sync)
2. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` (server only, never commit it)
3. `npm run dev`, then open http://localhost:3000
4. `npm test` runs the unit tests; `npm run lint` and `npx tsc --noEmit` check the code

## Database
SQL migrations are in `supabase/migrations` (0001 to 0086). Every table has RLS; money changes go through role-checked
database functions. There is no self-service sign-up: the first Admin is created once in the Supabase dashboard (see
`CLAUDE.md`), and Admins create the other accounts in Settings, Users.

## Deploy
Vercel deploys production from `main`. Preview deployments need the three environment variables above.

## Where to read more
`CLAUDE.md` (project memory and rules), `DECISIONS_LOG.md` (every assumption and decision), `USER_GUIDE.md` (staff
how-to), `SPRINT_PROGRESS.md`, `QA_LOG*.md`, `DESIGN_NOTES.md`.
