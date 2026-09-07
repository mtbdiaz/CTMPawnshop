# QA Log — Part 1: Authentication & Access, Customer Management, Appraisal & Valuation

Scope: PB-1 through PB-16. Audited actual code + RLS policies in
`supabase/migrations/*.sql` against `/docs/2026-SoftEng-CTMPawnshop-Sprint.xlsx`
and `/docs/CTM_PawnTrack_Comprehensive_Feature_List.docx`. Method: for every
role-restricted action, checked both the server-action/UI guard AND the
underlying RLS policy that a client session could hit directly — per project
rule, RLS is the real enforcement.

## PB-1 Login — **PASS (note: lockout feature intentionally removed by the user)**

- AC checked: valid credentials sign in; invalid credentials show a clear
  error.
- **Initial finding, then corrected**: `app/login/page.tsx` does not call
  the lockout logic in `lib/auth/login-attempts.ts` at all — I first read
  this as a regression (CLAUDE.md's decisions log and `SPRINT_PROGRESS.md`
  both describe a working 3-attempt/60s lockout) and wired it back into the
  login page. Before committing that, `git log` showed three commits by the
  actual project owner (`mtbdiaz`) explicitly reverting it:
  `e2546e2 fix(pb1): remove login lockout feature, surface real auth error`,
  `3965be8 chore(pb1): remove login lockout implementation (feature removed
  per request)`, `737009e chore(pb1): remove login lockout tests (feature
  removed per request)`. This is a deliberate, later human decision that
  supersedes the stale CLAUDE.md/decisions-log text (which was never
  updated after the removal). **I reverted my own change** — login now
  correctly surfaces the real Supabase auth error on every failed attempt,
  matching the owner's intent, with no client-side lockout.
- `lib/auth/login-attempts.ts` is leftover dead code (reintroduced by a
  merge commit, `d4be52d`, after the removal commits) — it is unused and
  untested (its test file was deleted). Left in place since deleting
  unreferenced files is outside this pass's scope and it does not affect
  any acceptance criterion; flagging here so CLAUDE.md/`SPRINT_PROGRESS.md`
  can be corrected to stop describing a lockout that no longer exists.

## PB-2 Password Reset — **PASS**

- Admin-triggered via `app/dashboard/users/actions.ts:resetPassword`,
  `requireRole(["admin"])`, uses `service_role` admin client (`updateUserById`)
  so it can't be bypassed by a non-admin RLS-side (service-role calls never
  go through a client session/RLS at all — the only path to this function is
  the gated server action). Sets `force_password_change` metadata; force
  redirect confirmed in `app/force-password-change/page.tsx` + middleware.

## PB-3 RBAC — **PASS** (verified UI + RLS together)

- `requireRole()` guards every dashboard page; `hasRole()` lets admin pass
  regardless of the allowed list (AC2).
- RLS spot-checked table by table against the role each action-layer guard
  claims:
  - `profiles`: self-or-admin select; admin-only insert; update policy's
    `with check` explicitly forbids a non-admin from changing their own
    `role`/`is_active` even though the `using` clause lets them update their
    own row — correctly enforced at the RLS layer, not just hidden in the
    UI. Good example already in place.
  - `system_settings`: any staff select, admin-only update — matches PB-6.
  - `customers`: any staff select; operator/admin insert/update — matches
    PB-7/PB-9. See PB-11 below for a gap found and fixed in this same table.
  - `appraisal_items`: any staff select, appraiser/admin insert — matches
    PB-12. See PB-16 below for a gap found and fixed.
- No other RLS/UI mismatches found in this module's tables.

## PB-4 Manage User Accounts — **PASS**

- Create/edit/deactivate all go through `service_role` (`createAdminClient`)
  behind `requireRole(["admin"])` — same reasoning as PB-2, not bypassable
  via a non-admin's own session since no RLS path exists to `auth.admin.*`.
  Deactivation also bans the Supabase Auth user (`ban_duration: '876000h'`),
  confirmed in code, not just a UI flag.

## PB-5 Session Timeout — **PASS**

- `components/session-timeout-watcher.tsx`: 15-minute inactivity timer,
  resets on the standard activity events, signs out and redirects to
  `/login` on expiry. Matches `lib/auth/session-timeout.ts` constant.

## PB-6 Business Rules Config — **PASS**

- `app/dashboard/settings/actions.ts`: admin-only via `requireRole` AND RLS
  (`system_settings: admin can update`). Zod schema
  (`lib/validation/settings.ts`) rejects negative rates/prices and
  LTV outside (0, 100] — checked edge cases (0%, negative, >100%) are
  rejected.

## PB-7 Register Customer — **PASS**

- `customerSchema` rejects empty required fields (AC2); AML check runs
  inline at registration (PB-8); RLS restricts insert to operator/admin,
  matching the action-layer guard exactly (no gap here, unlike PB-11).

## PB-8 AML Identity Verification — **PASS (as a documented placeholder)**

- `lib/customers/aml.ts`: keyword-based placeholder, clearly commented as
  such (no real sanctions-list provider available). Flag/clear both
  exercised by tests. This is a known, already-documented limitation
  (DECISIONS_LOG Sprint 2) — not silently "finalized" as a real check, left
  as-is per instructions.

## PB-9 Update Customer Profile — **PASS**

- `updateCustomer` reuses the same validated schema; RLS matches
  (operator/admin update). Edge case checked: submitting with a blank
  required field is rejected before any DB write (same zod schema as
  create).

## PB-10 View Transaction History — **MISSING → FIXED**

- **Finding**: `SPRINT_PROGRESS.md` claims this was "wired to real loan data
  in Sprint 4-5," but `app/dashboard/customers/[id]/page.tsx` still rendered
  a hardcoded placeholder string ("No transactions yet ... once Sprints 4-5
  is built") regardless of whether the customer had loans. The Loans,
  Loan Payments, and Loan Extensions tables have existed since Sprint 4/5
  and were never queried from this page.
- **Fix**: the customer detail page now queries `loans` (joined with
  `loan_payments` and `loan_extensions`) filtered by `customer_id`, ordered
  newest-first, and renders ticket number, principal, status, dates,
  payments, and extensions per loan. Empty state (no loans yet) still shows
  a clear message. No RLS change needed — `loans`/`loan_payments`/
  `loan_extensions` already grant `select` to any authenticated staff.
- Verified: `npm test`, `tsc --noEmit`, `npm run lint`, `npm run build` all
  clean after the change.

## PB-11 Blacklist Status — **PARTIAL → FIXED**

- AC: only an Admin may set/clear a customer's blacklist flag; a reason is
  required when blacklisting; the flag blocks new loans/appraisals.
- UI/action layer was already correct (`setBlacklistStatus` requires
  `requireRole(["admin"])`, empty reason rejected, `BlacklistForm` only
  rendered for `role === "admin"`), and `getBlacklistStatus` is correctly
  invoked at both loan and appraisal creation (blocks the transaction).
- **Finding (RLS gap)**: the `customers` UPDATE RLS policy allows
  **operator or admin**, not admin-only (needed for PB-9 profile edits done
  by Operators). Since RLS is row-level, not column-level, an authenticated
  Operator session could call
  `supabase.from("customers").update({ is_blacklisted: true, ... })`
  directly and bypass the admin-only action-layer guard entirely — the
  server action's `requireRole(["admin"])` only protects the one code path
  the UI form takes, not the table itself.
- **Fix** (migration `0012_qa_part1_rls_fixes.sql`, applied to the live
  Supabase project): added a `BEFORE UPDATE` trigger
  (`guard_customer_blacklist_columns`) on `customers` that raises an
  exception if `is_blacklisted` or `blacklist_reason` changes and the
  caller is not an admin (`public.is_admin()`), while leaving all other
  column updates (name/address/contact/etc., i.e. PB-9) unaffected for
  Operator/Admin as before.

## PB-12 Record Gold Item — **PASS**

- `appraisalSchema`: weight must be `> 0`, karat `1..24`, purity `(0, 100]`
  — negative/zero/out-of-range values rejected before insert (AC2 edge
  cases). RLS insert restricted to appraiser/admin, matching the action
  guard.

## PB-13 Photo/Notes — **PASS**

- At least one photo required (`photo_paths.min(1)`); photos stored in the
  private `item-photos` Supabase Storage bucket; detail page renders them
  via signed URLs (1hr expiry) rather than public URLs — appropriate for a
  private bucket. Condition notes optional, rendered when present.

## PB-14 Valuation & Loan Range — **PASS (flagged limitation preserved)**

- Confirmed the formula in `lib/appraisal/valuation.ts` is still the
  clearly-commented placeholder (`// TODO: confirm formula with CTM
  Pawnshop`), not silently finalized. **Not modified** — per scope
  instructions, this stays flagged as a known limitation pending real
  client-confirmed figures. Loan range correctly derives from live
  `system_settings` (gold price / LTV%), not hardcoded values; blocked with
  a clear error if gold price is unset or zero.

## PB-15 Counterfeit Risk Flag — **PASS (flagged limitation preserved)**

- `isCounterfeitRisk()` purity-tolerance table is also placeholder-flagged
  (`// TODO: confirm these tolerance ranges`), left as-is. Unrecognized
  karat claims conservatively flag for review rather than silently passing
  — good edge-case handling.

## PB-16 Resolve Counterfeit Flag — **PARTIAL → FIXED**

- AC: only an Admin may resolve (clear/confirm) a flagged item.
- UI/action layer already correct: `resolveCounterfeitFlag` requires
  `requireRole(["admin"])`, and the `ResolveForm` component is only
  rendered when `user.profile.role === "admin"`.
- **Finding (RLS gap, same pattern as PB-11)**: the `appraisal_items`
  UPDATE RLS policy allowed **appraiser or admin**, but appraisers never
  legitimately update a row after its initial creation anywhere else in the
  app (confirmed via a full-codebase grep — every other reference to
  `appraisal_items` is a `select`, and creation is an `insert`, not an
  `update`). An Appraiser session could therefore call
  `.update({ counterfeit_resolution: 'cleared', ... })` directly, bypassing
  the admin-only guard.
- **Fix** (same migration `0012_qa_part1_rls_fixes.sql`): replaced the
  `appraiser or admin` update policy with an admin-only update policy on
  `appraisal_items`.

## Summary

- PASS: PB-1, PB-2, PB-3, PB-4, PB-5, PB-6, PB-7, PB-8, PB-9, PB-12, PB-13, PB-14, PB-15 (13)
- PARTIAL → fixed to PASS: PB-11, PB-16 (2)
- MISSING → fixed to PASS: PB-10 (1)
- BROKEN: none remaining

All fixes verified clean against `npm test` (82 tests), `npx tsc --noEmit`,
`npm run lint`, and `npm run build`.

## Migration applied

`supabase/migrations/0012_qa_part1_rls_fixes.sql` — applied directly to the
live Supabase project (`qrbopdbpmwjjsjdwoawz`) via the Supabase MCP tool, in
addition to being committed to the repo so `supabase db push`/future
environments stay in sync. Two changes:
1. `appraisal_items` UPDATE policy narrowed from "appraiser or admin" to
   "admin only" (PB-16).
2. New `customers_guard_blacklist_columns` trigger blocking non-admin
   changes to `is_blacklisted`/`blacklist_reason` even though
   operator/admin both retain UPDATE on the table for other columns
   (PB-11).

## Known limitations left as-is (out of scope to resolve here)

- PB-1 lockout remains client-side/`localStorage`-based (documented
  project decision for a small single-location shop).
- PB-8 AML check remains a keyword placeholder (no real sanctions-list
  provider available in this environment).
- PB-14 valuation formula and PB-15 purity-tolerance table remain
  placeholders pending real figures from CTM Pawnshop — explicitly not
  finalized in this pass, per instructions.
