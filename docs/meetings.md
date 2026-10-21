# Meetings and the schedule

Migrations 0022 (tables) and 0023 (rules). Selah records meetings and links to the call. It never hosts a call. Invites are standard `.ics` files (RFC 5545), which work in Google, Outlook and Apple calendars without connecting any account.

## Booking

`POST /api/projects/:id/meetings` books a meeting. The firm's people on the project can book any meeting. A client admin or manager can book shared ones only. The organiser is added as an attendee.

- **Call links** must be https on Google Meet, Teams (`teams.microsoft.com`, `teams.live.com`) or Zoom (`zoom.us` and its subdomains). This stops a link that looks like it came from the consultant from pointing anywhere else. The provider is worked out from the link. An online meeting needs a link.
- **The agenda** is written by the database at booking, in the meeting's language. It lists the project's overdue, awaiting-review and blocked actions, and what changed since the last meeting that was held.
- **Visibility.** A meeting is shared or firm-private. A firm-private meeting, with its decisions and summary, is invisible to the client, and its records cannot be made more visible than the meeting itself.

## Changes and calendars

`PATCH /api/meetings/:id` moves or edits the meeting, marks it held or cancels it.

- Each meeting keeps one calendar id (`ics_uid`) for life.
- `ics_sequence` goes up on every change a calendar shows: the title, the times, the location or link, and cancelling. Changes that calendars don't show leave it alone.
- A held or cancelled meeting can't be moved, and its status is final.
- `GET /api/meetings/:id/ics` downloads the invite. A cancelled meeting downloads as `METHOD:CANCEL` with the same id, so calendars remove it.
- `POST /api/meetings/:id/invites` queues the invite, or the cancellation, for every attendee with an address. The mail sender builds the `.ics` when it sends.

## Attendees

`POST /api/meetings/:id/attendees` adds a person with an account, or a client contact without one. Free-typed addresses are not accepted, so every address is covered by the erasure rules.

- A person must be able to open the project. For a firm-private meeting, they must also be firm staff.
- Contacts belong to the meeting's client, and only the firm adds them, because only the firm sees the contact list.
- `PUT /api/meetings/:id/response` lets an attendee answer for themselves. That is the only change an attendee can make.

## After the meeting

- **Decisions** (`POST /api/meetings/:id/decisions`) are append-only. A correction is a new decision that supersedes one from the same meeting. Follow-ups can point at the decision they follow.
- **The summary** (`PUT /api/meetings/:id/summary`) can be written only once the meeting is held. Whoever saves it confirms it, and it starts firm-private.
- Summaries and decisions can be translated on demand (docs/translations.md).
- Not built yet:
  - The AI draft from a Meet transcript. Meet has no Arabic transcripts, so the summary is written by hand by default.
  - Transcript import. It needs `transcript_consent`, which the database records together with who noted it.

## The schedule

`GET /api/schedule?from=&to=` shows meetings, open actions' due dates and open follow-ups in one list, for up to six months at a time.

- It reads `v_schedule`, which runs with the caller's rights. Each person sees only what they can already see. A client never sees a firm-private meeting or a firm check-in.
- `projectId`, `clientId` and `userId` narrow the list. With `userId`, it shows items for that person: meetings they organise or attend, actions they own, and follow-ups assigned to them. Firm admins use these filters to look at one client, project or colleague.
