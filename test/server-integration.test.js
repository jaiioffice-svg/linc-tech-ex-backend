const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const ENV_KEYS = [
    'LINC_ALLOWED_ORIGINS',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VERCEL',
    'VERCEL_ENV'
];
const originalEnv = Object.fromEntries(
    ENV_KEYS.map(key => [key, process.env[key]])
);

// Force the readiness tests to use a known, non-production configuration.
process.env.LINC_ALLOWED_ORIGINS = 'https://app.example.test';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'preview';

const app = require('../server');
const server = http.createServer(app);

let baseUrl;

test('HTTP server integration contracts', async t => {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;

    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    await t.test('health endpoint remains available without database credentials', async () => {
        const response = await fetch(`${baseUrl}/health`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.status, 'operational');
        assert.equal(typeof body.timestamp, 'number');
    });

    await t.test('readiness fails closed when deployed without Supabase configuration', async () => {
        const response = await fetch(`${baseUrl}/ready`);
        const body = await response.json();

        assert.equal(response.status, 503);
        assert.deepEqual(body, {
            status: 'not_ready',
            reason: 'database_not_configured'
        });
    });

    await t.test('malformed JSON receives the stable INVALID_JSON contract', async () => {
        const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"userId":'
        });
        const body = await response.json();

        assert.equal(response.status, 400);
        assert.deepEqual(body, {
            success: false,
            code: 'INVALID_JSON',
            message: 'Malformed JSON request body'
        });
    });

    await t.test('oversized request bodies are rejected before route handlers', async () => {
        const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ payload: 'x'.repeat(70 * 1024) })
        });
        const body = await response.json();

        assert.equal(response.status, 413);
        assert.deepEqual(body, {
            success: false,
            code: 'REQUEST_TOO_LARGE',
            message: 'Request body exceeds the allowed limit'
        });
    });

    await t.test('unknown routes return a stable JSON 404 response', async () => {
        const response = await fetch(`${baseUrl}/route-that-does-not-exist`);
        const body = await response.json();

        assert.equal(response.status, 404);
        assert.deepEqual(body, {
            success: false,
            code: 'ROUTE_NOT_FOUND',
            message: 'The requested route was not found'
        });
    });


    await t.test('security headers are present and Express fingerprinting is absent', async () => {
        const response = await fetch(`${baseUrl}/health`);

        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        assert.equal(response.headers.get('x-powered-by'), null);
    });


    await t.test('CORS preflight supports the protected BFF request headers only for an allowed origin', async () => {
        const preflightHeaders = {
            origin: 'https://app.example.test',
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type,x-linc-api-key,x-linc-user-assertion'
        };
        const allowed = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'OPTIONS',
            headers: preflightHeaders
        });
        const denied = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'OPTIONS',
            headers: {
                ...preflightHeaders,
                origin: 'https://untrusted.example.test'
            }
        });

        assert.equal(allowed.status, 204);
        assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.test');
        assert.equal(allowed.headers.get('access-control-allow-methods').includes('POST'), true);
        const allowedHeaders = allowed.headers.get('access-control-allow-headers') || '';
        for (const header of ['content-type', 'x-linc-api-key', 'x-linc-user-assertion']) {
            assert.equal(allowedHeaders.toLowerCase().includes(header), true);
        }
        assert.equal(denied.headers.get('access-control-allow-origin'), null);
    });

    await t.test('CORS allows only explicitly configured origins', async () => {
        const allowed = await fetch(`${baseUrl}/health`, {
            headers: { origin: 'https://app.example.test' }
        });
        const denied = await fetch(`${baseUrl}/health`, {
            headers: { origin: 'https://untrusted.example.test' }
        });

        assert.equal(allowed.status, 200);
        assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.test');
        assert.equal(denied.status, 200);
        assert.equal(denied.headers.get('access-control-allow-origin'), null);
    });
});
