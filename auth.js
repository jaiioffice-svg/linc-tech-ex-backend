const API_KEY = process.env.LINC_API_KEY || 'linc_secure_key_2026';

function validateApiKey(req, res, next) {
    const incomingKey = req.headers['x-linc-api-key'];
    if (!incomingKey || incomingKey !== API_KEY) {
        return res.status(401).json({ success: false, message: 'Unauthorized connection' });
    }
    next();
}

module.exports = { validateApiKey };