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
