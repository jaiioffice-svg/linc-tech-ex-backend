# Supabase setup — Candidate / Preview only

## Safety gate (must pass before any SQL or test write)

Do not run these instructions against Production. First positively identify the Supabase project used for **Vercel Preview** and prove it is isolated from the Production project. The current project identity/isolation has not been verified, and no Candidate migration has been applied to a persistent database. Until that is confirmed, do not run SQL, CRUD smoke tests, or data cleanup.

The JSON file adapter is for local development only. Vercel refuses database operations unless both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist; it does not fall back to ephemeral local storage across serverless invocations. The service-role key and other server secrets must never be committed or sent to a browser/mobile client.

## Preview environment configuration

After the non-production isolation gate has been documented:

1. Configure Preview-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the **same confirmed non-production Supabase project**. Use the Project URL from Supabase Settings → API. The Backend normalizes a trailing `/rest/v1` path.
2. Configure Preview-only `LINC_API_KEY` as a cryptographically random server-to-server secret of at least 32 UTF-8 bytes.
3. Configure Preview-only `LINC_INTERNAL_AUTH_SECRET` as a separate cryptographically random secret of at least 32 UTF-8 bytes. This must be shared only between the trusted server-side BFF and Backend; do not generate assertions in a browser or mobile package.
4. Add `LINC_ALLOWED_ORIGINS` only after confirming the approved Client/BFF origin. Values must be exact origins such as `https://app.example.com`, without path, query, or trailing slash. CORS is not authentication.
5. Do not copy any Production secret into Preview by assumption. Never commit, log, paste into an issue, or put secret values in Client code.

The project inventory must be inspected using names/targets only first. Do not decrypt or display secret values just to determine which project they belong to; verify the project identity through the non-secret Supabase project reference/configuration and the owner-approved environment mapping.

## Migration order (only for a confirmed isolated non-production project)

Before applying SQL, review the target schema and confirm the project reference. Apply and verify the Supabase migrations below **in chronological filename order**, one at a time. This list describes Candidate requirements; it is **not** permission to apply them now.

1. `supabase/migrations/20261022_002_linc_core.sql` — core profile/school/revenue schema and service-role table grants.
2. `supabase/migrations/20261022_003_defer_heartbeat.sql` — keeps `last_heartbeat` nullable while automatic missing-heartbeat monitoring is deferred.
3. `supabase/migrations/20261023_004_repair_service_role_grants.sql` — service-role schema/table grant repair for existing installations.
4. `supabase/migrations/20261024_003_auth_assertion_replay.sql` — durable, one-time signed-assertion replay protection RPC.
5. `supabase/migrations/20261024_004_notification_outbox.sql` — RLS-protected outbox and atomic app-termination recording RPC; new tables default events to `blocked` and enforce recipient/status consistency.
6. `supabase/migrations/20261024_005_outbox_fail_closed_default.sql` — upgrades a previously created outbox table to the fail-closed default, normalizes contradictory records without recipients, and adds the recipient/status constraint idempotently. Review the normalization of existing outbox rows before authorizing it.

After each migration, verify success and inspect the resulting object/grant state before continuing. Do not run the separate `migrations/001_create_linc_app_state.sql` file: it belongs to an old local PostgreSQL prototype and is not used by the Supabase REST adapter.

These migrations have been tested in the Candidate test suite, including PGlite-based PostgreSQL execution, but they have **not** been applied to a persistent Supabase database. PGlite is not proof of the target project's PostgREST schema cache, access configuration, project identity, or deployment credentials.

## Verification after an authorized Preview migration

1. Deploy the reviewed Candidate to Preview deliberately, using the exact commit SHA and without changing Production.
2. Call `GET /health`. HTTP 200 means the process responds; it does not prove database readiness.
3. Call `GET /ready`. HTTP 200 confirms the current read-only probe can query `public.linc_users`; it does **not** by itself prove the replay RPC, outbox RPC, every migration, owner isolation, or the trusted BFF integration.
4. Only after readiness succeeds, test the database RPCs and CRUD with synthetic accounts. Verify persisted results across separate serverless invocations, replay rejection, cross-account denial and deletion idempotency; verify cleanup afterward.
5. Do not enable or report LINE delivery until provider-verified guardian pairing/consent, Official Account eligibility and an actual dispatcher are implemented and tested. Current termination events are always `blocked` with a null recipient; recorded does not mean sent.

## Deferred behavior

Automatic missing-heartbeat detection is deferred. No Vercel Cron schedule is configured, and the placeholder under `api/cron/` is not an active endpoint. LINE notification delivery is not integrated yet.

Existing local JSON records require a separate reviewed migration/import plan before any traffic switch. No record import or production cutover is implied by this document.
