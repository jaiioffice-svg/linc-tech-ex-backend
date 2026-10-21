const crypto = require('crypto');

function validateApiKey(req, res, next) {
    const configuredKey = process.env.LINC_API_KEY;
    const incomingKey = req.get('x-linc-api-key');

    if (!configuredKey) {
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

module.exports = { validateApiKey };
