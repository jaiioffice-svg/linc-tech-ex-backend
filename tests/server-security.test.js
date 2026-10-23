const test = require('node:test');
const assert = require('node:assert/strict');

const serverPath = require.resolve('../server');

async function withServer(t, callback) {
    const previous = {
        LINC_API_KEY: process.env.LINC_API_KEY,
        CRON_SECRET: process.env.CRON_SECRET,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        VERCEL: process.env.VERCEL,
        VERCEL_ENV: process.env.VERCEL_ENV,
        NODE_ENV: process.env.NODE_ENV
    };

    process.env.LINC_API_KEY = 'test-only-api-key';
    process.env.CRON_SECRET = 'test-only-cron-secret';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'test';

    delete require.cache[serverPath];
    const app = require('../server');
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(async () => {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        delete require.cache[serverPath];
        delete require.cache[require.resolve('../auth')];
        delete require.cache[require.resolve('../controllers')];
        delete require.cache[require.resolve('../db')];
    });

    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
}

test('HTTP API rejects heartbeat and delete requests without a valid API key before database access', async t => {
    await withServer(t, async baseUrl => {
        const heartbeatMissing = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId: 'auth-test-user' })
        });
        assert.equal(heartbeatMissing.status, 401);

        const deleteWrongKey = await fetch(`${baseUrl}/api/v1/alert/delete`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': 'incorrect-test-key'
            },
            body: JSON.stringify({ userId: 'auth-test-user' })
        });
        assert.equal(deleteWrongKey.status, 401);
    });
});

test('heartbeat cron endpoint rejects missing bearer credentials', async t => {
    await withServer(t, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/cron/check-heartbeats`);
        assert.equal(response.status, 401);
    });
});

test('heartbeat cron endpoint rejects an incorrect bearer secret', async t => {
    await withServer(t, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/cron/check-heartbeats`, {
            headers: { authorization: 'Bearer incorrect-test-cron-secret' }
        });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
            success: false,
            message: 'Unauthorized'
        });
    });
});

test('HTTP API rejects malformed JSON before route handlers run', async t => {
    await withServer(t, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': 'test-only-api-key'
            },
            body: '{"userId":'
        });
        assert.equal(response.status, 400);
        assert.match(response.headers.get('content-type') || '', /application\/json/);
        assert.deepEqual(await response.json(), {
            success: false,
            message: 'Invalid JSON request body'
        });
    });
});

test('HTTP API enforces the configured JSON body size limit', async t => {
    await withServer(t, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-linc-api-key': 'test-only-api-key'
            },
            body: JSON.stringify({ userId: 'x'.repeat(40 * 1024) })
        });
        assert.equal(response.status, 413);
        assert.match(response.headers.get('content-type') || '', /application\/json/);
        assert.deepEqual(await response.json(), {
            success: false,
            message: 'Request body too large'
        });
    });
});
