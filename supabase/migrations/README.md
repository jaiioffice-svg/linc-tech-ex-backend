# Supabase migration safety and ordering

These SQL files are **not automatically applied by a GitHub commit or Vercel deployment**. Treat them as reviewed scripts and run them manually only against the intended Supabase project.

## Important: filenames do not currently encode the safe execution order

The base schema file, `20261024_linc_users_backend.sql`, sorts after the numbered files by filename. Do not blindly execute every file in lexical order.

Before applying any script:

1. Confirm the Supabase project URL in the dashboard matches the intended **non-production/Preview** project.
2. Run `../preflight_linc_users_readonly.sql` and inspect the existing table, column types, constraints, indexes, RLS status, and grants.
3. Back up or otherwise establish a recovery plan for any existing data.
4. Review the SQL and its effects against the actual schema. A green GitHub Actions result tests the application code; it does not execute or validate these SQL scripts against Supabase.

## Intended review sequence

This is a review sequence, **not permission to run the scripts**:

1. `20261024_linc_users_backend.sql` — establishes/adds the expected table structure and enables RLS. Inspect existing objects first; `CREATE TABLE IF NOT EXISTS` does not reconcile every possible schema mismatch.
2. `20261024_001_grant_linc_service_role.sql` — grants service-role table privileges. Review the target role and existing grants first.
3. `20261024_002_convert_heartbeat_timestamps_to_epoch_ms.sql` — **high caution**: changes timestamp column types. Do not run until the live column types and stored values have been inspected and a conversion plan verified.
4. `20261024_003_restrict_linc_users_grants.sql` — revokes `DELETE` from `service_role` while retaining `SELECT`, `INSERT`, and `UPDATE`. Review effective grants and application needs first.

Do not run a step just because a previous step succeeded. If the live schema already differs from these assumptions, stop and prepare a schema-specific migration instead.

## Relationship to Candidate PR #2 — do not mix migration contracts

This folder is on Draft PR #21's separate review branch. Its base migration `20261024_linc_users_backend.sql` is paired with that branch's `db.js`, which differs from Candidate PR #2's repository layer. In particular, the PR #21 base migration does **not** define the `data jsonb` column used by PR #2's `db.js`; Candidate PR #2's base migration `20261022_002_linc_core.sql` does define it.

Accordingly:

- Do not apply PR #21's migration bundle as a way to provision Candidate PR #2's database.
- The read-only preflight may help inspect an already identified non-production project, but its result must be reconciled against Candidate PR #2's actual schema contract.
- Any schema changes, timestamp conversions or grants require a new reviewed plan against the actual schema and a known non-production project. No SQL is authorized by this README, and no SQL is automatically applied by GitHub/Vercel.

## Security boundary

The Supabase service-role credential is server-only and remains highly privileged. Restricting table grants does **not** solve end-user authentication or owner isolation. The backend's shared API key is not proof of the end user's identity; do not treat this grant change as production security sign-off.

No script in this folder should be considered applied unless a separate database execution and post-migration verification have been recorded.
