-- Durable notification outbox and atomic app-termination event recording.
-- Apply only to a confirmed non-production Supabase project after schema review.

create table if not exists public.linc_notification_outbox (
    event_id uuid primary key default gen_random_uuid(),
    user_id text not null references public.linc_users(user_id) on delete cascade,
    recipient_line_id text null,
    event_type text not null
        check (event_type in ('APP_TERMINATION_SIGNAL')),
    event_status text not null default 'blocked'
        check (event_status in ('pending', 'blocked', 'processing', 'retry', 'sent', 'dead')),
    -- Current Candidate has no provider-verified pairing or dispatcher. Keep all
    -- outbound work states disabled until a later reviewed pairing migration.
    constraint linc_notification_outbox_recipient_status_check check (
        event_status in ('blocked', 'sent', 'dead') and recipient_line_id is null
    ),
    attempts integer not null default 0 check (attempts >= 0),
    next_attempt_at timestamptz not null default now(),
    last_error_code text null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    sent_at timestamptz null
);

create index if not exists linc_notification_outbox_dispatch_idx
    on public.linc_notification_outbox (event_status, next_attempt_at, created_at);

create index if not exists linc_notification_outbox_user_history_idx
    on public.linc_notification_outbox (user_id, created_at desc);

alter table public.linc_notification_outbox enable row level security;

revoke all on table public.linc_notification_outbox from anon, authenticated;
grant all on table public.linc_notification_outbox to service_role;

create or replace function public.linc_record_app_termination(
    p_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
    v_user public.linc_users%rowtype;
    v_deleted_at bigint;
    v_event_id uuid;
    v_profile_data jsonb;
begin
    if p_user_id is null
       or btrim(p_user_id) = ''
       or p_user_id ~ '(^[[:space:]])|([[:space:]]$)'
       or length(p_user_id) > 200 then
        raise exception 'invalid user identifier'
            using errcode = '22023';
    end if;

    select *
      into v_user
      from public.linc_users
     where user_id = p_user_id
     for update;

    if not found then
        return jsonb_build_object(
            'found', false,
            'alreadyRecorded', false,
            'eventId', null,
            'eventStatus', null,
            'guardianLinked', false
        );
    end if;

    -- A legacy profile field does not prove provider-verified pairing or consent.
    -- Keep all termination notices blocked until a reviewed verification contract exists.

    v_profile_data := case
        when jsonb_typeof(v_user.data) = 'object' then v_user.data
        else '{}'::jsonb
    end;

    if v_user.status = 'app_deleted'
       or v_profile_data ->> 'status' = 'app_deleted' then
        update public.linc_users
           set status = 'app_deleted',
               updated_at = clock_timestamp(),
               data = v_profile_data || jsonb_build_object('status', 'app_deleted')
         where user_id = p_user_id;

        return jsonb_build_object(
            'found', true,
            'alreadyRecorded', true,
            'eventId', null,
            'eventStatus', null,
            'guardianLinked', false
        );
    end if;

    v_deleted_at := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    update public.linc_users
       set status = 'app_deleted',
           updated_at = clock_timestamp(),
           data = v_profile_data || jsonb_build_object(
               'status', 'app_deleted',
               'deletedAt', v_deleted_at
           )
     where user_id = p_user_id;


    insert into public.linc_notification_outbox (
        user_id,
        recipient_line_id,
        event_type,
        event_status,
        payload
    ) values (
        p_user_id,
        null,
        'APP_TERMINATION_SIGNAL',
        'blocked',
        jsonb_build_object('reason', 'APP_TERMINATION_SIGNAL')
    )
    returning event_id into v_event_id;

    return jsonb_build_object(
        'found', true,
        'alreadyRecorded', false,
        'deletedAt', v_deleted_at,
        'eventId', v_event_id,
        'eventStatus', 'blocked',
        'guardianLinked', false
    );
end;
$$;

revoke all on function public.linc_record_app_termination(text)
    from public, anon, authenticated;
grant execute on function public.linc_record_app_termination(text)
    to service_role;

notify pgrst, 'reload schema';
