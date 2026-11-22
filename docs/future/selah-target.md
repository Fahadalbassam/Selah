# Selah: the target product

This document shows Selah as it should be after every planned upgrade. It lists every feature, how the features connect, and each role's work from start to end. The interactive map with the same data is `docs/future/selah-target-map.html` (open it in a browser; it works offline).

It was written on 23 November 2026 from `origin/main` at 818d544 (migrations to 0115). Nothing here is a new decision. Where our documents do not decide a rule, the rule is listed as an open question in section 6.

## 1. How to read it

**The legend.** Every item carries one of three marks.

| Mark | Meaning |
|---|---|
| **built** | On main today. The target keeps it as it is. |
| **refine** | Built, but it must change. The reason is given, with its source. |
| **planned** | Not built. Written down in our documents as a later improvement or a proposal. |

**The counts.** 85 features in 9 areas: 32 built, 36 refine, 17 planned. 140 connections between them. 10 roles: five on the firm side, four on the client side, plus firm-run clients with no accounts. 20 bumps. 34 open questions.

**Words that must match the code.**

- The **six status words** on every list (`apps/web/src/lib/status-words.ts`): Not started · In progress · Waiting (for the firm, or for the client; the reader's own side reads "Waiting for you") · Needs attention · Verified · Closed. Late is not a word: the date shows in red beside the word.
- The **eight action states** stored in the database (`action_status` in `apps/web/src/db/schema/app.ts`): draft · assigned · in progress · blocked · awaiting review · revision requested · verified complete · closed. They map to the words like this: draft and assigned read "Not started"; in progress reads "In progress"; blocked reads "Needs attention"; awaiting review reads "Waiting for the firm"; revision requested reads "Waiting for the client"; verified complete reads "Verified"; closed reads "Closed".

**Rules that hold for the target as they hold today** (`CLAUDE.md`, `docs/handbook/limits/en.md`, `docs/handbook/later/en.md`).

- Automation suggests, a person decides. Nothing becomes Verified without a consultant's review.
- Clients read the plan. They never write or edit it.
- No client ever sees another client. A refused request looks like a missing one ("Not found").
- Client numbers are "reported by the client, not verified impact". No judging words or colours. Selah never says "compliant".
- One shared local model and one search index. Plain rules and database queries before AI. Real client files go only to a local model.
- Selah has no AI that watches work for deviations. The only automatic notices are rule-based: reminders, the escalation ladder, and the indicator "moved away" notice, which states figures only.

**Sources.** Short names used below: FS = `docs/review/final-status.md`; HB, WF, PP = the three team documents in `docs/team/src/` (handbook, workflows, production path); LATER and LIMITS = `docs/handbook/later/en.md` and `docs/handbook/limits/en.md`; FIRM and CLIENT = the two guides in `docs/handbook/`; SM = `docs/system-map.md`; RULES = `docs/rules.md`; OPS = `docs/operations.md`; GATEB = `docs/review/unfinished-assessment.md`; LOG = `docs/review/lead-log.md`. Every number names its source. Where no source has a number, the text says "not measured".

**Honest limits of what "built" means today** (FS 6). All data is synthetic. Everything ran on one laptop. The scenarios were run by AI helpers on development servers, not by consultants or clients. The isolation sweep is unfinished. The value test has not happened. Production readiness is not claimed.

## 2. Feature list

Grouped by area. "Connects to" names the other features a feature touches and how. The ids (A1, W3 and so on) are the same in the table of section 4 and on the map.

### A. Access and privacy

| Id | Feature | Status | What it does | Connects to |
|---|---|---|---|---|
| A1 | Sign-in and accounts | **built** | Invitation only; nobody signs up. Firm staff and client admins use a password plus an authenticator code. Managers and action owners may use a one-time link by email. At most 10 sign-in tries per account in 15 minutes. Source: HB 18; PP 1. | A3 (the session becomes the identity every check uses); A7 (sign-ins, refusals, invitations and switch-offs are audited); A8 (notices are accepted at first sign-in); C3 (an archived client's people are read-only in the grace period) |
| A2 | People, invitations and access reviews | **refine**: When a client person leaves, the lead and the project's consultants are not told that owners changed, and the leaving dialog mentions a temporary head with no control (scenario 9). | Admins invite people, switch them off, and confirm every 90 days who is still with them. Switching a person off lists the work they still hold. Source: HB 18; WF 5, Part B. | W7 (switching a person off lists their open actions to hand on); P8 (leaving ends position holdings; an invitation can name a vacant position); C4 (a firm leaver's work is handed over before the account is switched off) |
| A3 | Permission core ("Not found") | **refine**: The isolation sweep (scenario 19) is not finished, there is no outside penetration test, and the "Not found" page answers HTTP 200. | Every request is checked twice: authorize() with the policy table in the app, and row-level security in the database. A refused request looks like a missing one. Source: FS 2, 5, 6; PP 1. | A1 (the session becomes the identity every check uses); W10 (file labels are enforced by the permission core); I5 (the same check sits inside the assistant's search); H9 (the isolation sweep tests the permission core) |
| A4 | Who sees an item (audience picker) | **built** | "Everyone except..." or "Only these people..." on a file (never evidence) or a meeting. It only takes people away. A person left out sees no row, count, notice, mail or assistant passage. Source: FS 1.3; HB 09. | W10 (narrows who sees a file); U4 (narrows who sees a meeting); I5 (a person left out gets no passage and no citation); H2 (no notice or mail for a person left out) |
| A5 | Departments | **built** | Optional, off by default. When on, a manager or action owner sees only their department's actions and files. Open work can move between departments. Source: HB 05; SM F05. | U4 (a department meeting lists only that department's work); P8 (a unit may link to a department as a label; access never changes); W1 (a department-limited person sees only that department's actions) |
| A6 | Client groups (holdings) | **built** | Adds up the numbers of several companies of one group without merging their data. Shown once a group exists. Source: HB 05; PP 3. | R1 (the group roll-up adds up member companies' numbers) |
| A7 | Audit log | **refine**: Old rows still hold some private file names until the pre-go-live clean-up script is run once on the live database (written and tested, not run). | Who did what and when, as ids and counts, never file text or assistant questions. Rows are chained, sealed and checked nightly. CSV export. Source: PP 1, 5A; FS 5. | A1 (sign-ins, refusals, invitations and switch-offs are audited); W1 (every transition, sign-off and owner change writes a row); H7 (the clean-up script blanks old private file names); A9 (erasure is logged; history stays); I1 (assistant use and consent are audited) |
| A8 | Legal pages and consent notices | **refine**: Not reviewed by a lawyer. Hosting location, retention and duties are not confirmed. | Terms, privacy notice and AI notice accepted and recorded at first sign-in; a data processing agreement template; the sub-processor list; a security pack showing this site's real setup. Source: HB 18; PP 1; FS 5. | A1 (notices are accepted at first sign-in) |
| A9 | Erasing a person | **built** | On request the firm admin erases a person: the name becomes "Former user #n", sign-in data is deleted, history stays. It cannot be undone and is logged. Source: HB 18. | A7 (erasure is logged; history stays) |

### S. Winning and setting up a client

| Id | Feature | Status | What it does | Connects to |
|---|---|---|---|---|
| S1 | Public inquiry form | **built** | A prospect fills the public form, or staff enter a referral or tender. The prospect gets a reference number by mail. Every firm admin is told. Source: HB 07, 18. | S2 (a new inquiry lands in the inbox) |
| S2 | Inquiries inbox and conflict check | **refine**: The conflict dialog defaults to "conflict", and two different words are still used for "inquiry" (scenario 1; after-scenarios list). | Four numbered steps: give it an owner, discovery session, proposal, make it a client. The conflict check must be clear or overridden. NDA recorded. Win, or decline with an email. Source: WF 2, Part B; FS 5. | S1 (a new inquiry lands in the inbox); S4 (winning an inquiry creates the client); S9 (winning records the signed engagement); S6 (suggested leads come from expertise) |
| S3 | Pitches | **built** | A draft client the firm is trying to win. Only the firm sees it. The firm admin makes it a client. Source: HB 02; FIRM 3. | S4 (a pitch becomes a client when the firm admin wins it) |
| S4 | Client record and setup | **built** | The client page: Overview, People, Setup, Structure. Legal profile, contacts without accounts, second sign-off rule, "Watch" for firm admins. A "minimal records" client keeps no legal profile and has its free text cleared 90 days after handover. Source: HB 06, 18; SM F04; docs/firm-settings.md. | S2 (winning an inquiry creates the client); S3 (a pitch becomes a client when the firm admin wins it); S5 (the mode is set on the Setup tab); I2 (the client assistant offer is on the Setup tab); P8 (the structure is a tab of the client page) |
| S5 | Participation modes (full, restricted, firm-run) | **built** | Full: any client role signs in. Restricted: up to two client admins. Firm-run: no client accounts; the consultant records progress and a second person reviews. Source: HB 05; FS 1.4 (#197). | S4 (the mode is set on the Setup tab); W1 (firm-run: the consultant records progress); W3 (firm-run: a second person must review) |
| S6 | Expertise profiles and lead suggestions | **refine**: A consultant cannot set their own expertise although the page says they can; only the admin has the control (scenario 1). "Make lead" is hidden in a row menu. | Selah suggests up to five consultants for a new client from services, sector, language, availability and load. It only suggests. No performance scores. Source: HB 04; WF Part B. | S2 (suggested leads come from expertise); S7 (suggested consultants come first when adding to a team); H3 (lead suggestions are switched on in settings) |
| S7 | Staffing, join requests and client roles | **built** | The lead, deputy or admin puts consultants on the client's team and on each project. A consultant can ask to join with a reason. Client roles on a project: sponsor, coordinator, steering, acceptor, observer. Source: HB 04; FIRM 4; apps/web/src/db/schema/app.ts (client_role). | S6 (suggested consultants come first when adding to a team); P1 (only staffed consultants see a project); W1 (only people on the project can own its actions); P4 (people must be on the project before owners can be matched) |
| S8 | Lead and deputy change with handover note | **refine**: Scenarios 6 and 7 still found the client is not told on screen when her consultant changes (only Help shows it), and reviews waiting on the old lead are not moved automatically. | The firm admin changes the lead in one step. The client's admins and the old lead are told, and a handover note travels with the change. Source: FS 1.4 (#199), 5; PP 4. | H2 (the client's admins and the old lead are told); I2 ("who is my consultant" reads the client's team); C4 (a departure handover can change the lead) |
| S9 | Engagement record and end reminder | **refine**: The notice does not say what to do next (renew, close, archive). The daily job must be scheduled on the server, and the first run after migration 0109 must be sized. | The signed contract record with dates and deliverables. The lead, deputy and firm admins get a bell notice when an open engagement ends within 30 days, and again when it has ended and is still open. The client is never told. Source: HB 07; PP 4, 5A. | S2 (winning records the signed engagement); P1 (a project is visible to the client only once a signed engagement covers it); H4 (the daily run makes the end reminder); S10 (deliverables belong to the engagement); C5 (a renewal is a new engagement) |
| S10 | Deliverable hand-over and receipt | **built** | The firm hands over a deliverable's files. The client confirms receipt or comments. Four states: Not handed over, Handed over (waiting), Received, Commented. "Received" never means accepted. Source: FS 1.3 (#171); WF 10. | S9 (deliverables belong to the engagement); W10 (a hand-over picks file versions already shared); U1 (files waiting for receipt show on the receiver's home); C1 (an unanswered hand-over reads "no answer before the project closed") |

### P. The plan

| Id | Feature | Status | What it does | Connects to |
|---|---|---|---|---|
| P1 | Projects | **built** | One project per phase or agreed scope. Five tabs: Plan, Requests and files, Meetings, Progress, People. A project no signed engagement covers stays a draft the client does not see. Source: HB 06; FS 1.2 (#182). | S7 (only staffed consultants see a project); S9 (a project is visible to the client only once a signed engagement covers it); P3 (the plan is the first tab of a project); C5 (the new project continues the earlier one); C7 (a pause would be a new project state) |
| P2 | Internal projects | **built** | The firm's own work with the same tools. Any firm member creates one and becomes its lead. Another firm member reviews. No client ever sees it. Source: HB 14. | P3 (internal projects use the same plan tools) |
| P3 | Findings and recommendations | **built** | Consultants write findings and recommendations. A recommendation can be withdrawn with a reason. Released items are never deleted. Clients read the plan; they never write it. Source: HB 03; FIRM 5. | P1 (the plan is the first tab of a project); P2 (internal projects use the same plan tools); P5 (the client answers each recommendation); P6 (actions hang under a recommendation); R3 (the firm links indicators to a recommendation); P4 (import fills the plan; export downloads it); P7 (low answers become findings a consultant confirms); U5 (a decision can become a board-decision recommendation); R5 (a suggested link to a recommendation; the firm confirms) |
| P4 | Plan import and export | **refine**: If the client's people are not yet on the project, the import flags every owner as "unknown" and nothing on screen says why (scenario 1). | Import the plan from Excel or Word; download it as Excel with a template and guide sheet. Import files are scanned first. Source: WF 2, Part B. | P3 (import fills the plan; export downloads it); W10 (import files are scanned first); S7 (people must be on the project before owners can be matched) |
| P5 | The client's answer to a recommendation | **built** | The client admin or the sponsor answers agree, partly agree or disagree, with a reason. Every answer stays on record. The firm may answer once. Source: WF 3; CLIENT. | P3 (the client answers each recommendation) |
| P6 | Draft and release of actions | **refine**: The "release now" switch is on by default, is hard to see in dark mode and saved drafts by mistake (scenario 18). Draft actions are not marked on the plan list. | An action starts as a draft nobody at the client can see. The consultant releases it with an owner and a due date. The owner and the client admin are told. Source: FS 1.1 (D6), 2; WF Part B. | P3 (actions hang under a recommendation); W1 (release makes the action visible and tells the owner) |
| P7 | Assessments and templates | **refine**: Only a starter template ships; the firm's own assessment cannot be loaded until the firm sends it. Guidance written for the consultant is shown to the client (after-scenarios list). | The firm builds and versions a template. A consultant answers each question. Low answers are suggested as gaps and a consultant confirms each as a finding. Scores are firm-only and never say "compliant". Source: HB 18; PP 3; GATEB B10, B18. | P3 (low answers become findings a consultant confirms); P9 (the help suggests draft answers and scores) |
| P8 | Organisation structure (org chart) | **refine**: The publish-id bug is fixed (#215) but scenario 20 steps 10 to 12 were not re-run. The draft from pasted text gave 0 units after 135 s (scenario 20). | Positions, not people. The firm drafts (by hand, Excel, Word, or rows drafted from pasted text) and publishes versions. The client admin places people. PDF in A3 or A4. It never changes who sees any work. Source: FS 1.3, 2, 4.10; HB 13. | A2 (leaving ends position holdings; an invitation can name a vacant position); A5 (a unit may link to a department as a label; access never changes); S4 (the structure is a tab of the client page); I7 (draft rows from pasted text run as a job); U1 (suggested changes show on the lead's home); R4 (the chart prints as a PDF) |
| P9 | Assessment help | **planned**: Planned last. It depends on the reference library and the labelled test set, and runs as an overnight job on the shared model. | For each question, a suggested draft answer and score from the client's evidence against the reference library, each with a citation. Marked draft until a consultant takes it on. Never "compliant". Source: LATER 2, 6. | P7 (the help suggests draft answers and scores); I13 (drafts are measured against the reference library) |

### W. The action cycle

| Id | Feature | Status | What it does | Connects to |
|---|---|---|---|---|
| W1 | Actions (the working cycle) | **refine**: On Home, "Start work" only opens the action; a second click starts it (scenario 2). "Verified" is used three ways in English. | Eight stored states: draft, assigned, in progress, blocked, awaiting review, revision requested, verified complete, closed. Late is a rule, not a state. Lists show one of six status words. Source: apps/web/src/lib/status-words.ts; WF 4, Part B. | A5 (a department-limited person sees only that department's actions); A7 (every transition, sign-off and owner change writes a row); S5 (firm-run: the consultant records progress); S7 (only people on the project can own its actions); P6 (release makes the action visible and tells the owner); W2 ("Send for review" carries the evidence); W4 (a new date is asked on the action); W5 (blocked is one of the eight states); W6 (an open action can be closed with an outcome); W7 (the owner can change; the status stays); W8 (the discussion lives on the action); U2 (open actions feed the reminders and the ladder); U3 (the lists are views over action state and history); U1 (home rows come from the same action lists); I1 ("Ask the assistant" on an action; it never changes the action); C1 (every open action gets a decision) |
| W2 | Evidence and evidence items | **refine**: Accepting an evidence item and verifying are two steps, and the first try gets an instruction instead of one combined step (scenarios 3 and 4). | An action can name the pieces of proof it needs. The owner sends files (new, or already in Selah). Evidence is never deleted or renamed. Source: HB 18; WF 4, Part B. | W1 ("Send for review" carries the evidence); W3 (every evidence item is accepted or waived before verifying); W10 (evidence is a file: same upload path and scanner) |
| W3 | Review, verify and second sign-off | **built** | A consultant accepts (verified) or asks for a revision with a reason. Nobody reviews their own work. Where the rule asks, a second consultant signs off. The database refuses "verified" without a consultant's accept. The firm can reopen with a reason. Source: HB 03; WF 4. | S5 (firm-run: a second person must review); W2 (every evidence item is accepted or waived before verifying); R1 (only work a consultant verified counts as verified) |
| W4 | Date requests and slip history | **refine**: Decline acts at once: no reason box, no place to offer a meeting, and it cannot be taken back (scenario 5). | The owner asks for a new date with a reason. The firm approves or declines. The third move needs the lead or admin. Every move is kept. Source: WF 5, Part B. | W1 (a new date is asked on the action); R1 (days slipped show in reports) |
| W5 | "I am stuck" | **built** | The owner marks the action blocked with a reason. It reads "Needs attention", joins the next agenda, and the lead, deputy and the project's consultants are told. Source: FS 1.4 (#200); CLIENT. | W1 (blocked is one of the eight states); U4 (blocked work is on the next agenda); H2 (the lead, deputy and the project's consultants are told) |
| W6 | Risk acceptance and closing an action | **refine**: The Sign button is disabled with no message saying why (scenarios 3 and 4). | A client admin or manager signs a risk acceptance. The firm then closes the action with an outcome: partly done, risk accepted, not applicable, or replaced by another action. Source: HB 08; WF Part B. | W1 (an open action can be closed with an outcome) |
| W7 | Give to a colleague (owner change) | **refine**: When a client admin moves a leaver's actions, only the new owner is told and the history shows no "owner changed" line (scenario 9). | Moves an action to someone else on the same side. The status stays. Old and new owners, the lead, the deputy and the project's consultants are told. The server refuses an owner who may not be on the project. Source: FS 1.1 (D1), 2; WF 5. | A2 (switching a person off lists their open actions to hand on); W1 (the owner can change; the status stays); H2 (old and new owners and the firm team are told); U6 (the admin or lead may then give an action to a colleague) |
| W8 | Discussion, mentions and firm notes | **built** | A discussion on each action for everyone who can open it, with mentions. Firm-only notes beside it. Source: HB 06; CLIENT. | W1 (the discussion lives on the action); I10 (the answer would be saved as a firm-only note) |
| W9 | Document requests and upload links | **built** | The firm lists the documents it needs, each with an owner and a due date. The client answers with a file or "does not apply". A no-login link serves one item (1 hour to 30 days, up to ten files, revocable). Source: HB 09; WF 6. | W10 (a requested item is answered by a file) |
| W10 | Files (labels, versions, scan) | **built** | Shared, firm-only, client-private or personal. Up to 20 MB, type checked three ways, virus-scanned before anyone opens it. Versions kept. A wrong upload is withdrawn with a reason. Source: HB 09. | A3 (file labels are enforced by the permission core); A4 (narrows who sees a file); S10 (a hand-over picks file versions already shared); P4 (import files are scanned first); W2 (evidence is a file: same upload path and scanner); W9 (a requested item is answered by a file); I5 (a file switched on for the assistant is indexed); I6 (the file shows which kinds of number it holds); C3 (the export pack zips shared files); I3 (attaches files the asker can already see) |

### U. Follow-up and meetings

| Id | Feature | Status | What it does | Connects to |
|---|---|---|---|---|
| U1 | Home (one per role) | **built** | What waits for each person, each row with its next step. Action owners see three groups: Waiting for you, With your consultant, Finished. Source: HB 06; FS 1.2 (#179). | S10 (files waiting for receipt show on the receiver's home); P8 (suggested changes show on the lead's home); W1 (home rows come from the same action lists); U4 (meetings this week and follow-ups show on home); I11 (it would use what the home already knows); H8 (every screen follows the rules: one main action, plain words, a word for every status) |
| U2 | Reminders and the escalation ladder | **refine**: Work mail held for the weekend gives no sign that it is held (scenarios 1 to 3). Nothing is defined after the last step. | A reminder before the due date; the owner when overdue; managers and the lead after 7 days; client admins, the sponsor and watching firm admins after 14 days. One summary mail a day at most. Days are set on each project. Source: HB 08, 18; WF Part B. | W1 (open actions feed the reminders and the ladder); H2 (the daily run queues summary mail); H4 (the ladder runs daily); H3 (stale days and check-in days come from firm settings) |
| U3 | Oversight lists and the Projects table | **built** | Lists across projects: late, blocked, no activity, date moved twice, sent back twice, no active owner. "Remind the owner" once a day. Counts only, never a health word. Source: HB 06; FS 1.1 (D2, D5). | W1 (the lists are views over action state and history); U6 (lanes would read the same action history) |
| U4 | Meetings (booking, invites, agenda) | **refine**: "Mark as held" shows only after the start time (scenario 10). A department-limited manager's Meetings tab reads "none for you yet" although she is invited. | Book with a call link (Meet, Teams or Zoom). Calendar invitations by email. The agenda writes itself from late, awaiting-review, blocked and changed work. Department and whole-project meetings. Source: HB 11; FS 2, 5. | A4 (narrows who sees a meeting); A5 (a department meeting lists only that department's work); W5 (blocked work is on the next agenda); U1 (meetings this week and follow-ups show on home); U5 (a held meeting gets a summary, decisions and follow-ups); H2 (invitations carry a calendar file); I11 (the brief is built from a meeting's agenda) |
| U5 | Summaries, decisions and follow-ups | **refine**: The summary switch is labelled "firm only" but ON means shared (scenario 10). | The summary is written by hand, firm-only first, then shareable. Decisions are never edited: a correction is a new decision. Follow-ups have an assignee and a date. A transcript is firm-only and deleted 30 days after the summary is confirmed. Source: HB 11; WF Part B. | U4 (a held meeting gets a summary, decisions and follow-ups); P3 (a decision can become a board-decision recommendation); I12 (the assistant would read confirmed summaries); U8 (the list would gather decisions across meetings) |
| U6 | Stuck or overloaded lanes | **planned**: Planned first: database queries only, no model. No score or ranking of a person. | From action history: a consultant with many reviews waiting long, a client person who owns most late work in a department, a project where nothing moved for weeks. Facts only, shown to the firm admin or the lead, who decide. Source: LATER 3, 6. | U3 (lanes would read the same action history); W7 (the admin or lead may then give an action to a colleague) |
| U7 | Concern flags (facts, no score) | **planned**: On the after-scenarios list. Not designed yet: which facts count and who sees them are open. | Facts about a project that may need a look, for firm staff. No score. Source: FS 5; GATEB B11. | I1 (flags were proposed for the staff assistant) |
| U8 | Decisions list and calendar screen | **planned**: Proposals only. Each must first be shown to be useful. | One list of all decisions across meetings, and a calendar screen. Source: HB 11; WF (not built box). | U5 (the list would gather decisions across meetings) |

### R. Reports and numbers

| Id | Feature | Status | What it does | Connects to |
|---|---|---|---|---|
| R1 | Progress reports (templates, approval, confirmed send) | **refine**: Sending a report gives the client no notice, and the PDF header date uses UTC and can show the previous day (scenario 11). | A report freezes the project's numbers on the last day of the period. Three templates. A colleague other than the writer approves. A person confirms the send. Selah never sends on its own. Source: HB 12; FS 2, 5. | A6 (the group roll-up adds up member companies' numbers); W3 (only work a consultant verified counts as verified); W4 (days slipped show in reports); R2 (a status pack is approved and sent like a report); R4 (report PDFs in the reader's language); I4 ("Use as draft" fills the report note); R6 (own templates would start a report note) |
| R2 | Monthly status pack | **built** | Drafted by the monthly job, seen only by the firm. The consultant adds a note and issues it; it is then approved and sent like any report. Source: HB 12; SM F15. | R1 (a status pack is approved and sent like a report); H4 (the monthly job drafts the pack); R3 (indicators are frozen into an issued pack) |
| R3 | Business indicators | **refine**: The import button is hidden until a data mode is chosen (scenario 12). | The client's own figures with a baseline and a target, typed, imported or connected. Always labelled "reported by the client, not verified impact". Only the firm links an indicator to a recommendation. A "moved away" notice gives figures only. Source: HB 12; WF 9, Part B. | P3 (the firm links indicators to a recommendation); R2 (indicators are frozen into an issued pack); H2 (the "moved away" and "value due" notices); R5 (help proposes rows, a flag and links); I1 (indicators are a record the assistant can cite) |
| R4 | Exports and PDFs | **refine**: An export asked for in English from an Arabic screen has Arabic labels, and the closure PDF total was off by one (GATEB B13; scenario 14). | Plan as Excel, actions list, report PDFs, client report, closure report, structure PDF, audit CSV, export pack. Each holds only what the reader could already open and is logged. Source: HB 18; FS 2, 5. | P8 (the chart prints as a PDF); R1 (report PDFs in the reader's language); C1 (the closure report PDF) |
| R5 | Indicator help | **planned**: The flag and the spreadsheet rows need no model and come first. Messy files and suggested links use the shared model, after the value test. | Reads values from a spreadsheet the client uploads and proposes rows. Flags a value that moved away from its target. Suggests a likely link to a recommendation. Never says a recommendation caused a change. Source: LATER 1, 6. | R3 (help proposes rows, a flag and links); P3 (a suggested link to a recommendation; the firm confirms) |
| R6 | Own report templates and a richer editor | **planned**: Research first: Arabic right-to-left editing, safe storage, PDF and translation. | The firm makes its own templates and writes the note with headings, lists and small tables. Approval and a confirmed send still apply. Source: LATER 4; HB 12. | R1 (own templates would start a report note) |
| R7 | The client's own report page | **planned**: No model needed. Listed among the first items to build. | The client keeps and edits the assistant's progress-update draft as the company's own report. The firm sees it only if the client shares it. Selah never sends it. Source: LATER 4, 6. | I4 (the client's draft would be kept as the company's own report) |

### I. The assistant

| Id | Feature | Status | What it does | Connects to |
|---|---|---|---|---|
| I1 | Staff assistant | **refine**: Median 117 s per answer on the test laptop's processor. Of 19 scored answers 10 were right, 3 partly right, 6 wrong. A scanned page produced an invented answer. An answer that only echoes the question shows as grounded (FS 4.2, 4.4, 5). | Questions about one project or all the asker's clients. Every answer cites the file, version and page, or the record. Follow-up message drafts, never sent. It never approves, closes or changes anything. Source: HB 10; FS 4. | U7 (flags were proposed for the staff assistant); R3 (indicators are a record the assistant can cite); I5 (answers come from the permission-filtered search); W1 ("Ask the assistant" on an action; it never changes the action); A7 (assistant use and consent are audited); I3 (attach works in any assistant chat); I4 (the staff draft opens the report page); H11 (measures time with and without the assistant) |
| I2 | Client assistant | **refine**: A legal question is refused without a pointer to what the documents say (FS 5), and answers are as slow as on the staff side. | Off by default. The firm admin offers it per client and role with a daily question limit; the client admin must agree and can switch it off. Facts only: who is my consultant, my deadlines, what the documents say. Never firm-only files, scores, notes or other clients. Source: HB 10; FS 1.4 (#198), 5. | S4 (the client assistant offer is on the Setup tab); S8 ("who is my consultant" reads the client's team); I5 (answers come from the permission-filtered search); I4 (the client's draft stays in the chat); H1 ("who is my consultant" uses the Help page's team list) |
| I3 | @-attach a file | **refine**: An attached file that could not be read was answered as if it were another file (scenario 13). The answer should say the attachment was skipped. | Type @ to attach up to three files the asker can already see. Chips warn if a file is scanned, not yet indexed or switched off. Source: HB 10; WF Part B. | W10 (attaches files the asker can already see); I1 (attach works in any assistant chat) |
| I4 | Progress draft and "Use as draft" | **refine**: In scenario 13 the draft said 0 verified and 1 late while the project page said 1 of 8 and 3 late. | A facts-only progress draft marked "Draft: check before sending". For firm staff, "Use as draft" opens the report page with the text as the note. For client people it stays in their own chat. Source: HB 12; FS 2. | R1 ("Use as draft" fills the report note); R7 (the client's draft would be kept as the company's own report); I1 (the staff draft opens the report page); I2 (the client's draft stays in the chat) |
| I5 | Search index, masking and the AI service | **refine**: A name that appears only inside a file is not masked, so real client files go only to a local model. Some organisation names over-mask. 8 of 89 scored questions missed the right passage (FS 4.3). | Files switched on for the assistant are read into passages, embedded (bge-m3) and searched with the permission filter inside the query. Known names are masked before text reaches a model; masking fails closed. One local model (qwen3.5:4b) answers. Arabic spelling fold. Source: HB 10; FS 4.3, 5. | A3 (the same check sits inside the assistant's search); A4 (a person left out gets no passage and no citation); W10 (a file switched on for the assistant is indexed); I1 (answers come from the permission-filtered search); I2 (answers come from the permission-filtered search); I6 (numbers are tagged before a passage is stored or sent); I9 (scanned pages would become searchable); I13 (a separate "reference" source in the same index); H6 (real client files only to a local model; direct way in first); H9 (the labelled test set scores search and answers) |
| I6 | Personal-number scanner | **built** | A rule-based scanner replaces national IDs, Iqama numbers, IBANs, card numbers, phones, emails, passport and commercial-registration numbers with tags, at indexing and at sending. The stored file never changes. Source: HB 10; FS 4.5 (scanner timing: not measured). | W10 (the file shows which kinds of number it holds); I5 (numbers are tagged before a passage is stored or sent) |
| I7 | Background AI jobs | **built** | Translations, file summaries, indexing and the org chart draft run in one shared queue, one model run at a time. The card says "Still working"; 10-minute ceilings. Source: FS 1.4 (#208, #211). | P8 (draft rows from pasted text run as a job); I8 (translations and summaries are made by jobs); H4 (the job runner claims queued work, one model run at a time) |
| I8 | Translation and file summaries on demand | **built** | "Show in English" or "اعرض بالعربية" on written text, labelled "Machine translated" with "Show original". File summaries with page links. Made once, then kept. Source: HB 10, 18. | I7 (translations and summaries are made by jobs) |
| I9 | Scanned pages (text recognition) | **planned**: After-scenarios list. A scanned board minute is invisible to the assistant today. | Text recognition only on pages marked scanned, in the shared queue, indexed once. Runs on the processor. Source: LATER 4; FS 5. | I5 (scanned pages would become searchable) |
| I10 | Save an answer as a note | **planned**: After-scenarios list. No model needed. | Save an assistant answer with its citations as a firm-only note on the project, by the person who asked. Never shared with the client automatically. Source: LATER 4. | W8 (the answer would be saved as a firm-only note) |
| I11 | "What changed" and the meeting brief | **planned**: Waits for the value test: tasks 3 and 6 show whether the time saved is worth it. | A cited list of changes since the asker's last visit, and a brief built from a meeting's agenda, open decisions and open actions, marked as a draft. Source: LATER 4; docs/value-test.md. | U1 (it would use what the home already knows); U4 (the brief is built from a meeting's agenda); H11 (tasks 3 and 6 decide whether it is built) |
| I12 | Meeting summary draft; assistant reads summaries | **planned**: Proposals only. Each must first be shown to be useful. | An AI draft of the summary from a transcript, and the assistant reading confirmed summaries and decisions. Source: HB 11. | U5 (the assistant would read confirmed summaries) |
| I13 | Reference library | **planned**: Needs a licence check of each source first. Two sources are copyrighted books: the library holds the firm's short notes, not their text. | Six governance and strategy references the assistant and the assessment help can cite, kept apart from client evidence. Every citation is labelled "Reference" with the source, edition and place. Source: LATER 5; PP 6. | P9 (drafts are measured against the reference library); I5 (a separate "reference" source in the same index) |

### C. Closing and leaving

| Id | Feature | Status | What it does | Connects to |
|---|---|---|---|---|
| C1 | Project closing | **refine**: "Start closing" exists only in the ⋯ menu; the closure PDF total was off by one; a reopened project sends no notice to the client admin (scenario 14). | The client can ask to close. The lead or deputy starts closing. Every open action gets a decision: handed over, deferred, withdrawn or waived. Lessons are firm-only. The firm admin closes; the project becomes read-only. Closure report PDF. Reopen with a reason. Source: WF 12, Part B; apps/web/src/db/schema/app.ts (closure_disposition). | S10 (an unanswered hand-over reads "no answer before the project closed"); W1 (every open action gets a decision); C2 (the survey is answered once the project is closed); C3 (archiving needs every project closed); R4 (the closure report PDF); C6 (today the reason goes in the closing notes); C8 (follows the hand-over at closing) |
| C2 | Closing survey and case-study consent | **built** | After closing, the client people asked answer a short survey; only the firm admin and the client's lead read it. Case-study consent is optional and can be withdrawn. Kept out of the way: not put in front of every client. Source: PP 3; apps/web/src/authz/policy.ts (pulse.*, case_study.*). | C1 (the survey is answered once the project is closed) |
| C3 | Archiving a client (offboarding) | **refine**: An archived client is still offered Reply, "I will attend" and "make pack" and is refused with the wrong reason; the archived sign-in message does not say what to do (scenario 15). | When every project is closed the firm admin archives the client: a read-only grace period, the export pack with checksum and receipt, legal holds, then retention purges. Source: HB 07; WF Part B. | W10 (the export pack zips shared files); C1 (archiving needs every project closed); H4 (retention purges run daily); A1 (an archived client's people are read-only in the grace period) |
| C4 | Handing over a firm leaver's work | **built** | The admin opens the person on Team. Selah lists everything they hold (open actions, clients they lead, reviews only they can do, client roles) and hands it to one colleague in one step. Switching the account off is refused until then. Source: HB 04. | A2 (a firm leaver's work is handed over before the account is switched off); S8 (a departure handover can change the lead) |
| C5 | Guided renew step | **planned**: Proposal only; must first be shown to be useful. Who uses it is not decided. | A guided step that records the new engagement, opens the follow-on project and carries open actions into it. Source: WF (not built box); PP 4, 6. | S9 (a renewal is a new engagement); P1 (the new project continues the earlier one) |
| C6 | Reason a contract ended | **planned**: Proposal only. Who records it and who sees it are not decided. | A record of why an engagement ended. Today the reason goes in the closing notes; there is no separate termination record. Source: WF 13; PP 4, 6. | C1 (today the reason goes in the closing notes) |
| C7 | Pause state for a project | **planned**: Proposal only. What a pause stops (reminders, the ladder, client access) is not decided. | A way to pause a project. Today a project is planned, draft, active, closing or closed; there is no pause. Source: WF (not built box); apps/web/src/db/schema/app.ts (project_state). | P1 (a pause would be a new project state) |
| C8 | Re-check results at 6 and 12 months | **planned**: Proposal only. Who does it and what is checked are not decided. | Looking again at results 6 and 12 months later. Today the firm setting gives check-ins at 30, 60 and 90 days after hand-over. Source: WF (not built box); docs/firm-settings.md. | C1 (follows the hand-over at closing) |

### H. Help, notices and platform

| Id | Feature | Status | What it does | Connects to |
|---|---|---|---|---|
| H1 | Help, role guides and tooltips | **built** | A guide for each role in Arabic and English, about 95 tooltips, first-visit lines. The client Help page: your consultants, write to the firm's management, questions people ask. Source: HB 15; FS 1.4 (#189, #190). | H2 (a message to the firm's management reaches the firm admins); I2 ("who is my consultant" uses the Help page's team list); H8 (tooltips and guides exist in Arabic and English) |
| H2 | Notifications and mail | **refine**: Held work mail gives no sign that it is held; mail for English readers is written Arabic first; the invitation mail names neither the firm nor the inviter. No sending domain with SPF, DKIM and DMARC yet. | A bell and a mail queue: every notice is a line and a link, never content. Work mail respects the Saudi week, quiet hours and Ramadan hours. Each person chooses how updates arrive. Security and meeting mail goes at once. Source: HB 18; WF Part B; PP 1. | A4 (no notice or mail for a person left out); S8 (the client's admins and the old lead are told); W5 (the lead, deputy and the project's consultants are told); W7 (old and new owners and the firm team are told); U2 (the daily run queues summary mail); U4 (invitations carry a calendar file); R3 (the "moved away" and "value due" notices); H1 (a message to the firm's management reaches the firm admins) |
| H3 | Firm settings and team load | **built** | Intake address, lead suggestions, stale after 14 days, check-ins at 30, 60 and 90 days, access review every 90 days, indicator grace 10 days, retention, Ramadan mail hours. Team load shows reviews and work per consultant, never a ranking. Source: HB 06, 18. | U2 (stale days and check-in days come from firm settings); S6 (lead suggestions are switched on in settings) |
| H4 | Scheduled jobs | **built** | One loop: index files, delete stored objects, seal and check the audit chain, ops alerts; daily reminders, indicator feeds and purges; monthly status packs. Source: SM F25. | S9 (the daily run makes the end reminder); U2 (the ladder runs daily); R2 (the monthly job drafts the pack); I7 (the job runner claims queued work, one model run at a time); C3 (retention purges run daily); H5 (the ops alert job watches the others) |
| H5 | Backups, restore and monitoring | **refine**: Built, not proven: no second disk, no key kept off the server, no schedule, no drill done and written down, no alerts to a real inbox. | Backup, off-site encrypted copy, restore, a monthly restore drill, readiness checks, a two-minute alert job, upgrade and rollback scripts, a breach runbook. Source: PP 1, 5A. | H4 (the ops alert job watches the others); H6 (backups and monitoring must be proven on the live server) |
| H6 | Deployment | **refine**: The server is not running Selah. The tunnel was never tested live. There is no staging server. | Docker Compose with two ways in: a tunnel for sample data, direct for real data. The full end-to-end suite runs on a production-like stack. Source: PP 1, 2. | H5 (backups and monitoring must be proven on the live server); I5 (real client files only to a local model; direct way in first); H7 (run once before go-live) |
| H7 | Pre-go-live clean-up script | **refine**: Written and tested; not run. It is run once on the live database before go-live. | Blanks private file names in old audit and activity rows, re-hashes the audit chain and writes one system entry. Source: PP 5A (step 2); FS 1.4 (#205). | A7 (the clean-up script blanks old private file names); H6 (run once before go-live) |
| H8 | Design rules and accessibility | **refine**: Accessibility checks are partly done: names are missing on the logo link, radios and checkboxes; dark-mode switches and check boxes are barely visible (scenario 18; FS 5). | Arabic first, right to left; English one click away. Monochrome with muted status colours and a word for every status. Desktop and tablet only, 768 pixels and up. Dark mode. Source: HB 16; FS 5. | U1 (every screen follows the rules: one main action, plain words, a word for every status); H1 (tooltips and guides exist in Arabic and English) |
| H9 | Tests and scenarios | **refine**: One unit test depends on the machine's environment; two end-to-end assistant tests were written for a hosted model; the isolation sweep and the scenario report are not done; Gate C is ahead; several dependency updates are open and unverified (FS 3, 5). | Lint, type check, unit, database (row-level security), upload scan, AI service and end-to-end suites; a labelled assistant test set; 21 scenarios on four copies. Source: FS 2, 3, 5. | A3 (the isolation sweep tests the permission core); I5 (the labelled test set scores search and answers); H10 (the map build fails if a path in it does not exist) |
| H10 | System map and Selah map | **built** | docs/system-map.md lists every feature, its files, roles and connections; the interactive map is built from it (37 nodes, 70 links, 123 shared files at build). A team tool, not a product screen. Source: FS 1.5, 4.10. | H9 (the map build fails if a path in it does not exist) |
| H11 | Assistant value test | **planned**: Prepared (tasks, answer keys, score sheet); the run record is empty. Time saved: not measured. | Six tasks, each done with and without the assistant, timed, by one tester. It decides which assistant features are worth building next. Source: FS 2, 5; docs/value-test.md. | I1 (measures time with and without the assistant); I11 (tasks 3 and 6 decide whether it is built) |

## 3. By side and role

Access is never decided by role alone. Selah checks the person's organisation, role, projects, assignments, the record's label and the audience picker, in the app and again in the database (HB 04; LOG, feature A). The five account roles in the code are `firm_admin`, `consultant`, `client_admin`, `client_manager` and `action_owner`. Lead, deputy and observer are what a consultant is on one client or project. Sponsor and coordinator are what a client manager (or admin) is named on one project.

Each role below has the same parts: the features they use, what they see and do not see, the home screen, the assistant, notifications, the workflow from start to end, and what changes for them in the target.

### 3.1 Firm side

#### Firm admin

**Features used.** 82 of 85 features. *full* (57): A2 People, invitations and access reviews [refine]; A4 Who sees an item (audience picker) [built]; A5 Departments [built]; A6 Client groups (holdings) [built]; A7 Audit log [refine]; A9 Erasing a person [built]; S1 Public inquiry form [built]; S2 Inquiries inbox and conflict check [refine]; S3 Pitches [built]; S4 Client record and setup [built]; S5 Participation modes (full, restricted, firm-run) [built]; S6 Expertise profiles and lead suggestions [refine]; S7 Staffing, join requests and client roles [built]; S8 Lead and deputy change with handover note [refine]; S9 Engagement record and end reminder [refine]; S10 Deliverable hand-over and receipt [built]; P1 Projects [built]; P2 Internal projects [built]; P3 Findings and recommendations [built]; P4 Plan import and export [refine]; P6 Draft and release of actions [refine]; P7 Assessments and templates [refine]; P8 Organisation structure (org chart) [refine]; P9 Assessment help [planned]; W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W3 Review, verify and second sign-off [built]; W4 Date requests and slip history [refine]; W6 Risk acceptance and closing an action [refine]; W7 Give to a colleague (owner change) [refine]; W8 Discussion, mentions and firm notes [built]; W9 Document requests and upload links [built]; W10 Files (labels, versions, scan) [built]; U3 Oversight lists and the Projects table [built]; U4 Meetings (booking, invites, agenda) [refine]; U5 Summaries, decisions and follow-ups [refine]; R1 Progress reports (templates, approval, confirmed send) [refine]; R2 Monthly status pack [built]; R3 Business indicators [refine]; R5 Indicator help [planned]; R6 Own report templates and a richer editor [planned]; I1 Staff assistant [refine]; I2 Client assistant [refine]; I3 @-attach a file [refine]; I4 Progress draft and "Use as draft" [refine]; I10 Save an answer as a note [planned]; I11 "What changed" and the meeting brief [planned]; I12 Meeting summary draft; assistant reads summaries [planned]; I13 Reference library [planned]; C1 Project closing [refine]; C3 Archiving a client (offboarding) [refine]; C4 Handing over a firm leaver's work [built]; C5 Guided renew step [planned]; C6 Reason a contract ended [planned]; C7 Pause state for a project [planned]; C8 Re-check results at 6 and 12 months [planned]; H3 Firm settings and team load [built]. *own only* (5): A1 Sign-in and accounts [built]; U1 Home (one per role) [built]; R4 Exports and PDFs [refine]; I8 Translation and file summaries on demand [built]; H2 Notifications and mail [refine]. *view* (10): A8 Legal pages and consent notices [refine]; P5 The client's answer to a recommendation [built]; W5 "I am stuck" [built]; U2 Reminders and the escalation ladder [refine]; U6 Stuck or overloaded lanes [planned]; U7 Concern flags (facts, no score) [planned]; U8 Decisions list and calendar screen [planned]; R7 The client's own report page [planned]; C2 Closing survey and case-study consent [built]; H1 Help, role guides and tooltips [built]. *applies* (10): A3 Permission core ("Not found") [refine]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; I7 Background AI jobs [built]; I9 Scanned pages (text recognition) [planned]; H4 Scheduled jobs [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine]; H8 Design rules and accessibility [refine].

**Sees.** Every client and every project. Inquiries, the team, firm settings, the audit log, legal holds, messages clients write to the firm's management.

**Does not see.** Client-private files. Work notifications for clients they neither staff nor watch.

**Home.** Decisions waiting (date requests, join requests, client comments, disputed recommendations), reviews they may give, late work, meetings, and a "Close for good" row when a project is ready for the final close (HB 06; WF 12).

**Assistant.** The staff assistant on anything they may open. The firm admin is also the one who offers the client assistant to a client, per role, with a daily question limit (HB 10).

**Notifications.** Every new inquiry. Engagement end reminders. The last escalation step, only on clients they watch. Client messages to the firm's management. Join requests. Actions with no active owner. Work notices only when staffed or watching (HB 04, 08; SM F10).

**Workflow, end to end.**
1. An inquiry arrives. Give it an owner, see the discovery and proposal steps through, clear the conflict check, record the NDA.
2. Win it into a client, or decline with an email. Winning records the signed engagement and names the lead.
3. Set up the client: mode (full, restricted, firm-run), second sign-off rule, the client assistant offer. Invite the client admin.
4. While work runs: watch a client if wanted, approve reports as the second person, decide a third date move, review on a firm-run client when nobody else can.
5. Change the lead when needed; hand over a leaver's work on Team.
6. Do the final close of each project; reopen with a reason if needed.
7. When the engagement ends: renew (a new engagement and project) or archive the client: grace period, export pack, legal holds, purges.
8. Keep the house: access reviews every 90 days, settings, the audit log, erasing a person on request.

**What changes in the target.** The end-of-engagement notice says what to do next (S9, refine). A leaving client person's owner changes reach the firm (A2, W7, refine). Stuck or overloaded lanes are shown as facts (U6, planned). A guided renew step, a reason for a contract's end and a pause state exist only as proposals (C5 to C7, planned). The go-live list is done (H5 to H7, refine).

#### Lead consultant

One per client. The accountable name (HB 04).

**Features used.** 73 of 85 features. *full* (38): A4 Who sees an item (audience picker) [built]; S3 Pitches [built]; S7 Staffing, join requests and client roles [built]; S10 Deliverable hand-over and receipt [built]; P1 Projects [built]; P2 Internal projects [built]; P3 Findings and recommendations [built]; P4 Plan import and export [refine]; P5 The client's answer to a recommendation [built]; P6 Draft and release of actions [refine]; P7 Assessments and templates [refine]; P8 Organisation structure (org chart) [refine]; P9 Assessment help [planned]; W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W3 Review, verify and second sign-off [built]; W4 Date requests and slip history [refine]; W6 Risk acceptance and closing an action [refine]; W7 Give to a colleague (owner change) [refine]; W8 Discussion, mentions and firm notes [built]; W9 Document requests and upload links [built]; W10 Files (labels, versions, scan) [built]; U3 Oversight lists and the Projects table [built]; U4 Meetings (booking, invites, agenda) [refine]; U5 Summaries, decisions and follow-ups [refine]; R1 Progress reports (templates, approval, confirmed send) [refine]; R2 Monthly status pack [built]; R3 Business indicators [refine]; R5 Indicator help [planned]; R6 Own report templates and a richer editor [planned]; I1 Staff assistant [refine]; I3 @-attach a file [refine]; I4 Progress draft and "Use as draft" [refine]; I10 Save an answer as a note [planned]; I11 "What changed" and the meeting brief [planned]; I12 Meeting summary draft; assistant reads summaries [planned]; I13 Reference library [planned]; C1 Project closing [refine]. *own only* (8): A1 Sign-in and accounts [built]; S1 Public inquiry form [built]; S2 Inquiries inbox and conflict check [refine]; S6 Expertise profiles and lead suggestions [refine]; U1 Home (one per role) [built]; R4 Exports and PDFs [refine]; I8 Translation and file summaries on demand [built]; H2 Notifications and mail [refine]. *view* (17): A2 People, invitations and access reviews [refine]; A5 Departments [built]; A6 Client groups (holdings) [built]; A8 Legal pages and consent notices [refine]; S4 Client record and setup [built]; S5 Participation modes (full, restricted, firm-run) [built]; S8 Lead and deputy change with handover note [refine]; S9 Engagement record and end reminder [refine]; W5 "I am stuck" [built]; U2 Reminders and the escalation ladder [refine]; U6 Stuck or overloaded lanes [planned]; U7 Concern flags (facts, no score) [planned]; U8 Decisions list and calendar screen [planned]; R7 The client's own report page [planned]; C2 Closing survey and case-study consent [built]; C3 Archiving a client (offboarding) [refine]; H1 Help, role guides and tooltips [built]. *applies* (10): A3 Permission core ("Not found") [refine]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; I7 Background AI jobs [built]; I9 Scanned pages (text recognition) [planned]; H4 Scheduled jobs [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine]; H8 Design rules and accessibility [refine].

**Sees.** All of that client's projects and their work, the client's structure, engagement and deliverables, the closing survey answers.

**Does not see.** Other clients, except as names in the directory. Client-private files. Firm settings and the firm's audit log.

**Home.** "Waiting on your decision": date changes, join requests, the client's comments on deliverables, suggested changes to the structure, recommendations the client disagreed with. Then reviews, late or due this week, follow-ups, meetings, and what changed since the last visit. One line of counts at the foot (FIRM 2).

**Assistant.** The staff assistant across the lead's clients or one project; follow-up drafts; the facts-only progress draft with "Use as draft".

**Notifications.** Work sent for review. Date requests. "I am stuck". Late work from the 7-day step. A client quiet for 14 days. Owner changes made with "Give to a colleague". The monthly status pack drafted. Deliverable comments. Structure suggestions and holder changes. Indicator "moved away". The engagement end reminder. A lead change, with the handover note for the new lead (HB 08; SM F15; RULES 256; LOG, feature B).

**Workflow, end to end.**
1. Named lead by the firm admin. Read the discovery notes and any handover note.
2. Build the team: add consultants to the client, staff them on projects, decide join requests. Name the client's sponsor, coordinator and acceptor.
3. Kick off: document request lists, first meetings, the plan typed or imported. Add the client's people to the project before importing the plan.
4. Release actions with an owner and a due date.
5. Run the cycle: review evidence (never own work), give the second sign-off where the rule asks, decide date requests (the third move is the lead's), follow blocked work.
6. Follow up: meetings with the automatic agenda, summaries, decisions, follow-ups.
7. Report: write or approve reports, confirm the send. Hand over deliverables and read the client's comments.
8. Publish the client's structure.
9. Start closing: a decision on every open action, lessons. The firm admin does the final close.

**What changes in the target.** A date request is declined with a reason (W4, refine). The progress draft's numbers match the project page (I4, refine). The client gets a notice when a report is sent (R1, refine). Reviews waiting on an old lead: open question 6. Lanes, the meeting brief and "what changed" are planned (U6, I11).

#### Deputy

Optional, one per client. Everything the lead can do on that client, and a copy of the lead's alerts. The lead stays the accountable name. The deputy cannot remove the lead (HB 04).

**Features used.** 72 of 85 features. *full* (38): A4 Who sees an item (audience picker) [built]; S3 Pitches [built]; S7 Staffing, join requests and client roles [built]; S10 Deliverable hand-over and receipt [built]; P1 Projects [built]; P2 Internal projects [built]; P3 Findings and recommendations [built]; P4 Plan import and export [refine]; P5 The client's answer to a recommendation [built]; P6 Draft and release of actions [refine]; P7 Assessments and templates [refine]; P8 Organisation structure (org chart) [refine]; P9 Assessment help [planned]; W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W3 Review, verify and second sign-off [built]; W4 Date requests and slip history [refine]; W6 Risk acceptance and closing an action [refine]; W7 Give to a colleague (owner change) [refine]; W8 Discussion, mentions and firm notes [built]; W9 Document requests and upload links [built]; W10 Files (labels, versions, scan) [built]; U3 Oversight lists and the Projects table [built]; U4 Meetings (booking, invites, agenda) [refine]; U5 Summaries, decisions and follow-ups [refine]; R1 Progress reports (templates, approval, confirmed send) [refine]; R2 Monthly status pack [built]; R3 Business indicators [refine]; R5 Indicator help [planned]; R6 Own report templates and a richer editor [planned]; I1 Staff assistant [refine]; I3 @-attach a file [refine]; I4 Progress draft and "Use as draft" [refine]; I10 Save an answer as a note [planned]; I11 "What changed" and the meeting brief [planned]; I12 Meeting summary draft; assistant reads summaries [planned]; I13 Reference library [planned]; C1 Project closing [refine]. *own only* (8): A1 Sign-in and accounts [built]; S1 Public inquiry form [built]; S2 Inquiries inbox and conflict check [refine]; S6 Expertise profiles and lead suggestions [refine]; U1 Home (one per role) [built]; R4 Exports and PDFs [refine]; I8 Translation and file summaries on demand [built]; H2 Notifications and mail [refine]. *view* (16): A2 People, invitations and access reviews [refine]; A5 Departments [built]; A6 Client groups (holdings) [built]; A8 Legal pages and consent notices [refine]; S4 Client record and setup [built]; S5 Participation modes (full, restricted, firm-run) [built]; S8 Lead and deputy change with handover note [refine]; S9 Engagement record and end reminder [refine]; W5 "I am stuck" [built]; U2 Reminders and the escalation ladder [refine]; U6 Stuck or overloaded lanes [planned]; U7 Concern flags (facts, no score) [planned]; U8 Decisions list and calendar screen [planned]; R7 The client's own report page [planned]; C3 Archiving a client (offboarding) [refine]; H1 Help, role guides and tooltips [built]. *applies* (10): A3 Permission core ("Not found") [refine]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; I7 Background AI jobs [built]; I9 Scanned pages (text recognition) [planned]; H4 Scheduled jobs [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine]; H8 Design rules and accessibility [refine].

**Sees and does not see.** As the lead, on that client.

**Home, assistant, notifications.** As the lead. Notices arrive as a copy of the lead's.

**Workflow, end to end.** The lead's workflow, as a full backup when the lead is away. On a lead change the deputy stays in place (WF 14).

**What changes in the target.** The same items as the lead.

#### Consultant

**Features used.** 70 of 85 features. *full* (36): A4 Who sees an item (audience picker) [built]; S3 Pitches [built]; S10 Deliverable hand-over and receipt [built]; P2 Internal projects [built]; P3 Findings and recommendations [built]; P4 Plan import and export [refine]; P5 The client's answer to a recommendation [built]; P6 Draft and release of actions [refine]; P7 Assessments and templates [refine]; P8 Organisation structure (org chart) [refine]; P9 Assessment help [planned]; W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W3 Review, verify and second sign-off [built]; W4 Date requests and slip history [refine]; W6 Risk acceptance and closing an action [refine]; W7 Give to a colleague (owner change) [refine]; W8 Discussion, mentions and firm notes [built]; W9 Document requests and upload links [built]; W10 Files (labels, versions, scan) [built]; U3 Oversight lists and the Projects table [built]; U4 Meetings (booking, invites, agenda) [refine]; U5 Summaries, decisions and follow-ups [refine]; R1 Progress reports (templates, approval, confirmed send) [refine]; R2 Monthly status pack [built]; R3 Business indicators [refine]; R5 Indicator help [planned]; R6 Own report templates and a richer editor [planned]; I1 Staff assistant [refine]; I3 @-attach a file [refine]; I4 Progress draft and "Use as draft" [refine]; I10 Save an answer as a note [planned]; I11 "What changed" and the meeting brief [planned]; I12 Meeting summary draft; assistant reads summaries [planned]; I13 Reference library [planned]; C1 Project closing [refine]. *own only* (10): A1 Sign-in and accounts [built]; S1 Public inquiry form [built]; S2 Inquiries inbox and conflict check [refine]; S6 Expertise profiles and lead suggestions [refine]; S7 Staffing, join requests and client roles [built]; P1 Projects [built]; U1 Home (one per role) [built]; R4 Exports and PDFs [refine]; I8 Translation and file summaries on demand [built]; H2 Notifications and mail [refine]. *view* (14): A2 People, invitations and access reviews [refine]; A5 Departments [built]; A6 Client groups (holdings) [built]; A8 Legal pages and consent notices [refine]; S4 Client record and setup [built]; S5 Participation modes (full, restricted, firm-run) [built]; S9 Engagement record and end reminder [refine]; W5 "I am stuck" [built]; U2 Reminders and the escalation ladder [refine]; U7 Concern flags (facts, no score) [planned]; U8 Decisions list and calendar screen [planned]; R7 The client's own report page [planned]; C3 Archiving a client (offboarding) [refine]; H1 Help, role guides and tooltips [built]. *applies* (10): A3 Permission core ("Not found") [refine]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; I7 Background AI jobs [built]; I9 Scanned pages (text recognition) [planned]; H4 Scheduled jobs [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine]; H8 Design rules and accessibility [refine].

**Sees.** Only the projects they are staffed on. A directory of other clients' names, nothing else.

**Does not see.** A client or project they are not on ("Not found"). Client-private files. Firm settings, the audit log, team load.

**Home.** Reviews they may give, late or due this week, their follow-ups, their meetings, what changed since the last visit, decisions waiting on them (FIRM 2).

**Assistant.** The staff assistant on staffed projects: questions with citations, @-attach, follow-up drafts, the progress draft with "Use as draft". Chats about a client go when the consultant is taken off it (HB 10).

**Notifications.** Work sent for review on their projects. Date requests. "I am stuck". Owner changes. Comments and mentions. Meeting invitations and follow-ups.

**Workflow, end to end.**
1. Ask to join a client with a reason, or be added by the lead. Being on the team does not open projects; being staffed does.
2. Diagnose: document requests, upload links for people without accounts, an assessment from the firm's template.
3. Write findings and recommendations. Add actions with an evidence list. Release them.
4. Review evidence: accept each item, verify or request a revision with a reason. Give the first sign-off; another consultant gives the second.
5. Decide the first two date requests. Follow blocked work. Remind an owner once a day from the rule lists.
6. Book and run meetings; write the summary, decisions and follow-ups.
7. Draft the report; a colleague approves; a person confirms the send. Enter and link indicators.
8. For a firm-run client: record the client's progress and answers, saying how and when they were given. A colleague reviews.
9. At closing: record decisions on open actions and write lessons.

**What changes in the target.** Consultants set their own expertise (S6, refine). Accepting an item and verifying become one clear step (W2, refine). The "release now" switch stops saving drafts by mistake (P6, refine). Assessment help, saved answers, scanned pages and the reference library are planned (P9, I9, I10, I13).

#### Observer

A consultant staffed on one project as "reads and comments, changes nothing" (FIRM 1). The columns in this document describe what the person does on the project they observe; elsewhere the same person is an ordinary consultant.

**Features used.** 53 of 85 features. *full* (4): I1 Staff assistant [refine]; I3 @-attach a file [refine]; I11 "What changed" and the meeting brief [planned]; I13 Reference library [planned]. *own only* (6): A1 Sign-in and accounts [built]; W8 Discussion, mentions and firm notes [built]; U1 Home (one per role) [built]; R4 Exports and PDFs [refine]; I8 Translation and file summaries on demand [built]; H2 Notifications and mail [refine]. *view* (33): A5 Departments [built]; A6 Client groups (holdings) [built]; A8 Legal pages and consent notices [refine]; S4 Client record and setup [built]; S5 Participation modes (full, restricted, firm-run) [built]; S9 Engagement record and end reminder [refine]; S10 Deliverable hand-over and receipt [built]; P1 Projects [built]; P2 Internal projects [built]; P3 Findings and recommendations [built]; P5 The client's answer to a recommendation [built]; P6 Draft and release of actions [refine]; P7 Assessments and templates [refine]; P8 Organisation structure (org chart) [refine]; W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W4 Date requests and slip history [refine]; W5 "I am stuck" [built]; W6 Risk acceptance and closing an action [refine]; W9 Document requests and upload links [built]; W10 Files (labels, versions, scan) [built]; U2 Reminders and the escalation ladder [refine]; U3 Oversight lists and the Projects table [built]; U4 Meetings (booking, invites, agenda) [refine]; U5 Summaries, decisions and follow-ups [refine]; U8 Decisions list and calendar screen [planned]; R1 Progress reports (templates, approval, confirmed send) [refine]; R2 Monthly status pack [built]; R3 Business indicators [refine]; I4 Progress draft and "Use as draft" [refine]; C1 Project closing [refine]; C3 Archiving a client (offboarding) [refine]; H1 Help, role guides and tooltips [built]. *applies* (10): A3 Permission core ("Not found") [refine]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; I7 Background AI jobs [built]; I9 Scanned pages (text recognition) [planned]; H4 Scheduled jobs [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine]; H8 Design rules and accessibility [refine].

**Sees.** Everything on that one project.

**Does not see or do.** No button that changes anything on the project, its meetings or the client's indicators. Cannot own actions, review, or edit indicators or reports.

**Home.** A consultant's home, limited to what they may open.

**Assistant.** May ask the staff assistant (the policy keeps `assistant.query` open to observers, `OPEN_TO_OBSERVERS` in `apps/web/src/authz/policy.ts`).

**Notifications.** Meeting invitations when invited. Can mute an action's mail. The full list for observers is not stated in the documents read.

**Workflow, end to end.** Staffed as observer by the lead. Reads the plan, actions, files, meetings and progress. Adds firm notes on actions. Leaves when unstaffed.

**What changes in the target.** Nothing specific to this role.

### 3.2 Client side

#### Client admin

**Features used.** 57 of 85 features. *full* (20): A2 People, invitations and access reviews [refine]; A4 Who sees an item (audience picker) [built]; A5 Departments [built]; S10 Deliverable hand-over and receipt [built]; P5 The client's answer to a recommendation [built]; P8 Organisation structure (org chart) [refine]; W6 Risk acceptance and closing an action [refine]; W7 Give to a colleague (owner change) [refine]; W8 Discussion, mentions and firm notes [built]; W9 Document requests and upload links [built]; W10 Files (labels, versions, scan) [built]; U4 Meetings (booking, invites, agenda) [refine]; R3 Business indicators [refine]; R5 Indicator help [planned]; R7 The client's own report page [planned]; I2 Client assistant [refine]; I3 @-attach a file [refine]; C1 Project closing [refine]; C2 Closing survey and case-study consent [built]; H1 Help, role guides and tooltips [built]. *own only* (9): A1 Sign-in and accounts [built]; A7 Audit log [refine]; S7 Staffing, join requests and client roles [built]; U1 Home (one per role) [built]; R4 Exports and PDFs [refine]; I4 Progress draft and "Use as draft" [refine]; I8 Translation and file summaries on demand [built]; C3 Archiving a client (offboarding) [refine]; H2 Notifications and mail [refine]. *view* (18): A6 Client groups (holdings) [built]; A8 Legal pages and consent notices [refine]; S4 Client record and setup [built]; S5 Participation modes (full, restricted, firm-run) [built]; S8 Lead and deputy change with handover note [refine]; P1 Projects [built]; P3 Findings and recommendations [built]; P7 Assessments and templates [refine]; W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W3 Review, verify and second sign-off [built]; W4 Date requests and slip history [refine]; W5 "I am stuck" [built]; U2 Reminders and the escalation ladder [refine]; U3 Oversight lists and the Projects table [built]; U5 Summaries, decisions and follow-ups [refine]; R1 Progress reports (templates, approval, confirmed send) [refine]; R2 Monthly status pack [built]. *applies* (10): A3 Permission core ("Not found") [refine]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; I7 Background AI jobs [built]; I9 Scanned pages (text recognition) [planned]; H4 Scheduled jobs [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine]; H8 Design rules and accessibility [refine].

**Sees.** All of their own company: people, departments, projects, files (including client-private ones), the company's audit log, the published structure with names.

**Does not see.** Anything of the firm: internal notes, scores, lessons, firm-only files, draft actions, other clients.

**Home.** Recommendations waiting for the company's answer, files sent back, late or stopped actions, answers to proposed dates, indicators waiting for a value, files waiting for confirmation of receipt, documents asked for, meetings to reply to, follow-ups, and "Waiting for your choice" (the assistant offer). Then progress per project and department, and the indicators (CLIENT, home).

**Assistant.** Only if the firm offered it. The client admin reads the notice, agrees for the company, and can switch it off at any time. Then: facts with sources, "who is my consultant", own deadlines, what the company's documents say (no ruling), a facts-only progress draft that stays in the chat (HB 10).

**Notifications.** An action released to an owner. The last escalation step. A lead change. Indicator "moved away" and "value due". Hand-overs to confirm. The assistant offer. Answers to date requests. "Handled" on a message to the firm's management.

**Workflow, end to end.**
1. Accept the invitation, set up two-step sign-in, accept the three notices.
2. Invite colleagues (manager, action owner, admin), add them to projects, name client roles, place people in the structure.
3. Answer each recommendation: agree, partly agree, disagree, with a reason.
4. Follow the work on Home. At a restricted client, do the work on the actions the admin owns.
5. Send documents the firm asks for. Choose how business numbers reach Selah and enter them.
6. Sign a risk acceptance when the company decides not to do something.
7. Confirm receipt of deliverables, or comment.
8. Move a leaver's actions before switching the account off. Run the access review every 90 days.
9. Ask the firm to close a project; name who carries open work on.
10. After archiving: read and download the export pack during the grace period.

**What changes in the target.** A notice when a report is sent and when the consultant changes (R1, S8, refine). Clear screens for an archived client (C3, refine). Owner changes reach the firm (W7, refine). Indicator help proposes rows to accept (R5, planned). The company's own report page (R7, planned).

#### Sponsor / manager

A client manager sees company-wide work and their own departments, on the projects they were added to. One manager (or admin) per project is named **sponsor** (HB 05).

**Features used.** 50 of 85 features. *full* (19): S10 Deliverable hand-over and receipt [built]; P5 The client's answer to a recommendation [built]; W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W4 Date requests and slip history [refine]; W5 "I am stuck" [built]; W6 Risk acceptance and closing an action [refine]; W7 Give to a colleague (owner change) [refine]; W8 Discussion, mentions and firm notes [built]; W9 Document requests and upload links [built]; U4 Meetings (booking, invites, agenda) [refine]; R3 Business indicators [refine]; R5 Indicator help [planned]; R7 The client's own report page [planned]; I2 Client assistant [refine]; I3 @-attach a file [refine]; C1 Project closing [refine]; C2 Closing survey and case-study consent [built]; H1 Help, role guides and tooltips [built]. *own only* (8): A1 Sign-in and accounts [built]; A5 Departments [built]; W10 Files (labels, versions, scan) [built]; U1 Home (one per role) [built]; R4 Exports and PDFs [refine]; I4 Progress draft and "Use as draft" [refine]; I8 Translation and file summaries on demand [built]; H2 Notifications and mail [refine]. *view* (13): A6 Client groups (holdings) [built]; A8 Legal pages and consent notices [refine]; P1 Projects [built]; P3 Findings and recommendations [built]; P7 Assessments and templates [refine]; P8 Organisation structure (org chart) [refine]; W3 Review, verify and second sign-off [built]; U2 Reminders and the escalation ladder [refine]; U3 Oversight lists and the Projects table [built]; U5 Summaries, decisions and follow-ups [refine]; R1 Progress reports (templates, approval, confirmed send) [refine]; R2 Monthly status pack [built]; C3 Archiving a client (offboarding) [refine]. *applies* (10): A3 Permission core ("Not found") [refine]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; I7 Background AI jobs [built]; I9 Scanned pages (text recognition) [planned]; H4 Scheduled jobs [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine]; H8 Design rules and accessibility [refine].

**Sees.** Company-wide work and their own departments' work. Shared files. Sent reports. Names in their own branch of the structure and above.

**Does not see.** Other departments' work. A whole-project meeting, if department-limited. Firm-only items. Draft actions. The company's audit log.

**Home.** As the client admin's, for what the manager may open.

**Assistant.** If the firm offered it to managers and the client admin agreed.

**Notifications.** Late work from the 7-day step. As sponsor: the last escalation step (HB 08). Date answers, send-backs, meeting invitations, follow-ups.

**Workflow, end to end.**
1. Invited by the client admin and added to projects.
2. As sponsor: answer recommendations for the client.
3. Work actions: start, send evidence, say "I am stuck", ask for more time, comment.
4. Give an action to a colleague. Sign a risk acceptance.
5. Book shared meetings; do follow-ups.
6. Enter business numbers.
7. As sponsor: receive the last escalation step; confirm receipt of deliverables when no acceptor or admin does; ask the firm to close; name who carries on each handed-over action.

**What changes in the target.** A decline of a date request carries a reason (W4, refine). The Meetings tab shows meetings a limited manager is invited to (U4, refine). What happens when the sponsor leaves: open question 9.

#### Coordinator

The day-to-day contact for a project. Same powers as a manager. One per project (HB 05).

**Features used.** 50 of 85 features. *full* (16): W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W4 Date requests and slip history [refine]; W5 "I am stuck" [built]; W6 Risk acceptance and closing an action [refine]; W7 Give to a colleague (owner change) [refine]; W8 Discussion, mentions and firm notes [built]; W9 Document requests and upload links [built]; U4 Meetings (booking, invites, agenda) [refine]; R3 Business indicators [refine]; R5 Indicator help [planned]; R7 The client's own report page [planned]; I2 Client assistant [refine]; I3 @-attach a file [refine]; C2 Closing survey and case-study consent [built]; H1 Help, role guides and tooltips [built]. *own only* (8): A1 Sign-in and accounts [built]; A5 Departments [built]; W10 Files (labels, versions, scan) [built]; U1 Home (one per role) [built]; R4 Exports and PDFs [refine]; I4 Progress draft and "Use as draft" [refine]; I8 Translation and file summaries on demand [built]; H2 Notifications and mail [refine]. *view* (16): A6 Client groups (holdings) [built]; A8 Legal pages and consent notices [refine]; S10 Deliverable hand-over and receipt [built]; P1 Projects [built]; P3 Findings and recommendations [built]; P5 The client's answer to a recommendation [built]; P7 Assessments and templates [refine]; P8 Organisation structure (org chart) [refine]; W3 Review, verify and second sign-off [built]; U2 Reminders and the escalation ladder [refine]; U3 Oversight lists and the Projects table [built]; U5 Summaries, decisions and follow-ups [refine]; R1 Progress reports (templates, approval, confirmed send) [refine]; R2 Monthly status pack [built]; C1 Project closing [refine]; C3 Archiving a client (offboarding) [refine]. *applies* (10): A3 Permission core ("Not found") [refine]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; I7 Background AI jobs [built]; I9 Scanned pages (text recognition) [planned]; H4 Scheduled jobs [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine]; H8 Design rules and accessibility [refine].

**Sees and does not see.** As a manager.

**Home, assistant, notifications.** As a manager. As a manager, the coordinator is on the ladder's 7-day step. The last step goes to the sponsor and the client admins, not to the coordinator.

**Workflow, end to end.** The manager's workflow without the sponsor's parts: works actions, sends evidence, gives actions to colleagues, signs risk acceptances, books shared meetings, enters numbers, keeps the project moving day to day.

**What changes in the target.** The same items as a manager.

#### Action owner

**Features used.** 31 of 85 features. *full* (1): H1 Help, role guides and tooltips [built]. *own only* (17): A1 Sign-in and accounts [built]; P3 Findings and recommendations [built]; P8 Organisation structure (org chart) [refine]; W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W4 Date requests and slip history [refine]; W5 "I am stuck" [built]; W7 Give to a colleague (owner change) [refine]; W8 Discussion, mentions and firm notes [built]; W9 Document requests and upload links [built]; W10 Files (labels, versions, scan) [built]; U1 Home (one per role) [built]; U4 Meetings (booking, invites, agenda) [refine]; U5 Summaries, decisions and follow-ups [refine]; R4 Exports and PDFs [refine]; I8 Translation and file summaries on demand [built]; H2 Notifications and mail [refine]. *view* (4): A8 Legal pages and consent notices [refine]; W3 Review, verify and second sign-off [built]; U2 Reminders and the escalation ladder [refine]; C3 Archiving a client (offboarding) [refine]. *applies* (9): A3 Permission core ("Not found") [refine]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; I7 Background AI jobs [built]; H4 Scheduled jobs [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine]; H8 Design rules and accessibility [refine].

**Sees.** Only their own actions, files shared with them, and their department teammates' files. The recommendation behind their own actions. Meetings they are invited to, with only their own actions on the agenda. "Your manager" from the structure.

**Does not see.** Other people's actions, or how many there are. The project as a whole. Reports. The assistant.

**Home.** Three groups: Waiting for you, With your consultant, Finished. Then documents asked of them, meetings and follow-ups (CLIENT, home).

**Assistant.** None. The client assistant is never available to action owners.

**Notifications.** A new action. A reminder before the due date, and when overdue. The review decision. The answer to a date request. A "give to a colleague" change. Mentions. Meeting invitations.

**Workflow, end to end.**
1. Accept the invitation; sign in with a password or a one-time link by email.
2. Open the action; read the Next step card; press Start work.
3. Send evidence for review, item by item.
4. If stuck, say so with a reason. If the date will not hold, ask for more time with a reason.
5. If sent back, read the reason and send the revised file in one step.
6. Verified: done. Or the firm closes the action with an outcome.
7. Give the action to a colleague where allowed.

**What changes in the target.** "Start work" on Home starts the work, or is labelled "Open" (W1, refine). A decline of a date request carries a reason (W4, refine).

#### Firm-run clients (no accounts)

The client has no accounts at all. The consultant records everything for it. Used for family offices and clients who will not log in (HB 05).

**Features used.** 17 of 85 features. *through the firm* (10): S10 Deliverable hand-over and receipt [built]; P5 The client's answer to a recommendation [built]; W1 Actions (the working cycle) [refine]; W2 Evidence and evidence items [refine]; W3 Review, verify and second sign-off [built]; W9 Document requests and upload links [built]; W10 Files (labels, versions, scan) [built]; U4 Meetings (booking, invites, agenda) [refine]; R3 Business indicators [refine]; H2 Notifications and mail [refine]. *applies* (7): A3 Permission core ("Not found") [refine]; S5 Participation modes (full, restricted, firm-run) [built]; I5 Search index, masking and the AI service [refine]; I6 Personal-number scanner [built]; H5 Backups, restore and monitoring [refine]; H6 Deployment [refine]; H7 Pre-go-live clean-up script [refine].

**Sees.** Nothing in Selah. A contact without an account can receive a calendar invitation and a no-login upload link for one requested item by email. Only the firm sees the contact list.

**Home, assistant.** None.

**Notifications.** Email only: meeting invitations, and upload links the consultant sends.

**Workflow, end to end.**
1. The firm admin sets the mode to firm-run on the client's Setup tab.
2. The firm records contacts; a contact can be named owner of an action.
3. The consultant records the client's answer to each recommendation, with how and when it was given; a colleague confirms it before it counts.
4. The consultant records progress and sends evidence for the client, marked "recorded by a consultant" with how and when they heard (email, meeting, phone).
5. A second firm person reviews. If nobody else is on the team, the firm admin reviews.
6. The consultant records receipt of deliverables and enters the business figures.
7. Closing and archiving run on the firm side only.

**What changes in the target.** The reviewer text says "ask a colleague to review" when nobody else is on the team (WF Part B). How a risk acceptance is recorded for a client with no accounts: open question 32.

## 4. Feature by role

Every feature of the handbook, the map (`docs/system-map.md`, F01 to F30 and their sub-features) and `docs/review/final-status.md`, plus the planned ones. One row each.

**Cell words.** **full**: does the work of the feature. **own only**: only their own items (their own actions, account, profile, files). **view**: reads, does not change. **none**: no access. **applies**: not a screen; the rule or service covers this role. **through the firm**: the person has no account; the firm records it for them, or it reaches them by email or link. A note in brackets narrows the cell. The Observer column describes the project the person observes.

The status column applies to the whole row. For a **planned** row the cells say who is meant to use it, as far as our documents say.

| Id | Feature | Status | Firm admin | Lead | Deputy | Consultant | Observer | Client admin | Sponsor / manager | Coordinator | Action owner | Firm-run (no accounts) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | **Access and privacy** | |  |  |  |  |  |  |  |  |  |  |
| A1 | Sign-in and accounts | built | own only | own only | own only | own only | own only | own only | own only | own only | own only | none |
| A2 | People, invitations and access reviews | refine | full | view (the firm list they may see) | view (the firm list they may see) | view (the firm list they may see) | none | full (own company) | none | none | none | none |
| A3 | Permission core ("Not found") | refine | applies | applies | applies | applies | applies | applies | applies | applies | applies | applies |
| A4 | Who sees an item (audience picker) | built | full | full | full | full (firm items they manage) | none | full (the client's own items; client people only) | none | none | none | none |
| A5 | Departments | built | full | view | view | view | view | full | own only (own departments) | own only (own departments) | none (limited by it; no screen) | none |
| A6 | Client groups (holdings) | built | full | view | view | view (member clients they are on) | view | view (if the firm grants it) | view (if the firm grants it) | view (if the firm grants it) | none | none |
| A7 | Audit log | refine | full | none | none | none | none | own only (own company's trail) | none | none | none | none |
| A8 | Legal pages and consent notices | refine | view | view | view | view | view | view | view | view | view | none |
| A9 | Erasing a person | built | full | none | none | none | none | none | none | none | none | none |
| | **Winning and setting up a client** | |  |  |  |  |  |  |  |  |  |  |
| S1 | Public inquiry form | built | full (told of every new inquiry) | own only (enters referrals) | own only (enters referrals) | own only (enters referrals) | none | none | none | none | none | none |
| S2 | Inquiries inbox and conflict check | refine | full (wins or declines) | own only (inquiries they own) | own only (inquiries they own) | own only (inquiries they own) | none | none | none | none | none | none |
| S3 | Pitches | built | full (also makes it a client) | full | full | full | none | none | none | none | none | none |
| S4 | Client record and setup | built | full | view (own clients) | view (own clients) | view (clients they are on) | view | view (own company) | none | none | none | none |
| S5 | Participation modes (full, restricted, firm-run) | built | full | view | view | view | view | view | none | none | none | applies (this is their mode) |
| S6 | Expertise profiles and lead suggestions | refine | full | own only (own profile (target; today only the admin can)) | own only (own profile (target; today only the admin can)) | own only (own profile (target; today only the admin can)) | none | none | none | none | none | none |
| S7 | Staffing, join requests and client roles | built | full | full | full | own only (asks to join) | none | own only (adds own people to projects) | none | none | none | none |
| S8 | Lead and deputy change with handover note | refine | full | view (told; the new lead gets the note) | view (stays in place) | none | none | view (told) | none | none | none | none |
| S9 | Engagement record and end reminder | refine | full | view (reminded) | view (reminded) | view (opens it to hand over) | view | none | none | none | none | none |
| S10 | Deliverable hand-over and receipt | built | full | full | full | full (if staffed) | view | full (confirms when no acceptor is named) | full (confirms as acceptor, or when there is no acceptor and no admin) | view | none | through the firm (the consultant records receipt (LOG, 4a)) |
| | **The plan** | |  |  |  |  |  |  |  |  |  |  |
| P1 | Projects | built | full | full | full | own only (staffed projects only) | view | view | view (projects they are added to) | view (projects they are added to) | none (sees own actions, not the project) | none |
| P2 | Internal projects | built | full (sees all) | full (if creator or staffed) | full (if creator or staffed) | full (if creator or staffed) | view (if staffed as observer) | none | none | none | none | none |
| P3 | Findings and recommendations | built | full | full | full | full | view | view | view | view | own only (only the recommendation behind own actions; no titles or counts of others) | none |
| P4 | Plan import and export | refine | full | full | full | full | none | none | none | none | none | none |
| P5 | The client's answer to a recommendation | built | view | full (may answer once) | full (may answer once) | full (may answer once) | view | full | full (the sponsor answers; other managers view) | view | none | through the firm (the consultant records it; a colleague confirms) |
| P6 | Draft and release of actions | refine | full | full | full | full | view | none | none | none | none | none |
| P7 | Assessments and templates | refine | full | full | full | full | view | view (only what the firm shares; never scores) | view (only what the firm shares; never scores) | view (only what the firm shares; never scores) | none | none |
| P8 | Organisation structure (org chart) | refine | full | full | full | full (edits the draft; cannot publish) | view | full (places people, suggests changes) | view (names in own branch and above) | view (names in own branch and above) | own only ("your manager" only) | none |
| P9 | Assessment help | planned | full | full | full | full (accepts, changes or rejects each draft) | none | none | none | none | none | none |
| | **The action cycle** | |  |  |  |  |  |  |  |  |  |  |
| W1 | Actions (the working cycle) | refine | full | full | full | full | view (reads; may add a firm note) | view (works actions only at a restricted client) | full (company-wide work and own departments) | full (company-wide work and own departments) | own only (own actions; no counts of others) | through the firm (the consultant records progress, marked "recorded by a consultant") |
| W2 | Evidence and evidence items | refine | full | full | full | full | view | view (sends only at a restricted client) | full | full | own only (own actions) | through the firm (the consultant sends the file, saying how and when the client gave it) |
| W3 | Review, verify and second sign-off | built | full (also when nobody else on a firm-run client can) | full | full | full (never own work) | none | view (told the decision) | view (told the decision) | view (told the decision) | view (told the decision) | through the firm (a second firm person must review) |
| W4 | Date requests and slip history | refine | full (decides a third move) | full (decides a third move) | full | full (decides the first two) | view | view (sees the answers) | full (asks) | full (asks) | own only (asks on own actions) | none |
| W5 | "I am stuck" | built | view | view (told) | view (told) | view (told when on the project) | view | view | full | full | own only (own actions) | none |
| W6 | Risk acceptance and closing an action | refine | full (closes the action) | full (closes the action) | full (closes the action) | full (closes the action) | view | full (signs) | full (signs) | full (signs) | none | none (not stated in the sources) |
| W7 | Give to a colleague (owner change) | refine | full | full | full | full | none | full | full | full | own only (own actions, where allowed) | none (the firm names the owner on the action) |
| W8 | Discussion, mentions and firm notes | built | full | full | full | full | own only (firm notes only) | full | full | full | own only (own actions) | none |
| W9 | Document requests and upload links | built | full | full | full | full | view | full | full | full | own only (when asked by name) | through the firm (answers through a no-login upload link) |
| W10 | Files (labels, versions, scan) | built | full (never client-private files) | full | full | full | view | full | own only (company-wide and own department) | own only (company-wide and own department) | own only (own, shared with them, department teammates') | through the firm (uploads by link only) |
| | **Follow-up and meetings** | |  |  |  |  |  |  |  |  |  |  |
| U1 | Home (one per role) | built | own only | own only | own only | own only | own only | own only | own only | own only | own only | none |
| U2 | Reminders and the escalation ladder | refine | view (only if staffed or watching) | view (from the 7-day step) | view | view | view | view (at the last step) | view (managers at 7 days; the sponsor at the last step) | view (at the 7-day step) | view (own actions) | none |
| U3 | Oversight lists and the Projects table | built | full | full | full | full | view (no "Remind the owner") | view (Late and Blocked only) | view (Late and Blocked only) | view (Late and Blocked only) | none | none |
| U4 | Meetings (booking, invites, agenda) | refine | full | full | full | full | view | full (books shared meetings) | full (books shared meetings; no whole-project meeting if department-limited) | full (books shared meetings) | own only (meetings they are invited to; own actions on the agenda) | through the firm (calendar invitation by email) |
| U5 | Summaries, decisions and follow-ups | refine | full | full | full | full | view | view (shared summaries; own follow-ups) | view (shared summaries; own follow-ups) | view (shared summaries; own follow-ups) | own only (own follow-ups) | none |
| U6 | Stuck or overloaded lanes | planned | view | view | view (as the lead (the deputy can do what the lead can)) | none | none | none | none | none | none | none |
| U7 | Concern flags (facts, no score) | planned | view | view | view | view | none | none | none | none | none | none |
| U8 | Decisions list and calendar screen | planned | view | view | view | view | view | none (not decided) | none | none | none | none |
| | **Reports and numbers** | |  |  |  |  |  |  |  |  |  |  |
| R1 | Progress reports (templates, approval, confirmed send) | refine | full (approves) | full (approves) | full (approves) | full (writes; a colleague approves) | view | view (reads once sent) | view (reads once sent; shared work only) | view (reads once sent; shared work only) | none | none |
| R2 | Monthly status pack | built | full | full (told when it is drafted) | full | full | view | view (reads once sent) | view (reads once sent) | view (reads once sent) | none | none |
| R3 | Business indicators | refine | full | full | full | full (enters, links, checks) | view | full (chooses how numbers arrive; enters values) | full (enters values) | full (enters values) | none | through the firm (the firm enters the figures) |
| R4 | Exports and PDFs | refine | own only | own only | own only | own only | own only | own only | own only | own only | own only | none |
| R5 | Indicator help | planned | full (confirms links) | full (confirms links) | full (confirms links) | full (confirms links) | none | full (accepts each value) | full (accepts each value) | full (accepts each value) | none | none |
| R6 | Own report templates and a richer editor | planned | full | full | full | full | none | none | none | none | none | none |
| R7 | The client's own report page | planned | view (only if the client shares it) | view (only if the client shares it) | view (only if the client shares it) | view (only if the client shares it) | none | full | full | full | none | none |
| | **The assistant** | |  |  |  |  |  |  |  |  |  |  |
| I1 | Staff assistant | refine | full | full (own clients) | full (own clients) | full (staffed projects only) | full (the project they observe (policy: OPEN_TO_OBSERVERS)) | none | none | none | none | none |
| I2 | Client assistant | refine | full (offers it; sets the daily limit) | none | none | none | none | full (must agree; can switch it off) | full (if offered and agreed) | full (if offered and agreed) | none | none |
| I3 | @-attach a file | refine | full | full | full | full | full | full | full | full | none | none |
| I4 | Progress draft and "Use as draft" | refine | full | full | full | full | view (can ask; does not edit reports (not checked in code)) | own only (stays in own chat) | own only (stays in own chat) | own only (stays in own chat) | none | none |
| I5 | Search index, masking and the AI service | refine | applies | applies | applies | applies | applies | applies | applies | applies | applies | applies |
| I6 | Personal-number scanner | built | applies | applies | applies | applies | applies | applies | applies | applies | applies | applies |
| I7 | Background AI jobs | built | applies | applies | applies | applies | applies | applies | applies | applies | applies | none |
| I8 | Translation and file summaries on demand | built | own only | own only | own only | own only | own only | own only | own only | own only | own only | none |
| I9 | Scanned pages (text recognition) | planned | applies | applies | applies | applies | applies | applies | applies | applies | none | none |
| I10 | Save an answer as a note | planned | full | full | full | full | none | none | none | none | none | none |
| I11 | "What changed" and the meeting brief | planned | full | full | full | full | full | none | none | none | none | none |
| I12 | Meeting summary draft; assistant reads summaries | planned | full | full | full | full | none | none | none | none | none | none |
| I13 | Reference library | planned | full | full | full | full | full | none (not decided) | none | none | none | none |
| | **Closing and leaving** | |  |  |  |  |  |  |  |  |  |  |
| C1 | Project closing | refine | full (final close and reopen) | full (starts closing) | full (starts closing) | full (decisions on open actions and lessons (policy closure.dispose, closure.lessons)) | view | full (asks to close; names who carries work on) | full (asks to close; names who carries work on) | view | none | none |
| C2 | Closing survey and case-study consent | built | view (reads the answers) | view (reads the answers) | none | none | none | full (answers if asked; consent) | full (answers if asked; consent) | full (answers if asked; consent) | none | none |
| C3 | Archiving a client (offboarding) | refine | full | view | view | view | view | own only (reads and downloads the export pack in the grace period) | view (read-only in the grace period) | view (read-only in the grace period) | view (read-only in the grace period) | none |
| C4 | Handing over a firm leaver's work | built | full | none | none | none | none | none | none | none | none | none |
| C5 | Guided renew step | planned | full | none | none | none | none | none | none | none | none | none |
| C6 | Reason a contract ended | planned | full | none | none | none | none | none | none | none | none | none |
| C7 | Pause state for a project | planned | full | none | none | none | none | none | none | none | none | none |
| C8 | Re-check results at 6 and 12 months | planned | full | none | none | none | none | none | none | none | none | none |
| | **Help, notices and platform** | |  |  |  |  |  |  |  |  |  |  |
| H1 | Help, role guides and tooltips | built | view (also reads messages to the firm's management and marks them handled) | view | view | view | view | full | full | full | full | none |
| H2 | Notifications and mail | refine | own only (work notices only when staffed or watching) | own only | own only (a copy of the lead's alerts) | own only | own only | own only | own only | own only | own only | through the firm (calendar invitations and upload links by email only) |
| H3 | Firm settings and team load | built | full | none | none | none | none | none | none | none | none | none |
| H4 | Scheduled jobs | built | applies | applies | applies | applies | applies | applies | applies | applies | applies | none |
| H5 | Backups, restore and monitoring | refine | applies | applies | applies | applies | applies | applies | applies | applies | applies | applies |
| H6 | Deployment | refine | applies | applies | applies | applies | applies | applies | applies | applies | applies | applies |
| H7 | Pre-go-live clean-up script | refine | applies | applies | applies | applies | applies | applies | applies | applies | applies | applies |
| H8 | Design rules and accessibility | refine | applies | applies | applies | applies | applies | applies | applies | applies | applies | none |
| H9 | Tests and scenarios | refine | none | none | none | none | none | none | none | none | none | none |
| H10 | System map and Selah map | built | none | none | none | none | none | none | none | none | none | none |
| H11 | Assistant value test | planned | none | none | none | none | none | none | none | none | none | none |

## 5. Bumps

Each bump has three lines. **Today** is what the product does now. **Should** is the target: only what our documents already plan or propose; where nothing is decided it points to an open question (section 6). **Gap** is the difference.

### 5.1 The client ends the contract early

- **Today.** The sponsor or client admin presses "Ask the firm to close" on the project. The lead or deputy starts closing; every open action gets a decision (handed over, deferred, withdrawn, waived); the firm admin closes. The reason goes in the closing notes. When every project is closed the firm admin can archive the client: grace period, export pack, legal holds (WF 12, 13).
- **Should.** The same flow, plus a record of why the engagement ended (C6, planned, a proposal).
- **Gap.** No termination record (PP 4, "no record of why it ended"). Who records the reason and who sees it: question 1.

### 5.2 The client pauses the work

- **Today.** No pause. A project is planned, draft, active, closing or closed (`project_state` in `apps/web/src/db/schema/app.ts`). Reminders and the ladder keep running. A person can mute an action's mail. Dates can be moved one request at a time.
- **Should.** A pause state is a proposal (C7, planned). What it stops is not decided: question 2.
- **Gap.** During a real pause, late notices and escalations would keep going to the client.

### 5.3 The client cuts scope

- **Today.** The firm withdraws a recommendation with a reason, or closes actions as "not applicable" or "replaced by another action". Released items are never deleted. One project per phase or scope; a project can be closed on its own (HB 08; WF 5).
- **Should.** Not decided beyond today's tools: question 3.
- **Gap.** The engagement record and its deliverables list do not record that the scope changed or who agreed.

### 5.4 The client does not pay

- **Today.** Nothing. Selah is not an invoicing or finance system (LIMITS 6). Pricing and invoicing stay outside (`docs/handbook/en.md`).
- **Should.** Not decided: question 4.
- **Gap.** None in the product unless the firm wants Selah to react.

### 5.5 A consultant falls short

- **Today.** Selah never scores or ranks people. Facts exist: team load (reviews and work per consultant), "Reviews waiting over 7 days", the rule lists. The client can write to the firm's management from Help; only firm admins read it. The lead or admin can take a consultant off a project once they own no open actions there (HB 04, 06).
- **Should.** Stuck or overloaded lanes shown as facts to the firm admin or lead, who decide (U6, planned). Still no score.
- **Gap.** How the firm wants to notice and handle it, and who sees the facts: question 5.

### 5.6 A consultant leaves or is replaced

- **Today.** The admin opens the person on Team. Selah lists what they hold (open actions, clients they lead, reviews only they can do, client roles) and hands it to one colleague in one step. Switching the account off is refused until then. A suspended person is locked out at once (HB 04; WF Part B).
- **Should.** As today.
- **Gap.** None found in the scenarios (scenario 6 passed).

### 5.7 The lead changes

- **Today.** The firm admin changes the lead in one step. The client's admins and the old lead are told, and a handover note (up to 4,000 characters, RULES) goes to the new lead. The deputy and staffed consultants stay.
- **Should.** As today, and the client clearly sees the change (S8, refine).
- **Gap.** Scenarios 6 and 7 found the client is not told on screen when her consultant changes; only Help shows it (FS 5). Reviews waiting on the old lead are not moved automatically (PP 4): question 6.

### 5.8 The client asks to change consultant

- **Today.** No button. The client tells the firm by email or from Help ("Write to the firm's management" reaches only firm admins). The firm admin changes the lead (HB 04).
- **Should.** Not decided beyond today's route: question 7.
- **Gap.** The request and its outcome are not recorded as such; the only reply the Help message gets is "Handled" (GATEB B9).

### 5.9 Renewal and follow-on projects

- **Today.** A bell notice to the lead, deputy and firm admins from 30 days before the end date until 30 days after (PP 4). To renew: record a new signed engagement and open a new project that continues the earlier one (WF 13).
- **Should.** The notice says what to do next (S9, refine). A guided renew step that carries open actions is a proposal (C5, planned).
- **Gap.** Open actions do not carry over by themselves. Which ones carry, and who decides: question 8.

### 5.10 An action owner or the sponsor leaves

- **Today.** The client admin switches the person off and moves their actions in the dialog. A person cannot be removed from a project while they own open actions. Actions with no active owner raise a firm notice and appear on the "No active owner" list. The client admin or the lead can name a new sponsor (`client_role.manage` in `apps/web/src/authz/policy.ts`).
- **Should.** The old owner, the lead and the project's consultants are told, and the history shows "owner changed" (W7, A2, refine).
- **Gap.** Only the new owner is told (scenario 9). The dialog mentions a temporary head with no control. Who gets the last escalation step while there is no sponsor: question 9. Who must be told: question 10.

### 5.11 A restructured department

- **Today.** Two separate tools. Departments decide who sees work; open work can move between departments (SM F05). The structure (org chart) describes positions; the firm publishes a new version; the client admin places people. A unit may link to a department as a label, and a head mismatch becomes a suggestion a person confirms. The chart never changes access (HB 13).
- **Should.** The same separation. Whether publishing a new structure should prompt a review of departments and owners: question 11.
- **Gap.** After a restructure, someone must update departments and action owners by hand; nothing prompts it.

### 5.12 A disputed review

- **Today.** A consultant requests a revision with a reason. The owner reads it, replies in the discussion and sends again. Where the rule asks, a second consultant signs off. The firm can reopen verified work with a reason. A concern can go to the firm's management from Help. A client's disagreement with a recommendation is a separate, built flow.
- **Should.** Not decided: question 12.
- **Gap.** No step for "the client disagrees with the review decision": no second opinion, no time limit, no record apart from the discussion.

### 5.13 Late, missing or conflicting evidence

- **Today.** Late: the ladder (5.14). Missing: an action cannot become Verified while any evidence item is open; the reviewer marks an item "Not accepted" with what is missing, or "Not needed" with why. Wrong file: the uploader withdraws it with a reason; evidence itself is never deleted, the reviewer returns it. Conflicting: versions are kept; the assistant names two versions that disagree instead of picking one (HB 09, 10, 18).
- **Should.** Accepting an item and verifying become one clear step (W2, refine).
- **Gap.** No written rule for which file stands when two conflict (question 13), or for evidence that arrives after an action or project is closed (question 14).

### 5.14 Escalating overdue work

- **Today.** A reminder before the due date. The owner when overdue. Managers and the lead after 7 days. Client admins, the sponsor and watching firm admins after 14 days. One summary mail a day at most. The days are set on each project. After 14 days with no activity the lead is told. A consultant can remind an owner once a day. Date requests: the third move needs the lead or admin (HB 08).
- **Should.** A decline of a date request carries a reason (W4, refine). Held weekend mail says it is held (U2, H2, refine).
- **Gap.** Decline has no reason box and cannot be undone (scenario 5): question 15. Nothing is defined after the last step: question 16.

### 5.15 The assistant is wrong or down

- **Today, wrong.** Every answer names its source; the limits page says to open the source before relying on an answer. The assistant never approves, closes, changes or sends anything, so a wrong answer cannot change the record. Measured on 20 answers: 10 right, 3 partly right, 6 wrong, 1 not finished; a scanned page produced a confident invented answer (FS 4.4). The progress draft's numbers disagreed with the project page once (scenario 13).
- **Today, down or slow.** The work cycle does not use the assistant. Slow work runs as jobs; the card says "Still working"; ceilings are 10 minutes (FS 1.4). Median answer time 117 s on the test laptop's processor; on the production server: not measured (FS 4.1, 4.2). Selah can run with the assistant off (`--no-ai`, FS 7).
- **Should.** Draft numbers match the page (I4). A skipped attachment is named (I3). An echo answer is not shown as grounded (I1). Scanned pages are read (I9, planned).
- **Gap.** No way to report a wrong answer and no record of one: question 17. Whether a minute per answer is acceptable on the firm's server: question 18. A reranker was not built: the test set gave no evidence for it (FS 5).

### 5.16 A wrong-client upload, or a breach

- **Today.** The uploader withdraws the file with a reason; the name of a withdrawn private file no longer shows to the other side. If someone saw data they should not, the breach runbook applies: tell the firm admin, open the incident register (kept outside Selah), switch off accounts, keep the evidence, export the audit log, tell each client affected, and notify SDAIA within 72 hours for the firm's own data when people may be harmed; for client data the client decides and notifies with the firm's help (OPS, "A personal-data breach").
- **Should.** As the runbook says, once counsel has reviewed it.
- **Gap.** The data processing agreement's time to tell the client is a placeholder, "[24] hours" (OPS). The legal texts are not reviewed (PP 1). Whether every wrong-client upload counts as a breach: question 19.

### 5.17 Data deletion and the end of retention

- **Today.** A person can be erased on request: the name becomes "Former user #n", history stays (HB 18). An archived client is read-only for a grace period (0 to 90 days, default 60; `GRACE_DAYS` in `apps/web/src/lib/offboarding.ts`), then kept ten years (`RETENTION_YEARS`), then the daily job deletes it unless a legal hold stands and keeps a deletion record (RULES). Assistant chats are deleted 90 days after a project closes or after 180 idle days; transcripts 30 days after the summary is confirmed (`docs/firm-settings.md`). Minimal-records clients have free text cleared 90 days after handover.
- **Should.** The same machinery with periods the firm and its counsel confirm.
- **Gap.** Retention and duties are not confirmed by a lawyer (PP 1): question 20. A client asking for deletion before the period ends: question 21. Backups taken before the pre-go-live clean-up still hold private file names (PP 5A).

### 5.18 Planned automation: KPIs, governance assessments, workflow lanes

- **Today.** None of the three is built. What exists: typed, imported or connected indicator values and a rule-based "moved away" notice with figures only; assessments answered by a consultant; rule lists and team load as counts (HB 12, 18).
- **Should.** Indicator help proposes rows from a spreadsheet, a flag and a likely link; the client accepts each value and only the firm confirms a link (R5). Assessment help suggests a draft answer and score with citations; a consultant accepts, changes or rejects it (P9). Lanes show facts to the admin or lead (U6). All three suggest and a person decides; none uses a new model (LATER).
- **Gap.** The order is set (no-model items first; assessment help last). The data to keep now is named. Open: which sources clients allow (question 23), the firm's own template (question 24), what counts as "stuck" (question 25). "Workflow lanes" here means spotting stuck work from action history. It is not automation of the client's procedures.

### 5.19 The reference library

- **Today.** Not built. 18 reference-library questions are already in the labelled test set (FS 6).
- **Should.** Six sources kept as a separate "reference" source, never mixed with a client's files. Every citation says "Reference" with the source, edition and place. The two copyrighted books are held as the firm's short notes only (LATER 5).
- **Gap.** A licence check of each source comes first. Editions must be chosen. Whether the client assistant may cite it: question 27.

### 5.20 The path to production

- **Today.** Not deployed. The tunnel was never tested live. No staging server. Backups and monitoring are built, not proven. Legal texts are not reviewed. No outside penetration test. Page times on a production build: not measured (PP 1; FS 4.8).
- **Should.** In order (PP 5): finish the isolation sweep, write the scenario report with an independent re-run of every failed step, stop at Gate C; then the 11-step go-live checklist (size the end reminders, run the clean-up script, test the tunnel, plan the 0112 search rewrite and the 0114 re-index, switch to the direct way in, set the mail domain, prove backups, write the real-client rule, have the legal texts reviewed, run 0115 with the app stopped); then the after-scenarios list.
- **Gap.** Every checklist item is "Open". Estimates to plan with: about 4 minutes per 100,000 passages for 0112 (measured on the laptop); about 3.5 hours per 10,000 files for 0114 (a reviewer's estimate, not a measurement) (FS 4.3, 4.5). Decisions: questions 22, 28 to 31 and 34.

## 6. Open questions

These are decisions for the firm or the client. Our documents do not settle them, so this document does not either. "Firm" means the consulting firm that runs Selah. "Counsel" means the firm's lawyer.

| # | Question | Who decides |
|---|---|---|
| 1 | When a contract ends early, should Selah record why? Who records the reason, and who may read it? | Firm |
| 2 | Is a pause needed? If so: who may pause a project, do reminders and the escalation ladder stop, does the client keep access, and is there a time limit? | Firm, agreed with the client |
| 3 | How should a cut in scope be recorded? Today the firm withdraws recommendations and closes actions as "not applicable". Should the engagement and its deliverables list show the change, and must the client confirm it? | Firm and client |
| 4 | Selah has no invoicing. Should anything in Selah change when a client does not pay, for example its access? | Firm, with counsel |
| 5 | Selah never scores or ranks people. How does the firm want to notice and handle a consultant who falls short, and who may see the facts (team load, waiting reviews, lanes)? | Firm |
| 6 | When the lead changes, should reviews waiting on the old lead move to the new lead automatically, or stay for the firm admin to hand over? | Firm |
| 7 | When a client wants a different consultant: keep the request outside Selah (a Help message, as today), or record it and its outcome? Who at the client may ask? | Firm; the client for who may ask |
| 8 | At renewal, which open actions carry into the follow-on project, and who decides: the lead, the sponsor, or both? | Firm and client |
| 9 | When the sponsor leaves: must a project always have a sponsor, and who gets the last escalation step until a new one is named? | Client names the person; firm sets the rule |
| 10 | When a client person leaves and their actions are moved, who must be told: the old owner, the lead, the project's consultants? | Firm |
| 11 | When a new structure is published after a restructure, should Selah prompt a review of departments and action owners? Who does that review? | Firm for the prompt; client admin for its people |
| 12 | If the client disagrees with a review decision ("revision requested", or a refusal to verify): is there a second opinion, who gives it, and within what time? | Firm |
| 13 | When two pieces of evidence conflict, which one stands, and who decides? | Firm |
| 14 | Evidence that arrives after an action or a project is closed: reopen and review it, or leave the record closed? | Firm |
| 15 | Declining a date request: must a reason be required, may a meeting be offered, and can a decline be taken back? | Firm |
| 16 | What happens after the last escalation step (14 days by default)? When is an action closed for lack of evidence, and with which outcome? | Firm and client |
| 17 | How is a wrong assistant answer reported, who looks at it, and is it recorded? | Firm |
| 18 | Real client files go only to a local model. Is about a minute per answer acceptable on the firm's server, or does the firm want other hardware? (Answer times on the production server: not measured.) | Firm |
| 19 | Is every upload to the wrong client treated as a breach? Who tells which client, and within what time? The agreement template's "[24] hours" is a placeholder. | Firm with counsel; each client in its agreement |
| 20 | Are these the right periods: ten years after archiving, a grace period of 0 to 90 days (default 60), chats deleted 90 days after closing or after 180 idle days, transcripts after 30 days? | Firm with counsel; the client by contract |
| 21 | May a client ask for its data to be deleted before the retention period ends? Who approves, and how does a legal hold affect it? | Firm with counsel; the client asks |
| 22 | Where is real client data hosted? | Firm, and each client's own requirements |
| 23 | Indicator help: which sources will a client allow Selah to read (an uploaded spreadsheet, a connected sheet), and who at the client accepts each value? | Client; firm for which indicators |
| 24 | Assessment help: when does the firm send its own assessment template, and which reference is each question measured against? | Firm |
| 25 | Lanes: what counts as "stuck" or "overloaded" (how many reviews, how many days), and who sees the list besides the firm admin and the lead? | Firm |
| 26 | Concern flags: which facts count as a concern, and who sees them? | Firm |
| 27 | Reference library: is each of the six sources licensed for this use, which editions are stored, and may the client assistant cite the library or only the staff assistant? | Firm, with counsel for the licences |
| 28 | Who operates the server, who holds the backup key kept off the server, what restore time is acceptable, and is an outside penetration test required before real data? | Firm |
| 29 | Who reviews the legal texts (terms, privacy notice, AI notice, data processing agreement) and when? | Firm's counsel |
| 30 | Which mail domain does Selah send from (it needs SPF, DKIM and DMARC on the firm's side)? | Firm |
| 31 | Does the firm need sign-in with its Microsoft or Google accounts? (Not built, and not planned in our documents.) | Firm |
| 32 | For a firm-run client with no accounts: how is a risk acceptance recorded, and who signs it? (Not found in the documents read.) | Firm and client |
| 33 | After hand-over Selah schedules check-ins at 30, 60 and 90 days. Does the firm also want the proposed re-check at 6 and 12 months, and what is checked? | Firm |
| 34 | Gate C: after the isolation sweep and the scenario report, go on to the go-live list or not? | Product owner |

## 7. Where the slides differ from the product

The partner firm's two slide decks were read only to understand how a firm like it works and what it needs. They are not requirements. They offer five example solution tracks; Selah does not follow them and nothing here is organised around them. Where the slides and the product differ, the product and our decisions win.

| The slides ask or suggest | What Selah does, and why |
|---|---|
| Pick one of five example tools (a maturity assessment, a recommendations board, a board-decision system, a strategy and KPI platform, a tool for structures, policies and procedures). | One product around one chain: finding, recommendation, owner and deadline, actions, evidence, consultant review, follow-up. Assessments, indicators, decisions and the structure exist only as parts that serve that chain. |
| Follow recommendations with an owner and a deadline, so the consultant knows the status without calling the client. | This is the core of Selah and it matches. |
| A status "at one glance", with traffic-light colours. | Counts and facts, never a health word or a colour verdict (decision D5). Green only for work a consultant verified. |
| KPIs calculated automatically from the organisation's data, with alerts when one drifts from its target. | Indicators are the client's own reported figures, typed, imported or read from a connected sheet. Always labelled "not verified impact". One rule-based "moved away" notice with figures only. No AI watches for deviations. Indicator help is planned as suggestions a person accepts. |
| A live compliance percentage and automatic governance reports. | Selah never says "compliant". It shows the share of work a consultant verified. A report reaches the client only after a second person approves it and a person confirms the send. |
| A maturity tool that produces diagnostic reports automatically. | A consultant answers each assessment question. Scores stay with the firm. Low answers become findings only when a consultant confirms them. Assessment help is planned as drafts. |
| An interactive organisation chart tied to an authority matrix, and a check that the matrix is applied. | The structure describes positions only. It never grants or limits access, and Selah never judges it. There is no authority matrix. |
| A policy platform every employee searches; procedures turned into step-by-step workflows that enforce the order and flag deviations. | Not in Selah. It is not a general file drive, and only people on a project have accounts. The assistant answers from files for firm staff and, if offered, client admins and managers; never action owners. "Workflow lanes" in our plan means spotting stuck work from action history. |
| Board decisions with automatic alerts. | Decisions are recorded in a meeting and never edited. A decision can become a board-decision recommendation, which then gets actions, owners and reminders like any other. |
| A mobile app is one of the open choices. | Desktop and tablet only, 768 pixels and up (design rule). |
| The firm's work runs in phases (strategy, operating plan, organisation building), each feeding the next. | One project per phase or agreed scope on the same client. Selah does not write the strategy, the structure or the policies; the firm does. |
| On delivery the client signs for the documents, and then nobody follows up. | Deliverable hand-over with a confirmed receipt ("Received" never means accepted), and then the action cycle carries the follow-up. |
| A reading list of six governance and strategy sources. | The same six are the planned reference library, after a licence check of each. Not built. |
| Real data is limited by client confidentiality. | Sample data only so far. Real client files go only to a local model, and only after the go-live list. |
| A prototype is expected. | Selah is presented as a production app with no "demo" labels, but production readiness is not claimed (FS 6). |
