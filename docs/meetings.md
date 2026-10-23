# Meetings and the schedule

Tables in `src/db/schema`, rules in the Meetings section of `drizzle/0000_baseline.sql`. Selah records meetings and links to the call. It never hosts a call. Invites are standard `.ics` files (RFC 5545), which work in Google, Outlook and Apple calendars without connecting any account.

## Booking

`POST /api/projects/:id/meetings` books a meeting. The firm's people on the project can book any meeting. A client admin or manager can book shared ones only. The organiser is added as an attendee.

The same request can carry the attendees and `sendInvites: true`, so one step books the meeting, invites the people and queues the calendar invite. If any attendee is refused, nothing is booked. `app_meeting_invitees(project)` lists whom the caller can invite: for the firm, everyone with an account who can open the project; for a client, its own people and the firm staff on the project, never the firm's whole staff. Only the firm also sees the client's contacts.

Selah doesn't create Meet links (that needs a Google Workspace connection). The booking form links to `meet.google.com/new` so the organiser can make one and paste it.

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
- **Follow-ups** (`POST /api/meetings/:id/follow-ups`, `PATCH /api/follow-ups/:id`, baseline: Meeting follow-ups) come out of a meeting and can follow up one of its decisions. They show on the schedule. They stay in the meeting's project and are never more visible than the meeting. The person assigned must be able to open the project, and must be firm staff for a firm-only follow-up. The firm writes and edits them; the assignee, client side included, can only mark their own one done or open it again.
- Summaries and decisions can be translated on demand (docs/translations.md).
- Not built yet: the AI draft of the summary from a transcript. Meet has no Arabic transcripts, so the summary is written by hand by default.

## Transcripts

A transcript is personal data (PDPL), so Selah keeps it only as long as it takes to write the summary. Rules in the Transcripts section of `drizzle/0000_baseline.sql`.

- **Consent first.** A transcript can be imported only when the meeting records that participants were told it may be transcribed (`transcript_consent`, with who noted it and when), and only once the meeting is held. Switching consent off deletes the transcript at once.
- **Firm only.** The firm's people who run the meeting import, read and delete it (`PUT/GET/DELETE /api/meetings/:id/transcript`). Clients never see it, not even that one exists.
- **Formats.** A pasted text or a `.txt` export (Google Meet saves transcripts as a Doc), or WebVTT/SubRip captions from Meet, Teams or Zoom recordings. Captions are turned into "Speaker: words" lines with timings removed (`src/lib/transcripts.ts`). At most 500,000 characters.
- **Never edited**, only replaced. Imports and deletions are logged without the text.
- **Deleted on schedule.** At most 90 days after import, and `firm_settings.transcript_keep_days` (30) after the summary is confirmed, whichever comes first. `npm run job:purge-transcripts` runs daily as the schema owner.

## Screens

- **Book** from the project's Meetings tab: title, type, date, time, length, where, the call link, shared or firm-only, attendees, and whether to email the invite now. The link is checked against the same allowlist before saving (`src/lib/meetings.ts`).
- **The meeting page** (`/meetings/:id`) shows the time, the call link, the agenda, the summary, decisions and follow-ups (with on-demand translation), and the attendees. Whoever runs the meeting can edit or move it while it is scheduled and send the updated invite, send invites, mark it held once it has started, cancel it and send the cancellation, and add or remove attendees. An invited person answers there.
- **After it is held**, whoever runs it writes the summary (saving confirms it, firm-only unless shared), records decisions (a correction replaces an earlier one, which is then shown struck through), and the firm adds follow-ups. The firm also gets the transcript panel.

Not built yet: Meet's REST API import and creating Meet links (both need a Google Workspace connection), and the AI draft of the summary.

## The schedule

`GET /api/schedule?from=&to=` shows meetings, open actions' due dates and open follow-ups in one list, for up to six months at a time.

- It reads `v_schedule`, which runs with the caller's rights. Each person sees only what they can already see. A client never sees a firm-private meeting or a firm check-in.
- `projectId`, `clientId` and `userId` narrow the list. With `userId`, it shows items for that person: meetings they organise or attend, actions they own, and follow-ups assigned to them. Firm admins use these filters to look at one client, project or colleague.
