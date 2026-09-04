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

## Sprint 2 — Customer Management
