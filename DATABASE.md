# Supabase setup

The JSON file adapter is for local development only. Vercel refuses database
operations unless both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist; it
does not fall back to `/tmp`, which is ephemeral across serverless invocations.
The Supabase service-role key is server-side only and must never be committed or
sent to a client.

For Preview testing:

1. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LINC_API_KEY`, and
   `CRON_SECRET` as Preview environment variables in Vercel. Do not put values
   in source files, command output, or commits.
2. Apply `supabase/migrations/20261022_002_linc_core.sql` in the Supabase SQL
   Editor.
3. Redeploy the Preview, then test `/health` and `/ready`. Only test writes
   after the environment variables and migration are confirmed.

`/ready` checks whether the required Supabase variables exist; it does not run a
database query. `/health` is a liveness endpoint and remains independent of
database configuration. The heartbeat checker runs from the protected
`/api/cron/check-heartbeats` endpoint; no Vercel cron schedule is enabled here.

The earlier `migrations/001_create_linc_app_state.sql` file belongs to a local
PostgreSQL prototype and is not used by the Supabase REST adapter. Apply only
the migration under `supabase/migrations/` for this patch. Existing local JSON
records require a separate import before switching traffic.
