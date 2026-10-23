# L!nc API Route Inventory and Security Findings

Status: source-level review of `linc_reviewed.zip`; no runtime test implied.
Review date: 2026-10-24.
Related plan: [CLIENT_BACKEND_INTEGRATION_PLAN.md](./CLIENT_BACKEND_INTEGRATION_PLAN.md).

## Route inventory

| Route | Client usage | Server implementation | Auth / state | Decision |
|---|---|---|---|---|
| `GET /api/user/:userId` | `App.tsx` | Present | `requireOwner` | Keep; add integration tests |
| `POST /api/user/setup` | `Screen2ProfileSetup.tsx` | Present | Existing user requires owner; new profile creation has no verified identity proof | Redesign before real accounts |
| `POST /api/line/qr/create` | Profile setup, QR modal | Present | No `requireOwner` found | Require an authenticated owner or a narrowly scoped, rate-limited pairing flow |
| `GET /api/line/qr/status/:sessionId` | Profile setup, QR modal | Present | No `requireOwner` found; returns status by session ID | Bind polling to owner/session secret; avoid enumerable or transferable session IDs |
| `POST /api/guardian/confirm` | Guardian webview | Present | Requires session ID and token, but accepts submitted phone and LINE user ID; no provider-signed identity proof observed in this handler | Do not label identity provider-verified until LINE identity is verified server-side |
| `POST /api/payment/in-app-purchase` | Paywall | Present | Always HTTP 501 | Keep fail-closed |
| `POST /api/payment/restore` | Paywall | Present | Always HTTP 501 | Keep fail-closed |
| `POST /api/payment/activate` | No direct call found in scanned client | Present | Always HTTP 501 | Keep fail-closed |
| `POST /api/user/streak` | Dashboard | Present | `requireOwner` | Keep; add schema validation and tests |
| `GET /api/activity/logs/:userId` | Dashboard | Present | `requireOwner` | Keep; add tests |
| `POST /api/filter/test` | Dashboard | Present | `requireOwner` | Review side effects and input bounds |
| `POST /api/heartbeat/ping` | Dashboard | Present | `requireOwner` | Keep as app heartbeat only; do not treat as device-level tamper-proof signal |
| `POST /api/heartbeat/simulate-timeout` | Dashboard | Present | `requireOwner` | Restrict to development/test mode; never expose simulation as a production alert trigger |
| `POST /api/alert/test-helper` | Dashboard | Present | `requireOwner` | Ensure test-only behavior and provider rate limits |
| `POST /api/notifications/fcm/test-alert` | Dashboard | Present | `requireOwner` | Ensure test-only behavior and provider rate limits |
| `POST /api/notifications/line/trigger-daily-batch` | Dashboard | Present | `requireOwner` | Confirm bounded scope; user ownership alone must not authorize a global batch |
| `POST /api/engine/heartbeat` | Unified engine | Present | Always HTTP 501 | Keep fail-closed until device identity and replay protections exist |
| `POST /api/line/simulate-scan` | `LineQrModal.tsx` | No route found in scanned `server.ts` | Missing | Remove from production UI or implement a development-only mock that cannot set real verified state |
| `POST /api/engine/alert` | `lincUnifiedCoreEngine.ts` | No route found in scanned `server.ts` | Missing | Define event schema, owner authorization, deduplication, and delivery semantics before implementing |

## High-priority findings

### 1. New profile creation and user-controlled identifiers

`POST /api/user/setup` accepts an `id` and only invokes `requireOwner` when that ID already exists. A new ID can therefore be created without an identity-provider proof in this handler. Session creation proves possession of the returned token after setup, but does not independently establish the real-world identity or prevent an attacker from claiming a predictable/known identifier unless the ID-generation and account-claiming rules are tightened.

**Required fix:** generate an opaque internal account ID server-side for new users; reject client attempts to claim an existing ID without a verified session; validate any voucher/school entitlement independently; add concurrent duplicate-creation tests.

### 2. Guardian pairing is not equivalent to provider-verified identity

The pairing confirmation handler validates a short-lived pairing token using constant-time comparison, which is useful. However, in the reviewed handler the submitted `lineUserId` and phone are accepted from the request body; no LINE-signed callback or provider identity verification is visible there. QR create and status routes also have no `requireOwner` check in the inspected route declarations.

**Required fix:** verify LINE identity through a trusted provider callback/API; bind the pairing challenge to the authenticated user; make it single-use; expire it; rate-limit create/status/confirm; prevent cross-account session binding; only then persist `verifiedAt`.

### 3. Fake encryption marker and invented guardian defaults

The profile setup handler creates a masked string with a literal `[AES-256 GCM]` suffix; this is masking/labeling, not demonstrated encryption. It also substitutes default guardian phone, LINE ID, and display name, then assigns `guardianLinePairedAt: Date.now()` during profile setup.

**Required fix:** remove fake defaults and false pairing timestamps; represent unknown/unpaired state as null or `pending`; if encryption is required, use a reviewed authenticated-encryption implementation with managed keys and a tested decrypt path. Never use the marker as a security guarantee.

### 4. JSON-file persistence and in-memory rate limiting

Atomic rename helps reduce partial-file writes but does not provide cross-instance consistency, transactions, or durable shared storage for serverless execution. The rate limiter is also in-memory and explicitly single-process.

**Required fix:** move authoritative state to a durable database with constraints and transactions; use a distributed rate limit or provider-side limits for public pairing and alert endpoints.

### 5. Simulation endpoints and alert semantics

The dashboard calls timeout and notification test endpoints. A user session is not sufficient authorization for operations that might send notifications at scale or simulate production incidents.

**Required fix:** separate development/test endpoints from production builds; enforce environment gates server-side; add idempotency, per-user quotas, audit events, and explicit provider-delivery states.

## Required test matrix

- Missing, malformed, expired, revoked, and valid session tokens.
- Attempt to create an account using an existing user's ID.
- Concurrent requests attempting to claim the same ID or consume the same voucher quota.
- Guardian challenge expiry, token replay, token mismatch, cross-account pairing, and forged LINE identity.
- Pairing status access from another session.
- Rate limits on QR creation, polling, confirmation, and test-alert routes.
- Test endpoints disabled in Production.
- API error responses do not reveal tokens, provider credentials, or personal data.
- Persistence consistency when requests are served by separate instances.
- Client call for `/api/line/simulate-scan` and `/api/engine/alert` either removed/guarded or backed by explicitly documented, tested routes.

## Scope and limits

This is a static source review of the supplied archive, not a penetration test, provider verification, database migration, or runtime integration test. The GitHub backend repository and client archive are separate codebases. Do not infer that this inventory describes routes deployed in the GitHub backend service.
