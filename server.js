const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { handleHeartbeat, handleImmediateDelete } = require('./controllers');
const { runHeartbeatCheck, startHeartbeatMonitor } = require('./checker');
const { validateApiKey } = require('./auth');
const { isDatabaseConfigured } = require('./db');

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(cors());
app.use(helmet());

function sendEmergencySignal(alertPayload) {
    // Notification delivery is not integrated yet. Keep guardian IDs out of logs.
    console.warn('[ALERT_PENDING]', JSON.stringify({
        userId: alertPayload.userId,
        reason: alertPayload.reason,
        guardianLinked: Boolean(alertPayload.guardianLineId)
    }));
}

// Vercel imports this module as a serverless function. Keep background timers
// and the local HTTP listener out of that execution path.
if (require.main === module) {
    startHeartbeatMonitor(sendEmergencySignal);
}

app.post('/api/v1/heartbeat', validateApiKey, handleHeartbeat);
app.post('/api/v1/alert/delete', validateApiKey, (req, res) => handleImmediateDelete(req, res, sendEmergencySignal));

app.get('/health', (req, res) => res.status(200).json({ status: 'operational', timestamp: Date.now() }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'operational', timestamp: Date.now() }));
function readinessHandler(req, res) {
    if (!isDatabaseConfigured()) {
        return res.status(503).json({ status: 'not_ready', reason: 'database_not_configured' });
    }
    return res.status(200).json({ status: 'ready' });
}
app.get('/ready', readinessHandler);
app.get('/api/ready', readinessHandler);

app.get('/api/cron/check-heartbeats', async (req, res) => {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) {
        return res.status(503).json({ success: false, message: 'Cron authentication is not configured' });
    }

    const authorization = req.get('authorization') || '';
    const prefix = 'Bearer ';
    if (!authorization.startsWith(prefix)) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const incoming = Buffer.from(authorization.slice(prefix.length), 'utf8');
    const expected = Buffer.from(expectedSecret, 'utf8');
    if (incoming.length !== expected.length || !crypto.timingSafeEqual(incoming, expected)) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const result = await runHeartbeatCheck(sendEmergencySignal);
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error('[HEARTBEAT_CRON] run failed', error && error.code ? error.code : 'INTERNAL_ERROR');
        return res.status(503).json({ success: false, message: 'Heartbeat check is unavailable' });
    }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Linc Core Backend active and secure on port ${PORT}`);
    });
}

module.exports = app;
