const crypto = require('crypto');
const { runHeartbeatCheck } = require('../../checker');

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

    try {
        const result = await runHeartbeatCheck(alert => {
            console.warn('[ALERT_PENDING]', JSON.stringify({
                userId: alert.userId,
                reason: alert.reason,
                guardianLinked: Boolean(alert.guardianLineId)
            }));
        });
        return res.status(200).json({ success: true, ...result });
    } catch (_) {
        return res.status(503).json({ success: false, message: 'Storage service unavailable' });
    }
};
