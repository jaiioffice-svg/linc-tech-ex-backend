const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { notFoundHandler, errorHandler } = require('./error-handler');
const { validateUserRequest } = require('./request-validation');
const {
    handleUserRegistration,
    handleHeartbeat,
    handleImmediateDelete
} = require('./controllers');
const {
    validateApiKey,
    requireVerifiedEndUser
} = require('./auth');
const {
    isDatabaseConfigured,
    checkDatabaseConnection,
    classifyDatabaseFailure
} = require('./db');

const app = express();

function getAllowedOrigins() {
    return (process.env.LINC_ALLOWED_ORIGINS || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .filter(value => {
            try {
                const parsed = new URL(value);
                return ['http:', 'https:'].includes(parsed.protocol) &&
                    parsed.origin === value;
            } catch (_) {
                return false;
            }
        });
}

app.use(express.json({ limit: '64kb' }));

app.use(cors({
    origin(origin, callback) {
        if (typeof origin !== 'string' || !origin) {
            return callback(null, true);
        }
        return callback(null, getAllowedOrigins().includes(origin));
    }
}));

app.use(helmet());

function sendEmergencySignal(alertPayload) {
    console.warn('[ALERT_PENDING]', JSON.stringify({
        userId: alertPayload.userId,
        reason: alertPayload.reason,
        guardianLinked: Boolean(alertPayload.guardianLineId)
    }));
}

app.post(
    '/api/v1/heartbeat',
    validateApiKey,
    requireVerifiedEndUser,
    validateUserRequest,
    handleHeartbeat
);

app.post(
    '/api/v1/users/register',
    validateApiKey,
    requireVerifiedEndUser,
    validateUserRequest,
    handleUserRegistration
);

app.post(
    '/api/v1/alert/delete',
    validateApiKey,
    requireVerifiedEndUser,
    validateUserRequest,
    (req, res) => handleImmediateDelete(req, res, sendEmergencySignal)
);

app.get('/health', (req, res) => res.status(200).json({
    status: 'operational',
    timestamp: Date.now()
}));

app.get('/api/health', (req, res) => res.status(200).json({
    status: 'operational',
    timestamp: Date.now()
}));

async function readinessHandler(req, res) {
    if (!isDatabaseConfigured()) {
        return res.status(503).json({
            status: 'not_ready',
            reason: 'database_not_configured'
        });
    }

    try {
        const connected = await checkDatabaseConnection();

        if (!connected) {
            return res.status(503).json({
                status: 'not_ready',
                reason: 'database_unavailable'
            });
        }

        return res.status(200).json({ status: 'ready' });
    } catch (error) {
        const reason = classifyDatabaseFailure(error);

        console.error(
            '[READINESS] database check failed',
            error && error.code ? error.code : 'DB_UNAVAILABLE',
            error && error.status ? error.status : 'NO_STATUS',
            error && error.upstreamCode ? error.upstreamCode : 'NO_UPSTREAM_CODE',
            reason
        );

        return res.status(503).json({
            status: 'not_ready',
            reason
        });
    }
}

app.get('/ready', readinessHandler);
app.get('/api/ready', readinessHandler);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Linc Core Backend active and secure on port ${PORT}`);
    });
}

module.exports = app;
