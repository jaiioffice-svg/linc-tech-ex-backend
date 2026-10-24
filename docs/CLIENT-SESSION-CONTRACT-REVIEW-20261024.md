# Client Session Contract Review — 2026-10-24

Status: source review of the Library artifact `Linc_Updated_Source_for_Online_Testing.zip` (modified 2026-10-21). This artifact is **not yet confirmed as the approved client release or as the deployed Vercel source**. Findings describe the inspected archive only.

## Confirmed session design in the archive

- `src/services/api.ts` reads `linc_session_token` from browser `localStorage` and attaches it as `Authorization: Bearer <token>` to requests through `apiFetch`.
- `POST /api/user/setup` creates a session after writing a profile. `createSession` uses `crypto.randomBytes(32).toString('base64url')`; only the SHA-256 token hash is stored in `db.sessions`. The session expiry is 30 days.
- `getSessionUserId` accepts a Bearer token, hashes it, checks the session record, expiry and existence of its user, then returns the server-resolved user ID.
- `requireOwner` returns 401 without a valid session and 403 if the requested ID differs from the session user. The inspected profile-read, streak, activity, heartbeat-ping and other user-scoped handlers call this guard.
- The client clears the token and convenience user ID when session restore receives 401/403. The user ID in `linc_current_user_id` is not itself proof of identity.

## Material gaps and compatibility risks

1. **Persistence:** session and profile records are held in the archive server's JSON-file database. This is not evidence of durable, shared storage across serverless instances or a shared session store with the separate GitHub backend.
2. **Token lifecycle:** a 30-day expiry exists; the inspected code does not establish a complete logout/revocation workflow or a production-tested session store. `clearSessionToken()` clears browser storage only; it does not revoke the server-side session.
3. **Bearer storage:** the token is in `localStorage`, so XSS could expose it. Consider a server-managed `HttpOnly; Secure; SameSite` cookie if compatible with the product architecture.
4. **Profile setup and guardian trust:** the setup handler supplies fallback guardian phone/LINE/display values and sets `guardianLinePairedAt: Date.now()` without requiring a verified pairing result. The pairing confirmation handler accepts a submitted `lineUserId` and phone under a short-lived session token; this source review does not establish provider-authenticated LINE identity. These values must not be represented as verified until the provider flow is actually verified.
5. **Identity bootstrap:** new-profile creation accepts a client-supplied ID or generates an ID and returns a session. Existing profile updates require ownership, but the reviewed setup flow needs a dedicated threat review to ensure a caller cannot claim or consume another person's identity or a school entitlement.
6. **Different backend contract:** the separate repository `jaiioffice-svg/linc-tech-ex-backend` currently exposes `POST /api/v1/heartbeat` and `POST /api/v1/alert/delete` protected by a shared `x-linc-api-key`; those handlers read `userId` from the request body. The archive's bearer-session implementation is not wired into that backend. Do not simply forward client bearer tokens to the shared-key endpoints or expose the shared key in a browser bundle.
7. **Schema mismatch:** the archive's JSON-file schema and routes differ from the Supabase-backed `linc_users` backend. A migration or route cutover cannot be assumed safe without an explicit identity mapping and data migration plan.

## API origin and deployment contract — verified from this archive only

- `src/services/api.ts` attaches the bearer token but does not define a separate backend base URL. Its inspected call sites use relative paths such as `/api/user/setup`, `/api/heartbeat/ping`, and `/api/line/qr/create`. In a browser these resolve against the page's current origin, so the archive's observed API pattern is same-origin.
- A search across the archive's TypeScript/TSX/JavaScript/JSX files found **zero** references to `/api/v1/` and **18** `apiFetch` call sites using relative `/api/...` routes. This inspected snapshot therefore does not demonstrate calls to this repository's versioned Backend endpoints (`/api/v1/users/register`, `/api/v1/heartbeat`, `/api/v1/alert/delete`) and is not integrated with that endpoint contract as observed.
- The archive's `.env.example` sets `APP_URL` to the placeholder `MY_APP_URL` and describes a host URL injected by the hosting platform. This is not a confirmed live client domain and must not be copied into the separate backend's CORS allowlist.
- Consequently, the archive alone cannot establish that the separate `linc-tech-ex-backend` API is currently called directly from the browser or identify the correct `LINC_ALLOWED_ORIGINS` value. If the intended design keeps the client and its API on one origin, browser CORS configuration may be unnecessary for that client; if a separate Backend is intended, its base URL, server-to-server/BFF path, authentication handoff and real deployed origins must be documented and tested explicitly.
- Do not add an arbitrary origin to Vercel, and do not regard the restrictive CORS change in the separate backend as proof that the archive is integrated with it. Confirm the approved/deployed client source and hosting topology first.

## Required next steps before owner-isolation implementation

1. Confirm that this exact archive (or a later named version) is the approved client source and identify its actual deployment/commit.
2. Choose one authoritative identity/session system for both client and backend. If retaining opaque sessions, move session records to a durable store shared by all backend instances, store only token hashes, enforce expiry and server-side revocation, and derive the principal only from the validated session.
3. Add a unique mapping between authenticated principal and L!nc profile. Do not assume the legacy profile ID equals a provider identity.
4. Make every user-scoped route use the server-derived principal; reject body/path/query IDs that do not match or redesign routes to use `/me`.
5. Remove guardian placeholder defaults and only mark pairing verified after authenticating the provider callback/webhook and validating the single-use challenge.
6. Add tests for missing, malformed, expired and revoked sessions; account A vs account B on every user-scoped route; profile-claiming and school-voucher abuse; and guardian pairing spoofing.
7. Run integration tests against an isolated Preview database and verify persistence across separate server instances before merge or Production promotion.

## Change and verification boundary

This review changes documentation only. It does not implement authentication, modify application runtime code, apply a database migration, send notifications, or deploy Production. A source review is not a penetration test and does not prove the archive is the currently deployed client.
