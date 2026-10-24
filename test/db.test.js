const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const dbPath = require.resolve('../db');

async function withEnv(values, callback) {
    const previous = {};
    for (const [key, value] of Object.entries(values)) {
        previous[key] = process.env[key];
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

test('module can load on Vercel without writing to the deployment filesystem', async () => {
    const originalWriteFileSync = fs.writeFileSync;
    delete require.cache[dbPath];
    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: undefined,
            SUPABASE_SERVICE_ROLE_KEY: undefined
        }, () => {
            fs.writeFileSync = () => {
                throw new Error('deployment filesystem is read-only');
            };
            assert.doesNotThrow(() => require('../db'));
        });
    } finally {
        fs.writeFileSync = originalWriteFileSync;
        delete require.cache[dbPath];
    }
});

test('database fails closed on Vercel when Supabase is not configured', async () => {
    const db = require('../db');
    await withEnv({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined
    }, async () => {
        assert.equal(db.isDatabaseConfigured(), false);
        await assert.rejects(db.getUser('test-user'), error => error.code === 'DB_NOT_CONFIGURED');
    });
});

test('getUser reads a profile from Supabase REST', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;
    let requestUrl;
    let requestOptions;
    global.fetch = async (url, options) => {
        requestUrl = String(url);
        requestOptions = options;
        return new Response(JSON.stringify([{
            user_id: 'test-user',
            grade: 'M2',
            guardian_line_id: null,
            created_at: 123,
            last_heartbeat: null,
            status: 'active',
            data: { userId: 'test-user', nickname: 'Preview Test', guardianLineId: 'stale-untrusted-guardian', status: 'app_deleted' }
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            const user = await db.getUser('test-user');
            assert.equal(user.userId, 'test-user');
            assert.equal(user.grade, 'M2');
            assert.equal(user.nickname, 'Preview Test');
            assert.equal(user.guardianLineId, null);
            assert.equal(user.status, 'app_deleted');
            assert.match(requestUrl, /\/rest\/v1\/linc_users\?/);
            assert.equal(requestOptions.method, undefined);
            assert.equal(requestOptions.headers.apikey, 'sb_secret_test_only');
            assert.equal(requestOptions.headers.Authorization, undefined);
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('saveUser persists a profile using a Supabase upsert', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;
    let requestUrl;
    let requestOptions;
    global.fetch = async (url, options) => {
        requestUrl = String(url);
        requestOptions = options;
        return new Response(null, { status: 204 });
    };
    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            const user = {
                userId: 'test-user',
                grade: 'M1',
                guardianLineId: null,
                createdAt: 123,
                status: 'active'
            };
            assert.equal(await db.saveUser(user), user);
            assert.match(requestUrl, /\/rest\/v1\/linc_users\?on_conflict=user_id$/);
            assert.equal(requestOptions.method, 'POST');
            assert.match(requestOptions.headers.Prefer, /resolution=merge-duplicates/);
            const row = JSON.parse(requestOptions.body);
            assert.equal(row.user_id, 'test-user');
            assert.equal(row.data.userId, 'test-user');
        });
    } finally {
        global.fetch = originalFetch;
    }
});
