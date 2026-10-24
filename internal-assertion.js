const crypto = require('crypto');
const { consumeInternalAssertion } = require('./db');

const ASSERTION_HEADER = 'x-linc-user-assertion';
const EXPECTED_ISSUER = 'linc-client-bff';
const EXPECTED_AUDIENCE = 'linc-backend';
const MAX_ASSERTION_BYTES = 4096;
const MAX_ASSERTION_TTL_SECONDS = 60;
const ALLOWED_CLAIMS = new Set(['iss', 'aud', 'sub', 'iat', 'exp', 'jti', 'scope', 'nbf']);
const ALLOWED_SCOPES = new Set([
    '/api/v1/heartbeat',
    '/api/v1/users/register',
    '/api/v1/alert/delete'
]);

function rejectAssertion(res) {
    return res.status(401).json({
        success: false,
        message: 'Unauthorized connection'
    });
}

function parseBase64UrlJson(segment) {
    if (
        typeof segment !== 'string' ||
        !segment ||
        !/^[A-Za-z0-9_-]+$/.test(segment)
    ) {
        throw new Error('Invalid assertion encoding');
    }

    const decoded = Buffer.from(segment, 'base64url');
    const normalized = decoded.toString('base64url');

    if (normalized !== segment) {
        throw new Error('Non-canonical assertion encoding');
    }

    return JSON.parse(decoded.toString('utf8'));
}

function safeEqual(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createInternalAssertionMiddleware({ consumeAssertionId = consumeInternalAssertion } = {}) {
    return async function authenticateInternalAssertion(req, res, next) {
    const secret = process.env.LINC_INTERNAL_AUTH_SECRET;

    if (
        typeof secret !== 'string' ||
        Buffer.byteLength(secret, 'utf8') < 32 ||
        secret !== secret.trim() ||
        /[\x00-\x1F\x7F]/.test(secret)
    ) {
        return res.status(503).json({
            success: false,
            message: 'End-user identity verification is not configured'
        });
    }

    const token = req.get(ASSERTION_HEADER);

    if (
        typeof token !== 'string' ||
        !token ||
        Buffer.byteLength(token, 'utf8') > MAX_ASSERTION_BYTES
    ) {
        return rejectAssertion(res);
    }

    try {
        const parts = token.split('.');
        if (parts.length !== 3) return rejectAssertion(res);

        const [encodedHeader, encodedPayload, encodedSignature] = parts;
        const header = parseBase64UrlJson(encodedHeader);

        if (
            !header ||
            typeof header !== 'object' ||
            Array.isArray(header) ||
            header.alg !== 'HS256' ||
            header.typ !== 'JWT' ||
            Object.keys(header).some(key => key !== 'alg' && key !== 'typ')
        ) {
            return rejectAssertion(res);
        }

        if (
            !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
            !/^[A-Za-z0-9_-]+$/.test(encodedSignature)
        ) {
            return rejectAssertion(res);
        }

        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(`${encodedHeader}.${encodedPayload}`)
            .digest();

        const receivedSignature = Buffer.from(encodedSignature, 'base64url');
        if (
            receivedSignature.toString('base64url') !== encodedSignature ||
            !safeEqual(expectedSignature, receivedSignature)
        ) {
            return rejectAssertion(res);
        }

        const claims = parseBase64UrlJson(encodedPayload);
        const now = Math.floor(Date.now() / 1000);

        if (
            !claims ||
            typeof claims !== 'object' ||
            Array.isArray(claims) ||
            Object.keys(claims).some(key => !ALLOWED_CLAIMS.has(key)) ||
            claims.iss !== EXPECTED_ISSUER ||
            claims.aud !== EXPECTED_AUDIENCE ||
            typeof claims.sub !== 'string' ||
            !claims.sub.trim() ||
            claims.sub !== claims.sub.trim() ||
            /[\x00-\x1F\x7F]/.test(claims.sub) ||
            claims.sub.length > 200 ||
            !Number.isSafeInteger(claims.iat) ||
            !Number.isSafeInteger(claims.exp) ||
            claims.iat > now + 5 ||
            claims.exp <= now ||
            claims.exp <= claims.iat ||
            claims.exp - claims.iat > MAX_ASSERTION_TTL_SECONDS ||
            typeof claims.jti !== 'string' ||
            !/^[A-Za-z0-9_-]{16,128}$/.test(claims.jti) ||
            typeof claims.scope !== 'string' ||
            !ALLOWED_SCOPES.has(claims.scope) ||
            req.method !== 'POST' ||
            claims.scope !== req.path
        ) {
            return rejectAssertion(res);
        }

        if (
            claims.nbf !== undefined &&
            (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 5 || claims.nbf >= claims.exp)
        ) {
            return rejectAssertion(res);
        }

        const requestedUserId = req.body && req.body.userId;
        if (requestedUserId !== undefined && requestedUserId !== claims.sub) {
            return res.status(403).json({
                success: false,
                message: 'Requested user does not match authenticated identity'
            });
        }

        let consumed;
        try {
            consumed = await consumeAssertionId(claims.jti, claims.exp);
        } catch (error) {
            const reason = error && error.code === 'DB_NOT_CONFIGURED'
                ? 'DB_NOT_CONFIGURED'
                : 'DB_UNAVAILABLE';
            console.error('[ASSERTION_REPLAY_STORE]', reason);
            return res.status(503).json({
                success: false,
                message: 'Identity verification service is temporarily unavailable'
            });
        }

        if (consumed !== true) {
            return rejectAssertion(res);
        }

        req.auth = Object.freeze({
            userId: claims.sub,
            issuer: EXPECTED_ISSUER,
            assertionId: claims.jti,
            expiresAt: claims.exp
        });

        return next();
    } catch (_) {
        return rejectAssertion(res);
    }
    };
}

const authenticateInternalAssertion = createInternalAssertionMiddleware();

module.exports = {
    authenticateInternalAssertion,
    createInternalAssertionMiddleware
};
