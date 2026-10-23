const crypto = require('crypto');

function validateApiKey(req, res, next) {
    const expectedKey = process.env.LINC_API_KEY;
    if (!expectedKey) {
        return res.status(503).json({
            success: false,
            message: 'API authentication is not configured'
        });
    }

    const incomingKey = req.get('x-linc-api-key');
    if (typeof incomingKey !== 'string') {
        return res.status(401).json({ success: false, message: 'Unauthorized connection' });
    }

    const incoming = Buffer.from(incomingKey, 'utf8');
    const expected = Buffer.from(expectedKey, 'utf8');
    if (incoming.length !== expected.length || !crypto.timingSafeEqual(incoming, expected)) {
        return res.status(401).json({ success: false, message: 'Unauthorized connection' });
    }

    next();
}

module.exports = { validateApiKey };
