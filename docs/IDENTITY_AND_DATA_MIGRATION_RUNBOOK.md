# L!nc Identity, Data, and Preview Migration Runbook

Status: implementation runbook / design gate; no schema changes or runtime behavior changed.
Date: 2026-10-24.
Target branch: `fix/supabase-readiness-diagnostics`.
Related: [Client–Backend Integration Plan](./CLIENT_BACKEND_INTEGRATION_PLAN.md), [Client API Route Security Review](./CLIENT_API_ROUTE_SECURITY_REVIEW.md).

## Executive decision

Do not connect the client archive directly to the current heartbeat API. The archive's Express/JSON-file server and this repository's Supabase heartbeat service are separate systems with incompatible routes and identity assumptions.

Use one durable database and one explicit identity boundary. Prefer Supabase Auth if the product's onboarding can support a verified or anonymous Auth principal with a clear recovery/linking plan. If the product must create a profile without a provider login, implement server-issued opaque sessions backed by a database table instead; do not treat a client-generated `userId` as identity. Do not mix both approaches implicitly.

**Default recommendation:** first prototype the identity flow in Preview using a dedicated test account. Before coding, confirm the chosen sign-in/recovery UX from the existing client requirements. Keep the service-role key server-only. Keep `LINC_API_KEY` strictly for service-to-service calls.

## Non-negotiable invariants

1. The server derives the user ID from a verified session/token; it never trusts a request body's `userId` as proof of ownership.
2. Every read and write of user-owned data is scoped to that principal. Cross-user access must return 403 or a deliberately non-disclosing 404.
3. Guardian relationships are separate records and grant only explicitly defined permissions. Pairing requires a short-lived, single-use challenge bound to the intended user; record `verified_at` only after trusted provider verification.
4. Store hashes of custom session tokens, never raw tokens. Revoke and expire sessions server-side. Do not log bearer tokens, LINE credentials, phone numbers, or full profile payloads.
5. No default/fake guardian phone or LINE ID; no pairing timestamp until pairing succeeds; no label claiming encryption unless authenticated encryption and key management actually exist.
6. Test, simulation, and batch-notification routes are disabled or safely bounded in Production.
7. No database migration or traffic switch until Preview tests and rollback steps pass.

## Proposed database boundary (design only)

Names below are illustrative and must be reconciled against existing tables before any migration.

- `profiles`: `id` (UUID primary key), minimal profile fields, `created_at`, `updated_at`.
- `user_sessions` (only for custom-session option): `id`, `user_id` FK, unique `token_hash`, `expires_at`, nullable `revoked_at`, `created_at`. Add an index on active-session lookup fields; never store raw token.
- `guardian_links`: `id`, `user_id` FK, provider name, provider subject, status (`pending|verified|revoked`), challenge hash, expiry, verified/revoked timestamps. Enforce single-use challenges and prevent unintended duplicate active links.
- `registered_devices`: `id`, `user_id` FK, installation identifier hash, created/last-seen/revoked timestamps. Device identity must not be inferred from a caller-supplied label.
- `heartbeat_events`: `id`, `user_id` FK, optional device FK, received timestamp, source, bounded metadata.
- `activity_events`: `id`, `user_id` FK, event type allowlist, minimal metadata, timestamp.
- `alert_events`: `id`, `user_id` FK, alert type allowlist, idempotency key, status, created timestamp.
- `notification_deliveries`: `id`, alert FK, provider, provider message ID, status, attempt count, safe error category, timestamps.

Apply foreign keys, constraints, and query-driven indexes. Use RLS when clients access Supabase directly; if all access goes through the server, still enforce owner checks at the API boundary and restrict database credentials. Never expose the service-role key to browser/mobile code.

## API contract requirements

Before adding routes, produce a route matrix for every client call: method/path, input schema, output schema, identity requirement, owner/guardian rule, rate limit, side effects, and tests. Validate input with a schema library or equivalent explicit validators; reject unknown or oversized fields where appropriate.

- Profile creation: server-generated opaque ID; idempotent behavior; no caller-selected existing ID.
- Profile reads/updates: derive owner from auth context; never rely on path ID alone.
- Heartbeat: authenticated user/device; server timestamp; replay/rate-limit policy; do not describe it as tamper-proof.
- Guardian pairing: challenge bound to user, short TTL, single use, provider identity verified by a trusted flow, status polling scoped to the initiating session.
- Alerts: allowlisted event types, ownership check, idempotency, per-user quota, safe delivery-state model (`queued`, `provider_accepted`, `delivered` only if evidenced, `failed`).
- Test/simulation/batch routes: environment gate plus authorization and strict bounds; no caller-controlled global batch.
- Unimplemented payment/device-engine endpoints remain fail-closed until their provider/device trust models are defined.

## Safe implementation sequence

### Phase 0 — preserve and inventory
- Keep PR #6 Draft and Production untouched.
- Record the current deployed commit and current schema before any change.
- Inspect all existing Supabase tables, policies, indexes, triggers, and functions read-only.
- Map every client fetch call against both servers; mark each keep/adapt/replace/remove.
- Select the identity UX (Supabase Auth vs custom sessions) before implementing.

### Phase 1 — tests before migration
- Add tests for missing, invalid, expired, revoked, and wrong-owner credentials.
- Add account-claiming, duplicate-create, concurrent pairing, challenge replay/expiry, and cross-account polling tests.
- Add tests proving simulation and notification batch routes cannot affect production users.
- Add contract tests for request validation and safe error responses.
- Use a disposable test project or isolated Preview data; never test destructive operations against Production.

### Phase 2 — additive Preview schema
- Write an additive migration only after checking the actual schema and naming conflicts.
- Save the migration and rollback notes in version control.
- Apply to a disposable/non-production Supabase project first.
- Verify constraints, RLS/policies, indexes, and rollback there.
- Do not drop or rewrite the existing `linc_users` table during the first migration.

### Phase 3 — server implementation
- Implement one identity middleware and one ownership helper, then test them.
- Add durable repositories for profiles, sessions (if selected), guardian links, heartbeat events, alerts, and deliveries.
- Keep service-role access in server runtime only; do not return secrets in responses.
- Preserve current heartbeat API behavior until a versioned contract and compatibility plan are approved.

### Phase 4 — Preview end-to-end verification
- Build with the committed lockfile and supported runtime.
- Run unit, route, and security tests.
- With a dedicated test principal, verify create → read → update → heartbeat → alert record.
- Verify a second principal cannot read/update the first principal's data.
- Verify pairing replay/expiry and forged provider identity are rejected.
- Verify notification status reflects provider evidence, not just an HTTP 200 from our server.
- Capture commit SHA, deployment URL, test commands, results, and limitations.

### Phase 5 — release review (not authorized by this document)
- Review data migration, privacy/retention, rollback, operational monitoring, and support flow.
- Obtain explicit approval before production migration, merge, or traffic change.
- Keep a rollback path that restores the previous deployment without deleting new user data.

## Acceptance checklist

- [ ] Identity strategy and recovery UX documented.
- [ ] All client routes mapped to a versioned contract.
- [ ] Owner isolation tests pass for every user-data route.
- [ ] Guardian identity is provider-verified and pairing is single-use.
- [ ] No placeholder contacts, fake encryption claims, or unverified pairing state.
- [ ] Database migration and rollback tested outside Production.
- [ ] Lockfile-based install and build succeed in CI.
- [ ] Preview E2E evidence records the exact commit and test principal (no secrets).
- [ ] Production and user data remain untouched until separately approved.

## Current limitation

This document is a plan, not proof of implementation. It adds no API route, database table, authentication behavior, notification, or deployment change. The client archive is not the same repository as this backend. Do not mark L!nc production-ready based on this runbook or a passing health/readiness endpoint alone.
