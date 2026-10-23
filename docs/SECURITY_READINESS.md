# L!nc Backend Security Readiness

Last reviewed: 2026-10-24
Scope: current backend branch `fix/supabase-readiness-diagnostics`.

## Current verified state

- GitHub Actions runs the Node test suite on pushes to the diagnostics branch.
- The current test suite includes controller tests, database adapter tests, LINE alert tests, API-key middleware tests, and HTTP-level rejection tests.
- The HTTP security tests verify that missing/wrong API credentials are rejected for heartbeat/delete routes and that the cron route rejects missing credentials.
- Supabase service credentials are read by the backend from environment variables; they must never be embedded in a mobile/web client.
- Heartbeat payloads do not set or replace `guardianLineId`. Guardian linking must be a separate verified consent flow.
- The readiness route checks whether Supabase is reachable. A successful readiness response is not proof that authenticated writes and reads work end-to-end.
- The current shared `LINC_API_KEY` proves possession of an integration secret, not the identity or ownership of an individual user.

## Release blockers

1. **Per-user authentication and ownership are not complete.** A request authenticated only by the shared API key can submit a caller-chosen `userId`. Do not treat this key as user authentication, and do not ship it as a secret embedded in a client.
2. **Live database write/read has not been demonstrated end-to-end** against the current Preview deployment with a controlled test identity.
3. **Timestamp migration requires live-schema verification.** Do not apply `20261024_002_convert_heartbeat_timestamps_to_epoch_ms.sql` until the actual column types and interpretation of existing timestamp values have been checked in the intended Supabase project.
4. **Guardian linking and LINE delivery are not production-verified.** Keep outbound alerts disabled until a verified linking/consent flow and a safe test recipient have been confirmed.
5. **Production promotion and PR merge remain gated** until the above release blockers are resolved and regression tests pass.

## Recommended implementation sequence

1. Identify the client sign-in/session mechanism and determine whether its user identifier is a Supabase Auth UUID or a legacy application ID. Do not infer this from the database column name.
2. Choose and implement a server-verifiable user authentication strategy compatible with that client. Validate token signature/issuer/audience or use Supabase Auth's user-verification endpoint; never trust a client-supplied `userId` by itself.
3. Enforce ownership: the authenticated principal may update only its own heartbeat/profile. Keep app-deletion/termination reporting distinct from user-initiated profile deletion, and prevent arbitrary cross-user status changes.
4. Add tests for missing, expired, malformed, and wrong-user tokens, plus positive owner-only heartbeat updates and denied cross-user updates.
5. Run controlled Preview integration tests for create/read/update using a dedicated test identity and verify cleanup. Do not expose a public test endpoint or log tokens/keys.
6. Verify database column types and timestamp semantics before any migration. Confirm readiness, live write/read, auth, and alert behavior separately.
7. Merge/promote only after release gates pass.

## Security invariants

- Never log API keys, access tokens, service-role keys, or authorization headers.
- Never trust a `userId` supplied in a request body as proof of identity.
- Never allow heartbeat requests to create or modify guardian links.
- Guardian notifications must be opt-in, tied to a verified link, and phrased with care.
- Keep diagnostic endpoints non-mutating and do not create unauthenticated write/test backdoors.
