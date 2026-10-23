# L!nc API Authentication and Client Contract (Proposal)

Status: proposed design; **not implemented**.
Branch: `fix/supabase-readiness-diagnostics`.
Purpose: establish a safe contract before changing runtime routes or the client.

## Why implementation is gated

The available client snapshot stores `linc_current_user_id` in browser local storage and calls `GET /api/user/{id}`. That identifier is user-controlled and cannot authenticate a person. The current backend instead exposes API-key-protected heartbeat and app-termination routes, with no matching profile-read route. No authoritative client sign-in/token flow has been confirmed.

Do not ship a new profile endpoint that looks up arbitrary IDs, and do not treat `LINC_API_KEY` as end-user authentication.

## Proposed target architecture

1. The client signs in through the authentication provider already used by the product. If Supabase Auth is confirmed, the client sends its short-lived access token as `Authorization: Bearer <access_token>`. If the existing app uses another provider, implement an equivalent verifier for that provider instead of silently switching identity systems.
2. Backend middleware validates the token with the trusted provider (for Supabase Auth, use the Auth user-verification endpoint or a correctly configured JWT verifier). Reject missing, malformed, expired, wrong-issuer, or wrong-audience tokens with 401. Fail closed if verification configuration is missing.
3. Middleware exposes a server-derived principal (verified provider user ID). Never derive identity from a request body, query parameter, path segment, or local storage.
4. Resolve the verified principal to the L!nc profile through an explicit, unique mapping. Confirm whether `linc_users.user_id` is the provider UUID or a legacy L!nc ID before selecting a schema change. Do not assume the two identifiers are interchangeable.
5. Use least privilege for profile operations. The Supabase service-role key remains server-only. Prefer database policies and user-scoped operations where feasible; if service role is used, enforce ownership in every handler and test it.

## Proposed route contract

| Operation | Proposed route | Authorization rule |
|---|---|---|
| Read own profile | `GET /api/v1/me` | Verified principal maps only to the caller's profile |
| Update allowed profile fields | `PATCH /api/v1/me` | Explicit field allowlist; no client-supplied owner ID |
| Heartbeat | `POST /api/v1/me/heartbeat` | Verified caller only; update heartbeat timestamp server-side |
| Report app lifecycle event | `POST /api/v1/me/lifecycle-events` | Verified caller only; event allowlist; idempotency/rate limit considered |
| Guardian linking | Separate consent-backed flow | Verify both sides and persist link only after explicit consent |

The existing `/api/v1/heartbeat` and `/api/v1/alert/delete` routes must not be silently reinterpreted until client callers are located and migrated. A report that an app was removed should be treated as a lifecycle signal, not as authorization to delete the user's profile.

## Security acceptance tests before merge

- Missing, malformed, expired, wrong-issuer, and invalid-signature tokens are rejected.
- A valid token can read/update only the mapped caller profile.
- User A cannot read or update User B by changing a URL, query, or payload ID.
- Profile writes reject unknown fields and cannot change guardian linkage or privilege/status fields.
- Heartbeat timestamps are set by the server; client-supplied timestamps are ignored.
- Guardian links cannot be created or changed by heartbeat/profile updates.
- No secret, access token, service-role key, or Authorization header appears in logs or client bundles.
- Existing unauthenticated and wrong-key rejection tests remain passing.
- Controlled Preview integration test proves create/read/update against the intended Supabase project and cleans up its dedicated test record.

## Data and migration gates

- Inspect the actual Supabase schema and existing values for `user_id`, `created_at`, and `last_heartbeat` before changing types or identity mapping.
- Confirm whether timestamp fields are epoch milliseconds, epoch seconds, or ISO timestamps using column metadata and representative non-sensitive records.
- Do not apply `20261024_002_convert_heartbeat_timestamps_to_epoch_ms.sql` until this is proven.
- Do not enable LINE alerts in Production until guardian linking, consent, recipient ownership, and delivery have been verified.

## Safe implementation order

1. Locate the current client source and identify its actual sign-in provider and API callers.
2. Confirm the user-ID mapping and live schema.
3. Implement the verifier and ownership layer with unit tests first.
4. Add `/api/v1/me` routes and integration tests in Preview.
5. Migrate the client to the new contract; remove any client-held shared API secret.
6. Verify heartbeat/lifecycle and guardian-consent flows separately.
7. Merge and promote only after all gates pass.

This document is a proposal, not evidence that any of the proposed routes or authentication flows currently exist.
