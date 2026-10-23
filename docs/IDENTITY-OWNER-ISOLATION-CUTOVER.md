# L!nc Identity and Owner-Isolation Cutover Plan

- Status: implementation plan; not runtime code
- Date: 2026-10-24
- Base evidence: backend source on `docs/identity-security-contract` and the available client snapshot reviewed in the project files
- Safety: no Production data, credentials, or live LINE recipients were accessed or changed

## Decision

Do not add a new authentication provider or ship user-scoped profile routes until the client/server identity contract is confirmed. The available client snapshot and this backend do not currently share a proven authentication contract.

The client snapshot stores `linc_current_user_id` in local storage and restores the profile with `GET /api/user/{id}`. A local-storage identifier is a lookup key, not proof of identity. The backend in this repository currently protects heartbeat and app-termination operations with the shared `LINC_API_KEY` and accepts `userId` from the request body. These are different contracts and neither establishes per-user ownership for the combined system.

## Confirmed observations

1. Backend `POST /api/v1/heartbeat` and `POST /api/v1/alert/delete` use `validateApiKey`; their controllers select the target record using the body `userId`.
2. `LINC_API_KEY` is a server-to-server credential and must never be included in a browser or mobile bundle.
3. The available client snapshot stores `linc_current_user_id` in local storage and calls `GET /api/user/{id}`. The reviewed snapshot also contains opaque-session logic in a separate server implementation, but it has not been established that this implementation is the deployed client/server pair for the current Vercel project.
4. The current backend schema uses a L!nc `user_id` field. Its relationship to any external identity-provider subject has not been proven.
5. No identity provider is approved by this document. Supabase Auth is a candidate only if confirmed in the actual deployed client and project configuration.

## Required discovery before coding

- Identify the actual client repository, branch, commit, and deployment URL paired with the current backend deployment.
- Inventory every client call to `/api/user`, `/api/v1/heartbeat`, `/api/v1/alert/delete`, guardian-linking routes, and session creation/revocation routes.
- Determine whether sign-in is provided by Supabase Auth, another provider, or a custom opaque-session system. Verify from code and Preview behavior; do not infer from environment variables alone.
- Establish whether legacy `linc_users.user_id` values are provider subject IDs, generated L!nc IDs, or another identifier. Check schema and representative non-sensitive metadata before migration.
- Confirm whether existing users need account recovery or multi-device support before selecting a session strategy.

## Target security contract

1. Authentication middleware verifies a provider-issued token or a server-issued opaque session. Missing or invalid credentials fail closed.
2. The server derives the authenticated principal from the verified credential. It does not accept the caller's local-storage ID as identity.
3. A unique server-side mapping resolves the principal to exactly one L!nc profile.
4. User-facing operations use the resolved profile ID from the authenticated principal. If a legacy route accepts a target ID, the handler must prove it belongs to that principal.
5. The shared `LINC_API_KEY` remains server-only and is restricted to explicit service-to-service operations. It is not accepted as a user session.
6. Guardian linkage is a separate, consent-backed workflow. A client-supplied LINE ID alone does not prove control of that LINE account.
7. Privileged profile fields such as guardian linkage, account status, plan/payment state, and server-generated timestamps are not writable through a general profile-update payload.
8. Session tokens, service keys, LINE tokens, and authorization headers are never logged.

## Safe implementation sequence

### Phase A — contract inventory
- Produce a route matrix with caller, authentication credential, request schema, response schema, and owner check for every user-related endpoint.
- Mark endpoints as client-facing, trusted-service-only, or disabled.
- Record the identity mapping and migration/rollback strategy before changing code.

### Phase B — authentication and owner enforcement
- Implement one verifier for the confirmed identity/session provider.
- Add an authenticated principal to request context.
- Add an explicit profile resolver and fail closed when mapping is missing or ambiguous.
- Add new self-scoped routes such as `GET /api/v1/me` and `POST /api/v1/me/heartbeat` only after the client contract is confirmed.
- Keep legacy routes temporarily service-only; do not silently change their semantics.

### Phase C — regression and abuse tests
- No credential, malformed credential, expired/revoked credential, and wrong issuer are rejected.
- User A cannot read, heartbeat, update, or signal termination for User B.
- A shared service key cannot be used as an end-user session.
- Client-supplied IDs cannot override the verified principal.
- Profile update allowlists reject privilege, guardian, payment, and status fields.
- Guardian pairing fails until the intended LINE identity is verified and consent is recorded.
- Tests use synthetic identities and stubbed provider calls; no real LINE message is sent.

### Phase D — Preview integration
- Deploy only to a dedicated Preview environment.
- Use a dedicated test record and confirm create/read/update plus owner-isolation behavior against the intended Supabase project.
- Clean up only the dedicated test record created by the test.
- Confirm deployment commit SHA matches the CI-tested SHA.
- Keep LINE delivery disabled until recipient ownership and consent are proven.

### Phase E — controlled release
- Migrate client callers to the new contract.
- Monitor rejection rates and auth failures in Preview before considering Production.
- Merge/promote only after CI, Preview integration, migration rollback, and account recovery checks pass.

## Release blockers

Do not call the system production-ready while any of these remain unresolved:
- no confirmed end-user identity contract;
- user ID accepted as authority rather than only as a lookup identifier;
- uncertain mapping between provider identity and `linc_users.user_id`;
- unverified guardian pairing or placeholder guardian identifiers;
- payment/account activation routes without provider-side transaction verification;
- Preview database persistence or owner-isolation tests not proven against the intended deployment.

## Acceptance evidence to attach before closing this plan

- client repository + commit and backend deployment commit
- route/caller matrix
- identity-provider/session verification tests
- cross-user denial test results
- Preview integration test results and cleanup confirmation
- migration/rollback plan
- confirmation that no client bundle contains `LINC_API_KEY` or Supabase service-role credentials

This plan documents the safe path forward; it does not claim that authentication, the proposed `/api/v1/me` routes, or owner isolation have already been implemented.
