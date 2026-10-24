# L!nc identity and ownership release gate

Status: BLOCKED — documentation only; no authentication behavior is changed by this file.

## Current verified boundary

The backend's `validateApiKey` middleware validates the shared `LINC_API_KEY` header. That is service/integration authentication; it does not establish which end user is making a request. The current user-facing mutation routes must not be treated as safe for release until end-user identity and ownership are enforced server-side.

Routes requiring review:
- `POST /api/v1/users/register`
- `POST /api/v1/heartbeat`
- `POST /api/alert/delete`

## Existing client-session evidence — not yet approved as deployed source

The separate documentation review `docs/CLIENT-SESSION-CONTRACT-REVIEW-20261024.md` on branch `review/client-session-contract-20261024` examined the Library artifact `Linc_Updated_Source_for_Online_Testing.zip`. That review explicitly says the archive has **not** been confirmed as the approved client release or the deployed Vercel source.

For that archive only, the review found:
- Client reads `linc_session_token` from browser `localStorage` and sends it as `Authorization: Bearer <token>`.
- Server creates a random opaque token, stores its SHA-256 hash in a JSON-file `db.sessions` store, and gives it a 30-day expiry.
- The archive's `getSessionUserId` validates the stored hash and expiry; `requireOwner` compares the resolved session user against the requested profile ID.
- The separate GitHub backend in this repository does not implement that same session contract. Its current protected routes use a shared `x-linc-api-key` and request-body `userId`.

Therefore, do **not** simply pass the archive's bearer token to this backend, treat a client-supplied `userId` as authenticated, or assume the archive's JSON session database is shared/durable on Vercel. First confirm the actual approved and deployed client source/version and decide the authoritative identity contract.

## Required release gates

1. Confirm the exact approved client source and deployed client commit/version.
2. Choose one authoritative identity/session system based on the confirmed client contract; document issuer, audience, verification method, expiry, refresh/revocation behavior, and credential transport.
3. Verify the user credential server-side. Derive the principal from verified credentials, never from a body-supplied `userId`.
4. Enforce owner isolation for every read/write/delete path, including cross-account and identifier-tampering cases.
5. Make guardian pairing depend on a verified provider flow and explicit consent. Do not trust submitted guardian identifiers or placeholder values as proof of pairing.
6. Add negative tests for missing, malformed, expired, revoked, and invalid credentials; cross-account access; unauthorized deletes; profile claiming; and guardian-link spoofing.
7. Use durable session storage shared across serverless instances if opaque sessions are retained; store only token hashes and support server-side revocation.
8. Run tests against an isolated Preview database with test-only records and verified cleanup. Mocked REST responses do not prove real provider authentication or database CRUD.
9. Re-review the deployed Preview and logs, then obtain explicit security review before release.

## Explicitly prohibited until authorized

- Do not merge or promote this candidate to Production while the identity/ownership blocker remains open.
- Do not change Production environment variables, decrypt or expose secrets, run migrations, or write to the live database as part of this gate.
- Do not select or add an identity provider speculatively.
- Do not interpret a passing health check, readiness check, mocked test, or successful build as proof that end-user authorization is secure.

## Evidence currently available

- Candidate commit `8780b5340490c52df9be64147b3b23c90a926410`: CI run `40055581165` completed successfully.
- Isolated Vercel sandbox at that commit: `npm ci` passed, `npm test` passed (25/25), and `npm audit --omit=dev` reported 0 vulnerabilities.
- GitHub Actions for this documentation update, commit `69876f66ca2714f0cb4a99cfffb3ed40606bbf36`, completed successfully in run `40056486179`.
- Database-adapter tests use mocked Supabase REST responses. Real Supabase CRUD and end-user authentication/owner-isolation tests have not been verified by those results.
- The candidate remains a draft/unmerged change; this document does not authorize deployment.
