const fs = require('fs');
const path = require('path');

const LOCAL_DB_FILE = process.env.LINC_DATA_FILE || path.join(__dirname, 'linc_data.json');
const SUPABASE_TABLE = 'linc_users';

function hasSupabaseConfig() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isDatabaseConfigured() {
    return hasSupabaseConfig() || !(process.env.VERCEL || process.env.VERCEL_ENV);
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
    return { schools: {}, users: {}, revenue: { total: 0 } };
}

function readLocalState() {
    if (!fs.existsSync(LOCAL_DB_FILE)) {
        fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(emptyState(), null, 2), 'utf8');
    }
    return JSON.parse(fs.readFileSync(LOCAL_DB_FILE, 'utf8'));
}

function writeLocalState(state) {
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function supabaseBaseUrl() {
    // Accept either the Supabase Project URL or a URL copied with /rest/v1.
    // The REST path is appended by supabaseRequest, so retaining it here would
    // create /rest/v1/rest/v1/... and PostgREST responds with PGRST125.
    return process.env.SUPABASE_URL
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/rest\/v1$/i, '');
}

async function supabaseRequest(resource, options = {}) {
    assertDatabaseAvailable();
    if (!hasSupabaseConfig()) {
        const error = new Error('Supabase is not configured');
        error.code = 'DB_NOT_CONFIGURED';
        throw error;
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    let response;
    try {
        response = await fetch(`${supabaseBaseUrl()}/rest/v1/${resource}`, {
            ...options,
            headers: {
                // New Supabase sb_secret_* keys are opaque API keys, not JWTs.
                // Send them only through the apikey header; putting one in
                // Authorization: Bearer makes Supabase attempt JWT validation.
                apikey: serviceKey,
                ...(!serviceKey.startsWith('sb_secret_')
                    ? { Authorization: `Bearer ${serviceKey}` }
                    : {}),
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
    } catch (_) {
        const error = new Error('Database service is temporarily unavailable');
        error.code = 'DB_UNAVAILABLE';
        throw error;
    }

    if (!response.ok) {
        // Keep upstream diagnostics safe: only retain a short PostgREST error code,
        // never log or return the upstream response body or database details.
        let upstreamCode = null;
        try {
            const payload = await response.clone().json();
            if (payload && typeof payload.code === 'string' &&
                /^[A-Z0-9_]{3,24}$/.test(payload.code)) {
                upstreamCode = payload.code;
            }
        } catch (_) {
            // Non-JSON responses (for example, an incorrect project URL) are expected here.
        }
        const error = new Error('Database request failed');
        error.code = 'DB_UNAVAILABLE';
        error.status = response.status;
        error.upstreamCode = upstreamCode;
        throw error;
    }

    const body = await response.text();
    return body ? JSON.parse(body) : null;
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
    return Array.isArray(rows);
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
    classifyDatabaseFailure,
    calculateWeightedRevenue
};
