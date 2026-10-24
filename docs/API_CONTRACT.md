# L!nc Backend HTTP API Contract (Candidate)

## Status and trust boundary

This document describes the Candidate branch only. It is not evidence that the Candidate is deployed or that the approved Client calls these routes. PR #2 remains Draft and unmerged.

Every protected route under `/api/v1` requires both:
- `x-linc-api-key`: a cryptographically random server-to-server secret of at least 32 UTF-8 bytes, shared only by the trusted BFF and Backend. The Backend returns HTTP 503 if its configured `LINC_API_KEY` environment value is missing or undersized; it returns HTTP 401 for a missing or incorrect request header when configuration is valid.
- `x-linc-user-assertion`: a short-lived signed assertion minted by the BFF only after it verifies the user's authoritative session.

The Backend takes the user ID from the signed `sub` claim. A body-supplied `userId` is optional and, when present, must exactly match that subject. The Client/browser/mobile app must not hold either server secret or mint assertions itself. See [BFF Assertion Contract](./BFF_ASSERTION_CONTRACT.md).

## Routes

### Liveness and readiness

| Method | Path | Purpose | Current behavior |
|---|---|---|---|
| GET | `/health` | Process liveness | Returns HTTP 200 with `{ "status": "operational", "timestamp": <milliseconds> }`; does not prove database readiness. |
| GET | `/api/health` | Alias for liveness | Same response as `/health`. |
| GET | `/ready` | Database readiness probe | Returns HTTP 200 `{ "status": "ready" }` when the current DB probe passes; returns HTTP 503 when database configuration/probe fails. |
| GET | `/api/ready` | Alias for readiness | Same behavior as `/ready`. |

**Readiness limitation:** the current probe checks access to `linc_users`; it does not prove every required migration/RPC exists, that the database is isolated from Production, or that an authenticated end-to-end operation will succeed.

### Protected user routes

| Method / path | Purpose | Request JSON | Successful response |
|---|---|---|---|
| POST `/api/v1/users/register` | Create or update the verified user's profile | Optional `userId` consistency check; optional `grade` string up to 32 characters. Creation defaults `grade` to `M1`. | HTTP 201 for a new profile; HTTP 200 for an existing profile. `{ "success": true, "message": "User profile registered" }` or `"User profile updated"`. |
| POST `/api/v1/heartbeat` | Record a heartbeat for the verified user | Optional `userId` consistency check; optional `grade` string up to 32 characters. | HTTP 201 when it creates a missing profile; HTTP 200 when it updates an existing profile, with `{ "success": true, "message": "Heartbeat acknowledged" }`. |
| POST `/api/v1/alert/delete` | Record an app-termination/deletion event for the verified user | Optional `userId` consistency check. | HTTP 200 with `success`, `alreadyRecorded`, `notificationStatus` and a message; HTTP 404 if the target profile does not exist. |

No client-supplied `guardianLineId`, nested `auth` object, or other request property can establish the authenticated user or verified guardian identity. Do not rely on unknown request properties being rejected; controllers must only use explicitly handled fields.

### App-termination notification semantics

This route currently records the termination state and outbox event. It does **not** send an actual LINE message.

- `notificationStatus: "blocked"` means the event was recorded but its recipient is not verified; no recipient is stored for delivery.
- `notificationStatus: "already_recorded"` means the profile is already terminal and no duplicate event should be emitted.
- A legacy LINE identifier is not proof of provider-verified pairing or consent.
- The durable Supabase outbox is only available after the appropriate migrations are applied to the confirmed, isolated non-production database. The migrations in this branch have not been applied to a persistent database, and no LINE dispatcher is wired.

Never tell the user or guardian that a message was sent merely because the API returned success.

## Request constraints and common errors

- JSON request bodies are limited to 64 KiB.
- The service rejects malformed JSON with HTTP 400.
- A body over the configured limit is rejected with HTTP 413.
- User ID, when present, must be a non-empty string of no more than 200 characters.
- Grade, when present, must be a string of no more than 32 characters. The current API does not enforce an M1–M6 enum.
- CORS grants browser access only to exact valid origins listed in `LINC_ALLOWED_ORIGINS`. CORS is not authentication.

| HTTP status | Example code/message | Meaning |
|---:|---|---|
| 400 | `INVALID_JSON`, `INVALID_BODY`, `INVALID_USER_ID`, `INVALID_GRADE` | Request JSON or supported field shape is invalid. |
| 401 | `Unauthorized connection` | Request service-key header is missing/incorrect, or the signed assertion is missing/invalid/expired/replayed. |
| 403 | `Requested user does not match authenticated identity` | Request body user ID differs from the signed subject. |
| 404 | `Target profile not found` | No profile exists for the authenticated subject when deletion is recorded. |
| 404 | `ROUTE_NOT_FOUND` | No route matches the requested path. |
| 413 | `REQUEST_TOO_LARGE` | JSON body exceeds the 64 KiB limit. |
| 503 | `API authentication is not configured` | Backend `LINC_API_KEY` is missing or shorter than 32 UTF-8 bytes. |
| 503 | `End-user identity verification is not configured` | Required trusted identity verification configuration is missing/invalid. |
| 503 | `Identity verification service is temporarily unavailable` | Durable assertion replay storage is missing or unavailable. |
| 503 | `Required database service is not configured or is temporarily unavailable` | Required persistence service is unavailable/configuration is missing. |
| 500 | `INTERNAL_ERROR` | Unexpected server-side failure; response intentionally does not include stack traces or upstream bodies. |

Error messages are intended to be stable and non-sensitive. Internal diagnostics must not include API keys, signed assertions, session tokens, raw LINE IDs, or database secret values.

## Release acceptance expectations

Before calling this API usable by the Client, the following must pass in an authorized Preview environment with an isolated non-production database:
1. Valid BFF session → signed assertion → successful route; expired/revoked or malformed session is rejected by the BFF.
2. Wrong service key, wrong assertion signature, wrong route scope, replayed assertion ID, and mismatched body user ID are rejected.
3. Registration/heartbeat data persists across separate serverless invocations.
4. One user's assertion cannot read or modify a different user's profile.
5. Deletion is idempotent; its outbox write is atomic with the status transition.
6. A guardian notification is not sent until the LINE identity, consent, Official Account state, recipient and delivery worker are independently verified.
7. Health and readiness behavior is recorded against the exact deployed Candidate SHA.

Do not apply SQL or write persistent data until the Supabase project is positively identified as non-production and isolated from Production. Do not merge or promote this Candidate without separate release approval.
