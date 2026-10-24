# L!nc identity and ownership release gate

Status: BLOCKED — documentation only; no authentication behavior is changed by this file.

## Current verified boundary

The backend's `validateApiKey` middleware validates the shared `LINC_API_KEY` header. That is service/integration authentication; it does not establish which end user is making a request. The current user-facing mutation routes must not be treated as safe for release until end-user identity and ownership are enforced server-side.

Routes requiring review:
- `POST /api/v1/users/register`
- `POST /api/v1/heartbeat`
- `POST /api/alert/delete`

## Required release gates

1. Identify and verify the actual client application source and the deployed client commit/version. Do not infer the session provider from framework or environment variables.
2. Document the existing client session/token contract: issuer, audience, signature/verification method, expiry, refresh behavior, and how the client sends the credential. Do not place a shared server secret in browser/mobile code.
3. Verify the user credential on the server using the confirmed issuer's supported mechanism. Derive the authenticated user identity from the verified credential; do not trust a body-supplied `userId` as proof of identity.
4. Enforce owner isolation for every read/write and delete path. A user must not be able to mutate another user's profile or alerts by changing identifiers in a request.
5. Define guardian pairing only from a verified pairing/consent flow. Do not accept an arbitrary guardian identifier from an untrusted request body as proof of a relationship.
6. Add negative tests for missing, malformed, expired, wrong-audience, and invalid credentials; cross-account access; unauthorized deletes; and guardian-link spoofing.
7. Run tests against an isolated Preview database with test-only records and verified rollback/cleanup. Unit tests with mocked HTTP responses are not evidence of real provider authentication or database CRUD.
8. Verify session behavior across separate serverless invocations/instances and confirm no reliance on local filesystem persistence.
9. Re-review the deployed Preview and logs, then obtain an explicit security review before considering release.

## Explicitly prohibited until authorized

- Do not merge or promote this candidate to Production while the identity/ownership blocker remains open.
- Do not change Production environment variables, decrypt or expose secrets, run migrations, or write to the live database as part of this gate.
- Do not select or add an identity provider speculatively. The client contract must be confirmed first.
- Do not interpret a passing health check, readiness check, mocked test, or successful build as proof that end-user authorization is secure.

## Evidence currently available

- Candidate commit `8780b5340490c52df9be64147b3b23c90a926410`: CI run `40055581165` completed successfully.
- In the isolated Vercel sandbox at that commit: `npm ci` passed, `npm test` passed (25/25), and `npm audit --omit=dev` reported 0 vulnerabilities.
- The database-adapter tests use mocked Supabase REST responses. Real Supabase CRUD and end-user authentication/owner-isolation tests have not been verified by those results.
- The candidate remains a draft/unmerged change; this document does not authorize deployment.
