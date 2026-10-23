const test = require('node:test');
const assert = require('node:assert/strict');

const { validateApiKey } = require('../auth');

function makeResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

function runMiddleware({ expectedKey, incomingKey } = {}) {
    const originalKey = process.env.LINC_API_KEY;
    if (expectedKey === undefined) delete process.env.LINC_API_KEY;
    else process.env.LINC_API_KEY = expectedKey;

    const req = {
        get(name) {
            assert.equal(name, 'x-linc-api-key');
            return incomingKey;
        }
    };
    const res = makeResponse();
    let nextCalled = false;

    try {
        validateApiKey(req, res, () => {
            nextCalled = true;
        });
    } finally {
        if (originalKey === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = originalKey;
    }

    return { res, nextCalled };
}

test('fails closed with 503 when the server API key is not configured', () => {
    const { res, nextCalled } = runMiddleware({ incomingKey: 'anything' });

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, {
        success: false,
        message: 'API authentication is not configured'
    });
    assert.equal(nextCalled, false);
});

test('rejects a missing client API key with 401', () => {
    const { res, nextCalled } = runMiddleware({
        expectedKey: 'test-secret-key',
        incomingKey: undefined
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
        success: false,
        message: 'Unauthorized connection'
    });
    assert.equal(nextCalled, false);
});

test('rejects an incorrect client API key with 401', () => {
    const { res, nextCalled } = runMiddleware({
        expectedKey: 'test-secret-key',
        incomingKey: 'wrong-secret-key'
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
        success: false,
        message: 'Unauthorized connection'
    });
    assert.equal(nextCalled, false);
});

test('rejects a key of a different byte length without throwing', () => {
    const { res, nextCalled } = runMiddleware({
        expectedKey: 'long-test-secret',
        incomingKey: 'x'
    });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test('allows the request only when the configured key matches exactly', () => {
    const { res, nextCalled } = runMiddleware({
        expectedKey: 'test-secret-key',
        incomingKey: 'test-secret-key'
    });

    assert.equal(res.statusCode, null);
    assert.equal(res.body, null);
    assert.equal(nextCalled, true);
});
