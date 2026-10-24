const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { authenticateInternalAssertion } = require('../internal-assertion');

const SECRET = 'test-only-internal-auth-secret-1234567890';
const ROUTE = '/api/v1/heartbeat';

function signAssertion(overrides = {}, secret = SECRET, headerOverrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = {
        alg: 'HS256',
        typ: 'JWT',
        ...headerOverrides
    };
    const claims = {
        iss: 'linc-client-bff',
        aud: 'linc-backend',
        sub: 'verified-user-123',
        iat: now,
        exp: now + 30,
        jti: 'assertion-id-000001',
        scope: ROUTE,
        ...overrides
    };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signingInput = `${encodedHeader}.${encodedClaims}`;
    const signature = crypto
        .createHmac('sha256', secret)
        .update(signingInput)
        .digest('base64url');
    return `${signingInput}.${signature}`;
}

function mockRequest(token, overrides = {}) {
    const headers = {};
    if (token !== undefined) headers['x-linc-user-assertion'] = token;
    return {
        method: 'POST',
        path: ROUTE,
        get(name) {
            return headers[name.toLowerCase()];
        },
        ...overrides
    };
}

function mockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

async function withSecret(secret, callback) {
    const previous = process.env.LINC_INTERNAL_AUTH_SECRET;
    if (secret === undefined) delete process.env.LINC_INTERNAL_AUTH_SECRET;
    else process.env.LINC_INTERNAL_AUTH_SECRET = secret;

    try {
        return await callback();
    } finally {
        if (previous === undefined) delete process.env.LINC_INTERNAL_AUTH_SECRET;
        else process.env.LINC_INTERNAL_AUTH_SECRET = previous;
    }
}

async function run(token, options = {}) {
    const req = mockRequest(token, options.request || {});
    const res = mockResponse();
    let nextCalled = false;
    const secret = Object.prototype.hasOwnProperty.call(options, 'secret') ? options.secret : SECRET;
    await withSecret(secret, async () => {
        authenticateInternalAssertion(req, res, () => {
            nextCalled = true;
        });
    });
    return { req, res, nextCalled };
}

test('missing or too-short internal assertion secret fails closed with 503', async () => {
    for (const secret of [undefined, '', 'short-secret']) {
        const result = await run(signAssertion(), { secret });
        assert.equal(result.res.statusCode, 503);
        assert.equal(
            result.res.body.message,
            'End-user identity verification is not configured'
        );
        assert.equal(result.nextCalled, false);
    }
});

test('valid short-lived assertion establishes only the verified principal fields', async () => {
    const req = mockRequest(signAssertion());
    req.body = { userId: 'attacker-body-id', auth: { userId: 'spoofed-id' } };
    const res = mockResponse();
    let nextCalled = false;

    await withSecret(SECRET, async () => {
        authenticateInternalAssertion(req, res, () => {
            nextCalled = true;
        });
    });

    assert.equal(res.statusCode, 200);
    assert.equal(nextCalled, true);
    assert.equal(req.auth.userId, 'verified-user-123');
    assert.equal(req.auth.issuer, 'linc-client-bff');
    assert.equal(req.auth.assertionId, 'assertion-id-000001');
    assert.equal(typeof req.auth.expiresAt, 'number');
    assert.equal(Object.isFrozen(req.auth), true);
});

test('opaque bearer token alone is not accepted as an internal assertion', async () => {
    const result = await run(undefined, {
        request: {
            get(name) {
                return name.toLowerCase() === 'authorization'
                    ? 'Bearer opaque-client-session'
                    : undefined;
            }
        }
    });

    assert.equal(result.res.statusCode, 401);
    assert.equal(result.nextCalled, false);
    assert.equal(result.res.body.message, 'Unauthorized connection');
});

test('invalid signature is rejected without exposing assertion contents', async () => {
    const parts = signAssertion().split('.');
    const replacement = parts[2][0] === 'A' ? 'B' : 'A';
    parts[2] = replacement + parts[2].slice(1);
    const result = await run(parts.join('.'));
    assert.equal(result.res.statusCode, 401);
    assert.equal(result.nextCalled, false);
    assert.equal(JSON.stringify(result.res.body).includes('verified-user-123'), false);
});

test('malformed, oversized and non-HS256 assertions are rejected', async () => {
    const results = await Promise.all([
        run('not.a.valid.jwt'),
        run('a'.repeat(4100)),
        run(signAssertion({}, SECRET, { alg: 'none' })),
        run(signAssertion({}, SECRET, { crit: ['exp'] }))
    ]);

    for (const result of results) {
        assert.equal(result.res.statusCode, 401);
        assert.equal(result.nextCalled, false);
    }
});

test('expired, future-issued and overlong assertions are rejected', async () => {
    const now = Math.floor(Date.now() / 1000);
    const results = await Promise.all([
        run(signAssertion({ iat: now - 60, exp: now - 1 })),
        run(signAssertion({ iat: now + 30, exp: now + 45 })),
        run(signAssertion({ iat: now, exp: now + 61 }))
    ]);

    for (const result of results) {
        assert.equal(result.res.statusCode, 401);
        assert.equal(result.nextCalled, false);
    }
});

test('wrong issuer, audience, missing subject and missing jti are rejected', async () => {
    const results = await Promise.all([
        run(signAssertion({ iss: 'untrusted-issuer' })),
        run(signAssertion({ aud: 'another-service' })),
        run(signAssertion({ sub: '   ' })),
        run(signAssertion({ jti: undefined }))
    ]);

    for (const result of results) {
        assert.equal(result.res.statusCode, 401);
        assert.equal(result.nextCalled, false);
    }
});

test('assertion scope must exactly match one allowed POST route', async () => {
    const now = Math.floor(Date.now() / 1000);
    const wrongScope = await run(signAssertion({ scope: '/api/v1/alert/delete' }));
    const wrongPath = await run(signAssertion(), {
        request: { path: '/api/v1/users/register' }
    });
    const wrongMethod = await run(signAssertion(), {
        request: { method: 'GET' }
    });
    const notBeforeAfterExpiry = await run(signAssertion({
        iat: now,
        exp: now + 30,
        nbf: now + 30
    }));

    for (const result of [wrongScope, wrongPath, wrongMethod, notBeforeAfterExpiry]) {
        assert.equal(result.res.statusCode, 401);
        assert.equal(result.nextCalled, false);
    }
});
