-- L!nc backend persistence schema.
-- created_at and last_heartbeat are epoch milliseconds (BIGINT), matching db.js.
-- updated_at is a timestamp maintained as an ISO string.
-- The service-role key is used only by the server; never expose it to a client.

create table if not exists public.linc_users (
    user_id text primary key,
    grade text not null default 'M1',
    guardian_line_id text,
    created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
    last_heartbeat bigint,
    status text not null default 'active',
    updated_at timestamptz not null default now()
);

-- Add any fields that may be missing if the table was created manually earlier.
alter table public.linc_users
    add column if not exists grade text not null default 'M1',
    add column if not exists guardian_line_id text,
    add column if not exists created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
    add column if not exists last_heartbeat bigint,
    add column if not exists status text not null default 'active',
    add column if not exists updated_at timestamptz not null default now();

-- Upsert in db.js uses on_conflict=user_id, so this uniqueness is required.
create unique index if not exists linc_users_user_id_uidx
    on public.linc_users (user_id);

-- Supports the daily stale-heartbeat scan.
create index if not exists linc_users_status_last_heartbeat_idx
    on public.linc_users (status, last_heartbeat);

alter table public.linc_users enable row level security;
