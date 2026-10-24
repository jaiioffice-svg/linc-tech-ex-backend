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
- The inspected archive's `src/services/api.ts` uses relative URLs such as `/api/user/setup` and `/api/heartbeat/ping`; it does not define a separate base URL for this GitHub backend. Its `.env.example` has `APP_URL="MY_APP_URL"`, a placeholder, not a verified deployed client domain.
- A scan of the inspected archive's TypeScript/TSX/JavaScript/JSX files found **zero** `/api/v1/` references and **18** `apiFetch` call sites for relative `/api/...` routes. The inspected archive therefore does not demonstrate integration with this backend's `/api/v1/users/register`, `/api/v1/heartbeat`, or `/api/v1/alert/delete` contract.
- Server creates a random opaque token, stores its SHA-256 hash in a JSON-file `db.sessions` store, and gives it a 30-day expiry.
- The archive's `getSessionUserId` validates the stored hash and expiry; `requireOwner` compares the resolved session user against the requested profile ID.
- The separate GitHub backend in this repository does not implement that same session contract. Its original protected routes used a shared `x-linc-api-key` and request-body `userId`.

Therefore, do **not** simply pass the archive's bearer token to this backend, assume the archive is the approved client, assume its JSON session database is shared/durable on Vercel, or use its placeholder `APP_URL` to configure CORS. The archive's relative API calls imply same-origin behavior for that archive only; they do not show that it is integrated with this separate backend.

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

### Candidate local HTTP smoke — read-only / fail-closed checks
- On exact checked-out candidate HEAD `b516a6a13c3ac8ddc846a8033e3234e02d3cc763` in an isolated Vercel Sandbox, I started `server.js` with `VERCEL=1`, explicitly removed both Supabase environment variables for this test, and used a throwaway test API key value (not a Vercel secret).
- `GET /health`: **HTTP 200**, `{"status":"operational"}`.
- `GET /ready`: **HTTP 503**, `{"status":"not_ready","reason":"database_not_configured"}` — expected because the test deliberately omitted Supabase configuration.
- `POST /api/v1/heartbeat` with the throwaway service key and a request-body `userId`, but without any verified server-side principal: **HTTP 503**, `End-user identity verification is not configured`. No profile write occurred.
- Verified no `linc_data.json` was created and the Git worktree remained clean. This checks application startup and intended fail-closed behavior only; it does **not** prove live Supabase connectivity, user authentication integration, Preview deployment behavior, or Production health.

### CORS allowlist hardening — latest Runtime change
- `server.js` now reads `LINC_ALLOWED_ORIGINS` as a comma-separated list of exact `scheme://host[:port]` origins. Requests with an `Origin` header receive CORS permission only for an exact, valid allowlist match; wildcard origins, URL paths, and non-HTTP(S) values are not accepted.
- If `LINC_ALLOWED_ORIGINS` is absent or empty, browser origins receive no CORS grant. Requests without an `Origin` header (such as server-to-server calls) continue to work. CORS is not authentication; the end-user identity gate remains required.
- The read-only Vercel environment inventory did not show `LINC_ALLOWED_ORIGINS` configured for Preview. No origin was guessed or inserted. A browser Client that calls this separate backend cross-origin will need its approved exact origin configured first. The inspected, unconfirmed client archive uses relative same-origin API paths and a placeholder `APP_URL`; it cannot establish this backend's required CORS origin or even prove it calls this backend.
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
- `LINC_ALLOWED_ORIGINS` was not present in the inventory. Until the approved architecture and origin are confirmed and configured for Preview, cross-origin browser requests to this separate backend remain denied by the new allowlist. The inspected unconfirmed archive uses relative same-origin API paths, so it does not supply the value needed here.
- A generic Preview `CRON_SECRET` and another branch-specific Preview `CRON_SECRET` were listed; the branch-specific entry targets `fix/vercel-readonly-filesystem`, not this guarded review branch. The cron handler remains a placeholder and is not configured in the current `vercel.json` routes.
- No secret values were requested, decrypted, printed, or edited. This metadata inventory does not prove which Supabase project the Preview URL points to, and it does not prove database separation from Production. Do not run live CRUD until the intended Preview project is independently confirmed.

### Expanded Client archive security and build verification — 2026-10-24
The documentation-only review update is on [PR #19](https://github.com/jaiioffice-svg/linc-tech-ex-backend/pull/19), latest Client-review commit [`6bb09d8dffc1642d49bb9d7e411d68ec7653c756`](https://github.com/jaiioffice-svg/linc-tech-ex-backend/commit/6bb09d8dffc1642d49bb9d7e411d68ec7653c756). This is source review of a Library archive, not the confirmed deployed client.

- The archive's static `scripts/security-audit.mjs` passes, and TypeScript/TSX syntax transpilation reports **21 files, 0 syntax diagnostics**. These checks do not establish correct runtime behavior or full type safety.
- Dependency/build verification is still blocked in the isolated local runner: `npm install --no-audit --no-fund` timed out at 180 seconds; the dependency diagnostic reports `registry.npmjs.org` DNS `EAI_AGAIN`, empty npm cache and missing `node_modules`. `npm run lint` fails with missing `vite/client` types (`TS2688`), and `npm run build` cannot run because `vite` is not installed. No real Client API smoke test was run.
- The source shows a **guardian verification trust gap**: profile setup can record placeholder guardian IDs and unconditionally set `guardianLinePairedAt`; the guardian confirmation endpoint records the client-submitted `lineUserId` and marks it verified without a LINE webhook signature/Channel Secret check in the inspected source. Treat pairing claims from this archive as unverified until a real provider-authenticated pairing flow is implemented and tested.
- The archive's declared `@google/genai` dependency had no matching import/use found in the inspected source files. Do not remove it or regenerate lockfiles speculatively while registry access is unavailable; review dependency cleanup after the exact approved source is known.

### Client identity and release decision
- The connected GitHub integration exposes only `jaiioffice-svg/linc-tech-ex-backend`; Vercel team `linc8` lists only that backend project. The Library archive `Linc_Updated_Source_for_Online_Testing.zip` dated 2026-10-21 remains an unconfirmed client snapshot, not proof of the approved/deployed Client.
- The shared `LINC_API_KEY` is service-to-service authentication, not end-user identity, and must not be embedded in a web/mobile client. The approved client/session contract and whether requests pass through a trusted server-side/BFF layer remain unconfirmed.
- No live registration/read-back, Supabase CRUD, migrations, LINE delivery, Production writes/configuration changes, secret inspection, merge, or Production promotion were performed. Only read-only GET requests to Production `/health` and `/ready` were sent for availability diagnostics. Preview database isolation from Production remains unconfirmed.

## Production startup incident — rechecked 2026-10-24 06:24 UTC

**Current production is not healthy.** Read-only GET requests to the production alias returned:
- `/health`: HTTP 500, `FUNCTION_INVOCATION_FAILED`, Vercel request ID `sin1::9cd9s-1792823080229-09309f64f76a`.
- `/ready`: HTTP 500, `FUNCTION_INVOCATION_FAILED`, Vercel request ID `sin1::6fv4d-1792823081490-605771d49d70`.

- A second read-only recheck at **2026-10-24 07:07 UTC (14:07 Thailand time)** still returned HTTP 500 `FUNCTION_INVOCATION_FAILED`: `/health` request ID `sin1::5mmlc-1792825657302-286793520f49`; `/ready` request ID `sin1::5hmln-1792825658547-71b9b802b222`.

The affected Production deployment reports READY at the build/deployment level, but targets `main` commit [`336e2fcdd1b9f0841432817dcafe955b45700eef`](https://github.com/jaiioffice-svg/linc-tech-ex-backend/commit/336e2fcdd1b9f0841432817dcafe955b45700eef). A READY deployment is not proof that the function runs correctly.

### Root cause evidence
- In this exact `main` commit, `server.js` imports `checker.js`, which imports `db.js`.
- `db.js` performs a top-level `fs.writeFileSync(..., 'linc_data.json')` when the file is missing. The file is not present in the repository's `main` source.
- This write occurs during module initialization, before Express can answer `/health`. On a read-only serverless deployment filesystem, an `EROFS`/permission exception at this write propagates and prevents startup.
- I extracted the exact `main` `db.js` source into an isolated scratch directory and fault-injected an `EROFS` failure for that initialization write. Importing the module propagated the exception, confirming that the startup path has no catch for the initial database-file creation. This is a controlled reproduction of the code path, not a claim that I accessed the production filesystem.
- The same `main` source also has a hard-coded fallback for the shared API key and does not verify end-user identity. Simply removing the startup error would not make this version production-safe; it would still depend on local file writes for data persistence and retain the auth gap.

### Containment decision
Do **not** make a one-line Production edit, promote the current candidate automatically, or roll back blindly. The reviewed candidate branch is structured to use Supabase instead of creating a local database file on Vercel and fails closed for user-scoped routes until a trusted identity verifier is integrated. However, that candidate has not been promoted, its newest CORS Runtime change is not deployed, and the approved Client/session contract plus Preview/Production database separation remain unconfirmed. Fixing availability must be coordinated with those release gates rather than re-enabling unsafe endpoints.

No Production code, alias, environment variable, secret, database row, migration, or notification setting was changed during this recheck.

## Current Preview access boundary — rechecked 2026-10-24 07:10 UTC
- Read-only requests to the latest available guarded Preview URL (`linc-tech-ex-backend-6ie0reaqe-linc8.vercel.app`) for both `/health` and `/ready` received HTTP **302** redirects to Vercel SSO before reaching Express.
- These responses establish only that Vercel deployment protection is active; they are **not** application health/readiness results. No HTTP 200/503 application outcome is claimed from this recheck.
- I did not create a shareable/bypass URL, change SSO protection, or send POST requests. Use an authorized Vercel CLI/MCP path or an explicitly authorized test window to perform the next Preview app-level checks without broadening access to the deployment.

## Recommended next path — one candidate, staged verification

Decision as of 2026-10-24: continue with Draft PR #2 (`fix/linc-backend-clean-pr`) as the single Backend release candidate; do not start another overlapping Runtime branch. PR #3 documents the earlier serverless-persistence change, but its route contract does not include the fail-closed verified-end-user gate now present in PR #2.

### Stage 1 — keep Production stable and capture evidence
- Production `/health` and `/ready` both currently return HTTP 500 `FUNCTION_INVOCATION_FAILED`. This is a confirmed availability incident.
- Do not merge or change Production just to make `/health` return 200. The main branch also has an end-user authorization gap and local-file persistence, so a startup-only patch would leave a broken release.
- Continue to keep PR #2 Draft/unmerged. Its current fail-closed identity gate deliberately returns 503 on user-scoped routes until a trusted identity verifier is implemented.

### Stage 2 — establish a trustworthy database target
- The read-only Vercel environment inventory showed `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` targeted to Preview only; neither was listed for Production. No environment values were decrypted.
- Historical Preview logs also need remediation: deployment `dpl_AuKcWvqteMomhGvGGmno4BVdDMi5` on this candidate branch recorded Supabase permission failures (HTTP 401 / Postgres `42501`). A separate older Preview diagnostic deployment `dpl_26QDmjCdgaoqpQZENafGP7JY6PpE` logged a configured API token classified as JWT role `anon`. Do not infer that the latest Preview has a valid service-role credential from the variable name alone.
- Confirm the intended Supabase project independently and prove it is a non-Production Preview project. Then verify its `public.linc_users` schema, role/grants, RLS and service-key role using the read-only preflight described by [PR #21](https://github.com/jaiioffice-svg/linc-tech-ex-backend/pull/21). Run it only after the target project URL is confirmed; stop if the expected table/schema is missing.
- Only after the project is identified, correct the Preview-only Vercel variables through an authorized configuration change. Do not copy Production credentials into Preview, decrypt secrets for this review, or add new database grants speculatively.

### Stage 3 — settle the Client/session contract
- The inspected Library archive is unconfirmed as the approved/deployed Client. It uses relative `/api/...` paths, zero `/api/v1/` references, and its guardian pairing flow does not prove LINE provider identity.
- Identify the actual deployed Client source/commit and whether it calls a same-origin BFF or a separate Backend. Select the single authoritative server-verified session contract only after that evidence exists.
- Implement the verifier that populates `req.auth.userId`; test expired/revoked credentials, account A attempting account B, profile claiming, deletion authorization, and verified guardian pairing. Never embed `LINC_API_KEY` in a browser/mobile bundle.

### Stage 4 — deliberate Preview release and acceptance
When the daily Vercel build quota/access allows, trigger one deliberate Preview deployment of the reviewed candidate; do not re-enable noisy auto-deploys for every documentation commit.
Acceptance must include:
1. `GET /health` returns 200 without trying to write local files.
2. `GET /ready` returns 200 against the confirmed isolated Preview Supabase project.
3. Missing/invalid end-user credentials are rejected; valid credentials resolve the server-side principal.
4. Synthetic test user A cannot read/write/delete user B; the same data persists across separate serverless instances.
5. Guardian pairing is marked verified only after provider-authenticated confirmation.
6. Any notification test is stubbed/sandboxed; no real guardian LINE message is sent.
7. Cleanup of synthetic Preview records is verified and logged.

### Stage 5 — Production release decision
Production release is a separate, explicitly authorized action after all preceding gates pass. It requires a reviewed data-migration/back-up plan, correctly scoped Production database configuration, a tested rollback path, monitored post-deploy health/readiness and authenticated end-user integration tests. Production must not be promoted merely because the deployment is marked READY or because unit tests pass.

### Immediate next engineering task
Continue in the existing PR #2 by reviewing and tightening the **testable integration boundary**, not by guessing an identity provider or changing Production. The concrete blockers are: (a) no approved Client/source contract, (b) no verified Preview Supabase target/service-role permission, and (c) no Production Supabase configuration shown in the metadata inventory. Record findings in the current release gate and only deploy once the relevant gate can be objectively tested.

## Release decision

Keep PR #2 in Draft/unmerged state and Issue #22 open. Before release, confirm the approved Client and request/auth contract, implement server-side credential verification with expiry/revocation and principal-derived owner isolation, verify guardian pairing, obtain authorized Preview POST testing, and confirm Preview database isolation before any synthetic CRUD. Passing unit/CI/health checks is not proof that real user authentication or data isolation is complete.
