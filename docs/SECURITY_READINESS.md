# L!nc Backend Security Readiness

Last reviewed: 2026-10-24
Scope: current backend branch `fix/supabase-readiness-diagnostics`.

## Current verified state

- GitHub Actions run #50 passed on commit `49e46eea5f1a4f724163d33cdb382d64c6bf2339`.
- Vercel Preview deployment for that commit reached `READY`: `linc-tech-ex-backend-77620egrs-linc8.vercel.app`. This is a Preview deployment; Production was not changed.
- Live Preview `GET /health` returned HTTP 200 with `status: operational`.
- Live Preview `GET /ready` returned HTTP 200 with `status: ready` and `database: reachable`. This proves the readiness probe can reach Supabase, not that application data can be written/read end-to-end.
- Vercel project settings show these environment-variable names targeted to Preview: `CRON_SECRET`, `LINC_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Values were not retrieved or printed. Their presence in settings does not prove each value is valid.
- Live Preview `GET /api/user/linc-contract-audit-nonexistent` returned HTTP 404 `Cannot GET /api/user/...`, confirming the saved client snapshot's profile-restore endpoint is not implemented in this backend.
- The current test suite includes controller tests, database adapter tests, LINE alert tests, API-key middleware tests, and HTTP-level rejection tests.
- The HTTP security tests verify that missing/wrong API credentials are rejected for heartbeat/delete routes and that the cron route rejects missing credentials.
- Supabase service credentials are read by the backend from environment variables; they must never be embedded in a mobile/web client.
- Heartbeat payloads do not set or replace `guardianLineId`. Guardian linking must be a separate verified consent flow.
- The current shared `LINC_API_KEY` proves possession of an integration secret, not the identity or ownership of an individual user.

## Client integration audit

- The available saved client snapshot (`App.tsx`) restores a profile using `localStorage` key `linc_current_user_id` and requests `/api/user/{id}`. This is a client-held identifier, not proof of identity.
- The currently connected GitHub integration exposes only `jaiioffice-svg/linc-tech-ex-backend`; no separate client repository was available to review during this audit.
- The backend's current route set does not implement the client's `/api/user/{id}` profile endpoint. Do not assume the saved client snapshot and deployed backend are already integrated.
- No Supabase Auth session/token flow was visible in the available client snapshot. Treat the auth provider and identity mapping as **unconfirmed**, not as an implemented capability.
- The Vercel web-fetch capability used for this audit supports GET requests only, so it cannot establish successful authenticated POST heartbeat or DELETE-alert persistence. Those live write/read checks remain unverified.

## Release blockers

1. **Per-user authentication and ownership are not complete.** A request authenticated only by the shared API key can submit a caller-chosen `userId`. Do not treat this key as user authentication, and do not ship it as a secret embedded in a client.
2. **Client/backend contract is unverified.** The saved client snapshot calls `/api/user/{id}`, while this backend has no matching route; the live client repository and sign-in mechanism must be identified before wiring identity securely.
3. **Live database write/read has not been demonstrated end-to-end** against the current Preview deployment with a controlled test identity.
4. **Timestamp migration requires live-schema verification.** Do not apply `20261024_002_convert_heartbeat_timestamps_to_epoch_ms.sql` until the actual column types and interpretation of existing timestamp values have been checked in the intended Supabase project.
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
