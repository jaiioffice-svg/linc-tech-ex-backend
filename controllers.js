const { getUser, saveUser, recordAppTermination } = require('./db');

function sendError(res, error, action) {
    const status = error && (error.code === 'DB_NOT_CONFIGURED' || error.code === 'DB_UNAVAILABLE') ? 503 : 500;
    // Keep internal stack traces and upstream error bodies out of API responses.
    console.error(`[${action}] request failed`, error && error.code ? error.code : 'INTERNAL_ERROR');
    const message = status === 503
        ? 'Required database service is not configured or is temporarily unavailable'
        : 'Internal server error';
    return res.status(status).json({ success: false, message });
}

// Controllers trust only a principal set by reviewed server-side authentication
// middleware. Body-supplied identifiers are consistency checks, never identity.
function getAuthenticatedUserId(req, res) {
    const authenticatedUserId = req && req.auth && req.auth.userId;
    if (typeof authenticatedUserId !== 'string' ||
        !authenticatedUserId.trim() ||
        authenticatedUserId !== authenticatedUserId.trim() ||
        authenticatedUserId.length > 200) {
        res.status(401).json({ success: false, message: 'Verified user identity is required' });
        return null;
    }

    const requestedUserId = req.body && req.body.userId;
    if (requestedUserId !== undefined && requestedUserId !== authenticatedUserId) {
        res.status(403).json({
            success: false,
            message: 'Requested user does not match authenticated identity'
        });
        return null;
    }

    return authenticatedUserId;
}

exports.handleUserRegistration = async (req, res) => {
    const userId = getAuthenticatedUserId(req, res);
    if (!userId) return;

    try {
        const { grade } = req.body || {};
        const existingUser = await getUser(userId);
        const user = existingUser || {
            userId,
            grade: typeof grade === 'string' && grade.trim() ? grade.trim() : 'M1',
            // Guardian identity must be set only by a verified pairing flow.
            guardianLineId: null,
            createdAt: Date.now(),
            status: 'active'
        };

        if (existingUser && typeof grade === 'string' && grade.trim()) user.grade = grade.trim();
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

// Keep the existing heartbeat endpoint while using Supabase persistence.
// The profile key is always derived from the authenticated principal.
exports.handleHeartbeat = async (req, res) => {
    const userId = getAuthenticatedUserId(req, res);
    if (!userId) return;

    try {
        const { grade } = req.body || {};
        const now = Date.now();
        const existingUser = await getUser(userId);
        const user = existingUser || {
            userId,
            grade: typeof grade === 'string' && grade.trim() ? grade.trim() : 'M1',
            // Guardian identity must be set only by a verified pairing flow.
            guardianLineId: null,
            createdAt: now,
            status: 'active'
        };

        if (existingUser && typeof grade === 'string' && grade.trim()) user.grade = grade.trim();
        user.lastHeartbeat = now;
        // A heartbeat is not proof of a legitimate reinstall or user reactivation.
        // Preserve terminal app_deleted status; recovery must use an explicit trusted flow.
        if (!existingUser || existingUser.status !== 'app_deleted') {
            user.status = 'active';
        }
        await saveUser(user);

        return res.status(existingUser ? 200 : 201).json({
            success: true,
            message: 'Heartbeat acknowledged'
        });
    } catch (error) {
        return sendError(res, error, 'HEARTBEAT');
    }
};

exports.handleImmediateDelete = async (req, res, triggerAlertCallback) => {
    const userId = getAuthenticatedUserId(req, res);
    if (!userId) return;

    try {
        // Profile state and its notification outbox record are committed atomically
        // by the durable database RPC (or one local-file write in development).
        const result = await recordAppTermination(userId);

        if (!result.found) {
            return res.status(404).json({
                success: false,
                message: 'Target profile not found'
            });
        }

        if (!result.alreadyRecorded && typeof triggerAlertCallback === 'function') {
            try {
                triggerAlertCallback({
                    eventId: result.eventId,
                    reason: 'APP_TERMINATION_SIGNAL',
                    eventStatus: result.eventStatus,
                    guardianLinked: result.guardianLinked
                });
            } catch (callbackError) {
                // The outbox entry is already durable; callback/logging failure must
                // not undo or misreport the committed termination transition.
                console.error(
                    '[ALERT_OUTBOX_CALLBACK]',
                    callbackError && callbackError.code ? callbackError.code : 'CALLBACK_FAILED'
                );
            }
        }

        return res.status(200).json({
            success: true,
            alreadyRecorded: result.alreadyRecorded,
            notificationStatus: result.eventStatus || (result.alreadyRecorded ? 'already_recorded' : null),
            message: result.alreadyRecorded
                ? 'Termination event already recorded'
                : 'Termination event recorded'
        });
    } catch (error) {
        return sendError(res, error, 'IMMEDIATE_DELETE');
    }
};
