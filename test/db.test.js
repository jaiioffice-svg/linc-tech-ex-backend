const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

test('database adapter rejects noncanonical user IDs before local access or network requests', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        return new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };

    const invalidUserIds = [
        undefined,
        null,
        42,
        '',
        '   ',
        ' padded-user ',
        'u'.repeat(201),
        'user' + String.fromCharCode(1) + 'id'
    ];

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            for (const userId of invalidUserIds) {
                const isInvalidUserId = error =>
                    error instanceof TypeError &&
                    error.message === 'A valid userId is required';

                await assert.rejects(db.getUser(userId), isInvalidUserId);
                await assert.rejects(db.saveUser({ userId, grade: 'M1' }), isInvalidUserId);
                await assert.rejects(db.recordAppTermination(userId), isInvalidUserId);
            }
        });

        assert.equal(fetchCalls, 0, 'invalid identifiers must be rejected before any database request');
    } finally {
        global.fetch = originalFetch;
    }
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

test('Supabase REST request has an abort timeout and normalizes transport failures', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;
    let requestOptions;

    global.fetch = async (_url, options) => {
        requestOptions = options;
        const error = new Error('private transport diagnostic');
        error.name = 'AbortError';
        throw error;
    };

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            await assert.rejects(
                db.getUser('timeout-user'),
                error => {
                    assert.equal(error.code, 'DB_UNAVAILABLE');
                    assert.equal(
                        error.message,
                        'Database service is temporarily unavailable'
                    );
                    assert.equal(
                        error.message.includes('private transport diagnostic'),
                        false
                    );
                    return true;
                }
            );

            assert.ok(requestOptions.signal instanceof AbortSignal);
            assert.equal(requestOptions.signal.aborted, false);
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('invalid successful response JSON is normalized as a database-unavailable error', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;

    global.fetch = async () => new Response(
        'private upstream response body',
        { status: 200, headers: { 'content-type': 'application/json' } }
    );

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            await assert.rejects(
                db.getUser('invalid-json-user'),
                error => {
                    assert.equal(error.code, 'DB_UNAVAILABLE');
                    assert.equal(
                        error.message,
                        'Database response is temporarily unavailable'
                    );
                    assert.equal(
                        error.message.includes('private upstream response body'),
                        false
                    );
                    return true;
                }
            );
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('getUser rejects a successful response with the wrong JSON shape as DB_UNAVAILABLE', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;

    global.fetch = async () => new Response(
        JSON.stringify({ user_id: 'unexpected-object' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    );

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            await assert.rejects(
                db.getUser('shape-user'),
                error => {
                    assert.equal(error.code, 'DB_UNAVAILABLE');
                    assert.equal(
                        error.message,
                        'Database response has an unexpected shape'
                    );
                    return true;
                }
            );

            assert.equal(await db.checkDatabaseConnection(), false);
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('consumeInternalAssertion calls the atomic Supabase RPC with only jti and expiry', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;
    let requestUrl;
    let requestOptions;

    global.fetch = async (url, options) => {
        requestUrl = String(url);
        requestOptions = options;
        return new Response('true', {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            assert.equal(
                await db.consumeInternalAssertion('assertion-id-000001', 1792831500),
                true
            );
            assert.match(requestUrl, /\/rest\/v1\/rpc\/linc_consume_auth_assertion$/);
            assert.equal(requestOptions.method, 'POST');
            assert.equal(requestOptions.headers.Prefer, 'return=representation');
            assert.ok(requestOptions.signal instanceof AbortSignal);
            assert.deepEqual(JSON.parse(requestOptions.body), {
                p_jti: 'assertion-id-000001',
                p_expires_at: 1792831500
            });
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('consumeInternalAssertion returns false when the database reports a replay', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;

    global.fetch = async () => new Response('false', {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            assert.equal(
                await db.consumeInternalAssertion('assertion-id-000001', 1792831500),
                false
            );
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('consumeInternalAssertion fails closed when durable Supabase configuration is missing', async () => {
    const db = require('../db');

    await withEnv({
        VERCEL: undefined,
        VERCEL_ENV: undefined,
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined
    }, async () => {
        await assert.rejects(
            db.consumeInternalAssertion('assertion-id-000001', 1792831500),
            error => error.code === 'DB_NOT_CONFIGURED'
        );
    });
});

test('consumeInternalAssertion rejects a malformed RPC response', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;

    global.fetch = async () => new Response('{"accepted":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            await assert.rejects(
                db.consumeInternalAssertion('assertion-id-000001', 1792831500),
                error => error.code === 'DB_UNAVAILABLE'
            );
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('recordAppTermination calls the atomic Supabase RPC and validates its result', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;
    let requestUrl;
    let requestOptions;
    const expected = {
        found: true,
        alreadyRecorded: false,
        deletedAt: 1792831500000,
        eventId: '7d2c45b6-1f54-4cbb-9f85-41ac69f6a1d2',
        eventStatus: 'blocked',
        guardianLinked: false
    };

    global.fetch = async (url, options) => {
        requestUrl = String(url);
        requestOptions = options;
        return new Response(JSON.stringify(expected), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            assert.deepEqual(await db.recordAppTermination('delete-user'), expected);
            assert.match(
                requestUrl,
                /\/rest\/v1\/rpc\/linc_record_app_termination$/
            );
            assert.equal(requestOptions.method, 'POST');
            assert.deepEqual(JSON.parse(requestOptions.body), {
                p_user_id: 'delete-user'
            });
            assert.ok(requestOptions.signal instanceof AbortSignal);
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('recordAppTermination rejects a pending event backed only by an unverified guardian ID', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;

    global.fetch = async () => new Response(JSON.stringify({
        found: true,
        alreadyRecorded: false,
        deletedAt: 1792831500000,
        eventId: '7d2c45b6-1f54-4cbb-9f85-41ac69f1a1d2',
        eventStatus: 'pending',
        guardianLinked: true
    }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            await assert.rejects(
                db.recordAppTermination('delete-user'),
                error => error.code === 'DB_UNAVAILABLE'
            );
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('recordAppTermination rejects malformed RPC results without exposing upstream data', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;

    global.fetch = async () => new Response(
        JSON.stringify({
            found: true,
            alreadyRecorded: false,
            deletedAt: 1792831500000,
            eventId: '7d2c45b6-1f54-4cbb-9f85-41ac69f6a1d2',
            eventStatus: 'blocked',
            guardianLinked: false,
            recipient_line_id: 'should-not-leak'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    );

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            await assert.rejects(
                db.recordAppTermination('delete-user'),
                error => {
                    assert.equal(error.code, 'DB_UNAVAILABLE');
                    assert.equal(error.message, 'App termination RPC returned an unexpected response');
                    assert.equal(error.message.includes('should-not-leak'), false);
                    return true;
                }
            );
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('saveUser rejects unsupported profile statuses before local or Supabase writes', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        return new Response(null, { status: 204 });
    };

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            for (const status of ['', null, 'pending', 'deleted', 'admin']) {
                await assert.rejects(
                    db.saveUser({ userId: 'status-user', grade: 'M1', status }),
                    error => error instanceof TypeError &&
                        error.message === 'A valid user status is required'
                );
            }
        });

        assert.equal(fetchCalls, 0, 'unsupported status must be rejected before any persistence request');
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

test('local JSON adapter persists the same normalized defaults as Supabase', async () => {
    const originalModule = require.cache[dbPath];
    const envKeys = [
        'LINC_DATA_FILE',
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'VERCEL',
        'VERCEL_ENV'
    ];
    const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linc-local-defaults-'));
    const tempFile = path.join(tempDir, 'linc_data.json');

    try {
        process.env.LINC_DATA_FILE = tempFile;
        delete process.env.SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        delete process.env.VERCEL;
        delete process.env.VERCEL_ENV;
        delete require.cache[dbPath];

        const localDb = require('../db');
        const input = { userId: 'local-defaults-user' };
        assert.equal(await localDb.saveUser(input), input);

        const persisted = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
        const user = persisted.users['local-defaults-user'];
        assert.equal(user.userId, 'local-defaults-user');
        assert.equal(user.grade, 'M1');
        assert.equal(user.status, 'active');
        assert.equal(user.guardianLineId, null);
        assert.equal(user.lastHeartbeat, null);
        assert.equal(Number.isSafeInteger(user.createdAt), true);
        assert.equal(persisted.outbox.length, 0);
    } finally {
        delete require.cache[dbPath];
        if (originalModule) require.cache[dbPath] = originalModule;
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('saveUser normalizes schema defaults before Supabase persistence', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;
    let requestOptions;
    global.fetch = async (_url, options) => {
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
            const input = { userId: 'defaults-user' };
            assert.equal(await db.saveUser(input), input);
        });

        const row = JSON.parse(requestOptions.body);
        assert.equal(row.user_id, 'defaults-user');
        assert.equal(row.grade, 'M1');
        assert.equal(row.guardian_line_id, null);
        assert.equal(row.status, 'active');
        assert.equal(row.last_heartbeat, null);
        assert.equal(Number.isSafeInteger(row.created_at), true);
        assert.equal(row.data.grade, 'M1');
        assert.equal(row.data.guardianLineId, null);
        assert.equal(row.data.status, 'active');
        assert.equal(row.data.lastHeartbeat, null);
        assert.equal(row.data.createdAt, row.created_at);
    } finally {
        global.fetch = originalFetch;
    }
});

test('recordAppTermination rejects an already-recorded RPC response that claims a pending event', async () => {
    const db = require('../db');
    const originalFetch = global.fetch;

    global.fetch = async () => new Response(JSON.stringify({
        found: true,
        alreadyRecorded: true,
        eventId: null,
        eventStatus: 'pending',
        guardianLinked: false
    }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });

    try {
        await withEnv({
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: 'https://example-project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only'
        }, async () => {
            await assert.rejects(
                db.recordAppTermination('delete-user'),
                error => {
                    assert.equal(error.code, 'DB_UNAVAILABLE');
                    assert.equal(error.message, 'App termination RPC returned an unexpected response');
                    return true;
                }
            );
        });
    } finally {
        global.fetch = originalFetch;
    }
});
