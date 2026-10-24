const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCAL_DB_FILE = process.env.LINC_DATA_FILE || path.join(__dirname, 'linc_data.json');
const SUPABASE_TABLE = 'linc_users';

function hasSupabaseConfig() {
    const projectUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const hasCanonicalProjectUrl =
        typeof projectUrl === 'string' &&
        projectUrl.length > 0 &&
        projectUrl === projectUrl.trim() &&
        !/[\\u0000-\\u001F\\u007F]/.test(projectUrl);
    const hasCanonicalServiceKey =
        typeof serviceKey === 'string' &&
        serviceKey.length > 0 &&
        serviceKey === serviceKey.trim() &&
        !/[\\u0000-\\u001F\\u007F]/.test(serviceKey);

    return hasCanonicalProjectUrl && hasCanonicalServiceKey;
}

function isDatabaseConfigured() {
    if (hasSupabaseConfig()) return isSupabaseUrlAllowed();
    return !(process.env.VERCEL || process.env.VERCEL_ENV);
}

function assertDatabaseAvailable() {
    if (hasSupabaseConfig()) return;
    if (process.env.VERCEL || process.env.VERCEL_ENV) {
        const error = new Error('Supabase is not configured for this deployment');
        error.code = 'DB_NOT_CONFIGURED';
        throw error;
    }
}

function emptyState() {
    return { schools: {}, users: {}, revenue: { total: 0 }, outbox: [] };
}

function readLocalState() {
    if (!fs.existsSync(LOCAL_DB_FILE)) {
        fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(emptyState(), null, 2), 'utf8');
    }
    const state = JSON.parse(fs.readFileSync(LOCAL_DB_FILE, 'utf8'));
    if (!Array.isArray(state.outbox)) state.outbox = [];
    if (!state.users || typeof state.users !== 'object' || Array.isArray(state.users)) {
        state.users = {};
    }
    return state;
}

function writeLocalState(state) {
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function supabaseBaseUrl() {
    const rawUrl = process.env.SUPABASE_URL;

    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
        const error = new Error('Supabase URL is not configured');
        error.code = 'DB_NOT_CONFIGURED';
        throw error;
    }

    let parsed;
    try {
        parsed = new URL(rawUrl.trim());
    } catch (_) {
        const error = new Error('Supabase URL is invalid');
        error.code = 'DB_NOT_CONFIGURED';
        throw error;
    }

    // Never send the service-role key to URLs containing userinfo, query/hash
    // data, or paths outside the documented Project URL and optional /rest/v1.
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        !['', '/rest/v1'].includes(pathname)
    ) {
        const error = new Error('Supabase URL is invalid');
        error.code = 'DB_NOT_CONFIGURED';
        throw error;
    }

    const runningOnVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    const hostname = parsed.hostname.toLowerCase();
    const standardSupabaseHost =
        hostname.endsWith('.supabase.co') &&
        hostname.length > '.supabase.co'.length;
    const loopbackHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
    const allowedHttpsHost = parsed.protocol === 'https:' &&
        standardSupabaseHost &&
        parsed.port === '';
    const allowedLocalHttp = !runningOnVercel &&
        parsed.protocol === 'http:' &&
        loopbackHost;

    if (!allowedHttpsHost && !allowedLocalHttp) {
        const error = new Error('Supabase URL is not an allowed API endpoint');
        error.code = 'DB_NOT_CONFIGURED';
        throw error;
    }

    // Accept either the Supabase Project URL or its /rest/v1 base path.
    // supabaseRequest appends /rest/v1, so always return the origin only.
    return parsed.origin;
}

function isSupabaseUrlAllowed() {
    try {
        supabaseBaseUrl();
        return true;
    } catch (_) {
        return false;
    }
}

const DATABASE_REQUEST_TIMEOUT_MS = 8000;

async function supabaseRequest(resource, options = {}) {
    assertDatabaseAvailable();

    if (!hasSupabaseConfig()) {
        const error = new Error('Supabase is not configured');
        error.code = 'DB_NOT_CONFIGURED';
        throw error;
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const requestUrl = `${supabaseBaseUrl()}/rest/v1/${resource}`;
    const requestOptions = {
        ...options,
        // Do not forward the custom `apikey` header through a cross-origin redirect.
        // A Project URL should answer the REST request directly; any redirect is an error.
        redirect: 'error',
        signal: options.signal || AbortSignal.timeout(DATABASE_REQUEST_TIMEOUT_MS),
        headers: {
            apikey: serviceKey,
            ...(!serviceKey.startsWith('sb_secret_')
                ? { Authorization: `Bearer ${serviceKey}` }
                : {}),
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    };

    let response;

    try {
        response = await fetch(requestUrl, requestOptions);
    } catch (_) {
        const error = new Error('Database service is temporarily unavailable');
        error.code = 'DB_UNAVAILABLE';
        throw error;
    }

    if (!response.ok) {
        let upstreamCode = null;

        try {
            const payload = await response.clone().json();

            if (
                payload &&
                typeof payload.code === 'string' &&
                /^[A-Z0-9_]{3,24}$/.test(payload.code)
            ) {
                upstreamCode = payload.code;
            }
        } catch (_) {
            // Ignore non-JSON or timed-out error bodies; never expose upstream content.
        }

        const error = new Error('Database request failed');
        error.code = 'DB_UNAVAILABLE';
        error.status = response.status;
        error.upstreamCode = upstreamCode;
        throw error;
    }

    try {
        const body = await response.text();
        return body ? JSON.parse(body) : null;
    } catch (_) {
        const error = new Error('Database response is temporarily unavailable');
        error.code = 'DB_UNAVAILABLE';
        throw error;
    }
}

function normalizeSupabaseUser(row) {
    const data = row && row.data && typeof row.data === 'object' ? row.data : {};
    return {
        ...data,
        userId: row.user_id,
        grade: row.grade || data.grade || 'M1',
        guardianLineId: row.guardian_line_id !== undefined ? row.guardian_line_id : (data.guardianLineId ?? null),
        createdAt: row.created_at ?? data.createdAt,
        lastHeartbeat: row.last_heartbeat ?? data.lastHeartbeat ?? null,
        status: row.status === 'app_deleted' || data.status === 'app_deleted'
            ? 'app_deleted'
            : (row.status || data.status)
    };
}

// Encode untrusted identifiers as a single PostgREST filter value.
function encodePostgrestFilterValue(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, character =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

async function getUser(userId) {
    assertDatabaseAvailable();
    if (!hasSupabaseConfig()) {
        const state = readLocalState();
        return Object.hasOwn(state.users, userId) ? state.users[userId] : null;
    }

    const rows = await supabaseRequest(
        `${SUPABASE_TABLE}?user_id=eq.${encodePostgrestFilterValue(userId)}&select=user_id,grade,guardian_line_id,created_at,last_heartbeat,status,data&limit=1`
    );

    if (
        !Array.isArray(rows) ||
        rows.some(row =>
            !row ||
            typeof row !== 'object' ||
            Array.isArray(row) ||
            typeof row.user_id !== 'string'
        )
    ) {
        const error = new Error('Database response has an unexpected shape');
        error.code = 'DB_UNAVAILABLE';
        throw error;
    }

    return rows.length ? normalizeSupabaseUser(rows[0]) : null;
}

async function saveUser(user) {
    if (!user || typeof user.userId !== 'string' || !user.userId.trim()) {
        throw new TypeError('A valid userId is required');
    }
    assertDatabaseAvailable();

    if (!hasSupabaseConfig()) {
        const state = readLocalState();
        Object.defineProperty(state.users, user.userId, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: user
        });
        writeLocalState(state);
        return user;
    }

    const row = {
        user_id: user.userId,
        grade: user.grade || 'M1',
        guardian_line_id: user.guardianLineId || null,
        created_at: user.createdAt || Date.now(),
        last_heartbeat: user.lastHeartbeat ?? null,
        status: user.status || 'active',
        data: user,
        updated_at: new Date().toISOString()
    };
    await supabaseRequest(`${SUPABASE_TABLE}?on_conflict=user_id`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row)
    });
    return user;
}


async function recordAppTermination(userId) {
    if (
        typeof userId !== 'string' ||
        !userId.trim() ||
        userId.length > 200
    ) {
        throw new TypeError('A valid userId is required');
    }

    assertDatabaseAvailable();

    if (hasSupabaseConfig()) {
        const result = await supabaseRequest('rpc/linc_record_app_termination', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ p_user_id: userId })
        });

        const allowedResultKeys = new Set([
            'found',
            'alreadyRecorded',
            'deletedAt',
            'eventId',
            'eventStatus',
            'guardianLinked'
        ]);
        const validBase =
            result &&
            typeof result === 'object' &&
            !Array.isArray(result) &&
            Object.keys(result).every(key => allowedResultKeys.has(key)) &&
            typeof result.found === 'boolean' &&
            typeof result.alreadyRecorded === 'boolean';

        const validNotFound =
            result.found === false &&
            result.alreadyRecorded === false &&
            result.eventId === null &&
            result.eventStatus === null &&
            result.guardianLinked === false &&
            (result.deletedAt === undefined || result.deletedAt === null);

        const validAlreadyRecorded =
            result.found === true &&
            result.alreadyRecorded === true &&
            result.guardianLinked === false &&
            (result.eventId === undefined || result.eventId === null) &&
            (result.eventStatus === undefined || result.eventStatus === null) &&
            (
                result.deletedAt === undefined ||
                result.deletedAt === null ||
                Number.isSafeInteger(result.deletedAt)
            );

        const validNewRecord =
            result.found === true &&
            result.alreadyRecorded === false &&
            typeof result.eventId === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.eventId) &&
            result.eventStatus === 'blocked' &&
            result.guardianLinked === false &&
            Number.isSafeInteger(result.deletedAt);

        if (!validBase || !(validNotFound || validAlreadyRecorded || validNewRecord)) {
            const error = new Error('App termination RPC returned an unexpected response');
            error.code = 'DB_UNAVAILABLE';
            throw error;
        }

        return {
            found: result.found,
            alreadyRecorded: result.alreadyRecorded,
            eventId: result.eventId || null,
            eventStatus: result.eventStatus || null,
            guardianLinked: Boolean(result.guardianLinked),
            deletedAt: Number.isSafeInteger(result.deletedAt) ? result.deletedAt : null
        };
    }

    const state = readLocalState();
    if (!Object.hasOwn(state.users, userId)) {
        return {
            found: false,
            alreadyRecorded: false,
            eventId: null,
            eventStatus: null,
            guardianLinked: false,
            deletedAt: null
        };
    }

    const user = state.users[userId];
    // A stored legacy ID is not proof of provider-verified pairing/consent.
    const guardianLinked = false;
    const isAlreadyDeleted =
        user.status === 'app_deleted' ||
        (user.data && user.data.status === 'app_deleted');

    if (isAlreadyDeleted) {
        user.status = 'app_deleted';
        writeLocalState(state);
        return {
            found: true,
            alreadyRecorded: true,
            eventId: null,
            eventStatus: null,
            guardianLinked,
            deletedAt: Number.isSafeInteger(user.deletedAt) ? user.deletedAt : null
        };
    }

    const deletedAt = Date.now();
    const eventId = crypto.randomUUID();
    const eventStatus = 'blocked';

    user.status = 'app_deleted';
    user.deletedAt = deletedAt;
    state.outbox.push({
        eventId,
        userId,
        recipientLineId: null,
        eventType: 'APP_TERMINATION_SIGNAL',
        eventStatus,
        attempts: 0,
        nextAttemptAt: deletedAt,
        lastErrorCode: null,
        payload: { reason: 'APP_TERMINATION_SIGNAL' },
        createdAt: deletedAt,
        sentAt: null
    });

    // Profile transition and outbox event are persisted in the same local-file write.
    writeLocalState(state);

    return {
        found: true,
        alreadyRecorded: false,
        eventId,
        eventStatus,
        guardianLinked,
        deletedAt
    };
}


async function consumeInternalAssertion(assertionId, expiresAt) {
    // Replay protection must use durable shared storage, never the local JSON
    // adapter or an in-memory cache that differs between serverless instances.
    if (!hasSupabaseConfig()) {
        const error = new Error('Durable assertion replay storage is not configured');
        error.code = 'DB_NOT_CONFIGURED';
        throw error;
    }

    if (
        typeof assertionId !== 'string' ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(assertionId) ||
        !Number.isSafeInteger(expiresAt)
    ) {
        throw new TypeError('A valid assertion replay record is required');
    }

    const accepted = await supabaseRequest('rpc/linc_consume_auth_assertion', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
            p_jti: assertionId,
            p_expires_at: expiresAt
        })
    });

    if (typeof accepted !== 'boolean') {
        const error = new Error('Assertion replay storage returned an unexpected response');
        error.code = 'DB_UNAVAILABLE';
        throw error;
    }

    return accepted;
}

function classifyDatabaseFailure(error) {
    const code = error && error.upstreamCode;
    if (code === 'PGRST125') return 'invalid_rest_url';
    if (code === 'PGRST205' || code === '42P01') return 'table_missing';
    if (code === '42501') return 'database_permission_denied';
    if (error && (error.status === 401 || error.status === 403)) return 'database_auth_failed';
    return 'database_unavailable';
}

async function checkDatabaseConnection() {
    if (!hasSupabaseConfig()) return false;
    const rows = await supabaseRequest(`${SUPABASE_TABLE}?select=user_id&limit=1`);
    return Array.isArray(rows) && rows.every(row =>
        row && typeof row === 'object' &&
        !Array.isArray(row) && typeof row.user_id === 'string'
    );
}

function calculateWeightedRevenue(grade, studentCount) {
    let weight = 1;
    const cleanGrade = String(grade).trim();
    if (cleanGrade === 'M1' || cleanGrade === 'M4') weight = 3;
    else if (cleanGrade === 'M2' || cleanGrade === 'M5') weight = 2;
    else if (cleanGrade === 'M3' || cleanGrade === 'M6') weight = 1;

    const count = Number(studentCount);
    if (!Number.isFinite(count) || count < 0) {
        throw new TypeError('studentCount must be a non-negative number');
    }
    return count * 100 * weight;
}

module.exports = {
    hasSupabaseConfig,
    isDatabaseConfigured,
    getUser,
    saveUser,
    checkDatabaseConnection,
    recordAppTermination,
    consumeInternalAssertion,
    classifyDatabaseFailure,
    calculateWeightedRevenue
};
