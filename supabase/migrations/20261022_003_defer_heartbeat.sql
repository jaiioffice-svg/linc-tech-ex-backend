-- L!nc v1: Heartbeat monitoring is deferred.
-- Safe for projects that already applied 20261022_002_linc_core.sql.
alter table public.linc_users
    alter column last_heartbeat drop not null;

drop index if exists public.linc_users_status_last_heartbeat_idx;
