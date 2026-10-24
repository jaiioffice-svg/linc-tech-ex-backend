# L!nc Backend — release progress scoreboard

**As of: 2026-10-24 19:22 Asia/Bangkok**  
**Scope:** first safely usable end-to-end Backend MVP, not the complete product UI. The approved/deployed Client source is not currently confirmed, so this is a conservative engineering estimate, not a claim that the whole L!nc app is this complete.

## Executive status

### Production crash root cause — confirmed from Vercel runtime logs

A fresh read-only check of the current Production alias on 2026-10-24 confirmed the same crash in the latest Production deployment: `GET /health` returned HTTP 500 at 12:21:47 UTC (request ID `pb4bz-1792844506917-8555ff84f1f1`) and `GET /ready` returned HTTP 500 at 12:21:50 UTC (request ID `k6sjs-1792844510098-c66f7dace13e`). Runtime logs for both requests show `EROFS: read-only file system, open '/var/task/linc_data.json'` at `/var/task/db.js:6:8` during module import. The latest Production deployment is `dpl_GDRLT35mJP9GVARVh6cMyKRoXnYB`, from `main` SHA `758960a4e06cb79f3c243913859243fc9bdd9a67`. The failure is therefore still reproducible on the latest deployment, not just the previously inspected deployment.

The Candidate removes the import-time JSON file write and adds a configured Supabase adapter, but the Candidate is not deployed. The latest `main` source still contains the import-time `fs.writeFileSync(DB_FILE, ...)` in `db.js`; the current Production crash is directly explained by that code. Runtime error aggregation for the last 30 minutes showed no cluster, but request-correlated runtime logs were available and confirmed the failure. Earlier runtime error clusters also showed `DB_PERMISSION_DENIED`/Supabase `42501` on older deployments; they are historical evidence, not proof of current Candidate or current database configuration. The read-only environment inventory previously showed Supabase URL/service-role variables as Preview-only, not Production; do not claim a fixed service until persistence configuration and trusted user/BFF integration are approved and verified.


- **Estimated path-to-MVP completion: about 30% done / 70% remaining.** This is a weighted estimate of release gates, not a count of code lines or commits.
- **Current Production service: NOT operational.** Read-only GET checks on 2026-10-24 at 12:21 UTC returned HTTP 500 `FUNCTION_INVOCATION_FAILED` for both `/health` and `/ready`. Latest Production deployment: `dpl_GDRLT35mJP9GVARVh6cMyKRoXnYB`, `main` SHA `758960a4e06cb79f3c243913859243fc9bdd9a67`; deployment state `READY` does not mean these routes are healthy.
- Candidate PR #2 remains **Draft and unmerged**. The code branch has not been validated as a deployed end-to-end release. No Production deployment/configuration or persistent DB was changed.
- Latest Candidate HEAD `608ddf19658319eca5e98238c4bab4ec919149e2` passed GitHub Actions [run #491](https://github.com/jaiioffice-svg/linc-tech-ex-backend/actions/runs/40093607862): **103 tests passed, 0 failed**; `npm ci`, `npm audit --audit-level=high` (**0 vulnerabilities**) and all six runtime `node --check` steps passed. Candidate now carries its own copy of migration `20261024_005_outbox_fail_closed_default.sql`; PGlite tests run the six-migration chain and simulate upgrading an older outbox schema, confirming legacy records without verified recipients become `blocked` with a null recipient. CI does not prove live Supabase or Production recovery.

## Production deployment incident — transparent record (2026-10-24)

During the outbox-migration work, a GitHub file-creation call omitted its optional branch argument and created commit 758960a4e06cb79f3c243913859243fc9bdd9a67 on main rather than the Candidate branch. Vercel then created Production deployment dpl_GDRLT35mJP9GVARVh6cMyKRoXnYB from that commit and assigned the alias linc-tech-ex-backend.vercel.app.

Verified facts:
- The commit diff contains only the new SQL file supabase/migrations/20261024_005_outbox_fail_closed_default.sql; it does not modify application runtime code.
- No SQL migration was executed against Supabase and no persistent database or secret value was changed.
- Vercel marked the deployment READY, but build status is not an HTTP health check. A runtime-log lookup for the new deployment found no request/error logs in the inspected window, so current /health behavior was not verified.
- The same migration file has since been explicitly saved into the Candidate branch at 608ddf19658319eca5e98238c4bab4ec919149e2, and its tests passed in CI run #491.
- No further Production deployment, rollback, alias move or configuration change has been issued. Because the instruction is not to alter Production, remediation of the unintended deployment requires a separately authorized Production action; do not claim it was rolled back.

This was an execution error caused by omitting the branch argument. Future GitHub file-creation calls must explicitly specify branch fix/linc-backend-clean-pr and verify the target branch and commit parent before proceeding.
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
| Repeatable dependency install, audit and automated CI | 10% | 100% | 10% | Latest Candidate HEAD `608ddf1`: run #491 passed 103 tests with zero failures, `npm audit --audit-level=high` reported 0 vulnerabilities and six runtime syntax checks passed; locked dependency installation succeeded. PGlite executes six migrations and covers fresh schema constraints and upgrade/normalization of legacy outbox records. Pinned GitHub Actions commit SHAs are used; this is not live Supabase integration proof. |
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
4. Latest Candidate code/test SHA `41752b0` passed GitHub Actions run #415 with 97 tests and zero failures, `npm audit --audit-level=high` reporting 0 vulnerabilities, and six-file JavaScript syntax checks. Assertion subjects are canonicalized, outbox RPC responses are strictly validated, the service key must be at least 32 UTF-8 bytes, Helmet headers and CORS preflight are checked, and noncanonical principals are rejected in middleware/controllers.
5. Added [`docs/API_CONTRACT.md`](./API_CONTRACT.md) as a single Candidate API reference for liveness/readiness, authenticated route contracts, status codes, payload limits, CORS and the fact that app-termination status `blocked` records an event but does not send a LINE message. It now explicitly states that distributed rate limiting (HTTP 429) is not implemented in this Candidate. This documentation does not close live integration gates.
6. Upgraded GitHub Actions checkout/setup-node to current Node 24-compatible releases pinned to full commit SHAs; the workflow transition passed run #371. The BFF signing/request example and error table now match the minimum key-length contract.
7. Cleaned the architecture contract to remove a duplicate file-layout entry and align its description with the current blocked outbox/strict assertion and API-key behavior. Corrected its historical outbox description: legacy `guardian_line_id` values do not authorize `pending`; all current termination events remain blocked with a null recipient.
8. Pinned `actions/checkout` v7.0.1 and `actions/setup-node` v7.1.0 to verified full commit SHAs in workflow commit `00e6db7`; run #421 succeeded.
9. Updated `DATABASE.md` to require verification of the isolated non-production project before any SQL, to list all five Candidate Supabase migrations in chronological order, and to clarify what `/ready` does and does not prove. Expanded `test/notification-outbox-postgres.test.js` so PGlite executes all five Candidate Supabase migrations together. Code/test commit `b5ad576` passed run #427 with 97/97 tests; the migration run remains embedded PGlite, not a persistent Supabase test.
10. Restricted protected-route request bodies to the documented `userId` and `grade` fields; any other key receives HTTP 400 `UNSUPPORTED_FIELD`. Added regression cases for guardian identity, nested auth and privilege-like fields. Current code/test SHA `39dff13` passed run #437 with 98/98 tests. This guards against accidental future mass assignment; it does not implement the missing trusted Client/BFF.
5. Release-gate, outbox fail-closed, and guardian-pairing contracts are saved in this branch.
11. Closed an outbox safety gap at the schema level: migration `20261024_004_notification_outbox.sql` now defaults events to `blocked`, omits the dead `guardian_linked → pending` path, and adds a `CHECK` constraint binding status to recipient presence. Added `20261024_005_outbox_fail_closed_default.sql` for existing schema upgrades and PGlite regression coverage that seeds contradictory old rows, executes the upgrade twice, verifies they normalize to `blocked`/NULL, and verifies invalid combinations are rejected. Candidate HEAD `608ddf1` passed run #491 with 103/103 tests, zero audit vulnerabilities, locked install and six syntax checks. Neither migration was run against persistent Supabase.

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
