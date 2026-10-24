-- Fail-closed upgrade for previously created notification outbox tables.
-- Apply only to a confirmed non-production Supabase project after schema review.
-- Migration 006 repeats this policy as a forward-repair for installations that
-- already applied an earlier, weaker version of this file.

alter table public.linc_notification_outbox
    alter column event_status set default 'blocked';

-- Replace any older recipient/status check before normalizing legacy rows.
alter table public.linc_notification_outbox
    drop constraint if exists linc_notification_outbox_recipient_status_check;

-- No recipient is currently provider-verified. Block all undelivered work,
-- remove every stored recipient identifier, and clear misleading send times
-- for blocked events. Keep sent/dead labels and timestamps as terminal history.
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

-- Until verified guardian pairing/consent and a reviewed dispatcher exist,
-- only blocked events or terminal labels are allowed; all have no recipient.
alter table public.linc_notification_outbox
    add constraint linc_notification_outbox_recipient_status_check
    check (
        event_status in ('blocked', 'sent', 'dead')
        and recipient_line_id is null
    );

notify pgrst, 'reload schema';
