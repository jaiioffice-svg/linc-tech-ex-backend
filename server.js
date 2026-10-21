const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { handleHeartbeat, handleImmediateDelete } = require('./controllers');
const { startHeartbeatMonitor } = require('./checker');
const { validateApiKey } = require('./auth');

const app = express();
app.use(express.json());
app.use(cors());
app.use(helmet());

function sendEmergencySignal(alertPayload) {
    console.log(`[ALERT] Gateway signal sent to Guardian ${alertPayload.guardianLineId}. User: ${alertPayload.userId}`);
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

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Linc Core Backend active and secure on port ${PORT}`);
    });
}

module.exports = app;
