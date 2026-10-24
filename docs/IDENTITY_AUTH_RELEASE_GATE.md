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

- Latest runtime/test candidate: `eedaa6c67c4911c44c6a13bed860020cd27a724a`. The later commits `27780e3064930c031d3823b30257ee708bc1eef7` and `2f2b5fd543f3ea0e5936b5883dac0b1edae1aba9` changed this release-gate documentation only; a GitHub compare confirms no runtime files changed after `eedaa6c`.
- GitHub Actions Backend checks [run #81](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40066202748) succeeded for `eedaa6c`; run [#83](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40066545533) succeeded after the prior docs-only refresh.
- In the isolated Vercel Sandbox at `eedaa6c`, a fresh `npm ci --no-audit --no-fund` had passed (85 packages), a fresh `npm test` rerun passed (**33/33 tests**), and `npm audit --omit=dev` reported **0 production dependency vulnerabilities**.
- Fresh local-process smoke on the exact `eedaa6c` checkout, with a test-only `LINC_API_KEY` and no Supabase credentials: `GET /health` returned HTTP 200; register, heartbeat, and alert/delete each returned HTTP 503 with `End-user identity verification is not configured`, even when JSON contained `auth: { userId: ... }`. The guard rejected those requests before any database access.
- Vercel reports a code-equivalent guarded Preview as READY at commit `2f2b5fd543f3ea0e5936b5883dac0b1edae1aba9` in [deployment `dpl_BeksrwyriYpMTYTg7V2SBSTKL9QR`](https://vercel.com/linc8/linc-tech-ex-backend/BeksrwyriYpMTYTg7V2SBSTKL9QR), URL [`linc-tech-ex-backend-6ie0reaqe-linc8.vercel.app`](https://linc-tech-ex-backend-6ie0reaqe-linc8.vercel.app). That deployed commit differs from runtime/test candidate `eedaa6c` only by documentation, so its runtime includes the guarded `server.js` routes. The branch has since advanced to docs-only commit `92f6dfb81637b392770c7b2191e5280bfac0926b`; Vercel's status for that newer docs commit is blocked by the build-rate-limit status, but no runtime files differ from the READY code-equivalent deployment.
- Authorized Vercel fetches to that READY deployment returned HTTP 200 for `GET /health`, `GET /api/health`, `GET /ready`, and `GET /api/ready`. `/ready` proves only that the configured database connectivity probe responds; it does not prove Preview database isolation from Production or successful user-level CRUD.
- Direct `curl` POST requests to the three user-scoped routes were intercepted by Vercel Authentication with HTTP 401 before reaching the app. Therefore no app-level Preview POST result is claimed. No SSO bypass link or real service API key was used.
- A guarded Preview with the same runtime code as the latest tested candidate is READY, even though the newest documentation-only commit does not have its own successful Vercel status due to build quota. The outstanding limitation is app-level POST verification through the protected Preview, not a missing code-equivalent deployment.
- No live registration/read-back, Supabase CRUD, migrations, LINE delivery, Production calls, Production environment changes, or merge/promotion were performed. Preview database isolation from Production remains unconfirmed.

## Release decision

The current branch head is deployed READY to Preview, health and database-readiness probes return HTTP 200, and the exact runtime candidate passed 33/33 automated tests plus the local fail-closed smoke. However, app-level POST verification against Preview is still blocked at the Vercel Authentication layer, the approved client/session contract and full server-side identity verifier remain unresolved, and database isolation is not confirmed. Keep PR #2 in Draft/unmerged state and Issue #22 open until those remaining identity, ownership, and safe-integration gates are satisfied.
