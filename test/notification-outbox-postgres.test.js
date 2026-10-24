const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

async function applyMigrations(database) {
    await database.exec(
        'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'
    );

    // Execute the complete Candidate migration chain in chronological order.
    // This catches conflicts between historical repair migrations and the
    // newer replay-protection/outbox migrations before any real project is touched.
    for (const filename of [
        '20261022_002_linc_core.sql',
        '20261022_003_defer_heartbeat.sql',
        '20261023_004_repair_service_role_grants.sql',
        '20261024_003_auth_assertion_replay.sql',
        '20261024_004_notification_outbox.sql',
        '20261024_005_outbox_fail_closed_default.sql'
    ]) {
        const fullPath = path.join(__dirname, '..', 'supabase', 'migrations', filename);
        await database.exec(fs.readFileSync(fullPath, 'utf8'));
    }
}

async function seedUser(database, userId, guardianLineId = null) {
    await database.query(
        'INSERT INTO public.linc_users (user_id, grade, guardian_line_id, created_at, status, data) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
        [userId, 'M1', guardianLineId, Date.now(), 'active', JSON.stringify({ status: 'active' })]
    );
}

async function record(database, userId) {
    const result = await database.query(
        'SELECT public.linc_record_app_termination($1) AS result',
        [userId]
    );
    const value = result.rows[0].result;
    return typeof value === 'string' ? JSON.parse(value) : value;
}

test('outbox blocks legacy guardian IDs until verified pairing and consent exist', async () => {
    const database = new PGlite();

    try {
        await applyMigrations(database);
        await seedUser(database, 'linked-user', 'legacy-field-line-id');

        const first = await record(database, 'linked-user');
        assert.equal(first.found, true);
        assert.equal(first.alreadyRecorded, false);
        assert.equal(first.guardianLinked, false);
        assert.equal(first.eventStatus, 'blocked');
        assert.match(first.eventId, /^[0-9a-f-]{36}$/i);
        assert.ok(Number.isSafeInteger(first.deletedAt));

        const user = await database.query(
            'SELECT status, data->>\'status\' AS data_status, (data->>\'deletedAt\')::bigint AS deleted_at FROM public.linc_users WHERE user_id = $1',
            ['linked-user']
        );
        assert.equal(user.rows[0].status, 'app_deleted');
        assert.equal(user.rows[0].data_status, 'app_deleted');
        assert.equal(Number(user.rows[0].deleted_at), first.deletedAt);

        const events = await database.query(
            'SELECT user_id, recipient_line_id, event_type, event_status, attempts, payload->>\'reason\' AS reason FROM public.linc_notification_outbox WHERE user_id = $1',
            ['linked-user']
        );
        assert.equal(events.rows.length, 1);
        assert.equal(events.rows[0].user_id, 'linked-user');
        assert.equal(events.rows[0].recipient_line_id, null, 'legacy guardian fields must never become recipients');
        assert.equal(events.rows[0].event_type, 'APP_TERMINATION_SIGNAL');
        assert.equal(events.rows[0].event_status, 'blocked');
        assert.equal(events.rows[0].attempts, 0);
        assert.equal(events.rows[0].reason, 'APP_TERMINATION_SIGNAL');

        const repeated = await record(database, 'linked-user');
        assert.equal(repeated.found, true);
        assert.equal(repeated.alreadyRecorded, true);
        assert.equal(repeated.eventId, null);

        const count = await database.query(
            'SELECT count(*)::int AS count FROM public.linc_notification_outbox WHERE user_id = $1',
            ['linked-user']
        );
        assert.equal(count.rows[0].count, 1, 'retry must not create another alert event');
    } finally {
        await database.close();
    }
});

test('outbox records a blocked event when a guardian is not linked and does not invent a recipient', async () => {
    const database = new PGlite();

    try {
        await applyMigrations(database);
        await seedUser(database, 'unlinked-user', null);

        const result = await record(database, 'unlinked-user');
        assert.equal(result.found, true);
        assert.equal(result.alreadyRecorded, false);
        assert.equal(result.guardianLinked, false);
        assert.equal(result.eventStatus, 'blocked');

        const row = await database.query(
            'SELECT recipient_line_id, event_status FROM public.linc_notification_outbox WHERE user_id = $1',
            ['unlinked-user']
        );
        assert.equal(row.rows.length, 1);
        assert.equal(row.rows[0].recipient_line_id, null);
        assert.equal(row.rows[0].event_status, 'blocked');
    } finally {
        await database.close();
    }
});


test('outbox defaults to blocked and database constraints prevent status-recipient contradictions', async () => {
    const database = new PGlite();

    try {
        await applyMigrations(database);
        await seedUser(database, 'constraint-user', null);

        await database.query(
            "INSERT INTO public.linc_notification_outbox (user_id, event_type) VALUES ($1, 'APP_TERMINATION_SIGNAL')",
            ['constraint-user']
        );
        const defaulted = await database.query(
            'SELECT recipient_line_id, event_status FROM public.linc_notification_outbox WHERE user_id = $1',
            ['constraint-user']
        );
        assert.equal(defaulted.rows[0].event_status, 'blocked');
        assert.equal(defaulted.rows[0].recipient_line_id, null);

        await assert.rejects(
            database.query(
                "INSERT INTO public.linc_notification_outbox (user_id, event_type, event_status, recipient_line_id) VALUES ($1, 'APP_TERMINATION_SIGNAL', 'pending', NULL)",
                ['constraint-user']
            ),
            error => error && error.code === '23514'
        );

        await assert.rejects(
            database.query(
                "INSERT INTO public.linc_notification_outbox (user_id, event_type, event_status, recipient_line_id) VALUES ($1, 'APP_TERMINATION_SIGNAL', 'blocked', 'unverified-line-id')",
                ['constraint-user']
            ),
            error => error && error.code === '23514'
        );

        await database.query(
            "INSERT INTO public.linc_notification_outbox (user_id, event_type, event_status, recipient_line_id) VALUES ($1, 'APP_TERMINATION_SIGNAL', 'pending', 'verified-test-recipient')",
            ['constraint-user']
        );
        const validPending = await database.query(
            "SELECT event_status, recipient_line_id FROM public.linc_notification_outbox WHERE user_id = $1 AND event_status = 'pending'",
            ['constraint-user']
        );
        assert.equal(validPending.rows.length, 1);
        assert.equal(validPending.rows[0].recipient_line_id, 'verified-test-recipient');
    } finally {
        await database.close();
    }
});

test('outbox reports a missing profile without mutating user or outbox data', async () => {
    const database = new PGlite();

    try {
        await applyMigrations(database);
        const result = await record(database, 'does-not-exist');
        assert.deepEqual(result, {
            found: false,
            alreadyRecorded: false,
            eventId: null,
            eventStatus: null,
            guardianLinked: false
        });

        const count = await database.query(
            'SELECT count(*)::int AS count FROM public.linc_notification_outbox'
        );
        assert.equal(count.rows[0].count, 0);
    } finally {
        await database.close();
    }
});


test('termination RPC rejects blank, padded, and oversized user IDs', async () => {
    const database = new PGlite();

    try {
        await applyMigrations(database);
        for (const userId of ['', '   ', ' padded-user ', '\tpadded-user\t', '\npadded-user\n', 'u'.repeat(201)]) {
            await assert.rejects(
                record(database, userId),
                error => error && error.code === '22023'
            );
        }

        const count = await database.query(
            'SELECT count(*)::int AS count FROM public.linc_notification_outbox'
        );
        assert.equal(count.rows[0].count, 0);
    } finally {
        await database.close();
    }
});


test('fail-closed outbox migration safely upgrades legacy pending events without recipients', async () => {
    const database = new PGlite();

    try {
        await applyMigrations(database);
        await seedUser(database, 'legacy-outbox-user', 'legacy-line-id');

        // Simulate a previously installed schema that predates the new
        // recipient/status constraint and still defaults omitted status to pending.
        await database.exec(`
            ALTER TABLE public.linc_notification_outbox
                DROP CONSTRAINT linc_notification_outbox_recipient_status_check;
            ALTER TABLE public.linc_notification_outbox
                ALTER COLUMN event_status SET DEFAULT 'pending';
        `);
        await database.query(
            "INSERT INTO public.linc_notification_outbox (user_id, event_type, event_status, recipient_line_id) VALUES ($1, 'APP_TERMINATION_SIGNAL', 'pending', NULL)",
            ['legacy-outbox-user']
        );
        await database.query(
            "INSERT INTO public.linc_notification_outbox (user_id, event_type, event_status, recipient_line_id) VALUES ($1, 'APP_TERMINATION_SIGNAL', 'blocked', 'legacy-line-id')",
            ['legacy-outbox-user']
        );

        const migration = fs.readFileSync(
            path.join(__dirname, '..', 'supabase', 'migrations', '20261024_005_outbox_fail_closed_default.sql'),
            'utf8'
        );
        await database.exec(migration);
        // Re-running is safe and proves the constraint/default migration is idempotent.
        await database.exec(migration);

        const rows = await database.query(
            'SELECT event_status, recipient_line_id FROM public.linc_notification_outbox WHERE user_id = $1 ORDER BY created_at, event_id',
            ['legacy-outbox-user']
        );
        assert.equal(rows.rows.length, 2);
        for (const row of rows.rows) {
            assert.equal(row.event_status, 'blocked');
            assert.equal(row.recipient_line_id, null);
        }

        const metadata = await database.query(
            "SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'linc_notification_outbox' AND column_name = 'event_status'"
        );
        assert.match(metadata.rows[0].column_default, /blocked/);

        await assert.rejects(
            database.query(
                "INSERT INTO public.linc_notification_outbox (user_id, event_type, event_status, recipient_line_id) VALUES ($1, 'APP_TERMINATION_SIGNAL', 'pending', NULL)",
                ['legacy-outbox-user']
            ),
            error => error && error.code === '23514'
        );
    } finally {
        await database.close();
    }
});

test('outbox insert failure rolls back the app_deleted status change', async () => {
    const database = new PGlite();

    try {
        await applyMigrations(database);
        await seedUser(database, 'rollback-user', 'rollback-line-id');

        await database.exec(`
            CREATE OR REPLACE FUNCTION public.test_fail_outbox_insert()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                RAISE EXCEPTION 'test-only simulated outbox failure';
            END;
            $$;

            CREATE TRIGGER test_fail_outbox_insert
            BEFORE INSERT ON public.linc_notification_outbox
            FOR EACH ROW EXECUTE FUNCTION public.test_fail_outbox_insert();
        `);

        await assert.rejects(
            record(database, 'rollback-user'),
            /test-only simulated outbox failure/
        );

        const user = await database.query(
            'SELECT status, data->>\'status\' AS data_status FROM public.linc_users WHERE user_id = $1',
            ['rollback-user']
        );
        assert.equal(user.rows[0].status, 'active');
        assert.equal(user.rows[0].data_status, 'active');

        const count = await database.query(
            'SELECT count(*)::int AS count FROM public.linc_notification_outbox WHERE user_id = $1',
            ['rollback-user']
        );
        assert.equal(count.rows[0].count, 0);
    } finally {
        await database.close();
    }
});

test('only service_role can read the outbox and execute the termination RPC', async () => {
    const database = new PGlite();

    try {
        await applyMigrations(database);
        await seedUser(database, 'permission-user', 'permission-line-id');

        const anonMetadata = await database.query(
            "SELECT has_function_privilege('anon', 'public.linc_record_app_termination(text)', 'EXECUTE') AS may_execute, has_table_privilege('anon', 'public.linc_notification_outbox', 'SELECT') AS may_read"
        );
        assert.equal(anonMetadata.rows[0].may_execute, false);
        assert.equal(anonMetadata.rows[0].may_read, false);

        await database.exec('SET ROLE anon');
        await assert.rejects(
            database.query('SELECT * FROM public.linc_notification_outbox'),
            error => error.code === '42501'
        );
        await assert.rejects(
            database.query("SELECT public.linc_record_app_termination('permission-user')"),
            error => error.code === '42501'
        );
        await database.exec('RESET ROLE');

        await database.exec('SET ROLE service_role');
        const serviceCall = await database.query(
            "SELECT public.linc_record_app_termination('permission-user') AS result"
        );
        await database.exec('RESET ROLE');

        const value = typeof serviceCall.rows[0].result === 'string'
            ? JSON.parse(serviceCall.rows[0].result)
            : serviceCall.rows[0].result;
        assert.equal(value.found, true);
        assert.equal(value.eventStatus, 'blocked');
        assert.equal(value.guardianLinked, false);
    } finally {
        await database.close();
    }
});
