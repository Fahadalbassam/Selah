# Engagement modes and departments

How much a client takes part in Selah, and the optional departments that narrow who at the client sees what. Migrations 0024 (tables) and 0025 (rules). Every rule below is enforced in Postgres; `src/services/engagement.ts` gives clear errors. These modes are the team's proposal from earlier discussions, not confirmed requirements of any one firm, and all three run in the same platform.

## The three modes

`organizations.engagement_mode` is set for every client (it is null for the firm) and starts as `full` unless chosen otherwise when the client is created (`POST /api/clients`) or when a won inquiry becomes a client (`POST /api/intake/inquiries/:id/convert`, `client.engagementMode`).

| | full | restricted | consultant_managed |
|---|---|---|---|
| Client accounts | any client role | client admins only, up to `firm_settings.restricted_max_admins` (2) | none |
| Who records progress and evidence | the client's people | the client admin | firm staff on the project, for the client |
| Client uploads | as chosen | private to the client until a client admin shares them | n/a |
| Reminders | the owner, then the ladder | the owner (an admin), then the ladder | the client's lead consultant at every level, then the watching firm admins |

- **Changing the mode.** `PATCH /api/orgs/:id/engagement` with `engagementMode`, by the firm admin only. Each change is in the audit log (`organization.engagement_mode`, with from and to). Nothing is deleted. A mode is refused while the client has accounts that do not fit it: switch the others off first (`PATCH /api/people/:id`), then change it.
- **Accounts.** Invitations and memberships are checked against the mode when they are made and again when an invitation is accepted, so a mode changed in between still holds.

## Consultant-managed: recording for the client

The client does not use Selah. Firm staff on its project record what they hear through normal consulting work.

- `POST /api/actions/:id/updates` and `POST /api/actions/:id/evidence` take `receivedVia` (`meeting`, `email`, `phone`, `document`) and `receivedOn` (a date, not in the future). Firm staff must give both; nobody else passes them.
- Every progress update and evidence submission has a `source` set by the database from the author's organisation: `client_portal`, `consultant_recorded`, or `internal` (an internal project). It is returned on the action's timeline, so screens and reports can show "recorded by a consultant" next to "submitted by the client" and never mix the two.
- Firm staff can record only for a consultant-managed client. In the other modes the client records its own work.
- An action's owner can be a name instead of an account: `ownerName` on `POST /api/recommendations/:id/actions` and `PATCH /api/actions/:id`, for consultant-managed clients only. Client contacts (`/api/clients/:id/contacts`) hold their details.
- **Separation of duties.** Whoever submitted evidence, or recorded progress for the client, since the last review cannot review that round. Someone else on the team verifies.

## Restricted: client-private files

- What a client admin uploads is stored `client_private`, whatever the upload asked for. Firm staff, the firm admin included, get a 404 for it, and the assistant never indexes it.
- `POST /api/documents/:id/share` (client admin only) shares it with the firm. Sharing is one-way: a file the firm has seen is never made private again. The share is recorded in the action history (`document_shared`) and the audit log.
- Evidence is shared by submitting it, because the firm must see it to verify. Evidence cannot point at a client-private file.
- Be honest in the UI: these files are "private from the firm's users in Selah". The firm still runs the server.
- Switching a restricted client to full keeps its private files private.

## Departments

Optional and off by default (`organizations.departments_enabled`). Nobody is turned away for not using them.

- `PATCH /api/orgs/:id/engagement` with `departmentsEnabled` switches them on or off (the client admin or the firm admin; audited as `organization.departments`).
- `GET /api/orgs/:id/engagement` returns the mode, the flag and the departments with their people. `POST /api/orgs/:id/departments`, `PATCH /api/departments/:id` (rename, or `active: false`), `PUT /api/departments/:id/members/:userId` (with `isHead`) and `DELETE` manage them. Members are active people of that client.
- An action or document can carry `departmentId`. When departments are on, it is visible only to the department's members, the client's admins, the firm staff who can see the project, and the action's owner (or the file's uploader). Everyone else gets a 404. Progress, evidence, evidence requests and reviews follow their action, and an evidence file takes its action's department.
- Switched off, everyone on the project sees everything again. The department column stays.
- The assistant's index copies each chunk's department, and retrieval applies the same rule inside the vector search. Refiling a document or an action takes its chunks out until it is indexed again.
- Level 2 of the reminder ladder adds the head of the action's department.
- A department cuts across projects (HR work shows up in several), so it does not repeat the project scope.

## Minimal records (consultant-managed only)

Some family offices want the firm to keep as little as possible. `PATCH /api/orgs/:id/engagement` with `minimalRecords: true` and a `displayAlias` (firm admin only; migrations 0026–0027):

- The alias replaces the client's name in Selah. The real name is not kept here (the inquiry it came from is purged on its own schedule).
- It is switched on before anything is filed: the client must have no contacts or files yet.
- From then on Selah refuses, for that client: files (so evidence is recorded as progress with `receivedVia`), client contacts, assistant indexing, and an account as an action's owner. `ownerName` holds a job title ("finance manager"), not a person's name.
- Leaving consultant-managed mode is refused while it is on.
- `npm run job:purge-minimal` (daily, as the schema owner) blanks the free text of progress updates, firm notes, meeting notes, decisions and summaries once `firm_settings.minimal_purge_days` (90) have passed since `projects.handover_on`. Statuses, dates and who did what are kept. Each project is purged once.
