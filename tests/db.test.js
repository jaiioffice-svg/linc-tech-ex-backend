const test = require('node:test');
const assert = require('node:assert/strict');

function loadDb() {
    const dbPath = require.resolve('../db');
    delete require.cache[dbPath];
    return require('../db');
}

function setTestEnvironment(t) {
    const previous = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        VERCEL: process.env.VERCEL,
        VERCEL_ENV: process.env.VERCEL_ENV,
        NODE_ENV: process.env.NODE_ENV
    };
    process.env.SUPABASE_URL = 'https://example-project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder-key';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'test';
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        delete require.cache[require.resolve('../db')];
    });
}

test('getUser maps a Supabase row to the backend user model', async t => {
    setTestEnvironment(t);
    const previousFetch = global.fetch;
    t.after(() => { global.fetch = previousFetch; });
    global.fetch = async url => {
        assert.match(String(url), /linc_users\?user_id=eq\.user-1/);
        return new Response(JSON.stringify([{
            user_id: 'user-1',
            grade: 'M2',
            guardian_line_id: 'guardian-1',
            created_at: '2026-01-01T00:00:00.000Z',
            last_heartbeat: '2026-01-02T00:00:00.000Z',
            status: 'active'
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const user = await loadDb().getUser('user-1');
    assert.equal(user.userId, 'user-1');
    assert.equal(user.grade, 'M2');
    assert.equal(user.guardianLineId, 'guardian-1');
    assert.equal(user.status, 'active');
});

test('saveUser sends the upsert fields and required conflict target', async t => {
    setTestEnvironment(t);
    const previousFetch = global.fetch;
    t.after(() => { global.fetch = previousFetch; });
    let request;
    global.fetch = async (url, options) => {
        request = { url: String(url), options };
        return new Response(null, { status: 204 });
    };
    await loadDb().saveUser({
        userId: 'user-upsert-test',
        grade: 'M1',
        guardianLineId: null,
        createdAt: Date.UTC(2026, 0, 1),
        lastHeartbeat: Date.UTC(2026, 0, 2),
        status: 'active'
    });
    assert.match(request.url, /linc_users\?on_conflict=user_id$/);
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.apikey, 'test-only-placeholder-key');
    assert.match(request.options.headers.Authorization, /^Bearer /);
    assert.match(request.options.headers.Prefer, /resolution=merge-duplicates/);
    const row = JSON.parse(request.options.body);
    assert.equal(row.user_id, 'user-upsert-test');
    assert.equal(row.status, 'active');
    assert.equal(row.created_at, Date.UTC(2026, 0, 1));
    assert.equal(row.last_heartbeat, Date.UTC(2026, 0, 2));
    assert.equal(typeof row.updated_at, 'string');
});

test('getStaleActiveUsers queries active rows older than the cutoff', async t => {
    setTestEnvironment(t);
    const previousFetch = global.fetch;
    t.after(() => { global.fetch = previousFetch; });
    let requestedUrl = '';
    global.fetch = async url => {
        requestedUrl = String(url);
        return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };
    const cutoff = Date.UTC(2026, 0, 3);
    const users = await loadDb().getStaleActiveUsers(cutoff);
    assert.deepEqual(users, []);
    assert.match(requestedUrl, /status=eq\.active/);
    assert.match(requestedUrl, /last_heartbeat=lt\./);
});

test('database diagnostic messages remove control characters and preserve safe error codes', async t => {
    setTestEnvironment(t);
    const previousFetch = global.fetch;
    t.after(() => { global.fetch = previousFetch; });
    global.fetch = async () => new Response(JSON.stringify({
        code: '42501',
        message: 'permission denied\\n\\tfor table access'
    }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
    });

    await assert.rejects(
        loadDb().getUser('diagnostic-test-user'),
        error => {
            assert.equal(error.code, 'DB_PERMISSION_DENIED');
            assert.equal(error.supabaseCode, '42501');
            assert.equal(error.supabaseMessage, 'permission denied for table access');
            assert.doesNotMatch(error.supabaseMessage, /[\\r\\n\\t]/);
            return true;
        }
    );
});
