# L!nc client/backend route compatibility inventory

- Status: Static inventory based on the reviewed client archive and the current backend branch; not a live integration test.
- Date: 2026-10-24
- Safety: Documentation only. No Production changes or database migrations.

## Summary

The reviewed client and the standalone backend are not yet API-compatible. The client archive expects a broad application API for user setup, guardian pairing, payments, activity, and notifications. The backend currently exposes a smaller service API focused on heartbeat and alert operations. Do not point the client at the standalone backend until the missing routes, identity model, and response schemas are implemented and tested in Preview.

## Route inventory

| Client route observed in reviewed archive | Current backend branch evidence | Required next step |
|---|---|---|
| `POST /api/user/setup` | Not present in the standalone backend route list | Define create/recovery/session contract; never trust caller-selected IDs |
| `GET /api/user/:userId` | Not present | Add session authentication and owner check |
| `POST /api/line/qr/create` | Not present | Add owner-bound, random, expiring pairing challenge |
| `GET /api/line/qr/status/:sessionId` | Not present | Bind challenge to owner and prevent status disclosure |
| `POST /api/guardian/confirm` | Not present | Verify provider identity through trusted LINE flow; reject client-asserted IDs |
| `POST /api/payment/in-app-purchase` | Not present in standalone backend | Keep fail-closed until provider receipt/server verification is implemented |
| `POST /api/payment/restore` | Not present in standalone backend | Keep fail-closed until restore is verified server-side |
| `GET /api/user/streak` | Not present | Define authenticated read contract |
| `GET /api/activity/logs/:userId` | Not present | Define owner-scoped read contract and data retention |
| `POST /api/heartbeat/ping` | Not present under this path | Decide whether to adapt client to `POST /api/v1/heartbeat` or provide a compatibility route; require real device/user auth |
| `POST /api/heartbeat/simulate-timeout` | Not present | Test-only route must never be exposed in Production |
| `POST /api/filter/test` | Not present | Define purpose, authorization, and supported platform behavior |
| `POST /api/alert/test-helper` | Not present | Test-only route must be isolated from Production delivery |
| `POST /api/notifications/fcm/test-alert` | Not present | Define provider credentials, ownership, rate limits, and delivery receipts |
| `POST /api/notifications/line/trigger-daily-batch` | Not present | Restrict to a verified scheduler/service identity; prevent public triggering |
| `POST /api/v1/heartbeat` | Present; protected by `x-linc-api-key` | Service-to-service route only; key is not end-user identity |
| `POST /api/v1/alert/delete` | Present; protected by `x-linc-api-key` | Verify payload contract and restrict service callers |
| `GET /health`, `GET /api/health` | Present | Liveness only; not proof of DB, auth, or user-level readiness |
| `GET /ready` | Present | Confirms a database reachability probe only; not proof of user-level CRUD or ownership isolation |
| `GET /api/cron/check-heartbeats` | Present; requires `CRON_SECRET` Bearer token | Keep scheduler secret server-side; test missing/wrong/correct secret |

## Integration gates

1. Freeze the expected API schemas and status/error semantics for each required client flow.
2. Separate user-session authentication from service-to-service API-key authentication.
3. Implement owner-scoped routes and cross-account denial tests before connecting real user data.
4. Keep payment, LINE pairing, and notification delivery disabled or fail-closed until trusted provider verification is implemented.
5. Use synthetic users and isolated Preview database resources for end-to-end tests.
6. Verify the exact deployed client build and backend URL before claiming integration success.

## Important interpretation

“Not present” means no matching route was found in the reviewed standalone backend route inventory. It does not claim that no other service or older client server implements it. This inventory does not certify the live deployment and does not imply that any client request has been sent successfully.
