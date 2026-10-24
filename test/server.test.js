const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const app = require('../server');

let server;
let baseUrl;
const envKeys = ['LINC_API_KEY', 'LINC_INTERNAL_AUTH_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'VERCEL_ENV'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

async function withTestEnv(values, callback) {
    const previous = Object.fromEntries(
        Object.keys(values).map(key => [key, process.env[key]])
    );

    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }

    try {
        return await callback();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function makeInternalAssertion({
    userId = 'verified-user-123',
    scope = '/api/v1/heartbeat',
    secret = 'test-only-internal-auth-secret-1234567890',
    issuedAt = Math.floor(Date.now() / 1000),
    expiresAt = issuedAt + 30,
    assertionId = 'integration-test-assertion-01'
} = {}) {
    const header = Buffer.from(JSON.stringify({
        alg: 'HS256',
        typ: 'JWT'
    })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        iss: 'linc-client-bff',
        aud: 'linc-backend',
        sub: userId,
        iat: issuedAt,
        exp: expiresAt,
        jti: assertionId,
        scope
    })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signature = crypto
        .createHmac('sha256', secret)
        .update(signingInput)
        .digest('base64url');

    return `${signingInput}.${signature}`;
}

test.before(async () => {
    // Keep this test independent of deployment secrets and use no real database.
    for (const key of envKeys) delete process.env[key];
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const key of envKeys) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
    }
});

test('health endpoint responds without database credentials', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'operational');
    assert.equal(typeof body.timestamp, 'number');
});

test('readiness clearly reports missing database configuration on Vercel', async () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'preview';
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.status, 'not_ready');
    assert.equal(body.reason, 'database_not_configured');
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
});

test('protected API reports missing API-key configuration safely', async () => {
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'test-user' })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.message, 'API authentication is not configured');
});

test('protected API rejects requests without an API key', async () => {
    process.env.LINC_API_KEY = 'test-only-key';
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'test-user' })
    });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.message, 'Unauthorized connection');
    delete process.env.LINC_API_KEY;
});

test('heartbeat fails closed without verified identity even when body identifier is blank', async () => {
    process.env.LINC_API_KEY = 'test-only-key';
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-linc-api-key': 'test-only-key' },
        body: JSON.stringify({ userId: '   ' })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.message, 'End-user identity verification is not configured');
    delete process.env.LINC_API_KEY;
});

test('heartbeat fails closed without verified identity even when body identifier is oversized', async () => {
    process.env.LINC_API_KEY = 'test-only-key';
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-linc-api-key': 'test-only-key' },
        body: JSON.stringify({ userId: 'u'.repeat(201) })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.message, 'End-user identity verification is not configured');
    delete process.env.LINC_API_KEY;
});

test('termination route fails closed without verified identity before database access', async () => {
    process.env.LINC_API_KEY = 'test-only-key';
    const response = await fetch(`${baseUrl}/api/v1/alert/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-linc-api-key': 'test-only-key' },
        body: JSON.stringify({ userId: 'delete-user' })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.message, 'End-user identity verification is not configured');
    delete process.env.LINC_API_KEY;
});

test('registration fails closed even when caller has the shared API key and submits a user ID', async () => {
    const originalFetch = global.fetch;
    let externalFetchCalls = 0;
    global.fetch = async (url, options = {}) => {
        if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
        externalFetchCalls += 1;
        throw new Error('Unexpected external request in fail-closed test');
    };
    try {
        process.env.LINC_API_KEY = 'test-only-key';
        process.env.SUPABASE_URL = 'https://example-project.supabase.co';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test_only';
        const response = await fetch(`${baseUrl}/api/v1/users/register`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': 'test-only-key'
            },
            body: JSON.stringify({
                userId: 'claimed-user',
                grade: 'M1',
                guardianLineId: 'attacker-controlled-line-id'
            })
        });
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.message, 'End-user identity verification is not configured');
        assert.equal(externalFetchCalls, 0);
    } finally {
        global.fetch = originalFetch;
        for (const key of ['LINC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key];
    }
});

test('heartbeat fails closed without verified identity and does not write persisted state', async () => {
    const originalFetch = global.fetch;
    let externalFetchCalls = 0;
    global.fetch = async (url, options = {}) => {
        if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
        externalFetchCalls += 1;
        throw new Error('Unexpected external request in fail-closed test');
    };
    try {
        process.env.LINC_API_KEY = 'test-only-key';
        process.env.SUPABASE_URL = 'https://example-project.supabase.co';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test_only';
        const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': 'test-only-key'
            },
            body: JSON.stringify({ userId: 'deleted-user', grade: 'M1' })
        });
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.message, 'End-user identity verification is not configured');
        assert.equal(externalFetchCalls, 0);
    } finally {
        global.fetch = originalFetch;
        for (const key of ['LINC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key];
    }
});

test('registration cannot spoof req.auth by nesting an auth object in JSON body', async () => {
    process.env.LINC_API_KEY = 'test-only-key';
    const response = await fetch(`${baseUrl}/api/v1/users/register`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-linc-api-key': 'test-only-key'
        },
        body: JSON.stringify({
            userId: 'claimed-user',
            auth: { userId: 'claimed-user' }
        })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.message, 'End-user identity verification is not configured');
    delete process.env.LINC_API_KEY;
});

test('protected route enforces signed BFF assertions, route scope, and verified identity before database access', async () => {
    const serviceKey = 'test-only-service-key';
    const secret = 'test-only-internal-auth-secret-1234567890';
    const validAssertion = makeInternalAssertion({ secret });

    await withTestEnv({
        LINC_API_KEY: serviceKey,
        LINC_INTERNAL_AUTH_SECRET: secret,
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
        VERCEL: '1',
        VERCEL_ENV: 'preview'
    }, async () => {
        const noAssertion = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': serviceKey
            },
            body: JSON.stringify({ userId: 'verified-user-123', grade: 'M1' })
        });

        assert.equal(noAssertion.status, 401);
        assert.equal((await noAssertion.json()).message, 'Unauthorized connection');

        const wrongScope = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': serviceKey,
                'x-linc-user-assertion': makeInternalAssertion({
                    secret,
                    scope: '/api/v1/users/register'
                })
            },
            body: JSON.stringify({ userId: 'verified-user-123', grade: 'M1' })
        });

        assert.equal(wrongScope.status, 401);
        assert.equal((await wrongScope.json()).message, 'Unauthorized connection');

        const bodySpoof = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': serviceKey,
                'x-linc-user-assertion': validAssertion
            },
            body: JSON.stringify({ userId: 'attacker-selected-user', grade: 'M1' })
        });

        assert.equal(bodySpoof.status, 403);
        assert.equal(
            (await bodySpoof.json()).message,
            'Requested user does not match authenticated identity'
        );

        const validIdentityMissingDatabase = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': serviceKey,
                'x-linc-user-assertion': validAssertion
            },
            body: JSON.stringify({ userId: 'verified-user-123', grade: 'M1' })
        });

        assert.equal(validIdentityMissingDatabase.status, 503);
        assert.equal(
            (await validIdentityMissingDatabase.json()).message,
            'Required database service is not configured or is temporarily unavailable'
        );
    });
});
