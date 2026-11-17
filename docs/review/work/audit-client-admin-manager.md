# Page audit: client admins and client managers

Five accounts, two companies. Judged from the captured screens of 16 Nov 2026 (`docs/review/shots/phase1/` and `phase1-extra/`), Arabic first, English second, then checked against `docs/review/work/code-recheck.md`.

Short names used for evidence paths (all relative to `docs/review/shots/phase1/` unless they start with `extra/`, which means `docs/review/shots/phase1-extra/`):

| Short | Folder | Person |
|---|---|---|
| AN | `admin_at_nukhba.test` | فهد الدوسري, client admin, Al-Nukhba |
| SN | `sponsor_at_nukhba.test` | منصور العنزي, client manager, sponsor (CEO) |
| MN | `manager_at_nukhba.test` | ريم الحربي, client manager, coordinator, Board secretariat |
| AR | `admin_at_rawdah.test` | هند الزهراني, client admin and sponsor, Rawdah |
| MR | `manager_at_rawdah.test` | يوسف الغامدي, client manager, Rawdah |

What I could not see: dialogs (invite a person, answer a recommendation, send a file, enter an indicator value), the user menu at the foot of the sidebar, and e-mails. Where I rely on the code reading for those, I say so. Several full-page shots show the top bar drawn across the middle of the page (for example `AN/ar/013-…-full.png`, `017`, `018`, `019`): I take that as a capture artefact of the sticky header, not a product fault.

---

## The short version

1. **No home page shows the person's job.** All five get the firm's four counters, a progress table and a list of late actions that mostly belong to other people. Two recommendations wait for the Al-Nukhba admin's answer, three document requests are addressed to him by name, a meeting waits for his reply: none of it is on his home page. Rawdah's admin reads "Nothing needs your attention right now" while two recommendations wait for her answer.
2. **The coordinator sees Finance's and Legal's work in three places** although the action pages themselves are closed to her: the meeting agendas, the project Activity tab and the shared monthly report.
3. **A client admin still cannot give work to a colleague** (U08). On every action that is not his own the page tells him "Nothing for you to do on this action right now". The project Team tab tells him "Reassign their actions first" and offers no way to do it. A manager, meanwhile, can press "Resume work" on the CEO's blocked action.
4. **The firm's machinery is all still on client screens** (U11, U12): the reminder and escalation ladder on every action, "One of two sign-offs done", date history, risk acceptance as a permanent card, the Trace and Activity tabs, on-time and revision rates, "Client-claimed progress, not verified".
5. **Rawdah's closing project does not say what happens next.** The one open action is "Handed over" on the Closing tab and "In progress" everywhere else, still with a reminder ladder, "Submit for review" and "Accept the risk".

---

## 1. One row per page

Controls are visible buttons + items behind menus, in the page body, for the busiest of the five roles. "768" comes from the Arabic tablet shots; no record in my area reports sideways overflow at 768 px.

### Pages outside the project

| Route | Roles | Purpose | Controls | First screen 1280x800 | First screen 768x1024 | Verdict | Reason | Evidence |
|---|---|---|---|---|---|---|---|---|
| `/` Overview | All five. AN and AR also get the "How should your business figures reach Selah?" card on top; AN, SN, MN get the indicators card, AR gets it empty; MR gets neither. | Cannot be said in one sentence: it is a status report on the company (4 counters, progress table, indicators) with a short list of late actions at the bottom. That is the finding. | 7 + 0 (AN) | AN, AR: the whole first screen is the data-sharing question, then the 4 counters; the list "Needs your follow-up" starts at 1,690 px of 1,980 (AN). SN, MN, MR: counters, late banner, progress table; the list is below the fold. | Same order; data-sharing card and counters fill the screen; no overflow. | **replace** with a home that lists what waits for this person (see part 4), keeping one progress line | The page answers "how is the company doing" and not "what must I do". Everything the person must do today is on other pages or only in the bell. | `AN/ar/001-home-1280-full.png`, `SN/ar/001-home-1280-full.png`, `MN/ar/001-home-1280-full.png`, `AR/en/001-home-1280-full.png`, `MR/en/001-home-1280-full.png`, `AN/ar/001-home-768.png` |
| `/notifications` | All five | The list of notices, and under it the person's mail settings. | 17 + 0 (AN) | 8 unread notices (AN); the mail settings start at 690 px. | Not opened; record shows no overflow. | **trim**: keep the list; move "Mail choices" and "Muted actions" to the user menu | Two pages in one. The list is today the only place that says "waiting for your response" and "documents were requested from you"; it should not carry the settings too. Notices also go stale: AN still has "اعتماد ميثاق مجلس الإدارة بانتظار ردك" although that recommendation is already "موافَق عليها". | `AN/ar/002-notifications-1280-full.png`, `AR/en/002-notifications-1280.png` |
| `/security` | All five | Set up two-step sign-in. | 1 + 0 | One card: confirm password, continue. | Fine. | **keep** | One job, one button. | `AN/ar/003-security-1280.png` |
| `/help` | All five | Ask about the work, report a technical problem, find your consultants. | 7 + 0 | "First steps" (three cards), then "Ask your consultant" and "Technical problem"; consultants and questions are below the fold. | Not opened. | **trim**: drop "First steps" and "Your open actions"; keep consultants, the problem form and the questions | It is a second home page (U17): three steps that point to Overview and Actions, and a table of the person's open actions. The useful part starts at 980 px. | `AN/ar/004-help-1280-full.png`, `MN/ar/004-help-1280-full.png`, `AR/en/004-help-1280-full.png` |
| `/projects` | All five | List the company's projects. | 0 + 0 | One card with a bar; the rest of the screen is empty. | Same. | **merge** into the home page (a project line there) and open the project directly when there is only one | Both companies have one project. The card also carries a second percentage (bar = 1 of 9) and the firm's badge "عميل / Client". | `AN/ar/005-projects-1280.png` |
| `/actions` | All five (AN 9 rows, SN 7, MN 5, AR 4, MR 4) | Every action the person can open, by due date. | 1 + 0 (Excel) | The whole list. | Not opened. | **keep** | The one complete list. It mixes finished, draft and late work with no grouping (U18), and it shows a "مسودة / Draft" action the firm is still preparing. | `AN/ar/006-actions-1280-full.png`, `AR/en/006-actions-1280.png` |
| `/actions/:id` | All five; MN gets "Not found" on Finance and Legal actions (right) | Do the next step on one action and see what the firm said. | 13 + 0 (SN on `60d3d21a`) | Title, "Next step", the progress-note box, then the evidence list. Right column: project, recommendation, owner, due date. | One column, next step first; fine. | **trim**: remove the reminder ladder, date history and sign-off count; move risk acceptance and "ask for a new date" into a menu; one text box | Good bones: next step is at the top. But the page still carries four firm cards, up to four black buttons and two text boxes, and for the admin it says "Nothing for you to do". Details in part 2. | `SN/ar/029-actions_60d3d21a-1280-full.png`, `SN/ar/023-actions_9cc4daf7-1280-full.png`, `AN/ar/028-actions_a6a726cb-1280-full.png`, `MN/ar/021-actions_2ebe3f7a-1280-full.png`, `MR/en/022-actions_69741cad-1280-full.png`, `SN/ar/029-actions_60d3d21a-768.png` |
| `/recommendations/:id` | All five; MN not on the Finance one (right) | Read one recommendation and give the company's answer. | 4 + 0 (AN) | "رد العميل / The client's response" card first, with the one black button "الرد / Respond" for AN, SN, AR. MN and MR see the same card with "يرد مدير حساب العميل أو راعي المشروع" and no button. | Not opened. | **keep** | The best client page: one question, one button, first on the screen. Faults are wording ("the client" to the client) and the "Linked indicators" card with firm text on AN's and AR's copy. | `AN/ar/037-recommendations_e25c9908-1280-full.png`, `SN/ar/031-…-1280-full.png`, `MN/ar/027-…-1280-full.png`, `AR/en/026-recommendations_7cb92536-1280.png` |
| `/meetings/:id` | AN, SN, MN (Rawdah has no meetings) | See when a meeting is, answer the invitation, read what was decided. | 3 + 0 | Time, "Join", reply buttons, agenda. | Not opened. | **trim**: show summary and decisions only after the meeting; write statuses in words; filter the agenda by what the reader may see | Raw status keys on the agenda, empty Summary and Decisions cards before the meeting (U14), a console error on both scheduled meetings, and the agenda shows the coordinator other departments' actions. | `MN/ar/031-meetings_574c3428-1280-full.png`, `MN/ar/030-meetings_5ec72542-1280.png`, `AN/ar/040-meetings_beaa4143-1280-full.png` |
| `/reports/:id` | AN, SN, MN | Read a report the firm shared, with its numbers as they were that day. | 1 + 0 (PDF) | Percentage, eight tiles, the consultant's note. | Not opened. | **keep** | A shared item with who and when, as the guidelines ask. Two tiles are firm measures ("أُجّلت", "أيام التأخير"). MN gets the whole project's numbers here (see part 2). | `MN/ar/028-reports_e2b73197-1280-full.png` |
| `/engagements/:id` | AN, AR (reached from the line under the project title; SN, MN, MR have no such line) | Show the signed contract: scope, period, deliverables. | 0 + 0 | Scope, projects, deliverables (empty), details. | Not opened. | **keep** | Read-only and short. The "back" link carries the company's own name and leads to the home page. | `AN/ar/035-engagements_5bb705cf-1280.png` |
| `/indicators/:id` | AN (both), SN (both), MN (her department's one) | One business indicator: its values over time and where to enter this period's value. | 11 + 0 (AN) | Title, disclaimer, three figures, chart; the black button "إدخال قيمة / Enter a value" top left. | Not opened. | **keep** | Clear, and the place to enter the month's figure. Wording needs work (part 2). | `MN/ar/019-indicators_9d456655-1280-full.png`, `AN/ar/024-indicators_e4183286-1280-full.png` |
| `/indicators/data` | AN, AR can choose; SN, MN, MR can read it by address only ("القرار لمسؤول العميل") | Choose how the company's figures reach Selah. | 4 + 0 | Three options and "Confirm". | Not opened. | **keep** | One decision, well explained. It should not also sit on top of the home page until answered. | `AN/ar/023-indicators_data_client_5cbbfdd6-1280.png`, `extra/sponsor_at_nukhba.test/ar/005-indicators_data-1280.png` |
| `/team` | AN, AR manage; SN, MN, MR read a plain table | Who has an account at the company, and inviting or switching off people. | 7 + 12 (AN) | Table of people, then three cards: open invitations, e-mail domains, access review. | Not opened. | **trim**: put "Email domains" behind a menu; drop the two-factor column for a five-person company or say what to do about it | It is the firm's "People and access" screen reused. Fine for accounts; it does not say which projects a person is on (the managers' read-only table does). | `AN/ar/007-team-1280-full.png`, `AR/en/007-team-1280.png` |
| `/departments` | AN, AR manage; SN, MN, MR read | Switch departments on or off and say who is in each. | 21 + 0 (AN) | Switch card, then three department cards with every action as a visible button. | Not opened. | **merge** into `/team` as a "Departments" section | Second place for the same people (U13). 21 visible buttons for three departments (U15). For Rawdah it is an empty page behind a sidebar row. | `AN/ar/008-departments-1280-full.png`, `AR/en/008-departments-1280.png`, `MN/ar/008-departments-1280.png` |
| `/departments/:id` | AN, SN (both theirs); MN her own; MN gets "Not found" on Finance | One department's progress, indicators and open actions. | 1 + 0 | Progress card and members; indicators and open actions below. | Not opened. | **keep** | For a department head this is "my department today". Reached from the home table. | `AN/ar/021-departments_9663eec2-1280-full.png` |
| `/group` | AN only (SN, MN, AR, MR: "Not found", right) | The companies of the group counted together. | 0 + 0 | One card: 11 %, four tiles, two company rows. | Not opened. | **keep** | Short and read-only. The column "الصيغة: عميل مرتبط / Form: Linked client" is the firm's word. | `AN/ar/009-group-1280.png` |
| `/audit` | AN, AR (SN, MN, MR: "Not found", right) | What the company's people did in Selah. | 8 + 0 | Filters and the first rows. | Not opened. | **trim**: hide the technical line under each row (`auth.sign_in`, `user cec45db2`, `::1`, `method=password`) behind "details" | Right page for an admin, but every row prints raw keys. | `AN/ar/010-audit-1280.png` |
| `/assistant` (page) | AN, SN, MN (AR, MR: "Not found", right) | Say that the assistant opens as a card; for AN, switch it off for the company. | 2 + 0 (AN) | One empty-state card "يفتح المساعد في بطاقة" and "افتح المساعد". | Not opened. | **merge**: the sidebar row opens the card; "Switch off the assistant" moves beside the other company choices | A page whose only content explains another control. After consent the admin can no longer read what he agreed to. | `extra/admin_at_nukhba.test/ar/003-assistant-1280.png` |
| Assistant card (sidebar) | AN, SN, MN | Ask a question about the company's own work and get an answer with sources. | 6 | A floating dark card over the page; scope picker, the limits in two lines, the question box, "أسئلة اليوم: 0 من 30". | Not captured. | **keep** | States its limits in plain words ("لا يُفتي في الأنظمة أو الامتثال ولا يتحدث باسم المكتب"). | `extra/manager_at_nukhba.test/ar/002-card_assistant-1280.png` |
| Files card (sidebar) | All five | Find any file the person can open, by project. | 6 (MN, en) | A floating dark card: search, project, three folders (Evidence, Deliverables, Client documents), "Add a file". | Not captured. | **keep** | Useful. "Add a file" is one more way to send a file (U05). | `extra/manager_at_nukhba.test/en/001-card_files-1280.png` |

### The project page (`/projects/:id`), one row per tab

Tabs today: AN, SN, AR, MR get 10 (Recommendations, Progress, Trace, Meetings, Assessments, Requests, Documents, Activity, Team, Closing). MN gets 9 (no Closing). The tab row starts at 405 to 517 px in Arabic because the card "تحرّكت 8 إجراءات في آخر 7 أيام" sits above it.

| Route | Roles | Purpose | Controls | First screen 1280x800 | First screen 768x1024 | Verdict | Reason | Evidence |
|---|---|---|---|---|---|---|---|---|
| Header and "moved" card | All five | Name the project and show what changed since the last visit. | 1 + 0 | Title, contract line (admins only), a five-row list of status changes all stamped "26 minutes ago", then the tabs at 517 px. Rawdah adds the banner "This project is closing…". | Tabs at 517 px; the ten tabs just fit. | **trim**: one line ("8 actions changed since your last visit"), opening on demand | It pushes the page's content to the bottom third of the screen and repeats the list under it. | `AN/ar/011-projects_8c55994f-1280-full.png`, `AN/ar/011-projects_8c55994f-768.png` |
| tab Recommendations | All five | The plan: each recommendation with its actions. | 2 + 0 | Only the heading "الملاحظات / Findings" is visible; the recommendations start at about 930 px. | Findings fill the screen. | **trim**: fold each finding into its recommendation ("تعالج: …" is already printed there) | Findings are still step one (U06). For MN the block also says "لا توصية بعد" under the Finance finding, which is untrue: the recommendation exists and is hidden from her. | `AN/ar/011-…-1280-full.png`, `MN/ar/009-projects_8c55994f-1280-full.png`, `AR/en/010-projects_61d37bdc-1280-full.png` |
| tab Progress | All five | Cannot be said in one sentence: a "Handover" card, nine measures, two empty history cards and the list of shared reports. | 1 + 0 | Nothing of the tab: the "moved" card fills the screen. | Same. | **trim** to the percentage with its six outcome counts and the reports list; the rest goes | Firm measures: median wait, verified on time, due date moves, share of reviews asking for changes, what verification rests on, slip from the original date, monthly snapshots. | `AN/ar/012-projects_8c55994f_tab_التقدم-1280-full.png`, `AR/en/011-projects_61d37bdc_tab_Progress-1280-full.png` |
| tab Trace | All five | The plan again as a tree, with each file and review outcome. | 1 + 0 | Nothing of the tab. | Same. | **cut** | Repeats the Recommendations tab. The only extra (file and "قُبل / أُعيد للتعديل") is on each action page. | `AN/ar/013-projects_8c55994f_tab_التتبّع-1280-full.png` |
| tab Meetings | All five | The project's meetings. | 2 + 0 | Nothing of the tab at 1280; three rows and "حجز اجتماع" below. | Same. | **keep** | Three rows, one button. All five may book a meeting. | `AN/ar/014-projects_8c55994f_tab_الاجتماعات-1280-full.png` |
| tab Assessments | All five | Assessments the firm shared. | 1 + 0 | One sentence: "لم تُشارَك معكم أي تقييمات بعد." | Same. | **merge** into Documents: a shared assessment appears there when there is one | A tab that exists to say there is nothing. Same on Rawdah. | `AN/ar/015-projects_8c55994f_tab_التقييمات-1280-full.png` |
| tab Requests | All five (same 8 buttons for AN, SN, MN; empty for AR, MR) | Documents the firm asked the company for. | 8 + 0 | Nothing of the tab; four items below, three open. | Same. | **keep**, moved to second place and shown on the home page | This is real client work with a due date (23 Nov) and it is the sixth tab. | `AN/ar/016-projects_8c55994f_tab_الطلبات-1280-full.png` |
| tab Documents | All five (AN 11 files, MN 8) | The project's files. | 2 + 2 (MN 1 + 3) | Nothing of the tab. | Same. | **keep** | Needed. Every row carries "مشترك مع العميل / Shared with client"; none says who shared it or when. No way to add a file here. | `AN/ar/017-projects_8c55994f_tab_المستندات-1280-full.png`, `MN/ar/015-…-1280-full.png` |
| tab Activity | All five | A log of who did what. | 1 + 0 | Nothing of the tab. | Same. | **cut** | Lines without an object ("خالد الشمري طلب مستندًا", "غيّر الحالة من قيد التنفيذ إلى مغلق"). The admin has the audit log; each action has its own history. It also leaks (part 2). | `AN/ar/018-projects_8c55994f_tab_سجل_النشاط-1280-full.png`, `MN/ar/016-…-1280-full.png` |
| tab Team | All five. AN, AR: "Client people on this project" (add, remove) and "Client roles" (name, remove). SN, MN, MR: the roles card only, read-only. | Who from the company is on the project and who holds which role. | 5 + 0 (AN) | Nothing of the tab. | Same. | **trim**: rename "People"; add the firm's consultants (today only on Help); replace "Reassign their actions first" with a way to do it | The only client-side place to put a colleague on a project. Wording is the firm's ("أشخاص العميل", "أدوار العميل", "يُبلَّغ الراعي عند آخر مستوى تصعيد"). | `AN/ar/019-projects_8c55994f_tab_الفريق-1280-full.png`, `AR/en/018-projects_61d37bdc_tab_Team-1280-full.png`, `SN/ar/017-…-1280.png` |
| tab Closing | AN, SN (one button: "اطلب من المكتب الإغلاق"); AR (3 buttons), MR (read-only); MN has no tab | Running project: ask the firm to close. Closing project: what happens to open actions, and the case-study consent. | 3 + 0 (AR) | Rawdah in English: the whole tab fits. | Not opened. | **trim**: a tab only while the project is closing or closed; before that, "Ask the firm to close" is an item in the project menu | On Al-Nukhba (13 % done) a whole tab holds one button. | `AN/ar/020-projects_8c55994f_tab_الإغلاق-1280-full.png`, `AR/en/019-projects_61d37bdc_tab_Closing-1280-full.png`, `MR/en/018-…-1280-full.png` |

### Addresses that answer "Not found"

| Address | Who gets "Not found" | Right? |
|---|---|---|
| `/assistant` | AR, MR | Right: Rawdah has no assistant. No sidebar row, no "Ask the assistant" button on Rawdah's action or recommendation pages either (`AR/en/024-…`, `AR/en/026-…`). |
| `/group` | SN, MN, AR, MR | Right: only AN was named a viewer. |
| `/audit` | SN, MN, MR | Right: admins only. |
| `/leaving` | All five | Right: nobody is leaving. No link to it on any screen. |
| `/indicators/import` | All five | Right while the company's choice is "figures typed in"; no screen links to it. Not checked after choosing "Some data". |
| `/departments/800fa7f5…` (Finance) | MN | The answer is right; **the link is the fault**: her `/departments` page lists Finance and Legal as cards that link to pages she may not open (`MN/ar/008-departments-1280.png` → `MN/ar/025-departments_800fa7f5-1280.png`). |
| Finance and Legal actions, the Finance recommendation | MN | Right, and no screen links her to them by address. Their titles reach her another way (part 2, isolation). |

---

## 2. Marks

### 2.1 Home pages: counters against the lists

Every counter on each home page, then where it disagrees.

| | AN | SN | MN | AR | MR |
|---|---|---|---|---|---|
| قيد العمل / In progress | 3 | 2 | 0 | 1 | 1 |
| بانتظار المراجعة / Awaiting review | 1 | 1 | 1 | 0 | 0 |
| متعثرة / Blocked | 1 | 1 | 1 | 0 | 0 |
| مكتملة ومُتحقق منها / Verified complete | 1 | 1 | 1 | 3 | 3 |
| متأخرة / Overdue banner | 3 | 2 | 1 | none | none |
| المنفَّذ / Implemented | 13 %, 1 of 8 | 17 %, 1 of 6 | 25 %, 1 of 4 | 75 %, 3 of 4 | 75 %, 3 of 4 |
| Project row: still open / overdue | 6 / 3 | 5 / 2 | 3 / 1 | 1 / 0 | 1 / 0 |
| Department rows | Board 33 % (1 of 3), Finance 0 % (0 of 2), Legal 0 % (0 of 2), company-wide 0 % (0 of 1) | Board, Finance, company-wide | Board, company-wide | none | none |
| Indicators: count / updated / better / worse | 2 / 2 / 2 / 0 | 2 / 2 / 2 / 0 | 1 / 1 / 1 / 0 | "No indicators yet" | card absent |
| Rows in "يحتاج متابعتك / Needs your follow-up" | 3 | 2 | 1 | 0 | 0 |
| Rows on `/actions` | 9 | 7 | 5 | 4 | 4 |

Disagreements:

- **8 against 9 (AN), 6 against 7 (SN), 4 against 5 (MN).** Home says "تم التحقق من 1 من أصل 8 إجراء ما زالت قائمة"; the Actions page lists 9 and the Projects card says "9 إجراءات". The ninth is the draft "اعتماد قرار تشكيل اللجنة ونشره", which is on the list but not in the count. `AN/ar/001-home-1280-full.png` against `AN/ar/006-actions-1280-full.png` and `AN/ar/005-projects-1280.png`.
- **Two percentages for one project (batch 0).** Home and the Progress tab: 13 %. The bar on the Projects card is drawn at 1 of 9, about 11 %, with no number. `AN/ar/001-home-1280-full.png`, `AN/ar/005-projects-1280.png`.
- **"قيد العمل 3" against two rows marked "قيد التنفيذ".** The card silently adds the action marked "مطلوب تعديل". It also uses a different Arabic word (قيد العمل) from the status badge (قيد التنفيذ). `AN/ar/001-home-1280-full.png`, `AN/ar/006-actions-1280-full.png`.
- **The four cards do not add up.** AN: 3 + 1 + 1 + 1 = 6 of 9 actions; the assigned, the draft and the closed one are in no card. A reader cannot get from the cards to the list.
- **MN has three sets of numbers for the same project.** Home and Progress tab: 25 %, 1 of 4, overdue 1. The shared monthly report: 13 %, 1 of 8, overdue 3, still open 6. `MN/ar/001-home-1280-full.png`, `MN/ar/028-reports_e2b73197-1280-full.png`.
- **Rawdah: "Nothing needs your attention right now" against two things that do.** AR's bell holds "Set up a quarterly implementation review is waiting for your response" and "Adopt the 2027 strategic plan with measurable KPIs is waiting for your response"; both recommendation pages show a black "Respond" button. `AR/en/001-home-1280-full.png`, `AR/en/002-notifications-1280.png`, `AR/en/026-recommendations_7cb92536-1280.png`.
- **Rawdah: "In progress 1 / Still open 1" against "Handed over".** The Closing tab says the action "Hold the first quarterly review" is handed over to Rawdah and sustained by دانة العمري. Home, the Actions list and the action page still say "In progress". `AR/en/001-home-1280-full.png`, `AR/en/019-projects_61d37bdc_tab_Closing-1280-full.png`, `AR/en/024-actions_69741cad-1280-full.png`.
- **"متأخرة 3" beside "لا يوجد إجراء مفتوح تجاوز موعده الأصلي"** on the same Progress tab and on the report. Both are true by the app's own definitions (current date against first agreed date), but a client reads them as a contradiction. `AN/ar/012-…-full.png`, `MN/ar/028-…-full.png`.
- **MN "تغييرات الموعد 1"** on her Progress tab: none of her four visible actions shows an approved date request. The only approved request I can see is on a Finance action she may not open. I could not trace this number for her. `MN/ar/010-projects_8c55994f_tab_التقدم-1280-full.png`.

What each person's job is today, and where it is shown:

| Person | Waiting for them | On the home page? | Where it is |
|---|---|---|---|
| AN | Answer "تشكيل لجنة المراجعة" and "تفعيل سجل إفصاحات تعارض المصالح" | No | Bell; project page badges "بانتظار الرد" |
| AN | Three documents asked of him by name, due 23 Nov | No | Bell ("طُلبت منك مستندات"); Requests tab, sixth tab |
| AN | Reply to the steering meeting of 22 Nov; his follow-up due 21 Nov | No | Meeting pages |
| AN | Choose how figures reach Selah | Yes, first on the screen | Home |
| SN | Unblock his own action | Yes (first row of the list) | Home |
| SN | Answer "تشكيل لجنة المراجعة"; reply to the meeting | No | Recommendation page; meeting page |
| MN | November value of her indicator ("بانتظار القيمة") | No (the card shows October with no hint) | Indicator page |
| MN | Reply to the meeting; answer Omar's comment | No | Meeting page; action page |
| MN | (shown instead) the CEO's blocked action | Yes | Home list |
| AR | Answer two recommendations; the firm is closing at her request | No | Bell; project page |
| MR | Nothing | Correctly empty | |

### 2.2 The firm's machinery on client screens (U11)

| Where | Who sees it | Arabic / English on screen | Do instead |
|---|---|---|---|
| Action page, card "التذكيرات / Reminders": four steps "تذكير، متأخر، تصعيد، تصعيد أخير / Reminder, Overdue, Escalation, Final escalation" with dates and who is told ("المسؤول ومديرو العميل والمستشار الرئيس والراعي ومسؤولو حساب العميل ومسؤولو الشركة المتابعون") | All five, on every action including verified, closed and draft | as quoted | Remove. If anything stays, one line on a late action: "You were reminded on 11 Nov". |
| Same card on finished work: "متوقفة ما دام الإجراء بانتظار الشركة، أو انتهى، أو كان المشروع غير نشط / Paused while the action waits on the firm, is finished, or the project is not active", then four dates anyway | All five | `MN/ar/022-actions_066a00be-1280-full.png` (verified), `AN/ar/031-actions_80a85aa9-1280-full.png` (closed), `AN/ar/032-actions_f55a1d16-1280-full.png` (draft) | Remove |
| Action page: "تم اعتماد واحد من اثنين. اعتمده مستشار واحد. يراجعه مستشار ثانٍ قبل التحقق منه / One of two sign-offs done"; history line "اعتمد (الأول من اثنين)" | All who open the action | `MN/ar/021-actions_2ebe3f7a-1280-full.png` | "With the firm for review." |
| Action page, "سجل المواعيد / Date history" with lines like "2026/11/26 ← 2026/11/10 في 2026/11/16", and "كان موعده الأصلي 2026/12/26. أُجِّل مرة واحدة، بزيادة 10 أيام على الموعد الأصلي" | All five | `SN/ar/023-…-full.png`, `SN/ar/029-…-full.png` | Keep only the last answer to a date request: "New date 5 Jan 2027, agreed by خالد الشمري". |
| Action page, card "قبول المخاطر / Risk acceptance" with a full-width button on every open action, also on a draft and on an action already handed over | AN, SN, MN, AR, MR | `AN/ar/032-…-full.png`, `AR/en/024-…-full.png` | Move to a menu item "The company decides not to do this". Is a manager meant to sign it? (part 5) |
| Project tab "التتبّع / Trace" | All five | whole tab | Cut |
| Project tab "سجل النشاط / Activity" | All five | whole tab | Cut |
| Progress tab, card "التسليم / Handover": "لم يُسلَّم التقرير بعد", "راعي العميل", "يُبلَّغ حين يبلغ إجراء متأخر آخر مستوى تصعيد. يُسمّى ضمن أدوار العميل في تبويب الفريق." On Rawdah it says "The report hasn't been handed over yet" on a project that is closing. | All five | `AN/ar/012-…-full.png`, `AR/en/011-…-full.png` | Remove |
| Progress tab measures: "وسيط الانتظار 0 يوم / Median wait", "تم التحقق في الموعد 100% / Verified on time", "تغييرات الموعد / Due date moves", "مراجعات طلبت تعديلات 50% / Reviews asking for changes", "بلا نشاط منذ 14 يوماً / No activity in 14 days", "على ماذا يستند التحقق: أدلة العميل نفسه، سجّلها مستشار، كلاهما / What verified actions rest on", "التأخر عن الموعد الأصلي / Late against the original date", "التحقق عبر الوقت … اللقطات الشهرية / monthly snapshots" | All five | same | Remove; keep the percentage and the six outcome counts |
| Report page tiles "أُجّلت 1" and "أيام التأخير 10: الأيام المضافة على المواعيد المتفق عليها عند الإسناد" | AN, SN, MN | `MN/ar/028-…-full.png` | Product owner's call: the firm chose to share this report |
| Team tab: "يُبلَّغ الراعي عند آخر مستوى تصعيد / The sponsor is told at the last escalation level"; role "معتمد التسليمات / Acceptor" | All five | `AN/ar/019-…-full.png` | "Who speaks for the company on this project." |
| Meeting agenda written by the system: "متأخرة، بانتظار المراجعة، متوقفة، ما تغيّر منذ الاجتماع السابق" with every action and its raw status | AN, SN, MN | `MN/ar/031-…-full.png` | Keep the three lists in words; drop "changed since the last meeting" for clients |
| Audit rows: `auth.sign_in`, `user cec45db2`, `العنوان: ::1`, `method=password` | AN, AR | `AN/ar/010-audit-1280.png` | Behind "details" |

Not seen on these screens although the code reading lists it for clients: an "aging bucket" label.

### 2.3 Firm vocabulary on client screens (U12)

The pattern: screens speak **about** "the client" **to** the client.

| Where | Arabic | English | Plain replacement |
|---|---|---|---|
| Home, counter hint | مطالبات تقدم من العميل، غير متحقق منها | Client-claimed progress, not verified | عمل جارٍ لم يراجعه المستشار بعد / Under way, not yet checked by your consultant |
| Home, counter hint | بلّغ عنها المسؤولون | Reported by owners | متوقفة لسبب ذكره صاحبها / Stopped, with the reason its owner gave |
| Home, counter and badge | مكتملة ومُتحقق منها | Verified complete | مكتملة / Done (the green already means checked) |
| Home, footnote | تقدم العميل المعلن ليس تحققًا: وحده قرار المستشار يجعل الإجراء مكتملًا ومُتحققًا منه، وهذا لا يثبت أثرًا فعليًا على أعمال المنظمة. | Claimed progress is not verification: only a consultant's review marks an action verified complete, and that still does not prove business impact. | يُعدّ الإجراء مكتملًا بعد أن يراجعه مستشاركم. / An action counts as done once your consultant has checked it. |
| Home and department page, indicators card | مقاييس العميل الخاصة لأعماله، تُدخل بمرور الوقت، بجانب العمل. | The client's own measures of its business, entered over time, beside the work. | أرقام أعمالكم التي تتابعونها شهريًا. / Your own business figures, month by month. |
| Rawdah home, empty indicators | — | No indicators yet. Add the measures the client already tracks… | Add the figures you already track… |
| Indicators, disclaimer | هذه الأرقام يبلّغ عنها العميل وليست أثرًا موثّقًا. تغيّر المؤشر ليس دليلًا على أن توصية ما هي السبب. | These figures are reported by the client and are not verified impact. A change in an indicator is not proof that a recommendation caused it. | هذه أرقامكم كما أدخلتموها، ولم يراجعها المكتب. تحسّن الرقم لا يعني أن توصية بعينها هي السبب. / These are your own figures as you entered them; the firm has not checked them. A better figure does not mean a recommendation caused it. |
| Indicators | خط الأساس، أفضل من خط الأساس | Baseline, Better than baseline | رقم البداية، أفضل من البداية / Starting figure, better than at the start |
| Projects card | badge "عميل"; line "العميل: شركة النخبة القابضة" | Client; Client: Al-Nukhba Holding | Remove both |
| Project, Recommendations tab | الملاحظات: ما رصده المستشارون. يمكن أن تعالج التوصيةُ إحدى هذه الملاحظات. | Findings: What the consultants found. A recommendation can answer one of them. | "الملاحظات" reads as "notes" in Arabic. Use "ما وجده التقييم / What the assessment found", inside each recommendation. |
| Project tabs | التتبّع، سجل النشاط | Trace, Activity | Cut |
| Recommendation page | رد العميل | The client's response | ردّ شركتكم / Your company's answer |
| Recommendation page (AN, AR) | لا مؤشر مرتبط بعد. اربط مؤشرًا يتابعه العميل… | The client has no indicators yet. Add them on the client's overview. | The "client's overview" is a firm page she cannot open. Remove the card when empty. |
| Recommendation badge | بانتظار الرد | Awaiting response | بانتظار ردّكم / Waiting for your answer |
| Requests tab | طلبات المعلومات؛ "من فهد الدوسري" | Information requests; "From فهد الدوسري" | مستندات مطلوبة منكم؛ "مطلوب من: فهد الدوسري" / Documents asked of you; "Asked of: …". "من / From" reads as the sender. |
| Requests tab and evidence list, status | بانتظار الإرسال | Waiting | لم يُرسل بعد / Not sent yet |
| Documents tab, every row | مشترك مع العميل | Shared with client | Remove (a client sees only shared files); show who added it and when |
| Team tab | أشخاص العميل في هذا المشروع؛ أدوار العميل؛ من يمثّل العميل | Client people on this project; Client roles; Who stands for the client | زملاؤكم في هذا المشروع؛ من يمثّل الشركة / Your people on this project; Who speaks for the company |
| Team tab | كل أشخاص العميل مضافون إلى هذا المشروع. | Everyone at the client is already on this project. | كل زملائكم مضافون. / All your people are on it. |
| Progress tab | محسوبة من العمل نفسه … يرى مديرو العميل ومسؤولوه الأرقام نفسها. | Counted from the work itself… The client's admins and managers see the same numbers. | Remove |
| Closing tab | The client's sponsor or admin decides and can withdraw it at any time. | | You or your sponsor decide… |
| Action page | الدليل الذي يتوقعه المستشار | Evidence the consultant expects | ما يثبت الإنجاز / What shows it is done |
| Action page status | مطلوب تعديل؛ متعثر؛ مُسند | Revision requested; Blocked; Assigned | أُعيد إليكم للتعديل؛ متوقف؛ لم يبدأ / Sent back to you; Stopped; Not started |
| Group page | الصيغة: عميل مرتبط | Form: Linked client | Remove the column |
| Departments page | يسجّل المكتب الإجراء تحت إدارة من صفحة الإجراء. | The firm files actions under a department on the action page. | يحدد المكتب إدارة كل إجراء. / The firm sets each action's department. |

### 2.4 The action page as a manager

| State (example) | Role | Next step shown | Places to send a file | Text boxes | Only the firm needs |
|---|---|---|---|---|---|
| In progress, with an evidence list (`60d3d21a`) | SN | Three buttons in this order: "الإبلاغ عن تعثر", "إرسال للمراجعة" (black), "إرفاق دليل". "Report a blocker" still comes first (U03). | 4 on the page: "إرفاق دليل" and three black "إرسال ملف", plus "إرسال للمراجعة", which also takes a file. Two mechanisms, explained by a three-sentence note. | 2 (progress note, discussion); a third is inside the send-file dialog per the code reading | Reminders, date history, slip sentence, risk acceptance |
| Blocked (`9cc4daf7`) | SN (owner), MN | One black button "استئناف العمل". Clear. MN gets the same button on the CEO's action. | 0 | 2 | Reminders with two dates already past (7 and 11 Nov) and no word on whether they were sent; date history; risk acceptance. The history card says "لا توجد تحديثات" although the action was blocked with a reason. |
| Awaiting review (`2ebe3f7a`) | MN (owner) | "بانتظار قرار المستشار" and the sign-off count. Nothing to press: right. | 0 (right: the walkthrough says no new files while it waits) | 2 | Sign-off count, reminders, risk acceptance, "ask for a new date" |
| Assigned (`1531cd35`) | SN, MN | One button "بدء العمل" on another person's action | 0 | 2 | Same cards |
| Revision requested (`a6a726cb`) | AN | "لا يوجد ما تقوم به في هذا الإجراء الآن." The reason is shown in the evidence list and again in the history. | 0 | 1 | Same cards |
| Verified (`066a00be`) | MN | "تحققت منه الشركة الاستشارية." Good. | 0 | 1 | Reminders (four future dates on finished work) |
| Draft (`f55a1d16`) | AN (owner), SN, MN | "لا يوجد ما تقوم به" to its own owner; reminder ladder; risk acceptance | 0 | 1 to 2 | Everything: a draft should not be on a client screen at all |
| In progress on a closing project (`69741cad`) | MR | "Mark as blocked", "Submit for review", "Attach evidence" on an action the Closing tab calls handed over | 2 | 2 | Same cards |

More than one black button in one card: the evidence list card holds three black "إرسال ملف" and the card above it one more (`SN/ar/029-actions_60d3d21a-1280-full.png`).

The evidence-list note is shown to people who cannot send anything: AN reads "ما طلبه المستشار منك. أجب عن كل بند بزر «إرسال ملف» الخاص به" on Finance's and Legal's actions with no such button (`AN/ar/034-…-full.png`, `AN/ar/028-…-full.png`).

On `60d3d21a` the history shows سلمى الشهري sent a file labelled "مذكرة المقارنة", while the list item "مذكرة المقارنة مع الحدود الحالية" still says "بانتظار الإرسال" for AN and SN. Either the file was not tied to the item or the walkthrough's "one item answered" is not what a client sees. `AN/ar/034-actions_60d3d21a-1280-full.png`.

### 2.5 Requests for documents against the evidence list

A client cannot tell them apart, and nothing tells them to.

- Both say the firm asked for something: "ما طلبه المستشار منك" (action) and "What the firm needs from you for this project" (project).
- Both use the status "بانتظار الإرسال / Waiting" and the button "إرسال ملف / Send a file".
- They differ only in where they live: an item on an action page, or the sixth tab of the project. Neither is on the home page.
- The real difference (a paper the firm needs to understand the company, against proof that an action is done) is never said.

For the client they should be one idea, "the firm asked you for a file", shown in two places with the same row: under its action when it proves that action, under the project when it does not. Both belong on the home page in one list. The firm can keep two records behind it.

### 2.6 People (U08, U13)

The path on the screens, as the client admin:

1. `/team`: black button "دعوة شخص / Invite someone" (`AN/ar/007-team-1280-full.png`). Dialog not captured.
2. Help, "First steps", step 2: "أضفهم إلى مشاريعهم: من تبويب الفريق في المشروع" (`AN/ar/004-help-1280-full.png`).
3. Project, Team tab: "Add a person" (`AR/en/018-projects_61d37bdc_tab_Team-1280-full.png`). On Al-Nukhba the button is replaced by "كل أشخاص العميل مضافون إلى هذا المشروع".
4. **The path ends here.** No action page offers the admin an owner control. On every action that is not his, the "Next step" card says "لا يوجد ما تقوم به في هذا الإجراء الآن" (`AN/ar/028-…`, `AN/ar/034-…`). On the Team tab, beside each person who owns work, the text "أعد إسناد إجراءاته أولًا / Reassign their actions first" is not a link (`AN/ar/019-…-full.png`). The person he invited can be on the project and can never be given an action by him.

The code reading agrees and adds: the app's rules allow a client manager, not the client admin, to change an owner, and no screen offers it to anyone. The screens add one thing: a manager already acts on colleagues' actions in other ways (MN has "استئناف العمل" on the CEO's action and "بدء العمل" on عبدالله's), so the gap is only the owner.

Every place people, roles and departments are handled on the client side:

| Place | What | Who |
|---|---|---|
| `/team` | Accounts: invite, change e-mail, other-language name, switch off; e-mail domains; access review | AN, AR. Managers get a read-only table (name, mail, role, projects). |
| `/departments` | Departments on or off; add, rename, switch off; members; heads | AN, AR. Managers read. |
| Project, Team tab, first card | Which colleagues are on the project | AN, AR |
| Project, Team tab, second card | Sponsor, coordinator, steering committee, acceptor, observer | AN, AR name; others read |
| Project, Closing tab | "Name who sustains it" for a handed-over action | AR |
| Help | The firm's consultants (lead, deputy, per project) | All five, read-only. The project Team tab does not list them. |

Four places to manage, one more at closing, and the consultants on a sixth.

### 2.7 Departments and "Our group"

- **The switch.** For the admin it is drawn on, in Arabic (dark track, knob on the left, which is the "on" side in a right-to-left page) and in English (`AN/ar/008-departments-1280-full.png`, `AN/en/008-departments-1280.png`). For the managers, who cannot change it, the same "on" switch is drawn dimmed grey and reads as off (`MN/ar/008-departments-1280.png`, `MN/en/008-departments-1280.png`; compare a real "off" at `MR/en/008-departments-1280.png`). No word beside it says "On". So the earlier bug is fixed for the admin and still there for SN and MN.
- The text under the switch only describes switching off ("عند إيقافها يرى كل من في المشروع كل عمله من جديد").
- Each department card has its own "إيقاف / Switch off" beside the page's switch: two different "off" on one screen.
- MN sees all three departments with their members and heads. Names of departments and people are not work, so this is acceptable; the links to Finance and Legal are the fault (they lead to "Not found").
- Rawdah (departments off): the sidebar still has "Departments"; the page is an empty state with a black "Add" button for AR and an empty read-only page for MR.
- "Our group" (AN only): 11 %, "1 of 9", and one row per company. Al-Nukhba's row (13 %, 1 of 8, 6 open, 3 overdue) matches his home page. The subsidiary shows "0 of 1".

### 2.8 Business indicators

- Entering this month's value, as MN: home → click the indicator row → "إدخال قيمة" → type and save. Two clicks to the form. The home card shows October's 66 % and nothing says November is due; the indicator page marks "نوفمبر 2026: بانتظار القيمة" (`MN/ar/019-indicators_9d456655-1280-full.png`).
- "Client-reported, not verified impact" appears in five places in firm wording (home card, department page, indicator page, recommendation page, data page). See 2.3 for plain words.
- Does a screen suggest Selah proved an improvement? Not outright: the disclaimer is always there. Three things lean that way: the badge "أفضل من خط الأساس" and the home tiles "أفضل من خط الأساس 2 / أسوأ 0"; "نحو المستهدف 63.2 %"; and the card "التوصيات المرتبطة: التوصيات التي يُتوقع أن تحرّك هذا المؤشر", which sits the recommendation beside the improving line. All are arithmetic on the client's own entries; the words "better" and "expected to move" are the app's.
- The client admin can edit, switch off, link and unlink an indicator and a recommendation ("ربط", "فك الربط", `AN/ar/024-…-full.png`, `AN/ar/037-…-full.png`). Linking a figure to a recommendation is the consultant's statement; see part 5.

### 2.9 The client assistant

- Where it lives: a sidebar row "المساعد الذكي" for AN, SN, MN; "اسأل المساعد" on action and recommendation pages; it opens as a floating dark card. For AN the row first opens a page that only says the assistant is a card.
- The consent: I could not see the notice itself, because AN has already agreed. From the message file it has six plain sentences (what it reads, what it never sees, that it does not rule on law or decide, how chats are kept, who may use it) and "قرأت هذا وأوافق نيابة عن شركتي". After agreeing, the page shows no trace of it: not who agreed, not when, not the text, only "أوقف المساعد" (`extra/admin_at_nukhba.test/ar/003-assistant-1280.png`).
- AN's bell still says "عرض المكتب على شركتك المساعد. اقرأ الإشعار لتفعيله." as unread although the assistant is on (`AN/ar/002-notifications-1280-full.png`).
- Documents tab rows carry "متاح للمساعد"; the file menu offers "السماح للمساعد بقراءته".
- Rawdah: no sidebar row, no "Ask the assistant" button, `/assistant` is "Not found" for AR and MR. One trace remains: the badge "Available to assistant" on a file in Rawdah's Documents tab (`AR/en/016-projects_61d37bdc_tab_Documents-1280.png`). It should not show where there is no assistant.
- With the Files card and the assistant card open, three sidebar rows are highlighted at once (`extra/manager_at_nukhba.test/ar/002-card_assistant-1280.png`).

### 2.10 Help (U17)

- Repeats from home: "First steps" (for managers all three steps point to Overview and Actions) and "إجراءاتك المفتوحة / Your open actions".
- Reaching the firm's admin: the only route is the "مشكلة تقنية / Technical problem" form, described as "لشيء في صلة لا يعمل كما ينبغي". The small print says it goes to "مسؤولي النظام في المكتب، لا إلى مستشاريك", five a day. A client unhappy with the consultant has no route that says so: "Ask your consultant" goes to the consultant, and "Your consultants" lists only the lead, the deputy and the project's consultants with their mail. The firm admin is not named anywhere.
- Rawdah: "No consultant is on this project yet. Ask your lead consultant." on a project that is closing.

### 2.11 Rawdah's closing project

What is good: the banner "This project is closing. Work goes on until every open item is settled."; the Closing tab quotes her own request and says the firm started closing "as asked"; the handed-over action names who carries it on and why.

What is missing or confusing:

- Nothing says what happens next or whether anything is still expected of her ("the firm's admin closes the project; after that it is read-only and the closure report is here").
- Two recommendations still say "Awaiting response" with a "Respond" button. Must she answer before closing? The screen does not say.
- The handed-over action is "In progress" on four other screens, with reminders set for January 2027, "Accept the risk", and for MR "Submit for review".
- The Progress tab says "The report hasn't been handed over yet" and "Verified on time 0 %".
- The banner uses a padlock, the mark for firm-only content.
- MR sees the same Closing tab read-only, including her message and the case-study consent. Fine.

### 2.12 English

- No Arabic left in the app's own labels on the English screens I opened (home, actions, project and all tabs, action, recommendation, help, team, departments, notifications for AR and MR). All flagged strings are data.
- Cut-off text: on the recommendation page the action titles are cut ("Write KPI cards for each g…", "Board of trustees approve…") with room to spare (`AR/en/026-recommendations_7cb92536-1280.png`).
- The meeting agenda prints dates as "12-11-2026" and statuses as "(in_progress)" in both languages.
- Firm voice in English: "The client's response", "The client has no indicators yet. Add them on the client's overview.", "Everyone at the client is already on this project", "The client's sponsor or admin decides".
- 768 px: only Arabic was captured. Home, project and action pages hold together; the ten tabs just fit.

### 2.13 Isolation as seen on screen

The coordinator (MN) must not see Finance's or Legal's work. The action and recommendation pages are closed to her. These are not:

| Where | What she sees | Evidence |
|---|---|---|
| Steering meeting of 22 Nov (she is invited) | The agenda lists all eight actions by title with status: "مراجعة حدود الصلاحيات المالية (الاستحقاق 12-11-2026)", "إعداد لائحة عمل اللجنة (revision_requested)", "جمع إقرارات الأعضاء لعام 2026 (closed)", "تحديث مصفوفة الصلاحيات ورفعها للمجلس (in_progress)" | `MN/ar/031-meetings_574c3428-1280-full.png` |
| Finance workshop of 18 Nov (she is not invited; attendees are خالد, سلمى, نورة) | She can open the page; the agenda names both Finance actions, one with its due date | `MN/ar/030-meetings_5ec72542-1280.png` |
| Steering meeting of 9 Nov | Same agenda with Finance's and Legal's late actions; follow-ups for سلمى | `MN/ar/029-meetings_beaa4143-1280-full.png` |
| Project, Activity tab | The same full list as the admin: "سلمى الشهري طلب موعدًا نهائيًا جديدًا" (twice), "خالد الشمري وافق على موعد نهائي جديد", "عبدالله المطيري قدّم دليلاً", "عمر الزهراني غيّر الحالة من بانتظار المراجعة إلى مطلوب تعديل", "فهد الدوسري سجّل قبول العميل للمخاطرة" | `MN/ar/016-…-full.png` against `AN/ar/018-…-full.png` |
| Monthly report | Whole-project numbers (1 of 8, 3 overdue, 6 open) and the note "مصفوفة الصلاحيات متأخرة أسبوعين" | `MN/ar/028-reports_e2b73197-1280-full.png` |
| Recommendations tab | The Finance finding "حدود الصلاحيات المالية مرتفعة" with "لا توصية بعد" | `MN/ar/009-projects_8c55994f-1280-full.png` |
| `/departments` | Links to Finance and Legal that end in "Not found" | `MN/ar/008-…`, `MN/ar/025-…` |

What holds: her home, Actions list, Progress tab, Trace tab, Documents tab (no Finance or Legal evidence files) and indicators show only her department and company-wide work. Nothing of Rawdah appears on any Al-Nukhba screen, or the other way round. The firm-only notes file is absent from every Documents tab.

Whether the steering agenda and the shared report should be whole-project for a steering member is the product owner's call (part 5). The Activity tab and the Finance workshop are plain leaks.

### 2.14 Other marks

- **Raw keys**: meeting agenda "(in_progress)", "(revision_requested)", "(blocked)", "(closed)", "(verified_complete)", "(awaiting_review)", "(assigned)" (`MN/ar/031-…-full.png`); audit rows (2.2).
- **Console errors**: "Hydration failed" on both scheduled meetings (`/meetings/5ec72542…`, `/meetings/574c3428…`) for AN, SN and MN in both languages; the held meeting is clean. A hydration warning on MN's English Help page.
- **Held meeting with no summary**: the meeting of 9 Nov is "انعقد" and shows "لا يوجد ملخص بعد" to AN and MN, with every attendee still "لم يرد بعد" (`AN/ar/040-…-full.png`). The walkthrough says it has a summary. Either it is not shared with the client or it is missing; I cannot tell which.
- **Text that explains the screen**: the evidence-list note (three sentences on which button counts for which item); "الأرقام من سجلات العمل الفعلية…" under the home page; "يحسب الإجمالي إجراءات هذه المشاريع كلها معًا، وليس متوسطًا لنسبها" under every progress table; the whole `/assistant` page; "Client managers and action owners see only the projects they're on, and only people on the project can own its actions. Client admins see every project."
- **Decoration**: the "moved" card stamps every row "قبل 26 دقيقة" (the data was loaded then); the padlock on Rawdah's closing banner.
- **Black buttons**: the evidence list holds three in one card (rule: one). On the home page the same button is black on Rawdah ("New indicator", `AR/en/001-home-1280-full.png`) and outlined on Al-Nukhba ("مؤشر جديد", `AN/ar/001-home-1280-full.png`); with "Confirm" in the card above, Rawdah's admin opens on two black buttons, one per card.
- **Selah doing the consultant's job**: nothing on these screens decides for a person. Closest: "أفضل / أسوأ من خط الأساس" on the client's figures (2.8).
- **Shared items without who and when**: Documents tab rows (guideline 11 asks for both). The report page has both.

---

## 3. The 18 findings and the batch 0 bugs, for these pages

| # | Today | One sentence | Evidence |
|---|---|---|---|
| U01 same late actions on many screens | Still true | A late action of Al-Nukhba appears on the home list, the Actions list, the project page, the "moved" card, the department page, the meeting agenda, the report and (for its owner) Help: eight places. | `AN/ar/001-…-full.png`, `006`, `011`, `021`, `MN/ar/031-…` |
| U02 project page with too many tabs | Still true | Ten tabs for a client admin, sponsor and Rawdah's manager, nine for the coordinator; the row starts at 405 to 517 px in Arabic. | `AN/ar/011-projects_8c55994f-1280.png` |
| U03 action page | Partly true | Next step is first and is right when blocked, waiting or verified; in progress still opens with "Report a blocker", and the page has up to five places to send a file and two text boxes. | `SN/ar/029-…-full.png` |
| U04 client homes | Still true | See 2.1: the job is in the bell, the counters do not match the lists, Rawdah's admin is told nothing needs her. | `AR/en/001-…`, `AR/en/002-…` |
| U05 ways to send a file | Still true | A manager meets five: "Submit for review", "Attach evidence", "Send a file" on an evidence item, "Send a file" on a request, "Add a file" in the Files card; plus "new version" in a file's menu. | `SN/ar/029-…`, `AN/ar/016-…`, `extra/manager_at_nukhba.test/en/001-card_files-1280.png` |
| U06 findings as step one | Still true (client side) | Findings fill the first screen of the Recommendations tab above the plan. | `AN/ar/011-…-full.png` |
| U08 invite but cannot give work | Still true | The path ends at the project Team tab; "Reassign their actions first" has nothing behind it. | `AN/ar/019-…-full.png`, `AN/ar/028-…-full.png` |
| U09 long sidebars | Partly true | Managers get Team and Departments, both read-only for them; Rawdah gets Departments while departments are off; the admin has 8 rows plus Help and Files. | `MN/ar/001-…`, `MR/en/008-…` |
| U10 status words | Still true | One action page shows "بانتظار الإرسال", "غير مقبول", "مطلوب تعديل", "تمت الموافقة", "مقبول", "قُبل" for neighbouring things; "بانتظار الرد" is both a recommendation and a date request. | `AN/ar/028-…`, `SN/ar/029-…` |
| U11 firm machinery | Still true | Every item of 2.2. | |
| U12 firm vocabulary | Still true | Every item of 2.3. | |
| U13 people in several places | Still true | Four managing places on the client side, a fifth at closing (2.6). | |
| U14 meeting page before the meeting | Still true | Empty "الملخص" and "القرارات" cards on both scheduled meetings. | `MN/ar/030-…`, `MN/ar/031-…-full.png` |
| U15 rare actions as visible buttons | Still true | Departments: 21 buttons for three departments; Requests: "إرسال ملف" and "لا ينطبق" on every row; risk acceptance on every action. | `AN/ar/008-…-full.png`, `AN/ar/016-…-full.png` |
| U17 Help as a second home | Still true | First steps and "your open actions" come before the help. | `MN/ar/004-help-1280-full.png` |
| U18 lists that hide what matters | Still true | Actions list unsorted by need; Activity lines without the thing they are about. | `AN/ar/006-…`, `AN/ar/018-…` |
| B1 raw status keys on the agenda | Still true | Seven different keys on one agenda. | `MN/ar/031-meetings_574c3428-1280-full.png` |
| B2 three percentages | Partly true | Two for the admin (13 % and a bar at 1 of 9); for the coordinator 25 % on her pages and 13 % in the report. | `AN/ar/005-…`, `MN/ar/028-…` |
| B3 reminder ladder on finished actions | Partly true | A sentence now says it is paused, but the card and its four dates are still drawn on verified, closed and draft actions; on the blocked action two dates are already past with no mark. | `MN/ar/022-…-full.png`, `SN/ar/023-…-full.png` |
| B4 departments switch drawn off while on | Partly true | Right for the admin in both languages; drawn dimmed, like off, for the two Al-Nukhba managers. | `MN/ar/008-departments-1280.png` |
| B5 hydration error on the meeting page | Still true | Both scheduled meetings, three roles, both languages. | records `AN/ar` 41 and 42 |

U07 and U16 are firm pages and not in this area.

Where the screens and the code reading differ: (1) the code reading could not tell B4 or B5; the screens settle both. (2) It says the assistant has a page only for an admin who may consent; SN and MN also get the page at `/assistant` with "افتح المساعد". (3) It lists an aging bucket on the client's action page; I did not see one. (4) It says the home counters count every status; on screen assigned, draft and closed actions are in no counter. Everything else agrees.

---

## 4. Proposed target

### Sidebar

| Role | Today | Proposed |
|---|---|---|
| Client admin (AN; AR without the assistant and the group) | Overview, Projects, Actions, Assistant · Team, Departments, Our group, Audit log · Help, Files | Home, Projects (opens the project when there is one), Actions, Assistant (only when on) · People (accounts, with departments as a section) · Our group (only when granted) · Help, Files. In the user menu: Company settings (data sharing, assistant on or off with the notice he agreed to, audit log), Notifications and mail, Two-step sign-in. |
| Client manager (SN, MN, MR) | Overview, Projects, Actions, Assistant · Team, Departments · Help, Files | Home, Projects, Actions, Assistant (only when on) · Help, Files. Team and Departments leave the menu: a manager reads who is who on the project's People tab, which gains the consultants. |

Where the removed things live: the audit log and data sharing in Company settings (admin); departments inside People (admin); the read-only people list on the project's People tab (managers); mail choices in the user menu.

### Home page (replaces Overview for all five)

One list, "Waiting for you", built from what these screens already hold, in this order: recommendations waiting for the company's answer (admin and sponsor); documents the firm asked for (the person named, and the coordinator); evidence sent back; your actions that are late or stopped; date requests answered; meetings to reply to and the next meeting; an indicator value that is due. Then one progress line per project (the percentage and "1 of 8"), and for a department head their department. The data-sharing question becomes one row in the list, not a card above everything. The four counters, the indicators card and the long footnote go; the indicators stay one click away on the project or department line.

### Project page tabs

| Today (10) | Proposed for client roles (5) |
|---|---|
| Recommendations | **Plan**: recommendations with their actions; each finding shown inside its recommendation; the percentage and outcome counts as one line at the top |
| Progress | folded into Plan (percentage) and Files (reports) |
| Trace | removed |
| Meetings | **Meetings** |
| Assessments | inside Files, only when one is shared |
| Requests | **Requests**, second, with the open count on the tab |
| Documents | **Files**: documents, shared reports, shared assessments, each with who and when |
| Activity | removed |
| Team | **People**: your people, who speaks for the company, the firm's consultants |
| Closing | a tab only while closing or closed; before that "Ask the firm to close" in the project menu |

All five get the same five. The coordinator's copies of Meetings and Files follow what she may see.

### Action page

Next step (one black button), then what the firm asked for with one "send a file" per item, then one conversation box, then history. Side: project, recommendation, owner, due date. In a menu: ask for a new date, the company decides not to do this, mute mail. Gone: reminders, date history, sign-off count.

### What a role runs into and cannot do today

- The admin and the coordinator cannot change an action's owner; the Team tab tells them to.
- No client can reach the firm's admin except through a form named "Technical problem".
- The admin cannot re-read the assistant notice he agreed to.
- A handed-over action carries no mark outside the Closing tab.
- The home page cannot show a recommendation, a document request, a meeting reply or a due indicator value.
- The Documents tab cannot take a new file; only the Files card can.

---

## 5. Open questions

1. A department-limited manager who sits on the steering committee: should the steering agenda and the shared monthly report show her the whole project, or only what she may open? Today they show everything, and the Activity tab and another department's workshop do too.
2. Should a client ever see a draft action? Today all three Al-Nukhba roles see one, with a reminder ladder and a risk-acceptance button.
3. May a client manager move a colleague's action (resume, start, submit) and sign a risk acceptance? Today the coordinator can do both on the CEO's blocked action.
4. Who on the client side may change an action's owner: the admin only, or the coordinator and sponsor too? Must the consultant be told?
5. Should a client admin link a business indicator to a recommendation, or is that the consultant's statement?
6. Rawdah: must the company answer its recommendations before a project closes? Two are unanswered while closing is under way.
7. Should a client have a named route to the firm's admin for a complaint, separate from "Technical problem"?
8. Should "Departments" be offered at all to a company that has them switched off?
9. All five can book a meeting from the project. Intended?
10. Should the held meeting's summary be visible to the client? Today the held steering meeting shows "no summary yet" to the admin.
