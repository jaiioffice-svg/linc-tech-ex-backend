const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20261024_003_auth_assertion_replay.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

test('replay migration creates a durable unique JTI store with expiry index', () => {
    assert.match(
        migration,
        /create table if not exists public\.linc_auth_assertion_replays\s*\([\s\S]*?jti text primary key/i
    );
    assert.match(migration, /expires_at bigint not null/i);
    assert.match(
        migration,
        /create index if not exists linc_auth_assertion_replays_expires_at_idx/i
    );
    assert.match(migration, /alter table public\.linc_auth_assertion_replays enable row level security/i);
});

test('replay RPC uses fixed search_path and atomic insert without upsert', () => {
    assert.match(migration, /create or replace function public\.linc_consume_auth_assertion/i);
    assert.match(migration, /security definer/i);
    assert.match(migration, /set search_path = pg_catalog, public, pg_temp/i);
    assert.match(migration, /delete from public\.linc_auth_assertion_replays\s+where expires_at <= v_now/i);
    assert.match(migration, /insert into public\.linc_auth_assertion_replays\s*\(jti, expires_at\)/i);
    assert.match(migration, /on conflict \(jti\) do nothing/i);
    assert.match(migration, /get diagnostics v_rows = row_count/i);
    assert.match(migration, /return v_rows = 1/i);
});

test('replay store denies direct client access and restricts RPC execution to service_role', () => {
    assert.match(
        migration,
        /revoke all on table public\.linc_auth_assertion_replays from anon, authenticated/i
    );
    assert.match(
        migration,
        /revoke all on function public\.linc_consume_auth_assertion\(text, bigint\)\s+from public, anon, authenticated/i
    );
    assert.match(
        migration,
        /grant execute on function public\.linc_consume_auth_assertion\(text, bigint\)\s+to service_role/i
    );
    assert.match(migration, /notify pgrst, 'reload schema'/i);
});
