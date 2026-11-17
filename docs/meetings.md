# Meetings and the schedule

Tables in `src/db/schema`, rules in the Meetings section of `drizzle/0000_baseline.sql`. Selah records meetings and links to the call. It never hosts a call. Invites are standard `.ics` files (RFC 5545), which work in Google, Outlook and Apple calendars without connecting any account.

## Booking

`POST /api/projects/:id/meetings` books a meeting. The firm's people on the project can book any meeting. A client admin or manager can book shared ones only. The organiser is added as an attendee.

The same request can carry the attendees and `sendInvites: true`, so one step books the meeting, invites the people and queues the calendar invite. If any attendee is refused, nothing is booked. `app_meeting_invitees(project)` lists whom the caller can invite: for the firm, everyone with an account who can open the project; for a client, its own people and the firm staff on the project, never the firm's whole staff. Only the firm also sees the client's contacts. For each person it also says whether they could open a meeting of the whole project, and their departments (decision 1a, below).

- **The whole project or a department.** At a client with departments, the form asks which: the whole project, or one department (the firm and the client's admin may book for any department, a manager for her own). A meeting of the whole project is booked only by someone who may open it (below): a manager with department limits gets only her departments in the list, and the server and the database refuse the rest (`bookMeeting()`, policy `whole_project` on `meetings`).
- **The invite warning.** When a whole-project meeting would invite someone who could not open it (a manager limited to her departments), the form says so before saving, names the person, and offers to make it the meeting of their department (one button per department the organiser may book for). On a meeting already booked, the add-attendee form says the same for the person picked; a meeting keeps its department, so the offer there is to book a department's meeting. Saving anyway is allowed: the person is invited, gets the calendar invite (title, time and link, never the agenda) and cannot open the meeting, whose page and calendar file answer Not found for them. The server decides; the form only warns (`leftOutOfMeeting()`, `departmentsToOffer()` in `src/lib/meetings.ts`).

Selah doesn't create Meet links (that needs a Google Workspace connection). The booking form links to `meet.google.com/new` so the organiser can make one and paste it.

- **Call links** must be https on Google Meet, Teams (`teams.microsoft.com`, `teams.live.com`) or Zoom (`zoom.us` and its subdomains). This stops a link that looks like it came from the consultant from pointing anywhere else. The provider is worked out from the link. An online meeting needs a link.
- **The agenda** is written by the database at booking, in the meeting's language. It lists the project's overdue, awaiting-review and blocked actions, and what changed since the last meeting that was held (a department's meeting: that department's). Since migration `0072_agenda_readers` it writes a status in the app's own words and a date the way the screens print it (`app_action_status_label()`, `app_agenda_date()`; a test compares both with `messages/*.json` and the browser's format). Agendas stored before that keep their text; the meeting page maps the old status keys and dates when it draws them (`src/lib/agenda.ts`), so no stored title can be corrupted.
- **The agenda follows the meeting** (decision 1a, option C, 17 Nov 2026; migration `0086_whole_project_meetings`). A department's meeting lists only that department's work; a meeting with no department is the whole project's and lists everything, so it opens only for the people who may see everything (below).
- **Who reads the agenda** (decision D8). The agenda names actions by title, so the stored text goes only to a reader who may open every action it can name: the firm's people on the project, the client's admin, and a client manager for whom no released action of the project (of the department, for a department's meeting) fails the department check; a draft does not count, since an agenda never names one (migration `0077_agenda_drafts`). An action owner never gets the stored text: on any meeting she opens, the agenda shows her own actions only, in the same four lists worked out when she opens it from the live actions ("Only your own actions on this meeting's agenda", or "None of your actions is on this meeting's agenda"). Everyone else (in practice, someone invited to another department's meeting) sees one line in its place: "The agenda is shown to people who can open all of the project's work. Ask the organiser what concerns you." That line is the stop-gap shipped first, kept as a second line of defence. The text never leaves the database for them: the app role cannot read `meetings.agenda_md` at all, and `app_meeting_agenda_for(meeting)` returns it, or the owner's own list, only to those readers. The calendar file and the invitation mails never carry the agenda. A column added to `meetings` later needs its own `GRANT SELECT (column) … TO selah_app`; `tests/db/privacy-leaks.test.ts` fails by name until it has one.
- **Visibility.** A meeting is shared or firm-private. A firm-private meeting, with its decisions and summary, is invisible to the client, and its records cannot be made more visible than the meeting itself.
- **A department's meeting** (booked with a department; migration `0070_department_meetings`) follows the department rule at the client: it is read by the department's people, the client's admins, whoever organises it and anyone invited to it, and by the firm on the project. The same goes for everything under it: attendees, decisions, summary, follow-ups, notes, the calendar file and its line on the schedule. A follow-up still reaches the person it is assigned to. Only someone who sees the department's work books one for it (the firm, the client's admin, the department's people).
- **A meeting of the whole project** (no department; migration `0086_whole_project_meetings`) opens only for people who may see everything on the project: the firm on the project, the client's admin, and a client manager whom no department limit stops (at a client with departments switched off, every manager), plus action owners invited to it. For everyone else, invited or not, the meeting answers Not found, and so do its agenda, calendar file, attendees, decisions, summary and its sources, notes, follow-ups (a follow-up still reaches the person it is assigned to) and transcript; it is on none of their meeting lists or their schedule. Whether a manager may see everything depends on the work: once the firm releases work in a department she is not in, she no longer opens the whole project's meetings (the same rule the agenda used). Selah has no meeting PDF or export.

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

- **Book** from the project's Meetings tab: title, type, the whole project or a department, date, time, length, where, the call link, shared or firm-only, attendees, and whether to email the invite now. The link is checked against the same allowlist before saving (`src/lib/meetings.ts`), and anyone invited who could not open a whole-project meeting is named before saving (the invite warning, above).
- **The meeting page** (`/meetings/:id`) shows the time, the call link, the agenda (or the one line that stands in for it), the summary, decisions and follow-ups (with on-demand translation), and the attendees. Whoever runs the meeting can edit or move it while it is scheduled and send the updated invite, send invites, mark it held once it has started, cancel it and send the cancellation, and add or remove attendees. An invited person answers there. An observer on the project reads the page and is offered none of these controls, not even the reply to an invitation: the database refuses each of them (migration `0034_observers`).
- **After it is held**, whoever runs it writes the summary (saving confirms it, firm-only unless shared), records decisions (a correction replaces an earlier one, which is then shown struck through), and the firm adds follow-ups. The firm also gets the transcript panel.

Not built yet: Meet's REST API import and creating Meet links (both need a Google Workspace connection), and the AI draft of the summary.

## The schedule

`GET /api/schedule?from=&to=` shows meetings, open actions' due dates and open follow-ups in one list, for up to six months at a time.

- It reads `v_schedule`, which runs with the caller's rights. Each person sees only what they can already see. A client never sees a firm-private meeting or a firm check-in, and a department's meeting and a meeting of the whole project follow the rules above. An action owner gets their own actions and the follow-ups assigned to them only (row-level security since migration `0085_owner_actions`, and the service narrows it too), and the meetings they can open.
- `projectId`, `clientId` and `userId` narrow the list. With `userId`, it shows items for that person: meetings they organise or attend, actions they own, and follow-ups assigned to them. Firm admins use these filters to look at one client, project or colleague.
