const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../vercel.json');

test('automatic Vercel deployments are paused only for the guarded review branch', () => {
    const deploymentEnabled = config.git && config.git.deploymentEnabled;

    assert.equal(typeof deploymentEnabled, 'object');
    assert.equal(deploymentEnabled['fix/linc-backend-clean-pr'], false);
    // An omitted branch follows Vercel's default-enabled behavior. Explicitly
    // guard against accidentally turning off the production branch here.
    assert.notEqual(deploymentEnabled.main, false);
});

test('Vercel continues to route requests to the existing Express server', () => {
    assert.deepEqual(config.builds, [
        { src: 'server.js', use: '@vercel/node' }
    ]);
    assert.deepEqual(config.routes, [
        { src: '/(.*)', dest: 'server.js' }
    ]);
});
