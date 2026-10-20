# Follow-through data model

What happens after the consultants hand over their report. The goal: the firm knows, without calling the client, whether each recommendation was carried out, and the client is reminded and escalated before work goes stale.

Tables live in `apps/web/src/db/schema/app.ts`. The rules are in Postgres (`drizzle/0011_follow_through_rules.sql`) and tested in `tests/db/follow-through.test.ts`; the services repeat them for clear errors (`src/services/plan.ts`, `src/services/follow-through.ts`).

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

- **Only the firm writes the plan.** Findings, recommendations, actions, meeting notes, follow-ups and reports can be inserted, edited and deleted only by firm users who can see the project. Clients read them. Only draft actions can be deleted; a released action is closed as not applicable, so the record keeps it. An issued report (one with metrics) is frozen: only sharing it can change, and a correction is a new report.
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

## Evidence lists

`evidence_requests` is the list of what the firm needs to see before it verifies an action, e.g. "signed charter" or "board minutes".

- The firm writes the list. The client sees it.
- Uploading a file with `evidenceRequestId` links it to the item. The database checks the item belongs to the same action and marks it `submitted`.
- Only a file that passed the virus scan answers an item.
- Each item moves `open → submitted → accepted / rejected`; only a submitted item can be accepted. The firm can waive an item, with a note saying why. A rejected item can be opened again. Accepted and waived items are final. The decider and time are recorded.

## Deadline change requests

- The action owner, a client manager or admin, or the firm asks for a new due date (a different date, not in the past) with a reason; one request at a time per action.
- The firm approves or rejects, once. Approval moves the action's due date in the same transaction.
- Requests are never deleted. Finished actions take no new requests.

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

For now each send is an in-app notification (`follow_up.overdue.2`, etc.). Email is a later step.

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
| `PATCH /api/actions/:id` | firm (plan); client manager (owner only) |
| `POST /api/actions/:id/transition` with `to: "closed"` and `closure` | firm |
| `GET, POST /api/actions/:id/evidence-requests`; `PATCH /api/evidence-requests/:id` | read: everyone on the action; write: firm |
| `GET, POST /api/actions/:id/risk-acceptances` | sign: client admin or manager |
| `GET, POST /api/actions/:id/notes` | firm only |
| `POST /api/actions/:id/deadline-requests`; `PATCH /api/deadline-requests/:id` | ask: owner or client manager; decide: firm |
| `GET /api/projects/:id/progress` | anyone on the project |
| `POST /api/projects/:id/reports` | firm |
