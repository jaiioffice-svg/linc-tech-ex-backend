-- L!nc Supabase preflight: READ-ONLY checks before applying
-- supabase/migrations/20261024_linc_users_backend.sql
-- Run this file in Supabase SQL Editor and inspect each result.
-- This file intentionally performs no INSERT, UPDATE, DELETE, ALTER, or CREATE.

-- 1) Confirm whether public.linc_users exists and inspect its columns/types/defaults.
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'linc_users'
order by ordinal_position;

-- 2) Inspect primary-key, unique, and other constraints.
select
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_catalog = kcu.constraint_catalog
 and tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
 and tc.table_name = kcu.table_name
where tc.table_schema = 'public'
  and tc.table_name = 'linc_users'
order by tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- 3) Check existing indexes.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'linc_users'
order by indexname;

-- 4) Count existing rows (does not expose row contents).
select count(*) as existing_row_count
from public.linc_users;

-- 5) Check duplicate user_id values. Any returned row means the migration's
-- unique index may fail and data must be reviewed before schema changes.
select user_id, count(*) as duplicate_count
from public.linc_users
group by user_id
having count(*) > 1
order by duplicate_count desc
limit 100;

-- 6) Check null/blank identifiers before relying on user_id uniqueness.
select
  count(*) filter (where user_id is null) as null_user_id_count,
  count(*) filter (where btrim(user_id) = '') as blank_user_id_count
from public.linc_users;

-- 7) Check status distribution and rows missing timestamps, without exposing IDs.
select
  coalesce(status, '<NULL>') as status,
  count(*) as row_count,
  count(*) filter (where created_at is null) as missing_created_at_count,
  count(*) filter (where last_heartbeat is null) as missing_last_heartbeat_count,
  count(*) filter (where updated_at is null) as missing_updated_at_count
from public.linc_users
group by status
order by status;
