# L!nc Backend — release progress scoreboard

**As of: 2026-10-24 18:20 Asia/Bangkok**  
**Scope:** first safely usable end-to-end Backend MVP, not the complete product UI. The approved/deployed Client source is not currently confirmed, so this is a conservative engineering estimate, not a claim that the whole L!nc app is this complete.

## Executive status

### Production crash root cause — confirmed from Vercel runtime logs

A read-only runtime-log lookup for the latest Production `GET /health` request (2026-10-24 10:45:09 UTC, request ID `v7whp-1792838708760-994e2fe731a8`) returned the actual stack trace: `EROFS: read-only file system, open '/var/task/linc_data.json'` from `/var/task/db.js:6:8` during module import. The active Production deployment is `dpl_2ELeGpWoXTL6wFFvLEXxrLZzRgAk`, from `main` SHA `336e2fcdd1b9f0841432817dcafe955b45700eef`. This confirms the immediate HTTP 500 root cause; it is no longer just a hypothesis.

The Candidate removes the import-time JSON file write and adds a configured Supabase adapter, but the Candidate is not deployed. The read-only Vercel environment inventory previously showed the Supabase URL/service-role variables as Preview-only, not Production; do not claim a fixed Production service until the persistence configuration and authenticated user/BFF integration are approved and verified. Removing the import-time write alone would not make the old JSON-backed API durable on a read-only serverless filesystem.


- **Estimated path-to-MVP completion: about 30% done / 70% remaining.** This is a weighted estimate of release gates, not a count of code lines or commits.
- **Current Production service: NOT operational.** A read-only probe returned HTTP 500 `FUNCTION_INVOCATION_FAILED` from both `/health` and `/ready` at 2026-10-24 10:45 UTC. The active Production deployment is still `dpl_2ELeGpWoXTL6wFFvLEXxrLZzRgAk`, from `main` SHA `336e2fcdd1b9f0841432817dcafe955b45700eef`.
- Candidate PR #2 remains **Draft and unmerged**. The code branch has not been validated as a deployed end-to-end release. No Production deployment/configuration or persistent DB was changed.
- Latest CI evidence is Candidate commit `2d9832257e8c26adb17cab18a3917a495e88d78e`, verified by GitHub Actions [run #341](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40089439405): **89 tests passed, 0 failed**. This includes six HTTP server contracts plus a full Express registration flow through API-key validation, signed assertion/replay check, controller, and mocked Supabase REST boundary. `npm ci`, `npm audit --audit-level=high` (**0 vulnerabilities**) and six-file `node --check` also succeeded. CI does not prove live Supabase, BFF, LINE, current Preview deployment or Production integration.

## Percentage reporting correction — one fixed baseline from now on

The earlier conversational estimates of **55%, 40%, and 30% are not comparable or defensible as one continuous progress series** because their scope/weighting was not stated and no common calculation sheet was maintained. Those earlier values should not be interpreted as a measured regression or as proof that 55% of the full product had been completed. They are retracted as a consistent metric; the cause was inadequate reporting discipline, not a verified loss of completed work.

**Authoritative baseline for this project: 29% complete (~30%) / 71% remaining** toward the first safe end-to-end Backend MVP, calculated from the weighted table below. This is a planning estimate with explicit gate weights, not an objective measurement and not the progress of the full L!nc app.

Reporting rules from this checkpoint:
1. Keep the same six workstreams, weights, scope and calculation for every future update. Do not silently change the denominator.
2. Update a workstream percentage only when there is new observable evidence that a gate was completed or invalidated; add a dated note with the test, commit, deployment or verified integration result.
3. A better CI pipeline, passing tests, or additional documents improve engineering confidence but do not automatically add feature-completion percentage unless they close a weighted delivery gate.
4. Report separate indicators for **Backend MVP completion**, **Production availability**, and **full-product scope confidence**. Never combine them into one number.
5. Do not claim the full product is 30% complete: the approved Client release and native Android/iOS implementation have not been confirmed. Whole-product percentage remains **not yet reliably measurable**.
6. Every status update must tell the owner what changed since the last checkpoint, what evidence supports it, which gate is next, and why completion can or cannot increase.

## Weighted completion model

The weighting is an explicit planning estimate for the **first safe end-to-end Backend MVP**, so large unfinished integration gates are not hidden by a green unit-test run.

| Workstream | Weight | Estimated completion | Contribution | Evidence / blocker |
|---|---:|---:|---:|---|
| Backend route/controller foundation, validation, ownership guards, outbox logic | 25% | 65% | 16.25% | Candidate code and regression coverage exist; verified session middleware is intentionally fail-closed until a trusted BFF is connected. |
| Repeatable dependency install, audit and automated CI | 10% | 100% | 10% | Candidate commit `2d98322`: run #341 passed 89 tests with zero failures, `npm audit --audit-level=high` reported 0 vulnerabilities and six runtime syntax checks passed; the lockfile install succeeded. This is not live integration proof. |
| Hosted Supabase migration/RLS/RPC and real CRUD verification in an isolated non-production project | 20% | 10% | 2% | Core/replay/outbox migrations and PGlite tests exist; no migration was applied to a persistent database and actual Preview project isolation is unconfirmed. |
| Approved Client session → trusted BFF → signed Backend assertion | 20% | 0% | 0% | Contract documentation exists, but no approved Client/BFF repo/session source or verified deployed commit has been identified in the connected GitHub/Vercel inventory. |
| Provider-verified guardian pairing, explicit consent, Official Account friend state and real LINE dispatcher | 15% | 5% | 0.75% | Design contract now documented; no pairing implementation, dispatcher, or live LINE delivery exists. Legacy recipient IDs are blocked. |
| Approved Preview deployment, owner-isolation/CRUD/notification acceptance tests and release review | 10% | 0% | 0% | Current Production returns 500; latest Preview found belongs to an older Candidate SHA, not the current branch head. No approved end-to-end run has occurred. |
| **Total** | **100%** |  | **29% (~30%)** | **~71% remains** |

These numbers should be updated only when a gate is supported by observable evidence. They are intentionally estimates; they are not a statistical measurement and do not imply the UI/client is 30% finished. The current Production availability is separately **0% healthy** based on the latest observed 500 responses.

## Important scope correction — the full Client app is not covered by the 30% Backend estimate

The Library artifact `Linc_Updated_Source_for_Online_Testing.zip` was inspected as a **reference archive only**. It is not present in the connected GitHub repository inventory and has not been confirmed as the approved or deployed Client source. Its own README calls the build a development scaffold, not a production-ready app.

Review observations in that archive (not proof of current deployed behavior):
- It is a React/Vite/Express app with a local JSON store (`data/linc_store.json`) and its opaque session hashes stored in that same JSON-backed in-process state. This does not demonstrate durable shared session storage across serverless instances.
- `POST /api/guardian/confirm` accepts `lineUserId` from the request body and then records it as a guardian; the examined route validates the QR pairing token, but does not itself verify a LINE Login ID token with LINE.
- `POST /api/user/setup` substitutes a placeholder guardian ID (`line_guardian_linc`) when none is supplied and sets `guardianLinePairedAt` at profile creation. That must not be treated as verified guardian pairing.
- The archive's `src/services/api.ts` sends an opaque `localStorage` session token to same-origin `/api/*` endpoints. The archive does not demonstrate a BFF connection to this Backend's `/api/v1/*` routes.
- Its README documents payment/restore and device-heartbeat endpoints as deliberately returning HTTP 501 until trusted providers/device authentication are implemented. The inspected archive is not a native Android/iOS project and does not prove OS-level VPN/site filtering is implemented.

Therefore, **the ~30% figure applies only to the first safe Backend MVP**, not the full L!nc product, Client UI, native protection, payment or live LINE delivery. A reliable full-product percentage cannot be assigned until the approved Client repository/release and the MVP scope are confirmed. The full product is not ready for real users now.

## Done and evidenced

1. The Candidate has a service-key + signed internal assertion + verified-principal + request-validation middleware chain. Missing trusted user identity fails closed; the BFF/session bridge is not implemented.
2. Assertion replay protection and the durable termination outbox have embedded PostgreSQL-compatible regression tests.
3. The outbox now **blocks** events and stores no recipient when the only evidence is a legacy `guardian_line_id`; the app adapter also rejects unsafe RPC responses.
4. Latest CI commit `2d98322` passed GitHub Actions run #341 with 89 tests and zero failures, `npm audit --audit-level=high` reporting 0 vulnerabilities, and six-file JavaScript syntax checks.
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
