# ADR-001: L!nc identity, ownership, and guardian-link contract

- Status: Proposed; implementation is blocked until the contract is reviewed against the actual client and backend entry points.
- Date: 2026-10-24
- Scope: Preview-only design for aligning the existing L!nc client with `linc-tech-ex-backend`.
- Non-goals: No Production deployment, no live database migration, no change to the current Production URL.

## Context

The reviewed client archive and the standalone backend currently expose different API contracts. The client calls routes such as `/api/user/setup`, `/api/line/qr/create`, and `/api/guardian/confirm`; the backend currently documents service routes such as `/api/v1/heartbeat` and `/api/alert/delete`. A service API key is not an end-user identity and must never be accepted as proof that a person owns a user record.

The client archive also contains placeholder guardian details and an `encryptedFullName` value that is obfuscation rather than cryptographic encryption. The guardian confirmation handler appears to accept a client-supplied LINE user ID without independently validating it with LINE. These must be treated as unresolved security issues, not as verified identity or encryption.

## Identity decision gate (must be resolved before implementation)

**No identity provider or session strategy is approved yet.** The reviewed archive contains a custom session-token pattern, but that alone does not prove it is the current deployed client flow or satisfy account recovery, multi-device access, and identity-assurance needs. The separate `docs/API_AUTH_CONTRACT.md` proposal correctly requires confirmation of the actual sign-in provider before implementation.

Evaluate these candidates against the real client and product requirements:

- **Existing provider authentication (for example, Supabase Auth if confirmed):** preferred when the deployed client already uses it or account recovery/multi-device identity is required. The backend must validate provider-issued access tokens and map the verified principal to a L!nc profile.
- **Custom opaque sessions:** acceptable only if product owners explicitly confirm a device-first, account-light MVP and define recovery, device replacement, expiry, revocation, and abuse controls. A session token is a bearer credential, not proof of a human identity by itself.

Before choosing, inspect the deployed client build and all sign-in/setup/recovery call sites, then document the chosen option and migration plan. Do not implement both systems in parallel or silently switch the identity model.

The security invariants below apply regardless of which candidate is selected:

1. Only a trusted server-side verifier may establish the caller principal.
2. Every user-scoped endpoint derives the owner from that verified principal/session. If a route includes a user ID, compare it to the verified owner and reject mismatches with 403. Never trust a user ID supplied by the client alone.
3. Keep `LINC_API_KEY` restricted to server-to-server jobs. It must not authenticate mobile/web users.
4. Do not mark a guardian as linked until a short-lived, single-use pairing challenge has been completed and the guardian identity is verified by a trusted LINE platform callback/API flow. A client-submitted LINE ID alone is not proof.
5. Remove placeholder phone numbers and LINE IDs. An unpaired guardian is represented explicitly as unpaired; no fabricated values.
6. Do not label a value encrypted unless real authenticated encryption is implemented with managed keys and a documented rotation plan. Otherwise store only what is necessary and use clear field names.
7. Keep durable user, session, guardian-link, and alert state in the database. Do not rely on a local JSON file for production persistence or cross-instance coordination.


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
