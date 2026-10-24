# Follow-through data model

What happens after the consultants hand over their report. The goal: the firm knows, without calling the client, whether each recommendation was carried out, and the client is reminded and escalated before work goes stale.

Tables live in `apps/web/src/db/schema/app.ts`. The rules are in Postgres (the Follow-through section of `drizzle/0000_baseline.sql`) and tested in `tests/db/follow-through.test.ts`; the services repeat them for clear errors (`src/services/plan.ts`, `src/services/follow-through.ts`).

## The plan

```
project ─┬─ findings ── recommendations ── actions ─┬─ evidence_requests ── evidence_submissions
         │                (source: consultant,      ├─ reviews
         │                 board_decision,          ├─ risk_acceptances
         │                 compliance)              ├─ deadline_change_requests
         │                                          ├─ action_notes (firm only)
         ├─ meeting_notes ─(board decisions link)   └─ follow_up_log (reminder job only)
         └─ reports (periodic, with frozen metrics)
```

- **Only the firm writes the plan.** Findings, recommendations, actions, meeting notes, follow-ups and reports can be inserted, edited and deleted only by firm users who can see the project. Clients read them. Only draft actions can be deleted; a released action is closed as not applicable, so the record keeps it. Findings and recommendations follow the same rule (N1): the firm corrects them while they are live, shares a firm-only one with the client (one way, `released_at`), and withdraws a released one with a reason (`withdrawn_*`). A withdrawn recommendation stays on record, marked, with its open actions closed as not applicable and its drafts deleted. Only a firm-only record the client never saw can be deleted. An issued report (one with metrics) is frozen: only sharing it can change, and a correction is a new report.
- **The client answers each recommendation** (F10, `recommendation_responses`). Once a recommendation is shared, the client's admin (or the project's sponsor, in a full engagement) records whether it agrees, partly agrees or disagrees. Agreeing gives the planned action, who answers for it and the date; partly agreeing or disagreeing gives the reason. For a consultant-managed client the firm records it with how and when it heard, and a colleague confirms it before it counts. Responses are append-only: a new one supersedes the last, and `app_recommendation_stances()` reads where each recommendation stands (agreed, partly agreed, disputed, awaiting confirmation, awaiting response). The firm answers a response once. A disputed recommendation shows on the firm's deviation rules. A response is the client's record, never a judgement Selah makes.
- **The thread on each action** (F11, `action_comments`). The firm and the client talk about an action where the work is recorded. Everyone who can see the action reads and writes its thread, and a mention can name only someone who can see it too (`app_user_sees_action()` works that out for another person; `app_action_people()` lists them for the caller). The people in the thread hear about each new comment, by in-app notification and by mail as their update choices say. Comments are append-only; the author may remove one, which blanks the text and leaves a marker. The firm's own notes on an action (`action_notes`) stay firm-only.
- **Slip history** (F17, `action_due_changes`). Every move of a released action's due date, by an approved request (`request_id`) or a plan edit, with who moved it. Append-only and written by the database. A deadline request also keeps `due_date_then` and `raised_late` (asked after the due date had passed).
- **Clients move their actions.** An action owner moves their own actions through the workflow; a client manager or admin may also change the owner. The trigger allows a client user to change only `status`, `owner_user_id` and `blocked_reason` (an allow-list, so new columns are the firm's by default).
- **The owner** must be an active member of the project's org (the client, or the firm for internal projects) and staffed on the project.
- **Board decisions** are recommendations with `source = 'board_decision'`, which must have `decided_on` and may link the meeting note where it was decided.
- **A new action** starts as Draft or Assigned. Releasing it (Draft → Assigned) needs an owner and a due date, and only the firm can do it.

## Ending an action

An action ends one of two ways:

| End | How | Counts in progress as |
|---|---|---|
| Verified Complete | A firm reviewer accepts this round's evidence (a review after the action last entered Awaiting Review), and every evidence list item is accepted or waived | done |
| Closed, `partially_implemented` | Firm closes it with a note | counted separately, not done |
| Closed, `risk_accepted` | A client admin or manager signs a statement first (`risk_acceptances`, append-only), then the firm closes it. The signature must be newer than the last reopen, and the signer must still be an active admin or manager | not done |
| Closed, `not_applicable` | Firm closes it with a note | left out |
| Closed, `superseded` | Firm closes it naming the replacing action in the same project (`superseded_by`) | left out |

- A CHECK ties `status = 'closed'` to a closure outcome. The trigger records `closed_by` and `closed_at`.
- The firm can reopen a verified or closed action (→ In Progress). Reopening clears the closure; the history stays in `activity_events`. Nobody closes an action they own.
- On the action page (`actionClosure`): the firm's Close dialog asks for the outcome and a note. "Risk accepted" stays locked until a signature counts, and "superseded" offers the project's other open actions. Reopen asks for a reason. A client admin or manager gets a Risk acceptance card to sign a statement, which they must tick to confirm. Signatures from before the last reopen are shown as no longer counting. A closed action shows how it ended, who closed it, and what replaced it.

## Evidence lists

`evidence_requests` is the list of what the firm needs to see before it verifies an action, e.g. "signed charter" or "board minutes".

- The firm writes the list. The client sees it.
- Uploading a file with `evidenceRequestId` links it to the item. The database checks the item belongs to the same action and marks it `submitted`.
- Only a file that passed the virus scan answers an item.
- Each item moves `open → submitted → accepted / rejected`; only a submitted item can be accepted. The firm can waive an item, with a note saying why. A rejected item can be opened again. Accepted and waived items are final. The decider and time are recorded.
- On the action page the client sends a file against each open or rejected item, and the firm adds items, accepts, rejects (with a reason the client sees), waives or asks again. Items stop changing once the action is verified or closed.

## Deadline change requests

- The action owner, a client manager or admin, or the firm asks for a new due date (a different date, not in the past) with a reason; one request at a time per action.
- The firm approves or rejects, once. Approval moves the action's due date in the same transaction.
- Requests are never deleted. Finished actions take no new requests.
- The action page shows the requests beside the due date. The client asks from there while none is pending, and the firm approves or declines in place.

## Reminders and escalation

Each project sets `remind_days_before` (3), `escalate_level2_days` (7) and `escalate_level3_days` (14). The daily job (`npm run job:follow-ups`, as the schema owner) calls `app_follow_ups_due(today)` and notifies:

| Level | When | Who |
|---|---|---|
| 0, due soon | from `remind_days_before` days before the due date | the owner |
| 1, overdue | from the day after the due date | the owner |
| 2 | `escalate_level2_days` overdue | + the client's managers on the project, and the client's lead consultant (internal projects: the project leads) |
| 3 | `escalate_level3_days` overdue | + the client's admins and the firm admins watching the client or project |

- Only actions where the client holds the ball are chased (Assigned, In Progress, Blocked, Revision Requested). Work waiting for the firm's review is not.
- Only active members are notified. If the owner has left, they are skipped and the ladder starts at level 2.
- The job's "today" is the firm's local date (Asia/Riyadh).
- `follow_up_log` records each send, keyed by action, kind, level and due date. A run is safe to repeat, and a new due date re-arms the reminders.
- The app role cannot call the function or read the log.

Each send is an in-app notification (`follow_up.overdue.2`, etc.). On top of that, each recipient gets at most one summary mail a day (`follow_up.digest`). It says only that there are new reminders and links to `/notifications`. It skips anyone switched off or erased, and anyone who turned it off.

## Notifications

Reminders, escalations and workflow events (actions moving, evidence items, date requests, staffing, inquiries, access reviews) are written to `notifications`. Each person can read and update only their own rows (RLS).

- `GET /api/notifications` returns the newest 30 and the unread count.
- Each item carries what it is about and a link. Both are read under the caller's rights, so something they can no longer open shows without a title or link.
- `POST /api/notifications/read` marks the given `ids` read, or all of them when there are none.
- Screens: the bell in the header shows the unread count and the newest ten, and `/notifications` shows the last 100. Opening one marks it read.
- `GET` and `PUT /api/notifications/mail` read and set the caller's own `mail_preferences` (for now just `followUpDigest`, on by default). No row means the defaults. The switch is under the list on `/notifications`.

## Implementation progress

`app_project_progress(project, as_of)` runs with the caller's row-level security, so nobody gets numbers for actions they cannot see. Draft actions are not counted.

```
implemented % = verified / (released actions − not applicable − superseded)
```

Partially implemented and risk-accepted actions are reported next to it as counts, not given partial credit.

It also returns open and overdue counts. A periodic report (`POST /api/projects/:id/reports`) stores the numbers as of the period's end in `reports.metrics`, so later reports can show the trend. A report starts firm-private.

## APIs

| Route | Who |
|---|---|
| `POST /api/projects/:id/findings`, `/recommendations` | firm |
| `POST /api/recommendations/:id/actions` (with an optional evidence list and release) | firm |
| `PATCH`, `DELETE /api/findings/:id`, `/api/recommendations/:id`; `POST …/release`, `POST …/withdraw` (with a reason) | firm |
| `POST /api/recommendations/:id/responses` (stance, reason, planned action, owner, date; for a consultant-managed client also how and when it was received) | client admin; sponsor (full engagement); firm (consultant-managed only) |
| `POST /api/recommendation-responses/:id/confirm`, `POST …/reply` | firm |
| `GET`, `POST /api/actions/:id/comments` | anyone who can see the action (observers read only) |
| `POST /api/action-comments/:id/remove` | the comment's author |
| `PATCH /api/actions/:id` | firm (plan); client manager (owner only) |
| `POST /api/actions/:id/transition` with `to: "closed"` and `closure` | firm |
| `GET, POST /api/actions/:id/evidence-requests`; `PATCH /api/evidence-requests/:id` | read: everyone on the action; write: firm |
| `GET, POST /api/actions/:id/risk-acceptances` | sign: client admin or manager |
| `GET, POST /api/actions/:id/notes` | firm only |
| `POST /api/actions/:id/deadline-requests`; `PATCH /api/deadline-requests/:id` | ask: owner or client manager; decide: firm |
| `GET /api/projects/:id/progress` | anyone on the project |
| `POST /api/projects/:id/reports` | firm |

## Handover and deviations

Rules: the Handover section of `drizzle/0000_baseline.sql`. Tests: `tests/db/handover.test.ts`.

- **Client roles** (`project_client_roles`): sponsor, coordinator, steering committee, acceptor, observer. Each row is a client account or a client contact (so consultant-managed clients have them too). The sponsor and coordinator are single; a new one replaces the old. Accounts holding the sponsor, coordinator or acceptor role are active admins or managers of the client. The firm admin and the client's lead name anyone; the client's admin names accounts only. Shown on the project's Team tab (`GET/POST /api/projects/:id/client-roles`, `DELETE .../client-roles/:roleId`). The sponsor is added at escalation level 3.
- **Check-ins.** Setting `projects.handover_on` creates follow-ups at 30, 60 and 90 days (`firm_settings.checkin_days`). They are due at 09:00 Riyadh time, assigned to the client's lead consultant, and firm-private. Moving the handover date moves the check-ins still open.
- **On the project page** (Progress tab, `getHandover`/`setHandover`, `PATCH /api/projects/:id/handover`): everyone who sees progress sees the handover date and the sponsor. The firm admin sets the date; the sponsor is a client role. Firm staff also see the check-ins, and the assignee or firm staff mark each one done.
- **Deviations** (`v_deviations`, under the caller's RLS). One row per open action or KPI and the rule it breaks. AI may summarise the rows later; the rules decide what counts.

| Rule | Meaning |
|---|---|
| `overdue` | The current due date has passed. |
| `stale` | No change, progress update or evidence in `firm_settings.stale_days` (14). |
| `slipped` | 2 or more approved deadline changes. |
| `churn` | 2 or more revision requests. |
| `orphaned` | The owner is no longer an active member. |
| `kpi_not_reported` | A KPI period passed its grace days with no reading (client KPIs on). |
| `kpi_off_target` | The latest reading is in the red band (client KPIs on). |

- **On the project page:** firm staff get a "Needs attention" tab (`projectDeviations`, permission `deviation.read`), which lists each item and the rule it breaks, most pressing first. Everyone who reads recommendations gets a "Trace" tab (`app_trace`) showing findings → recommendations → actions → evidence and reviews, and objectives → KPIs → the recommendations meant to move them. Everyone who reads actions sees what moved since their last visit (`app_changed_actions`) above the tabs. The page moves the mark after showing it (`PUT /api/projects/:id/since-last-visit`).
- **AI draft outcomes** (`ai_drafts`): whoever saw a draft records whether it was accepted unchanged, edited (with the edit distance) or discarded. The firm reads them to evaluate the drafts. Append-only. The table fills once AI drafting is on.
