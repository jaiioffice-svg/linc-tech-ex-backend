const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

let server;
let baseUrl;
const envKeys = ['LINC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'VERCEL_ENV'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

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

test('heartbeat rejects an empty user identifier before database access', async () => {
    process.env.LINC_API_KEY = 'test-only-key';
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-linc-api-key': 'test-only-key' },
        body: JSON.stringify({ userId: '   ' })
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.message, 'Missing core identifier');
    delete process.env.LINC_API_KEY;
});

test('heartbeat rejects an oversized user identifier before database access', async () => {
    process.env.LINC_API_KEY = 'test-only-key';
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-linc-api-key': 'test-only-key' },
        body: JSON.stringify({ userId: 'u'.repeat(201) })
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid user identifier');
    delete process.env.LINC_API_KEY;
});

test('termination signal rejects an oversized user identifier before database access', async () => {
    process.env.LINC_API_KEY = 'test-only-key';
    const response = await fetch(`${baseUrl}/api/v1/alert/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-linc-api-key': 'test-only-key' },
        body: JSON.stringify({ userId: 'u'.repeat(201) })
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid user identifier');
    delete process.env.LINC_API_KEY;
});


test('registration cannot set guardian identity from an untrusted request body', async () => {
    const originalFetch = global.fetch;
    let savedRow;
    global.fetch = async (url, options = {}) => {
        if (options.method === 'POST') {
            savedRow = JSON.parse(options.body);
            return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify([{
            user_id: 'existing-user',
            grade: 'M1',
            guardian_line_id: null,
            created_at: 123,
            last_heartbeat: null,
            status: 'active',
            data: { userId: 'existing-user', guardianLineId: null, status: 'active' }
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
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
                userId: 'existing-user',
                grade: 'M1',
                guardianLineId: 'attacker-controlled-line-id'
            })
        });
        assert.equal(response.status, 200);
        assert.equal(savedRow.guardian_line_id, null);
        assert.equal(savedRow.data.guardianLineId, null);
    } finally {
        global.fetch = originalFetch;
        for (const key of ['LINC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key];
    }
});

test('heartbeat does not reactivate a profile marked app_deleted', async () => {
    const originalFetch = global.fetch;
    let savedRow;
    global.fetch = async (url, options = {}) => {
        if (options.method === 'POST') {
            savedRow = JSON.parse(options.body);
            return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify([{
            user_id: 'deleted-user',
            grade: 'M1',
            guardian_line_id: null,
            created_at: 123,
            last_heartbeat: null,
            status: 'app_deleted',
            data: { userId: 'deleted-user', guardianLineId: null, status: 'app_deleted' }
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
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
        assert.equal(response.status, 200);
        assert.equal(savedRow.status, 'app_deleted');
        assert.equal(savedRow.data.status, 'app_deleted');
    } finally {
        global.fetch = originalFetch;
        for (const key of ['LINC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key];
    }
});
