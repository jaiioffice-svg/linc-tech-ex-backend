const { getStaleActiveUsers, getUser, saveUser } = require('./db');

async function runHeartbeatCheck(triggerAlertCallback, now = Date.now()) {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const staleUsers = await getStaleActiveUsers(now - oneDayMs);
    let markedMissing = 0;

    for (const user of staleUsers) {
        const latest = await getUser(user.userId);
        if (!latest || latest.status !== 'active' || Number(latest.lastHeartbeat) >= now - oneDayMs) continue;

        latest.status = 'missing';
        await saveUser(latest);
        markedMissing += 1;

        if (typeof triggerAlertCallback === 'function') {
            await triggerAlertCallback({
                userId: latest.userId,
                guardianLineId: latest.guardianLineId || null,
                reason: 'SYSTEM_DISCONNECTED_ALERT'
            });
        }
    }

    return { checked: staleUsers.length, markedMissing };
}

function startHeartbeatMonitor(triggerAlertCallback) {
    const timer = setInterval(() => {
        runHeartbeatCheck(triggerAlertCallback).catch(error => {
            console.error('[HEARTBEAT_MONITOR] run failed', error && error.code ? error.code : 'INTERNAL_ERROR');
        });
    }, 60 * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
}

module.exports = { runHeartbeatCheck, startHeartbeatMonitor };
