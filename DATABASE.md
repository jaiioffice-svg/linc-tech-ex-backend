# Supabase setup

The JSON file adapter is for local development only. Vercel refuses database
operations unless both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist;
it does not fall back to ephemeral local storage across serverless invocations.
The Supabase service-role key is server-side only and must never be committed
or sent to a client.

## Preview environment

1. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `LINC_API_KEY` as
   Preview environment variables in Vercel. The URL and service-role key must
   come from the same Supabase project. Use the Project URL from Supabase
   Settings → API; the backend also normalizes a trailing `/rest/v1` path.
   Never put secret values in source files, logs, or commits.
2. Apply `supabase/migrations/20261022_002_linc_core.sql` in the Supabase SQL
   Editor for that same project.
3. Redeploy Preview, then check `/health` and `/ready`. Only test writes after
   database readiness succeeds.

`/health` is a liveness endpoint and does not require a database connection.
`/ready` performs a read-only request to `public.linc_users` and returns HTTP
200 only when the required configuration, REST endpoint, table, and access
permissions are working. Its sanitized `reason` helps distinguish common
configuration, missing-table, and permission problems without exposing secrets.

## Heartbeat monitoring

Automatic missing-heartbeat detection is deferred for this version. There is
no Vercel Cron schedule configured, and the current `vercel.json` routes
requests through `server.js`; the placeholder under `api/cron/` is not an
active endpoint. LINE notification delivery is also not integrated yet.

The earlier `migrations/001_create_linc_app_state.sql` file belongs to a local
PostgreSQL prototype and is not used by the Supabase REST adapter. Apply only
the migration under `supabase/migrations/` for this patch. Existing local JSON
records require a separate import before switching traffic.
