const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate local-adapter tests from developer data and any real Supabase project.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linc-controller-security-'));
process.env.LINC_DATA_FILE = path.join(tempDir, 'linc_data.json');
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;

const {
    handleUserRegistration,
    handleHeartbeat
} = require('../controllers');

function mockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

function readState() {
    return JSON.parse(fs.readFileSync(process.env.LINC_DATA_FILE, 'utf8'));
}

test('registration never trusts a guardian LINE ID supplied by the request body', async () => {
    const res = mockResponse();
    await handleUserRegistration({
        auth: { userId: 'new-user' },
        body: {
            userId: 'new-user',
            grade: 'M1',
            guardianLineId: 'attacker-controlled-line-id'
        }
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(readState().users['new-user'].guardianLineId, null);
});

test('registration preserves a previously stored guardian LINE ID when body supplies a different value', async () => {
    fs.writeFileSync(process.env.LINC_DATA_FILE, JSON.stringify({
        schools: {},
        users: {
            'existing-user': {
                userId: 'existing-user',
                grade: 'M1',
                guardianLineId: 'previously-stored-line-id',
                createdAt: Date.now(),
                status: 'active'
            }
        },
        revenue: { total: 0 }
    }));

    const res = mockResponse();
    await handleUserRegistration({
        auth: { userId: 'existing-user' },
        body: {
            userId: 'existing-user',
            grade: 'M2',
            guardianLineId: 'attacker-controlled-line-id'
        }
    }, res);

    const saved = readState().users['existing-user'];
    assert.equal(res.statusCode, 200);
    assert.equal(saved.guardianLineId, 'previously-stored-line-id');
    assert.equal(saved.grade, 'M2');
});

test('heartbeat never trusts a guardian LINE ID supplied for a newly created profile', async () => {
    const res = mockResponse();
    await handleHeartbeat({
        auth: { userId: 'heartbeat-user' },
        body: {
            userId: 'heartbeat-user',
            grade: 'M1',
            guardianLineId: 'attacker-controlled-line-id'
        }
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(readState().users['heartbeat-user'].guardianLineId, null);
});

test('immediate-delete never trusts legacy guardian ID without verified pairing and consent', async () => {
    fs.writeFileSync(process.env.LINC_DATA_FILE, JSON.stringify({
        schools: {},
        users: {
            'delete-user': {
                userId: 'delete-user',
                grade: 'M1',
                guardianLineId: 'legacy-stored-line-id',
                createdAt: Date.now(),
                status: 'active'
            }
        },
        revenue: { total: 0 }
    }));

    const res = mockResponse();
    let alertPayload;
    await require('../controllers').handleImmediateDelete({
        auth: { userId: 'delete-user' },
        body: {
            userId: 'delete-user',
            guardianLineId: 'attacker-controlled-line-id'
        }
    }, res, payload => { alertPayload = payload; });

    assert.equal(res.statusCode, 200);
    assert.equal(alertPayload.guardianLinked, false);
    assert.equal(alertPayload.eventStatus, 'blocked');
    assert.ok(alertPayload.eventId);
    assert.equal(
        JSON.stringify(alertPayload).includes('legacy-stored-line-id'),
        false,
        'the log callback must not receive the raw guardian LINE ID'
    );

    const state = readState();
    assert.equal(state.users['delete-user'].status, 'app_deleted');
    assert.equal(state.outbox.length, 1);
    assert.equal(state.outbox[0].recipientLineId, null);
    assert.equal(state.outbox[0].eventType, 'APP_TERMINATION_SIGNAL');
    assert.equal(state.outbox[0].eventStatus, 'blocked');
    assert.equal(state.outbox[0].payload.reason, 'APP_TERMINATION_SIGNAL');
});


test('app termination records a blocked outbox event when no guardian is linked', async () => {
    fs.writeFileSync(process.env.LINC_DATA_FILE, JSON.stringify({
        schools: {},
        users: {
            'unlinked-delete-user': {
                userId: 'unlinked-delete-user',
                grade: 'M1',
                guardianLineId: null,
                createdAt: Date.now(),
                status: 'active'
            }
        },
        revenue: { total: 0 }
    }));

    const res = mockResponse();
    let callbackPayload;
    await require('../controllers').handleImmediateDelete({
        auth: { userId: 'unlinked-delete-user' },
        body: { userId: 'unlinked-delete-user' }
    }, res, payload => { callbackPayload = payload; });

    const state = readState();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.notificationStatus, 'blocked');
    assert.equal(callbackPayload.guardianLinked, false);
    assert.equal(state.outbox.length, 1);
    assert.equal(state.outbox[0].eventStatus, 'blocked');
    assert.equal(state.outbox[0].recipientLineId, null);
    assert.equal(state.users['unlinked-delete-user'].status, 'app_deleted');
});

test('repeated app-delete requests do not re-record or re-emit the same terminal event', async () => {
    fs.writeFileSync(process.env.LINC_DATA_FILE, JSON.stringify({
        schools: {},
        users: {
            'idempotent-delete-user': {
                userId: 'idempotent-delete-user',
                grade: 'M1',
                guardianLineId: 'verified-guardian-line-id',
                createdAt: Date.now(),
                status: 'active'
            }
        },
        revenue: { total: 0 }
    }));

    let alertCount = 0;
    const firstResponse = mockResponse();
    const request = {
        auth: { userId: 'idempotent-delete-user' },
        body: { userId: 'idempotent-delete-user' }
    };

    await require('../controllers').handleImmediateDelete(
        request,
        firstResponse,
        () => { alertCount += 1; }
    );

    const firstState = readState().users['idempotent-delete-user'];
    const firstDeletedAt = firstState.deletedAt;
    assert.equal(firstResponse.statusCode, 200);
    assert.equal(firstResponse.body.alreadyRecorded, false);
    assert.equal(alertCount, 1);

    const secondResponse = mockResponse();
    await require('../controllers').handleImmediateDelete(
        request,
        secondResponse,
        () => { alertCount += 1; }
    );

    const secondState = readState().users['idempotent-delete-user'];
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(secondResponse.body.alreadyRecorded, true);
    assert.equal(secondState.deletedAt, firstDeletedAt);
    assert.equal(alertCount, 1);
    assert.equal(
        readState().outbox.length,
        1,
        'repeated deletion must not create a duplicate outbox event'
    );
});

test('heartbeat cannot reactivate a profile marked app_deleted', async () => {
    fs.writeFileSync(process.env.LINC_DATA_FILE, JSON.stringify({
        schools: {},
        users: {
            'deleted-user': {
                userId: 'deleted-user',
                grade: 'M1',
                guardianLineId: null,
                createdAt: Date.now(),
                status: 'app_deleted',
                deletedAt: Date.now() - 1000
            }
        },
        revenue: { total: 0 }
    }));

    const res = mockResponse();
    await handleHeartbeat({
        auth: { userId: 'deleted-user' },
        body: { userId: 'deleted-user', grade: 'M1' }
    }, res);

    const saved = readState().users['deleted-user'];
    assert.equal(res.statusCode, 200);
    assert.equal(saved.status, 'app_deleted');
    assert.ok(saved.lastHeartbeat > 0);
    assert.ok(saved.deletedAt > 0);
});

test('controller rejects cross-account profile claiming before database access', async () => {
    const res = mockResponse();
    await handleHeartbeat({
        auth: { userId: 'account-a' },
        body: { userId: 'account-b', grade: 'M1' }
    }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, 'Requested user does not match authenticated identity');
    assert.equal(Object.hasOwn(readState().users, 'account-b'), false);
});

test('controller rejects noncanonical trusted principal before reading or writing user state', async () => {
    const res = mockResponse();
    await handleUserRegistration({
        auth: { userId: ' spaced-user ' },
        body: {}
    }, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Verified user identity is required');
    assert.equal(Object.hasOwn(readState().users, ' spaced-user '), false);
});
