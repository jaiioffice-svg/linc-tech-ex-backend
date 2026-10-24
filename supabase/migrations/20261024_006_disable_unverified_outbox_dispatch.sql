-- Disable dispatchable outbox states until provider-verified guardian pairing
-- and an actual delivery worker are implemented and separately reviewed.
-- Apply only to a confirmed non-production Supabase project after schema review.

alter table public.linc_notification_outbox
    alter column event_status set default 'blocked';

-- Replace any prior, weaker constraint regardless of the migration history.
alter table public.linc_notification_outbox
    drop constraint if exists linc_notification_outbox_recipient_status_check;

-- No guardian recipient in the current Candidate has provider-verified pairing
-- and explicit consent. Keep undelivered work blocked and purge recipient IDs
-- from outbox rows. Preserve terminal delivery-state labels for audit history.
update public.linc_notification_outbox
   set event_status = case
           when event_status in ('pending', 'processing', 'retry') then 'blocked'
           else event_status
       end,
       recipient_line_id = null,
       sent_at = case
           when event_status in ('blocked', 'pending', 'processing', 'retry') then null
           else sent_at
       end
 where recipient_line_id is not null
    or event_status in ('pending', 'processing', 'retry')
    or (event_status = 'blocked' and sent_at is not null);

-- Until the future pairing/dispatcher migration, only blocked events and
-- terminal history states are allowed; all must omit the recipient identifier.
alter table public.linc_notification_outbox
    add constraint linc_notification_outbox_recipient_status_check
    check (
        event_status in ('blocked', 'sent', 'dead')
        and recipient_line_id is null
    );

notify pgrst, 'reload schema';
