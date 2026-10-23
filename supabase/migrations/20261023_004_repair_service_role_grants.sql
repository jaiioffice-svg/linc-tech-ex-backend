-- L!nc: repair the minimum Supabase privileges required by the backend.
-- Safe and additive: does not delete or alter user data.
-- Run this migration in the Supabase SQL Editor for the same project used by
-- the Vercel Preview environment.

grant usage on schema public to service_role;

grant select, insert, update, delete
    on table public.linc_users
    to service_role;

-- Keep the service-role key server-side only. Never add it to the mobile app.
