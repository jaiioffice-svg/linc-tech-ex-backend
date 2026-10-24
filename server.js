const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { handleUserRegistration, handleHeartbeat, handleImmediateDelete } = require('./controllers');
const { validateApiKey, requireVerifiedEndUser } = require('./auth');
const { isDatabaseConfigured, checkDatabaseConnection, classifyDatabaseFailure } = require('./db');

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

// These routes intentionally fail closed until an approved, server-verified
// end-user session contract is wired in before requireVerifiedEndUser.
// LINC_API_KEY alone is service authentication, not end-user authentication.
app.post('/api/v1/heartbeat', validateApiKey, requireVerifiedEndUser, handleHeartbeat);
app.post('/api/v1/users/register', validateApiKey, requireVerifiedEndUser, handleUserRegistration);
app.post('/api/v1/alert/delete', validateApiKey, requireVerifiedEndUser, (req, res) => handleImmediateDelete(req, res, sendEmergencySignal));

app.get('/health', (req, res) => res.status(200).json({ status: 'operational', timestamp: Date.now() }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'operational', timestamp: Date.now() }));

async function readinessHandler(req, res) {
    if (!isDatabaseConfigured()) {
        return res.status(503).json({ status: 'not_ready', reason: 'database_not_configured' });
    }
    try {
        const connected = await checkDatabaseConnection();
        if (!connected) {
            return res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
        }
        return res.status(200).json({ status: 'ready' });
    } catch (error) {
        const reason = classifyDatabaseFailure(error);
        console.error('[READINESS] database check failed', error && error.code ? error.code : 'DB_UNAVAILABLE', error && error.status ? error.status : 'NO_STATUS', error && error.upstreamCode ? error.upstreamCode : 'NO_UPSTREAM_CODE', reason);
        return res.status(503).json({ status: 'not_ready', reason });
    }
}
app.get('/ready', readinessHandler);
app.get('/api/ready', readinessHandler);

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Linc Core Backend active and secure on port ${PORT}`);
    });
}

module.exports = app;
