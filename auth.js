const crypto = require('crypto');

function validateApiKey(req, res, next) {
    const configuredKey = process.env.LINC_API_KEY;
    const incomingKey = req.get('x-linc-api-key');

    if (
        typeof configuredKey !== 'string' ||
        Buffer.byteLength(configuredKey, 'utf8') < 32 ||
        configuredKey !== configuredKey.trim() ||
        /[\x00-\x1F\x7F]/.test(configuredKey)
    ) {
        return res.status(503).json({ success: false, message: 'API authentication is not configured' });
    }

    if (typeof incomingKey !== 'string') {
        return res.status(401).json({ success: false, message: 'Unauthorized connection' });
    }

    const expected = Buffer.from(configuredKey);
    const received = Buffer.from(incomingKey);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
        return res.status(401).json({ success: false, message: 'Unauthorized connection' });
    }

    next();
}

// This middleware deliberately fails closed until a reviewed end-user session
// verifier sets req.auth.userId. A shared service API key is not user identity.
// Only trusted server middleware may populate req.auth; never derive it from req.body.
function requireVerifiedEndUser(req, res, next) {
    const authenticatedUserId = req.auth && req.auth.userId;

    if (
        typeof authenticatedUserId !== 'string' ||
        !authenticatedUserId.trim() ||
        authenticatedUserId !== authenticatedUserId.trim() ||
        authenticatedUserId.length > 200
    ) {
        return res.status(503).json({
            success: false,
            message: 'End-user identity verification is not configured'
        });
    }

    const requestedUserId = req.body && req.body.userId;
    if (requestedUserId !== undefined && requestedUserId !== authenticatedUserId) {
        return res.status(403).json({
            success: false,
            message: 'Requested user does not match authenticated identity'
        });
    }

    next();
}

module.exports = { validateApiKey, requireVerifiedEndUser };
