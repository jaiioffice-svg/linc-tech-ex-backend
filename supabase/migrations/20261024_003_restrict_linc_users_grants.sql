-- Least-privilege follow-up for the L!nc backend's current linc_users access.
-- Current db.js requires SELECT (getUser/getStaleActiveUsers), INSERT and UPDATE
-- (saveUser upsert). No current backend path requires DELETE.
--
-- Review against the actual project before applying. This migration does not
-- change rows, columns, RLS policies, or application behavior.

begin;

do $migration$
begin
    if to_regclass('public.linc_users') is null then
        raise exception 'public.linc_users does not exist; apply only after the intended table is verified';
    end if;

    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        raise exception 'service_role does not exist in this database';
    end if;
end
$migration$;

grant usage on schema public to service_role;
grant select, insert, update on table public.linc_users to service_role;
revoke delete on table public.linc_users from service_role;

commit;
