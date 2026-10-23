-- Align legacy timestamp columns with db.js epoch-millisecond storage.
-- Review and apply to the intended Supabase project; GitHub commits do not run SQL.
-- created_at's old DEFAULT now() must be dropped before changing its type, then
-- restored as an epoch-millisecond expression. This avoids PostgreSQL attempting
-- to cast the old timestamptz default to bigint independently of the USING clause.

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

    -- Remove the legacy now() default before any type conversion. Recreate a
    -- compatible default after the column is known to be BIGINT.
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
    elsif column_type = 'bigint' then
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
