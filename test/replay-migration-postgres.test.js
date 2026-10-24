const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('replay migration executes in embedded PostgreSQL and enforces one-time use and grants', async () => {
    const database = new PGlite();

    try {
        await database.exec(
            'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'
        );

        const migrationPath = path.join(
            __dirname,
            '..',
            'supabase',
            'migrations',
            '20261024_003_auth_assertion_replay.sql'
        );
        await database.exec(fs.readFileSync(migrationPath, 'utf8'));

        const now = Math.floor(Date.now() / 1000);
        const jti = 'postgres-replay-test-000001';

        const first = await database.query(
            'SELECT public.linc_consume_auth_assertion($1, $2) AS accepted',
            [jti, now + 45]
        );
        const replay = await database.query(
            'SELECT public.linc_consume_auth_assertion($1, $2) AS accepted',
            [jti, now + 45]
        );

        assert.equal(first.rows[0].accepted, true, 'first use should be consumed');
        assert.equal(replay.rows[0].accepted, false, 'replay must not be consumed');

        await assert.rejects(
            database.query(
                'SELECT public.linc_consume_auth_assertion($1, $2)',
                ['postgres-replay-test-000002', now - 1]
            ),
            error => error.code === '22023'
        );

        await database.query(
            'INSERT INTO public.linc_auth_assertion_replays (jti, expires_at) VALUES ($1, $2)',
            ['expired-replay-test-000003', now - 1]
        );
        const next = await database.query(
            'SELECT public.linc_consume_auth_assertion($1, $2) AS accepted',
            ['fresh-replay-test-000004', now + 45]
        );
        const expiredRows = await database.query(
            'SELECT jti FROM public.linc_auth_assertion_replays WHERE jti = $1',
            ['expired-replay-test-000003']
        );
        assert.equal(next.rows[0].accepted, true);
        assert.equal(expiredRows.rows.length, 0, 'expired records should be pruned');

        await database.exec('SET ROLE anon');
        await assert.rejects(
            database.query('SELECT * FROM public.linc_auth_assertion_replays'),
            error => error.code === '42501'
        );
        await assert.rejects(
            database.query(
                'SELECT public.linc_consume_auth_assertion($1, $2)',
                ['anon-cannot-consume-000005', now + 45]
            ),
            error => error.code === '42501'
        );
        await database.exec('RESET ROLE');

        await database.exec('SET ROLE service_role');
        const serviceCall = await database.query(
            'SELECT public.linc_consume_auth_assertion($1, $2) AS accepted',
            ['service-role-test-000006', now + 45]
        );
        await database.exec('RESET ROLE');

        assert.equal(serviceCall.rows[0].accepted, true);
        const metadata = await database.query(
            "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.linc_auth_assertion_replays'::regclass"
        );
        assert.equal(metadata.rows[0].relrowsecurity, true);
    } finally {
        await database.close();
    }
});

test('concurrent consumes for the same JTI accept exactly one request', async () => {
    const database = new PGlite();

    try {
        await database.exec(
            'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'
        );
        const migrationPath = path.join(
            __dirname,
            '..',
            'supabase',
            'migrations',
            '20261024_003_auth_assertion_replay.sql'
        );
        await database.exec(fs.readFileSync(migrationPath, 'utf8'));

        const now = Math.floor(Date.now() / 1000);
        const jti = 'concurrent-replay-test-0001';
        const attempts = await Promise.all(
            Array.from({ length: 12 }, () => database.query(
                'SELECT public.linc_consume_auth_assertion($1, $2) AS accepted',
                [jti, now + 45]
            ))
        );
        const acceptedCount = attempts.filter(result => result.rows[0].accepted === true).length;
        const rejectedCount = attempts.filter(result => result.rows[0].accepted === false).length;

        assert.equal(acceptedCount, 1, 'exactly one concurrent consume may succeed');
        assert.equal(rejectedCount, 11, 'all duplicate concurrent consumes must be rejected');
        const stored = await database.query(
            'SELECT count(*)::int AS count FROM public.linc_auth_assertion_replays WHERE jti = $1',
            [jti]
        );
        assert.equal(stored.rows[0].count, 1);
    } finally {
        await database.close();
    }
});

test('replay RPC rejects malformed IDs and invalid expiry boundaries', async () => {
    const database = new PGlite();

    try {
        await database.exec(
            'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'
        );
        const migrationPath = path.join(
            __dirname,
            '..',
            'supabase',
            'migrations',
            '20261024_003_auth_assertion_replay.sql'
        );
        await database.exec(fs.readFileSync(migrationPath, 'utf8'));

        const now = Math.floor(Date.now() / 1000);
        const invalidCases = [
            [null, now + 30],
            ['too-short', now + 30],
            ['contains whitespace', now + 30],
            ['x'.repeat(129), now + 30],
            ['valid-jti-but-null-exp', null],
            ['expired-jti-test-0001', now - 60],
            ['too-far-future-jti-0001', now + 120]
        ];

        for (const [jti, expiresAt] of invalidCases) {
            await assert.rejects(
                database.query(
                    'SELECT public.linc_consume_auth_assertion($1, $2)',
                    [jti, expiresAt]
                ),
                error => error && error.code === '22023'
            );
        }

        const rows = await database.query(
            'SELECT count(*)::int AS count FROM public.linc_auth_assertion_replays'
        );
        assert.equal(rows.rows[0].count, 0, 'invalid assertion records must not be stored');
    } finally {
        await database.close();
    }
});
