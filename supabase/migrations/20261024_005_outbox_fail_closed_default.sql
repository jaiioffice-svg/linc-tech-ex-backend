-- Harden notification eligibility defaults for databases where the outbox
-- table was created before the fail-closed schema constraint was added.
-- Apply only to a confirmed non-production Supabase project after schema review.

alter table public.linc_notification_outbox
    alter column event_status set default 'blocked';

-- Normalize non-terminal statuses with no recipient and clear recipients from
-- blocked rows. Preserve terminal sent/dead labels here; migration 006 clears all
-- stored recipients and disables dispatchable states until pairing is implemented.
update public.linc_notification_outbox
   set event_status = 'blocked',
       recipient_line_id = null
 where recipient_line_id is null
   and event_status not in ('blocked', 'sent', 'dead');

update public.linc_notification_outbox
   set recipient_line_id = null
 where event_status = 'blocked'
   and recipient_line_id is not null;

do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'linc_notification_outbox_recipient_status_check'
           and conrelid = 'public.linc_notification_outbox'::regclass
    ) then
        alter table public.linc_notification_outbox
            add constraint linc_notification_outbox_recipient_status_check
            check (
                (event_status = 'blocked' and recipient_line_id is null) or
                (event_status in ('pending', 'processing', 'retry', 'sent', 'dead')
                    and recipient_line_id is not null)
            );
    end if;
end;
$$;

notify pgrst, 'reload schema';
