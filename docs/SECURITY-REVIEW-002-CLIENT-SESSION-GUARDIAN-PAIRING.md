# Client Archive Security Review 002: Session, Guardian Pairing, and Persistence

- Status: Static review of the supplied `linc_reviewed(2).zip` archive only; not verified against the currently deployed client.
- Date: 2026-10-24
- Scope: `linc_work_current/server.ts`, `src/App.tsx`, and `src/services/api.ts`.
- Change type: Documentation-only. No client source was modified, no secrets were read, and no Production resources were changed.

## Executive summary

The client archive contains some positive foundations: random opaque session tokens, SHA-256 token hashes stored server-side, a 30-day expiry, and an owner check on several user routes. However, this is not yet a production-safe identity/guardian flow. The highest-priority issues are missing owner binding on LINE pairing endpoints, accepting a client-supplied LINE identity as if it were verified, and fabricating guardian details while marking the guardian as paired.

This archive is a snapshot. These findings must be checked against the deployed build before treating them as live vulnerabilities.

## Findings

### C-01 — LINE QR create/status routes lack user ownership checks
**Severity: High, pending deployed-version verification**

**Evidence in archive:** `server.ts` defines `POST /api/line/qr/create` around line 346 and `GET /api/line/qr/status/:sessionId` around line 378. These handlers do not call `requireOwner`, while adjacent user-data handlers do.

**Risk:** An unauthenticated or unrelated caller may create pairing sessions or query a known session ID's pairing state. Depending on how session IDs and returned data are exposed, this can leak pairing metadata or enable pairing-flow abuse.

**Required fix:** Bind every pairing session to the authenticated user on creation. Require the same owner for status reads. Use cryptographically random opaque session IDs, short expiry, single use, and rate limits. Do not expose guardian identity or phone details in public status responses.

### C-02 — Guardian identity is asserted by client input
**Severity: High, pending deployed-version verification**

**Evidence in archive:** `POST /api/guardian/confirm` reads `lineUserId` and `displayName` from the request body, then records the resulting guardian record. The short-lived pairing token check is a useful start, but it does not itself prove that LINE issued or authenticated the supplied LINE user ID.

**Risk:** A valid pairing challenge can still be completed with an identity that the server has not independently verified, potentially linking alerts to the wrong recipient.

**Required fix:** Obtain the LINE identity only from a trusted server-verified LINE callback or API response, validate the provider signature/state, bind the result to the single-use pairing challenge, and reject replay. Treat display name and user IDs sent directly by the client as untrusted.

### C-03 — Placeholder guardian values are treated as a real pairing
**Severity: High**

**Evidence in archive:** The setup handler falls back to `089-999-8888` and `line_guardian_linc`, then sets `guardianLinePairedAt: Date.now()` in the user record.

**Risk:** The UI/database may represent an unpaired user as if a guardian were linked. Alerts may be routed incorrectly or appear configured when they are not.

**Required fix:** Remove fabricated contact defaults. Model pairing explicitly, e.g. `guardianStatus: "unpaired"` until provider-verified pairing completes. Only store the verified guardian reference and pairing timestamp after successful verification. Never send test/emergency alerts to placeholder identities.

### C-04 — Setup flow must prevent user-ID claiming and define recovery
**Severity: Medium, design gate**

**Evidence in archive:** `POST /api/user/setup` accepts an `id` from the request body and creates a session after setup. The code checks ownership when an existing user ID is found, which is a positive safeguard, but the initial identity and recovery model is not established by that check alone.

**Risk:** If client-chosen identifiers are predictable or reused across flows, setup and recovery semantics may be ambiguous. A device-local session is also not equivalent to a verified account identity.

**Required fix:** Generate new user IDs on the server. For existing profiles, require a verified recovery/authentication proof rather than an ID alone. Document device replacement, session revocation, account recovery, and multi-device behavior before choosing custom sessions or a provider.

### C-05 — JSON-file persistence is unsuitable for production serverless deployment
**Severity: High for multi-instance deployment**

**Evidence in archive:** The client server loads and writes a local JSON store (`data/linc_store.json`).

**Risk:** Serverless instances may not share durable writable local state. Sessions, users, pairing challenges, and alerts can disappear or diverge across instances and deployments.

**Required fix:** Persist durable state in the database with appropriate unique constraints and transactions. Ensure session creation/revocation and single-use pairing challenges are atomic. Do not use a local JSON file as the production source of truth.

### C-06 — `encryptedFullName` is not cryptographic encryption
**Severity: High for personal-data handling**

**Evidence in archive:** The value is described in code as obfuscation and includes a fake `[AES-256 GCM]` suffix rather than actual authenticated encryption.

**Risk:** The name may be recoverable and the field name may create a false security assurance.

**Required fix:** Prefer data minimization. If encryption at rest beyond database/provider controls is required, use a vetted authenticated-encryption library and managed key material, with key rotation and no keys in client code. Rename the field if it stores only obfuscated text.

### C-07 — Development/test endpoints need explicit production policy
**Severity: Medium, confirm intended deployment**

**Evidence in archive:** Routes include `/api/heartbeat/simulate-timeout`, `/api/filter/test`, `/api/alert/test-helper`, and notification test routes.

**Risk:** Test behavior could trigger state changes or alerts if exposed in a production deployment, even when a session check exists.

**Required fix:** Remove test-only routes from production builds or gate them behind a server-side feature flag and explicit administrative authorization. Ensure synthetic alerts cannot be mistaken for real emergencies and add audit logging.

## Positive controls observed

- Session tokens are generated from cryptographically random bytes.
- The archive stores SHA-256 hashes of session tokens rather than the raw tokens.
- Session expiry is checked.
- Several user-scoped routes call `requireOwner`.
- The frontend sends the bearer session token through `apiFetch` and clears stale credentials on a 401/403 during session restoration.

These controls reduce some risks but do not resolve the findings above.

## Acceptance tests before enabling real guardian alerts

1. No session, expired session, malformed token, and revoked session are rejected.
2. User A cannot create, inspect, confirm, or reuse User B's pairing session.
3. A client-supplied LINE ID without a verified LINE provider result is rejected.
4. A pairing challenge is owner-bound, short-lived, single-use, and replay-resistant.
5. Setup cannot claim an existing user by supplying an ID.
6. A user without a verified guardian remains explicitly unpaired; no placeholder phone/LINE ID is stored.
7. Session and pairing state persist correctly across separate server instances and deployments.
8. Test-only routes are unavailable or safely gated in production.
9. Personal data is not described as encrypted unless cryptographic encryption is actually implemented.
10. End-to-end tests use synthetic Preview users and a non-production LINE configuration.

## Recommended order of work

1. Confirm whether this archive matches the deployed client and current source repository.
2. Fix guardian pairing ownership and provider verification first.
3. Remove placeholder guardian values and correct paired/unpaired state.
4. Select one identity/recovery strategy and generate new user IDs server-side.
5. Replace JSON-file persistence with database-backed atomic session/pairing state.
6. Add cross-account security tests and run them in isolated Preview.
7. Keep Production deployment and live schema changes gated behind explicit approval.

This review is not a penetration test and does not claim the issues are present in the current deployed build. It records concrete findings from the supplied archive so they can be verified and fixed without guessing.
