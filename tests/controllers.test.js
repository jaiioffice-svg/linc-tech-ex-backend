const test = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../db');

function loadControllers(stubs) {
    require.cache[dbPath] = {
        id: dbPath,
        filename: dbPath,
        loaded: true,
        exports: stubs
    };
    delete require.cache[require.resolve('../controllers')];
    return require('../controllers');
}

function responseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('heartbeat rejects a missing userId', async () => {
    const controllers = loadControllers({ getUser: async () => null, saveUser: async () => {} });
    const res = responseRecorder();
    await controllers.handleHeartbeat({ body: {} }, res);
    assert.equal(res.statusCode, 400);
});

test('heartbeat rejects an overlong userId', async () => {
    const controllers = loadControllers({ getUser: async () => null, saveUser: async () => {} });
    const res = responseRecorder();
    await controllers.handleHeartbeat({ body: { userId: 'x'.repeat(129) } }, res);
    assert.equal(res.statusCode, 400);
});

test('heartbeat does not allow a request to set or replace a guardian LINE link', async () => {
    const existing = {
        userId: 'test-user',
        grade: 'M1',
        guardianLineId: 'verified-guardian',
        createdAt: Date.now(),
        lastHeartbeat: 1,
        status: 'missing'
    };
    let saved;
    const controllers = loadControllers({
        getUser: async () => ({ ...existing }),
        saveUser: async user => { saved = { ...user }; }
    });
    const res = responseRecorder();
    await controllers.handleHeartbeat({
        body: { userId: 'test-user', guardianLineId: 'attacker-controlled-id', grade: 'M2' }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved.guardianLineId, 'verified-guardian');
    assert.equal(saved.grade, 'M2');
    assert.equal(saved.status, 'active');
});

test('heartbeat creates a new profile without trusting a supplied guardian LINE link', async () => {
    let saved;
    const controllers = loadControllers({
        getUser: async () => null,
        saveUser: async user => { saved = { ...user }; }
    });
    const res = responseRecorder();
    await controllers.handleHeartbeat({
        body: { userId: 'new-test-user', guardianLineId: 'unverified-id' }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved.guardianLineId, null);
});

test('delete alert rejects a missing userId', async () => {
    const controllers = loadControllers({ getUser: async () => null, saveUser: async () => {} });
    const res = responseRecorder();
    await controllers.handleImmediateDelete({ body: {} }, res);
    assert.equal(res.statusCode, 400);
});

test('delete alert marks an existing profile and records the event', async () => {
    let saved;
    let alert;
    const controllers = loadControllers({
        getUser: async () => ({
            userId: 'test-user',
            grade: 'M1',
            guardianLineId: 'verified-guardian',
            createdAt: Date.now(),
            lastHeartbeat: Date.now(),
            status: 'active'
        }),
        saveUser: async user => { saved = { ...user }; }
    });
    const res = responseRecorder();
    await controllers.handleImmediateDelete(
        { body: { userId: 'test-user' } },
        res,
        payload => { alert = payload; }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(saved.status, 'app_deleted');
    assert.equal(alert.guardianLineId, 'verified-guardian');
    assert.equal(alert.reason, 'APP_TERMINATION_SIGNAL');
});


test('delete alert remains recorded when the alert callback fails', async () => {
    let saved;
    const previousError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    try {
        const controllers = loadControllers({
            getUser: async () => ({
                userId: 'test-user',
                grade: 'M1',
                guardianLineId: 'verified-guardian',
                createdAt: Date.now(),
                lastHeartbeat: Date.now(),
                status: 'active'
            }),
            saveUser: async user => { saved = { ...user }; }
        });
        const res = responseRecorder();
        await controllers.handleImmediateDelete(
            { body: { userId: 'test-user' } },
            res,
            async () => { const error = new Error('synthetic delivery failure'); error.code = 'TEST_DELIVERY_FAILURE'; throw error; }
        );
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { success: true, message: 'Termination event recorded' });
        assert.equal(saved.status, 'app_deleted');
        assert.deepEqual(logged, [['[IMMEDIATE_DELETE] alert callback failed', 'TEST_DELIVERY_FAILURE']]);
    } finally {
        console.error = previousError;
    }
});
