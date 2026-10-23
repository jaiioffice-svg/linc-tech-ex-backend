# Security Review 001: Identity and Owner Isolation

- Status: Findings confirmed by static review; remediation not yet implemented.
- Date: 2026-10-24
- Scope: `server.js`, `controllers.js`, `auth.js`, and the reviewed client/backend contract.
- Safety boundary: This review is documentation only. No Production deployment, database migration, or secret change.

## Executive summary

The backend currently authenticates `POST /api/v1/heartbeat` and `POST /api/v1/alert/delete` with the shared `LINC_API_KEY`, while the request body selects the target `userId`. That is a service-to-service trust boundary, not per-user authorization. If this credential is exposed to an untrusted caller, or a public client is given the credential, that caller can attempt to update heartbeat/status for an arbitrary identifier and mark an existing profile as `app_deleted`, potentially triggering a guardian alert.

The current reviewed standalone backend does not expose the client's profile and guardian routes, so it is not yet safe to claim end-to-end integration. The identity strategy remains undecided pending verification of the actual deployed client sign-in/recovery flow.

## Findings

### F-01 — Shared service key does not isolate users (High, conditional on credential exposure)

**Evidence:** `server.js` attaches `validateApiKey` to both service routes. `controllers.js` reads `userId` from the request body and uses it to select a record. There is no user principal or per-user ownership check in these handlers.

**Impact:** A caller with the shared key can target a user ID it does not own. For the heartbeat route this can change heartbeat/status data. For the alert-delete route it can change the target profile status and invoke the alert callback.

**Required remediation:**
- Keep the shared key server-only; never ship it in a browser/mobile bundle.
- Decide whether each route is genuinely service-only or must be called by a user device.
- For service-only calls, use a narrowly scoped server identity and validate the requested target against trusted upstream authorization; consider per-service credentials, rate limits, replay protection, and audit events.
- For user-device calls, require a verified user session/access token and derive the target owner from the verified principal. Do not authorize by body `userId`.
- Add tests showing a caller without the required service identity is rejected before database access, and user A cannot affect user B.

### F-02 — Identity strategy documents were inconsistent (Architecture risk)

**Evidence:** `docs/API_AUTH_CONTRACT.md` requires confirmation of the existing provider, while an earlier version of ADR-001 leaned toward custom opaque sessions based on a client archive.

**Impact:** Implementing before confirming the deployed client and recovery requirements could create two competing identity systems or lock users out.

**Remediation status:** ADR-001 has now been amended to make identity strategy an explicit decision gate. Confirm the actual deployed client sign-in/setup/recovery flow before choosing provider auth or custom sessions.

### F-03 — Client/backend API contract is incomplete (Integration blocker)

**Evidence:** The route inventory lists client setup, profile, guardian pairing, payment, activity, and notification routes that are not present in the standalone backend.

**Impact:** Pointing the client at this backend may cause failed flows or encourage insecure compatibility shortcuts.

**Required remediation:** Freeze request/response schemas, implement only required routes behind their correct authorization boundaries, and run Preview end-to-end tests with synthetic accounts.

### F-04 — Guardian identity must be independently verified (High before guardian alerts)

**Evidence:** The reviewed client archive contains a guardian-confirmation path that appears to accept a client-supplied LINE identity. The standalone backend has no corresponding trusted pairing flow.

**Impact:** A claimed LINE ID is not proof that the guardian controls that account. Incorrect linking could disclose care alerts to the wrong recipient.

**Required remediation:** Use a short-lived, single-use, owner-bound pairing challenge and validate provider callbacks/API responses server-side. Do not enable real guardian alerts until ownership and consent are tested.

## Security acceptance matrix

| Test | Expected result |
|---|---|
| Missing/incorrect service credential | 401/503 before database access |
| User token missing, malformed, expired, or revoked | 401 |
| User A reads or mutates user B | 403 or non-disclosing 404 |
| Client supplies a different owner ID in body/path/query | Ignored or rejected; never changes the verified owner |
| Shared service key used as a user credential | Rejected |
| Forged or replayed guardian pairing proof | Rejected |
| Pairing challenge expired, reused, or belongs to another user | Rejected |
| Production database unavailable or auth config missing | Fail closed |
| Response/log contains secrets or raw session tokens | Must not occur |

## Rollout gates

1. Confirm the actual deployed client version and identity/recovery flow.
2. Select and document one identity strategy before implementation.
3. Implement authentication middleware and owner-scoped service boundaries with unit tests.
4. Add cross-account tests before exposing user-scoped routes.
5. Run database integration and guardian pairing tests against isolated Preview resources only.
6. Do not merge, migrate Production, or promote a deployment until the gates above are satisfied.

This review records risks and acceptance criteria; it does not claim the findings have been fixed or that the live deployment has been penetration-tested.
