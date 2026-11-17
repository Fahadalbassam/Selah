# Reply to Claude Code: the agenda answers, plus two new features and two small additions

Version 2, 17 Nov 2026: adds section 4 (deliverable receipt, indicator moved-the-wrong-way notice) and a handbook note, after comparing Selah with the partner firm's own deep-dive deck on how it works. Everything else is unchanged from version 1.

Paste everything below the line into the running Claude Code session (the lead in `C:\Projects\selah-lead`).

---

Here are my answers to the open questions from gate A, two new features I want built, and two small additions. Log all of this in `docs/review/lead-log.md` under "Gate A follow-ups (17 Nov 2026)".

## 1. The three open answers

**1a. Meeting agenda (D8): option C, "the agenda follows the meeting".**
- A meeting that carries a department lists only that department's work (`0021_departments_across.sql` already supports a department meeting). A meeting with no department is a whole-project meeting and lists everything.
- A whole-project meeting opens only for people who may see everything on the project. When the organiser invites someone with department limits to a whole-project meeting, the invite form says so before saving and suggests making it a department meeting. Nobody is ever shown the agenda of a meeting they cannot open.
- Keep the stop-gap you already shipped (stored agenda lists hidden from readers with limits) as a second line of defence.
- Tests: a department meeting's agenda has no titles from other departments, for every reader; a department-limited manager gets 404 on a whole-project meeting, its agenda, its PDF and its calendar entry; the invite warning appears.

**1b. Action owners see only their own actions, enforced in the database.**
- An action owner reads an action only when they own it. This is a row-level security rule on `actions` and everything under it (evidence, discussion, date requests, reminders, activity events), mirrored in `authorize()`. Not a screen filter.
- On a recommendation page an owner sees the recommendation and their own actions under it, nothing about the others: no titles, no counts.
- The same rule holds on agendas (an owner invited to a meeting sees only their own actions on it), notifications, e-mails, exports, search, the Files card and the assistant.
- Files keep today's rule (an owner sees their own uploads, their department teammates' files and files shared with them one by one). This answer is about actions only.
- Tests: for each owner account, every route and every database read returns only their own actions; a seeded action owned by a teammate returns 404 by URL and API; the recommendation page shows no count of other actions.

**1c. Only firm staff link an indicator to a recommendation.**
- Remove the client admin from "Link / Unlink" in `policy.ts` and in the database rule. Clients still see links they are allowed to see. Update `docs/authorization.md` and `docs/metrics.md`, which say today that the client admin can.
- Tests: a client admin's link and unlink are refused (404) at the API and in the database; a lead or staffed consultant can; an observer cannot (D4).

**Where these go:** in batch 0, after the privacy-leak pull request and D6 (drafts hidden from clients) are merged, because all three change the same database rules. Then the two features below, before batch 1.

## 2. New feature A: who sees an item ("everyone except…" / "only…")

**Why it is needed (research done, rule 3):** restructuring proposals, salary and disciplinary files and closed board meetings are routinely kept need-to-know until announced. Departments and labels cover most cases; they cannot keep one file from one manager in the same department. Evidence is in `/mnt/project-files/prompts/org-chart-and-visibility-recommendation.md`.

**The rule, said plainly: the picker can only take people away. It can never give anyone access that the role, project, department and label rules do not already give.** Sharing a file with one more person stays the existing, separate "Share" action and never appears inside the picker.

**How it looks.**
- Closed by default. One quiet line in the item's details: "يراه: كل من له صلاحية · تخصيص / Seen by: everyone with access · Customise". Zero clicks in the common case.
- Opening it shows a switch with two positions and one shadcn Combobox in `multiple` mode with chips:
  - **"Everyone with access, except…"** (default): the chips are the people left out. People who gain access later (a new staff member, a new manager) see it automatically.
  - **"Only these people…"**: the chips are the only people who see it. People who gain access later do not. Saving with no chips is refused.
- The list of people to pick from comes from the server and holds only people who can already see the item, grouped "Firm" and "Client". Nobody else can be picked.
- Some people are locked chips that cannot be removed, with a tooltip saying why: the person setting it, the uploader, the client admin (on anything the client can see), the firm admin (on firm items), the client's lead and deputy, and the organiser and required attendees of a meeting.
- Everyone who can still see the item gets a small "Limited audience" marker on it. People left out see nothing: no row, no count, no "1 hidden item".

**One picker, two sides.** It is one component. What it lets you change depends on whose item it is:
- Firm items (a deliverable, a firm upload shared with the client, a firm meeting): firm staff who can manage the item may leave out firm colleagues and client people, except the locked chips.
- Client items (a client upload, a client-booked meeting): the client admin may leave out client people only. A client cannot hide its files from the firm team this way; `client_private` already exists for that.
- Client managers and action owners do not get the picker.

**Where it applies (first release):** documents of every kind except evidence, and meetings (with their notes, attachments and calendar entry).
**Not on:** actions, recommendations, evidence, indicators, or single boxes of the org chart. Those are the shared plan; owners, reviewers and departments already decide who sees them, and hiding one breaks reviews, the second sign-off, the agenda and closure. A sensitive recommendation (for example "merge department X") stays a firm draft, which clients no longer see (D6), until the firm releases it; any file about it uses the picker.

**When it is set, and editing.** It can be set at upload, when booking a meeting, or when the firm shares a deliverable with the client. It can be changed at any time afterwards by the same people. Every change is audited (Arabic and English labels). People left out are never notified about the item or about the change.

**How to build it.**
- One generic pair of tables: `item_audiences (org_id, item_type, item_id, mode 'except'|'only', set_by, set_at)` and `item_audience_people (item_type, item_id, user_id)`, with a trigger that deletes rows when the item is deleted.
- The effective rule: (today's rules OR a one-by-one share) AND NOT left out AND (no "only" list, OR on it). Leaving someone out wins over a share: the Share screen refuses to share with someone who is left out, and never silently removes the exclusion.
- Enforce it in the database as a RESTRICTIVE policy (`app_audience_ok(type, id, uid)`) on each table that gets the picker (a permissive policy would widen access), and as a sixth question at the end of `authorize()`.
- Add `app_audience_ok` by hand to every SECURITY DEFINER function that reads these items, because they skip row-level security: `app_meeting_agenda`, `app_notify_project_team`, `app_mask_terms`, the export pack (`services/export-pack.ts`, `exports.ts`), and the activity feed (`activity_events` keeps its own copy of the visibility label). Put it inside the assistant's vector query `WHERE` in `services/assistant.ts`, never as a filter afterwards.
- Add `ComboboxChips`, `ComboboxChip` and `ComboboxChipRemove` to `components/ui/combobox.tsx` (Base UI has `multiple` and chips; import the parts from `@base-ui/react` if the Animate UI wrapper does not pass them through), then a reusable `AudiencePicker` built on `person-picker.tsx`. Arabic first, right to left.

**Tests (each fails without the code):**
- Never-widen property test over `authorize()`: for random people, items and audiences, "allowed with an audience" always implies "allowed without it".
- The database twin in `tests/db/rls.test.ts`: for every seeded user, the rows they see with an audience set are a subset of the rows they see without it.
- For a left-out person: 404 on the item by URL, API and download; absent from the Files card, search, calendar, agenda, notifications, Mailpit e-mails, Excel and PDF exports, the activity feed, the export pack, dashboard counts and the assistant's answers and citations.
- The server refuses removing a locked chip, an "only" list with nobody, a person who could not see the item, a client admin leaving out firm staff, and a share to a left-out person.
- "Except" includes a person who gains access later; "only" does not.
- Changing the audience writes an audit entry and sends no notice to the people left out.

## 3. New feature B: the client's organisation structure (org chart)

**Why it is needed (rule 3):** the firm sells organisation structure and the authority matrix as services (`research/intake-and-client-ai-db.md`, lines 9 and 93); Saudi CMA Corporate Governance Regulations, Articles 22 and 23, make the board approve the organisational structure and the duties of each level; the org chart is already a standard intake document (`research/client-journey/notes/research-precontract.md`, line 121). Today the firm hands it over as a PowerPoint slide that goes stale. Inside Selah it becomes the client's living, printable structure, and it keeps accountability visible when people leave.

**What Selah does not do:** it never designs the structure, suggests units, judges spans of control or layers, or flags a structure as good or bad. The assistant never invents positions. The firm decides the structure; Selah records it, shows it, prints it and keeps it current.

**The shape of the data: positions, not people.** A position outlives the person in it.
- `org_charts`: one per client, org-level (no project), like indicators. Versions: a **draft** the firm works on, and **published** versions, each with an effective date, the person who published it, an optional board resolution file, and a frozen copy (`published_snapshot jsonb`) used by the client view, the PDF and the history. The published version is "current"; a draft can hold the "proposed" structure during a restructuring.
- `org_units`: a tree (`parent_id`), kind (board, committee, executive, sector, department, section, unit, office), a code (for example 2.4), names in Arabic and English, level, order, an "advisory" flag for dotted-line units (internal audit, compliance, a projects office beside the CEO), and an optional link to one of the client's existing departments.
- `positions`: unit, code (2.4.1), titles in Arabic and English, reports to (another position), head of unit yes/no, specialties (a list), planned number of people.
- `position_holders`: position, then either a Selah user or a typed name, with from and to dates. A vacancy is a position with no current holder and shows as "شاغر / Vacant".
- Migration `0069_org_chart` (or the next free number), with policies written in the style of `0063_client_indicators.sql`, audit labels in both languages, and a cycle check (a position can never report to itself through a chain) in the service and in a database trigger.

**The chart never grants access.** Departments stay the only thing that limits who sees work. A unit linked to a department is a label. A section inherits its department's limits; it never creates a new limit. When the head position of a linked unit has a different holder from the department's head in `department_members`, show a suggestion that the client admin or firm admin confirms. Nothing changes on its own.

**How it gets in (least work for a consultant who already has the chart in PowerPoint or Visio):**
1. **Excel template**, downloadable from the chart page, with a guide sheet. Columns: unit code, unit, unit kind, parent unit code, level, position code, position title (AR, EN), reports to (position code), head yes/no, holder e-mail or name, specialties (split on ";" or "؛"), vacant yes/no. "Reports to" points to a code, never a title, because titles repeat. Reuse `lib/office/xlsx-read.ts`, `xlsx-write.ts`, the upload scan and the review step of the plan import wizard, in a new `lib/org-chart-import.ts`. The same template exports the current chart, so it round-trips.
2. **Word outline**: a document whose Heading 1, 2 and 3 become levels 1, 2 and 3 (`lib/office/docx-read.ts` already returns heading levels).
3. **Outline editor** on the page: an indented list with add, rename, move up and down, indent and outdent in each row's ⋯ menu, and a side panel for the details (reports to, head, specialties, holder). No drag and drop.
4. **The assistant helps from text**: "Paste a list or description and let the assistant draft it". It turns pasted text (a job list, an outline, text copied from the slide) into rows through the existing `chat_json` with a schema, masked as usual, and the rows always land in the same review step as an import. It only arranges what is in the text; it never adds a position. Reading a picture of a chart is not built now: the AI service is text-only, the local model has no vision, and names inside an image cannot be masked before a hosted model sees them. Revisit only if section 7 picks a local vision model.

**The diagram, on screen and in print.** No diagram library. One server-rendered HTML and CSS tree (nested lists with connector lines drawn in CSS, logical properties, `dir` set) used for both the screen and the PDF, so Arabic stays real text and right to left works by itself. Checked and rejected: React Flow (needs fixed sizes and hand-mirrored coordinates for RTL and server rendering), d3-org-chart (unmaintained since 2023, browser-only), ApexTree and GoJS (paid).
- Layout: levels run across the page down to departments; inside a department its sections and positions stack downward, as in the firm's own slides. Eight departments make eight columns, not 120.
- Screen: collapse and expand per unit, zoom and pan, show levels 1 to 3, focus on one department, "Vacant" shown, dotted lines for advisory units, grey cards, monochrome.
- Print (PDF through Gotenberg; it runs with JavaScript off, so everything is laid out on the server): A3 or A4 landscape (`@page` size works because `preferCssPageSize` is on), choose depth, an overview page then one page per department, with or without names, and a footer with the version, the effective date and the client's name. Excel export too.

**Where it sits.**
- Firm side: a "Structure / الهيكل" tab on the client page, beside Departments.
- Client side: a "Structure / الهيكل" tab on the client's Departments page (if the client has departments off, the page shows only the Structure tab). No new sidebar row.
- Batches 2 and 5 (sidebars, client page tidy) must keep both tabs.

**Who sees what.**
- Firm: the firm admin, the client's lead and deputy, and staff on any of the client's projects see the whole chart with names. Observers read only.
- Client admin: the whole chart with names.
- Client manager: every unit and position title; names only in their own department's branch and the chain above it.
- Action owner: no Structure tab. Their profile shows "Your manager: …" from the chart.
- A "show names" switch on each published version, owned by the client admin, decides whether names appear to managers at all.
- Consultant-managed clients with minimal records: titles only, never names. Restricted clients: their admins only, as today.
- Another client's chart is 404, like everything else.

**Who edits, and change requests.**
- Structure (units, positions, reporting lines): the firm. The lead, the deputy and staffed consultants edit the draft; the lead, the deputy or the firm admin publishes.
- People in positions: the client admin changes them directly on the published chart (an employee joined, left, moved), audited, and the lead is notified. Firm staff can do it too.
- The client admin asks for structure changes with one "Suggest a change / اقترح تعديلاً" link: a short form (what, where, why) that arrives on the lead's home as a request. The lead makes it in the draft and publishes a new version. No side-by-side merge editor.
- Managers and action owners edit nothing.

**When someone joins or leaves.**
- The existing departure flow (`0027_people_leaving.sql`, `team/departure-dialog.tsx`) gains one line per position the person holds: "Leave vacant" or "Pick a replacement". The position stays; the holder row is closed with an end date, so history is kept. The person's open actions go through the existing hand-over, and the new holder is offered as the new owner.
- The invite form gets one optional field, "Position", listing vacant positions.

**The assistant and masking.** Index unit and position titles only (label `shared`), never names, so "who handles warehouses?" answers with a position. Add holders' typed names to `app_mask_terms` so a hosted model never receives them raw.

**Not built:** drag and drop, a design canvas, headcount or cost modelling, span-of-control analysis, scenario comparisons, an employee directory with salaries or grades, syncing with the client's HR system, image reading, and any rule where the chart grants access.

**Tests (each fails without the code):**
- Another client's chart, its PDF and its Excel export are 404 for every account of every other client.
- An action owner gets 404 on the chart routes; a manager sees names only in their branch and above; with "show names" off a manager sees no names; a minimal-records client stores no names.
- A cycle in "reports to" is refused by the service and by the trigger.
- The Excel import: a "reports to" code that does not exist, a duplicate code and a missing parent are shown in the review step and nothing is saved until confirmed; export then import gives the same chart.
- The departure flow leaves the position vacant with a closed holder row; the invite form offers vacant positions only.
- A client admin cannot change units or positions (404 at the API and in the database); the suggestion reaches the lead.
- The PDF HTML contains no script, has `dir="rtl"` in Arabic, and renders through Gotenberg at A3 landscape with the version and effective date in the footer.
- The assistant index holds titles and no names; the masking list includes typed holder names.
- Publishing freezes the snapshot: later draft edits do not change the client's view or the PDF.

**Order and size.** Your estimate to check: about 7 pull requests and 13 to 14 working days.
1. Agenda C, owner-only actions, indicator links (batch 0, after privacy and D6).
2. Combobox chips and `AudiencePicker`.
3. Audience tables, policies and every enforcement point, on documents first, then meetings.
4. Org chart schema, migration, policies, services and database tests.
5. The HTML tree renderer for screen and PDF.
6. The outline editor, holders and vacancies, and the departure and invite hooks.
7. The Excel template and import, Word outline and the assistant's text draft.
8. Publishing, the client view, change requests and the department-head suggestion.

9. Deliverable hand-over and receipt (4a).
10. Indicator moved-away notice (4b), together with the phase 3 indicator wording check.

Pull requests 2 and 3 can run beside 4 to 8 once 1 is merged. Pull requests 9 and 10 are independent of the org chart and the picker and can run beside them. Each follows section 2 of the big prompt (tests, lint, typecheck, code review, merge when green). Add both features and 4a and 4b to `docs/progress-checklist.md` (4a ticks J08.4 and J12.5 and unfreezes F21 in its minimal form; J08.5 comments on drafts stays frozen), `docs/authorization.md`, `docs/walkthrough.md` (seed a published chart for Al-Nukhba with one vacancy, and one file on Al-Nukhba limited with "except") and the handbook in phase 2. Phase 4 gets two new scenarios (20 and 21, now in the big prompt).

## 4. Two small additions from the partner firm's own process

I compared Selah with the partner firm's deep-dive deck on how it actually runs an engagement (never name the firm anywhere in the product, docs or seed data). Selah already covers their core ask. Two steps of their real process have no home yet. Both are small and both fill a half-built chain, so they pass rule 3.

### 4a. Deliverable handed over, and the client confirms receipt (a minimal F21)

**Why (rule 3):** their process starts the follow-up on "day 1 after delivery: the consultant hands over the documents and the client signs that it received them". In Selah the pieces exist but are not joined: `engagement_deliverables` has a title, acceptance criteria and a due date; the client role `acceptor` exists (`lib/client-roles.ts`); deliverable files exist (`document_purpose = 'deliverable'`, with versions). Nothing records that a deliverable was handed over or that the client received it, so the `acceptor` role has nothing to accept and the engagement cannot show what was delivered.

**Build only this:**
- On an engagement deliverable, the lead, deputy or a staffed consultant presses **"Hand over / تسليم"** and picks the file version(s) (deliverable documents of that client, latest version by default). This records `delivered_at`, `delivered_by` and the exact version ids. The file is shared with the client as today.
- The client's acceptor(s) (else the client admin, else the sponsor) get one notice and see a card: **"Confirm receipt / تأكيد الاستلام"** or **"Comment / ملاحظة"** (a required text). Confirming records who, when and which versions. A comment goes to the lead's home; the firm can hand over a new version, which starts a new round. Keep every round in the history.
- A deliverable shows one of four plain words: Not handed over, Handed over (waiting), Received, Commented. No percentage.
- Consultant-managed clients: the consultant records "received on … by …" (who, how, date), like `consultant_recorded` evidence.
- A handed-over deliverable that is still waiting after 10 working days gets one reminder to the acceptor, through the existing digest and the Saudi-week mail rules.
- Show the receipt in the closure report and the client's offboarding pack. Reuse the receipt pattern of `offboarding/packs/[packId]/receipt`.

**Not built:** comments pinned to pages of a draft, side-by-side versions, e-signature, approval workflows on drafts, any link between receipt and invoicing. "Received" is never "accepted as good"; the wording says receipt.

**Rules and tests:** new migration (next free number) with `deliverable_handovers (deliverable_id, round, versions, delivered_by, delivered_at, received_by, received_at, received_via, comment)`, policies in the style of `0063`, audit labels in both languages. Tests (each fails without the code): another client's deliverable is 404 at every route; only an acceptor, client admin or sponsor of that client can confirm; a manager or action owner cannot; a firm user cannot confirm for a full client but can record receipt for a consultant-managed one; confirming freezes the version ids (a later version does not change the receipt); the reminder goes once; the closure report lists receipts.

### 4b. Tell people when an indicator moves the wrong way

**Why (rule 3):** the firm asks plainly "how do we alert leadership when an indicator moves away from its target?" Today Selah reminds when a value is missing (`indicator.due`) and when a feed fails, but says nothing when a value arrives on the wrong side. With values now arriving by file, sheet or the client's own system (#138), nobody may look at them.

**Build only this:**
- When a value is saved (typed, imported or from a feed), and it is on the wrong side of the baseline for the direction the client chose, or the target date has passed and the latest value has not reached the target, send one notice `indicator.moved_away` to the client's lead and deputy and the client's admins. At most once per indicator per period; a correction that fixes it sends nothing.
- The text states facts only, with no judging word: "الشكاوى: ٤٢ في أكتوبر، خط الأساس ٣٠، الأقل أفضل / Complaints: 42 in October, baseline 30, lower is better", plus "client-reported, not verified impact". This matches the D5/N8b wording (the plain difference and the chosen direction, no "worse").
- It goes through the existing digest and mail choices; the client admin can mute it per indicator.

**Not built:** thresholds, amber bands, weighting, forecasts, "at risk" predictions, or any automatic link to a recommendation's status.

**Tests:** one notice for a wrong-side value, none for a right-side one, none twice in a period, none after a fixing correction; a manager limited to a department is not told about another department's indicator; an action owner is never told; another client's people are never told.

### 4c. Handbook (phase 2)

Add one short section, "Where Selah fits in a typical engagement", written generically: a firm usually delivers a strategic plan, then an operational plan with indicators, then the organisation structure, authority matrix, procedures and policies, each phase feeding the next. Show what enters Selah from each (recommendations and actions from all of them; indicators from the operational plan; the org chart from the structure phase; policies and procedures as files and evidence) and what Selah leaves to the firm (writing the plan, the authority matrix itself, procedure workflows). Seed the walkthrough with one deliverable received and one waiting, and one indicator that moved away from its baseline.

If anything here disagrees with the code, the code wins for what exists today: tell me in the log and ask before changing a rule.

If Fable's usage limit is reached, run the helpers on `opus` instead, say so in the log, and keep going.
