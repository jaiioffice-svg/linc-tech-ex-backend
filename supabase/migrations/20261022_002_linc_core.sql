-- L!nc durable database schema for Supabase/Postgres.
-- Apply in Supabase SQL Editor before setting SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

create table if not exists public.linc_users (
    user_id text primary key,
    grade text not null default 'M1',
    guardian_line_id text null,
    created_at bigint not null,
    last_heartbeat bigint null,
    status text not null default 'active'
        check (status in ('active', 'missing', 'app_deleted')),
    data jsonb not null default '{}'::jsonb,
    inserted_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Existing installations may already have the original NOT NULL constraint.
alter table public.linc_users alter column last_heartbeat drop not null;

create index if not exists linc_users_status_last_heartbeat_idx
    on public.linc_users (status, last_heartbeat);

create table if not exists public.linc_schools (
    school_id text primary key,
    data jsonb not null default '{}'::jsonb,
    inserted_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.linc_revenue (
    singleton_id boolean primary key default true check (singleton_id = true),
    data jsonb not null default '{"total": 0}'::jsonb,
    updated_at timestamptz not null default now()
);

-- Backend uses the service-role key only on the server. Never place it in client apps.
alter table public.linc_users enable row level security;
alter table public.linc_schools enable row level security;
alter table public.linc_revenue enable row level security;

revoke all on table public.linc_users from anon, authenticated;
revoke all on table public.linc_schools from anon, authenticated;
revoke all on table public.linc_revenue from anon, authenticated;
grant all on table public.linc_users to service_role;
grant all on table public.linc_schools to service_role;
grant all on table public.linc_revenue to service_role;

-- updated_at will be set by the application on writes; do not expose service-role credentials client-side.
