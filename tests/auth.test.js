const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('../auth');

function loadAuth() {
    delete require.cache[authPath];
    return require('../auth');
}

function responseRecorder() {
    return {
        statusCode: 200,
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

function requestWithHeader(value) {
    return {
        get(name) {
            assert.equal(name, 'x-linc-api-key');
            return value;
        }
    };
}

test('API authentication fails closed when LINC_API_KEY is not configured', t => {
    const previous = process.env.LINC_API_KEY;
    delete process.env.LINC_API_KEY;
    t.after(() => {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
        delete require.cache[authPath];
    });

    const { validateApiKey } = loadAuth();
    const res = responseRecorder();
    let nextCalled = false;

    validateApiKey(requestWithHeader('anything'), res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.equal(nextCalled, false);
});

test('API authentication rejects a missing key', t => {
    const previous = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'test-api-key';
    t.after(() => {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
        delete require.cache[authPath];
    });

    const { validateApiKey } = loadAuth();
    const res = responseRecorder();
    let nextCalled = false;

    validateApiKey(requestWithHeader(undefined), res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test('API authentication rejects an incorrect key', t => {
    const previous = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'expected-test-key';
    t.after(() => {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
        delete require.cache[authPath];
    });

    const { validateApiKey } = loadAuth();
    const res = responseRecorder();
    let nextCalled = false;

    validateApiKey(requestWithHeader('wrong-test-key'), res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.equal(nextCalled, false);
});

test('API authentication accepts the configured key and calls next exactly once', t => {
    const previous = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'expected-test-key';
    t.after(() => {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
        delete require.cache[authPath];
    });

    const { validateApiKey } = loadAuth();
    const res = responseRecorder();
    let nextCalls = 0;

    validateApiKey(requestWithHeader('expected-test-key'), res, () => {
        nextCalls += 1;
    });

    assert.equal(res.statusCode, 200);
    assert.equal(nextCalls, 1);
});
