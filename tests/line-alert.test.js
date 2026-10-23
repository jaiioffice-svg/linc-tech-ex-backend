const test = require('node:test');
const assert = require('node:assert/strict');

const { sendGuardianAlert, alertText } = require('../line-alert');

function preserveEnv(t) {
    const oldEnabled = process.env.LINE_ALERTS_ENABLED;
    const oldToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    t.after(() => {
        if (oldEnabled === undefined) delete process.env.LINE_ALERTS_ENABLED;
        else process.env.LINE_ALERTS_ENABLED = oldEnabled;
        if (oldToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
        else process.env.LINE_CHANNEL_ACCESS_TOKEN = oldToken;
    });
}

test('LINE alerts stay disabled unless explicitly enabled', async t => {
    preserveEnv(t);
    delete process.env.LINE_ALERTS_ENABLED;
    let fetchCalled = false;
    const oldFetch = global.fetch;
    global.fetch = async () => { fetchCalled = true; return new Response(null, { status: 200 }); };
    t.after(() => { global.fetch = oldFetch; });

    const result = await sendGuardianAlert({
        guardianLineId: 'test-guardian',
        reason: 'APP_TERMINATION_SIGNAL'
    });
    assert.deepEqual(result, { sent: false, reason: 'disabled' });
    assert.equal(fetchCalled, false);
});

test('LINE alert does not send without a guardian LINE ID', async t => {
    preserveEnv(t);
    process.env.LINE_ALERTS_ENABLED = 'true';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-only-placeholder-token';
    let fetchCalled = false;
    const oldFetch = global.fetch;
    global.fetch = async () => { fetchCalled = true; return new Response(null, { status: 200 }); };
    t.after(() => { global.fetch = oldFetch; });

    const result = await sendGuardianAlert({ guardianLineId: null, reason: 'SYSTEM_DISCONNECTED_ALERT' });
    assert.deepEqual(result, { sent: false, reason: 'guardian_not_linked' });
    assert.equal(fetchCalled, false);
});

test('guardian alert wording is calm and does not expose internal identifiers', () => {
    assert.match(alertText('SYSTEM_DISCONNECTED_ALERT'), /อาจเกิดจากอินเทอร์เน็ตหรือสัญญาณขัดข้อง/);
    assert.doesNotMatch(alertText('APP_TERMINATION_SIGNAL'), /userId|guardianLineId|APP_TERMINATION_SIGNAL/);
});
