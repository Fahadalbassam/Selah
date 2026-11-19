# Page audit (phase 1)

Audited 16 and 17 Nov 2026 against `main` at 4497cd3, on a fresh copy of the walkthrough data.

**Status: ready for gate A.** Nothing in it is built. Section 6 lists the decisions that are Fahad's.

## How it was done

- A script signed in as each of the 14 walkthrough accounts and opened every page and tab that account can reach by following the links on the screen, in Arabic and English. It only read. Captured: 655 Arabic screens for the 14 accounts (720 with the signed-out pages) and 704 English; a second pass of 145 screens per language for pages behind collapsed menus (Team, Settings, the assistant); the two floating cards for seven roles; the signed-out pages and the mails behind them.
- Six helpers judged the result, each in one area. Their full reports, with a screenshot or a code line for every claim, are in `docs/review/work/`: `code-recheck.md`, `audit-firm-admin.md`, `audit-consultants.md`, `audit-client-admin-manager.md`, `audit-action-owners.md`, `audit-public.md`.
- The lead checked the main claims against the code and the screenshots, then wrote a first combined audit.
- An independent helper then tried to break that combined audit against the screens, the code and the docs: 39 findings, 8 of them blocking (`work/audit-review.md`). Every blocking finding was checked and is corrected in this version. What changed because of it is listed in `lead-log.md`.
- Screenshots are on the review machine under `docs/review/shots/` (not in git). Paths below are relative to `docs/review/shots/phase1/`.

Not seen in a live state (they answer "Not found" until their condition is met): `/assessments/compare` (needs two assessments), `/leaving` (a client that is leaving), `/indicators/import` (the "files" data mode), a valid `/invite/:token`, the two-step code step, a client in restricted mode (admin accounts only), and the assistant in the state "offered, not yet consented". They are judged from code and will be seen in the phase 4 scenarios.

## The verdict

The October review still holds. Since then only the business-indicator code changed, so the project, action, client, meeting, inquiry and help screens are the ones reviewed then. The data model is sound. The screens show all of it at once, to everyone, in the firm's words.

| | October review | Today |
|---|---|---|
| Tabs on the project page | 11 | 11 for the firm (9 on an internal project, 10 on a pitch); 9 or 10 for client admins and managers; 6 for action owners (7 while closing) |
| Buttons and menu items on one project page, firm admin | about 93 | 104, plus the 11 tab buttons |
| Where the tab row starts on a 1280x800 screen | 535 px of 900 | 517 px when anything changed since the last visit, 192 px otherwise |
| Screens that list the same late or waiting actions | 6 | 10 for the firm admin, 9 for a lead, 8 for a client admin |
| Ways to send a file | 5 | 7 in the working flow, plus 3 imports |
| Status words | about 68 | 120 labels in 32 groups |
| Pages | 49 | 51 |

Every page row below ends in one of five verdicts: **keep**, **trim** (something goes), **merge** (into another page), **cut**, **replace**.

---

## 1. Every page

### 1.1 Signed-in pages

| # | Page | Who reaches it | What it is for | Verdict | What changes | Batch |
|---|---|---|---|---|---|---|
| 1 | `/` Overview | everyone | Today: four counters and a list of late actions. It does not say what waits for the reader. | **replace** | One home per role that first lists what waits for this person (section 4.2). The four counters shrink to one line. For clients the progress table, the business indicators card and the report PDF stay, under the list. | 2 |
| 2 | `/today` | firm staff | What waits for me across clients. | **merge** into `/` | Its six sections become the firm home. The old address redirects. | 2 |
| 3 | `/projects` | everyone | The projects I can open. | **keep**, trim | The three sidebar sub-entries become a filter on the page. Fix the bar (it divides by 9; every other screen says 1 of 8). A pitch is marked as a pitch, not as a client project. For firm staff, a table view with Oversight's columns (section 4.6). A client with exactly one project opens it directly. | 0, 2 |
| 4 | `/projects/:id` | everyone | One project. | **replace** the tab set | 11 tabs become 5, plus Closing while it is needed (section 4.3). The "changed since your last visit" card becomes one line that opens on demand, so the tabs start near 230 px, not 517. | 3 |
| 4a | tab Recommendations | everyone | The plan: recommendations with their actions. | **keep** as "Plan" | Recommendations first. Each finding shows as one line on the recommendation that answers it. One "Add a recommendation" button, not four. | 3 |
| 4b | tab Progress | all but action owners | The project's numbers and its shared reports. | **keep**, trim | Numbers first, then reports, then handover, then the activity record. Clients: the percentage, the outcome counts and the shared reports; the client admin also keeps the activity record. | 3 |
| 4c | tab Needs attention | firm | Actions that break one of six rules: overdue, no activity, date moved twice, sent back twice, no active owner; and recommendations in dispute. | **merge** into Plan | Filter chips on Plan, one per rule, with the count (section 4.3). All six rules keep their name. | 3 |
| 4d | tab Trace | all but action owners | The plan drawn again as a tree. | **cut** | Its parts live elsewhere: the evidence file and the review result show when an action row on Plan is opened; "came from this assessment" is on the finding line; "replaces the action above" is on the action page; indicator links are on the recommendation and indicator pages. | 3 |
| 4e | tab Meetings | everyone | The project's meetings. | **keep** | A meeting filed under a department follows the department rule (a bug today, batch 0). | 0 |
| 4f | tab Assessments | all but action owners | The firm: assessments run, retake, compare. Client admins and managers: assessments the firm shared, and comparing two of them. | **merge** | Firm: a "Sources" block at the top of Plan that lists the assessments, with start, retake and compare. Client: a "Shared assessments" section in Requests and files, with compare. | 3 |
| 4g | tab Requests | everyone | Documents the firm asked the client for. | **merge** into "Requests and files" | First section of the new tab, with the open count on the tab. One main button per row; the rest in a row menu. | 3, 4 |
| 4h | tab Documents | everyone | The project's files. | **merge** into "Requests and files" | Second section, with an "Add a file" button (today the tab has none) and who added each file and when. | 3, 4 |
| 4i | tab Activity | everyone | A project-wide record of who did what, on both sides. | **merge** into Progress | Foot of Progress for the firm and for the client admin. Not shown to client managers and action owners: for a department-limited manager it lists other departments' work today, and for an owner it is always empty. | 0, 3 |
| 4j | tab Team | everyone | Who is on the project, from both sides, and the client's named roles. | **keep** as "People" | For client readers it also names the firm's consultants (today only on Help). "Reassign their actions first" links to the hand-over that exists on Team, and to the one-action control if D1 is approved. | 3, 4 |
| 4k | tab Closing | firm; clients who may ask | Close the project in order; the client's request to close and the firm's answer. | **trim** | A tab while the project is closing or closed, or while a request to close waits. Otherwise "Start closing" (firm) or "Ask the firm to close" (client) is an item in the page's menu. | 3 |
| 5 | `/projects/:id/import` | firm | Read a plan from Excel or Word. | **keep** | Unchanged. | |
| 6 | `/recommendations/:id` | everyone | One recommendation, the client's answer, its actions. | **keep**, trim | List only the actions the reader may open, and say when there are more ("1 more action in another department"). Client wording. An "Add an action" button for the firm. | 0, 1, 3 |
| 7 | `/actions` | everyone | Every action I can open. | **keep** | Becomes the one list, with filters (section 4.6). For an action owner it is the home page. | 2 |
| 8 | `/review` | firm | Evidence waiting for the firm's decision. | **merge** into `/actions` | A filter of the Actions list, with its two extra columns (waiting days, sign-off stage). The old address redirects. | 2 |
| 9 | `/oversight` | firm | A health word and counts per project; a list of rule breaks with "Remind the owner". | **merge** | The list becomes Actions filters and "Remind the owner" a row action there. The per-project columns go to the Projects table view. The health word is decision D5. | 2 |
| 10 | `/actions/:id` | everyone | Do one action: what is asked, send the proof, talk, see the decision. | **trim** | One first card that says what waits and on whom; one solid button per state; one way to send a file; one text box; the firm's machinery not drawn on client screens (section 4.5). | 1, 4 |
| 11 | `/meetings/:id` | everyone | One meeting. | **trim** | Before the meeting: time, join, reply, agenda. Summary, decisions and follow-ups appear once it is held. The agenda prints statuses in words. What the agenda lists for a reader with department limits is decision D8. | 0, 1 |
| 12 | `/reports/:id` | all but action owners | A dated snapshot the firm shared. | **keep** | Unchanged. | |
| 13 | `/assessments/:id` | firm; client admins and managers when the firm shared it | Firm: answer a questionnaire for a client. Client: read a shared one. | **keep** | Long by nature. The words "suggested" and "firm only" travel with the gap count wherever it is shown. | 0 |
| 14 | `/assessments/compare` | firm; client admins and managers for shared ones | Compare two assessments. | **keep** (not seen) | To be seen in phase 4. | |
| 15 | `/assistant` | firm; client admin and managers where offered | Firm and managers: a page that only says the assistant opens as a card. Client admin: give or withdraw consent. | **trim** | The sidebar row opens the card. For the client admin the row shows as soon as the firm offers the assistant (as today): before consent it opens the consent page; after consent it opens the card, and "Assistant consent" in the user menu shows what was agreed, by whom and when, with the switch to withdraw. | 2 |
| 16 | `/audit` | firm admin, client admin | Who did what. | **keep**, trim | Plain words in each row; the code names (`auth.sign_in`, `method=password`) behind "details". | 5 |
| 17 | `/clients` | firm | My clients and who works on them. | **keep** | Groups become a second view of this page. "Enter an inquiry" sits beside "Start a pitch". | 2 |
| 18 | `/clients/:id` | firm | Everything about one client: 16 cards, 25 buttons, 3.3 screens. | **replace** | Three tabs: Overview (progress, indicators, projects), People, Setup (section 4.4). A waiting join request shows first, not last. | 5 |
| 19 | `/clients/:id/people` | firm admin | The client's accounts. | **merge** into the client page, People tab | The old address redirects. | 5 |
| 20 | `/clients/:id/departments` | firm | The client's departments. | **merge** into the client page, People tab | The old address redirects. | 5 |
| 21 | `/clients/groups` | firm | Holding groups (one row). | **merge** into `/clients` | A second view on the Clients page. | 2 |
| 22 | `/clients/groups/:id` | firm | A group's companies counted together. | **keep** | Unchanged; the numbers add up. | |
| 23 | `/departments` | client admin and managers | Departments, their members and heads; for the admin, the switch that turns departments on. | **merge** into `/team` | A "Departments" section of the client's People page. While departments are off, the admin sees one line and the switch; managers see nothing. 21 visible buttons for three departments become row menus. | 2 |
| 24 | `/departments/:id` | client admin, managers, firm | One department: its share of the work, its people, its indicators. | **keep**, trim | It is a department head's own page. The open-actions table becomes a link to the Actions list for that department. | 2 |
| 25 | `/engagements/:id` | firm, client admin | The signed contract. | **keep** | Unchanged. | |
| 26 | `/group` | client people the firm named | The group's companies counted together. | **keep** | Drop the firm's column "Linked client". | 1 |
| 27 | `/help` | client roles | Help. Today also a second home page. | **trim** | Keeps: your consultants (one list), the problem form, the questions. Goes: "First steps" and "Your open actions". A named contact at the firm for a concern that is not about the software is a known gap, parked for gate B. | 1 |
| 28 | `/indicators/:id` | firm, client admin, managers | One business indicator. | **keep**, trim | Two buttons per value row become a row menu. Plain words for the disclaimer on client screens. | 1 |
| 29 | `/indicators/data` | firm, client admin | How the client's figures reach Selah. | **keep** | Not a full card on top of the client admin's home: one row in "waiting for you" until answered, and not shown at all to a client with no indicators and a closing project. Speak to the reader (today it says "your systems" to a consultant). | 0, 2 |
| 30 | `/indicators/import` | client admin, managers, firm | Upload figures from a file. | **keep** (not seen) | To be seen in phase 4. | |
| 31 | `/inquiries` | firm | Requests from the public form. | **keep** | In the sidebar for the firm admin, and for a consultant only while one is assigned to them. | 2 |
| 32 | `/inquiries/:id` | firm admin, assigned consultant | Decide whether a request becomes a client. | **trim** | The steps in one numbered card, in order; only the current step is the solid button. Owner, NDA and rating stay on the side as facts. | 5 |
| 33 | `/leaving` | a client that is leaving | The handover pack and the grace period. | **keep** (not seen) | To be seen in phase 4. | |
| 34 | `/notifications` | everyone | The notification list; under it mail options and muted actions; for the firm admin also "Problems reported by clients", the only place to read a client's problem report and mark it handled. | **trim** | The list alone. Mail options and muted actions open from the user menu as their own view. The firm admin's problem reports move to the admin's home as a section. | 2 |
| 35 | `/settings` | firm admin | Firm settings. | **keep** | Unchanged. | |
| 36 | `/team` | firm; client admin and managers | Accounts, invitations, access review, hand-over of a leaver's work; for the firm admin also workload. | **keep** | Firm: with Expertise as a tab; in the sidebar for the admin and for consultants who lead a client. Client: the "People" page, with departments as a section; managers read it. Fix the "Projects" number (it changes with who is looking). | 0, 2 |
| 37 | `/team/expertise` | firm | Who can lead what. | **merge** into `/team` | A tab. A consultant who leads nothing edits their own line from "My expertise" in the user menu. | 2 |
| 38 | `/templates` | firm | Assessment templates. | **keep** | In the sidebar only for the firm admin and people named as template authors. Others reach a template from the assessment that uses it. | 2 |
| 39 | `/templates/:id` | firm | One template. | **keep** | Unchanged. | |
| 40 | Files card (sidebar) | everyone | Find any file I may open. | **keep** | Unchanged. Action owners keep it: it is how they reach files shared with them. | |
| 41 | Assistant card (sidebar) | firm; client admin and managers where offered | Ask about the work, with sources. | **keep** | Unchanged. It says in plain words that it suggests and does not decide. | |

### 1.2 Signed-out pages

| # | Page | What it is for | Verdict | What changes | Batch |
|---|---|---|---|---|---|
| 42 | `/sign-in` (and its states) | Sign in. | **keep** | Add the language switch. Plain words under the "send me a link" button. The "too many tries" message gives the real waiting time. | 0 |
| 43 | `/sign-in/link/:token` | Finish signing in from a mail link. | **keep** | Fix the hydration error (every load). | 0 |
| 44 | `/forgot-password` | Ask for a reset link. | **keep** | Language switch. | 0 |
| 45 | `/reset-password/:token` | Choose a new password. | **keep** | A dead link says so before the person types a password twice. | 0 |
| 46 | `/invite/:token` | Create the account. | **keep** | A dead link offers a way on. The mail names the organisation and the role, as the page already does. | 0 |
| 47 | `/confirm-email/:token` | Confirm a new address. | **keep** | A dead link says so before the press. | 0 |
| 48 | `/consent` | Accept the three notices at first sign-in. | **keep** | Language switch. The privacy summary must not say "stays in the Kingdom" where the same site lists services outside it. Everyone still accepts all three notices (a recorded rule). | 0 |
| 49 | `/security` | Two-step sign-in. | **keep** | Unchanged. | |
| 50 | `/inquiry` | The public inquiry form, five steps. | **keep**, trim | Steps 1 and 2 become one (drop the second name field and the job title). The review step shows every answer. The title appears at once, not typed in. No green tick before anyone has verified anything. | 0, 1 |
| 51 | `/privacy` | Privacy notice for inquiries. | **merge** into `/legal/:doc` | One more document in the legal set, same layout. | 1 |
| 52 | `/legal/:doc` (six documents) | Terms, privacy, AI, data agreement, sub-processors, security. | **keep** | Real texts. The sub-processor list reads the real mail setting. Addresses in the text become links. | 0 |
| 53 | `/upload/:token` | Send one requested document without an account. | **keep**, trim | The best signed-out page. Drop "Sign in" from its header. Fix the scrambled file-type line in Arabic. | 0 |

**Count.** 51 pages today. After the merges 42 remain. The nine that become part of another page: `/today`, `/review`, `/oversight`, `/clients/:id/people`, `/clients/:id/departments`, `/clients/groups`, `/departments`, `/team/expertise`, `/privacy`. Nothing is cut outright except the Trace tab. The October review estimated "about 30 would do". This audit finds that more pages earn their place than that, and that the weight is in the tabs, the sidebars and the home pages, not in the page count.

**The same late actions, after.** Today a late action is listed on ten screens for the firm admin. In the target it is listed on four by design: the home, the Actions list, the project's Plan and the meeting agenda.

---

## 2. The 18 findings and the five bugs, today

| # | Finding | Today | The short proof |
|---|---|---|---|
| U01 | The same late actions on six screens | **Still true, worse** | Ten screens for the firm admin. Five different queries compute "overdue". |
| U02 | Project page: 11 tabs, about 93 controls | **Still true** | 11 tabs, 104 controls; tab row at 517 px after any change; two tabs cut off at 768 px. `admin_at_mizan.test/ar/013-…-1280-full.png` |
| U03 | Action page: three uploads, three text boxes, wrong next step | **Still true** for owners and managers; partly for reviewers | Three send buttons with three effects. "Report a blocker" is read before "Send for review". For the reviewer, "next step" is only "Close the action" in four of eight states, and a date request to decide sits in the side panel. |
| U04 | Client homes do not show the client's job; counters contradict the list | **Still true** | Rawdah's admin reads "Nothing needs your attention" while two recommendations wait for her answer. One owner has three actions and the counters add up to one. |
| U05 | Five ways to send a file | **Still true** | Seven in the working flow. |
| U06 | "Add recommendation" in four places; findings first | **Still true** | Four buttons on one tab; findings fill the first screen. |
| U07 | The firm's client page: a dashboard plus settings cards | **Still true** | 16 cards, 25 buttons, 3.3 screens. |
| U08 | A client admin can invite a colleague but cannot give them work | **Partly true** | A client admin (and the firm admin) can hand over all of one person's open actions to a colleague, from Team, when switching that person off. What is missing is moving one action: no screen offers it to anyone, firm included. The project's Team tab says "Reassign their actions first" and links nowhere. |
| U09 | Long sidebars with admin tools for everyone | **Partly true** | Admin pages are admin-only. But every consultant gets Inquiries (empty) and Templates (read-only); client managers get Team and Departments as two read-only rows. |
| U10 | About 68 status words; one Arabic word for several approvals | **Still true, worse** | 120 labels. "اعتماد" covers six things. "متعثر" is a blocked action and an off-track project. |
| U11 | Clients see the firm's machinery | **Still true** | Reminder and escalation ladder on every client action page, sign-off count, date history, Trace tab, on-time and revision rates. |
| U12 | Firm vocabulary on client screens | **Still true** | Screens speak about "the client" to the client. |
| U13 | People and roles in four places | **Still true** | Eight places on the firm side, four on the client side. |
| U14 | Meeting page shows everything before the meeting | **Still true** | Four empty cards on a scheduled meeting. |
| U15 | Dense rows, every rare action a button | **Still true** | Request rows 5 to 7 buttons; departments 21 buttons for three departments. |
| U16 | Inquiry page with five "next steps" | **Partly true** | One card now leads, but it offers three steps at once and five side cards hold more. |
| U17 | Help is a second home page | **Still true** | First steps and "your open actions" come before the help. |
| U18 | Lists that hide what matters | **Still true** | The Actions list has no filter, search or grouping. |
| B1 | Raw status keys on the meeting agenda | **Still true** | Seven keys on one agenda; dates as raw text; Arabic headings on the English page (the agenda is one stored text). |
| B2 | Three percentages for one project | **Partly fixed** | Three screens agree on 13 % (1 of 8). The Projects card still draws 1 of 9 (it counts a draft). |
| B3 | Reminder ladder with past dates on finished actions | **Still true** | Also on drafts. A "paused" sentence was added; the dates stay. |
| B4 | Departments switch drawn "off" while on | **Still true** for readers who cannot change it | Right for the client admin; drawn dimmed, like off, for managers and consultants. |
| B5 | Hydration error on the meeting page | **Still true** | Both scheduled meetings, every role, both languages. Also on the sign-in link page and English Oversight. |

---

## 3. Found new in this audit

Each has its screenshot in the area report named, and was checked again by the independent reviewer unless marked.

### 3.1 Things shown to the wrong person

| # | What | Where |
|---|---|---|
| N1 | An action owner sees other people's actions on a recommendation page: title, owner, date and state, including a draft the firm has not released. The links answer "Not found". | `owner_at_nukhba.test/ar/017-recommendations_e25c9908-1280.png` |
| N2 | A draft action, "still being prepared by the firm", is listed and opens for the client admin and client managers, with a reminder ladder and a risk-acceptance button. Counts leave drafts out, so lists and counts disagree (9 rows, "1 of 8"). No document records a decision that clients should see drafts; the database read rule simply has no status check. | `admin_at_nukhba.test/ar/032-actions_f55a1d16-1280-full.png` |
| N3 | A manager limited to her department sees other departments' work in four places: the meeting agendas, a Finance workshop filed under Finance, the project Activity tab, the shared monthly report (whole-project numbers). The company's own Departments page tells her this cannot happen. | `manager_at_nukhba.test/ar/031-…`, `030-…`, `016-…`, `028-…` |
| N4 | The observer is not read-only. On business indicators the observer has the same buttons as a staffed consultant, and the rules let them work: enter and correct a value, mark it checked, add, edit and pause an indicator, link and unlink a recommendation. On meetings, and "Start an assessment", the buttons are drawn and the database refuses them. (Read from the rules; not pressed.) | `observer_at_mizan.test/ar/043-indicators_9d456655-1280-full.png` |
| N5 | The meeting agenda names every late and waiting action of the project to an action owner, on meetings he is not invited to, with a solid "Join" button. | `owner_at_nukhba.test/ar/021-meetings_574c3428-1280-full.png` |
| N6 | Sign-in, inquiry and legal pages send the app's whole text catalogue to a signed-out visitor (265 KB, including the firm's internal wording). The upload page sends only its own 31 KB. | page source |

### 3.2 Selah judging

| # | What | Where |
|---|---|---|
| N7 | Oversight labels each project "متعثر / Off track", "Watch" or "On track" by a fixed threshold, with no person behind it. The counts beside the label are neutral facts. This is a documented, tested feature (F18), stored weekly. | `admin_at_mizan.test/ar/040-oversight-1280-full.png` |
| N8 | The project's Assessments tab shows "37.5 % · 6 gaps". On the assessment page the same six are "suggested, 0 confirmed" and marked firm only. The tab drops both words. | `admin_at_mizan.test/en/016-…` |
| N8b | Indicators carry the words "Better than baseline" and "Worse than baseline". They are a comparison of two numbers the client entered, in the direction a person chose, with a disclaimer under them. Still a value word put on a client's number by the app. | `admin_at_nukhba.test/ar/001-home-1280-full.png` |

### 3.3 Numbers that disagree

| # | What |
|---|---|
| N9 | Overview and Today contradict each other. One lead reads "Nothing needs you" on Overview while Today holds a decision for him. A consultant's Today says "waiting for your review: 1" for an action he may not review. |
| N10 | "In progress 3" on the home counter where two rows carry that status: the counter silently adds "revision requested". Not-started, draft and closed actions are in no counter. |
| N11 | Three lists of "my actions" with three lengths for one action owner (home 1, Help 2, My actions 3). |
| N12 | The Arabic notification badge prints two-digit counts reversed: "71" for 17 unread. |
| N13 | On Team, the "Projects" number beside each person changes with who is looking. A lead of two projects sees 0 for himself. |
| N14 | "Late: 3" beside "No open action is past its original date" on the same Progress tab. Both are true by the app's definitions and read as a contradiction. |
| N15 | The evidence list on one sample action shows three items "not sent" while its history shows the file. The file went in through the button that never answers a list item. The walkthrough says "one item answered". |
| N15b | The sample loader makes actions late by back-dating, and the owner's date history shows that as a real move ("28/11 to 14/11 on 16/11"). |

### 3.4 Work that is in none of the reader's lists

| # | What |
|---|---|
| N16 | A late follow-up from a meeting, owned by an action owner, exists only inside the past meeting's page, four clicks from home. |
| N17 | Recommendations waiting for the company's answer, document requests addressed to a person by name, and a meeting reply are only in the notification bell, not on any client home. |
| N18 | On a closing project, the only place an owner learns her open action was handed over to her is the project's Closing tab. The action page still offers "Send for review". |
| N18b | A project that is closing and waits for the firm admin's final close is on no home page. (Join requests and requests to close already reach the admin from every client.) |

### 3.5 Signed-out pages and mails

| # | What |
|---|---|
| N19 | Nobody says who this is from. The inquiry form, both privacy notices and every mail name no firm and no person. Only the upload page does ("Asked by Mizan Advisory"). The upload-link mail reads like a phishing mail. |
| N20 | The privacy notice and the form say "reply to this mail"; the mails come from a no-reply address with no reply address. |
| N21 | No language switch on any sign-in page. An English reader arriving from a mail link lands on Arabic with no way to change it. |
| N22 | Dead links behave five different ways (section 1.2). |
| N23 | Three statements that do not hold: "wait a minute" for a lock of up to 15 minutes; the mail service marked "in use on this site" without reading any setting; "stays in Saudi Arabia" on the consent page against "may be outside the Kingdom" in the sub-processor list. |

### 3.6 Firm-run clients (no client accounts)

| # | What |
|---|---|
| N24 | The project header and the action page do not say the consultant records for the client. Texts still say "what the client should send" and "talk with the client". The record already stores how and when the client sent each piece of evidence; the page does not print it, though the UI guidelines require it. The reminder ladder names client roles that do not exist. |
| N25 | The only consultant on a firm-run client is offered "Send for review"; the screen does not say who reviews. |

### 3.7 Rules and texts that disagree

| # | What |
|---|---|
| N26 | Changing one action's owner: the docs say client managers and admins may; the app's permission table lets a manager but not an admin; the database lets both; no screen offers it (decision D1). |
| N27 | A date change: any consultant on the project decides the first two moves, and the third move later needs the lead or the firm admin (a database rule). The Today page says only "the lead or the firm admin decides". The text is wrong, not the rule. |

### 3.8 Small faults on screen

Two text boxes start at the left in Arabic (the action discussion, the Help problem box). English prints "1 actions". A pitch shows on Projects as a plain "Client" card. Rawdah's home asks how its business figures should reach Selah although it has no indicators and its only project is closing. Notices stay after they stop being true (an answer already given, an assistant already on). The "Available to assistant" badge shows where the client has no assistant. Staff bands are drawn reversed in Arabic ("49–10"). English titles are cut at the start in Arabic lists. History lines use the masculine for a woman. The product name has two spellings in Arabic.

### 3.9 Not about screens

| # | What |
|---|---|
| N28 | `main` fails its database tests from 16 Nov 2026: a test seeded an action due 2026-11-15. Fixed on branch `fix/assistant-test-date`. About 40 other tests use fixed dates between December 2026 and March 2027; some will fail the same way as the dates pass. |
| N29 | Two copies of Selah could not run on one machine: every clone shared containers, data and ports, so `--fresh` in a second clone deleted the first copy's data. Fixed on branch `tooling/second-copy` (an opt-in instance name). |

### 3.10 Rule 1 (the partner firm is never named)

Clean where checked: no hit for either spelling in the signed-out pages, eleven mail bodies, both message files or the mail templates. The search over the whole app code, the seed data and the generated PDFs runs before every pull request, as the rule says.

---

## 4. The target

### 4.1 One sidebar per role

| Role | Today | Target |
|---|---|---|
| **Firm admin** | Overview / Today (one split row) · Projects (3 sub-entries) · Clients (2 sub-entries) · Inquiries · Actions · Assessment templates · Assistant · Team (2 sub-entries) · Audit log · foot: Files. Ten rows and seven sub-entries. | **Home · Projects · Clients · Actions · Inquiries · Assistant** · group Organisation: **Team · Assessment templates · Audit log** · foot: **Files**. Ten rows, no sub-entries. User menu: language, theme, Settings, Mail options, Two-step sign-in, Sign out. |
| **Consultant** (lead, deputy, staffed, observer) | The same rows and sub-entries as the admin, less Audit log. | **Home · Projects · Clients · Actions · Assistant** · foot: **Files**. Shown only when they apply: **Team** (for a consultant who leads a client: it is where they see who can do what), **Inquiries** (while one is assigned to them), **Assessment templates** (for a named template author). User menu adds "My expertise". |
| **Client admin** | Overview · Projects · Actions · Assistant · Team · Departments · Our group · Audit log · foot: Help, Files. | **Home · Projects · Actions · Assistant** (as soon as the firm offers it) · group Company: **People** (accounts, with departments as a section) · **Our group** (only when granted) · **Audit log** · foot: **Help · Files**. User menu keeps Data sharing and adds Assistant consent and Mail options. |
| **Client manager** | Overview · Projects · Actions · Assistant · Team · Departments · foot: Help, Files. | **Home · Projects · Actions · Assistant** (only when on) · **People** (read-only: the company's people and, where departments are on, the departments with their heads) · foot: **Help · Files**. Two read-only rows become one. |
| **Action owner** | Overview · My actions · Projects · foot: Help, Files. | **My actions** (the home) · **Projects** · foot: **Help · Files**. Overview and My actions become one page. |

Where the removed rows live: Today inside Home; the Projects and Clients sub-entries as filters on their pages; client groups as a view on Clients; Expertise as a tab on Team; the client's Departments as a section of People.

### 4.2 One home per role

Every home answers "what waits for me" first, then "how is it going".

| Role | The home lists, in this order | Then |
|---|---|---|
| Firm admin, consultant | Decisions waiting for me (join requests, date requests, requests to close, answered document requests, recommendations in dispute; for the admin also projects ready for the final close and problems clients reported) · evidence waiting for my review (only what I may review) · late or due this week where I lead or am staffed, and my own actions · my follow-ups · my meetings this week · what changed since my last visit | One line of counters that link to the Actions filters. The admin's lists of late work and reviews cover the clients the admin follows, and the page says so. |
| Client admin, client manager | Recommendations waiting for the company's answer (admin and sponsor) · documents asked of me · evidence sent back · my actions that are late or stopped · date requests answered · meetings to reply to and the next meeting · an indicator value that is due · for the admin: the assistant offer and the data-sharing choice until answered | The progress table per project and per department (as today, for those who see it) · the business indicators card, with "New indicator" for the admin · the client report PDF. |
| Action owner | My actions in three groups: waiting for me (sent back and late first, then in progress, then not started) · with the consultant · finished (folded). A waiting date request shows beside the due date. Then: documents asked of me · meetings to answer and my next meeting · my follow-ups from meetings. | Nothing else. A project where the owner has no action is reached from the Projects row. |

Where each part of today's Overview and Today goes: the four counters become one line; the "needs attention" table becomes the Actions filters; Today's six sections become the firm home; the client's progress table, indicators card and report button stay on the client home, below the list.

### 4.3 The project page: 11 tabs to 5

| Today | Target |
|---|---|
| Recommendations · Progress · Needs attention · Trace · Meetings · Assessments · Requests · Documents · Activity · Team · Closing | **Plan · Requests and files · Meetings · Progress · People** (and **Closing** while the project is closing or closed, or while a request to close waits) |

| Thing today | Where it lives |
|---|---|
| Recommendations with their actions | Plan, the default tab |
| Findings | One line on the recommendation each led to, with the assessment it came from; findings with no recommendation in a short group at the end |
| Four "Add a recommendation" buttons, Excel, Import | One solid "Add a recommendation"; Excel, Import and "Add a finding" in a menu beside it |
| Needs attention: six rules | Filter chips on Plan, each with its count: late · no activity for 14 days · date moved twice or more · sent back twice or more · no active owner · in dispute (a recommendation) · and the two Oversight adds: blocked · review waiting over 7 days |
| Trace | Cut; its parts are listed in row 4d |
| Assessments (firm): list, start, retake, compare | A "Sources" block at the top of Plan |
| Assessments (client): shared ones, compare | A "Shared assessments" section in Requests and files |
| Requests | Requests and files, first section, open count on the tab |
| Documents | Requests and files, second section, with "Add a file" |
| Progress numbers, reports, handover | Progress, in that order |
| "Changed since your last visit" card | One line above the tabs ("8 actions changed since your last visit"), opening on demand. The mark moves as it does today. |
| Activity | Foot of Progress, for the firm and the client admin |
| Team: firm staff, client people, client roles | People; for clients it also names the firm's consultants |
| "Edit details", the contract link | The page's menu; the contract line stays in the header |
| Closing: the steps, the client's request and the firm's answer | Its own tab while closing, closed or requested; otherwise an item in the page's menu. The "this project is closing" banner links to it |

The same tabs for every role and every kind of project; what differs is what each holds. An internal project has no Requests section (files only) and its lead closes it. A pitch has no Closing. A client's Progress is the percentage, the outcome counts and the shared reports. An action owner's Plan is their own actions under their recommendations. On a restricted client the upload keeps its share step.

### 4.4 The firm's client page: three tabs

| Tab | Holds (cards of today) |
|---|---|
| **Overview** (default) | Progress across projects · business indicators · projects (with "New project") · a notice when a join request waits |
| **People** | The firm's team on the client · the client's accounts (today `/clients/:id/people`) · contacts without accounts · join requests · departments (today `/clients/:id/departments`) |
| **Setup** | How the client takes part · legal profile · short names · second sign-off rule · client assistant · signed engagements · archive and retention · conflict check (prospects) |

"Suggested consultants" moves inside the "Add a consultant" dialog.

### 4.5 The action page

One page, the same order for every role; what differs is the first card.

1. **Header**: title, the state in a plain word, the due date with the late flag.
2. **What happened last**, only when it applies: the consultant's reason for sending it back; the closing note; "your request to move the date is with the consultant"; "this action was handed over to you"; on a firm-run client, "recorded by the firm for the client".
3. **What waits, and on whom**: one card, one solid button.

   | State | Owner or manager sees | Reviewer sees |
   |---|---|---|
   | Not started | Start work | "With the client" |
   | In progress | Send for review | "With the client" |
   | Sent back | Send the revised file for review (one step; the server already supports it) | "With the client" |
   | Awaiting review | "With the consultant since …"; where two consultants check, "a second consultant checks this" | Accept (or first / second sign-off) as the solid button; Send back as an outline button; the file being judged in the same card |
   | Date request waiting | (banner above) | Approve as the solid button, Decline as an outline button, with the requested date and reason |
   | Stopped | Resume work, under the reason | "With the client", the reason shown |
   | Verified, closed | no card | no card |

   Under the button, quiet links for the three things that sit in three corners today: "I am stuck", "I need more time", "Ask the consultant". Rare items (close the action, reopen, the company decides not to do this, mute mail) in a menu.
4. **What to send**: the description, the expected evidence and the evidence list as one block. Each item has one outline "Send a file" button; the card's only solid button is the one in block 3.
5. **One way to send a file**: one dialog. With an evidence list a file always goes to an item. The dialog's last choice is "send for review now" or "save without sending".
6. **One conversation**: the progress-note box merges into the discussion.
7. **History**: files and decisions, last. On a firm-run client each recorded piece of evidence says how and when the client sent it.
8. **Side panel**: project, recommendation (a link), department. For the firm also: firm notes, second sign-off, reminders, date history.

What "not drawn on client screens" means: the reminder ladder, the date history and the sign-off count are no longer drawn for client roles. The server rules do not change (the date history stays "as visible as the action" in the data). In their place the client reads two plain lines: the last date decision ("New date 5 Jan, agreed by …") and, on a late action, "if this stays late, your manager is told on …".

Document requests on the project and evidence items on an action get the same row design and the same wording, so a client meets one idea ("the firm asked you for a file") in two places.

### 4.6 The Actions page and the Projects table

**Actions**: one list at `/actions` with filters: all · mine · awaiting review · late · blocked · no activity · date moved twice or more · sent back twice or more · no active owner; and by client (firm) or project. "Awaiting review" adds the waiting days and the sign-off stage. The rule filters carry "Remind the owner" as a row action for the people who run the work. `/review` and `/oversight` redirect to the matching filter.

**Projects**, for firm staff, gains a table view with what Oversight shows per project today: open, late, blocked, oldest waiting review, lead, client last active. The two neutral tiles (overdue actions, reviews waiting over 7 days) become counters on the home that link to the filters.

### 4.7 Words

- One word per thing, starting with the ones that mean two: "متعثر" (a blocked action) against the project label of the same word; "الشركة" for the firm against the client company; "المسؤول" for an action's owner, an administrator and an accountable person; "طلب" for an inquiry, a document request, a join request and a date request; eight wordings for sending a file.
- Fewer visible status words on lists, the exact state on the detail page (decision D3).
- Client screens speak to the reader ("your company's answer"), never about "the client". The full table of today's wording with a plain replacement for each, in Arabic and English, is in `work/audit-client-admin-manager.md` section 2.3 and `work/audit-action-owners.md` section 2.

---

## 5. The changes, by batch

Each batch is one or two pull requests. Old addresses redirect. Permissions change only where a decision in section 6 says so, and each such change is named below with its decision.

### Batch 0: bugs found on the way (no decision needed)

Things shown to the wrong person, fixed on the server:
- N1: the recommendation page lists only actions the reader may open, and says how many more there are.
- N3, the part that is a plain bug: a meeting filed under a department follows the department rule (the database's read rule for meetings skips the check today).
- N3, the Activity tab: not shown to client managers and action owners; it stays for the client admin.
- N4, the dead buttons: an observer is not shown meeting or assessment controls the database refuses.
- N6: public pages send only their own texts.

Wrong on screen:
- B1 raw status keys and raw dates in the agenda. B2 the Projects card bar. B3 the reminder ladder on finished and draft actions. B4 the dimmed switch. B5 the hydration errors (scheduled meeting, sign-in link, English Oversight) and the lighter warnings (plan import, departments, notifications, help).
- N8 "6 gaps" without "suggested" and "firm only". N12 the reversed badge digits. N13 the Team "Projects" number. N15 and N15b the sample data and the walkthrough text. N27 the Today text about who decides a date change.
- N24, the part the guidelines already require: on a firm-run client the page says the firm records for the client, and each recorded piece of evidence shows how and when the client sent it.
- The small faults of 3.8.

Signed-out pages:
- N21 the language switch on every sign-in page. N22 dead links say so at once and offer a way on. N23 the three statements that do not hold. The review step of the inquiry form shows every answer. "Sign in" leaves the upload page's header.

Tests and tooling:
- N28 the failing test (done) and a sweep of the other fixed dates. N29 the second-copy option (done).

After its decision: **D4** (the observer on indicators) lands here, because it closes a hole.

### Batch 1: hide the firm's machinery from clients (U11, U12, U14, U15, U17)

- Client action page: the reminder ladder, the sign-off count and the date history are not drawn; two plain lines take their place (4.5). Risk acceptance and "ask for a new date" leave their permanent cards.
- Client Progress tab: the percentage, the outcome counts and the shared reports; no "Handover" card.
- Meeting page: summary, decisions, follow-ups and transcript appear once the meeting is held (both sides).
- Help: consultants, problem form, questions.
- Client wording: the replacement table, Arabic first. The words that mean two things (4.7, first bullet) are fixed here, because they mislead today.
- Dense rows: one main button per row and a row menu, on request rows, department cards, indicator value rows, client team rows.
- Public: the inquiry form's first two steps as one; `/privacy` into the legal set.
- After their decisions: **D6** (drafts and clients), **D7** (the firm's name on signed-out pages and mails), **D8** (what a department-limited reader sees in agendas, reports and plans; the agenda becomes a live list).

### Batch 2: one home and one sidebar per role (U01, U04, U09)

- The home per role (4.2). `/today` redirects to `/`. The admin's problem reports move to the home.
- The sidebar per role (4.1), including the client's People page (accounts with departments) that managers read. The rows a role loses and the page that replaces them ship in the same pull request.
- The Actions page with its filters, and the Projects table view (4.6). `/review` and `/oversight` redirect. After its decision: **D5** (the health word).
- Projects: the kind filter on the page. Clients: groups as a view; "Enter an inquiry". Team: Expertise as a tab; "My expertise".
- Notifications: the list alone; mail options and muted actions from the user menu.
- The assistant row and the consent view (row 15).

### Batch 3: the project page around the plan (U02, U06, U13)

- The tab set (4.3) for every role and every kind of project. Trace goes here, for both sides, in the same pull request that puts its parts on Plan.
- Plan: recommendations first, findings as a line, one add button with a menu, the rule chips, the evidence and review result on an opened action row, the Sources block.
- Requests and files as one tab, with "Add a file" and the client's shared assessments.
- People: one place per project for both sides.
- "Add an action" on the recommendation page.

### Batch 4: one way to send a file, one action page (U03, U05, U08)

- The action page (4.5) for owner, manager and reviewer.
- One upload dialog; one conversation box.
- Requests and evidence items with one row design.
- The one-action owner control for the firm, and the link from "Reassign their actions first" to the hand-over on Team. After its decision: **D1** (the same control on the client side).
- Firm-run clients, the rest of N24 and N25: texts that assume a client account do not appear; the page says who reviews.

### Batch 5: the client page, inquiries and the vocabulary (U07, U10, U16, U18)

- The firm's client page in three tabs (4.4); the two sub-pages redirect.
- The inquiry page: numbered steps, one current step.
- After its decision: **D3** (the visible status words).
- The audit log in plain words.

---

## 6. Decisions for gate A

Only the product owner can make these. Each has the lead's recommendation, the reason, and what it would change that is not obvious.

### The four open decisions

**D1. May a client admin or coordinator give an action to a colleague in their own organisation?**

What is true today: a client admin can already hand over all of one person's open actions to a colleague, from Team, when switching that person off. Nobody can move one action: no screen offers it, firm included. The docs say client managers and admins may change an owner; the app's permission table lets a manager but not an admin; the database lets both.

Recommend **yes, for one action**: the client admin, and the project's coordinator and sponsor, may change the owner of an open action to a colleague in the same organisation. Not on verified or closed actions. The status does not change. Told: the new owner, the old owner, the client's lead and deputy, and the consultants staffed on the project.

What it changes that is not obvious:
- It narrows the written rule: today's docs let any client manager change an owner (though no screen offers it). A department head who is neither coordinator nor sponsor would not have it. The other option is to keep the written rule (any client manager on the project) and add no new check.
- A coordinator can pick only colleagues already on the project. A client admin can add a colleague to the project first.
- The client-side control is new (the server and the database rule exist). The evidence of need: the Team tab already tells the client admin to "reassign their actions first", and scenario 9 will test it.

**D2. May we delete the Trace and Today pages and fold Oversight into Actions?**

Recommend **yes, in this form**:
- Trace: remove the tab. Every part of it has another home (row 4d).
- Today: do not delete what it holds. It is the only cross-client list of my follow-ups, my meetings this week, the decisions waiting on me and what changed. Overview and Today become one home page; `/today` redirects.
- Oversight: its list becomes filters on Actions, with "Remind the owner"; its per-project columns go to a table view on Projects. All six rule names survive as filters. Its health word is D5.

**D3. Five visible status words (Not started, In progress, Waiting for the firm / the client, Needs attention, Done), with the exact state on the detail page?**

Recommend **yes with one change, in batch 5**: keep "Verified" and "Closed" apart instead of one "Done". The product's own rule is that green and "verified" belong to work a consultant checked. A closed action (risk accepted, not applicable, replaced, partly done) was not checked. So six words: Not started · In progress · Waiting for the firm / the client · Needs attention · Verified · Closed.

**D4. Should an observer be read-only on the client's indicators too?**

Recommend **yes**. Today an observer can enter and correct values, mark them checked, add, edit and pause indicators, and link them to recommendations, because indicators belong to the client and the observer rule only looks at projects.

Proposed rule, written from the other side so it leaves no hole: **a consultant changes a client's indicators only when staffed (not as observer) on at least one of that client's projects, or when lead or deputy of the client.** Everyone else on the firm side reads. This also takes the right from a consultant who is on the client's team but staffed on no project, who has it today.

### New decisions this audit raises

**D5. Oversight calls a project "Off track" by a fixed rule. Keep the word?**

Recommend **no**: show the counts and the reason line ("3 of 6 late, 1 blocked") and drop the label. Rule 2 says Selah does not judge.

What it changes: this reverses a documented, tested feature (F18 in `docs/metrics.md` and `docs/rules.md`). The weekly history stores the label; it would store the counts instead, and the 8-week strip would show counts. By the same standard, "Better / Worse than baseline" on indicators (N8b) should become the plain difference and the direction the person chose; that wording is checked again in phase 3 with the indicators.

**D6. May a client see a draft action before the firm releases it?**

Today client admins and managers do. Recommend **no**: a draft appears to the client when the firm releases it. The notification already says "was released to you", and counts already leave drafts out.

What it changes: it is a database rule on actions and everything under them, not a screen filter. The report shown when a person leaves counts drafts as work they hold and lists them to the client admin; it must leave drafts out for a client admin, and the firm must settle them. A draft can name a client person as owner; that person is told at release, not before. The Excel export and the assistant's index are checked for drafts as part of the change.

**D7. Should the signed-out pages and the mails name the firm that runs this copy of Selah?**

Recommend **yes**, using the name in the firm's own record (the walkthrough's "Mizan Advisory"), as the upload page already does. This keeps rule 1: the product stays generic and no firm name is written into the code. A prospect and a person sent an upload link need to know who is asking, and a privacy notice has to say who holds the data.

**D8. What may a reader with department limits see of other departments' work?**

Today the company's own Departments page promises that work filed under a department is seen only by its people, the company's admins, the firm's team and the action's owner. The screens break that promise in agendas, reports, the activity record and the recommendation page (N1, N3, N5). The walkthrough states the same intent for this very account.

Recommend **the promise holds everywhere**: every list a person reads follows their limits, whatever role they hold on the project. Where something is left out, the screen says so without titles ("1 more action in another department"), so a sponsor answering a recommendation knows the plan is larger than what he sees. Shared reports keep whole-project numbers (a person at the firm chose to share them) but no titles from other departments.

What it changes: the meeting agenda is one stored text today, the same for every reader. It becomes a live list per reader. That is a redesign of the agenda, not a small fix, which is why it waits for this answer.

The other option: people named in a project role (sponsor, coordinator, steering committee) see the whole project. Simpler to build, but the Departments page text and the walkthrough would have to change, and the assistant would still answer by the stricter rule.

### Choices the lead will make unless told otherwise

These can be undone, so they do not stop the work:
- The home is called "الرئيسية / Home" for every role.
- After a send-back, one button sends the revised file for review (today three steps).
- Firm settings stay in the user menu.
- The firm admin's home lists late work and reviews for followed clients only, and says so; decisions only the admin can take come from every client.
- The Today text about date changes is corrected to match the rule (any consultant on the project; the third move later needs the lead or the firm admin). No rule changes.

### Asked of Fahad that are not decisions

- Sign the `gh` tool in to GitHub on this PC (`gh auth login`), so pull requests can be opened and merged.
- Copy `plan/selah-simplification-review.html`, `plan/simplification-review/` and `research/` into `docs/review/inputs/` if they should be used; this audit worked from the summary in the prompt.

### Left for gate B (not part of the simplification)

A named way for an unhappy client to reach the firm admin (today the only route is a form named "Technical problem"); the reminder before an engagement ends; the handover when the lead changes; who reviews on a firm-run client with one consultant; notices that clear themselves when they stop being true (more than a wording fix).

---

## 7. After the October review (added 17 Nov 2026)

The full October review arrived after gate A. A helper checked this audit against it (`work/october-review-check.md`). No gate A answer is made wrong by it. These changes are taken into the batches:

| # | Change | Batch |
|---|---|---|
| 1 | Before the shared request and evidence row is built, write a placement table: every state of every kind of thing (evidence items, document requests, date requests, meetings, reports, inquiries, projects, closing) under one of the six visible words, with one "yes" verb per level (Accept for items, requests and date changes; Verify only for the action), and the outcome on a closed action ("Closed: risk accepted"). | written in batch 3, used from batch 4 |
| 2 | New inquiries appear on the firm admin's home, and the Inquiries row carries an unread count. | 2 |
| 3 | Clients list: the lead's name plus "and N others" instead of two-letter chips; pitches in their own small table. Projects: the next due date on each card; one "New project" button whose first field is the client. | 2 |
| 4 | One status line under the project title: percent verified, late, waiting for review (counts, never a health word, per D5). | 3 |
| 5 | The recommendation dialog shows five fields (title, priority, accountable, due date, rationale) and "more" for the rest (10 today). | 3 |
| 6 | Language and theme leave the user menu: they stay in the top bar only (and on signed-out pages, where the switch is now in place). | 2 |
| 7 | Dense rows also cover the Documents list (version shown only when there is more than one; "available to the assistant" in the row menu; who added it and when) and the client admin's People page (open invitations, mail domains and access review fold behind one "Access" section). | 1, 2 |
| 8 | Client admin's "Our group" becomes a section of the home for the people who may see it, not a sidebar row. | 2 |
| 9 | Home rows carry their next step ("Answer", "Send a file"), and each home section shows five rows with "show all". | 2 |
| 10 | The walkthrough guide and `ui-guidelines.md` section 10, which name Today, Trace, Needs attention and Oversight, are updated in the same pull requests that remove them. | 2, 3 |
| 11 | Changing an action's owner (D1) writes an audit entry; on a minimal-records client the owner is a typed name, and the control handles that. | 4 |
| 12 | Actions filters add owner and department; an action that is both late and blocked is one row. Batch 4 decides whether accepting the last open evidence item and verifying the action can be one step for the reviewer. | 2, 4 |
| 13 | The Files card keeps "Add a file" only where the person may add to a project; for client roles it becomes a finder and the upload moves to the project's Requests and files tab. | 4 |
| 14 | Seven pages the October review would fold are kept for now with a one-line reason each: `/inquiries` (the admin's inbox), `/templates` (author tool), `/audit` (a record of its own), `/engagements/:id` (the signed scope), `/assistant` (consent only), `/projects/:id/import` (a three-step wizard). `/group` folds into the home (row 8). | none |

Kept as this audit has them, although the October text differs: the Handover card stays on Progress (it is set on an open project); firm notes stay apart from the conversation (October named the leak risk itself); the group page's 11 % is a correct sum; the project's five tabs (four of five match October's).

One permission question from the October review goes to Fahad with the agenda choice: should "Link / Unlink" an indicator to a recommendation be the firm's alone? Today the client admin can, and `docs/authorization.md` says so; the October review calls the link the consultant's statement.

From the research folder: support for D1 (comparable portals let clients delegate requests to colleagues, with an owner-change history) and for three parked gaps (a complaint route to the firm admin, the lead handover, a reviewer who is not the author). For the agenda (D8) the research adds a third option, set out with the agenda choice.

## 8. Re-check before batch 1: the screens batch 0 changed (added 18 Nov 2026)

Fahad asked (17 Nov) to re-check only the screens that are new or changed since this audit. This section covers the screens batch 0 changed (#153, #156, #160, #161, #165). The new features (the visibility picker, the org chart, deliverable receipt, the indicator notice) each get their own screen check before they merge and are added here.

**How.** The same capture script as phase 1, on a fresh copy of the walkthrough data on `main` after #165 (`shots/recheck1/`; the signed-out upload page re-captured once its link worked). Two helpers judged the changed screens against phase 1 (`work/recheck-firm-public.md`, `work/recheck-client.md`); an independent helper tried to break both reports (`work/recheck-check.md`): it found nothing blocking, confirmed the five blocking conditions itself, and checked 24 "fixed" claims against the screenshots (all hold).

**The decisions hold on every captured screen.**

| Decision | Result |
|---|---|
| D6: no client sees a draft action | The draft's title appears 0 times in every client account's captures, both languages (phase 1: up to 5 per account) |
| 1b: an action owner sees only their own actions | Owners' pages carry only their own titles and counts |
| D8 and 1a: a department-limited manager | 0 titles from other departments; "Not found" on a whole-project meeting (shown on the #165 branch's screen check; the code on `main` is the same) |
| 1a, Fahad's answer: an invited owner at a client with no departments | The Rawdah owner opens her meeting and sees only her 2 actions |
| 1c: indicator links are the firm's | No Link / Unlink in any client account |
| D4: observers change nothing on indicators | Indicator page: 16 buttons to 1; meetings 13 to 1 |
| #153: the signed-out pages | Every captured item fixed (language switch, dead links, waiting time, the review step, legal pages, the upload page, consent) |

**Faults found (none blocking), fixed in one small pull request:**

1. The in-app "Not found" page shows two language switches (`app/not-found.tsx` draws the signed-out corner switch everywhere since #153). Limited readers now land there often (1a).
2. An invited action owner sees a colleague (the client admin) as a nameless "—" attendee: attendee names follow the user-row rule, not the meeting. The lead's decision (17 Nov) is that an invited owner sees the attendees.
3. Wording: three Arabic verbs for releasing a draft; the observer reads "until you release it"; one activity line reads backwards in Arabic; the Progress tab says client managers and owners see the same figures (no longer true); the meeting warnings use a masculine verb for anyone and do not say the calendar invitation still goes out; the role label «مدير الشركة» for the firm admin where everything else says «مدير المكتب».
4. Tabs that say "none yet" (Meetings, Requests) when items exist that this reader cannot open.
5. The client-side indicator banner and `/indicators/data` speak about "the client" to the client; the decided wording ("Your company's reported figures, not verified impact") is used.
6. Hydration warnings that remain (meetings, notifications, actions, departments, plan import); the hard meeting errors are gone.
7. To verify: after choosing a role with the keyboard in the inquiry form, focus may jump to the top of the page.

**Kept for later batches:** the Rawdah admin home's empty indicators card whose only solid button is «مؤشر جديد» (batch 2, homes); the Trace tab showing a Finance finding with nothing under it to a client reader (Trace goes in batch 2, D2); the "Better/Worse than baseline" chip and the "toward target" percentage (batch 5 wording).

**Questions for Fahad, kept for Gate B (nothing waits on them):**

- A meeting's agenda headings and status words follow the meeting's language, not the reader's. Recommendation: follow the reader's language.
- A department-limited manager can be invited (after a warning) to a whole-project meeting she cannot open. She receives the calendar invitation (title, time, call link, organiser, the invitees' names and addresses; nothing about the work). Options: keep it and say "N meetings you're invited to are open only to people who see the whole project"; or refuse the invitation. Recommendation: refuse it and suggest a department meeting, so an invitation always opens.
- The firm's free-text report note can name another department's work to a limited manager (the note is the firm's own text; Selah cannot filter it). Recommendation: a line in the handbook for consultants.

### 8.1 The new features and batches 1-4, screen-checked before each merge (added 19 Nov 2026)

Each feature and each batch was looked at by the lead on a copy of the walkthrough data built from its own branch (Arabic first, the roles it touches), after its independent review and before it merged. Screenshots are under `docs/review/shots/check-*`.

| What | Pull request | What the screens showed |
|---|---|---|
| Indicator moved away (4b) | #167 | The notice to the lead, deputy and client admin in plain figures; "your company's reported figures" to the client; the manager who typed the figure not told |
| Deliverable handed over and received (4a) | #171 | One solid "Confirm receipt" and "Comment" for the acceptor; "received never means accepted"; the owner gets Not found |
| Who sees an item, part 2 (picker enforced) | #175 | "Seen by: everyone with access · Customise" closed by default; the limited file marked for those who see it, absent for the person left out; locked people listed |
| Org chart parts 2-5 | #172, #181, #183, #186 | The drawn tree with names only where allowed; the editor (indented list, ⋯ menus, "the firm's draft"); the person work card showing only what the viewer may open, no score; People in positions under the client's People tabs; the import page (paste hidden on a hosted model); publishing (what changes, today or later, one solid button) |
| Batch 1: the client's own pages, Help, dense rows, inquiry | #176, #177 | The owner's action page with one solid button and two plain lines; a scheduled meeting without empty record cards; Help with three parts; Requests tab 27 → 14 buttons |
| Batch 2: homes, sidebars, Actions | #178, #179, #180 | Each home answers "what waits for me" first, then one line of counts; each sidebar exactly as 4.1; `/review`, `/oversight`, `/today` redirect |
| Batch 3: the project page | #182 | Five tabs (four for an action owner), the tab row at 260 px instead of 517, one status line of counts |
| Batch 4: one upload, one action page, D1 | #184 | The reviewer's page with one solid "verify", the sign-off box and "give to a colleague" |
