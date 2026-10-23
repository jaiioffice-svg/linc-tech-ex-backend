const test = require('node:test');
const assert = require('node:assert/strict');
const { isDatabaseConfigured, hasSupabaseConfig } = require('../db');

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
