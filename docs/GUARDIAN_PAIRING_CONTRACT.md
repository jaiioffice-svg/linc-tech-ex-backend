# Guardian pairing and notification eligibility contract

**Status: design proposal only — not implemented.** Do not treat this document as an approved identity provider configuration or permission to send messages. The approved Client/BFF session system, actual LINE channel/provider arrangement, consent UX, and isolated non-production database are not yet confirmed.

## Trust boundaries

1. The cared-for person's identity must come from an approved server-verified Client session. The Backend must never derive that identity from a request body, an opaque browser token it cannot validate, or a submitted profile field.
2. The guardian must authenticate their own LINE account. A LIFF/LINE Login ID token is sent to the server and verified with LINE's Verify ID Token endpoint, using the expected LINE Login channel ID. Validate the issuer, audience/channel ID, expiry, and the login attempt's nonce. Never accept `liff.getProfile()`, decoded token payloads, display names, or a client-supplied `guardianLineId` as proof of identity.
3. LINE Login and Messaging API channel user IDs are compatible across channel types only when the channels are under the same LINE Provider. Verify the actual channel/provider configuration before relying on the IDs matching. Cross-service use of LINE user information must also comply with LINE's provider-page and user-data policy requirements.
4. Being authenticated as a LINE user does not alone prove consent to be linked to a particular L!nc account, nor that the user can currently receive messages from the L!nc Official Account.

## Proposed pairing flow

1. The cared-for user's approved session starts a pairing request. The Backend derives the cared-for user ID from the verified principal and creates a cryptographically random, single-use challenge. Store only a hash of the challenge, bind it to that account/session, and expire it after a short period (suggested: five minutes).
2. The guardian opens the pairing URL/QR on their own LINE account and authenticates through an approved LIFF/LINE Login flow. The Backend verifies the ID token directly with LINE and obtains the LINE user ID from the verified response.
3. Show a clear confirmation of which L!nc account is being linked and what notifications will be sent. Require explicit guardian consent and the product-approved confirmation from the cared-for session. Do not activate a pairing solely because a QR was scanned or a LINE token was valid.
4. Atomically consume the one-time challenge and create the pairing record. Reject expired/replayed challenges, mismatched accounts, already-revoked links, and duplicate attempts without changing another user's pairing.
5. Provide a clear unlink/revoke flow. Revocation immediately removes the pairing from notification eligibility and prevents queued-but-not-yet-sent events from being delivered to that recipient.

## Official Account friend eligibility

- Require the guardian to add the L!nc Official Account as a friend for ongoing push notifications.
- Accept `follow` and `unfollow` webhook events only after validating the LINE signature against the exact raw request body and the correct channel secret. Store only the minimum state needed; process webhook event IDs idempotently.
- A signed `follow` event can update friend state, but it does not establish the guardian-to-cared-for-account pairing by itself. A valid pairing and explicit consent are separate requirements.
- Mark the guardian ineligible when an `unfollow` event indicates the Official Account was blocked. Restore eligibility only after a later valid `follow` event and only if the pairing and consent remain active.
- For routine future alerts, do not rely on LINE's temporary ability to push to a user who messaged the Official Account within the previous seven days. That is not a durable notification relationship.

## Proposed persistent state and outbox rule

A reviewed future schema should separate these facts instead of overloading `linc_users.guardian_line_id`:

- Pairing state: `pending`, `active`, or `revoked`.
- Verified LINE subject and the channel/provider contract used to verify it.
- Explicit-consent timestamp and consent-policy version.
- Current Official Account friend state, with last verified event/time.
- Challenge hash, expiry, one-time consumption and replay protection.

A termination event may become deliverable only when a server-side query proves that the pairing is active, consent is current, the guardian's LINE identity was provider-verified, and the Official Account friend state is active. Otherwise the event remains `blocked` with `recipient_line_id = NULL`. Legacy or client-supplied `guardian_line_id` values must never satisfy these conditions.

Store LINE identifiers and tokens only on the server, never log ID tokens, access tokens, channel secrets, raw recipient IDs, or QR/challenge values, and never send a message simply because a database row is marked `pending`. A delivery worker is a separate release gate and must honor revocation and idempotency.

## Preconditions before implementation

- Identify the approved Client repository, deployed commit, authoritative session store and BFF route.
- Confirm the actual LINE Login channel, Messaging API channel, Provider relationship, Official Account friend configuration, and applicable user-data policy.
- Review the consent/user-experience wording and the product's guardian-authority model.
- Design isolated non-production tables/RLS/grants and verify the actual project identity before applying a migration.
- Add negative tests for spoofed IDs, invalid/expired tokens, wrong channel/audience, nonce mismatch, expired/replayed challenges, cross-account challenge use, absent consent, unfollow/revoke, webhook signature failure, and duplicate webhooks.
- Only after those gates, enable a Preview-only delivery worker and prove recipient isolation and failure behavior. No real LINE message should be sent during unit tests.

## LINE documentation

- [Verify ID tokens (LINE Login)](https://developers.line.biz/en/docs/line-login/verify-id-token/)
- [Using user data in LIFF apps and servers](https://developers.line.biz/en/docs/liff/using-user-profile/)
- [Get user IDs (Messaging API)](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)
- [Receive messages and validate webhook signatures](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [Send messages and push-message conditions](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
- [Provider design basics (LINE Developers)](https://developers.line.biz/en/tips/2026/06/25/provider-design-basics/)

This document records a reviewed target contract; it does not create a migration, add credentials, configure any LINE channel, deploy the Backend, or send messages.
