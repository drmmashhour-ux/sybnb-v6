# SYBNB — Mailbox Setup & Verification (owner action)

Create three role mailboxes so the legal/support surfaces resolve to real inboxes. These are the
addresses referenced in the DRAFT Terms/Privacy. **Owner action** — requires DNS/mail-admin access
the agent does not have.

## Addresses to create
- `support@sybnb.app` — user support
- `legal@sybnb.app` — legal notices
- `privacy@sybnb.app` — privacy requests / data-subject contact

Existing and unchanged: `info@sybnb.app`, WhatsApp `+963 998 191 422`.

## Setup (with your email provider for the `sybnb.app` domain)
1. Create each address as a mailbox or a distribution/alias to a monitored inbox.
2. Confirm domain email auth is in place for deliverability: **SPF**, **DKIM**, and **DMARC** DNS
   records for `sybnb.app`. `[[OWNER: confirm records exist]]`
3. Decide routing/ownership (who monitors each) and set an auto-acknowledgement for `privacy@` and
   `legal@` if desired.

## Verification checklist (record evidence)
- [ ] Send a test email **to** each of `support@`, `legal@`, `privacy@` from an external address →
      received in the intended inbox.
- [ ] Send a test **from** each address → not marked spam (SPF/DKIM/DMARC pass in the received
      headers).
- [ ] Reply path works (replies reach a monitored inbox).
- [ ] `privacy@` and `legal@` are monitored by a responsible person/queue.

## After verification
Report the three mailboxes as live; no code change is required (the addresses are already in the
DRAFT legal docs). If any address name changes, tell the agent and it will update the DRAFTs
(docs-only).
