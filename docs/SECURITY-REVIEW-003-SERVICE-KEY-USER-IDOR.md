# Security Review 003: Shared Service Key Does Not Establish User Ownership

- Status: Confirmed from current backend source; remediation blocked on selecting and implementing an end-user authentication contract.
- Date: 2026-10-24
- Scope: `server.js`, `auth.js`, and `controllers.js` on `docs/identity-security-contract`.
- Environment: Static source review. No Production data was read or changed.

## Finding

**Severity: High architectural blocker; exploitability depends on protection of the shared key.**

The routes `POST /api/v1/heartbeat` and `POST /api/v1/alert/delete` use `validateApiKey`. That middleware validates a shared `x-linc-api-key`, but it does not establish which end user/device is making the request. Both controllers then accept `userId` from the request body.

For heartbeat, a caller possessing the shared key can select the profile whose heartbeat/status is updated. For immediate-delete, the same caller can select the profile whose status is changed to `app_deleted`, which can trigger a guardian alert. The current implementation does not bind the supplied identifier to a verified user principal.

This is not evidence that the key is publicly exposed. It is a least-privilege and identity-boundary flaw: compromise or unintended reuse of a shared key grants broader authority than a per-user credential should.

## Required remediation

1. Keep `LINC_API_KEY` exclusively for trusted server-to-server callers. Never embed it in a browser or mobile application.
2. Decide the end-user identity model before implementing user-scoped authorization: validate the existing identity provider token if the actual client uses one, or approve a device-first opaque-session model with documented expiry, revocation, and recovery.
3. For user-originated calls, derive the profile ID from the verified principal/session on the server. If a route contains a user ID, require it to match that principal; otherwise reject the request.
4. If a trusted backend job must act on behalf of a user, use a narrowly scoped service authorization contract and validate the permitted operation and target. Do not treat a general shared API key as unrestricted authority.
5. Until this is resolved, do not represent these routes as providing per-user authorization. Restrict their callers to trusted server-side infrastructure and protect the key as a high-impact secret.

## Required tests before release

- Missing and invalid end-user credentials are rejected even when a request includes a known user ID.
- A valid session for user A cannot update user B's heartbeat or status.
- A valid session for user A cannot trigger a delete/termination alert for user B.
- A service credential cannot be used as an end-user session.
- A narrowly authorized service job can only perform its explicitly allowed operations.
- Tests use synthetic users and a dedicated Preview database; no Production mutations.

## Acceptance criteria

This finding is closed only when the identity contract is approved, server-side authorization derives or verifies the owner for each user-scoped operation, cross-user denial tests pass in CI, and Preview integration tests confirm the deployed code matches the tested commit. Health/readiness responses and a valid shared API key alone do not satisfy these criteria.

## Related documents

- `docs/ADR-001-IDENTITY-SECURITY-CONTRACT.md`
- `docs/SECURITY-REVIEW-001-OWNER-ISOLATION.md`
- `docs/SECURITY-REVIEW-002-CLIENT-SESSION-GUARDIAN-PAIRING.md`
- `docs/CLIENT-BACKEND-ROUTE-COMPATIBILITY.md`
