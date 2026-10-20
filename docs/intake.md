# Intake

How a prospective client reaches the firm. Migrations 0016 (tables) and 0017 (rules).

## The public form

`POST /api/inquiries` takes the form with no session. `GET /api/intake/options` returns its choices: the active service areas and sectors (admin-managed tables), employee bands, ownership types, urgency, how they heard of the firm, and the current privacy notice version.

- The request must come from the site's own origin and is capped at 16 KB (413 above that).
- `consent` must be `true` and `privacyNoticeVersion` must match the notice the site shows now. The version is stored with the inquiry.
- A hidden `website` field is a honeypot. When it is filled in, the answer is a normal-looking 201 and nothing is stored.
- The database checks every field again in `submit_inquiry()`. Bad fields come back as 400 `{ error, fields }`.
- Each address may submit 5 inquiries an hour (429 after that). Addresses and user agents are stored only as HMAC-SHA256 keyed with the server secret, never in the clear. The address is the first `X-Forwarded-For` entry, so the server's reverse proxy must overwrite that header rather than append to what the visitor sent.
- On success the answer is 201 `{ ref }`, a reference like `INQ-1A2B3C4D` for the visitor to quote. Every active firm admin is notified (`inquiry.new`).

## Who sees an inquiry

Firm admins see every inquiry. An admin can hand one to a consultant (the owner), who then sees that one only. Clients never see inquiries.

- The owner can move the status forward only: new, triaged, discovery scheduled, discovery done, proposal sent, then a closed status (won, lost, declined, spam or withdrawn).
- Only an admin changes the owner, records the conflict-of-interest check, and closes as won. Won needs the conflict check to be clear or waived.
- Every change writes an `inquiry_events` row. People add notes the same way.

## Retention

Closing an inquiry sets `purge_after`: 30 days for spam, 12 months for the other closed statuses. `app_purge_inquiries(today)` (run by the owner role) then blanks the contact fields and the message, and keeps the organisation, services and dates for reporting. The job may only anonymise, nothing else.

## Not built yet

Triage and conversion to a client (creating the client organisation, its lead, the first invitation and the project), lead suggestions by consultant specialty, and the scheduled purge script.
