# L!nc System Architecture and Implementation Contract

## 1. Scope

This document describes the current L!nc Backend Candidate and the intended application architecture. It does not certify that the Client is integrated or that Production is healthy. Keep implementation aligned with the existing repository until a change is covered by tests and the release gates pass.

## 2. Current stack

- Client: existing React/TypeScript application snapshot, not yet confirmed as the currently deployed/approved Client.
- API: Node.js 22, Express, hosted on Vercel Functions.
- Persistence: Supabase Postgres through PostgREST using server-only credentials.
- Tests: Node's built-in test runner (node --test).
- Notification provider: LINE is a future/partially specified integration. The current Candidate logs an ALERT_PENDING event without guardian identifiers; this does not mean a notification was sent.

## 3. Current code layout

The current Backend repository is intentionally kept in its existing flat layout while recovery is underway.

- api/[...path].js — Vercel catch-all entry adapter; keep its routing behavior covered by tests.
- auth.js — shared-service-key gate and fail-closed verified-user gate.
- error-handler.js — centralized sanitized 404 and error responses.
- request-validation.js — bounded shape validation for user-related request bodies.
- controllers.js — registration, heartbeat, and delete-alert handlers.
- db.js — Supabase REST adapter; local JSON persistence is restricted to local development.
- server.js — Express app, CORS, health/readiness, protected API routes.
- index.js — Node entry point.
- package.json and package-lock.json — dependencies and reproducible install.
- vercel.json — Vercel routing and branch-specific deployment configuration.
- supabase/migrations/20261022_002_linc_core.sql — Candidate database schema.
- test/ — security, DB timeout/configuration, controller, CORS, Serverless startup, error-response and routing regression tests.
- docs/IDENTITY_AUTH_RELEASE_GATE.md — release gates and incident evidence.
- docs/ARCHITECTURE.md — this architecture contract.

The frontend is a separate codebase/snapshot and must not be represented as integrated based only on the existence of the Backend repository. Do not move or refactor the existing Backend layout while Production is down unless a tested change materially improves recovery or security.

## 4. Request and data flow

1. The Client obtains a short-lived access token from the approved identity provider. The deployed Client/session contract is not yet confirmed.
2. The Client sends its access token over HTTPS. A public Client must never contain LINC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, or other server-side credentials.
3. A reviewed server-side verifier must validate token signature/issuer/audience/expiry and revocation/session state through the approved provider before creating req.auth.userId. The existing Candidate deliberately does not create this principal and returns a fail-closed response until the verifier is implemented.
4. User-owned database operations derive the owner from req.auth.userId; any user ID in a body is at most a consistency check and must never override the verified principal.
5. Database writes use the Candidate schema contract in supabase/migrations/20261022_002_linc_core.sql. Confirm that schema against the intended non-production project before applying any migration.
6. Events such as heartbeats or app-delete alerts must be persisted before they are marked as successful. Notification delivery should use an outbox/queue with a stable event ID, retry policy, delivery status, and idempotency so duplicate requests do not cause duplicate messages.
7. Guardian pairing must require proof from LINE or the approved identity provider. A user-supplied LINE ID or random client-generated identifier is not proof of pairing.

## 5. API contract (current Candidate)

| Method | Route | Purpose | Current behavior |
|---|---|---|---|
| GET | /health | Process liveness | Returns HTTP 200 without requiring database credentials |
| GET | /ready | Dependency readiness | Returns HTTP 503 if database configuration or connection is unavailable |
| POST | /api/v1/users/register | Create/update authenticated user's profile | Requires service API key and trusted verified principal; otherwise fails closed |
| POST | /api/v1/heartbeat | Store heartbeat and status | Requires service API key and trusted verified principal; otherwise fails closed |
| POST | /api/v1/alert/delete | Record app-removal alert event | Requires service API key and trusted verified principal; notification delivery is not complete |

The shared-key requirement is suitable only for a trusted server-to-server/BFF path. Whether the approved Client uses such a path or calls this API directly has not been verified. Do not embed the shared key in a browser or mobile package. Choose and implement one explicit request contract before wiring production identity verification.

## 6. Reliability and edge-case policy

- Missing database configuration: readiness returns 503; do not fall back to ephemeral persistence in a Vercel deployment.
- Database timeout/network/upstream failure: return a generic 503, log a sanitized error code, never include service credentials or upstream response bodies.
- Invalid/expired token: reject the request; do not reconstruct identity from request fields.
- Missing verifier/configuration: fail closed; never accept an unverified req.auth object from JSON input.
- Cross-account access: all select/update/delete operations must scope to the server-verified principal, with regression tests for account A attempting account B.
- Malformed JSON/oversized payload: return a client error (400/413) rather than a generic server error; do not leak stack traces.
- Duplicate delivery/retries: idempotent event IDs and deduplication are required before real guardian messages are enabled.
- Offline/late heartbeat: represent a stale/unreachable state with timestamps; do not infer a confirmed emergency from missing network alone.
- Observability: correlation/request IDs and sanitized structured logs. Do not log API keys, bearer tokens, guardian LINE IDs, or raw request bodies.
- Serverless filesystem: the deployment must not write local files at module import. The test suite injects an EROFS failure and verifies /health remains 200 while /ready fails closed when Supabase values are absent.

## 7. Error response conventions

Responses must be stable and non-sensitive:
- 400: malformed request/body
- 401: missing, malformed, expired or invalid user credential
- 403: a verified principal attempted to access a different user's resource
- 404: the requested user/resource does not exist or should not be disclosed
- 409: idempotency/conflict case that the caller can resolve
- 413: request body too large
- 429: rate limit exceeded
- 500: unexpected internal error, generic public message only
- 503: required identity/database/provider configuration missing or dependency unavailable

Do not wrap every line in try/catch; catch asynchronous boundaries and expected failure points, normalize errors once, and allow unexpected errors to reach a centralized sanitized error handler.

## 8. Target modular structure (future, incremental refactor only)

After the current Candidate is stable and covered by regression tests, refactor incrementally toward this feature-oriented structure:

- src/app.js
- src/config/env.js and src/config/security.js
- src/middleware/authenticate-user.js
- src/middleware/require-service-key.js
- src/middleware/request-id.js
- src/middleware/rate-limit.js
- src/middleware/error-handler.js
- src/modules/profiles/profile.routes.js, profile.controller.js, profile.service.js, profile.repository.js
- src/modules/heartbeat/heartbeat.routes.js, heartbeat.controller.js, heartbeat.service.js
- src/modules/alerts/alert.routes.js, alert.service.js, notification-outbox.repository.js
- src/modules/guardian-pairing/pairing.routes.js, pairing.service.js, provider-verification.js
- src/infrastructure/supabase/client.js and repositories/
- src/infrastructure/line/messaging-client.js
- src/infrastructure/logging/logger.js
- src/shared/errors/, validation/, constants/
- supabase/migrations/
- test/

This target structure is a roadmap, not a claim that those modules currently exist. The immediate recovery task should continue on the tested Candidate branch without a broad rewrite.

## 9. Release gates

- [ ] Confirm the approved Client source and exact login/session provider/claim format.
- [ ] Confirm whether requests travel through a trusted BFF or directly from the Client. Keep service keys server-only.
- [ ] Implement and test real server-side token verification, expiry/revocation behavior, and principal-to-owner isolation.
- [ ] Confirm the exact non-production Supabase project and service-key role without exposing secrets.
- [ ] Inspect its schema/constraints/RLS/grants before any migration or synthetic CRUD.
- [ ] Deploy one explicitly reviewed Preview once build quota and authorization permit.
- [ ] Verify health/readiness, invalid/missing/valid credentials, cross-account attempts, persistence across separate invocations, and cleanup of synthetic records.
- [ ] Test notification delivery through a stub/sandbox; do not send a live guardian message during testing.
- [ ] Only after all gates pass, request explicit approval for a backed-up, reversible Production release.

## 10. Latest known verification (2026-10-24)

- Candidate PR #2 latest tested commit at the time this document was added: 26daea2ae8f9d354a74a8b156f1e3e615f6d5292.
- Isolated Sandbox: npm ci installed 85 packages; npm test passed 38/38; npm audit reported zero vulnerabilities; Vercel config/scope checks and git diff --check passed.
- The added serverless regression test injects a test-only EROFS failure for legacy linc_data.json writes and verifies local HTTP /health = 200, /ready = 503 database_not_configured when database configuration is intentionally absent.
- GitHub Actions run #139 passed for that commit: https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40074894635.
- Production remained HTTP 500 on both /health and /ready on the latest real read-only check recorded in docs/IDENTITY_AUTH_RELEASE_GATE.md. Candidate code/tests are not a Production repair or proof of real database/auth integration.
- No SQL migration, database CRUD, secret decryption, Production environment changes, Production deployment, PR merge, or real notification was performed.

## 11. API error-boundary hardening (2026-10-24)

The current Candidate's Express app imports stable not-found and final error middleware from `error-handler.js`:
- Malformed JSON returns HTTP 400 with code `INVALID_JSON`.
- JSON body over the 64 KiB parser limit returns HTTP 413 with code `REQUEST_TOO_LARGE`.
- Unknown routes return HTTP 404 with code `ROUTE_NOT_FOUND`.
- Unexpected errors return a generic HTTP 500 `INTERNAL_ERROR`; logs contain only request method, status, normalized response code, and a validated internal error code. They do not log raw request bodies, exception messages, bearer tokens, or credentials.
- The response does not contain a stack trace or echo attacker-supplied payload.

The new `test/error-handling.test.js` covers malformed JSON 400, oversized payload 413, unknown route 404, and a thrown unexpected error that must return generic 500 without exposing exception details. Candidate commit `92f4fc02f68edc81c4ae333739c2265945550980` passed **44/44 tests** in the isolated Sandbox; `npm audit` reported 0 vulnerabilities; `node --check server.js`, `node --check db.js`, and `node --check error-handler.js` passed; Vercel config/scope checks and `git diff --check` passed; GitHub Actions [run #167](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40076900623) succeeded. This is test/CI evidence only; it does not implement user-session verification or repair the deployed Production function.

## 12. Supabase network timeout and response-failure handling (2026-10-24)

The database adapter now applies an 8-second abort timeout to each Supabase REST request unless a caller explicitly supplies its own signal. Network/timeout failures become a generic `DB_UNAVAILABLE` error; malformed JSON from a nominally successful upstream response also becomes `DB_UNAVAILABLE` instead of leaking a raw `SyntaxError` into the API layer. Non-success upstream responses still retain only a small validated upstream error code for internal classification and never expose the response body.

Regression coverage in `test/db.test.js` verifies that a signal is attached, a simulated `AbortError` is normalized, and invalid upstream JSON becomes a generic database-unavailable error. Candidate commit `92f4fc02f68edc81c4ae333739c2265945550980` passed **44/44 tests** in the isolated Sandbox; `npm audit` reported 0 vulnerabilities; `node --check server.js`, `node --check db.js`, and `node --check error-handler.js` passed; Vercel config/scope checks and `git diff --check` passed; GitHub Actions [run #167](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40076900623) succeeded.

This is a bounded-failure improvement for the Candidate. It does not prove real Supabase connectivity or user-session verification.

## 13. Protected API request-shape validation (2026-10-24)

The protected registration, heartbeat and app-delete routes now run `validateUserRequest` after the shared service-key and verified-user middleware. The validator:
- Requires a JSON object when a request body is supplied; null and array bodies are rejected.
- Allows an optional `userId` only when it is a non-empty string of at most 200 characters. The ID remains a consistency check only; identity is still derived from the verified `req.auth.userId`.
- Allows an optional `grade` only as a string of at most 32 characters.
- Does not copy arbitrary body fields into trusted identity or guardian-pairing state.

Regression tests in `test/request-validation.test.js` cover missing/null/array bodies, malformed or oversized user IDs, invalid grades and a valid request shape. On Candidate commit `5a1ae892f37df094fddd65666d397cb7325431b5`, isolated Sandbox checks passed **49/49 tests**, `npm audit` reported 0 vulnerabilities, all four backend JavaScript entry/middleware files passed `node --check`, Vercel config/scope and `git diff --check` passed, and GitHub Actions [run #175](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40077023815) succeeded.

This is request-shape validation only; the approved Client session contract and the production end-user identity verifier remain unresolved.
