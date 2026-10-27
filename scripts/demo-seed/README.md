# Demo data seed (1 Jul - 27 Oct 2026)

Deterministic (fixed random seed 20260711). The generator lives in the database, in schema `demo_seed`,
because the data is too large to send through the SQL connector and the sandbox cannot reach the Supabase API.

Run order (SQL editor, one file at a time):
1. `01_helpers.sql`, `02_sim_loan.sql`, `02b_generators.sql`
2. `select demo_seed.gen_days('2026-07-01','2026-08-15'); select demo_seed.gen_days('2026-08-16','2026-09-30'); select demo_seed.gen_days('2026-10-01','2026-10-27');`
3. `03_04_remaining.sql` (= `03_extras.sql` + `04_load.sql`), then `gen_misc1()`, `gen_batches()`, `gen_audits()`, `gen_flags_rem()`, `gen_opex_capital()`
4. Dry run: `select demo_seed.dry_run();`
5. Load (each in its own call, with triggers off):
   `set session_replication_role = replica; select demo_seed.load_staff('<password>');`
   `set session_replication_role = replica; select demo_seed.load_core();`
   `set session_replication_role = replica; select demo_seed.load_audit();`
6. Check: `select * from demo_seed.verify();`

Seeded rows are not marked in the app. Their ids all start with `dede0000-`, which is how they can be found.
To remove every seeded row (and the 7 staff logins):
`set session_replication_role = replica; select demo_seed.unload();`
Loading twice is refused until `unload()` has run. Re-generating needs `select demo_seed.reset();` first.
