const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApiKey } = require('../auth');

function mockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

function mockRequest(headerValue) {
    return { get(name) { return name === 'x-linc-api-key' ? headerValue : undefined; } };
}

test('returns 503 when API key is not configured', () => {
    const previous = process.env.LINC_API_KEY;
    delete process.env.LINC_API_KEY;
    try {
        const res = mockResponse();
        let nextCalled = false;
        validateApiKey(mockRequest('anything'), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 503);
        assert.equal(nextCalled, false);
    } finally {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
    }
});

test('returns 401 when request has no API key', () => {
    const previous = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'test-only-key';
    try {
        const res = mockResponse();
        let nextCalled = false;
        validateApiKey(mockRequest(undefined), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 401);
        assert.equal(nextCalled, false);
    } finally {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
    }
});

test('returns 401 when request API key is incorrect', () => {
    const previous = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'test-only-key';
    try {
        const res = mockResponse();
        let nextCalled = false;
        validateApiKey(mockRequest('wrong-test-key'), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 401);
        assert.equal(nextCalled, false);
    } finally {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
    }
});

test('calls next when request API key matches', () => {
    const previous = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'test-only-key';
    try {
        const res = mockResponse();
        let nextCalled = false;
        validateApiKey(mockRequest('test-only-key'), res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body, null);
    } finally {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
    }
});
