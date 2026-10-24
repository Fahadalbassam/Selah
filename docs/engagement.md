# Engagement modes and departments

How much a client takes part in Selah, and the optional departments that narrow who at the client sees what. Tables in `src/db/schema`, rules in the Engagement section of `drizzle/0000_baseline.sql`. Every rule below is enforced in Postgres; `src/services/engagement.ts` gives clear errors. These modes are the team's proposal from earlier discussions, not confirmed requirements of any one firm, and all three run in the same platform.

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

## Client groups

A holding group (F34, decision D4) is a record of its own (`client_groups`: Arabic and English names, firm-only notes), kept by the firm admin. The client stays the tenant boundary, because a holding and a subsidiary are separate controllers under PDPL; a group only pools counts.

- Each member company takes one of two forms, chosen per company. **A linked client** (`client_group_members`, one group per client at most) keeps its data, people and files apart, as for a listed subsidiary. **A company inside a client** is one of that client's departments marked `is_company` by the firm admin while the client is in a group: it shares the client's people and files, and its numbers roll up into the client's. Unlinking a client turns its companies back into departments.
- `POST /api/client-groups`, `PATCH` and `DELETE /api/client-groups/:id`, `POST /api/client-groups/:id/members` (`clientOrgId`), `DELETE /api/client-groups/:id/members/:clientId`, and `PUT` or `DELETE /api/client-groups/:id/companies/:departmentId`. All are the firm admin's and audited (`client_group.*`).
- The group page pools the counts of its member companies from `app_client_progress()` under the reader's row-level security, with a row per company: each company inside a client from its department's row, and the client's own row from the rest. The percentage is worked out again from the pooled counts. No group KPIs: those wait on F35.
- The firm admin sees every group. A consultant sees a group only while assigned to one of its clients, and only those clients and their numbers. The client side reads none of these tables.
- **The group on the client side.** The firm admin names one member the holding (`client_group_members.is_holding`, `PUT /api/client-groups/:id/holding`) and grants named admins or managers of the holding the group's roll-up (`client_group_viewers`, `POST /api/client-groups/:id/viewers`, `DELETE .../viewers/:userId`; audited). They see `/group`: the pooled counts with a row per member company, from `app_client_group_rollup()`, which counts only what the firm and each company both see (released actions, projects past draft, shared recommendations). They open nothing of a linked company: its records stay behind its own row-level security. Nobody else at a member company sees the group or a sibling. A new holding ends the old holding's grants.

## Minimal records (consultant-managed only)

Some family offices want the firm to keep as little as possible. `PATCH /api/orgs/:id/engagement` with `minimalRecords: true` and a `displayAlias` (firm admin only; baseline: Insight):

- The alias replaces the client's name in Selah. Switching it on also clears the inquiry the client came from: the organisation's name and CR number, the requester's contact details and message, the discovery session's attendees and notes, and the notes in the inquiry's history. The inquiry keeps its link to the client and its statistics (sector, services, size, ownership, dates). Audit entries hold ids, not names.
- It is switched on before anything is filed: the client must have no contacts or files yet.
- From then on Selah refuses, for that client: files (so evidence is recorded as progress with `receivedVia`), client contacts, assistant indexing, and an account as an action's owner. `ownerName` holds a job title ("finance manager"), not a person's name.
- Leaving consultant-managed mode is refused while it is on.
- `npm run job:purge-minimal` (daily, as the schema owner) blanks free text once `firm_settings.minimal_purge_days` (90) have passed since `projects.handover_on`. Each project is purged once.
  - Blanked: progress updates, firm notes on actions, meeting agendas, notes, decisions and summaries, finding descriptions, recommendation rationale, target outcome and required evidence, action descriptions, closure notes and blocked reasons, and assessment answers' written text and comments.
  - Kept: titles (of the project, findings, recommendations, actions and meetings), owner job titles, statuses, dates, and who did what. Consultants write titles without names or sensitive detail.
- **Not for a client who forbids any record.** Minimal records keeps less, for less long, but Selah still stores the work while it runs. A client who does not allow its information to be stored at all should not be managed in Selah. An alias does not change that: the firm still holds the record.

## Screens

- **The client page** (`/clients/:id`) has a "How the client takes part" card for firm staff. The firm admin changes the mode there. Before saving, the dialog says what stands in the way of each mode: the number of active accounts, the accounts that are not client admins, the restricted limit, or minimal records being on (`getEngagement` returns this as `fit`, for the firm admin only). The database still decides, and its refusals are shown in the person's language (`engagementError` in `src/lib/engagement.ts`). Minimal records are switched on there too, with an alias, and only while the client has no contacts or files.
- **Departments**: `/clients/:id/departments` for the firm, and `/departments` for the client's admins and managers. Admins (the firm admin or the client admin) switch departments on or off, add, rename and switch off departments, and add or remove people and heads. Managers see the list.
- **Client groups**: `/clients/groups` and `/clients/groups/:id` for the firm. The admin creates and edits groups, links and unlinks clients, marks companies inside a client, names the holding and gives its people access; consultants read the groups of their clients. `/group` for the holding's people who were given access.
- **The action page** shows the action's department while the client uses departments. Firm staff who can change the plan file it under a department there, or under none.
- Files are not filed under a department from a screen yet. Evidence takes its action's department.
