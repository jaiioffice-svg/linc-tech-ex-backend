# L!nc identity and ownership release gate

Status: BLOCKED — interim fail-closed guard added; approved identity/session verifier is still not integrated.

## Current verified boundary

The backend's `validateApiKey` middleware validates the shared `LINC_API_KEY` header. That is service/integration authentication; it does not establish which end user is making a request.

The user-scoped routes now chain `validateApiKey` and `requireVerifiedEndUser`. The latter rejects requests with HTTP 503 unless a trusted server-side authentication middleware has populated `req.auth.userId`. The handlers independently require that same principal and use it as the profile key. A body-supplied `userId` is only a consistency check; a mismatch is rejected with HTTP 403. Client input cannot populate Express's internal `req.auth` through JSON request fields.

Affected routes:
- `POST /api/v1/users/register`
- `POST /api/v1/heartbeat`
- `POST /api/v1/alert/delete`

**This is an interim security barrier, not a completed authentication implementation.** The routes are intentionally unavailable until the approved verifier is wired in. Do not remove the guard or add a header/body-based identity shortcut to restore functionality.

## Existing client-session evidence — not yet approved as deployed source

The separate documentation review `docs/CLIENT-SESSION-CONTRACT-REVIEW-20261024.md` on branch `review/client-session-contract-20261024` examined the Library artifact `Linc_Updated_Source_for_Online_Testing.zip`. That review explicitly says the archive has **not** been confirmed as the approved client release or the deployed Vercel source.

For that archive only, the review found:
- Client reads `linc_session_token` from browser `localStorage` and sends it as `Authorization: Bearer <token>`.
- Server creates a random opaque token, stores its SHA-256 hash in a JSON-file `db.sessions` store, and gives it a 30-day expiry.
- The archive's `getSessionUserId` validates the stored hash and expiry; `requireOwner` compares the resolved session user against the requested profile ID.
- The separate GitHub backend in this repository does not implement that same session contract. Its original protected routes used a shared `x-linc-api-key` and request-body `userId`.

Therefore, do **not** simply pass the archive's bearer token to this backend, assume the archive is the approved client, or assume its JSON session database is shared/durable on Vercel.

## Required follow-up

1. Confirm the exact approved client source and deployed client commit/version.
2. Choose one authoritative identity/session system based on that confirmed client contract; document issuer, audience, verification method, expiry, refresh/revocation behavior, and credential transport.
3. Implement the trusted server-side verifier that populates `req.auth.userId`, then connect it before `requireVerifiedEndUser`. Never derive the principal from the request body.
4. Enforce owner isolation for every read/write/delete path, including cross-account and identifier-tampering cases.
5. Make guardian pairing depend on a verified provider flow and explicit consent. Do not trust submitted guardian identifiers or placeholder values as proof of pairing.
6. Add negative tests for missing, malformed, expired, revoked, and invalid credentials; cross-account access; unauthorized deletes; profile claiming; and guardian-link spoofing.
7. Use durable session storage shared across serverless instances if opaque sessions are retained; store only token hashes and support server-side revocation.
8. Run tests against an isolated Preview database with test-only records and verified cleanup. Mocked REST responses do not prove real provider authentication or database CRUD.
9. Re-review the deployed Preview and logs, then obtain explicit security review before release.

## Interim guard regression coverage

The candidate's test suite checks that:
- User-scoped endpoints return HTTP 503 when a service key is present but no verified principal has been attached.
- The route gate and controllers reject a body `userId` that differs from the verified principal.
- The controller cannot create or mutate another profile by changing the body ID.
- Existing guardian-ID hardening and `app_deleted` state checks remain covered.

These tests prove behavior of the interim guard and controller logic; they do not prove a real session provider integration, because that verifier has intentionally not been selected or connected yet.

## Explicitly prohibited until authorized

- Do not merge or promote this candidate to Production while the identity/ownership blocker remains open.
- Do not change Production environment variables, decrypt or expose secrets, run migrations, or write to the live database as part of this gate.
- Do not select or add an identity provider speculatively.
- Do not interpret a passing health check, readiness check, mocked test, or successful build as proof that end-user authorization is secure.

## Latest verified evidence — 2026-10-24

### Latest code/test verification
- Latest verified runtime/test commit: [`70c9366eab11485b09220ec5d5d4fb18117d3a88`](https://github.com/jaiioffice-svg/linc-tech-ex-backend/commit/70c9366eab11485b09220ec5d5d4fb18117d3a88). It adds an exact-origin CORS allowlist in `server.js` and its regression test; earlier branch changes cover route/config tests and Vercel Git deployment settings.
- In the isolated Vercel Sandbox on exact commit `70c9366eab11485b09220ec5d5d4fb18117d3a88` (Node v24.22.1, npm 11.19.1):
  - `npm ci --no-audit --no-fund`: PASS; 85 packages installed.
  - `npm test`: PASS; **37/37 tests**, 0 failed.
  - `npm audit`: PASS; **0 vulnerabilities across the full dependency tree**.
  - Vercel config JSON/scope validation and `git diff --check`: PASS; working tree clean.
- GitHub Actions [Backend checks run #107](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40068792869) succeeded for exact runtime/test commit `70c9366`.
- Added `test/api-route-security.test.js`: requires every direct Express route under `/api/v1/` to run `validateApiKey` then `requireVerifiedEndUser`, and fails closed if an uninspected nested router is mounted.
- Added `test/vercel-config.test.js`: protects the Vercel branch-pause setting and confirms the existing Express build/routes remain configured.
- Added `test/cors.test.js`: verifies exact-origin allowlisting, rejects unlisted/invalid origins, confirms no browser CORS grant when not configured, and checks that server-to-server health requests still work.

### CORS allowlist hardening — latest Runtime change
- `server.js` now reads `LINC_ALLOWED_ORIGINS` as a comma-separated list of exact `scheme://host[:port]` origins. Requests with an `Origin` header receive CORS permission only for an exact, valid allowlist match; wildcard origins, URL paths, and non-HTTP(S) values are not accepted.
- If `LINC_ALLOWED_ORIGINS` is absent or empty, browser origins receive no CORS grant. Requests without an `Origin` header (such as server-to-server calls) continue to work. CORS is not authentication; the end-user identity gate remains required.
- The read-only Vercel environment inventory did not show `LINC_ALLOWED_ORIGINS` configured for Preview. No origin was guessed or inserted. A browser-based Client will require its approved exact origin to be configured before cross-origin requests can work; this remains pending confirmation of the actual Client domain.
- Local Sandbox verification on the Runtime change passed **37/37 tests**, including CORS preflight coverage, and `npm audit` reported 0 vulnerabilities. GitHub Actions run #107 passed for exact Runtime/test commit `70c9366`.

### Vercel deployment quota mitigation
- `vercel.json` now sets `git.deploymentEnabled["fix/linc-backend-clean-pr"] = false`. This prevents commits to the guarded review branch from automatically triggering new Vercel deployments while work remains test/docs-focused and the team build quota is constrained. See [Vercel Git Configuration](https://vercel.com/docs/project-configuration/git-configuration).
- This setting is branch-specific; `main` is not set to disabled, and Vercel's documented default for unspecified branches remains enabled. The unit test guards this boundary.
- This change does **not** disable GitHub Actions. The backend test workflow still runs on branch commits. A future Preview deployment can be created deliberately when a reviewed Runtime change is ready and deployment quota/access allow it; this auto-deploy pause itself is not proof of a new Preview deployment.
- The latest available guarded Preview remains READY at [deployment `dpl_BeksrwyriYpMTYTg7V2SBSTKL9QR`](https://vercel.com/linc8/linc-tech-ex-backend/BeksrwyriYpMTYTg7V2SBSTKL9QR), runtime SHA `2f2b5fd543f3ea0e5936b5883dac0b1edae1aba9`, URL [`linc-tech-ex-backend-6ie0reaqe-linc8.vercel.app`](https://linc-tech-ex-backend-6ie0reaqe-linc8.vercel.app). It contains the fail-closed identity guard, but predates the latest CORS allowlist Runtime change and is **not** evidence that the new CORS behavior is deployed or tested on Preview.
- Authorized GET health/readiness checks previously returned HTTP 200 for `/health`, `/api/health`, `/ready`, and `/api/ready`. This proves liveness and that the configured database probe responds only; it does not prove Preview/Production DB isolation or user-level CRUD.
- Direct POST attempts to register, heartbeat, and alert/delete were intercepted by Vercel Authentication (HTTP 401) before reaching the app. No application-level Preview POST result is claimed.

### Vercel environment metadata inventory — values not decrypted
- A read-only Vercel environment listing was performed with decryption disabled; no environment values were displayed or changed.
- The listing showed `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `LINC_API_KEY` targeted to **Preview**. This result did not show those keys targeted to Production. Treat Production database configuration as **not verified** from the current inventory rather than assuming it is configured.
- `LINC_ALLOWED_ORIGINS` was not present in the inventory. Until the approved web-client origin is confirmed and configured for Preview, browser CORS requests will remain denied by the new allowlist.
- A generic Preview `CRON_SECRET` and another branch-specific Preview `CRON_SECRET` were listed; the branch-specific entry targets `fix/vercel-readonly-filesystem`, not this guarded review branch. The cron handler remains a placeholder and is not configured in the current `vercel.json` routes.
- No secret values were requested, decrypted, printed, or edited. This metadata inventory does not prove which Supabase project the Preview URL points to, and it does not prove database separation from Production. Do not run live CRUD until the intended Preview project is independently confirmed.

### Client identity and release decision
- The connected GitHub integration exposes only `jaiioffice-svg/linc-tech-ex-backend`; Vercel team `linc8` lists only that backend project. The Library archive `Linc_Updated_Source_for_Online_Testing.zip` dated 2026-10-21 remains an unconfirmed client snapshot, not proof of the approved/deployed Client.
- The shared `LINC_API_KEY` is service-to-service authentication, not end-user identity, and must not be embedded in a web/mobile client. The approved client/session contract and whether requests pass through a trusted server-side/BFF layer remain unconfirmed.
- No live registration/read-back, Supabase CRUD, migrations, LINE delivery, Production requests/settings, secret inspection, merge, or Production promotion were performed. Preview database isolation from Production remains unconfirmed.

## Release decision

Keep PR #2 in Draft/unmerged state and Issue #22 open. Before release, confirm the approved Client and request/auth contract, implement server-side credential verification with expiry/revocation and principal-derived owner isolation, verify guardian pairing, obtain authorized Preview POST testing, and confirm Preview database isolation before any synthetic CRUD. Passing unit/CI/health checks is not proof that real user authentication or data isolation is complete.
