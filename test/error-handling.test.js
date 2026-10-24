const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');
const express = require('express');
const { errorHandler } = require('../error-handler');

let server;
let baseUrl;
const managedEnv = [
    'LINC_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VERCEL',
    'VERCEL_ENV',
    'LINC_ALLOWED_ORIGINS'
];
const originalEnv = Object.fromEntries(
    managedEnv.map(key => [key, process.env[key]])
);

test.before(async () => {
    for (const key of managedEnv) delete process.env[key];

    server = app.listen(0, '127.0.0.1');

    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });

    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) {
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }

    for (const key of managedEnv) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
    }
});

test('malformed JSON returns a sanitized 400 response', async () => {
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"secret_marker":"malformed'
    });

    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, {
        success: false,
        code: 'INVALID_JSON',
        message: 'Malformed JSON request body'
    });
    assert.equal(JSON.stringify(body).includes('secret_marker'), false);
    assert.equal(JSON.stringify(body).includes('stack'), false);
});

test('oversized JSON returns a sanitized 413 response', async () => {
    const marker = 'oversize_marker_'.repeat(6000);
    const response = await fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: marker })
    });

    const body = await response.json();

    assert.equal(response.status, 413);
    assert.deepEqual(body, {
        success: false,
        code: 'REQUEST_TOO_LARGE',
        message: 'Request body exceeds the allowed limit'
    });
    assert.equal(JSON.stringify(body).includes('oversize_marker'), false);
});

test('unknown routes return a stable JSON 404 instead of an HTML stack page', async () => {
    const response = await fetch(`${baseUrl}/not-a-real-linc-route`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'The requested route was not found'
    });
});

test('unexpected errors produce a generic 500 response without leaking exception details', async () => {
    const testApp = express();

    testApp.get('/trigger-unexpected-error', () => {
        throw new Error('private-diagnostic-token');
    });
    testApp.use(errorHandler);

    const testServer = testApp.listen(0, '127.0.0.1');

    await new Promise((resolve, reject) => {
        testServer.once('listening', resolve);
        testServer.once('error', reject);
    });

    const url = `http://127.0.0.1:${testServer.address().port}/trigger-unexpected-error`;
    const originalConsoleError = console.error;
    const capturedLogs = [];
    console.error = (...args) => capturedLogs.push(args.join(' '));

    try {
        const response = await fetch(url);
        const body = await response.json();
        const serialized = JSON.stringify(body);

        assert.equal(response.status, 500);
        assert.deepEqual(body, {
            success: false,
            code: 'INTERNAL_ERROR',
            message: 'Internal server error'
        });
        assert.equal(serialized.includes('private-diagnostic-token'), false);
        assert.equal(serialized.includes('stack'), false);
        assert.equal(
            capturedLogs.join(' ').includes('private-diagnostic-token'),
            false
        );
    } finally {
        console.error = originalConsoleError;
        await new Promise((resolve, reject) => {
            testServer.close(error => error ? reject(error) : resolve());
        });
    }
});
