# Guardian notification outbox — fail-closed policy

**Current Candidate policy:** an existing `guardian_line_id` value is legacy profile data, not evidence that a LINE account was provider-verified or that the guardian gave explicit consent.

Until a reviewed pairing/consent flow is implemented and its verified state is stored server-side:

- App-termination events may be recorded transactionally, but their notification status must be `blocked`.
- `recipient_line_id` must remain `NULL`; never copy a legacy profile value into the delivery outbox.
- The local development adapter and Supabase RPC contract must both fail closed. The Backend adapter rejects a new termination RPC result that says `pending` or claims an eligible guardian.
- No delivery worker is enabled by this change. A stored event is not proof that any LINE notification was delivered.

## Release gates

1. Define and review the provider-verified pairing protocol and explicit consent UX.
2. Persist and authorize only the verified pairing state; do not infer it from a profile field or request payload.
3. Add tests for forged, stale, revoked, missing, and unconsented guardian identities.
4. Test migrations and delivery against a positively identified isolated non-production Supabase project before enabling a worker.
5. Keep PR #2 Draft/unmerged until the identity/session bridge and guardian pairing gates are independently reviewed.

This change only alters Candidate source/tests and documentation. It does not apply SQL to Supabase, write to any persistent database, deploy to Vercel, change Production, or send LINE messages.
