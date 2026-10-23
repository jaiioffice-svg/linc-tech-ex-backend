# L!nc Client–Backend Integration Plan

Status: design-only proposal; not a release approval.
Last reviewed: 2026-10-24.
Target backend branch: `fix/supabase-readiness-diagnostics`.

## Why this document exists

The reviewed client archive `linc_reviewed.zip` contains a React/Vite client and an Express server in `server.ts`. The GitHub repository `linc-tech-ex-backend` is a separate service with a different API surface and Supabase-backed `linc_users` storage. These are not yet one coherent application backend.

The client server currently stores users, sessions, activity, and alerts in `data/linc_store.json`. The backend repository stores a smaller heartbeat-oriented model in Supabase. Pointing the client at the backend as-is would not preserve the client session model or all application data.

This plan is documentation only. It does not add routes, change schema, run migrations, enable notifications, merge PRs, or alter Production.

## Verified current surfaces

### Client archive (source inspection)

- Session tokens are random opaque values; the server stores SHA-256 token hashes and checks expiration.
- `requireOwner` checks the session owner for several profile/activity endpoints.
- `POST /api/user/setup` creates a session, but a new profile is not backed by a verified identity provider. It also contains placeholder guardian values and assigns a guardian-paired timestamp during setup. Those values must not be treated as verified contact/pairing.
- Full-name handling includes a string marked `[AES-256 GCM]`; this marker is not evidence that AES-GCM encryption was performed.
- `POST /api/payment/in-app-purchase`, `/api/payment/restore`, and `/api/payment/activate` fail closed with HTTP 501.
- `POST /api/engine/heartbeat` fails closed with HTTP 501 pending device authentication.
- Current persistence is a local JSON file and is not a safe durable shared store for multi-instance/serverless deployment.

### Backend repository

- `POST /api/v1/heartbeat` and `POST /api/v1/alert/delete` are guarded by `LINC_API_KEY`. This is service-to-service authentication, not end-user identity or account ownership.
- `GET /health` is a process health check.
- `GET /ready` verifies Supabase reachability, not user-level reads/writes or authorization.
- Supabase `public.linc_users` currently has `user_id text`, `created_at bigint`, `last_heartbeat bigint`, and `updated_at timestamptz`. The two bigint timestamp fields are expected to be epoch milliseconds in the current backend code.
- A readiness response of HTTP 200 must not be interpreted as end-to-end application readiness.

## Target architecture

1. **Identity boundary:** every user-facing request must resolve an authenticated principal from a server-verified session or Supabase Auth token. Never authorize using a client-supplied `userId` alone.
2. **Service boundary:** keep `LINC_API_KEY` for trusted service-to-service calls only. Never place it in browser code, Vite-exposed variables, or mobile-client bundles.
3. **Persistence boundary:** move client profiles, session metadata, guardian pairing, heartbeat events, activity logs, alert events, and notification delivery results to durable database tables. Do not store a service-role key in the client.
4. **Ownership boundary:** derive the owner ID from the verified principal. If a route includes a resource/user ID, compare it to that principal or apply a narrowly defined guardian relationship authorization rule.
5. **Notification boundary:** distinguish `queued`, `provider_accepted`, `delivered` (only when the provider supplies delivery evidence), and `failed`. A database write or successful API response alone is not proof of delivery.
6. **Guardian-pairing boundary:** use a short-lived, single-use pairing challenge; bind it to the intended user and guardian; expire it; record verified state only after the callback/confirmation is validated. Never infer pairing from profile setup.
7. **Privacy boundary:** remove fake defaults for phone/LINE identity, avoid logging tokens or personal data, define retention/deletion rules, and implement real encryption only where key management and decryption flows are designed and tested.

## Proposed data model (not a migration)

- `profiles`: internal user ID, minimal profile fields, creation/update timestamps.
- `sessions` (only if custom sessions are retained): token hash, user ID, expiry, revoked timestamp, created timestamp. Store no raw session token.
- `guardian_links`: user ID, guardian identity/provider ID, status, challenge expiry, verified timestamp, revoked timestamp.
- `heartbeat_events`: user ID, optional registered device ID, received timestamp, event source.
- `activity_events`: user ID, event type, minimal safe metadata, timestamp.
- `alert_events`: user ID, alert type, status, created timestamp.
- `notification_deliveries`: alert ID, provider, provider message ID, provider status, attempts, last error category, timestamps.

Use foreign keys, uniqueness constraints, explicit ownership policies, and indexes based on real query patterns. Do not apply this model to the live database until a migration and rollback plan have been reviewed.

## API contract work required before implementation

Create a route matrix from every client call and assign each route one of: keep, adapt, replace, or remove. For each route record method, request schema, response schema, auth requirement, owner rule, rate limit, side effects, and tests.

The client archive currently calls routes that are absent from its own `server.ts`, including `/api/line/simulate-scan` and `/api/engine/alert`. The latter must not be implemented as a generic caller-controlled alert trigger; its authorization and event semantics must be defined first.

The backend repository's current `/api/v1/heartbeat` contract is not a drop-in replacement for the client `/api/heartbeat/ping` or `/api/engine/heartbeat` routes. Align request/response schemas and authentication explicitly; do not create aliases without enforcing the same security model.

## Release gates

- [ ] One documented identity/session model selected and implemented.
- [ ] All user-data routes have negative tests for missing, invalid, expired, and wrong-owner credentials.
- [ ] Guardian pairing cannot be marked verified without successful challenge confirmation.
- [ ] No placeholder guardian contact data or fake encryption markers remain.
- [ ] Database schema and migration have been reviewed; migration and rollback are tested on a non-production environment.
- [ ] Client and backend share one versioned API contract.
- [ ] Build and unit tests pass in CI with lockfile-based dependency installation.
- [ ] Preview end-to-end tests prove create/read/update and cross-user denial against a dedicated test identity.
- [ ] Notification delivery status is verified against provider results.
- [ ] Production secrets and data remain untouched until all gates pass.

## Current decision

Keep the existing PR in Draft. Do not merge, run schema migrations, switch client traffic, or promote a deployment based solely on `/health` or `/ready`. First implement the identity boundary and durable persistence in a controlled Preview environment, then validate the client against the agreed API contract.
