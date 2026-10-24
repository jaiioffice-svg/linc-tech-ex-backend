-- Durable one-time consumption store for short-lived BFF assertions.
-- Review and apply to the intended non-production Supabase project only after
-- confirming project identity and isolation. This migration is not auto-applied.

create table if not exists public.linc_auth_assertion_replays (
    jti text primary key
        check (jti ~ '^[A-Za-z0-9_-]{16,128}$'),
    expires_at bigint not null,
    inserted_at timestamptz not null default now()
);

create index if not exists linc_auth_assertion_replays_expires_at_idx
    on public.linc_auth_assertion_replays (expires_at);

alter table public.linc_auth_assertion_replays enable row level security;

revoke all on table public.linc_auth_assertion_replays from anon, authenticated;
grant all on table public.linc_auth_assertion_replays to service_role;

-- Atomically prune expired jtis and consume the new identifier. The INSERT is
-- intentionally not an upsert: a duplicate ID returns false and is rejected.
-- SECURITY DEFINER is limited to a fixed search_path and execution by service_role.
create or replace function public.linc_consume_auth_assertion(
    p_jti text,
    p_expires_at bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now bigint := floor(extract(epoch from clock_timestamp()))::bigint;
    v_rows bigint;
begin
    if p_jti is null
       or p_jti !~ '^[A-Za-z0-9_-]{16,128}$'
       or p_expires_at is null
       or p_expires_at <= v_now
       or p_expires_at > v_now + 65 then
        raise exception 'invalid assertion replay record'
            using errcode = '22023';
    end if;

    delete from public.linc_auth_assertion_replays
    where expires_at <= v_now;

    insert into public.linc_auth_assertion_replays (jti, expires_at)
    values (p_jti, p_expires_at)
    on conflict (jti) do nothing;

    get diagnostics v_rows = row_count;
    return v_rows = 1;
end;
$$;

revoke all on function public.linc_consume_auth_assertion(text, bigint)
    from public, anon, authenticated;
grant execute on function public.linc_consume_auth_assertion(text, bigint)
    to service_role;
