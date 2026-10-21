const { getStaleActiveUsers, getUser, saveUser } = require('./db');

async function runHeartbeatCheck(triggerAlertCallback, now = Date.now()) {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const staleUsers = await getStaleActiveUsers(now - oneDayMs);
    let markedMissing = 0;

    for (const user of staleUsers) {
        // Re-read before writing so a refreshed heartbeat is not overwritten by a stale snapshot.
        const latest = await getUser(user.userId);
        if (!latest || latest.status !== 'active' || Number(latest.lastHeartbeat) >= now - oneDayMs) continue;

        latest.status = 'missing';
        latest.missingSince = now;
        await saveUser(latest);
        markedMissing += 1;

        if (typeof triggerAlertCallback === 'function') {
            triggerAlertCallback({
                userId: latest.userId,
                guardianLineId: latest.guardianLineId || null,
                reason: 'SYSTEM_DISCONNECTED_ALERT'
            });
        }
    }

    return { checked: staleUsers.length, markedMissing };
}

function startHeartbeatMonitor(triggerAlertCallback) {
    const interval = 60 * 60 * 1000;
    const timer = setInterval(() => {
        runHeartbeatCheck(triggerAlertCallback).catch(error => {
            console.error('[HEARTBEAT_MONITOR] run failed', error && error.code ? error.code : 'INTERNAL_ERROR');
        });
    }, interval);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
}

module.exports = { runHeartbeatCheck, startHeartbeatMonitor };
