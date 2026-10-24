const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

// Treat every versioned API endpoint as private by default. If a future
// endpoint is intentionally public, it must be explicitly reviewed rather
// than silently bypassing the end-user identity gate.
test('every /api/v1 route enforces service and verified end-user auth in order', () => {
    const routes = app._router.stack
        .filter(layer => layer.route && typeof layer.route.path === 'string')
        .map(layer => layer.route)
        .filter(route => route.path.startsWith('/api/v1/'));

    assert.ok(routes.length > 0, 'expected versioned API routes to be registered');

    for (const route of routes) {
        const middlewareNames = route.stack.map(layer => layer.name);
        const label = `${Object.keys(route.methods).join(',').toUpperCase()} ${route.path}`;
        const serviceAuthIndex = middlewareNames.indexOf('validateApiKey');
        const endUserAuthIndex = middlewareNames.indexOf('requireVerifiedEndUser');

        assert.notEqual(serviceAuthIndex, -1, `${label} must use validateApiKey`);
        assert.notEqual(endUserAuthIndex, -1, `${label} must use requireVerifiedEndUser`);
        assert.ok(
            serviceAuthIndex < endUserAuthIndex,
            `${label} must validate service authentication before end-user identity`
        );
    }
});
