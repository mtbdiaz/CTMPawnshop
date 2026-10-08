# CTM PawnTrack: Improvement Pass Checklist

Tick only after built, tested, and verified in the running app. Evidence notes in QA_LOG.md ("Pass 4").

## Data model and logic
- [ ] 1. Archive instead of delete (columns, Archive action + confirm, lists exclude archived, DELETE grants revoked, Admin Archive view with restore, audit logged)
- [ ] 2. Item category (enum, required on appraisals, shown in loans/inventory/tickets/reports with filter, backfill Others)
- [ ] 3. Karat prices 24K/21K/18K only, valuation = weight x price(karat), LTV for loan
- [ ] 4. Appraisals as pre-pawn pool (available/pawned, loan flips to pawned, tab shows available only, backfill)
- [ ] 5. Locked records + Admin edit with reason, before/after in audit, ledger kept consistent, DB-enforced
- [ ] 6. Customer history and 0-100 score with tiers, weights in config table, archived loans included
- [ ] 7. Reinstate defaulted loans (status Reinstated, accrued interest through default, excluded from forfeiture/auction)
- [ ] 8. Capitalize and extend (principal + unpaid interest, +1 term, non-cash memo, counts as renewal)

## Screens and interaction
- [ ] 9. Appraisal calculator (no customer; category, karat, weight; live value and max loan)
- [ ] 10. New Loan flow (customer search-as-you-type with ranking, keyboard nav, score + flags; history panel; item search or inline calculator; review-and-confirm; Vault A default)
- [ ] 11. Visible action buttons replacing record hyperlinks everywhere
- [ ] 12. Sidebar fits at 768px height; collapsible icon rail, tooltips, persisted, accessible, reduced motion
- [ ] 13. Merged pages: Settings (Rates & Rules, Users), Reports (Reports, Audit Trail admin-only); old URLs redirect
- [ ] 14. Greeting removed; plain user menu (name, role, logout)

## Printing
- [ ] 15. Thermal tickets and receipts (80mm, switchable to 58mm)
- [ ] 16. A4 reports (header block, repeated headers, no split rows, page numbers)
- [ ] 17. Print verified via Playwright PDF render (long report, long ticket text)

## De-vibe-coding
- [ ] 18. DESIGN_NOTES.md research with sources, app audited
- [ ] 19. Audit findings fixed

## Verification
- [ ] Tests: archive/restore, locks/admin edit, score, search ranking, reinstate/capitalize math, appraisal pool, karat valuation, merged routing/roles
- [ ] Test suite, next build, lint all clean
- [ ] RLS check at DB level (non-Admin cannot edit locked record, restore, or read audit log)
- [ ] No hard-delete path remains
- [ ] Existing data loads after migrations
- [ ] dev merged to main, Vercel deployment succeeded
- [ ] Live walkthrough (see QA_LOG.md for what could be verified from this environment)
