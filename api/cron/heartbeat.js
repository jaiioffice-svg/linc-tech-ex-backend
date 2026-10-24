const crypto = require('crypto');

// Heartbeat monitoring is intentionally deferred for this release.
// This placeholder is not mounted by the current vercel.json routing.
module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const cronSecret = process.env.CRON_SECRET;
    const authorization = req.headers.authorization;
    if (!cronSecret) {
        return res.status(503).json({ success: false, message: 'Cron authentication is not configured' });
    }

    const expected = Buffer.from(`Bearer ${cronSecret}`);
    const received = Buffer.from(typeof authorization === 'string' ? authorization : '');
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
        return res.status(401).json({ success: false, message: 'Unauthorized connection' });
    }

    return res.status(501).json({
        success: false,
        message: 'Heartbeat monitoring is deferred for this release'
    });
};
