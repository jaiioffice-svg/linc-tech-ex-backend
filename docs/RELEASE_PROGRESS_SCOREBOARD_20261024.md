# L!nc Backend — release progress scoreboard

**As of: 2026-10-24 17:45–17:50 Asia/Bangkok**  
**Scope:** first safely usable end-to-end Backend MVP, not the complete product UI. The approved/deployed Client source is not currently confirmed, so this is a conservative engineering estimate, not a claim that the whole L!nc app is this complete.

## Executive status

- **Estimated path-to-MVP completion: about 30% done / 70% remaining.** This is a weighted estimate of release gates, not a count of code lines or commits.
- **Current Production service: NOT operational.** A read-only probe returned HTTP 500 `FUNCTION_INVOCATION_FAILED` from both `/health` and `/ready` at 2026-10-24 10:45 UTC. The active Production deployment is still `dpl_2ELeGpWoXTL6wFFvLEXxrLZzRgAk`, from `main` SHA `336e2fcdd1b9f0841432817dcafe955b45700eef`.
- Candidate PR #2 remains **Draft and unmerged**. The code branch has not been validated as a deployed end-to-end release. No Production deployment/configuration or persistent DB was changed.
- Latest Candidate HEAD at this checkpoint: `94e145aa7442b0fc5d918bd0d546f27f1790bbf8`. GitHub Actions runs [#320](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40086431551) and [#321](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40086436042) both passed **81/81 tests, 0 failed**. These are CI tests; they do not prove live Supabase, BFF, LINE, or Production integration.

## Weighted completion model

The weighting is an explicit planning estimate for the **first safe end-to-end Backend MVP**, so large unfinished integration gates are not hidden by a green unit-test run.

| Workstream | Weight | Estimated completion | Contribution | Evidence / blocker |
|---|---:|---:|---:|---|
| Backend route/controller foundation, validation, ownership guards, outbox logic | 25% | 65% | 16.25% | Candidate code and regression coverage exist; verified session middleware is intentionally fail-closed until a trusted BFF is connected. |
| Repeatable dependency install and automated CI | 10% | 100% | 10% | Exact Candidate HEAD `94e145a`: runs #320 and #321 each passed 81/81. This is not end-to-end proof. |
| Hosted Supabase migration/RLS/RPC and real CRUD verification in an isolated non-production project | 20% | 10% | 2% | Core/replay/outbox migrations and PGlite tests exist; no migration was applied to a persistent database and actual Preview project isolation is unconfirmed. |
| Approved Client session → trusted BFF → signed Backend assertion | 20% | 0% | 0% | Contract documentation exists, but no approved Client/BFF repo/session source or verified deployed commit has been identified in the connected GitHub/Vercel inventory. |
| Provider-verified guardian pairing, explicit consent, Official Account friend state and real LINE dispatcher | 15% | 5% | 0.75% | Design contract now documented; no pairing implementation, dispatcher, or live LINE delivery exists. Legacy recipient IDs are blocked. |
| Approved Preview deployment, owner-isolation/CRUD/notification acceptance tests and release review | 10% | 0% | 0% | Current Production returns 500; latest Preview found belongs to an older Candidate SHA, not the current branch head. No approved end-to-end run has occurred. |
| **Total** | **100%** |  | **29% (~30%)** | **~71% remains** |

These numbers should be updated only when a gate is supported by observable evidence. They are intentionally estimates; they are not a statistical measurement and do not imply the UI/client is 30% finished. The current Production availability is separately **0% healthy** based on the latest observed 500 responses.

## Done and evidenced

1. The Candidate has a service-key + signed internal assertion + verified-principal + request-validation middleware chain. Missing trusted user identity fails closed; the BFF/session bridge is not implemented.
2. Assertion replay protection and the durable termination outbox have embedded PostgreSQL-compatible regression tests.
3. The outbox now **blocks** events and stores no recipient when the only evidence is a legacy `guardian_line_id`; the app adapter also rejects unsafe RPC responses.
4. Candidate HEAD `94e145a` passed both current GitHub Actions workflows, 81/81 tests each.
5. Release-gate, outbox fail-closed, and guardian-pairing contracts are saved in this branch.

## Remaining gates in dependency order

### Gate 1 — identify the actual Client and session authority
Confirm the approved Client repository/release and deployed commit, the live route/API origin, where the opaque session is stored and verified, and the server-side BFF. Do not assume the unconfirmed source archive is deployed. This is the first blocking dependency for user-scoped Backend routes.

### Gate 2 — wire trusted authentication without weakening the guard
Implement a server-side verifier against the actual approved session store. The BFF may mint a short-lived signed assertion only after verifying that session; user identity must never come from the request body. Add tests for expired/revoked sessions, invalid tokens, cross-account access and route-scope mismatch.

### Gate 3 — prove isolated non-production Supabase
Positively identify a non-production Supabase project without exposing secret values. Complete read-only schema/RLS/grant preflight, then apply reviewed migrations only after isolation is established. Test the actual PostgREST RPC, replay rejection, owner isolation, CRUD persistence across invocations, cleanup and failure behavior. PGlite tests alone do not close this gate.

### Gate 4 — implement and test verified guardian pairing
Follow `docs/GUARDIAN_PAIRING_CONTRACT.md`: provider-verified LINE identity, explicit consent, one-time challenge/replay protection, revocation, and verified Official Account follow/unfollow status. Never infer a verified guardian from the legacy profile field.

### Gate 5 — implement delivery and close release gates
Build a worker with retry/idempotency, recipient re-check before send, safe logs and dead-letter handling. Exercise it only with test data in isolated Preview and a controlled test destination. Then build/deploy the reviewed Candidate to an authorized Preview, prove health/readiness, registration/heartbeat/delete, cross-account denial and notification behavior, and obtain release review. Only then decide on a separately approved Production rollout.

## Safety boundaries preserved

- PR #2 remains Draft/unmerged.
- Candidate branch auto-deployment remains paused; existing older Preview deployments do not prove the latest branch is deployed.
- No Production variables or secret values were read/changed in this checkpoint.
- No SQL was run against Supabase; no persistent DB writes, migration application, SSO bypass, or LINE message occurred.
- Do not call the product ready based on CI success alone.
