# Authorization

Selah decides access on the server from **organization + role + project membership + assignment + visibility label**. A role alone never grants access, and hiding a button is never the control.

There are two layers. Both must allow a request.

| Layer | Where | What it decides |
|---|---|---|
| `authorize()` | `apps/web/src/authz/authorize.ts` | Everything: the five questions below, per permission |
| Row-level security | `apps/web/drizzle/0000_baseline.sql` (Security section) and later migrations | Backstop: tenant, project and label isolation, drafts kept from clients (D6), plus "only firm can review" |

## The five questions

`authorize(principal, permission, resource)` asks, in order, and the first "no" denies:

1. **Organization.** Client users reach only their own organization. Firm staff reach client records only through a project their firm runs, and a consultant only for clients assigned to them.
2. **Role.** Does `POLICY[permission]` grant this role anything? (`src/authz/policy.ts`)
3. **Project membership or client assignment.** The firm admin sees every project the firm runs, and a client admin every project of their organization. A consultant sees only the projects they are staffed on (`project_members`); the lead of a client sees all of that client's projects. Being on a client's team alone opens the client's name and team, not its projects. Everyone else, including consultants on internal projects, must be a project member.
4. **Scope of the grant.** `any`, `assigned` (e.g. action owners and their actions), `own`, `shared` (explicit per-user shares), `owner_org` (who controls a document's labels and AI flag), `lead` (the client's lead or deputy), `team` (a department's files), or `working` (a consultant who does the client's work: its lead or deputy, or staffed on one of its projects other than as an observer).
5. **Visibility label.** `shared`, `firm_private` (firm only), `client_private` (that client only, not even the firm admin), `user_private` (creator only).

## Internal and client projects

A project has a `kind`. An **internal** project belongs to the firm (`org_id = firm_org_id`, enforced by the `check_project_orgs` trigger); client roles never see it. A **client** project belongs to a client organization. The firm admin manages `client_assignments`, which is what places a consultant over a client. RLS mirrors this in `app_can_see_project()` and `app_is_assigned_to_client()`.

## Staffing (who works on which client)

Decided with the product owner on 2026-10-20:

- Only the **firm admin** adds clients and names one **lead consultant** per client (`client_assignments.is_lead`).
- The **lead** adds or removes other consultants on that client (`client_assignment.manage`, scope `lead`). Only the admin changes or removes the lead.
- Consultants see a **directory of client names only** (`app_client_directory()`, no projects, people or files) and can **ask to join** with a reason (`join_requests`). The admin or that client's lead approves or declines; a decision is final and audited.
- Being on a client's team makes a consultant **eligible**; the client's lead (or the admin) **staffs them on each project**, and they see only those projects (decided 2026-10-20). Leaving the client team takes them off its projects.
- The **firm admin** sees everything. To get notifications they either **co-consult** (staff themselves on a project) or **watch** a client or project (`watches`, `project.watch`). Other admins get no notifications for work they don't follow.
- Work sent for review notifies the project's firm audience: the client's lead, the staff on the project (an internal project's leads), and watching admins (`app_notify_project_team()`).
- A client has **many projects** (one per phase or separately agreed scope, decided 2026-10-24, option B). The firm admin and the client's lead create them from the client page (`POST /api/clients/:id/projects`) with an optional phase number, planned working days, dates and the project it continues; the admin corrects them later (`PATCH /api/projects/:id`).
- **Client people on a project** (`/api/projects/:id/people`): client managers and action owners see only the projects they are on, and an action's owner must be on its project. The firm admin, the client's admin and the client's lead consultant add the client's active people from the project's Team tab; nobody comes off while they own open actions there (`check_member_removal()`). A restricted client has only admin accounts; a consultant-managed client has none, so its owners are named on each action instead.
- Any firm member can create an **internal project** and becomes its lead (`project_members.is_lead`).
- On internal projects firm staff do the work themselves (`INTERNAL_POLICY` in `policy.ts`), and **nobody reviews their own action** (`workflow:self-review`, mirrored in the `reviews` insert policy).

- **Client business indicators** belong to the client, not a project (`indicator.*`, migration `0062_client_indicators`). Firm staff who work with the client and the client's admins set them up and link them to recommendations; admins and managers, and firm staff, enter values; a manager sees the company's indicators and their own departments'; action owners see none. A link to a firm-private recommendation is visible only to whoever can read that recommendation (docs/metrics.md).
- **Which firm staff change a client's indicators** (decision D4, 2026-11; migration `0073_observer_indicators`). Because indicators are the client's, the observer rule below (which looks at the project a record is in) never reached them. So the rule is written from the other side: a consultant enters, corrects or checks a value, adds, edits, pauses or deletes an indicator, links or unlinks a recommendation, or changes how the figures reach Selah **only when staffed, not as an observer, on at least one of that client's projects that is not closed, or as its lead or deputy**. Every other consultant who works with the client (an observer, someone on the client's team staffed on nothing, or someone staffed only on closed projects: a closed project is read-only, migration `0075_closed_project_indicators`) reads. A lead or deputy never observes the client's projects: naming one ends their observing. The firm admin and the client's own roles are unchanged. In `authorize()` this is the `working` scope, from `principal.workingClientIds`; in the database, `app_firm_changes_kpis()` behind every write policy on the indicator tables. Tests: `tests/db/observer-indicators.test.ts`.

RLS for all of this is in the Staffing and Staffed visibility sections of `drizzle/0000_baseline.sql`.

The `Principal` is built from the session and the database (`services/principal.ts`), never from anything the browser sends.

## What a person with limits never sees by title

Decision D8 (2026-11): a person never sees, by title, work they may not open, on any screen, whatever role they hold on the project. Two kinds of reader have limits. An **action owner** opens only their own actions. A **client manager at a client with departments switched on** opens company-wide work and the work filed under their own departments (`app_dept_ok()`); the client's Departments page promises exactly that. Where a list leaves something out, the screen says how many, never what. Tests for every row: `tests/db/privacy-leaks.test.ts`.

| Where | Rule | Held by |
|---|---|---|
| A recommendation's page | Lists only the actions the reader may open (an action owner: their own), then one line with how many more there are. A draft is neither listed nor counted for a client (see "Draft actions" below). | `getRecommendation()` in `services/responses.ts`; `app_actions_left_out()` |
| The plan, under a finding | A finding answered only by a recommendation in a department the reader is not in says "answered in another department", not "no recommendation yet". | `getProject()`; `app_findings_answered_elsewhere()` |
| A department's meeting | Read by the department's people, the client's admins, the firm on the project, the organiser and anyone invited; so are its attendees, decisions, summary, follow-ups, notes, calendar file and its line on the schedule. A follow-up still reaches the person it is assigned to. A meeting with no department is open to everyone on the project, as before. | `app_can_see_meeting()`, policies `department` and `department_book` on `meetings`, `meeting_department` on `follow_ups` and `meeting_notes` (migration `0070_department_meetings`) |
| A meeting's stored agenda | Sent only to a reader who may open every action it can name: the firm on the project, the client's admin, and a client manager for whom no released action of the project (of the department, for a department's meeting) fails the department check; a draft, which an agenda never names, does not count. Never to an action owner. Everyone else gets one line saying so. The app role cannot read the column; the text comes only from `app_meeting_agenda_for()`. | migrations `0072_agenda_readers`, `0077_agenda_drafts`; `getMeeting()` |
| The project's activity record | For the firm and the client's admin. Client managers and action owners get neither the tab nor the rows. | `activity.read`; policy `scoped_read` on `activity_events` (migration `0071_activity_readers`) |
| A shared status pack | Items of other departments are left out of each list, with how many; an indicator names only the linked recommendations the reader can open. The numbers stay whole: a person at the firm chose to share the report. The app role cannot read the column `reports.pack`; an issued pack comes only from `app_report_pack_for()`, which answers nothing to an action owner. | migration `0074_status_pack_readers`; `reportPack()` in `services/status-pack.ts` |
| The Departments page | Names, members and heads are for everyone at the client; a card links to the department's page only for the firm, the client's admin and the department's own people. | `getEngagement()` (`canOpen`) |

## Draft actions

Decision D6 (product owner, 17 Nov 2026): **a client does not see a draft action until the firm releases it.** This reversed the earlier behaviour, where a client admin or manager could list and open a draft. A draft is an action with status `draft`; the firm releases it (Draft → Assigned, `action.release`). Firm roles see drafts exactly as before.

No client role (client admin, client manager, action owner, even the person the draft names as owner) reads the draft or anything under it: progress, evidence and its evidence list, reviews and sign-offs, risk acceptances, date requests, firm notes, the discussion, due-date history, reminders and follow-ups, mail mutes, closure items, the activity events and notifications about it, translations of its text and its assistant passages. A client can write none of these either. Opened by its address or through the API it answers 404, like a missing record. When the firm deletes a draft (only drafts are deleted), its activity events and any notice about it stay hidden from client people; they are kept for the firm. Lists, counts, "N more" lines, exports, reports, status packs and assistant answers for a client leave drafts out.

| Where | Held by |
|---|---|
| The database | One RESTRICTIVE policy `draft` on `actions` and on every table under an action, and on `activity_events`, `notifications` and `content_translations` for rows about an action, through `app_action_visible_to_client()` (migration `0076_drafts_hidden`). The definer functions that read actions past row-level security check the same: `app_can_see_action()` (reminder ladder, people on the action, due-date moves, refilings, the discussion), `app_user_sees_action()` (who may be mentioned or told), `app_owns_action_under()`, `app_second_review_state()`, `app_name_sustainer()`, the departing-person report. The assistant's passages are read through `with_source`, which looks the action up under the caller's rules. |
| `authorize()` | `resource.draft` (set by `loadAction()`, `listActions()` and every place that builds an action resource) denies every client role with `action:draft`, for the action and for every record built from it. |
| The assistant | `scopeFilter()` in `services/assistant.ts` leaves a draft's passage out inside the vector search's `WHERE` for a client scope, besides row-level security. |
| Telling people | A notification about a draft for anyone outside the firm is dropped before it is stored or mailed (`drop_hidden_action_notification()`); the owner is told at release ("was released to you"), as before. Notices written before that rule are kept, never deleted: one rule, `app_action_notice_hidden()`, keeps a notice about a draft, a deleted draft or one written before the action's release from client people for good, on screen (policy draft on notifications) and in the summary mail (`app_queue_digests()`). |
| People leaving | The departing-person report lists a draft the person is named on, and it blocks the switch-off, only when the firm asks. A client admin is never shown its title, is not stopped by it, and their hand-over leaves it with the firm. Releasing a draft checks its owner again (an active member of the project team), so the firm names someone else if the person has left; the draft page says so before Release is pressed, and the refusal says the same (`ownerGone` in `getActionDetail()`, `action.errors.ownerGone`). |

Tests: `tests/db/drafts-hidden.test.ts`, the "plan's records as passages" block of `tests/db/ai-sources.test.ts`, and the D6 block of `tests/authorize.test.ts`.

## How a request flows

```
route()  ─ CSRF origin check, session, Zod validation
  └─ asUser(userId)  ─ one transaction; set_config('selah.user_id') so RLS applies
       └─ loadPrincipal()
            └─ service  ─ load the row (RLS hides other tenants entirely)
                 └─ assertAllowed(principal, permission, resource)
```

A denial returns **404**, the same as a missing record, so ids cannot be probed, and is written to the audit log.

## Workflow

`src/authz/workflow.ts` lists every allowed status move and the permission it needs:

| Move | Permission | Who |
|---|---|---|
| Draft → Assigned | `action.release` | Firm admin, consultant (until then the client does not see the action: "Draft actions" above) |
| Assigned → In Progress, In Progress ↔ Blocked, In Progress → Awaiting Review, Revision Requested → In Progress | `action.work` | Action owner (own actions), client manager |
| Awaiting Review → Verified Complete or Revision Requested | `action.review` | Firm admin, consultant |
| Any open status → Closed (with an outcome) | `action.close` | Firm admin, consultant |
| Verified Complete or Closed → In Progress | `action.reopen` | Firm admin, consultant |

The database trigger `check_action_transition` holds the same list and also requires an `accept` review before Verified Complete. Only firm staff can insert reviews (RLS). So a client claim can never become "verified".

Nobody reviews or closes an action they own or submitted evidence for. The trigger (Follow-through section of the baseline) also refuses, for client users: releasing, reviewing, closing and reopening, and any change to the plan columns (title, description, due date, closure fields). Client managers and admins may change the owner. Writes to findings, recommendations, meeting notes, follow-ups and reports are firm-only in RLS. See [data-model.md](data-model.md) for closure outcomes, evidence lists, deadline requests and reminders.

### Second sign-off (F22)

Some work is verified only after two consultants have checked it. It applies when the client's rule says so (`client_review_settings`: off, after two revisions, high and critical priority work, or every action; each level includes the ones before), or when the action's own switch is on. The firm admin, or the client's lead or deputy (`organization.second_review`), sets the rule on the client page. The same people, or an internal project's lead (`action.second_review`), turn an action's switch on or off.

On such work the first consultant who accepts records a sign-off (`app_sign_off()`, written to `review_signoffs` with the evidence hashes they saw), and the action stays Awaiting Review. Someone else's accept then verifies it. Neither sign-off can come from the owner or from anyone who submitted evidence in the round, and the second never comes from the first reviewer. The trigger `check_second_review` refuses Verified Complete without a first sign-off from a different consultant, and refuses the switch to anyone but the people above. Either reviewer may ask for a revision instead. The next round then needs both sign-offs again. Who could give the second sign-off is told in Selah. The list is the project's staff and the client's lead and deputy. When none of them is left, it falls back to the firm's admins. Clients see that a second consultant checks the work, never the rule or the names of who could check it.

## AI retrieval

`retrievalScope()` turns the same check into a filter (project, tenant, allowed labels, user). `services/assistant.ts` puts that filter **inside** the pgvector query's `WHERE`, and the query also runs under RLS. Chunks are deleted by trigger when a document's AI flag is turned off, its label changes, or it is archived. The AI service only receives the passages that survived.

Client admins and managers get the assistant only where the firm admin offered it to their role and their admin agreed (wave 3, F39): `assistant.query` lists them, `authorize()` also requires `principal.clientAssistant` (from `app_client_ai_on()`), and RESTRICTIVE policies on `ai_chunks` and `ai_conversations` check the same in the database. Action owners stay excluded because their document access is per-user shares, which the index does not carry. See [assistant.md](assistant.md), "The client assistant".

## File explorer

The Files sheet in the sidebar (`GET /api/files`, `services/files.ts`) lists documents from the database, never from the bucket. Rows come back filtered by RLS (project, label, department, someone else's unsubmitted evidence), then each passes `authorize("document.download")` with its per-user shares. So the explorer shows exactly the files a person could already open elsewhere:

| Who | Sees |
|---|---|
| Firm admin | Every file of every client the firm runs, and internal work. Never a client-private file. |
| Consultant | Files of the projects they are staffed on (all of a client's projects when they lead it). Never client-private files. |
| Client admin | All of the company's files, including client-private ones. Nothing of the firm or other clients. |
| Client manager | The company's files outside departments, and their own department's. |
| Action owner | Their own uploads, their department teammates' files (decided 2026-10-22: the team sees each other's work, the manager and client admin see everything below), and files shared with them one by one. |

A file shared with someone one by one reaches them even when it is filed under another department (baseline: Document shares across departments).

## Observers

An observer on a project (a firm consultant, migration `0034_observers`) reads everything there and changes nothing, except adding a firm note to an action and asking the assistant. `authorize()` refuses every other write on a record of that project, and the trigger `check_not_observer()` refuses it in the database. The screens draw no control the database would refuse: on a meeting the observer gets no edit, invite, cancel, attendee, decision, summary, follow-up or reply control (`canRun`, `canFollowUp`, `canRespond` in `getMeeting()`), and on the project's Assessments tab no "Start an assessment". On the client's business indicators an observer reads only (see Staffing above).

Files are grouped client, then project, then source (evidence by action, deliverables, client documents, meetings, assessments). Only the latest version is listed; downloads go through the usual one-minute signed link.

**Reusing a file as evidence** (`POST /api/actions/:id/evidence/existing`) copies the stored object under a new random key and records a new evidence document. The original keeps its label, department and history; the copy follows the evidence rules. It is refused unless the person can submit evidence on the action and download the original, and the original belongs to the same client, is `shared` (never firm-only or private) and was cleared by the virus scan. Tests: `tests/db/files.test.ts`.

**Adding a file to a project** (`POST /api/projects/:id/documents`, the Files card's "Add a file") is open to firm staff on the project and to client admins and managers. `GET /api/files/targets` lists the projects and the choices each side has: firm staff label a file firm-only or shared (internal work is always firm-only); a client labels it shared or private to the company (a restricted client's files start private); a client admin can file it under any department, a manager under their own. Files are scanned like evidence. The upload is audited but kept off the project's activity feed, which the firm and the client's admin see.

## Adding a new record type (checklist)

1. Add the table in `src/db/schema/app.ts` with `project_id`, `org_id` (via `scoped()` and `scopedFk()`) and, if it can be private, `visibility`.
2. `npm run db:generate`, then add grants and an RLS policy in a new custom migration (`npx drizzle-kit generate --custom`). Without them the app role cannot touch the table. `tests/db/rls.test.ts` fails if RLS is off.
3. Add permissions to `POLICY` with the narrowest grants that work.
4. Write the service: load the row, build the `Resource`, call `assertAllowed()`.
5. Expose it with `route()`.
6. Add allow **and** deny tests: other tenant, other project, wrong role, wrong label.

## Rules that are proposals

Several rules here are tagged **[Proposed]** in the spec (for example: the firm admin cannot see client-private documents, client managers only request deadline changes, action owners see documents only when shared). They are implemented so they can be tested, but the team should confirm them before the report presents them as requirements.
