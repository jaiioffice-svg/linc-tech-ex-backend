const test = require('node:test');
const assert = require('node:assert/strict');
const { isDatabaseConfigured, hasSupabaseConfig, classifyDatabaseFailure } = require('../db');

function withEnv(values, callback) {
    const keys = Object.keys(values);
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try { callback(); }
    finally {
        for (const key of keys) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    }
}

test('Supabase config requires both URL and service key', () => {
    withEnv({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: undefined }, () => {
        assert.equal(hasSupabaseConfig(), false);
    });
    withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: 'test-only-key' }, () => {
        assert.equal(hasSupabaseConfig(), false);
    });
    withEnv({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only-key' }, () => {
        assert.equal(hasSupabaseConfig(), true);
    });
});

test('local development can use local storage when Supabase is not configured', () => {
    withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, VERCEL: undefined, VERCEL_ENV: undefined }, () => {
        assert.equal(isDatabaseConfigured(), true);
    });
});

test('Vercel deployment is not ready without Supabase config', () => {
    withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, VERCEL: '1', VERCEL_ENV: 'preview' }, () => {
        assert.equal(isDatabaseConfigured(), false);
    });
});

test('classifies safe database readiness diagnostics', () => {
    assert.equal(classifyDatabaseFailure({ upstreamCode: 'PGRST125', status: 404 }), 'invalid_rest_url');
    assert.equal(classifyDatabaseFailure({ upstreamCode: 'PGRST205', status: 404 }), 'table_missing');
    assert.equal(classifyDatabaseFailure({ upstreamCode: '42P01', status: 404 }), 'table_missing');
    assert.equal(classifyDatabaseFailure({ upstreamCode: '42501', status: 401 }), 'database_permission_denied');
    assert.equal(classifyDatabaseFailure({ status: 403 }), 'database_auth_failed');
    assert.equal(classifyDatabaseFailure({ status: 500 }), 'database_unavailable');
});

test('new Supabase secret API keys are sent as apikey, not as a Bearer JWT', async () => {
    const previousEnv = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
    };
    const previousFetch = global.fetch;
    let capturedOptions;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test-only';
    global.fetch = async (_url, options) => {
        capturedOptions = options;
        return { ok: true, text: async () => '[]' };
    };

    try {
        const { checkDatabaseConnection } = require('../db');
        assert.equal(await checkDatabaseConnection(), true);
        assert.equal(capturedOptions.headers.apikey, 'sb_secret_test-only');
        assert.equal(Object.hasOwn(capturedOptions.headers, 'Authorization'), false);
    } finally {
        global.fetch = previousFetch;
        for (const [key, value] of Object.entries(previousEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
