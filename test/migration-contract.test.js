const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const db = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261024_linc_users_backend.sql'),
    'utf8'
);
const createTable = migration.match(
    /create table if not exists public\.linc_users\s*\(([\s\S]*?)\n\);/i
)?.[1] || '';
const addColumns = migration.match(
    /alter table public\.linc_users([\s\S]*?);/i
)?.[1] || '';

function isDeclared(column) {
    const createPattern = new RegExp('^\\s*' + column + '\\s+', 'im');
    const alterPattern = new RegExp('add column if not exists\\s+' + column + '\\b', 'i');
    return createPattern.test(createTable) || alterPattern.test(addColumns);
}

test('base migration declares every column selected and written by the repository layer', () => {
    const selectMatch = db.match(/select=([^'`]+)&limit=1/);
    assert.ok(selectMatch, 'db.js must expose a recognizable SELECT column list');
    const selectedColumns = selectMatch[1].split(',').map(column => column.trim());

    const rowMatch = db.match(/const row = \{([\s\S]*?)\n\s*\};/);
    assert.ok(rowMatch, 'db.js must expose a recognizable persisted row shape');
    const writtenColumns = [...rowMatch[1].matchAll(/^\s*([a-z_]+)\s*:/gm)]
        .map(match => match[1]);

    const requiredColumns = [...new Set([...selectedColumns, ...writtenColumns])];
    for (const column of requiredColumns) {
        assert.ok(isDeclared(column), `migration does not define or add ${column}`);
    }
});

test('repository timestamp conversion matches BIGINT epoch-millisecond schema', () => {
    assert.match(db, /function toEpochMilliseconds\(/);
    assert.match(createTable, /^\s*created_at\s+bigint\b/im);
    assert.match(createTable, /^\s*last_heartbeat\s+bigint\b/im);
    assert.match(createTable, /^\s*updated_at\s+timestamptz\b/im);
});

test('user upsert conflict key is unique in the migration', () => {
    assert.match(db, /on_conflict=user_id/);
    assert.match(createTable, /^\s*user_id\s+text\s+primary key\b/im);
    assert.match(migration, /create unique index if not exists linc_users_user_id_uidx[\s\S]*?on public\.linc_users \(user_id\)/i);
});
