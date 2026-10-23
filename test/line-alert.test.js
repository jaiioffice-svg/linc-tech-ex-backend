const test = require('node:test');
const assert = require('node:assert/strict');
const { sendGuardianAlert, alertText } = require('../line-alert');

const ENV_KEYS = [
    'LINE_ALERTS_ENABLED',
    'LINE_CHANNEL_ACCESS_TOKEN'
];

function saveEnv() {
    return Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
}

function restoreEnv(previous) {
    for (const key of ENV_KEYS) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
    }
}

test('guardian alerts are disabled by default and do not call the provider', async () => {
    const previous = saveEnv();
    const originalFetch = global.fetch;
    let calls = 0;
    delete process.env.LINE_ALERTS_ENABLED;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-only-token';
    global.fetch = async () => {
        calls += 1;
        throw new Error('fetch must not be called');
    };

    try {
        const result = await sendGuardianAlert({
            guardianLineId: 'synthetic-guardian-id',
            reason: 'APP_TERMINATION_SIGNAL'
        });
        assert.deepEqual(result, { sent: false, reason: 'disabled' });
        assert.equal(calls, 0);
    } finally {
        global.fetch = originalFetch;
        restoreEnv(previous);
    }
});

test('guardian alerts fail closed when the guardian is not linked', async () => {
    const previous = saveEnv();
    const originalFetch = global.fetch;
    let calls = 0;
    process.env.LINE_ALERTS_ENABLED = 'true';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-only-token';
    global.fetch = async () => {
        calls += 1;
        throw new Error('fetch must not be called');
    };

    try {
        const result = await sendGuardianAlert({
            guardianLineId: null,
            reason: 'APP_TERMINATION_SIGNAL'
        });
        assert.deepEqual(result, { sent: false, reason: 'guardian_not_linked' });
        assert.equal(calls, 0);
    } finally {
        global.fetch = originalFetch;
        restoreEnv(previous);
    }
});

test('guardian alerts do not claim delivery when LINE rejects the request', async () => {
    const previous = saveEnv();
    const originalFetch = global.fetch;
    process.env.LINE_ALERTS_ENABLED = 'true';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-only-token';
    let capturedRequest;

    global.fetch = async (url, options) => {
        capturedRequest = { url, options };
        return { ok: false, status: 401 };
    };

    try {
        const result = await sendGuardianAlert({
            guardianLineId: 'synthetic-guardian-id',
            reason: 'APP_TERMINATION_SIGNAL'
        });
        assert.deepEqual(result, { sent: false, reason: 'provider_error' });
        assert.equal(capturedRequest.url, 'https://api.line.me/v2/bot/message/push');
        assert.equal(capturedRequest.options.method, 'POST');
        assert.match(capturedRequest.options.headers.Authorization, /^Bearer test-only-token$/);
        assert.equal(JSON.parse(capturedRequest.options.body).to, 'synthetic-guardian-id');
    } finally {
        global.fetch = originalFetch;
        restoreEnv(previous);
    }
});

test('successful LINE response is reported as accepted and alert wording stays care-focused', async () => {
    const previous = saveEnv();
    const originalFetch = global.fetch;
    process.env.LINE_ALERTS_ENABLED = 'true';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-only-token';
    global.fetch = async () => ({ ok: true, status: 200 });

    try {
        const result = await sendGuardianAlert({
            guardianLineId: 'synthetic-guardian-id',
            reason: 'SYSTEM_DISCONNECTED_ALERT'
        });
        assert.deepEqual(result, { sent: true });
        assert.match(alertText('SYSTEM_DISCONNECTED_ALERT'), /ความห่วงใย/);
    } finally {
        global.fetch = originalFetch;
        restoreEnv(previous);
    }
});


test('network errors are handled without claiming delivery or leaking error details', async () => {
    const previous = saveEnv();
    const originalFetch = global.fetch;
    process.env.LINE_ALERTS_ENABLED = 'true';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-only-token';
    global.fetch = async () => {
        throw new Error('synthetic network error containing sensitive request details');
    };

    try {
        const result = await sendGuardianAlert({
            guardianLineId: 'synthetic-guardian-id',
            reason: 'SYSTEM_DISCONNECTED_ALERT'
        });
        assert.deepEqual(result, { sent: false, reason: 'provider_error' });
    } finally {
        global.fetch = originalFetch;
        restoreEnv(previous);
    }
});
