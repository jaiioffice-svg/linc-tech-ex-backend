const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');

test('a failed alert callback does not stop later stale users being processed', async () => {
    const originals = {
        getStaleActiveUsers: db.getStaleActiveUsers,
        getUser: db.getUser,
        saveUser: db.saveUser
    };
    const originalConsoleError = console.error;
    const originalChecker = require.resolve('../checker');
    const users = new Map([
        ['user-a', { userId: 'user-a', status: 'active', lastHeartbeat: 1, guardianLineId: null }],
        ['user-b', { userId: 'user-b', status: 'active', lastHeartbeat: 1, guardianLineId: null }]
    ]);

    db.getStaleActiveUsers = async () => Array.from(users.values()).map(user => ({ ...user }));
    db.getUser = async userId => users.has(userId) ? { ...users.get(userId) } : null;
    db.saveUser = async user => { users.set(user.userId, { ...user }); };
    console.error = () => {};
    delete require.cache[originalChecker];

    try {
        const { runHeartbeatCheck } = require('../checker');
        const callbackUsers = [];
        const result = await runHeartbeatCheck(async payload => {
            callbackUsers.push(payload.userId);
            if (payload.userId === 'user-a') throw new Error('synthetic delivery failure');
        }, 2 * 24 * 60 * 60 * 1000);

        assert.deepEqual(result, { checked: 2, markedMissing: 2 });
        assert.deepEqual(callbackUsers, ['user-a', 'user-b']);
        assert.equal(users.get('user-a').status, 'missing');
        assert.equal(users.get('user-b').status, 'missing');
    } finally {
        db.getStaleActiveUsers = originals.getStaleActiveUsers;
        db.getUser = originals.getUser;
        db.saveUser = originals.saveUser;
        console.error = originalConsoleError;
        delete require.cache[originalChecker];
    }
});
