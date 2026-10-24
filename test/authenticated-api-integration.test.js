const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

const ENV_KEYS = [
    'LINC_API_KEY',
    'LINC_INTERNAL_AUTH_SECRET',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VERCEL',
    'VERCEL_ENV'
];
const originalEnv = Object.fromEntries(
    ENV_KEYS.map(key => [key, process.env[key]])
);

const API_KEY = 'test-only-api-key-for-backend-integration';
const INTERNAL_SECRET = 'test-only-internal-assertion-secret-32-bytes-minimum';
const USER_ID = 'integration-user-001';
const SUPABASE_ORIGIN = 'https://linc-test-project.supabase.co';

process.env.LINC_API_KEY = API_KEY;
process.env.LINC_INTERNAL_AUTH_SECRET = INTERNAL_SECRET;
process.env.SUPABASE_URL = SUPABASE_ORIGIN;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test-only-key';
process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'preview';

const app = require('../server');
const server = http.createServer(app);
const nativeFetch = global.fetch;

function createAssertion() {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .toString('base64url');
    const claims = Buffer.from(JSON.stringify({
        iss: 'linc-client-bff',
        aud: 'linc-backend',
        sub: USER_ID,
        iat: now,
        exp: now + 30,
        jti: 'test-assertion-id-000001',
        scope: '/api/v1/users/register'
    })).toString('base64url');
    const signingInput = `${header}.${claims}`;
    const signature = crypto.createHmac('sha256', INTERNAL_SECRET)
        .update(signingInput)
        .digest('base64url');
    return `${signingInput}.${signature}`;
}

test('authenticated registration API integration with isolated Supabase boundary', async t => {
    const calls = [];
    global.fetch = async (input, options = {}) => {
        const url = new URL(String(input));
        if (url.origin !== SUPABASE_ORIGIN) return nativeFetch(input, options);

        calls.push({
            method: options.method || 'GET',
            path: url.pathname,
            query: url.search,
            headers: options.headers || {},
            body: options.body ? JSON.parse(options.body) : null
        });

        if (url.pathname.endsWith('/rpc/linc_consume_auth_assertion')) {
            return new Response('true', {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }

        if (url.pathname.endsWith('/rest/v1/linc_users') && !options.method) {
            return new Response('[]', {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }

        if (url.pathname.endsWith('/rest/v1/linc_users') && options.method === 'POST') {
            return new Response(null, { status: 204 });
        }

        return new Response(JSON.stringify({ code: 'UNEXPECTED_TEST_REQUEST' }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
        });
    };

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    t.after(async () => {
        global.fetch = nativeFetch;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    const assertion = createAssertion();
    const assertionClaims = JSON.parse(
        Buffer.from(assertion.split('.')[1], 'base64url').toString('utf8')
    );
    const response = await nativeFetch(`${baseUrl}/api/v1/users/register`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-linc-api-key': API_KEY,
            'x-linc-user-assertion': assertion
        },
        body: JSON.stringify({
            userId: USER_ID,
            grade: 'M1',
        })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(body, {
        success: true,
        message: 'User profile registered'
    });

    assert.equal(calls.length, 3);
    assert.match(calls[0].path, /\/rpc\/linc_consume_auth_assertion$/);
    assert.deepEqual(calls[0].body, {
        p_jti: 'test-assertion-id-000001',
        p_expires_at: assertionClaims.exp
    });
    assert.equal(calls[1].method, 'GET');
    assert.match(calls[1].query, /user_id=eq.integration-user-001/);
    assert.equal(calls[2].method, 'POST');
    assert.deepEqual(calls[2].body, {
        user_id: USER_ID,
        grade: 'M1',
        guardian_line_id: null,
        created_at: calls[2].body.created_at,
        last_heartbeat: null,
        status: 'active',
        data: {
            userId: USER_ID,
            grade: 'M1',
            guardianLineId: null,
            createdAt: calls[2].body.created_at,
            status: 'active'
        },
        updated_at: calls[2].body.updated_at
    });
    assert.equal(Number.isSafeInteger(calls[2].body.created_at), true);
    assert.equal(typeof calls[2].body.updated_at, 'string');
    assert.equal(calls[2].headers.apikey, 'sb_secret_test-only-key');
    assert.equal(calls[2].headers.Authorization, undefined);
});

