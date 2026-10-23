const fs = require('fs');
const path = require('path');

const LOCAL_DB_FILE = path.join(__dirname, 'linc_data.json');
const SUPABASE_TABLE = 'linc_users';

function hasSupabaseConfig() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isDatabaseConfigured() {
    return hasSupabaseConfig() || (!(process.env.VERCEL || process.env.VERCEL_ENV) && process.env.NODE_ENV !== 'production');
}

function assertDatabaseAvailable() {
    if (hasSupabaseConfig()) return;
    if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') {
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

// The existing Supabase schema stores created_at and last_heartbeat as BIGINT
// epoch milliseconds. Accept legacy ISO strings on reads for compatibility.
function toEpochMilliseconds(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const number = Number(value);
        return Number.isSafeInteger(number) ? number : null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function normalizeSupabaseUser(row) {
    return {
        userId: row.user_id,
        grade: row.grade || 'M1',
        guardianLineId: row.guardian_line_id || null,
        createdAt: toEpochMilliseconds(row.created_at) ?? Date.now(),
        lastHeartbeat: toEpochMilliseconds(row.last_heartbeat) ?? 0,
        status: row.status || 'active'
    };
}

function supabaseBaseUrl() {
    const value = process.env.SUPABASE_URL;
    if (!value) {
        const error = new Error('Supabase URL is not configured');
        error.code = 'DB_NOT_CONFIGURED';
        throw error;
    }
    return value.replace(/\/$/, '');
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
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
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
        const error = new Error('Database request failed');
        error.code = response.status === 401 || response.status === 403 ? 'DB_PERMISSION_DENIED' : 'DB_UNAVAILABLE';
        error.status = response.status;
        throw error;
    }

    const body = await response.text();
    return body ? JSON.parse(body) : null;
}

async function getUser(userId) {
    assertDatabaseAvailable();
    if (!hasSupabaseConfig()) {
        const state = readLocalState();
        return state.users[userId] || null;
    }

    const rows = await supabaseRequest(
        `${SUPABASE_TABLE}?user_id=eq.${encodeURIComponent(userId)}&select=user_id,grade,guardian_line_id,created_at,last_heartbeat,status&limit=1`
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
        state.users[user.userId] = user;
        writeLocalState(state);
        return user;
    }

    const now = Date.now();
    const row = {
        user_id: user.userId,
        grade: user.grade || 'M1',
        guardian_line_id: user.guardianLineId || null,
        created_at: toEpochMilliseconds(user.createdAt) ?? now,
        last_heartbeat: toEpochMilliseconds(user.lastHeartbeat) ?? now,
        status: user.status || 'active',
        updated_at: new Date(now).toISOString()
    };
    await supabaseRequest(`${SUPABASE_TABLE}?on_conflict=user_id`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row)
    });
    return user;
}

async function getStaleActiveUsers(cutoffTimestamp) {
    assertDatabaseAvailable();
    if (!hasSupabaseConfig()) {
        const state = readLocalState();
        return Object.values(state.users).filter(
            user => user.status === 'active' && Number(user.lastHeartbeat) < cutoffTimestamp
        );
    }

    const cutoff = toEpochMilliseconds(cutoffTimestamp);
    if (cutoff === null) throw new TypeError('A valid cutoff timestamp is required');
    const rows = await supabaseRequest(
        `${SUPABASE_TABLE}?status=eq.active&last_heartbeat=lt.${encodeURIComponent(String(cutoff))}&select=user_id,grade,guardian_line_id,created_at,last_heartbeat,status`
    );
    return rows.map(normalizeSupabaseUser);
}

function calculateWeightedRevenue(grade, studentCount) {
    let weight = 1;
    const cleanGrade = String(grade || '').trim();
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
    getStaleActiveUsers,
    calculateWeightedRevenue
};
