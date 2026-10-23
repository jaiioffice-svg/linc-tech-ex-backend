# ADR-001: L!nc identity, ownership, and guardian-link contract

- Status: Proposed; implementation is blocked until the contract is reviewed against the actual client and backend entry points.
- Date: 2026-10-24
- Scope: Preview-only design for aligning the existing L!nc client with `linc-tech-ex-backend`.
- Non-goals: No Production deployment, no live database migration, no change to the current Production URL.

## Context

The reviewed client archive and the standalone backend currently expose different API contracts. The client calls routes such as `/api/user/setup`, `/api/line/qr/create`, and `/api/guardian/confirm`; the backend currently documents service routes such as `/api/v1/heartbeat` and `/api/alert/delete`. A service API key is not an end-user identity and must never be accepted as proof that a person owns a user record.

The client archive also contains placeholder guardian details and an `encryptedFullName` value that is obfuscation rather than cryptographic encryption. The guardian confirmation handler appears to accept a client-supplied LINE user ID without independently validating it with LINE. These must be treated as unresolved security issues, not as verified identity or encryption.

## Decision proposal

For the device-first MVP, use **server-issued opaque user sessions** as the application identity contract, because the reviewed client already expects a session token and a forced account-provider login would be a larger product/onboarding change.

1. The server generates a cryptographically random session token only after an explicit account-creation or recovery flow.
2. Persist only a cryptographic hash of the token in the database; return the raw token once to the client.
3. Store expiry, revocation state, creation time, and a server-owned user ID for every session.
4. Every user-scoped endpoint derives the owner from the validated session. If a route includes a user ID, compare it to the session owner and reject mismatches with 403. Never trust a user ID supplied by the client alone.
5. Keep `LINC_API_KEY` restricted to server-to-server jobs. It must not authenticate mobile/web users.
6. Do not mark a guardian as linked until a short-lived, single-use pairing challenge has been completed and the guardian identity is verified by a trusted LINE platform callback/API flow. A client-submitted LINE ID alone is not proof.
7. Remove placeholder phone numbers and LINE IDs. An unpaired guardian is represented explicitly as unpaired; no fabricated values.
8. Do not label a value encrypted unless real authenticated encryption is implemented with managed keys and a documented rotation plan. Otherwise store only what is necessary and use clear field names.
9. Keep durable user, session, guardian-link, and alert state in the database. Do not rely on a local JSON file for production persistence or cross-instance coordination.

This decision is a proposal for the existing device-first experience; it does not preclude adding Supabase Auth later if account recovery, multi-device access, or identity assurance requirements change.

## Minimum API contract to agree before implementation

| Operation | Required behavior |
|---|---|
| `POST /api/user/setup` | Create a user and server-issued session, or authenticate an existing session; never let an unauthenticated caller claim an existing user ID. |
| `GET /api/user/:userId` | Require a valid session and owner match. |
| `POST /api/line/qr/create` | Require the cared-for user's session; create a random, expiring, single-use pairing challenge. |
| `GET /api/line/qr/status/:sessionId` | Require owner binding; do not leak pairing status to other users. |
| `POST /api/guardian/confirm` | Accept only a server-verified provider result bound to the pairing challenge; reject client-asserted provider identity. |
| `POST /api/v1/heartbeat` | Authenticate the originating device/session or a narrowly scoped service credential; validate owner binding and replay/rate limits. |
| `POST /api/alert/delete` | Require authenticated owner or explicitly authorized service role; prevent cross-user deletion. |

Route names above are a compatibility target to validate against actual client call sites, not a claim that every route is currently implemented in the standalone backend.

## Required security tests

- No token, malformed token, expired token, and revoked token are rejected.
- A user A session cannot read, modify, pair, or delete user B data (IDOR/cross-account tests).
- A service API key cannot access user-facing endpoints as a user.
- A client-chosen ID cannot take over an existing account.
- Pairing challenges expire, are single-use, and are bound to the initiating user.
- A forged client-supplied LINE ID cannot establish a guardian link.
- Duplicate/replayed heartbeats do not bypass authorization or create unbounded records.
- Database errors fail closed; secrets and tokens never appear in logs or responses.
- Tests use disposable Preview resources and synthetic accounts only.

## Rollout gates

1. Verify the actual deployed client source/version and enumerate all API calls.
2. Implement the contract in an isolated branch and add tests before changing storage.
3. Provision an isolated Preview database/schema; inspect actual column types and constraints before any migration.
4. Run unit/integration tests and a controlled Preview cross-account test.
5. Verify frontend-to-backend route compatibility and alert behavior in Preview.
6. Obtain explicit approval before any Production migration, merge, or deployment.

## Known limitations

This ADR does not implement authentication, prove LINE identity, encrypt personal data, or certify the current deployment. It is a design record to prevent incompatible APIs and false security assurances while implementation is prepared.
