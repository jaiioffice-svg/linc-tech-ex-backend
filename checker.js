const { readDB, writeDB } = require('./db');

function startHeartbeatMonitor(triggerAlertCallback) {
    setInterval(() => {
        try {
            const db = readDB();
            const now = Date.now();
            const ONEDAY_MS = 24 * 60 * 60 * 1000; 

            Object.keys(db.users).forEach(userId => {
                const user = db.users[userId];
                
                if (user.status === 'active' && (now - user.lastHeartbeat) > ONEDAY_MS) {
                    user.status = 'missing'; 
                    db.users[userId] = user;
                    
                    triggerAlertCallback({
                        userId: userId,
                        guardianLineId: user.guardianLineId,
                        reason: 'SYSTEM_DISCONNECTED_ALERT'
                    });
                }
            });
            writeDB(db);
        } catch (error) {
            console.error('Error running monitor service:', error.message);
        }
    }, 60 * 60 * 1000); 
}

module.exports = { startHeartbeatMonitor };