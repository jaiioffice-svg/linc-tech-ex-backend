const test = require('node:test');
const assert = require('node:assert/strict');
const { isDatabaseConfigured, hasSupabaseConfig, checkDatabaseConnection, classifyDatabaseFailure } = require('../db');

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

async function withEnvAsync(values, callback) {
    const keys = Object.keys(values);
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return await callback();
    } finally {
        for (const key of keys) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    }
}

test('Supabase header builder allows only safe Prefer extension headers', () => {
    const { buildSupabaseHeaders } = require('../db');

    const secretHeaders = buildSupabaseHeaders('sb_secret_server_key', {
        apikey: 'attacker-key',
        APIKEY: 'another-attacker-key',
        Authorization: 'Bearer attacker-token',
        authorization: 'Bearer second-attacker-token',
        'Content-Type': 'text/plain',
        'cOnTeNt-TyPe': 'application/x-www-form-urlencoded',
        Prefer: 'return=representation',
        'X-Injected-Header': 'attacker-controlled',
        Host: 'attacker.example',
        Cookie: 'session=attacker-controlled'
    });

    assert.equal(secretHeaders.apikey, 'sb_secret_server_key');
    assert.equal(Object.hasOwn(secretHeaders, 'APIKEY'), false);
    assert.equal(Object.hasOwn(secretHeaders, 'Authorization'), false);
    assert.equal(Object.hasOwn(secretHeaders, 'authorization'), false);
    assert.equal(secretHeaders['Content-Type'], 'application/json');
    assert.equal(secretHeaders.Prefer, 'return=representation');
    assert.equal(Object.hasOwn(secretHeaders, 'X-Injected-Header'), false);
    assert.equal(Object.hasOwn(secretHeaders, 'Host'), false);
    assert.equal(Object.hasOwn(secretHeaders, 'Cookie'), false);

    const legacyHeaders = buildSupabaseHeaders('legacy-service-jwt-that-is-not-sb-secret', {
        authorization: 'Bearer attacker-token',
        pReFeR: 'resolution=merge-duplicates,return=minimal'
    });
    assert.equal(
        legacyHeaders.Authorization,
        'Bearer legacy-service-jwt-that-is-not-sb-secret'
    );
    assert.equal(legacyHeaders.Prefer, 'resolution=merge-duplicates,return=minimal');

    const invalidExtensionHeaders = buildSupabaseHeaders('sb_secret_server_key', {
        Prefer: 'return=representation' + String.fromCharCode(10),
        'X-Injected-Header': 'should-not-pass'
    });
    assert.equal(Object.hasOwn(invalidExtensionHeaders, 'Prefer'), false);
    assert.equal(Object.hasOwn(invalidExtensionHeaders, 'X-Injected-Header'), false);
});

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


test('Supabase config fails closed on blank and whitespace-padded environment values', async () => {
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };

    try {
        const invalidConfigs = [
            { SUPABASE_URL: '   ', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only_key' },
            { SUPABASE_URL: ' https://example-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only_key' },
            { SUPABASE_URL: 'https://example-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: ' sb_secret_test_only_key' },
            { SUPABASE_URL: 'https://example-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only_key' + String.fromCharCode(10) },
        ];

        for (const values of invalidConfigs) {
            await withEnvAsync({
                ...values,
                VERCEL: '1',
                VERCEL_ENV: 'preview'
            }, async () => {
                assert.equal(hasSupabaseConfig(), false);
                assert.equal(isDatabaseConfigured(), false);
                assert.equal(await checkDatabaseConnection(), false);
            });
        }
        assert.equal(fetchCalls, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test('Vercel rejects unsafe Supabase endpoint URLs before sending service credentials', async () => {
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };

    try {
        const invalidUrls = [
            'http://example-project.supabase.co',
            'https://attacker.example',
            'https://user:password@example-project.supabase.co',
            'https://example-project.supabase.co?token=unexpected',
            'https://example-project.supabase.co/unexpected-path',
            'https://example-project.supabase.co/rest/v2',
            'https://example-project.supabase.co:8443'
        ];

        for (const url of invalidUrls) {
            await withEnvAsync({
                SUPABASE_URL: url,
                SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only_key',
                VERCEL: '1',
                VERCEL_ENV: 'preview'
            }, async () => {
                assert.equal(isDatabaseConfigured(), false, `URL should be rejected: ${url}`);
                await assert.rejects(
                    checkDatabaseConnection(),
                    error => error && error.code === 'DB_NOT_CONFIGURED'
                );
            });
        }

        assert.equal(fetchCalls, 0, 'invalid endpoints must be rejected before fetch receives the service key');
    } finally {
        global.fetch = originalFetch;
    }
});

test('Vercel accepts standard Supabase project URLs with an optional /rest/v1 suffix', async () => {
    const originalFetch = global.fetch;
    let requestedUrl = '';
    let capturedOptions;

    global.fetch = async (url, options) => {
        requestedUrl = String(url);
        capturedOptions = options;
        return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };

    try {
        await withEnvAsync({
            SUPABASE_URL: 'https://example-project.supabase.co/rest/v1',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only_key',
            VERCEL: '1',
            VERCEL_ENV: 'preview'
        }, async () => {
            assert.equal(isDatabaseConfigured(), true);
            assert.equal(await checkDatabaseConnection(), true);
        });

        assert.equal(
            requestedUrl,
            'https://example-project.supabase.co/rest/v1/linc_users?select=user_id&limit=1'
        );
        assert.equal(capturedOptions.redirect, 'error', 'authenticated requests must never follow redirects');
    } finally {
        global.fetch = originalFetch;
    }
});


test('local development allows HTTP only for loopback Supabase endpoints', async () => {
    const originalFetch = global.fetch;
    let capturedUrl = '';
    global.fetch = async url => {
        capturedUrl = String(url);
        return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };

    try {
        await withEnvAsync({
            SUPABASE_URL: 'http://127.0.0.1:54321/rest/v1',
            SUPABASE_SERVICE_ROLE_KEY: 'local-test-only-key',
            VERCEL: undefined,
            VERCEL_ENV: undefined
        }, async () => {
            assert.equal(isDatabaseConfigured(), true);
            assert.equal(await checkDatabaseConnection(), true);
        });
        assert.equal(capturedUrl, 'http://127.0.0.1:54321/rest/v1/linc_users?select=user_id&limit=1');

        await withEnvAsync({
            SUPABASE_URL: 'http://attacker.example',
            SUPABASE_SERVICE_ROLE_KEY: 'local-test-only-key',
            VERCEL: undefined,
            VERCEL_ENV: undefined
        }, async () => {
            assert.equal(isDatabaseConfigured(), false);
            await assert.rejects(checkDatabaseConnection(), error => error && error.code === 'DB_NOT_CONFIGURED');
        });
    } finally {
        global.fetch = originalFetch;
    }
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
        assert.equal(capturedOptions.redirect, 'error', 'authenticated requests must reject redirects by default');
    } finally {
        global.fetch = previousFetch;
        for (const [key, value] of Object.entries(previousEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});


test('getUser strictly encodes punctuation in untrusted PostgREST filter values', async () => {
    const previousEnv = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        VERCEL: process.env.VERCEL,
        VERCEL_ENV: process.env.VERCEL_ENV
    };
    const previousFetch = global.fetch;
    let requestedUrl = '';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test-only';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    global.fetch = async url => {
        requestedUrl = String(url);
        return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };

    try {
        const { getUser } = require('../db');
        await getUser("attacker')or(status.eq.active");
        assert.ok(requestedUrl.includes("%27%29or%28status.eq.active"), 'apostrophes and parentheses must be percent-encoded');
        assert.equal(requestedUrl.includes("attacker')or("), false, 'raw injection-like punctuation must not appear in the URL');
    } finally {
        global.fetch = previousFetch;
        for (const [key, value] of Object.entries(previousEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
