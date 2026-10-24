const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApiKey, requireVerifiedEndUser } = require('../auth');

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

test('returns 503 when configured API keys are padded or contain control characters', () => {
    const previous = process.env.LINC_API_KEY;
    const invalidKeys = [
        ' ' + 'x'.repeat(32),
        'x'.repeat(32) + ' ',
        'x'.repeat(32) + String.fromCharCode(10),
        'x'.repeat(16) + String.fromCharCode(1) + 'x'.repeat(16)
    ];

    try {
        for (const key of invalidKeys) {
            process.env.LINC_API_KEY = key;
            const res = mockResponse();
            let nextCalled = false;
            validateApiKey(mockRequest(key), res, () => { nextCalled = true; });
            assert.equal(res.statusCode, 503);
            assert.equal(res.body.message, 'API authentication is not configured');
            assert.equal(nextCalled, false);
        }
    } finally {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
    }
});

test('returns 401 when request has no API key', () => {
    const previous = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'test-only-api-key-that-is-definitely-over-32-bytes';
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
    process.env.LINC_API_KEY = 'test-only-api-key-that-is-definitely-over-32-bytes';
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
    process.env.LINC_API_KEY = 'test-only-api-key-that-is-definitely-over-32-bytes';
    try {
        const res = mockResponse();
        let nextCalled = false;
        validateApiKey(mockRequest('test-only-api-key-that-is-definitely-over-32-bytes'), res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body, null);
    } finally {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
    }
});

test('end-user route gate fails closed when no verified principal is present', () => {
    const res = mockResponse();
    let nextCalled = false;
    requireVerifiedEndUser({ body: { userId: 'claimed-user' } }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.message, 'End-user identity verification is not configured');
    assert.equal(nextCalled, false);
});

test('end-user route gate rejects a body identifier that differs from the verified principal', () => {
    const res = mockResponse();
    let nextCalled = false;
    requireVerifiedEndUser({
        auth: { userId: 'account-a' },
        body: { userId: 'account-b' }
    }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, 'Requested user does not match authenticated identity');
    assert.equal(nextCalled, false);
});

test('end-user route gate accepts a verified principal when request contains no body identifier', () => {
    const res = mockResponse();
    let nextCalled = false;
    requireVerifiedEndUser({
        auth: { userId: 'account-a' },
        body: { grade: 'M1' }
    }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 200);
    assert.equal(nextCalled, true);
});

test('returns 503 when configured API key is shorter than the minimum length', () => {
    const previous = process.env.LINC_API_KEY;
    process.env.LINC_API_KEY = 'too-short';
    try {
        const res = mockResponse();
        let nextCalled = false;
        validateApiKey(mockRequest('too-short'), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.message, 'API authentication is not configured');
        assert.equal(nextCalled, false);
    } finally {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
    }
});

test('returns 401 when a same-length API key is incorrect', () => {
    const previous = process.env.LINC_API_KEY;
    const configuredKey = 'test-only-api-key-that-is-definitely-over-32-bytes';
    process.env.LINC_API_KEY = configuredKey;
    try {
        const res = mockResponse();
        let nextCalled = false;
        validateApiKey(mockRequest('x'.repeat(Buffer.byteLength(configuredKey, 'utf8'))), res, () => {
            nextCalled = true;
        });
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.message, 'Unauthorized connection');
        assert.equal(nextCalled, false);
    } finally {
        if (previous === undefined) delete process.env.LINC_API_KEY;
        else process.env.LINC_API_KEY = previous;
    }
});

test('end-user route gate rejects noncanonical or oversized principal IDs', () => {
    for (const userId of [' account-a ', 'a'.repeat(201)]) {
        const res = mockResponse();
        let nextCalled = false;
        requireVerifiedEndUser({
            auth: { userId },
            body: {}
        }, res, () => { nextCalled = true; });

        assert.equal(res.statusCode, 503);
        assert.equal(res.body.message, 'End-user identity verification is not configured');
        assert.equal(nextCalled, false);
    }
});
