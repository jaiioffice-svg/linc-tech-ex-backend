const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { handleUserRegistration, handleHeartbeat, handleImmediateDelete } = require('./controllers');
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

// Preserve the existing heartbeat contract and support explicit profile registration.
app.post('/api/v1/heartbeat', validateApiKey, handleHeartbeat);
app.post('/api/v1/users/register', validateApiKey, handleUserRegistration);
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

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Linc Core Backend active and secure on port ${PORT}`);
    });
}

module.exports = app;
