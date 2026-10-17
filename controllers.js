const { readDB, writeDB } = require('./db');

exports.handleHeartbeat = (req, res) => {
    try {
        const { userId, grade } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: 'Missing core identifier' });

        const db = readDB();
        const now = Date.now();

        if (!db.users[userId]) {
            db.users[userId] = {
                userId: userId,
                grade: grade || 'M1',
                guardianLineId: req.body.guardianLineId || 'SUPER_ADMIN_LINE_ID',
                createdAt: now
            };
        }

        db.users[userId].lastHeartbeat = now;
        db.users[userId].status = 'active';
        writeDB(db);

        return res.status(200).json({ success: true, message: 'Heartbeat acknowledged' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.handleImmediateDelete = (req, res, triggerAlertCallback) => {
    try {
        const { userId } = req.body;
        const db = readDB();
        
        if (!userId || !db.users[userId]) {
            return res.status(404).json({ success: false, message: 'Target profile not found' });
        }

        const targetUser = db.users[userId];
        targetUser.status = 'app_deleted';
        writeDB(db);

        triggerAlertCallback({
            userId: userId,
            guardianLineId: targetUser.guardianLineId,
            reason: 'APP_TERMINATION_SIGNAL'
        });

        return res.status(200).json({ success: true, message: 'Termination signal propagated' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};