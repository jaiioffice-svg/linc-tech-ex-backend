# L!nc Backend Security Readiness

Last reviewed: 2026-10-24 (follow-up verification)
Scope: current backend branch `fix/supabase-readiness-diagnostics`.

## Latest verification (2026-10-24)

- Latest branch commit checked: `af3025553511d8eae82a2c9717e3ec24b44d513a` (`docs: record latest preview and timestamp comparison`).
- Vercel Preview deployment `dpl_B6knapvpTJMhctYFXAEEcaBrbjsB` reached `READY` for this commit: https://linc-tech-ex-backend-8nzd20vlg-linc8.vercel.app/ . Production was not changed.
- On this exact Preview URL, `GET /health` returned HTTP 200 with `status: operational`; `GET /ready` returned HTTP 200 with `status: ready` and `database: reachable` after the deployment became READY.
- These checks validate deployment readiness and database reachability only. They do **not** verify live application-data writes/reads, per-user authentication, ownership enforcement, or guardian notification delivery. A separate workflow-run result for this commit was not confirmed in this follow-up.
- The timestamp conversion migration has **not** been applied to the live Supabase database. PR #6 remains open and Draft; do not merge or promote to Production until release blockers are resolved.

## Live Supabase schema inspection (read-only, 2026-10-24)

The project owner ran an `information_schema.columns` query for `public.linc_users` and reported:

| Column | Actual type | Nullable | Default |
|---|---|---|---|
| `user_id` | `text` | no | none |
| `created_at` | `bigint` | no | none |
| `last_heartbeat` | `bigint` | yes | none |
| `updated_at` | `timestamp with time zone` | no | `now()` |

A read-only aggregate query returned one row:
- `total_users = 1`, `created_at_present = 1`, `heartbeat_present = 1`.
- `created_at = 1792764446600`; `last_heartbeat = 1792765054220`.
- The values have the magnitude and spacing expected for Unix epoch milliseconds. Interpreting them as epoch milliseconds yields 2026-10-23 14:07:26.600 UTC and 2026-10-23 14:17:34.220 UTC, respectively. This is consistent with the backend's expected units, but does not independently prove these values correspond to the original event times.

- The live column types already match the backend's expected storage types for `created_at` and `last_heartbeat`; no timestamp type conversion is needed based on this inspection.
- The live `created_at` column lacks the epoch-millisecond default defined by the base migration. The backend currently supplies `created_at` explicitly on writes, but aligning the default would make the schema consistent.
- `last_heartbeat` correctly has no default; `updated_at` correctly uses a timezone-aware timestamp with `now()`.
- Do not run the conversion migration just to convert types that are already correct. If the migration is used to align the default, review its effects first. A follow-up read-only comparison of `updated_at` against `last_heartbeat` can help validate timing consistency.

## Earlier verified state

- GitHub Actions run #58 passed on commit `5bd9d9ab3a03405b124f37684b664be59b784250`: https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40024338755.
- Preview deployment `dpl_AerG2MdqFbqzipanUpx1EdwVJnTD` reached `READY`: https://linc-tech-ex-backend-hsx0q6s04-linc8.vercel.app/.
- Added `docs/API_AUTH_CONTRACT.md` in commit `851a91c` to specify a proposed, explicitly unimplemented auth/client contract. It does not add or claim new runtime routes.
- Vercel Preview environment variable names observed: `CRON_SECRET`, `LINC_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Values were not retrieved or printed. Their presence in settings does not prove each value is valid.
- Live Preview `GET /api/user/linc-contract-audit-nonexistent` returned HTTP 404 `Cannot GET /api/user/...`, confirming the saved client snapshot's profile-restore endpoint is not implemented in this backend.
- Tests include controller, database adapter, LINE alert, API-key middleware, and HTTP-level rejection coverage. The HTTP security tests verify that missing/wrong API credentials are rejected for heartbeat/delete routes and that the cron route rejects missing credentials.
- Supabase service credentials are read by the backend from environment variables; they must never be embedded in a mobile/web client.
- Heartbeat payloads do not set or replace `guardianLineId`. Guardian linking must be a separate verified consent flow.
- The shared `LINC_API_KEY` proves possession of an integration secret, not the identity or ownership of an individual user.

## Client integration audit

- The available saved client snapshot (`App.tsx`) restores a profile using `localStorage` key `linc_current_user_id` and requests `/api/user/{id}`. This is a client-held identifier, not proof of identity.
- The currently connected GitHub integration exposes only `jaiioffice-svg/linc-tech-ex-backend`; no separate client repository was available to review during this audit.
- The backend's current route set does not implement the client's `/api/user/{id}` profile endpoint. Do not assume the saved client snapshot and deployed backend are already integrated.
- No Supabase Auth session/token flow was visible in the available client snapshot. Treat the auth provider and identity mapping as **unconfirmed**, not as an implemented capability.
- The available Vercel URL-fetch capability supports GET requests only, so it cannot establish successful authenticated POST heartbeat or DELETE-alert persistence. Those live write/read checks remain unverified.

## Release blockers

1. **Per-user authentication and ownership are not complete.** A request authenticated only by the shared API key can submit a caller-chosen `userId`. Do not treat this key as user authentication, and do not ship it as a secret embedded in a client.
2. **Client/backend contract is unverified.** The saved client snapshot calls `/api/user/{id}`, while this backend has no matching route; the live client repository and sign-in mechanism must be identified before wiring identity securely.
3. **Live database write/read has not been demonstrated end-to-end** against the current Preview deployment with a controlled test identity.
4. **Timestamp semantics are only partially verified.** Live column types and numeric magnitudes are consistent with epoch milliseconds, but exact event-time semantics remain unconfirmed. Do not apply `20261024_002_convert_heartbeat_timestamps_to_epoch_ms.sql` just to convert columns already typed as `bigint`.
5. **Guardian linking and LINE delivery are not production-verified.** Keep outbound alerts disabled until a verified linking/consent flow and a safe test recipient have been confirmed.
6. **Production promotion and PR merge remain gated** until the above release blockers are resolved and regression tests pass.

## Recommended implementation sequence

1. Locate/connect the actual client repository and inspect profile creation, session restore, heartbeat scheduling, and guardian linking before changing the API contract.
2. Confirm the sign-in/session provider and whether its stable user identifier is a Supabase Auth UUID or a legacy application ID. Do not infer this from the database column name.
3. Implement server-verifiable authentication compatible with the client. Validate token signature/issuer/audience or verify the token with Supabase Auth; never trust a client-supplied `userId` by itself.
4. Enforce ownership: derive the acting identity from the verified token and allow it to update only its own heartbeat/profile. Keep app-deletion/termination reporting distinct from user-initiated profile deletion, and prevent arbitrary cross-user status changes.
5. Add tests for missing, expired, malformed, and wrong-user tokens, plus positive owner-only heartbeat updates and denied cross-user updates.
6. Run controlled Preview integration tests for create/read/update using a dedicated test identity and verify cleanup. Do not expose a public test endpoint or log tokens/keys.
7. Verify database column types and timestamp semantics before any migration. Confirm readiness, live write/read, auth, and alert behavior separately.
8. Merge/promote only after release gates pass.

## Security invariants

- Never log API keys, access tokens, service-role keys, or authorization headers.
- Never trust a `userId` supplied in a request body as proof of identity.
- Never allow heartbeat requests to create or modify guardian links.
- Guardian notifications must be opt-in, tied to a verified link, and phrased with care.
- Keep diagnostic endpoints non-mutating and do not create unauthenticated write/test backdoors.


## Follow-up timestamp comparison (read-only, 2026-10-24)

The project owner reported the following UTC values from a read-only query:

- `created_at_utc`: `2026-10-23 14:07:26.600+00`
- `heartbeat_utc`: `2026-10-23 14:17:34.220+00`
- `updated_at`: `2026-10-23 14:27:17.813+00`
- `heartbeat_vs_updated_at`: `-00:09:43.593` (updated_at is later than last_heartbeat by 9 minutes 43.593 seconds)

This difference is **not by itself proof of a schema defect**: `updated_at` records a row update, while `last_heartbeat` records a heartbeat. However, the gap is larger than the milliseconds-scale difference expected when the current `saveUser()` path writes both from the same operation. The available snapshot cannot identify which later operation changed `updated_at`, nor prove that the two values came from one request.

Next diagnostic step: inspect relevant database triggers and available application/deployment logs in read-only mode, then run a controlled Preview write/read test with a dedicated test identity. Do not alter timestamp columns, apply the conversion migration, or infer a production incident from this comparison alone. Live write/read and event-time semantics remain unverified.
