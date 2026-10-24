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

## Evidence currently available

- Candidate commit before interim guard: `d476e4546a15bf448e00a4d4946f9371ee809d5b`; GitHub Actions reported 28/28 tests passing.
- Latest-commit Preview deployment before the guard: https://linc-tech-ex-backend-3jpyist9s-linc8.vercel.app
- In an isolated Vercel Sandbox at the candidate commit, `npm ci` passed (85 packages), `npm test` passed (28/28), and health endpoints responded HTTP 200.
- Preview `/ready` returned HTTP 200 on that pre-guard candidate, demonstrating database connectivity only. The Preview database has not yet been proven isolated from Production, so no live CRUD was run.
- The changes described above are a security mitigation in the draft branch. They must be re-tested and Preview-deployed before their behavior is considered verified.
