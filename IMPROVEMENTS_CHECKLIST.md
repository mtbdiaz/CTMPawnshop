# CTM PawnTrack: Improvement Pass Checklist

Ticked after build, unit tests, DB self-tests and print PDFs passed. Clicking through the live app was not possible from the build sandbox (see QA_LOG Pass 4, Known Blockers). Evidence notes in QA_LOG.md ("Pass 4").

## Data model and logic
- [x] 1. Archive instead of delete (columns, Archive action + confirm, lists exclude archived, DELETE grants revoked, Admin Archive view with restore, audit logged)
- [x] 2. Item category (enum, required on appraisals, shown in loans/inventory/tickets/reports with filter, backfill Others)
- [x] 3. Karat prices 24K/21K/18K only, valuation = weight x price(karat), LTV for loan
- [x] 4. Appraisals as pre-pawn pool (available/pawned, loan flips to pawned, tab shows available only, backfill)
- [x] 5. Locked records + Admin edit with reason, before/after in audit, ledger kept consistent, DB-enforced
- [x] 6. Customer history and 0-100 score with tiers, weights in config table, archived loans included
- [x] 7. Reinstate defaulted loans (status Reinstated, accrued interest through default, excluded from forfeiture/auction)
- [x] 8. Capitalize and extend (principal + unpaid interest, +1 term, non-cash memo, counts as renewal)

## Screens and interaction
- [x] 9. Appraisal calculator (no customer; category, karat, weight; live value and max loan)
- [x] 10. New Loan flow (customer search-as-you-type with ranking, keyboard nav, score + flags; history panel; item search or inline calculator; review-and-confirm; Vault A default)
- [x] 11. Visible action buttons replacing record hyperlinks everywhere
- [x] 12. Sidebar fits at 768px height; collapsible icon rail, tooltips, persisted, accessible, reduced motion
- [x] 13. Merged pages: Settings (Rates & Rules, Users), Reports (Reports, Audit Trail admin-only); old URLs redirect
- [x] 14. Greeting removed; plain user menu (name, role, logout)

## Printing
- [x] 15. Thermal tickets and receipts (80mm, switchable to 58mm)
- [x] 16. A4 reports (header block, repeated headers, no split rows, page numbers)
- [x] 17. Print verified via Playwright PDF render (long report, long ticket text)

## De-vibe-coding
- [x] 18. DESIGN_NOTES.md research with sources, app audited
- [x] 19. Audit findings fixed

## Verification
- [x] Tests: archive/restore, locks/admin edit, score, search ranking, reinstate/capitalize math, appraisal pool, karat valuation, merged routing/roles
- [x] Test suite, next build, lint all clean
- [x] RLS check at DB level (non-Admin cannot edit locked record, restore, or read audit log)
- [x] No hard-delete path remains
- [x] Existing data loads after migrations
- [ ] dev merged to main, Vercel deployment succeeded
- [ ] Live walkthrough (see QA_LOG.md for what could be verified from this environment)
