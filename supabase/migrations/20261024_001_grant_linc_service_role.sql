-- L!nc backend uses the Supabase service-role key for server-side persistence.
-- Restore the required table privileges if they were revoked or created with
-- restrictive grants. This does not expose the service role key to clients.
begin;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.linc_users to service_role;

commit;
