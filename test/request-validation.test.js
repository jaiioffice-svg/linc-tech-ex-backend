const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUserRequest } = require('../request-validation');

function mockResponse() {
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

function invoke(body) {
    const req = body === undefined ? {} : { body };
    const res = mockResponse();
    let nextCalled = false;

    validateUserRequest(req, res, () => {
        nextCalled = true;
    });

    return { res, nextCalled };
}

test('missing request body is accepted as an empty optional payload', () => {
    const result = invoke(undefined);

    assert.equal(result.res.statusCode, 200);
    assert.equal(result.nextCalled, true);
});

test('null and array request bodies are rejected as invalid objects', () => {
    for (const body of [null, [], ['M1']]) {
        const result = invoke(body);

        assert.equal(result.res.statusCode, 400);
        assert.equal(result.res.body.code, 'INVALID_BODY');
        assert.equal(result.nextCalled, false);
    }
});

test('userId must be a non-empty string no longer than 200 characters', () => {
    const invalidValues = ['', '   ', 42, null, 'u'.repeat(201)];

    for (const userId of invalidValues) {
        const result = invoke({ userId });

        assert.equal(result.res.statusCode, 400);
        assert.equal(result.res.body.code, 'INVALID_USER_ID');
        assert.equal(result.nextCalled, false);
    }
});

test('grade must be a string no longer than 32 characters when supplied', () => {
    const invalidValues = [42, null, {}, 'g'.repeat(33)];

    for (const grade of invalidValues) {
        const result = invoke({ grade });

        assert.equal(result.res.statusCode, 400);
        assert.equal(result.res.body.code, 'INVALID_GRADE');
        assert.equal(result.nextCalled, false);
    }
});

test('valid payload values pass validation without setting an authenticated identity', () => {
    const result = invoke({
        userId: 'test-user',
        grade: 'M1'
    });

    assert.equal(result.res.statusCode, 200);
    assert.equal(result.nextCalled, true);
});
