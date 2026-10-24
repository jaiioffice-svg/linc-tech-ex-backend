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
        body: {
            userId: 'heartbeat-user',
            grade: 'M1',
            guardianLineId: 'attacker-controlled-line-id'
        }
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(readState().users['heartbeat-user'].guardianLineId, null);
});

test('immediate-delete alert uses the stored guardian ID, not a request-body value', async () => {
    fs.writeFileSync(process.env.LINC_DATA_FILE, JSON.stringify({
        schools: {},
        users: {
            'delete-user': {
                userId: 'delete-user',
                grade: 'M1',
                guardianLineId: 'verified-stored-line-id',
                createdAt: Date.now(),
                status: 'active'
            }
        },
        revenue: { total: 0 }
    }));

    const res = mockResponse();
    let alertPayload;
    await require('../controllers').handleImmediateDelete({
        body: {
            userId: 'delete-user',
            guardianLineId: 'attacker-controlled-line-id'
        }
    }, res, payload => { alertPayload = payload; });

    assert.equal(res.statusCode, 200);
    assert.equal(alertPayload.guardianLineId, 'verified-stored-line-id');
    assert.equal(readState().users['delete-user'].status, 'app_deleted');
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
        body: { userId: 'deleted-user', grade: 'M1' }
    }, res);

    const saved = readState().users['deleted-user'];
    assert.equal(res.statusCode, 200);
    assert.equal(saved.status, 'app_deleted');
    assert.ok(saved.lastHeartbeat > 0);
    assert.ok(saved.deletedAt > 0);
});
