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

## Triage and discovery

The firm's side lives under `/api/intake` and needs a session.

- `GET /api/intake/inquiries` lists the inbox, newest first. Admins see every inquiry and a consultant sees the ones handed to them. `GET /api/intake/inquiries/:id` returns the inquiry, its history and its discovery sessions. The address hashes are never returned.
- `PATCH /api/intake/inquiries/:id` changes the status, the owner or the conflict check. The owner may only take the next step forward; everything else needs an admin.
- `POST /api/intake/inquiries/:id/notes` adds a note to the history.
- `POST /api/intake/inquiries/:id/discovery` books the discovery session and moves the inquiry to discovery scheduled. `PATCH /api/intake/discovery/:id` records when it was held, the notes and the outcome. The first outcome moves the inquiry to discovery done.

**Screens.**
- `/inquiries` is the inbox, split into open, won and closed.
- `/inquiries/:id` shows the request, the self-check answers, discovery sessions and history.
- The owner can mark the inquiry triaged or proposal sent, book discovery, record its outcome and add notes.
- The admin also assigns the owner, records the conflict check, closes or reopens the inquiry, sees the possible leads, and makes it a client.
- The detail response includes `can` (`work`, `decide`, `forward`, `convert`) so the screen offers only what the server allows.

## Who could lead it

The admin records what each consultant can lead: service areas and sectors (`PUT /api/consultants/:id/profile`, list with `GET /api/consultants`). A consultant keeps their own languages and says whether they can take a new client, but cannot change their expertise.

`GET /api/intake/inquiries/:id/suggestions` (admin only) runs `app_suggest_leads()`. It returns up to five active consultants who cover at least one of the services asked for. Each one comes with its reasons: the services matched, whether they know the sector and speak the requester's language, whether they are taking new clients, and how many active clients they already have. Available people with the closest match and the lightest load come first.

- It only suggests. The admin still chooses the lead.
- No performance data goes in, so it is a match for one inquiry, not a ranking of people.
- A firm can turn it off with `firm_settings.suggestions_enabled`.

## Becoming a client

`POST /api/intake/inquiries/:id/convert` (admin only) wins the inquiry and makes it a client in one transaction:

1. It creates the client organisation, or links an existing one for a returning client.
2. It names the lead, if one is given.
3. It starts the first project in the planned state, if a title is given.

The inquiry must be past discovery and its conflict check must be clear or waived. An inquiry becomes a client only once.

## Jobs

`npm run job:purge-inquiries` runs the anonymisation daily, using the Riyadh date.

## Not built yet

Inviting the client's people after conversion (part of the accounts work), and keeping a record of contacts who have no login.
