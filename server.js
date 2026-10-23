const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { handleHeartbeat, handleImmediateDelete } = require('./controllers');
const { runHeartbeatCheck, startHeartbeatMonitor } = require('./checker');
const { validateApiKey } = require('./auth');
const { sendGuardianAlert } = require('./line-alert');
const { isDatabaseConfigured, hasSupabaseConfig } = require('./db');

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(cors());
app.use(helmet());

async function recordAlertEvent(alertPayload) {
    try {
        const result = await sendGuardianAlert(alertPayload);
        if (!result.sent) {
            console.warn('[ALERT_PENDING]', JSON.stringify({
                reason: alertPayload.reason,
                guardianLinked: Boolean(alertPayload.guardianLineId),
                deliveryReason: result.reason
            }));
        }
    } catch (error) {
        console.error('[LINE_ALERT] delivery failed', error && error.name ? error.name : 'ERROR');
    }
}

app.post('/api/v1/heartbeat', validateApiKey, handleHeartbeat);
app.post('/api/v1/alert/delete', validateApiKey, (req, res) =>
    handleImmediateDelete(req, res, recordAlertEvent)
);

app.get('/health', (req, res) => res.status(200).json({
    status: 'operational',
    service: 'linc-tech-ex-backend',
    timestamp: Date.now()
}));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'operational', timestamp: Date.now() }));

app.get('/ready', async (req, res) => {
    if (!hasSupabaseConfig()) {
        return res.status(503).json({ status: 'not_ready', reason: 'database_not_configured' });
    }
    try {
        const { getUser } = require('./db');
        await getUser('__linc_readiness_probe_nonexistent__');
        return res.status(200).json({ status: 'ready', database: 'reachable' });
    } catch (error) {
        console.error('[READINESS] database check failed', error && error.code ? error.code : 'INTERNAL_ERROR');
        return res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
    }
});

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
        const result = await runHeartbeatCheck(recordAlertEvent);
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error('[HEARTBEAT_CRON] run failed', error && error.code ? error.code : 'INTERNAL_ERROR');
        return res.status(503).json({ success: false, message: 'Heartbeat check is unavailable' });
    }
});

if (require.main === module) {
    if (!(process.env.VERCEL || process.env.VERCEL_ENV)) startHeartbeatMonitor(recordAlertEvent);
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Linc Core Backend listening on port ${port}`));
}

module.exports = app;
