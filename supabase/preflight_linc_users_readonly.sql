-- L!nc Supabase preflight: READ-ONLY checks before applying
-- supabase/migrations/20261024_linc_users_backend.sql
-- Run this file in Supabase SQL Editor and inspect each result.
-- IMPORTANT: run section 1 first. If it returns zero rows, STOP here;
-- sections 2-9 require the table to exist. Do not apply a migration until
-- the existing schema and ownership/authorization plan have been reviewed.
-- This file intentionally performs no INSERT, UPDATE, DELETE, ALTER, or CREATE.
-- Privacy: duplicate checks return aggregate counts only, never user identifiers.

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

-- 4) Inspect whether row-level security is enabled/forced on the table.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'linc_users'
  and c.relkind in ('r', 'p');

-- 5) Inspect explicit table grants; this is read-only and does not change privileges.
select
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'linc_users'
order by grantee, privilege_type;

-- 6) Count existing rows (does not expose row contents).
select count(*) as existing_row_count
from public.linc_users;

-- 7) Check duplicate user_id values without returning identifiers.
-- duplicate_group_count > 0 means duplicates exist; duplicate_row_count is
-- the total number of rows belonging to duplicated user_id groups.
select
  count(*) as duplicate_group_count,
  coalesce(sum(group_size), 0) as duplicate_row_count,
  coalesce(sum(group_size - 1), 0) as excess_duplicate_row_count
from (
  select count(*) as group_size
  from public.linc_users as u
  where nullif(btrim(to_jsonb(u)->>'user_id'), '') is not null
  group by to_jsonb(u)->>'user_id'
  having count(*) > 1
) duplicate_groups;

-- 8) Check null/blank identifiers before relying on user_id uniqueness.
select
  count(*) filter (where to_jsonb(u)->>'user_id' is null) as null_or_missing_user_id_count,
  count(*) filter (where btrim(coalesce(to_jsonb(u)->>'user_id', '')) = '') as blank_user_id_count
from public.linc_users as u;

-- 9) Check status distribution and rows missing timestamps, without exposing IDs.
select
  coalesce(to_jsonb(u)->>'status', '<NULL>') as status,
  count(*) as row_count,
  count(*) filter (where to_jsonb(u)->>'created_at' is null) as missing_or_null_created_at_count,
  count(*) filter (where to_jsonb(u)->>'last_heartbeat' is null) as missing_or_null_last_heartbeat_count,
  count(*) filter (where to_jsonb(u)->>'updated_at' is null) as missing_or_null_updated_at_count
from public.linc_users as u
group by to_jsonb(u)->>'status'
order by status;
