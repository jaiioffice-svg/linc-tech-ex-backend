-- Align legacy timestamp columns with db.js epoch-millisecond storage.
-- Review and apply to the intended Supabase project; GitHub commits do not run SQL.
-- Drop legacy defaults before changing column types: PostgreSQL casts defaults
-- independently of the USING expression. created_at receives a compatible
-- epoch-millisecond default; last_heartbeat intentionally remains without a default.

do $migration$
declare
    column_type text;
begin
    select data_type into column_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'linc_users'
      and column_name = 'created_at';

    if column_type is null then
        raise exception 'public.linc_users.created_at does not exist; apply the base schema migration first';
    end if;

    alter table public.linc_users alter column created_at drop default;

    if column_type = 'bigint' then
        null; -- Already in the required format.
    elsif column_type = 'timestamp with time zone' then
        alter table public.linc_users
            alter column created_at type bigint
            using ((extract(epoch from created_at) * 1000)::bigint);
    elsif column_type = 'timestamp without time zone' then
        alter table public.linc_users
            alter column created_at type bigint
            using ((extract(epoch from (created_at at time zone 'UTC')) * 1000)::bigint);
    else
        raise exception 'Unsupported type for public.linc_users.created_at: %', column_type;
    end if;

    alter table public.linc_users
        alter column created_at set default ((extract(epoch from now()) * 1000)::bigint);

    select data_type into column_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'linc_users'
      and column_name = 'last_heartbeat';

    if column_type is null then
        raise exception 'public.linc_users.last_heartbeat does not exist; apply the base schema migration first';
    end if;

    -- The intended schema has no last_heartbeat default. Drop any legacy
    -- timestamp default so it cannot break conversion to BIGINT.
    alter table public.linc_users alter column last_heartbeat drop default;

    if column_type = 'bigint' then
        null; -- Already in the required format.
    elsif column_type = 'timestamp with time zone' then
        alter table public.linc_users
            alter column last_heartbeat type bigint
            using ((extract(epoch from last_heartbeat) * 1000)::bigint);
    elsif column_type = 'timestamp without time zone' then
        alter table public.linc_users
            alter column last_heartbeat type bigint
            using ((extract(epoch from (last_heartbeat at time zone 'UTC')) * 1000)::bigint);
    else
        raise exception 'Unsupported type for public.linc_users.last_heartbeat: %', column_type;
    end if;
end
$migration$;
