# Code recheck of the 30 Oct UI review

Checked against `C:\Projects\selah-lead` at commit `4497cd3` (main), read only. Paths are relative to `apps/web` unless they start with `docs/`. Migrations are in `apps/web/drizzle`.

## 0. What changed since the review (PR #136, commit 5f60748)

`git diff --stat 5f60748 HEAD` touches 53 files, all for client business-indicator data (#138) plus docs (#137, #146). No file of the project page, action page, client page, meeting page, inquiry page, help page, sidebar component, actions pages, Today, Oversight or people pages changed. The only UI-relevant changes are:

| Change | Evidence |
|---|---|
| Client admin's user menu gained "Data sharing" (`/indicators/data`) | `src/app/(app)/layout.tsx:151-156` |
| Client admin's home gained a skippable "data setup" card | `src/app/(app)/page.tsx:63, 90-92` |
| Indicators card gained two header buttons (data mode, "Import figures") | `src/components/indicators/indicators-card.tsx` (diff), links to `/indicators/data`, `/indicators/import` |
| Two new pages: `/indicators/data`, `/indicators/import` (a new file upload wizard, .xlsx/.csv) | `src/app/(app)/indicators/data/page.tsx`, `src/app/(app)/indicators/import/import-wizard.tsx:206` |
| New permission `indicator.data` | `src/authz/policy.ts:252-255` |
| +291 lines in each messages file (new labels, incl. data modes, feeds, import outcomes) | `messages/en.json`, `messages/ar.json` |

So every finding below is judged on code that is byte-for-byte what the reviewers saw, except where the table says otherwise.

---

## 1. Verdict per finding

| # | Finding | Verdict | Evidence | Explanation |
|---|---|---|---|---|
| U01 | Six screens list the same late or waiting actions | Still true (today: 9 screens that list such actions, 3 more that only count them) | See table 2c | Overview, Today, Review, Oversight, project "Needs attention" tab, Actions, Help, Department page and the meeting agenda each list overdue / awaiting-review / blocked actions from five different queries. |
| U02 | Project page with 11 tabs and ~93 controls for the firm admin | Still true for tabs (11); control count cannot be reproduced exactly from code | `src/app/(app)/projects/[id]/page.tsx:62` (11 names), `:254-269` (11 triggers); control definitions counted in 2b | A firm admin on an active client project gets all 11 tabs; the page's own components define about 126 buttons / menu items / dialog triggers in source (this includes buttons inside dialogs), and the rendered number multiplies per finding, recommendation, request and file row. |
| U03 | Action page with three uploads, three text boxes and the wrong "next step" | Still true | Uploads: `actions/[id]/action-panel.tsx:97` (send for review), `:153-156` (upload only), `actions/[id]/follow-through-panels.tsx:135-143` (answer an item). Text boxes: `action-panel.tsx:523-544` (progress update), `actions/[id]/comment-thread.tsx:167` (thread), `action-panel.tsx:467-471` (note inside the evidence dialog); firm also `actions/[id]/page.tsx:172-183` (private note). "Next step": `action-panel.tsx:89-152, 164` | The "Next step" card renders every allowed move as a button in the order of the transition table (`src/authz/workflow.ts:26-39`), so an owner in progress sees "Mark as blocked" before "Submit for review", then "Attach evidence". |
| U04 | Client home pages don't show the client's job; counters contradict the list | Still true (plus one more card for client admin since the review) | `src/app/(app)/page.tsx:69-74, 93-128`; `src/services/queries.ts:205-224` (counters), `:109-125` (list filter), `:177` | Counters count every action the person can read in every status and every project (including closed ones); the list is at most 10 actions that are overdue or revision-requested/blocked in non-closed projects; nothing on the page lists what the client must do (respond to recommendations, answer requests, sign, name people). |
| U05 | Five ways to send a file across two request systems | Still true (today: 7 in the working flow, plus 3 special imports; 1 import is new) | See table 2d | Three on the action (evidence list system), two on the project request list (logged-in answer and e-mailed link), plus the Files drawer and "new version". |
| U06 | "Add recommendation" in four places; findings shown as step one | Still true (3 buttons with the same label on one tab + plan import = 4 ways) | `projects/[id]/page.tsx:346-359` (on every finding row), `:381-393` (section header), `:402-415` (empty state), `:375-379` (import). Findings first: `:273-367` renders before recommendations `:369-523` | The Findings section is drawn above Recommendations for anyone who may add a finding, even when there are none. |
| U07 | Client page is a dashboard plus ten settings cards | Still true (today: 2 dashboard blocks + up to 14 cards, no tabs) | `clients/[id]/page.tsx:205-206` (progress, indicators), cards at `:207, 266, 315, 405, 488, 529, 556, 568, 577, 621, 623, 624, 626, 642` | One long page; see 2b for the card list and conditions. |
| U08 | A client admin can invite a colleague but cannot give them work | Still true | Invite: `team/people-admin.tsx:58-67` (`/api/orgs/{id}/invitations`), `policy.ts:60`. Put on a project: `policy.ts:76`, `projects/[id]/project-people.tsx:29-38`. Assign: `policy.ts:159` (no `client_admin`), no UI control at all (see 2j) | The policy leaves `client_admin` out of `action.assign_owner` although the database rule would let them, and no screen offers "change owner" to anyone. |
| U09 | Long sidebars showing admin tools to everyone | Partly true | `src/app/(app)/layout.tsx:23-107`; see 2a | Audit and Settings are admin-only, but every consultant gets Inquiries, Templates, Team (People, Expertise) and every client manager gets Team and Departments (read-only for them); firm staff have 9-10 top-level entries and 7 sub-entries; Help is offered twice to client roles (`layout.tsx:144` and `:150`), language and theme three and two times. |
| U10 | About 68 status words; one Arabic word for several approvals | Still true (today's count is higher) | See 2f | 120 state labels in 32 workflow groups (98 distinct English, 105 distinct Arabic); "اعتماد" is used for six different things. |
| U11 | Clients see the firm's machinery | Still true | Reminder ladder shown to everyone: `actions/[id]/reminder-ladder.tsx:7-11`, `actions/[id]/page.tsx:330`. Second sign-off status to clients: `action-panel.tsx:168`. Trace tab for client admin/manager: `projects/[id]/page.tsx:105, 262`, `src/services/insight.ts:24-26`. Activity tab for all: `page.tsx:267`. Progress tab (on-time rate, revision rate): `page.tsx:255, 608-613`, `projects/[id]/progress-tab.tsx:132-134`. Slip history and aging bucket: `follow-through-panels.tsx:284-296, 336-353` | Client admins and managers get 8-10 of the 11 project tabs and the action page shows them the escalation ladder, slip history and review plumbing. |
| U12 | Firm vocabulary on client screens | Still true | Home counter hint "Client-claimed progress, not verified" is shown to the client too: `page.tsx:70`, `messages/en.json:75`; "Trace" `en.json:2185`; statuses "Revision requested", "Verified complete" (`en.json` `status`); "Paused while the action waits on the firm" `en.json:612` | The client home and action page reuse the firm's wording; only some hints have a `hintClient` variant. |
| U13 | People and roles managed in four places | Still true (today: 8 places firm side, 4 client side) | See 2g | |
| U14 | Meeting page shows everything before the meeting happens | Still true | `meetings/[id]/page.tsx:197-257` (Summary card always), `:259-289` (Decisions card always), `:291-332` (Follow-ups when the viewer may add them and the meeting is not cancelled), `:334-350` (Transcript panel for firm organiser regardless of status), `:353-` (attendees) | Before the meeting the page already shows empty Summary, Decisions, Follow-ups and Transcript cards. |
| U15 | Dense rows where every rare action is a visible button | Still true | Request rows: `projects/[id]/info-requests-tab.tsx:279-322` (send link, review, return, reopen, not applicable, edit, remove, plus answer `:391`). Client team rows: `clients/[id]/page.tsx:373-392` (make lead, deputy, remove). Contacts rows: `:455-472`. Evidence items: `follow-through-panels.tsx:134-177` (answer, accept, reject, waive, reopen). Join requests `:545-546` | Only findings/recommendations (`record-actions.tsx:113-122`), files (`file-actions.tsx:119-128`) and people (`team/people-panels.tsx:93-`) use an overflow menu. |
| U16 | Inquiry page with five cards each claiming to be the next step | Still true in substance | One card titled "Next step" with up to 5 buttons: `inquiries/[id]/page.tsx:188-250`. Side cards each with their own action: owner `:420-`, conflict check `:454-`, qualification `:519-`, NDA `:581-`, convert `:615-`, suggested leads `:644-` | Only one card carries the title "Next step" in code; the other five to six cards each hold a step of their own (assign, check conflicts, rate, NDA, convert, pick a lead). |
| U17 | Help page is a second home page | Still true | `help/page.tsx:78-101` (first steps), `:104-117` (ask), `:119-145` (problem form + own reports), `:148-149` (my open actions table), `:151-188` (consultants, per-project cards), `:190-202` (7 FAQ) | Help repeats "my open actions" (`src/services/help.ts:67`) and project links beside the real help content. |
| U18 | Lists that hide what matters | Still true | Actions list: no filter, search or sort; all statuses mixed, ordered by due date only (`actions/page.tsx:29`, `queries.ts:155`); owner hidden below `sm`, project below `md` (`src/components/actions-table.tsx:35-36`). Clients list shows name, lead, team, project count only (`clients/page.tsx:102-105`) | |
| B1 | Raw status keys on the meeting agenda | Still true | `drizzle/0021_departments_across.sql:119` (`c.title \|\| ' (' \|\| c.status \|\| ')'`), printed as-is at `meetings/[id]/page.tsx:180-191` | The "Changed since the last meeting" section writes the database value (`in_progress`, `awaiting_review`) into the stored agenda text; the function was not redefined after 0021. |
| B2 | Three different percentages for one project | Still true (three code paths, at least two formulas) | Projects list: `projects/page.tsx:58` (verified ÷ all actions, drafts and not-applicable included). Progress tab: `progress-tab.tsx:98` ← `app_project_progress` (`src/services/follow-through.ts:388-393`; formula comment `drizzle/0000_baseline.sql:2614`: verified ÷ released actions that still apply). Client overview row: `src/components/client-progress.tsx:39, 75` ← `app_client_progress` (`src/services/client-overview.ts:84`) | Whether the second and third agree on real data cannot be told from code; the first certainly differs. |
| B3 | Reminder ladder shows past dates on finished actions | Still true | `drizzle/0019_mail_choices.sql:293-303` (rows for any action with a due date and owner; `running` false when finished, `:300`), `actions/[id]/reminder-ladder.tsx:13` (renders when there are steps), `:40` (unsent step prints its date), `actions/[id]/page.tsx:330` | A verified or closed action still gets the card, with "paused" text and the old step dates. |
| B4 | Departments switch drawn "off" while on | Cannot tell from code | `src/components/departments-manager.tsx:80-85` binds `checked={data.departmentsEnabled}`; `src/components/ui/switch.tsx` (thumb position by `data-[state=checked]` classes on an Animate UI primitive) | The binding is right; a drawing fault would be in the switch primitive. Neither file changed since the review, so if it was broken then it is broken now. |
| B5 | Hydration error on the meeting page | Cannot tell from code | No file under `meetings/[id]` or `src/components/meeting-form.tsx` changed since the review | No obvious mismatch found (dates are formatted on the server; `started` is server-only, `page.tsx:40`). Needs the browser console. |

---

## 2. Structure facts

### 2a. Sidebar, footer and user menu per role

Source: `src/app/(app)/layout.tsx:23-107` (`navFor`), `:135-158` (props), `src/components/app-sidebar.tsx:143-209`, `src/components/nav-user.tsx:71-107`.

| Entry | firm_admin | consultant | client_admin | client_manager | action_owner | Condition (file:line) |
|---|---|---|---|---|---|---|
| Overview `/` | yes (half row) | yes (half row) | yes | yes | yes | `layout.tsx:24, 32, 81, 89` |
| Today `/today` | yes | yes | no | no | no | firm roles, `layout.tsx:26, 34` |
| Projects `/projects` | yes + 3 sub (All, Client, Internal) | same | yes (no sub) | yes | yes | `layout.tsx:35-44, 81, 90` |
| Clients `/clients` | yes + 2 sub (All clients, Client groups) | same | no | no | no | `layout.tsx:45-53` |
| Inquiries `/inquiries` | yes | yes | no | no | no | `layout.tsx:54` (list itself filtered: `policy.ts:273`) |
| Actions `/actions` | yes (also marks `/review`, `/oversight`) | same | yes | yes | "My actions" | `layout.tsx:56, 81, 91` |
| Assessment templates `/templates` | yes | yes | no | no | no | `layout.tsx:57` |
| Assistant | yes (floating card) | yes (card) | card if switched on; page if the admin may consent or withdraw; else hidden | card if on; else hidden | never | `layout.tsx:58, 93, 129, 160`; `policy.ts:302` |
| Team `/team` | yes + 2 sub (People, Expertise) | same | yes (no sub) | yes | no | `layout.tsx:25, 64-70, 99` |
| Departments `/departments` | no | no | yes | yes | no | `layout.tsx:100` |
| Our group `/group` | no | no | only if named a group viewer | same | no | `layout.tsx:102`, `myGroups` `:115, 140` |
| Audit log `/audit` | yes | no | yes | no | no | `layout.tsx:72, 103` |
| **Footer of the menu** | | | | | | |
| Help `/help` | no | no | yes | yes | yes | `layout.tsx:144`, `app-sidebar.tsx:192-203` |
| Files (floating card) | yes | yes | yes | yes | yes | always, `app-sidebar.tsx:204` |
| **User menu** | | | | | | |
| Language | yes | yes | yes | yes | yes | `nav-user.tsx:72-75` |
| Theme | yes | yes | yes | yes | yes | `nav-user.tsx:76-79` |
| Settings `/settings` | yes | no | no | no | no | `layout.tsx:152-153`, `nav-user.tsx:80-85` |
| Data sharing `/indicators/data` (same slot as Settings) | no | no | yes (new since the review) | no | no | `layout.tsx:154-155` |
| Two-factor / security `/security` | yes | yes | yes | yes | yes | `nav-user.tsx:86-89` |
| Help `/help` (second time) | no | no | yes | yes | yes | `layout.tsx:150`, `nav-user.tsx:90-95` |
| Sign out | yes | yes | yes | yes | yes | `nav-user.tsx:98-107` |
| **Top bar** | sidebar toggle, language button, theme switch, notification bell (all roles) | | | | | `layout.tsx:164-170` |

Totals (top-level + sub-entries, without footer and user menu): firm_admin 10 + 7; consultant 9 + 7; client_admin 6 (up to 8 with Assistant and Our group); client_manager 5 (up to 7); action_owner 3.

Not in any menu: `/review` and `/oversight` (tabs of Actions, `src/components/actions-tabs.tsx:4-8`), `/notifications` (bell), `/settings` (user menu), `/leaving` (banner link, `layout.tsx:179`).

### 2b. Tabs and cards

**Project page** (`projects/[id]/page.tsx`; names at `:62`, triggers at `:254-269`). 11 tabs.

| Tab (key) | Shown when | Who in practice | Evidence |
|---|---|---|---|
| Recommendations (`recs`) | always | everyone | `:254` |
| Progress (`progress`) | `projectMetrics` allowed (`metrics.read`) | firm staff, client admin, client manager | `:97-99, 255`; `policy.ts:240` |
| Needs attention (`attention`) | `projectDeviations` allowed (`deviation.read`) | firm staff only | `:104, 256-261`; `policy.ts:258` |
| Trace (`trace`) | `projectTrace` allowed (`recommendation.read` on the project) | firm staff, client admin, client manager (an action owner's grant is "assigned", which a project-level check has no assignee for) | `:105, 262`; `src/services/insight.ts:24-26`; `policy.ts:135` |
| Meetings (`meetings`) | `listMeetings` allowed (`meeting.read`) | everyone | `:90, 263`; `policy.ts:227` |
| Assessments (`assessments`) | client project and `assessment.read` | all but action owner | `:74, 264`; `policy.ts:153` |
| Requests (`requests`) | client project and `info_request.read` | everyone on a client project | `:108, 265`; `policy.ts:180` |
| Documents (`docs`) | always | everyone | `:266` |
| Activity (`activity`) | always (list empty without `activity.read`) | everyone | `:267`; `queries.ts:413` |
| Team (`team`) | firm view, or client people list, or client roles exist | firm staff always; on a client project every role (roles card is not null for anyone: `src/services/client-roles.ts:23-25`) | `:268`; `src/services/staffing.ts:530-531, 683-686` |
| Closing (`closing`) | project not draft, and (firm, or closing/closed, or the person may ask to close, or a request exists) | firm on every signed project; client late or when they may ask | `:111-116, 269` |

The comment at `:252` still says "Up to ten tabs". Above the tabs every visitor also gets the "since your last visit" card (`:249`).

Control definitions in source for this page (buttons, API buttons, form dialogs, menu items, link buttons, export/ask buttons; includes Cancel/Save inside dialogs): `page.tsx` 28 (incl. 11 tab triggers), `record-actions.tsx` 7, `plan-dialogs.tsx` 4, `progress-tab.tsx` 2, `handover-card.tsx` 4, `closure-tab.tsx` 17, `pulse-section.tsx` 2, `case-study-section.tsx` 5, `info-requests-tab.tsx` 18, `project-people.tsx` 3, `client-roles-card.tsx` 3, `document-summary.tsx` 2, plus shared `file-actions.tsx` 10, `ask-about.tsx` 1, `meeting-form.tsx` 2, `pack-buttons.tsx` 2. About 126. Menus exist only for a finding/recommendation (4 items: correct, share with client, withdraw, delete; `record-actions.tsx:113-122`) and a file (5 items; `file-actions.tsx:119-128`).

**Actions pages** (link tabs, `src/components/actions-tabs.tsx:4-8`): Actions `/actions`, Review queue `/review`, Oversight `/oversight`. Shown to firm staff only (`actions/page.tsx:25`; `review/page.tsx:17`, `oversight/page.tsx:15` return 404 for clients). Client roles get the plain list with no tabs.

**Client page** (`clients/[id]/page.tsx`): no tabs. Blocks in order:

| Block | Condition | Line |
|---|---|---|
| Progress across projects | not a prospect, has projects | 205 |
| Business indicators | not a prospect, has indicators or may manage | 206 |
| Projects (+ new project) | always; button if may create | 207-265 |
| Signed engagements | always; button if may record | 266-314 |
| Firm team (add, make lead, deputy, remove) | always; controls by permission | 315-403 |
| Contacts (people without accounts) | if readable | 404-486 |
| Suggested leads | firm admin and suggestions switched on | 487-527 |
| Join requests | may decide, not prospect, client open | 528-554 |
| How the client takes part (engagement mode, departments) | always | 556 |
| Legal profile | always | 568 |
| Short names | always | 577-619 |
| Second sign-off rule | not prospect | 620-622 |
| Client assistant | not prospect | 623 |
| Archive and retention, export pack | not prospect | 624 |
| Conflict check | firm admin and prospect | 625-640 |
| Client's people (link to `/clients/{id}/people`) | firm admin | 641- |

**Other tab-like controls**: evidence dialog "Upload new / Pick existing" (`action-panel.tsx:482-487`); inquiries list views open / won / closed (`inquiries/page.tsx:44-62`); oversight exceptions rule filter (`oversight/oversight-view.tsx:202-213`); Projects sub-menu filter by kind (`layout.tsx:39-43`). Only `projects/[id]/page.tsx` and `action-panel.tsx` use the Tabs component.

### 2c. Screens that list late, waiting or needs-attention actions

| # | Screen / component | What it lists | Who | Fed by | Evidence |
|---|---|---|---|---|---|
| 1 | Overview `/` "Needs your attention / follow-up" table + 4 counters + overdue alert | Overdue, plus (firm) awaiting review, blocked, revision requested; (client) revision requested, blocked; first 10 | all roles | `dashboard()` → `listActions({attention})`, `actionCounts()` | `page.tsx:69-74, 110-128`; `queries.ts:205-224` |
| 2 | Today `/today` "Waiting for my review" and "Overdue or due within 7 days" | awaiting review on my projects that I may verify; overdue/due soon where I lead or own | firm staff | `today()` (own SQL) | `today/page.tsx:39-65`; `src/services/today.ts:217-285` |
| 3 | Review queue `/review` | every awaiting-review action I can read, with waiting days and sign-off stage | firm staff | `reviewQueue()` → `listActions({status: awaiting_review})` | `review/page.tsx:17-83`; `src/services/second-review.ts:187` |
| 4 | Oversight `/oversight` exceptions table + health table + 4 tiles | overdue, review waiting > 7 days, blocked, no owner, disputed, slipped, sent back, stale; per-project counts | firm staff | `exceptions()` (view `v_deviations` + blocked + review_waiting), `portfolio()` (`app_portfolio`) | `oversight/page.tsx:16-26`; `src/services/oversight.ts:54-149, 182-261` |
| 5 | Project page, "Needs attention" tab | same deviation rules for one project (no blocked, no review waiting, no remind button) | firm staff | `projectDeviations()` (`v_deviations`) | `projects/[id]/page.tsx:104, 625-629`; `src/services/insight.ts:84-116` |
| 6 | Actions `/actions` | every action, overdue marked red, by due date | all roles | `listActions()` | `actions/page.tsx:16, 29` |
| 7 | Help `/help` "your open actions" | my open actions, first 5 | client roles | `listActions({mineOnly, status: open, limit 5})` | `help/page.tsx:148-149`; `src/services/help.ts:67` |
| 8 | Department page `/departments/{id}` "open work" | open actions of the department | client admin/manager, firm | `clientOverview` department view (`app_client_progress` + open list) | `departments/[id]/page.tsx:89-90` |
| 9 | Meeting agenda | Overdue, Awaiting review, Blocked, Changed since last meeting (text frozen at booking) | everyone on the meeting | `app_meeting_agenda` | `drizzle/0021_departments_across.sql:105-125`; `meetings/[id]/page.tsx:173-195` |
| 10 | Project page, Recommendations tab | every action under its recommendation, overdue marked | all roles | `getProject()` → `listActions({projectId})` | `projects/[id]/page.tsx:518` |
| 11 | Counts only: client progress table (home, client page), Team workload (firm admin), report page tile | overdue / awaiting / blocked counts | varies | `app_client_progress`, `teamLoad`, `projectMetrics` | `src/components/client-progress.tsx:42, 91-93`; `team/page.tsx:117-120, 156-163`; `reports/[id]/page.tsx:135` |

True duplicates: (2 reviews) and (3) are the same status with different scopes; (4) and (5) read the same view; (1) for firm staff is a 10-row mix of (3) and the overdue part of (4); (7) is a 5-row slice of (6). Five different queries produce "overdue": `listActions` attention filter, `today()`, `v_deviations`, `app_portfolio`, `app_meeting_agenda`.

### 2d. Every way a file is uploaded or sent

| # | Where (component) | Endpoint | System | Who | Evidence |
|---|---|---|---|---|---|
| 1 | Action page, "Submit for review" button → evidence dialog (upload new or pick existing; with several open items the person picks which) | `POST /api/actions/{id}/evidence` or `/evidence/existing` (`submitForReview: true`) | Evidence on an action (answers the evidence list) | owner / client manager; firm for a consultant-managed client | `action-panel.tsx:95-98, 413-446`; `policy.ts:201, 343` |
| 2 | Action page, "Attach evidence" button → same dialog, no status change | same endpoints (`submitForReview: false`) | Plain evidence upload | same | `action-panel.tsx:153-156` |
| 3 | Action page, evidence list, "answer" on one item → same dialog bound to the item | same endpoints with `evidenceRequestId` | Evidence list item (`evidence_requests`: open / submitted / accepted / rejected / waived) | same | `follow-through-panels.tsx:135-143` |
| 4 | Project page, Requests tab, answer an item (upload new, or pick an existing file) | `POST /api/info-requests/{id}/files`, `/files/existing` | Information request list (`info_requests`: requested / received / reviewed / not applicable) | client admin, manager, the item's owner; firm on the client's behalf | `info-requests-tab.tsx:331-390, 356, 381`; `policy.ts:182` |
| 5 | Public page `/upload/{token}` from a link the firm e-mailed for one request item | `POST /api/upload/{token}`; link made at `POST /api/info-requests/{id}/links` | Information request list (no login) | anyone holding the link | `(public)/upload/[token]/upload-form.tsx:33, 84`; `info-requests-tab.tsx:279-297`; `src/services/upload-links.ts:27-42` |
| 6 | Files card in the sidebar, "Add a file" (pick a project, visibility, team) | `POST /api/projects/{id}/documents` | Plain project document | everyone with `document.upload` | `src/components/file-explorer.tsx:141-179, 230`; `policy.ts:211` |
| 7 | File menu "New version" | `POST /api/documents/{id}/versions` | Document version | per file | `src/components/file-actions.tsx:86, 124, 170` |
| 8 | Meeting page, transcript import | `/api/meetings/{id}/transcript` | Meeting record | firm organiser | `meetings/[id]/transcript-panel.tsx:50, 154` |
| 9 | Plan import wizard (.xlsx / .docx) | `/api/projects/{id}/import`, `/import/confirm` | Plan import | firm who may add findings, recommendations and actions | `projects/[id]/import/import-wizard.tsx:131, 163, 207` |
| 10 | Indicator figures import (.xlsx / .csv), new since the review | `/api/clients/{id}/indicator-data/import`, `/import/confirm` | Indicator data | client admin/manager, firm | `indicators/import/import-wizard.tsx:108, 129, 206` |
| (11) | Assessment answer: attach an existing file as evidence (no upload) | `PUT /api/assessment-answers/{id}/evidence/{doc}` | Assessment | firm | `assessments/[id]/assessment-panels.tsx:193` |

The project page's Documents tab has no upload button (`projects/[id]/page.tsx:642-673`); adding a plain file is only possible from the Files card.

### 2e. Where a recommendation is created or a finding added

| What | Where | Endpoint | Evidence |
|---|---|---|---|
| Recommendation | Project, Recommendations tab, on each live finding row ("Add a recommendation", finding pre-selected) | `POST /api/projects/{id}/recommendations` | `projects/[id]/page.tsx:346-359`; `plan-dialogs.tsx:179` |
| Recommendation | Same tab, section header button (only when at least one exists) | same | `page.tsx:381-393` |
| Recommendation | Same tab, empty state (when none exist) | same | `page.tsx:402-415` |
| Recommendation (bulk) | Plan import wizard | `/api/projects/{id}/import/confirm` | `page.tsx:375-379`; `src/services/plan-import.ts:35-41` |
| Recommendation (edit, same dialog) | "Correct" in the row menu | `PATCH /api/recommendations/{id}` | `record-actions.tsx:113, 129` |
| Finding | Project, Recommendations tab, Findings section "Add a finding" | `POST /api/projects/{id}/findings` | `page.tsx:276-307` |
| Finding | Assessment page, "Confirm as finding" on a suggested gap | `/api/assessment-answers/{id}/finding` | `assessments/[id]/assessment-panels.tsx:212-224`; `assessments/[id]/page.tsx:247-250` |
| Finding (bulk) | Plan import wizard | as above | as above |

Permission: `finding.write`, `recommendation.write`, `action.write` are firm staff only (`policy.ts:134, 136, 158`); clients never see these buttons (`planOptions` returns null, `src/services/plan.ts:36-46`).

### 2f. Status vocabulary

Counted by script over both message files. 32 groups that describe the state of a piece of work hold 120 labels: 98 distinct English strings, 105 distinct Arabic strings. Adding 8 neighbouring label sets (visibility, aging buckets, deviation rule names, data modes, engagement modes, case-study levels, conflict-match client status, translation state) gives 40 groups and 149 labels (125 distinct English, 132 distinct Arabic). Path in brackets is the key in `messages/en.json` and `messages/ar.json`.

| Group [key] | English | Arabic |
|---|---|---|
| Action status [`status`] (8) | Draft · Assigned · In progress · Blocked · Awaiting review · Revision requested · Verified complete · Closed | مسودة · مُسند · قيد التنفيذ · متعثر · بانتظار المراجعة · مطلوب تعديل · مكتمل ومُتحقق منه · مغلق |
| Evidence item on an action [`action.items.status`] (5) | Waiting · Sent, to review · Accepted · Not accepted · Not needed | بانتظار الإرسال · أُرسل، بانتظار المراجعة · مقبول · غير مقبول · غير مطلوب |
| Deadline-change request [`action.deadline.status`] (3) | Waiting · Approved · Declined | بانتظار الرد · تمت الموافقة · مرفوض |
| Review outcome, history line [`action.entry`] (4) | accepted the evidence · requested a revision · rejected the evidence · signed off (first of two) | قبِل الدليل · طلب تعديلاً · رفض الدليل · اعتمد (الأول من اثنين) |
| Review outcome, trace [`insight.trace.review`] (3) | Accepted · Sent back · Rejected | قُبل · أُعيد للتعديل · رُفض |
| Review queue stage [`reviewPage`] (3) | One review · First of two · Second of two | مراجعة واحدة · الأول من اثنين · الثاني من اثنين |
| Action closure outcome [`action.closure.outcomes`] (4) | Partially implemented · Risk accepted · Not applicable · Replaced by another action | نُفّذ جزئياً · قُبلت المخاطر · لا ينطبق · حلّ محله إجراء آخر |
| Outcome mix in metrics [`metrics.outcome`] (6) | Verified · Partly done · Risk accepted · No longer applies · Replaced · Still open | تم التحقق · منفذ جزئياً · قبول المخاطر · لم يعد ينطبق · استُبدل · ما زال مفتوحاً |
| Recommendation response, stance [`response.stances`] (5) | Agreed · Partly agreed · Disputed · Awaiting confirmation · Awaiting response | موافَق عليها · موافَق عليها جزئيًا · محل خلاف · بانتظار التأكيد · بانتظار الرد |
| Recommendation response, choice [`response.choices`] (3) | Agree · Partly agree · Disagree | موافق · موافق جزئيًا · غير موافق |
| Plan record state [`plan.changes`] (3) | Shared with the client · Withdrawn · Withdrawn | تمت المشاركة مع العميل · تم السحب · مسحوبة |
| Information request item [`infoRequests.status`] (4) | Waiting · Received · Reviewed · Not applicable | بانتظار الإرسال · مستلم · تمت مراجعته · لا ينطبق |
| Project state [`phases.states`] (5) | Planned · Active · Closed · Draft · Closing | مخطط · نشط · مغلق · مسودة · قيد الإغلاق |
| Closure disposition [`closure.dispositions`] (4) | Handed over · Deferred · Withdrawn · Waived | سُلِّم · أُجِّل · سُحب · أُعفي منه |
| Project health signal [`oversight.signals`] (4) | Off track · Watch · On track · No work yet | متعثر · تحت المراقبة · على المسار · لا عمل بعد |
| Meeting status [`meeting.status`] (3) | Scheduled · Held · Cancelled | مجدول · انعقد · أُلغي |
| Meeting reply [`meeting.response`] (4) | No answer yet · Accepted · Declined · Maybe | لم يرد بعد · قبِل · اعتذر · ربما |
| Inquiry status [`inbox.statuses`] (10) | New · Triaged · Discovery booked · Discovery held · Proposal sent · Won · Lost · Declined · Spam · Withdrawn | جديد · تم الفرز · جلسة استكشافية محجوزة · عُقدت الجلسة · أُرسل العرض · مكسوب · خسرناه · اعتذرنا · غير جاد · سُحب |
| Inquiry conflict check [`inbox.conflicts`] (4) | Not checked · Clear · Flagged · Waived | لم يُفحص · لا تعارض · يوجد تعارض · تم التجاوز |
| Discovery outcome [`inbox.outcomes`] (3) | Go ahead · Not a fit · Needs a follow-up | المضي قدماً · غير مناسب · يحتاج متابعة |
| Assessment status [`assessment.run.status`] (2) | Draft · Final | مسودة · معتمد |
| Template status [`assessment.templates`] (3) | Published · Archived · Draft | المنشور · مؤرشف · مسودة |
| Indicator period [`indicators.status`] (3) | Reported · Awaiting value · Missing | مُبلّغ عنها · بانتظار القيمة · ناقصة |
| Client assistant [`clientAi.status`] (3) | Off · Waiting for the client · On | متوقف · بانتظار العميل · مفعّل |
| File read by the assistant [`files.assistantState`] (4) | Waiting to be read · The assistant can read it · No readable text found · A scan: waiting for text recognition | بانتظار القراءة · يستطيع المساعد قراءته · لم يُعثر على نص مقروء · ملف ممسوح ضوئيًا… |
| Audit outcome [`audit.outcomes`] (3) | Done · Refused · Failed | تم · مرفوض · تعذّر |
| Support request, firm view [`help.support`] (2) | Open · Handled | مفتوح · عولج |
| Support request, client view [`help.problem`] (2) | Sent · Handled | مُرسَل · عولج |
| Export pack [`offboarding.pack`] (2) | Awaiting receipt · Received | بانتظار تأكيد الاستلام · استُلمت |
| Client archive [`offboarding`] (3) | Archived · On legal hold · Released | مؤرشف · عليها حجز نظامي · مرفوع |
| Person account [`people`] (4) | On · Not set up · Active · Switched off | مفعّل · غير مفعّل · نشط · موقوف |
| Status pack [`statusPack`] (1) | Draft | مسودة |
| *Neighbours:* visibility (4), aging buckets (4), deviation rule names (6: Overdue · Stale · Slipped · Sent back · No active owner · Disputed), indicator data modes (3, new), engagement modes (3), case-study levels (4), conflict-match client status (3), translation state (2) | | |

Same word for different things across groups (script output):

- English: "Waiting" = evidence item not sent, deadline request pending, request item not answered. "Withdrawn" = recommendation, closure disposition, inquiry. "Declined" = deadline request, meeting reply, inquiry. "Accepted" = evidence item, review, meeting reply. "Not applicable" = action closure and request item. "Sent back" = a review outcome and a deviation rule.
- Arabic "متعثر" = action status Blocked (`status.blocked`) and project health Off track (`oversight.signals.off_track`); and Blocked is also written "متوقفة" elsewhere (`oversight.reasons.blocked`, `oversight.health.blocked`, the agenda heading in `0021_departments_across.sql:117`).
- Arabic "بانتظار الرد" = deadline request pending and recommendation awaiting response. "بانتظار الإرسال" for English "Waiting" (evidence item and request item).

**Arabic approval words used for more than one concept** (keys from `messages/ar.json`; English beside):

| Arabic word | Concepts it stands for | Keys |
|---|---|---|
| اعتماد / اعتمد / معتمد | (1) first or second sign-off on evidence: `action.secondReview.signOff` "Sign off (first of two)", `.title` "Second sign-off", `reviewPage.signedBy`. (2) verify: `action.move.verified_complete` "Accept and verify" = "قبول واعتماد" (while the status itself says "مُتحقق منه" and `action.secondReview.verify` says "الاعتماد الثاني والتحقق"). (3) finalise an assessment: `assessment.run.finalise`, `assessment.run.status.final` = "معتمد". (4) confirm a meeting summary: `meeting.record.saveSummary` "Save and confirm" = "حفظ واعتماد", `.confirmedBy`. (5) release: `metrics.noneYet` / `reportPdf.noneYet` "No released actions yet" = "لا توجد إجراءات معتمدة بعد". (6) accept deliverables: `clientRoles.roles.acceptor` = "معتمد التسليمات". Also `response.unconfirmed` "doesn't count" = "لا يُعتمد", and the Etimad tender platform name. | 35 short labels contain the root |
| قبول / قبِل / مقبول | accept evidence in review (`action.entry.accept`), accept an evidence item (`action.items.accept`), risk acceptance (`action.risk.title`), meeting reply (`meeting.response.accepted`), join request approved (`notifications.kinds.join_request_approved`, English says "approved"), invitation accepted, terms accepted (`consent.continue`), status-pack "Accepted by" | |
| موافقة / وافق / موافق | approve a new deadline (`action.deadline.approve`), approve a join request (`staffing.approve`), agree with a recommendation (`response.choices.agree`), consent (case study `closure.caseStudy.*`, marketing `inbox.marketingYes`, client assistant `clientAi.notice.agree`) | |
| تأكيد / أكّد | confirm a recorded response (`response.confirm`), "Mark translation as reviewed" (`translation.markReviewed` = "تأكيد المراجعة"), "Mark as held" (`meeting.markHeld` = "تأكيد انعقاده"), confirm a gap as a finding (`assessment.run.confirmGap`), confirm receipt of the export pack (`offboarding.pack.confirm`), generic dialog confirm | |
| "Sign-off" in English has two Arabic words | "اعتماد" on the action page and review queue; "توقيعات ثانية" in the team table (`metrics.secondSignOffs`) | |
| مطابقة | "Mark checked" on an indicator value (`indicators.check` = "تعليم كمُطابَق") and "Same" in the import preview (`indicatorImport.outcomes.same`) and column matching | |

### 2g. Where people and roles are managed

| Side | Place | What is managed | Who | Evidence |
|---|---|---|---|---|
| Firm | `/team` People and access | the firm's accounts: invite, role, switch off, other-language name, reset two-factor, erase, hand over a leaver's work; invitations; allowed e-mail domains; access review | firm admin (consultants see a read-only list) | `team/page.tsx:43-44, 59-88`; `team/people-admin.tsx:58-67, 152, 181, 200`; `team/people-panels.tsx:93-203` |
| Firm | `/team` workload table | (read only) load per colleague | firm admin | `team/page.tsx:89, 102-171` |
| Firm | `/team/expertise` | who can lead what, availability | firm admin; a consultant edits their own | `team/expertise/page.tsx:12-25`; `policy.ts:281-283` |
| Firm | `/clients/{id}`: Firm team card | consultants on the client, lead, deputy | firm admin, the lead | `clients/[id]/page.tsx:315-403` |
| Firm | `/clients/{id}`: Contacts, Suggested leads, Join requests cards | people without accounts; who to add; who asked to join | firm staff / admin / lead | `clients/[id]/page.tsx:404-554` |
| Firm | `/clients/{id}/people` | the client's accounts (same screen as `/team`) | firm admin | `clients/[id]/people/page.tsx:16-29` |
| Firm | `/clients/{id}/departments` | departments, members, heads | firm admin | `clients/[id]/departments/page.tsx:18-34`; `src/components/departments-manager.tsx:163-206` |
| Firm | Project page, Team tab | firm staff on the project (member / observer); the client's people on the project; client roles (sponsor, coordinator, steering, acceptor, observer) | firm admin, lead | `projects/[id]/page.tsx:697-813`; `project-people.tsx:29-83`; `client-roles-card.tsx:29-77` |
| Firm | `/clients/groups/{id}` | group members and the holding's viewers | firm admin | `clients/groups/[id]/page.tsx:97-158` |
| Firm | `/templates` authors card | who may write templates | firm admin | `templates/page.tsx:113-114` |
| Client | `/team` | the client's accounts (same People and access screen) | client admin; manager sees a read-only list; action owner 404 | `team/page.tsx:26-32, 43-44` |
| Client | `/departments` and `/departments/{id}` | departments, members, heads | client admin (manager reads) | `departments/page.tsx:12-24`; `policy.ts:55` |
| Client | Project page, Team tab: people on the project | add or remove own colleagues | client admin only | `src/services/staffing.ts:686`; `policy.ts:76` |
| Client | Project page, Team tab: client roles | sponsor, coordinator and so on | client admin (database decides) | `policy.ts:75`; `client-roles-card.tsx` |

### 2h. What the Help page shows per role

`help/page.tsx`. Firm staff get 404 (`src/services/help.ts:47`; `policy.ts:291`).

| Block | client_admin | client_manager | action_owner | Evidence |
|---|---|---|---|---|
| Three first steps | Team, Projects, Overview (in a restricted engagement: Projects, a step with no link, Overview) | Overview, Actions, Actions | Actions, Actions, Actions | `help/page.tsx:21-26, 45, 78-101` |
| "Ask about the work" card with a button to Actions | yes | yes | yes ("My actions") | `:104-117` |
| "Technical problem" form and my last 10 reports with Sent / Handled | yes | yes | yes | `:119-145`; `help.ts:68-73` |
| "Your open actions" table (first 5, mine only) | yes | yes | yes | `:148-149`; `help.ts:67` |
| Your consultants: lead and deputy with mail links | yes | yes | yes | `:151-163` |
| One card per project with its consultants and a link to the project | yes | yes | yes | `:164-188` |
| 7 questions (states, claimed, awaiting, revision, blocked, due date, who sees) | yes | yes | yes | `:190-202`; `src/lib/help.ts` (`FAQ_KEYS`) |

### 2i. Today, Trace, Oversight

| | Shows | Who reaches it | Where the same information is already |
|---|---|---|---|
| **Today** `/today` | 6 sections, grouped by client: (1) waiting for my review; (2) overdue or due within 7 days where I lead or own; (3) my open follow-ups; (4) my meetings today and this week (with "no agenda" flag); (5) decisions waiting on me: join requests, deadline changes, closure requests, request items answered; (6) projects with changes since my last visit. `today/page.tsx:39-130`; `src/services/today.ts:217-541` | firm admin and consultant: sidebar (`layout.tsx:34`), welcome step for consultants (`page.tsx:30`). Clients get 404 (`today/page.tsx:24`) | (1) Review queue `/review`, Overview list. (2) Actions list, Oversight "overdue", Overview list. (3) **nowhere else across projects**: only on each meeting page (`meetings/[id]/page.tsx:291-331`) and the handover card. (4) **nowhere else across projects**: only each project's Meetings tab (`projects/[id]/page.tsx:526-566`); an unused `/api/schedule` exists. (5) **nowhere else as one list**: client page join-requests card, action page deadline card, project Closing tab, project Requests tab, plus notifications. (6) the "since your last visit" card on each project (`projects/[id]/insight.tsx:21-70`). Deleting Today removes the only cross-client view of 3, 4, 5 and 6. |
| **Trace tab** | The project as a tree: assessment / finding ← recommendation ← action ← evidence and review outcome, action ← replacing action, and client indicator ← recommendations meant to move it. `projects/[id]/insight.tsx:178-293`; `insight.ts:24-45` (`app_trace`) | firm staff, client admin, client manager (`projects/[id]/page.tsx:105, 262`) | Findings with "answered by N" and recommendations with their actions are the Recommendations tab (`page.tsx:309-523`); evidence and review outcomes are on each action's history (`actions/[id]/page.tsx:204-270`); indicator links are on `/indicators/{id}`. Unique to Trace: evidence and review outcome per action at project level in one view, and the "replaces" chain. No other screen links to `?tab=trace`. |
| **Oversight** `/oversight` | 4 tiles (projects off track, on watch, overdue actions, reviews waiting > 7 days); health table per open project (signal with reasons, 8-week strip, open, overdue, blocked, oldest review, lead, client last active); exceptions table with rule filter and a "remind owner" button. `oversight/oversight-view.tsx:36-274` | firm admin and consultant, each for the projects they can open; reached as the third tab of Actions (`actions-tabs.tsx:4-8`), no sidebar entry of its own; clients 404 (`oversight/page.tsx:15`) | Exceptions per project = the project's "Needs attention" tab (same view `v_deviations`), which lacks blocked, review-waiting and the remind button. Waiting reviews = Review queue. Unique to Oversight: the health signal and its history, "client last active", and the only "remind owner" button in the app (`oversight-view.tsx:182-189, 257-262` → `/api/actions/{id}/remind`). The health table links back to `?tab=attention` (`:128`). |

### 2j. Can a client admin or a project coordinator reassign an action to a colleague?

| Layer | Rule | Evidence |
|---|---|---|
| Policy (app) | `action.assign_owner` is granted to firm admin, consultant and **client_manager**. **client_admin is not listed.** No coordinator condition exists: any client manager who is a member of the project passes. | `src/authz/policy.ts:159`; membership `src/authz/authorize.ts:108-111` |
| Service | `updateAction` checks `action.read`, then `action.assign_owner` when `ownerUserId` is sent; refuses on a verified or closed action; the new owner must be an active member of the action's organisation who is on the project; no status change; writes an "updated" activity event; notifies the new owner (`action.assigned`) if the action is released. Nobody else is notified. | `src/services/plan.ts:311-364`, `:195-204` |
| API | `PATCH /api/actions/{id}` accepts `ownerUserId` | `src/app/api/actions/[id]/route.ts:10-22` |
| Database, row policy | client admin and client manager may update actions of projects they can see | `drizzle/0000_baseline.sql:2263-2267` |
| Database, trigger | a client may change only `status`, `owner_user_id`, `blocked_reason`; `owner_user_id` only as client_admin or client_manager | `drizzle/0000_baseline.sql:1714-1722` |
| Database, owner check | the new owner must be an active member of the action's own organisation, on the project, not an observer | `drizzle/0034_observers.sql:107-121` |
| Database, minimal records | a minimal-records client cannot have an account as owner | `drizzle/0000_baseline.sql:5067-5077` |
| UI | **No screen sends `ownerUserId` for an existing action.** The only caller of `PATCH /api/actions/{id}` sets the department (`actions/[id]/department-picker.tsx:34`). The owner is chosen only when the firm creates the action (`projects/[id]/plan-dialogs.tsx:404`). | grep over `src/app`, `src/components` |
| Other path | An admin can hand over all of one person's open actions to one colleague from the People screen (the leaver flow) | `src/services/accounts.ts:244-252`; `drizzle/0034_observers.sql:214-250`; `team/departure-dialog.tsx:75` |

Answer today: a client manager may through the API but has no button; a client admin may not (policy says no, database says yes); a "coordinator" has no special right.

To allow it, limited to the own organisation, consultant told, status unchanged:

1. `policy.ts:159`: add `client_admin: "any"`. To limit managers to the project's coordinator (and sponsor), add a database check in the style of `app_can_manage_client_roles` and call it from `updateAction`; the policy table alone cannot express "coordinator".
2. `src/services/plan.ts:359-362`: also notify the client's lead (or the staffed consultants) when a client person changes the owner. A new notification kind needs adding to the list of kinds the database accepts (first defined at `drizzle/0000_baseline.sql:7041`, redefined in `0003_mail_preferences.sql:23` and `0012_requester_mail.sql:8`; I did not trace every later redefinition) and to the mail templates.
3. UI: an owner picker on the action page owner row (`actions/[id]/page.tsx:279-290`), listing the client's active people on the project (the list `planOptions` already builds for the firm, `src/services/plan.ts:36-`). If the picker should offer colleagues not yet on the project, the service must also add them to `project_members` (as `app_hand_over` does, `0034_observers.sql:238-240`), which a client manager may not do today (`policy.ts:76`).
4. Nothing to change for "own organisation only" or "no status change": the database owner check already enforces the first, and `updateAction` never touches status.

### 2k. What an observer can do on the client's business indicators

Indicators belong to the client, not to a project: the resource is built with `projectId: null` (`src/services/indicators.ts:45-51`).

| Question | Answer | Evidence |
|---|---|---|
| Read | Yes | `policy.ts:248`; database `app_kpi_readable` = firm staff working with the client (`drizzle/0063_client_indicators.sql:203-207, 243, 251`) |
| Enter values | Yes | `policy.ts:249`; `indicators.ts:468`; insert policy `0063:254-256` (role consultant allowed) |
| Set up, edit targets, switch off, link to recommendations | Yes | `policy.ts:250`; `indicators.ts:376, 413, 441, 533, 553`; `app_kpi_writer` `0063:216-219, 245-249` |
| Mark a value checked | Yes (not one they entered) | `policy.ts:251`; `indicators.ts:502`; `0063:259-260` |
| Why the observer rule does not apply | The app rule fires only when the resource has a project id that the person observes (`src/authz/authorize.ts:53-60`); `OPEN_TO_OBSERVERS` lists only notes and the assistant (`policy.ts:371`). The database observer trigger covers a fixed list of tables that includes the old project table `kpis` but not `client_kpis`, `client_kpi_values`, `client_kpi_links` (`drizzle/0034_observers.sql:92-103`; no "observer" in `0063` or `0067`). | |

An observer is always a consultant already assigned to the client (candidates come from the client's team, `src/services/staffing.ts:555-561`), so they pass `app_firm_works_with` (`drizzle/0000_baseline.sql:4043`). Observing a project therefore removes nothing on indicators: an observer has the same indicator rights as any other consultant on the client.

### 2l. Where the app itself appears to judge, score or recommend

| # | What | Where | Neutral fact or judgment |
|---|---|---|---|
| 1 | Project health signal "Off track / Watch / On track", with an 8-week history | `src/lib/health.ts:5-41`; `drizzle/0048_oversight.sql:34-41`; shown at `oversight/oversight-view.tsx:43-44, 136-138` (firm only) | **Judgment by fixed thresholds.** The app labels a project "off track" when 25% of open actions are overdue or one is 60 days late. The reasons printed beside it are neutral counts. |
| 2 | Deviation rule names "Stale", "Slipped", "Sent back", "No active owner", "Disputed" | `src/services/insight.ts:77-116`; `projects/[id]/insight.tsx:84-152`; tab title "Needs attention" | Computed facts with threshold words (for example 14 days without activity); the tab title is the app's wording. |
| 3 | Indicator movement "better / worse" with a red badge for worse | `src/lib/indicators.ts:46-61, 87-88`; `src/components/indicators/indicators-card.tsx:23-25` | Computed from the direction a person set (higher or lower is better); the word and colour are a value statement. A disclaimer sits under it (`messages/en.json:4777`). |
| 4 | Assessment score in percent and "Suggested gap" | `assessments/[id]/page.tsx:62, 140, 178, 247-250`; list at `projects/[id]/page.tsx:593-597` | Score is arithmetic on the consultant's answers. "Suggested gap" is an **app suggestion**; it becomes a finding only when a consultant confirms (`assessment-panels.tsx:212-224`). |
| 5 | Suggested lead consultants for an inquiry or new client | `inquiries/[id]/page.tsx:644-650`; `clients/[id]/page.tsx:487-527`; `src/services/inquiries.ts` (`suggestLeads`, `suggestClientLeads`); switch in settings (`settings/settings-form.tsx:167-168`) | **App suggestion** (expertise match), labelled "A suggestion only; you choose" (`en.json:819, 1763`). |
| 6 | Qualification score "n of 15" on an inquiry | `inquiries/[id]/page.tsx:519-525` | Sum of five ratings a person typed; neutral arithmetic presented as a score. |
| 7 | Automatic second sign-off rule (after repeated revisions, or high priority) | `src/lib/second-review.ts:7-14`; `drizzle/0062_second_review.sql`; card `clients/[id]/second-review-card.tsx` | A rule a person switched on; the app applies it. Neutral. |
| 8 | Reminder ladder and escalation by day counts | `drizzle/0019_mail_choices.sql:305-311`; `reminder-ladder.tsx` | Neutral schedule. |
| 9 | Assistant answers, file summaries, "ask about this" | `src/services/assistant.ts`; `projects/[id]/document-summary.tsx`; `src/components/ask-about.tsx` | AI text shown as an answer or summary, not as a decision; refuses when no source supports it (`en.json:302`). Firm staff by default. |
| 10 | Machine translation of client-visible text, with a "reviewed by the firm" mark | `src/components/translatable.tsx:75-80`; `en.json` `translation.machine` | AI text, labelled as machine translated. |
| 11 | Draft monthly status pack made by a job | `en.json:4422` ("The monthly job drafted this pack"); section "Needs a decision" | Computed lists; a person issues it. |
| 12 | Data-mode proposal on the client home ("how your figures reach Selah") | `page.tsx:63, 90-92`; `src/components/indicators/data-mode-picker.tsx:36, 171` | The proposal comes from the firm (a person), preselected for the client admin. Neutral. |
| 13 | Home counters and oversight tiles ("3 overdue") | `page.tsx:69-74`; `oversight-view.tsx:45-46` | Neutral counts. |
| 14 | Team workload "Not taking new clients" badge | `team/page.tsx:150` | Set by a person; the code comment says "No per-person score" (`:97`). Neutral. |

Items 1, 4 (suggested gap) and 5 are the ones where the app proposes or labels on its own; item 3 puts a value word on a client's number.

---

## 3. Half-done or dead in the UI code

| What | Evidence |
|---|---|
| `/api/schedule` (meetings, due dates and follow-ups in one calendar) has a service and a permission but no page or component calls it | `src/services/meetings.ts:658`; `policy.ts:230-231`; no match for `api/schedule` under `src/app/(app)` or `src/components` |
| Changing an action's owner: API, policy and database rule exist, no UI (see 2j) | `src/app/api/actions/[id]/route.ts:14`; `policy.ts:159` |
| Policy and database disagree on client_admin assigning an owner | `policy.ts:159` vs `drizzle/0000_baseline.sql:1720` |
| Seven UI primitives never imported: attachment, breadcrumb, button-group, command, hover-card, kbd, spinner | `src/components/ui/*.tsx`, no importer under `src` |
| Stale comment "Up to ten tabs" above an 11-tab bar | `projects/[id]/page.tsx:252` |
| Project Documents tab can list, share and version files but has no way to add one | `projects/[id]/page.tsx:642-673` |
| Help is linked twice for every client role (menu foot and user menu) | `layout.tsx:144, 150` |
| Language and theme each have a top-bar control and a user-menu entry | `layout.tsx:168-169`; `nav-user.tsx:72-79` |
| Read-only JSON routes with no UI caller (pages read the services directly): `/api/projects/{id}/trace`, `/metrics`, `/progress`, `/api/team` | `src/app/api/projects/[id]/`; no match in `src/app/(app)`, `src/components` |
| The observer write-block list names the project table `kpis`, which was later dropped, and nothing replaced it for the client indicator tables (see 2k) | `drizzle/0034_observers.sql:92-103`; `drizzle/0063_client_indicators.sql:170-176` |

Not found: no TODO / FIXME comments in `src`, no feature flag that is always off (`src/env.ts` has only infrastructure switches), no page without at least one inbound link.
