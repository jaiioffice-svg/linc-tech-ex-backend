const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { handleHeartbeat, handleImmediateDelete } = require('./controllers');
const { validateApiKey } = require('./auth');

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(cors());
app.use(helmet());

function sendEmergencySignal(alertPayload) {
    // This is logging only; LINE delivery must be implemented and verified separately.
    console.log('[ALERT_PENDING_LINE_INTEGRATION]', JSON.stringify({
        guardianLineId: alertPayload.guardianLineId || null,
        userId: alertPayload.userId,
        reason: alertPayload.reason
    }));
}

app.post('/api/v1/heartbeat', validateApiKey, handleHeartbeat);
app.post('/api/v1/alert/delete', validateApiKey, (req, res) =>
    handleImmediateDelete(req, res, sendEmergencySignal)
);

// Liveness endpoint: confirms that the serverless function can start and respond.
// It does not claim that the database or LINE integration is healthy.
app.get('/health', (req, res) => res.status(200).json({
    status: 'operational',
    service: 'linc-tech-ex-backend',
    timestamp: Date.now()
}));

// Vercel invokes the exported Express app. Listen only when running locally.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Linc Core Backend listening on port ${PORT}`);
    });
}

module.exports = app;
