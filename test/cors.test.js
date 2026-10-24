const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

let server;
let baseUrl;
let previousAllowedOrigins;

test.before(async () => {
    previousAllowedOrigins = process.env.LINC_ALLOWED_ORIGINS;
    delete process.env.LINC_ALLOWED_ORIGINS;

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) {
        await new Promise((resolve, reject) =>
            server.close(error => error ? reject(error) : resolve())
        );
    }

    if (previousAllowedOrigins === undefined) {
        delete process.env.LINC_ALLOWED_ORIGINS;
    } else {
        process.env.LINC_ALLOWED_ORIGINS = previousAllowedOrigins;
    }
});

async function preflight(origin) {
    return fetch(`${baseUrl}/api/v1/heartbeat`, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type,x-linc-api-key'
        }
    });
}

test('CORS requires exact explicit origins and remains optional for server-to-server calls', async () => {
    process.env.LINC_ALLOWED_ORIGINS =
        'https://app.example.test, https://bad.example.test/path, javascript:alert(1)';

    const allowed = await preflight('https://app.example.test');
    assert.equal(allowed.status, 204);
    assert.equal(
        allowed.headers.get('access-control-allow-origin'),
        'https://app.example.test'
    );
    assert.equal(allowed.headers.get('access-control-allow-credentials'), null);

    const unlisted = await preflight('https://evil.example.test');
    assert.equal(unlisted.headers.get('access-control-allow-origin'), null);

    // A configured URL with a path is not a valid Origin allowlist entry.
    const invalidEntry = await preflight('https://bad.example.test');
    assert.equal(invalidEntry.headers.get('access-control-allow-origin'), null);

    // Without a configured allowlist, browser origins receive no CORS grant.
    process.env.LINC_ALLOWED_ORIGINS = '';
    const noConfiguration = await preflight('https://app.example.test');
    assert.equal(noConfiguration.headers.get('access-control-allow-origin'), null);

    // Server-to-server requests have no Origin header and remain functional.
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), null);
});
