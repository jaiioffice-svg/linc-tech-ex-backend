# L!nc BFF-to-Backend Signed Assertion Contract

## Status

This is the proposed server-to-server contract for the Candidate branch. It has been implemented and tested on the Backend verification side, but it is **not yet wired into the approved/deployed Client BFF**. The inspected Client archive remains unconfirmed as the production source. Do not add these secrets to browser/mobile builds or enable this on Production without a reviewed rollout.

## Trust boundary

1. The Client sends its current opaque session token only to the Client's own server-side BFF over HTTPS.
2. The BFF validates the session using the authoritative server-side session store and checks expiry/revocation. The user ID must come from that verified session record, never a request-body field.
3. After successful session validation, the BFF signs a short-lived HS256 assertion for exactly one Backend POST route.
4. The BFF calls the Backend with both `x-linc-api-key` and `x-linc-user-assertion` headers. The Backend validates the service key, signature, issuer, audience, expiry, subject, assertion ID format, and route scope, then sets `req.auth.userId` from the signed `sub` claim.
5. User-scoped controllers continue deriving identity from `req.auth.userId`. If the request body also contains `userId`, it must match the signed subject.

## Required environment variables

- `LINC_API_KEY`: distinct random secret shared only between BFF and Backend servers.
- `LINC_INTERNAL_AUTH_SECRET`: independent random secret of at least 32 bytes, shared only by the BFF signer and Backend verifier.
- `LINC_BACKEND_URL`: server-side BFF configuration containing the reviewed Backend base URL.

Do not reuse the session token as either secret. Do not expose these values in client environment variables prefixed for public exposure, compiled bundles, logs, URLs, or error responses. The Candidate currently fails closed with HTTP 503 if `LINC_INTERNAL_AUTH_SECRET` is absent or shorter than 32 bytes.

## Assertion claims

The current Backend verifier requires a compact JWT with header `{"alg":"HS256","typ":"JWT"}` and these claims:

| Claim | Required rule |
|---|---|
| `iss` | exactly `linc-client-bff` |
| `aud` | exactly `linc-backend` |
| `sub` | verified session's non-empty user ID, at most 200 characters |
| `iat` | integer Unix timestamp in seconds; no more than 5 seconds in the future |
| `exp` | integer Unix timestamp in seconds; must be in the future and no more than 60 seconds after `iat` |
| `jti` | fresh random identifier, 16–128 URL-safe characters |
| `scope` | exact one of `/api/v1/heartbeat`, `/api/v1/users/register`, or `/api/v1/alert/delete`, and it must match the actual request path |

The verifier rejects unsupported JWT header fields and any payload claim outside the allowlist `iss`, `aud`, `sub`, `iat`, `exp`, `jti`, `scope`, and optional `nbf`. It rejects an `nbf` timestamp that is later than `exp`. The BFF should use a 30-second expiry. The assertion must never be returned to the browser or mobile client. The Backend now consumes the `jti` through the atomic `linc_consume_auth_assertion` Supabase RPC before the controller runs. A repeated identifier returns HTTP 401; a missing migration, unavailable database or malformed RPC response fails closed with HTTP 503. The SQL function prunes expired IDs in the same transaction before inserting the new ID, and a primary-key conflict ensures only one concurrent request can consume a given ID. The replay table stores only the random JTI, expiry and insertion timestamp, not the user's ID. The migration is committed but has **not** been run against any database. Keep transport server-to-server over HTTPS, keep TTL short, never log assertion values, and make operations idempotent. App-delete handling avoids re-emitting an alert after the profile is already in terminal `app_deleted` state. A real PostgreSQL/Supabase integration test and the approved non-production migration/application checks are still release gates.

## BFF signing helper (Node.js)

This helper is intended for the **trusted BFF server only**. The caller must pass a user ID obtained from a validated session object; it must not pass `req.body.userId` or any other untrusted value.

~~~javascript
const crypto = require('node:crypto');

const ALLOWED_SCOPES = new Set([
    '/api/v1/heartbeat',
    '/api/v1/users/register',
    '/api/v1/alert/delete'
]);

function issueInternalAssertion(verifiedSessionUserId, scope) {
    const secret = process.env.LINC_INTERNAL_AUTH_SECRET;

    if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
        throw new Error('Internal assertion signing is not configured');
    }

    if (
        typeof verifiedSessionUserId !== 'string' ||
        !verifiedSessionUserId.trim() ||
        verifiedSessionUserId.length > 200
    ) {
        throw new TypeError('A verified session user ID is required');
    }

    if (typeof scope !== 'string' || !ALLOWED_SCOPES.has(scope)) {
        throw new TypeError('An allowed Backend route scope is required');
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const claims = {
        iss: 'linc-client-bff',
        aud: 'linc-backend',
        sub: verifiedSessionUserId,
        iat: now,
        exp: now + 30,
        jti: crypto.randomBytes(18).toString('base64url'),
        scope
    };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signingInput = encodedHeader + '.' + encodedClaims;
    const signature = crypto.createHmac('sha256', secret)
        .update(signingInput)
        .digest('base64url');

    return signingInput + '.' + signature;
}

module.exports = { issueInternalAssertion };
~~~

## BFF request example

After resolving the user ID from the validated server-side session, the BFF can call the Backend like this:

~~~javascript
async function sendHeartbeatToBackend({ verifiedSessionUserId, grade }) {
    const scope = '/api/v1/heartbeat';
    const assertion = issueInternalAssertion(verifiedSessionUserId, scope);
    const response = await fetch(process.env.LINC_BACKEND_URL + scope, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-linc-api-key': process.env.LINC_API_KEY,
            'x-linc-user-assertion': assertion
        },
        body: JSON.stringify({ grade }),
        signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
        throw new Error('L!nc Backend request failed with HTTP ' + response.status);
    }

    return response.json();
}

module.exports = { sendHeartbeatToBackend };
~~~

The example deliberately does not pass a user ID in the body: the Backend takes the owner from the signed subject. The calling route must authenticate the session before calling `sendHeartbeatToBackend`. Handle network and non-2xx failures without logging assertion headers or returning internal credentials.

## Test and rollout gates

- The Backend unit tests validate good/bad signatures, missing/short secrets, expiry, future issue time, maximum lifetime, issuer/audience, subject, `jti`, scope and method.
- The Express integration test verifies that an API key alone does not authenticate a user, an assertion scoped for a different route is rejected, a body-supplied different user ID is rejected, and a valid assertion still receives HTTP 503 when Supabase configuration is intentionally absent.
- Before wiring the BFF, confirm the actual deployed Client source and session store. If the current opaque session is stored in JSON on a serverless filesystem, migrate it to durable shared storage and verify expiry/revocation before issuing assertions.
- Configure both secrets for Preview only, deploy only an approved Preview, then test missing/invalid/valid session, wrong scope, expiry, owner isolation, persistence across separate invocations, duplicate alerts and cleanup. Do not run Production tests or send real LINE alerts as part of this gate.
- A Preview deployment remains protected by Vercel access control until the authorized test procedure is arranged. Do not create an SSO bypass/share link as a workaround.

## Durable one-time replay prevention migration

The reviewed Candidate migration is `supabase/migrations/20261024_003_auth_assertion_replay.sql`. It creates `public.linc_auth_assertion_replays` with RLS enabled, denies direct access to `anon` and `authenticated`, and exposes a `SECURITY DEFINER` function only to `service_role`. Its fixed search path is `pg_catalog, public, pg_temp`; the migration sends `NOTIFY pgrst, 'reload schema'` after creating the function. The RPC atomically deletes expired records and inserts the new `jti` without upsert; duplicate IDs return `false`. The Backend now calls this RPC after signature and claim validation and before controller execution.

The actual migration is now executed by `test/replay-migration-postgres.test.js` against an ephemeral in-memory PostgreSQL-compatible engine (PGlite). That integration test verifies successful SQL application, first-use acceptance, duplicate JTI rejection, expiry validation/pruning, RLS, and the intended role grants. This is stronger than a static SQL assertion, but it does not exercise Supabase PostgREST routing, project credentials, real hosted PostgreSQL configuration, or the target project's existing RLS/grants. The migration has **not** been applied to Supabase or any persistent database. Before doing so, positively identify the non-production Supabase project and prove it is isolated from Production.
