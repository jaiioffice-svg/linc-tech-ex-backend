const { getUser, saveUser } = require('./db');

function sendError(res, error, action) {
    const status = error && (error.code === 'DB_NOT_CONFIGURED' || error.code === 'DB_UNAVAILABLE') ? 503 : 500;
    // Keep internal stack traces and upstream error bodies out of API responses.
    console.error(`[${action}] request failed`, error && error.code ? error.code : 'INTERNAL_ERROR');
    const message = status === 503
        ? 'Required database service is not configured or is temporarily unavailable'
        : 'Internal server error';
    return res.status(status).json({ success: false, message });
};

exports.handleUserRegistration = async (req, res) => {
    try {
        const { userId, grade, guardianLineId } = req.body || {};
        if (typeof userId !== 'string' || !userId.trim()) {
            return res.status(400).json({ success: false, message: 'Missing core identifier' });
        }
        if (userId.length > 200) {
            return res.status(400).json({ success: false, message: 'Invalid user identifier' });
        }

        const existingUser = await getUser(userId);
        const user = existingUser || {
            userId,
            grade: typeof grade === 'string' && grade.trim() ? grade.trim() : 'M1',
            guardianLineId: typeof guardianLineId === 'string' && guardianLineId.trim()
                ? guardianLineId.trim()
                : null,
            createdAt: Date.now(),
            status: 'active'
        };

        if (existingUser && typeof grade === 'string' && grade.trim()) user.grade = grade.trim();
        if (typeof guardianLineId === 'string' && guardianLineId.trim()) {
            user.guardianLineId = guardianLineId.trim();
        }
        if (!user.status) user.status = 'active';
        await saveUser(user);

        return res.status(existingUser ? 200 : 201).json({
            success: true,
            message: existingUser ? 'User profile updated' : 'User profile registered'
        });
    } catch (error) {
        return sendError(res, error, 'USER_REGISTRATION');
    }
};

exports.handleImmediateDelete = async (req, res, triggerAlertCallback) => {
    try {
        const { userId } = req.body || {};
        if (typeof userId !== 'string' || !userId.trim()) {
            return res.status(400).json({ success: false, message: 'Missing core identifier' });
        }

        const targetUser = await getUser(userId);
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'Target profile not found' });
        }

        targetUser.status = 'app_deleted';
        targetUser.deletedAt = Date.now();
        await saveUser(targetUser);

        // This callback currently records an alert event only; actual LINE delivery must be integrated separately.
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
