const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../server');

let server;
let baseUrl;

test.before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
    if (!server) return;
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
});

test('health endpoint returns liveness status without exposing configuration', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'operational');
    assert.equal(body.service, 'linc-tech-ex-backend');
    assert.equal(Object.hasOwn(body, 'env'), false);
    assert.equal(Object.hasOwn(body, 'secrets'), false);
});

test('heartbeat rejects a missing service API key before processing the payload', async () => {
    const previousKey = process.env.LINC_API_KEY;
    delete process.env.LINC_API_KEY;

    try {
        const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId: 'synthetic-user-test' })
        });
        const body = await response.json();

        assert.equal(response.status, 503);
        assert.equal(body.success, false);
        assert.equal(body.message, 'API authentication is not configured');
    } finally {
        if (previousKey === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previousKey;
    }
});

test('heartbeat rejects a wrong service API key before processing the payload', async () => {
    const previousKey = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'expected-test-only-secret';

    try {
        const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': 'incorrect-test-only-secret'
            },
            body: JSON.stringify({ userId: 'synthetic-user-test' })
        });
        const body = await response.json();

        assert.equal(response.status, 401);
        assert.equal(body.success, false);
        assert.equal(body.message, 'Unauthorized connection');
    } finally {
        if (previousKey === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previousKey;
    }
});

test('cron endpoint fails closed when its secret is missing', async () => {
    const previousSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;

    try {
        const response = await fetch(`${baseUrl}/api/cron/check-heartbeats`);
        const body = await response.json();

        assert.equal(response.status, 503);
        assert.equal(body.success, false);
        assert.equal(body.message, 'Cron authentication is not configured');
    } finally {
        if (previousSecret === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previousSecret;
    }
});

test('cron endpoint rejects an incorrect bearer secret', async () => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'expected-cron-test-secret';

    try {
        const response = await fetch(`${baseUrl}/api/cron/check-heartbeats`, {
            headers: { authorization: 'Bearer wrong-cron-test-secret' }
        });
        const body = await response.json();

        assert.equal(response.status, 401);
        assert.equal(body.success, false);
        assert.equal(body.message, 'Unauthorized');
    } finally {
        if (previousSecret === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previousSecret;
    }
});

test('malformed JSON receives a safe JSON 400 response', async () => {
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-linc-api-key': 'not-used-before-body-parse'
        },
        body: '{"userId":'
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, {
        success: false,
        message: 'Invalid JSON request body'
    });
});

test('oversized JSON receives a safe JSON 413 response', async () => {
    const oversizedBody = JSON.stringify({ data: 'x'.repeat(33 * 1024) });
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-linc-api-key': 'not-used-before-body-parse'
        },
        body: oversizedBody
    });
    const body = await response.json();

    assert.equal(response.status, 413);
    assert.deepEqual(body, {
        success: false,
        message: 'Request body too large'
    });
});

test('immediate-delete endpoint rejects missing or incorrect service API keys before processing', async () => {
    const previousKey = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'expected-delete-test-secret';

    try {
        const cases = [
            { name: 'missing key', headers: {} },
            { name: 'incorrect key', headers: { 'x-linc-api-key': 'wrong-delete-test-secret' } }
        ];

        for (const testCase of cases) {
            const response = await fetch(`${baseUrl}/api/v1/alert/delete`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...testCase.headers
                },
                body: JSON.stringify({ userId: 'synthetic-user-must-not-be-mutated' })
            });
            const body = await response.json();

            assert.equal(response.status, 401, testCase.name);
            assert.deepEqual(body, {
                success: false,
                message: 'Unauthorized connection'
            }, testCase.name);
        }
    } finally {
        if (previousKey === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previousKey;
    }
});

test('readiness fails closed when Supabase configuration is missing in a Vercel runtime', async () => {
    const previousUrl = process.env.SUPABASE_URL;
    const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const previousVercel = process.env.VERCEL;
    const previousVercelEnv = process.env.VERCEL_ENV;

    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.VERCEL = '1';
    delete process.env.VERCEL_ENV;

    try {
        const response = await fetch(`${baseUrl}/ready`);
        const body = await response.json();

        assert.equal(response.status, 503);
        assert.deepEqual(body, {
            status: 'not_ready',
            reason: 'database_not_configured'
        });
    } finally {
        if (previousUrl === undefined) delete process.env.SUPABASE_URL;
        else process.env.SUPABASE_URL = previousUrl;
        if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
        if (previousVercel === undefined) delete process.env.VERCEL;
        else process.env.VERCEL = previousVercel;
        if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
        else process.env.VERCEL_ENV = previousVercelEnv;
    }
});

test('heartbeat rejects invalid user identifiers before any database access', async () => {
    const previousKey = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'identifier-validation-test-secret';

    try {
        const cases = [
            { name: 'missing identifier', payload: {} },
            { name: 'non-string identifier', payload: { userId: 123 } },
            { name: 'blank identifier', payload: { userId: '   ' } },
            { name: 'oversized identifier', payload: { userId: 'x'.repeat(129) } }
        ];

        for (const testCase of cases) {
            const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-linc-api-key': 'identifier-validation-test-secret'
                },
                body: JSON.stringify(testCase.payload)
            });
            const body = await response.json();

            assert.equal(response.status, 400, testCase.name);
            assert.equal(body.success, false, testCase.name);
        }
    } finally {
        if (previousKey === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previousKey;
    }
});

test('immediate-delete rejects invalid user identifiers before any database access', async () => {
    const previousKey = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'delete-identifier-test-secret';

    try {
        const cases = [
            { name: 'missing identifier', payload: {} },
            { name: 'non-string identifier', payload: { userId: 123 } },
            { name: 'blank identifier', payload: { userId: '   ' } },
            { name: 'oversized identifier', payload: { userId: 'x'.repeat(129) } }
        ];

        for (const testCase of cases) {
            const response = await fetch(`${baseUrl}/api/v1/alert/delete`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-linc-api-key': 'delete-identifier-test-secret'
                },
                body: JSON.stringify(testCase.payload)
            });
            const body = await response.json();

            assert.equal(response.status, 400, testCase.name);
            assert.equal(body.success, false, testCase.name);
        }
    } finally {
        if (previousKey === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previousKey;
    }
});
