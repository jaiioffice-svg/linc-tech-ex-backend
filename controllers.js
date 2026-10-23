const { getUser, saveUser } = require('./db');

function sendError(res, error, action) {
    const status = error && ['DB_NOT_CONFIGURED', 'DB_UNAVAILABLE', 'DB_PERMISSION_DENIED'].includes(error.code) ? 503 : 500;
    console.error(`[${action}] request failed`, error && error.code ? error.code : 'INTERNAL_ERROR');
    const message = status === 503
        ? 'Required database service is not configured or is temporarily unavailable'
        : 'Internal server error';
    return res.status(status).json({ success: false, message });
}

exports.handleHeartbeat = async (req, res) => {
    try {
        const { userId, grade } = req.body || {};
        if (typeof userId !== 'string' || !userId.trim()) {
            return res.status(400).json({ success: false, message: 'Missing core identifier' });
        }
        if (userId.length > 128) {
            return res.status(400).json({ success: false, message: 'Invalid user identifier' });
        }

        const now = Date.now();
        const existingUser = await getUser(userId);
        const user = existingUser || {
            userId,
            grade: typeof grade === 'string' && grade.trim() ? grade.trim() : 'M1',
            // Guardian links must be created only by a separately verified linking flow.
            guardianLineId: null,
            createdAt: now
        };

        if (existingUser && typeof grade === 'string' && grade.trim()) user.grade = grade.trim();
        // Do not accept guardianLineId from a heartbeat request. The shared API key
        // identifies the app/backend integration, not the individual user or guardian.
        user.lastHeartbeat = now;
        user.status = 'active';
        await saveUser(user);

        return res.status(200).json({ success: true, message: 'Heartbeat acknowledged' });
    } catch (error) {
        return sendError(res, error, 'HEARTBEAT');
    }
};

exports.handleImmediateDelete = async (req, res, triggerAlertCallback) => {
    try {
        const { userId } = req.body || {};
        if (typeof userId !== 'string' || !userId.trim()) {
            return res.status(400).json({ success: false, message: 'Missing core identifier' });
        }
        if (userId.length > 128) {
            return res.status(400).json({ success: false, message: 'Invalid user identifier' });
        }

        const targetUser = await getUser(userId);
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'Target profile not found' });
        }

        targetUser.status = 'app_deleted';
        await saveUser(targetUser);

        if (typeof triggerAlertCallback === 'function') {
            triggerAlertCallback({
                userId,
                guardianLineId: targetUser.guardianLineId || null,
                reason: 'APP_TERMINATION_SIGNAL'
            });
        }

        return res.status(200).json({ success: true, message: 'Termination event recorded' });
    } catch (error) {
        return sendError(res, error, 'IMMEDIATE_DELETE');
    }
};
