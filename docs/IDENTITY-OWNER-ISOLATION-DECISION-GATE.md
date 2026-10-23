# Identity and Owner-Isolation Decision Gate

Status: **Decision required before implementation**  
Scope: Backend and client authentication integration  
Risk: High — the current shared API key does not identify an individual L!nc user.

## Current verified contract

The current backend protects `POST /api/v1/heartbeat` and `POST /api/v1/alert/delete` with the server-side `LINC_API_KEY`. Both controllers take `userId` from the request body. This authenticates the caller as possessing the integration key, but does not prove that the caller owns the specified profile.

Consequently, possession of the integration key can permit cross-user heartbeat updates or termination events. Whether an external party can obtain that key has not been established; do not describe it as publicly exposed without evidence.

## Decision gate — do not guess the identity provider

Before implementing user-owned endpoints, inspect the exact client source that will be deployed and determine which of these is true:

1. **Supabase Auth is already the intended sign-in provider.** Verify the client obtains a Supabase Auth access token and confirm project/issuer/audience configuration. The backend must validate the token and derive the principal from verified claims.
2. **The app intentionally uses its own opaque sessions.** Use cryptographically random, server-issued session tokens; store only a strong hash server-side; enforce expiry/revocation and bind every request to the session's user. Never accept a client-generated profile ID as proof of identity.
3. **Neither is currently wired end-to-end.** Freeze protected user operations while selecting and implementing one explicit identity flow. Do not introduce a second competing login system as a quick fix.

Do not implement both approaches in parallel without an approved migration plan.

## Required ownership invariants

- A client must not choose the authenticated principal through body, query string, URL path, or local storage.
- Resolve the principal from a verified access token or server-side session.
- Scope reads and writes to that principal; cross-account attempts return a non-disclosing 403/404.
- Guardian pairing must use a short-lived, single-use challenge and verified provider identity. A client-supplied LINE ID or a timestamp alone is not proof of pairing.
- Server owns heartbeat timestamps and lifecycle event validation.
- Keep the shared integration key for trusted server-to-server operations only; do not embed it in browser/mobile client bundles.
- Log safe error codes only; never log bearer tokens, API keys, or full sensitive payloads.

## Safe implementation sequence

1. Identify the exact client commit/archive intended for deployment and record its session/login mechanism.
2. Write a route compatibility matrix for that client and this backend; preserve existing callers until migration is tested.
3. Implement one authentication verifier behind a small middleware interface.
4. Add owner-isolation tests for valid owner, missing/invalid/expired credentials, user A targeting user B, and forbidden guardian/profile fields.
5. Run tests with a disposable Preview database and synthetic accounts only.
6. Verify deployed Preview endpoints and logs; do not infer integration success from a successful build or a `/ready` response.
7. Only after review, plan any schema migration separately. Do not run migrations against Production as part of this work.

## Explicit non-goals

This document does not choose an identity provider, alter runtime behavior, modify database rows or grants, or authorize Production deployment. Those require evidence from the exact client build and a reviewed implementation plan.


## Client snapshot evidence (must be reconciled before coding)

A reviewed L!nc `App.tsx` snapshot dated 2026-10-18 in the project files uses `localStorage.getItem('linc_current_user_id')` and restores a profile with `GET /api/user/${savedUserId}`. In that file, the restore request does not attach a Bearer token, and profile completion writes `savedUser.id` to local storage. This is a client-held identifier, not proof of account ownership.

This finding applies to that reviewed snapshot only. It does **not** prove that the same client version is currently deployed or is the archive the user wants to ship. Before modifying routes, compare the intended release source with this snapshot and with the separate client archive that contains an opaque-session implementation. These snapshots disagree on the auth contract; do not combine their assumptions.

If the localStorage-only snapshot is the intended release, treat user profile restore and all user-owned routes as unauthenticated until a real server-verifiable identity/session is wired end-to-end. Do not make the existing `GET /api/user/:id` route public merely to preserve the current UI.
