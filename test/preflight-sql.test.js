const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, '..', 'supabase', 'preflight_linc_users_readonly.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const executableSql = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

test('Supabase preflight explicitly tells operators to stop if the table is absent', () => {
    assert.match(sql, /if it returns zero rows, STOP here/i);
    assert.match(sql, /sections 2-9 require the table to exist/i);
});

test('Supabase preflight is read-only and contains no data/schema mutation statements', () => {
    assert.doesNotMatch(
        executableSql,
        /\b(?:insert\s+into|update\s+[\w".]+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate(?:\s+table)?)\b/i
    );
});

test('aggregate data-quality checks do not select user identifiers', () => {
    const duplicateSection = sql.split('-- 7)')[1]?.split('-- 8)')[0] || '';
    const identifierSection = sql.split('-- 8)')[1]?.split('-- 9)')[0] || '';
    assert.match(duplicateSection, /count\(\*\) as duplicate_group_count/i);
    assert.match(duplicateSection, /to_jsonb\(u\)->>'user_id'/i);
    assert.doesNotMatch(duplicateSection, /select\s+(?:distinct\s+)?(?:u\.)?user_id\b/i);
    assert.match(identifierSection, /null_or_missing_user_id_count/i);
    assert.match(identifierSection, /blank_user_id_count/i);
    assert.doesNotMatch(identifierSection, /select\s+(?:distinct\s+)?(?:u\.)?user_id\b/i);
});

test('schema-drift-tolerant checks inspect optional columns through to_jsonb', () => {
    const statusSection = sql.split('-- 9)')[1] || '';
    assert.match(statusSection, /to_jsonb\(u\)->>'status'/i);
    assert.match(statusSection, /to_jsonb\(u\)->>'created_at'/i);
    assert.match(statusSection, /to_jsonb\(u\)->>'last_heartbeat'/i);
    assert.match(statusSection, /to_jsonb\(u\)->>'updated_at'/i);
});
