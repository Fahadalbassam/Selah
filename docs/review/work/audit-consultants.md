# Page audit: the consultants

Accounts: `lead@mizan.test` (lead of Al-Nukhba), `deputy@mizan.test` (deputy of Al-Nukhba, lead of the firm-run subsidiary, owner of a pitch), `consultant@mizan.test` (staffed on the board project), `observer@mizan.test` (observer on the board project), `lead2@mizan.test` (lead of Rawdah and of the firm-run Al-Waha).

Evidence paths are relative to `docs/review/shots/phase1/`. Short folder names used below: `lead/` = `lead_at_mizan.test/`, `deputy/` = `deputy_at_mizan.test/`, `consultant/` = `consultant_at_mizan.test/`, `observer/` = `observer_at_mizan.test/`, `lead2/` = `lead2_at_mizan.test/`.

In parts 2 and 3 a path written with "…" (for example `lead/ar/011-…-1280-full.png`) is a shortened form of a path given in full in part 1. "(record)" after a path means the page was judged from its `pages.json` record and the image was not opened.

How this was done: every record in `pages.json` was read for the five accounts (Arabic; English for lead, deputy, consultant). About 45 Arabic screenshots were opened (first screen, full page or tablet). The code reading in `work/code-recheck.md` was read afterwards and is cited where it confirms or corrects the screen.

**Three limits of the captured material, so nobody reads more into this file than is there:**

1. **`/team`, `/team/expertise`, `/assistant` and the two floating cards come from a second capture** (`docs/review/shots/phase1-extra/`, cited below as `../phase1-extra/…`). When this file was written that capture held the Arabic pass for lead, consultant and observer, and the `/team` screenshot for lead2; nothing yet for the deputy. **Both floating cards were caught while still loading**: the Files card shows its title, search box and grey placeholder rows; the Assistant card shows only the logo, and its record holds the Files card's text by mistake. So the Files card is judged on its frame only and the Assistant card is not judged.
2. **`/help` shows "غير موجود" for all five accounts, but nothing links to it.** The capture script opens `/help` for every account as a fixed starting address. Firm staff have no Help link. This is not a broken link.
3. The Arabic pass ran first, so every project page shows the "since your last visit" card (the English pass, run second, does not). Both states are real; the numbers below say which pass they come from.

---

## 1. One row per page

"Controls" = visible buttons + items inside menus, page body only, Arabic pass, for the busiest consultant position. Project-tab counts each include one "عرض 3 أخرى" button from the last-visit card.

| Route | Roles (positions) | Purpose | Controls | First screen 1280x800 | First screen 768x1024 | Verdict | Reason | Evidence |
|---|---|---|---|---|---|---|---|---|
| `/` Overview | All five. Same layout for all. | Four counters of every action the person can open, and a table of up to ten late or waiting actions. | 0 + 0 (8 links) | Lead: 4 counter cards, red "متأخرة: 3" bar, 4-row table. All above the fold. lead2: counters and "لا يوجد ما يحتاج انتباهك الآن". | No overflow (record). Not opened. | **merge** into Today | It is the landing page, but it is not scoped to the person: the plain consultant gets the same three late rows as the lead, and lead2 is told nothing needs him while Today holds a decision for him. Counters go to one line at the top of Today; the table rows are already Today's first two sections; blocked and sent-back rows that are not yet late go into Today's "due" section; the footnote stays. | `lead/ar/001-home-1280.png`, `lead2/ar/001-home-1280.png`, `lead2/ar/005-today-1280.png` |
| `/today` | All five. Lead and deputy: 5 sections. Staffed: 4 (no "due this week"). Observer: empty state plus "since last visit". lead2: decisions and "since last visit". | What waits for me across clients: reviews, late work I lead, my meetings, decisions, changes since my last visit. | 0 + 0 (10 links) | Lead: review (1 row), due this week (3 rows), first meeting row. "بانتظار قرارك" starts at about 830 px, below the fold. | No overflow (record). Not opened. | **keep** (make it the home) | The only page that answers "what do I do now" per person, and the only cross-client list of meetings, decisions and changes. Needs two fixes: see marks N2, N3. | `lead/ar/005-today-1280-full.png`, `consultant/ar/005-today-1280-full.png`, `observer/ar/005-today-1280.png` |
| `/notifications` | All five | The list of notifications, and below it the person's mail settings. | 26 + 0, 4 fields | Title, unread count, about 10 notification rows. The mail settings start on screen 2. | No overflow (record). 1.6 to 2.7 screens. | **trim** | Two jobs on one page. Move "البريد" (mail choices, quiet hours, muted actions) to the user menu beside Security; keep the list. | `lead/ar/002-notifications-1280.png` |
| `/security` | All five | Turn on two-factor sign-in. | 1 + 0, 1 field | Whole page. | Whole page. | **keep** | One job, one button. | `lead/ar/003-security-1280.png` |
| `/actions` | All five. Same table; only the rows differ. | Every action I can open, by due date. | 1 + 0 (Excel), 23 links | Tab row (الإجراءات / بانتظار المراجعة / الإشراف), 10 rows, all statuses mixed. | No overflow (record). | **keep** | The one full list. It has no filter, so the three late rows and the one waiting row are found by eye (U18). | `lead/ar/007-actions-1280.png` |
| `/review` | All five. Lead and deputy: "واحد لمراجعتك". Staffed: "none yours to check" (he signed first). Observer: read only. lead2: empty. | Evidence waiting for the firm's decision, longest wait first, with the sign-off stage. | 0 + 0 | One row, with "الثاني من اثنين · اعتمده عمر الزهراني". | No overflow (record). | **merge** into `/actions` | Same rows as Today section 1 and as the Actions list. Becomes the "بانتظار المراجعة" view of the Actions list with its two extra columns (waiting days, sign-off stage). "Mine to check" stays on Today. | `lead/ar/037-review-1280.png` |
| `/oversight` | All five. Lead, deputy, staffed: 7 buttons (3 filters, 4 "تذكير المالك"). Observer: 3 (filters only). lead2: 0. | Per open project: a health label and counts; then every action that breaks a rule, with a remind button. | 7 + 0 | 4 tiles, the rule paragraph, the 2-row health table. The exceptions table (the part with a button) starts at about 630 px. | No overflow (record). | **trim** | The exceptions table with "remind owner" is the only place to chase late work; keep it. Drop the label "متعثر / تحت المراقبة / على المسار" (the app's own verdict on a project, and "متعثر" is also the status word for a blocked action); keep the counts. Hide the tab from a consultant who leads nothing: the staffed consultant gets "remind owner" on work he does not run. | `lead/ar/038-oversight-1280-full.png` |
| `/projects`, `?kind=client`, `?kind=internal` | All five | Cards of the projects I can open. | 1 + 0 | 1 to 3 cards and "مشروع داخلي جديد". | No overflow (record). | **trim** | Three sidebar rows (كل / مشاريع العملاء / الداخلية) to filter one to three cards. One row "المشاريع" is enough. The card's bar counts 1 of 9 while the project says 13% (1 of 8): see N6. | `lead/ar/045-projects-1280.png` |
| `/projects/:id` tab "التوصيات" | All five. Lead, deputy, staffed: identical, 22 buttons + 11 in menus. Observer: 6 buttons (show more, Excel, 4 "اسأل المساعد"), an "مراقب" badge, no add buttons. | The plan: findings, then each recommendation with its actions. | 22 + 11 | Arabic first visit: header, the "تحرّكت 8 إجراءات" card (325 px), tab row at **517 px**, then only the Findings heading and two finding rows. No recommendation is visible. Without the card (English pass) the tab row is at 192 px. | Same order; tab row at about 535 px and **cut off**: "الفريق" is half visible, "الإغلاق" is off screen. | **trim** | The plan is the page, but the first recommendation starts on screen 2. Findings come first with an "إضافة توصية" on every row (3 on this project) plus a solid one in the section header plus "استيراد". Move findings under the recommendations they led to; keep one "إضافة توصية". Show the last-visit card once (on Today), not above every tab. | `lead/ar/010-projects_8c55994f-1280.png`, `lead/ar/010-projects_8c55994f-1280-full.png`, `lead/ar/010-projects_8c55994f-768.png`, `observer/ar/010-projects_8c55994f-1280-full.png` |
| `/projects/:id` tab "التقدم" | All five | The project's numbers and its reports. | 2 + 0 | Header, last-visit card, tab row; below them only the top of the "التسليم" card. The 13% is on screen 2. | Not opened. | **trim** | First card is "التسليم: لم يُسلَّم التقرير بعد", which a lead reads once. Put the 13% block first, reports second, handover last. "التحقق عبر الوقت" is an empty card until two monthly snapshots exist: hide it until then. | `lead/ar/011-projects_8c55994f_tab_التقدم-1280-full.png` |
| `/projects/:id` tab "يحتاج انتباهاً 3" | All five (firm only) | The project's actions that break a rule (late, stale, slipped). | 1 + 0 | Rule sentence and 3 rows, partly below the fold. | Not opened. | **merge** into the plan tab | The same three actions are already on the plan tab with a red date. A count chip on the plan tab that filters to them does the same job. | `lead/ar/012-projects_8c55994f_tab_يحتاج_انتباهاً_3-1280.png` (record read; image not opened) |
| `/projects/:id` tab "التتبّع" | All five | A tree from assessment and finding to recommendation, action, evidence and review. | 1 + 0, 18 links | Explaining paragraph and the top of the tree. | Not opened. | **cut** | Every link in the tree is already on the plan tab and the action page. The one thing unique to it (evidence and review result per action) belongs on the action row of the plan tab. A lead does not open it weekly. | `lead/ar/013-projects_8c55994f_tab_التتبّع-1280.png` (record read; image not opened) |
| `/projects/:id` tab "الاجتماعات" | All five. Observer has no "حجز اجتماع". | The project's meetings and a button to book one. | 2 + 0 | Three meeting rows. | Not opened. | **keep** | Short and used weekly. | `lead/ar/014-projects_8c55994f_tab_الاجتماعات-1280.png` (record) |
| `/projects/:id` tab "التقييمات" | All five. Observer still has "بدء تقييم". | The assessments run for this project. | 2 + 0 | One row: "التقييم المبدئي ٢٠٢٦ · 37.5% · 6 gaps · مسودة". | Not opened. | **merge** into the plan tab | One row per project, opened a few times in a project's life. It is where findings come from, so it sits with the findings. The draft row carries no "firm only" mark (N14). | `lead/ar/015-projects_8c55994f_tab_التقييمات-1280.png` (record) |
| `/projects/:id` tab "الطلبات" | All five. Lead, deputy, staffed: 25 buttons. Observer: 1. | The list of documents asked of the client, and what came back. | 25 + 0 | Counts line, two add buttons, first item. | Not opened. | **merge** with "المستندات" into one "الطلبات والملفات" tab | A request and the file that answers it are the same subject. Each of 4 rows shows 5 buttons (إرسال ملف, إرسال رابط رفع, لا ينطبق, تعديل, حذف): keep the one that fits the row's state, put the rest in a "…" menu. | `lead/ar/016-projects_8c55994f_tab_الطلبات-1280-full.png` |
| `/projects/:id` tab "المستندات" | All five. Lead: 19 + 19. Deputy and staffed: 19 + 13 (no "سحب هذا الملف"). Observer: 13 + 0. | The project's files and who can see each. | 19 + 19 | Six evidence files with no controls, then six project files with "الملخص", assistant and "…" each. | Not opened. | **merge** (see row above) | Two kinds of row in one list with no heading between them. There is no way to add a file here (only from the Files card). | `lead/ar/017-projects_8c55994f_tab_المستندات-1280-full.png` |
| `/projects/:id` tab "سجل النشاط" | All five | Who did what, newest first. | 1 + 0 | List. | Not opened. | **merge** into "التقدم" as a link at its foot | A record to consult, not a weekly page. | `lead/ar/018-projects_8c55994f_tab_سجل_النشاط-1280.png` (record) |
| `/projects/:id` tab "الفريق" | All five. Lead and deputy: 10 buttons. Staffed and observer: read only. | Who from the firm and from the client is on this project, and the client's named roles. | 10 + 0 | Two cards side by side (firm staff, client people). | Not opened. | **keep** | The lead does staff here. Three cards each open with a two-line explanation; cut those to one line. | `lead/ar/019-projects_8c55994f_tab_الفريق-1280-full.png` |
| `/projects/:id` tab "الإغلاق" | All five. Lead and deputy: "بدء الإغلاق". Staffed and observer: text only. lead2 (Rawdah, closing): 4 buttons. | Close the project: settle open actions, write lessons, record the case-study consent. | 2 + 0 (4 on Rawdah) | Open project: one paragraph and one button. Closing project: banner, status, open-actions table. | Not opened. | **replace** with a "بدء الإغلاق" item in the page header until closing starts; then show the tab | A whole tab for one button during most of a project's life. Once closing has started the tab is good: lead2's page states plainly what is settled and that the firm admin closes. | `lead2/ar/020-projects_61d37bdc_tab_الإغلاق-1280-full.png` |
| `/projects/:id/import` | Lead, deputy, staffed, lead2 (observer has no link to it) | Read findings, recommendations and actions from an Excel or Word file. | 2 + 0, 1 field | Whole page. | Whole page (record). | **keep** | Clear three-step page. | `lead/ar/049-projects_8c55994f_import-1280.png` (record) |
| `/actions/:id` | All five. Lead and deputy: 6 to 12 buttons by state. Staffed: the same less "second sign-off" (he signed first). Observer: 3 to 5. | One action: decide on the evidence, follow the conversation, see its dates. | 12 + 0, 2 fields (revision requested, lead) | "الخطوة التالية" card first, then evidence list, discussion; facts in the side panel. | Stacks to one column; next step still first. | **trim** | The reviewer's decision is first only when evidence is waiting (and on a draft). In four other states the card offers only "إغلاق الإجراء" as the next step; a date change to decide sits in the side panel. Six cards are always drawn even when empty. Details in the section under this table. | `lead/ar/023-actions_2ebe3f7a-1280-full.png`, `lead/ar/021-actions_8b57150a-1280-full.png`, `lead/ar/022-actions_a6a726cb-1280.png`, `lead/ar/023-actions_2ebe3f7a-768.png` |
| `/recommendations/:id` | All five. Observer keeps "ربط" and "فك الربط". | One recommendation: the client's answer, linked indicators, its actions. | 4 + 0 | Title, the client's answer card, linked indicators. | No overflow (record). | **keep** | One subject, one screen. | `lead/ar/050-recommendations_09ea46af-1280.png` (record) |
| `/meetings/:id` | All five. Deputy: up to 15 buttons. Observer: 8 to 13. | One meeting: time, agenda, attendees; after it, summary, decisions, follow-ups. | 15 + 0 | Time and three buttons, agenda, attendees. | 1.9 to 2 screens (record). | **trim** | Before the meeting the page already draws empty "الملخص", "القرارات", "المتابعات" and "النص المفرّغ" cards. Show them once the meeting is marked held. | `observer/ar/047-meetings_574c3428-1280-full.png`, `lead/ar/057-meetings_beaa4143-1280-full.png` |
| `/reports/:id` | All five | A dated snapshot of the project's numbers shared with the client. | 1 + 0 (PDF) | Whole report. | No overflow (record). | **keep** | Does one thing. | `lead/ar/053-reports_e2b73197-1280.png` (record) |
| `/assessments/:id` | All five. Lead, deputy, staffed: 165 buttons, 29 fields. Observer: 0 buttons, read only. | Answer the template's questions for this client; the app adds up points and proposes gaps. | 165 + 0, 29 fields | Title, "للمكتب فقط" badge, "اعتماد", the points strip, first question. | 7.8 screens (record). | **keep** | A questionnaire is long by nature. See N9 on "فجوات مقترحة" and W3 on the word "اعتماد". | `lead/ar/054-assessments_36e4fbce-1280.png` |
| `/indicators/:id` | All five, **with the same 16 buttons for the observer** | One client-reported measure: trend, monthly values, linked recommendations. | 16 + 0 | Title, three buttons, disclaimer, trend tiles and chart. | 1.7 screens (record). | **keep** | Clear page with the right disclaimer. The observer's buttons are a fault (section "The observer"). Each value row shows "تصحيح" and "تعليم كمُطابَق": 10 buttons for 5 rows. | `observer/ar/043-indicators_9d456655-1280-full.png` |
| `/indicators/data?client=` | All five | Choose how the client's figures reach Selah. | 4 + 0 | Three choice cards and "اقتراح على العميل". | No overflow (record). | **merge** into the indicators card on the client page | The consultant can only suggest; the page is written to the client ("تدخل أنت أو مستشارك"). A "suggest" dialog on the client page does the consultant's part. | `lead/ar/065-indicators_data_client_5cbbfdd6-1280.png` (record) |
| `/clients` | All five | My clients, and the names of the firm's other clients with "ask to join". | 4 + 0 | Table of my clients; card "عملاء آخرون". | No overflow (record). | **keep** | Short. The "other clients" card is the isolation question in part 5. | `lead2/ar/043-clients-1280.png`, `consultant/ar/061-clients-1280.png` |
| `/clients/:id` | All five for Al-Nukhba (lead and deputy 11 buttons, staffed 5, observer 2). Deputy also the subsidiary (7) and the pitch client (5). lead2: Rawdah (9), Al-Waha (7). | Everything about one client. This cannot be said in one sentence: progress, indicators, projects, contracts, team, contacts, join requests and six settings cards. | 11 + 0 | Progress block on one side; "طريقة مشاركة العميل" and the top of the legal profile on the other. | 4 screens (record). | **trim** | 3.1 screens, 13 cards. A lead needs progress, indicators, projects, team, join requests. The legal profile, short names, second sign-off rule, client assistant and archive cards are settings the staffed consultant and the observer cannot change: put them behind one "إعدادات العميل" section, closed by default. "طلبات الانضمام" is the last card on the page: when a request waits, show it first. | `lead/ar/060-clients_5cbbfdd6-1280-full.png` |
| `/clients/:id/departments` | All five (read only) | The client's departments and who heads each. | 0 + 0 | Switch card and three department cards. | No overflow (record). | **merge** into the client page | Read only for every consultant. The switch is drawn off while departments are on (B4). The same list is the department table on the client page. | `lead/ar/066-clients_5cbbfdd6_departments-1280.png` |
| `/departments/:id` | Lead, deputy, staffed, observer | One department's progress, people, indicators and open actions. | 1 + 0 | Progress block and people. | 1.5 screens (record). | **merge** into the client page | A fourth layout of the same progress block, and one more list of open actions (U01). The department row on the client page can open the Actions list for that department. | `lead/ar/063-departments_9663eec2-1280.png` (record) |
| `/clients/groups` | All five. lead2: empty list. | The client groups that include my clients. | 0 + 0 | One-row table (empty for lead2). | No overflow (record). | **merge** into `/clients` | A one-row table behind its own sidebar row. Show the group as a line on the Clients list; drop the sub-menu. | `lead/ar/062-clients_groups-1280.png` (record) |
| `/clients/groups/:id` | Lead, deputy, staffed, observer | A group's member companies counted together. | 0 + 0 | Progress block, members, viewers, notes. | No overflow (record). | **keep** | Read only, one subject. Notes are marked "Firm only". | `deputy/ar/084-clients_groups_4a260013-1280.png` (record) |
| `/engagements/:id` | All five (read only) | What the client signed: scope, period, projects covered. | 0 + 0 | Whole page. | Whole page (record). | **keep** | Short and read only for consultants. | `lead/ar/048-engagements_5bb705cf-1280.png` (record) |
| `/inquiries` (open, won, closed) | All five. Empty for every one of them. | Inquiries the admin handed me, and ones I entered. | 1 + 0 | Three view tabs all showing 0 and "لا توجد طلبات هنا". | No overflow (record). | **merge** into `/clients` for consultants | A consultant's only act here is "إدخال طلب". A pitch is already started from Clients ("بدء عرض"), so prospects have two homes. One "prospects" section on Clients holds both. The firm admin's inquiry inbox is the other helper's area. | `consultant/ar/006-inquiries-1280.png` |
| `/templates` | All five (read only: 0 buttons) | The firm's assessment templates. | 0 + 0 | One-row table and "مؤلفو القوالب: مدير المكتب فقط حتى الآن". | No overflow (record). | **cut** from the consultant's sidebar | No consultant in the data may edit a template. The template is reachable from the assessment that uses it. Show the row only to people named as template authors. | `lead/ar/008-templates-1280.png` (record) |
| `/templates/:id` | All five (read only) | Read a template's questions, weights and sources. | 0 + 0 | Title, version, first questions. | 5.2 screens (record). | **keep** | Useful as a reference when answering an assessment. | `lead/ar/044-templates_b75b15a3-1280.png` (record) |
| `/team` (sidebar: الفريق > الأشخاص) | Lead, staffed, observer, lead2 seen; deputy not yet captured. Same page for all. | A read-only table of the firm's six people: name, mail, role, number of projects. | 0 + 0 | Whole page: six rows, no button, no link. | No overflow (record). | **cut** from the consultant's sidebar | Nothing to do on it, and its one number is wrong: the "المشاريع" column changes with who is looking (N16). The firm admin's people screen is the other helper's area. | `../phase1-extra/consultant_at_mizan.test/ar/003-team-1280.png`, `../phase1-extra/observer_at_mizan.test/ar/003-team-1280.png`, `../phase1-extra/lead2_at_mizan.test/ar/003-team-1280.png` |
| `/team/expertise` (sidebar: الفريق > الخبرات) | Lead, staffed, observer seen. Same page; the pencil is on the viewer's own row only. | Who can lead what: each consultant's services, sectors, languages and whether they take new clients. | 1 + 0 (the pencil) | Whole page: five rows, one pencil, the line "مرتّبة حسب الاسم. هذا للتوزيع وليس تقييمًا". | No overflow (record). | **merge** into the user menu as "خبراتي" | A consultant's only act is to edit his own languages and availability. Reading colleagues' lines helps whoever staffs, which is the admin or a lead; keep the table for them where they add a consultant to a client, or on the admin's Team page. | `../phase1-extra/consultant_at_mizan.test/ar/004-team_expertise-1280.png` |
| `/assistant` | Lead, staffed, observer seen | A page that says the assistant opens in a card, with a button to open it. | 1 + 0 | An empty-state box "يفتح المساعد في بطاقة" and "افتح المساعد"; the card already open on top of it. | No overflow (record). | **cut** | The sidebar row already opens the card on whatever page the person is on. A page whose only content is a button to open the same card earns nothing. Its one useful sentence ("المساعد يقترح ولا يقرر… القرار للمستشار") belongs in the card. | `../phase1-extra/consultant_at_mizan.test/ar/005-assistant-1280.png` |

Floating cards (not pages, so no verdict counted):

- **Files card** (sidebar foot "الملفات"): title, one sentence ("كل ملف يمكنك فتحه في صلة، مرتبًا حسب العميل والمشروع ومصدر الملف"), a search box, and for lead and staffed consultant an "إضافة ملف" button. **The observer's card has no "إضافة ملف"**, which is right. The list itself was still loading in the capture. `../phase1-extra/consultant_at_mizan.test/ar/001-card_files-1280.png`
- **Assistant card**: caught loading (logo only). Not judged. `../phase1-extra/consultant_at_mizan.test/ar/002-card_assistant-1280.png`
- Both cards are drawn dark on a light page. If that is intended, fine; it is the only dark surface on these screens.

Addresses a consultant has no link to, opened directly in the second capture: `/settings`, `/audit`, `/clients/:id/people`, `/leaving`, `/assessments/compare` and `/indicators/import?client=…` all show "غير موجود" for lead and staffed consultant (the observer's capture has the last four of these, same answer). That is the expected answer for the first five. For `/indicators/import` see part 3.

### The project page as a lead (board governance project)

- **Tabs:** 11 (التوصيات, التقدم, يحتاج انتباهاً 3, التتبّع, الاجتماعات, التقييمات, الطلبات, المستندات, سجل النشاط, الفريق, الإغلاق). The deputy's subsidiary project also has 11; the pitch has 10; the internal project has 9.
- **Where the tab row starts:** 517 px of 800 on a visit after anything changed (Arabic pass), 192 px otherwise (English pass). At 768 px wide the row does not fit: the last tab is off screen with no sign that the row scrolls.
- **Controls across the 11 tabs, lead, Arabic:** 77 different buttons (87 counted, less the "show 3 more" button repeated on 10 tabs) + 30 menu items + 11 tabs. English pass without the last-visit card: 80 buttons. The 30 Oct count for the firm admin was 93.
- **By tab:** plan 22 + 11; progress 2; needs attention 1; trace 1; meetings 2; assessments 2; requests 25; documents 19 + 19; activity 1; team 10; closing 2.
- **Used weekly by a lead:** the plan tab (which action is where), meetings (book, open), requests (what came back), and one click through to an action. **Used rarely:** progress (when writing the monthly report), team (when staffing changes), documents (to change who sees a file). **Used once or never in a normal week:** trace, activity, assessments, closing, and needs attention (it repeats the plan tab's red dates).
- The staffed consultant gets exactly the lead's controls on the plan, requests and meetings tabs. He loses only: "سحب هذا الملف" (6 menu items), the Team tab's 9 buttons and "بدء الإغلاق".

### The action page in each state, as the reviewer (lead)

| State | Action | Buttons, fields | First card "الخطوة التالية" shows | Is the reviewer's decision first? | Evidence |
|---|---|---|---|---|---|
| Awaiting review, first sign-off in | عرض المسودة على المجلس واعتمادها | 11, 2 (comment box, department select) | "الاعتماد الثاني والتحقق" (solid black), "طلب تعديل" (solid red), "إغلاق الإجراء"; then who signed first and who may sign second | **Yes.** But the file to judge is in the last card ("السجل"), about 1,350 px down; between them the "قائمة الأدلة" card says "لا توجد بنود بعد" although evidence was sent. Two solid buttons in one card. | `lead/ar/023-actions_2ebe3f7a-1280-full.png` |
| Revision requested | إعداد لائحة عمل اللجنة | 12, 2 | Only "إغلاق الإجراء" | No decision is pending; the card should say the firm waits for the owner. The rejected item, its reason and "اطلبه مرة أخرى" (solid) are in the second card. | `lead/ar/022-actions_a6a726cb-1280.png` |
| Blocked, overdue | ترشيح الأعضاء المستقلين للجنة | 8, 2 | Only "إغلاق الإجراء" | The blocked reason is printed above the card, which is right. The next step offered is not a next step. | `lead/ar/009-actions_9cc4daf7-1280.png` (record) |
| In progress, date change waiting | مراجعة حدود الصلاحيات المالية | 10, 2 | Only "إغلاق الإجراء" | **No.** The decision ("موافقة" and "رفض", both solid black) is in the second card of the side panel. At 768 px the side panel drops below the main column, so the decision is under the discussion and the firm notes. | `lead/ar/021-actions_8b57150a-1280-full.png` |
| In progress, with an evidence list | تحديث مصفوفة الصلاحيات ورفعها للمجلس | not captured for lead, deputy or staffed (only the observer: 4, 0) | Observer: "لا يوجد ما تقوم به في هذا الإجراء الآن" | Cannot say for the reviewer. On the observer's screen all three list items read "بانتظار الإرسال" while the history shows a file sent with the note "مذكرة المقارنة"; the walkthrough says one item is answered. Unclear which is right. | `observer/ar/032-actions_60d3d21a-1280-full.png` |
| Verified | صياغة مسودة الميثاق | 7, 1 | Only "إعادة فتح" | Nothing pending; fine. The reminders card still lists four step dates under "متوقفة" (B3). | `lead/ar/040-actions_066a00be-1280.png` (record) |
| Closed, risk accepted | جمع إقرارات الأعضاء لعام 2026 | 6, 1 | Only "إعادة فتح" | Fine: the closing reason and who closed it are printed above the card. Reminders card still shown (B3). | `lead/ar/041-actions_80a85aa9-1280.png` (record) |
| Draft | اعتماد قرار تشكيل اللجنة ونشره | 8, 2 | "إصدار للمسؤول" | **Yes**, correct. | `lead/ar/042-actions_f55a1d16-1280.png` (record) |
| Assigned, not started | نشر الميثاق المعتمد على موقع الشركة | 8, 2 | Only "إغلاق الإجراء" | Nothing pending for the firm; closing is not the next step. | `lead/ar/043-actions_1531cd35-1280.png` (record) |

Uploads and text boxes on the reviewer's page: **0 uploads, 1 visible text box** (the discussion), plus a firm note behind "إضافة ملاحظة" and a reason behind each decision dialog. So U03's "three uploads, three text boxes" does not hold for a reviewer on a client with accounts. It **does** hold where the consultant records for the client (next section): the same card then holds "الإبلاغ عن تعثر", "إرسال للمراجعة", "إغلاق الإجراء", "إرفاق دليل", a progress-note box, and below it the discussion box and the firm note.

Always drawn, whatever the state: "قائمة الأدلة" (empty on 6 of the 9 actions), "النقاش", "ملاحظات الشركة", "السجل", "التذكيرات", "الاعتماد الثاني". The second sign-off card repeats the client's rule on every action.

### The daily loop of a lead

Sign-in lands on Overview.

| What I look for | Shortest path | Clicks from sign-in to the row | Also listed on |
|---|---|---|---|
| (a) Reviews waiting for me | Overview table, 4th row | 0 (1 to open it) | Today section 1; Actions > بانتظار المراجعة; Actions list; project plan tab; the agenda of two meetings |
| (b) Late work on my clients | Overview: red bar "متأخرة: 3" and rows 1 to 3 | 0 | Today "مستحق هذا الأسبوع"; Actions list; Oversight exceptions (the only one with "remind"); project plan tab; project "يحتاج انتباهاً"; the project's last-visit card; three meeting agendas; department pages; client page counts |
| (c) Date-change requests to decide | Today > "بانتظار قرارك" (below the fold) > the action > side panel | 1 to see it, 2 to reach the buttons | Nowhere else as a list. Not on Overview. The bell. |
| (d) My meetings this week | Today > "اجتماعات هذا الأسبوع" | 1 | Nowhere else across projects (each project's Meetings tab: 3 clicks) |
| (e) Join requests | Today > "بانتظار قرارك" > client page > last card "طلبات الانضمام" | 1 to see it, 2 plus a scroll of two screens to decide | Clients list shows a "طلب واحد" chip beside the client (lead2) |

Same rows again: the late action "ترشيح الأعضاء المستقلين للجنة" is listed on **9 screens** a lead reaches (Overview, Today, Actions, Oversight twice, plan tab, needs-attention tab, last-visit card, its recommendation page, and three meeting agendas). The one action awaiting review is listed on 6.

What this means: Overview answers (a) and (b); Today answers all five. Overview adds nothing Today lacks except four counters, and it hides (c), (d) and (e). **Keep Today, fold Overview into it.** If the product owner prefers to cut Today instead, each part must go somewhere: reviews to Overview's table (already there); due-this-week to Overview's table (already there, unscoped); **meetings this week would have no home** (a new block on Overview); **decisions waiting would have no home** (a new block on Overview); "since last visit" stays as the card on each project. That is the same page under another name, so merging is the cheaper move.

### What the sidebar shows a plain consultant that he cannot use (`consultant@mizan.test`)

His sidebar is the same 9 rows + 7 sub-rows as the lead's.

| Row | What he can actually do there | Evidence |
|---|---|---|
| الطلبات الواردة | Three empty views (0 / 0 / 0). One button: "إدخال طلب". Nothing to read. | `consultant/ar/006-inquiries-1280.png` |
| قوالب التقييم | Read one template. No button anywhere. The page itself says only the firm admin may build templates. | `consultant/ar/008-templates-1280.png` (record: 0 buttons) |
| الفريق > الأشخاص | Read six rows. No button, no link. The projects number beside each name is not reliable (N16). | `../phase1-extra/consultant_at_mizan.test/ar/003-team-1280.png` |
| الفريق > الخبرات | Read five colleagues' lines; edit his own (one pencil). | `../phase1-extra/consultant_at_mizan.test/ar/004-team_expertise-1280.png` |
| المساعد الذكي | Opens the card (works). The `/assistant` page behind the same name only repeats that. | `../phase1-extra/consultant_at_mizan.test/ar/005-assistant-1280.png` |
| الإجراءات > الإشراف | See both open projects he can open, and press "تذكير المالك" on four rows of a project he does not lead. | `consultant/en/` record 028 (7 buttons) |
| العملاء > مجموعات العملاء | Read a one-row table. | `consultant/ar/062-clients_groups-1280.png` (record: 0 buttons) |
| المشاريع > 3 sub-rows | Filter two cards. | `consultant/ar/044-projects-1280.png` (record) |

Things he can do that the screen wording says he cannot: Today's "بانتظار قرارك" is described as "طلبات يبتّ فيها المستشار الرئيسي للعميل أو مدير الشركة", yet it shows him one row; and on the action with the date change he has "موافقة" and "رفض" (code: any consultant may decide a date change), while Today does not list that request for him.

### The observer (`observer@mizan.test`)

The walkthrough promises: "there are no buttons to change anything". On the plan, requests, team and closing tabs and in every action's "next step" card that is true, and the project header carries an "مراقب" badge. Everywhere else it is not. Every control on the observer's screens that would change something:

| Page | Controls shown to the observer | Does it work? | Evidence |
|---|---|---|---|
| `/indicators/:id` (both indicators) | إدخال قيمة, تعديل, إيقاف, تصحيح x5, تعليم كمُطابَق x5, ربط, فك الربط: all 16 the staffed consultant has | **Yes, it works** (`code-recheck.md` 2k: indicators belong to the client, so the observer rule never applies) | `observer/ar/043-indicators_9d456655-1280-full.png` |
| `/clients/:id` | مؤشر جديد | Yes (same reason) | `observer/ar/049-clients_5cbbfdd6-1280.png` (record) |
| `/departments/:id` (two) | مؤشر جديد | Yes (same reason) | `observer/ar/052-departments_9663eec2-1280.png` (record) |
| `/recommendations/:id` (three) | ربط, فك الربط (indicator links) | Yes, by the same code reading; not tested | `observer/ar/038-recommendations_09ea46af-1280.png` (record) |
| `/indicators/data?client=` | Three choice cards and "اقتراح على العميل" | Not checked | `observer/ar/054-indicators_data_client_5cbbfdd6-1280.png` (record) |
| `/meetings/:id` scheduled (two) | تعديل أو تغيير الموعد, إرسال الدعوات, إلغاء الاجتماع, إضافة متابعة, remove (x) beside each attendee, the transcript switch | Shown, but the database refuses an observer's change to meetings and attendees (migration `0034_observers.sql`). So the button is there and fails. | `observer/ar/047-meetings_574c3428-1280-full.png` |
| `/meetings/:id` held | ربط مصدر, تعديل الملخص, تسجيل قرار, تمت x2, إعادة فتح, إضافة متابعة, remove x4, the switch | Same: shown, refused | `observer/ar/045-meetings_beaa4143-1280.png` (record) |
| Project tab "التقييمات" | بدء تقييم | Shown, refused by the same rule | `observer/ar/015-projects_8c55994f_tab_التقييمات-1280.png` (record) |
| `/actions/:id` (all ten) | إضافة ملاحظة (a firm note) | Works, on purpose: notes are open to observers in code. It still contradicts "changes nothing". | `observer/ar/023-actions_2ebe3f7a-1280-full.png` |
| `/actions/:id` | كتم البريد | Works; it is the observer's own mail setting. Fine. | same |
| `/clients`, `/projects`, `/inquiries` | بدء عرض, طلب الانضمام x3, مشروع داخلي جديد, إدخال طلب | Not about the observed project. Fine. | `observer/ar/050-clients-1280.png` (record) |

Compared with the staffed consultant on the same pages: plan tab 6 buttons against 22 + 11; requests tab 1 against 25; documents 13 against 19 + 13; action pages 3 to 5 against 7 to 11; assessment 0 against 165. **Indicator pages 16 against 16, department pages 1 against 1, held meeting 13 against 14, scheduled meetings 8 and 11 against 9 and 15** (the observer lacks only "إضافة حاضر" and the invitation replies).

Also: the observer's Today says "لا شيء ينتظرك اليوم" in a large empty box and, directly under it, lists a section with one row.

### Isolation as seen on screen

- **No link leads to "Not found"** for any of the five accounts. Every followed link returned its page. (`/help` is a fixed start address of the script, not a link.)
- **lead2 sees Al-Nukhba by name.** `/clients` > "عملاء آخرون" lists "شركة النخبة القابضة" and "النخبة للتطوير العقاري", each with "طلب الانضمام". It is the only screen of his 60 where the name appears. The walkthrough says "Al-Nukhba does not exist for him." `lead2/ar/043-clients-1280.png`
- **The board-project consultants see Rawdah and Al-Waha by name** in the same card: lead, staffed consultant and observer each see "مكتب الواحة العائلي" and "مؤسسة الروضة" (and the subsidiary). `consultant/ar/061-clients-1280.png`. The deputy sees Al-Waha and Rawdah. Nowhere else.
- The card says so itself ("ترى أسماء هؤلاء العملاء فقط"), so this is by design, not a leak. But an NDA-bound client name shown to every consultant is a product decision (part 5).
- The deputy's pitch client (Madar) is not in any other consultant's list. Correct.

### Firm-run clients: does the screen say the consultant records for the client?

| Screen | Says it? | Evidence |
|---|---|---|
| Client page (subsidiary, Al-Waha) | **Yes.** Card "طريقة مشاركة العميل": "يديرها المستشار: لا حسابات للعميل، ويسجّل مستشارو المكتب التقدّم والأدلة نيابة عنه". It is a side card, not a banner. | `deputy/ar/062-clients_c4d42361-1280.png` (record), `lead2/ar/057-clients_bd4c498c-1280.png` (record) |
| Oversight | **Yes.** The "client last active" column reads "يسجّله المكتب". | `lead2/ar/035-oversight-1280.png` (record) |
| Project page header | **No.** Reads like any client project. Only the Team tab says "يديره المستشار: ليس للعميل حسابات في صلة". | `deputy/ar/026-projects_61a68d4c-1280.png` |
| Action page | **No.** No notice that the consultant acts for the client. The owner is a name with a title ("م. تركي البقمي (المدير العام)"), which is the only hint. The cards still say "ما يجب أن يرسله العميل لهذا الإجراء" and "تحدّث مع العميل عن هذا الإجراء. يقرأ هذا النقاش كل من يرى الإجراء"; the reminder ladder names "مديرو العميل… والراعي ومسؤولو حساب العميل", none of whom exist. | `deputy/ar/042-actions_8c2149e4-1280-full.png`, `lead2/ar/039-actions_0f236163-1280-full.png` |
| Evidence the consultant recorded | **No.** The history line reads "ماجد السبيعي قدّم دليلاً" and the file name. How and when the client sent it ("received by email", as the walkthrough puts it) is not on the screen. | `lead2/ar/039-actions_0f236163-1280-full.png` |
| Requests tab | **No.** "List what you need from the client: they see each item, send files against it" for a client that cannot sign in. | `deputy/en/` record 038 |
| Recommendation status | "بانتظار الرد" (waiting for the client's answer) on a client that has no account to answer with. | `deputy/ar/026-projects_61a68d4c-1280.png` |

One more thing these screens raise: lead2 is the only consultant on Al-Waha ("المستشار المسؤول وحده") and the action page offers him "إرسال للمراجعة". Today says work a person submitted "goes to a colleague". The screens do not say who that is here.

### Firm-only content: is it marked?

Marked with a lock or a label: firm notes on actions (lock + "خاص بالشركة"), the firm-only file (badge "خاص بالشركة"), the assessment page (badge and a lock line "للمكتب فقط"), lessons learned (lock + "للمكتب فقط"), the internal project (banner), the pitch project and pitch client (banner), group notes, the meeting summary ("خاص بالشركة", text only), the transcript card ("للمكتب فقط", text only), Oversight ("للمكتب فقط" at the end of the subtitle, text only).

Not marked:

- The **draft assessment row** on the project's "التقييمات" tab, with its 37.5% and "6 gaps" (the score is firm only by the guidelines). `lead/ar/015-…` (record)
- The **"يحتاج انتباهاً" tab** and the **Review queue**, both firm only by code, carry no mark.
- The **draft action** (status "مسودة"): nothing says the client does not see it yet. `lead/ar/042-…` (record)
- The **reminder ladder** and the **second sign-off card**: no mark, and by code the client does see them (U11), so the absence is accurate but the content is the firm's machinery.
- The **whole client page** is firm only and has no mark; arguably it needs none.

Two labels for the same thing: "خاص بالشركة" and "للمكتب فقط". The firm is "الشركة" in one and "المكتب" in the other; "الشركة" is also what the client is called ("شركة النخبة", "مدير الشركة" for the firm admin on Today).

---

## 2. Marks

**Decoration rather than information**

- D1. The "تحرّكت 8 إجراءات في آخر 7 أيام" card above the tab row on all 11 project tabs: 325 px, repeats action titles that are on the plan tab. Project page, all positions. `lead/ar/010-projects_8c55994f-1280.png`
- D2. Overview's four counter cards for a consultant: a third of the first screen for four numbers that are not links. `lead/ar/001-home-1280.png`
- D3. "التحقق عبر الوقت" on the Progress tab: an empty card with "يظهر الاتجاه بعد لقطتين شهريتين". `lead/ar/011-…-1280-full.png`

**Text that explains the screen**

- T1. Oversight, "سلامة الارتباطات": a three-line paragraph defining the label before the two-row table. `lead/ar/038-oversight-1280-full.png`
- T2. Action page: "ما يجب أن يرسله العميل لهذا الإجراء. اقبل كل بند أو ارفضه أو أعفِ منه بعد الرد عليه." over an empty list, and "تحدّث مع العميل عن هذا الإجراء. يقرأ هذا النقاش كل من يرى الإجراء، فاستخدم ملاحظات المكتب…" over every discussion. `lead/ar/023-…-1280-full.png`
- T3. Team tab: each of three cards opens with a two-to-three-line explanation of who sees what. `lead/ar/019-…-1280-full.png`
- T4. Progress tab: "محسوبة من العمل نفسه: الإجراءات والمراجعات والأدلة. يرى مديرو العميل ومسؤولوه الأرقام نفسها." between two cards. `lead/ar/011-…-1280-full.png`
- T5. Second sign-off card on every action: four lines of rule text. `lead/ar/021-…-1280-full.png`
- T6. Overview footnote on what the numbers mean. The guidelines say it stays; noted only for completeness.

**Numbers that cannot be traced, or two numbers for one thing**

- N1. **Bell badge shows the digits reversed in Arabic.** Lead: badge "71", label "17 إشعاراً غير مقروء". Deputy: "81" for 18. Consultant: "51" for 15. One-digit counts (observer 2, lead2 8) look right. Every page, Arabic. `lead/ar/001-home-1280.png`, `deputy/ar/026-projects_61a68d4c-1280.png`, `consultant/ar/005-today-1280-full.png`
- N2. **Staffed consultant: Today says "بانتظار مراجعتك 1"; the Review queue says "1 waiting, none yours to check"** for the same action (he gave the first sign-off and cannot give the second). `consultant/ar/005-today-1280-full.png`; `consultant/en/` record 027
- N3. **lead2: Overview says "لا يوجد ما يحتاج انتباهك الآن"; Today says "بانتظار قرارك 1"** (Omar's join request). `lead2/ar/001-home-1280.png`, `lead2/ar/005-today-1280.png`
- N4. Overview "قيد العمل 3" for the lead, while only 2 actions carry the status "قيد التنفيذ". The card also counts "مطلوب تعديل" (code: `queries.ts` dashboard). The label does not say so. `lead/ar/001-home-1280.png`, `lead/ar/007-actions-1280.png`
- N5. Oversight exceptions: filter "الكل 4" for 3 actions; the blocked action is listed twice (as late and as blocked). `lead/ar/038-oversight-1280-full.png`
- N6. **One project, two bases.** Projects list card: bar and "9 إجراءات · 1 مُتحقق" (1 of 9). Project Progress tab, client page and report: "13%: 1 من أصل 8". `lead/ar/045-projects-1280.png`, `lead/ar/011-…-1280-full.png`
- N16. **`/team`, column "المشاريع": the number depends on who is looking.** The staffed consultant sees Khalid 1, Sara 1, Omar 2, Layla 1, Majed 0, Noura 1. The observer sees Khalid 0, Sara 0, Omar 1, Layla 1, Majed 0, Noura 1. lead2 sees 0 for all six, himself included, although he leads two projects. The column seems to count only the staffing rows the viewer may see, and never a lead's own projects. `../phase1-extra/consultant_at_mizan.test/ar/003-team-1280.png`, `../phase1-extra/observer_at_mizan.test/ar/003-team-1280.png`, `../phase1-extra/lead2_at_mizan.test/ar/003-team-1280.png`
- N7. Progress tab: tile "متأخرة 3" beside the card "التأخر عن الموعد الأصلي: لا يوجد إجراء مفتوح تجاوز موعده الأصلي". Both are true (the dates were brought forward) but a reader sees a contradiction. `lead/ar/011-…-1280-full.png`

**Selah appearing to do the consultant's job**

- N8. Oversight labels a project **"متعثر"** (off track) or "تحت المراقبة" by a fixed threshold. The counts beside it are neutral; the label is the app's verdict. All five positions see it, the observer included. `lead/ar/038-oversight-1280-full.png`
- N9. Assessment: **"فجوات مقترحة 6 (0 مؤكدة)"** and "النقاط (مؤشر) 6/16 · 37.5%". The gaps are proposed by the app and become findings only when a consultant confirms; the page says "للمكتب فقط… ليست شهادة". Acceptable as built, but "6 gaps" is repeated on the project tab without that sentence. `lead/ar/054-assessments_36e4fbce-1280.png`
- Indicator pages say "أفضل من خط الأساس" from a direction a person set, with the disclaimer under it. Neutral enough.

**Wrong language, raw keys, RTL, overflow, console errors**

- N10. **Raw status keys on the meeting agenda**, both languages: "(revision_requested)", "(in_progress)", "(blocked)", "(closed)", "(verified_complete)", "(awaiting_review)", "(assigned)", and dates as "2026-11-10". `observer/ar/047-meetings_574c3428-1280-full.png`
- N11. On the English pass the agenda headings stay Arabic ("متأخرة", "بانتظار المراجعة", "متوقفة", "ما تغيّر منذ الاجتماع السابق", "الاستحقاق"). `lead/en/` records 024, 025, 057
- N12. **Hydration error** on both scheduled meeting pages for every account that opened them ("Hydration failed because the server rendered HTML didn't match the client"); the dev overlay shows "1 Issue". Not on the held meeting. Lighter hydration warnings on `/projects/:id/import`, `/clients/:id/departments` (lead) and `/notifications` (lead2). `observer/ar/047-…-1280-full.png`
- N13. The project tab row is cut at 768 px with no scroll hint. `lead/ar/010-projects_8c55994f-768.png`
- No horizontal overflow on any page at 1280 or 768 for the five accounts (record). No raw translation keys in labels (record).
- N15. `/indicators/data` speaks to the client on a consultant's screen: "تدخل أنت أو مستشارك…", "Nothing leaves your systems". `lead/en/` record 065

**More than one solid button in one card**

- S1. Action page, "الخطوة التالية", awaiting review: solid black "الاعتماد الثاني والتحقق" and solid red "طلب تعديل". Lead, deputy. `lead/ar/023-actions_2ebe3f7a-1280-full.png`
- S2. Action page, "طلبات تغيير الموعد": "موافقة" and "رفض", both solid black. Lead, deputy, staffed. `lead/ar/021-actions_8b57150a-1280-full.png`

**Firm-only content with no lock or label**

- N14. See "Firm-only content" above: the draft assessment row with its score, the needs-attention tab, the Review queue, the draft action.

**Links that lead to "Not found"**

- None for these five accounts.

**Words (consultant screens, so not the client test, but they block reading)**

- W1. "متعثر" means a blocked action (status) and an off-track project (Oversight). A blocked action is also "متوقف" (Oversight rule column) and "متوقفة" (agenda heading). `lead/ar/038-oversight-1280-full.png`
- W2. The action's owner is "المسؤول" in every table and side panel, and "المالك" on the button "تذكير المالك" and in "ينتظر أمراً خارج يد المالك". Same screen.
- W3. "اعتماد" is the second sign-off on an action, and the button that finalises an assessment. `lead/ar/023-…`, `lead/ar/054-…`
- W4. "بانتظار الإرسال" is the state of a request item the client has not answered. It reads as "waiting to be sent" by the firm. `lead/ar/016-…-1280-full.png`
- W5. Oversight offers "تذكير المالك" on the row whose detail is "ينتظر أمراً خارج يد المالك" (waiting on something outside the owner's hands). `lead/ar/038-oversight-1280-full.png`

---

## 3. The 18 findings and the batch 0 bugs, for consultants

| # | Today | One sentence | Evidence |
|---|---|---|---|
| U01 same late actions on six screens | **Still true** | A lead meets the same three late actions on 9 screens; five of them are list pages (Overview, Today, Actions, Oversight, needs-attention tab). | `lead/ar/001-home-1280.png`, `lead/ar/005-today-1280-full.png`, `lead/ar/038-oversight-1280-full.png` |
| U02 project page, 11 tabs, ~93 controls | **Still true** | 11 tabs; for a lead 77 buttons + 30 menu items; the tab row starts at 517 px after any change. | `lead/ar/010-projects_8c55994f-1280.png` |
| U03 action page: uploads, text boxes, wrong next step | **Partly true** | For a reviewer: no upload and one text box, but "next step" is only "close the action" in four of the eight states captured, and the date-change decision is in the side panel; for a firm-run client all of U03 holds. | `lead/ar/021-actions_8b57150a-1280-full.png`, `lead2/ar/039-actions_0f236163-1280-full.png` |
| U05 five ways to send a file | **Still true** | A consultant sees: "إرسال ملف", "إرسال رابط رفع" and "إضافة ملف آخر" on a request; "إرفاق دليل" and "إرسال للمراجعة" on a firm-run action; "رفع نسخة جديدة" in a file's menu; the Files card; and no "add file" on the Documents tab itself. | `lead/ar/016-…-1280-full.png`, `lead2/ar/039-…-1280-full.png` |
| U06 "add recommendation" in four places, findings first | **Still true** | One per finding row (3), one solid in the section header, and "استيراد"; findings fill the first screen. | `lead/ar/010-projects_8c55994f-1280-full.png` |
| U07 client page: dashboard plus settings cards | **Still true** | 13 cards on 3.1 screens (4 at tablet); the join-requests card is last. | `lead/ar/060-clients_5cbbfdd6-1280-full.png` |
| U09 long sidebar with admin tools | **Partly true** | No admin page is offered, but all five positions get the same 9 rows + 7 sub-rows, including Inquiries (empty), Templates (read only) and Team (read only). | `consultant/ar/006-inquiries-1280.png` |
| U10 status words | **Still true** | See W1 to W4; three words for "blocked", one word for two different states. | `lead/ar/038-oversight-1280-full.png` |
| U13 people in four places | **Still true** | A lead manages people on the client page (team, contacts, join requests) and on the project's Team tab (firm staff, client people, client roles); "الفريق" in the sidebar is a third place he can only read. | `lead/ar/019-…-1280-full.png`, `lead/ar/060-…-1280-full.png` |
| U14 meeting page shows everything before the meeting | **Still true** | A scheduled meeting draws empty summary, decisions, follow-ups and transcript cards. | `observer/ar/047-meetings_574c3428-1280-full.png` |
| U15 every rare action a visible button | **Still true** | Requests tab: 5 buttons per row, 25 on four rows; indicator values: 2 per row; meeting attendees: a remove "x" each; Team tab: "إزالة" on every row. | `lead/ar/016-…-1280-full.png` |
| U18 lists that hide what matters | **Still true** | The Actions list mixes ten statuses with no filter; the Documents tab mixes evidence files and project files with no heading. | `lead/ar/007-actions-1280.png`, `lead/ar/017-…-1280-full.png` |
| U04, U08, U11, U12, U16, U17 | Not in this area | Client homes, client invitations, client-side wording, the inquiry page (no consultant has one) and Help (not offered to firm staff). | |
| B1 raw status keys on the agenda | **Still true** | See N10. | `observer/ar/047-…-1280-full.png` |
| B2 three percentages for one project | **Still true (two seen)** | 1 of 9 on the projects list, 13% (1 of 8) on the project, client page and report. | `lead/ar/045-projects-1280.png` |
| B3 reminder ladder with past dates on finished actions | **Still true** | The verified and the closed action both show the four reminder steps with their dates under "متوقفة". | `lead/en/` records 040, 041 |
| B4 departments switch drawn off while on | **Still true** | `/clients/:id/departments` as lead: the switch is grey, while the client page reads "الإدارات: مفعّلة · 3 إدارات". | `lead/ar/066-clients_5cbbfdd6_departments-1280.png`, `lead/ar/060-…-1280-full.png` |
| B5 hydration error on the meeting page | **Still true** | On both scheduled meetings, every account. | records `lead` 024, 025; `observer` 046, 047 |

Where the screen and `code-recheck.md` differ: one place. Its table 2d (row 10) lists the indicator figures import as open to "client admin/manager, firm", but `/indicators/import?client=…` shows "غير موجود" for the lead, the staffed consultant and the observer, and the indicators card on the client page offers a consultant no "import" button (`../phase1-extra/lead_at_mizan.test/ar/008-indicators_import_client_5cbbfdd6-1280.png`). It may depend on the client's data mode (Al-Nukhba is still on "typed in"); I could not tell which from the screens. One correction to its 2g: the consultant's `/team` is not only "a read-only list", it carries the unreliable projects column (N16). Two additions to it from the screens: (1) besides indicators (its 2k), the observer is *shown* meeting, assessment and note controls; the meeting and assessment ones are refused by the database, so they are dead buttons; (2) B4 and B5, which code could not settle, are both visible on screen.

---

## 4. Proposed target for consultants

### Sidebar

| Today (every consultant, 9 rows + 7 sub-rows) | Proposed (5 rows, no sub-rows) |
|---|---|
| نظرة عامة / اليوم (one split row) | **اليوم** (the home; Overview's counters in one line at its top) |
| المشاريع > كل المشاريع, مشاريع العملاء, المشاريع الداخلية | **المشاريع** |
| العملاء > كل العملاء, مجموعات العملاء | **العملاء** (groups as a line on the list; prospects, pitches and "enter an inquiry" as a section) |
| الطلبات الواردة | gone for consultants (into العملاء) |
| الإجراءات (tabs: الإجراءات, بانتظار المراجعة, الإشراف) | **الإجراءات** (views: all, waiting for review; "الإشراف" only for someone who leads a client) |
| قوالب التقييم | only for a named template author |
| المساعد الذكي | **المساعد الذكي** (opens the card, as today; the `/assistant` page goes) |
| الفريق > الأشخاص, الخبرات | gone for consultants; "خبراتي" in the user menu |
| الملفات (foot) | **الملفات** (unchanged; card contents not seen, captured while loading) |
| User menu: language, theme, security, sign out | plus "خبراتي" and "إعدادات الإشعارات" |

The same sidebar serves lead, deputy, staffed and observer. What differs is inside: Oversight appears only for leads and deputies.

### Project page tabs

| Today (11) | Proposed (5) |
|---|---|
| التوصيات | **الخطة**: recommendations with their actions first; each finding under the recommendation that answers it; the assessment as one line above ("from assessment X"); a "3 تحتاج انتباهاً" chip that filters |
| يحتاج انتباهاً | into الخطة (the chip) |
| التتبّع | cut; the evidence and review state shows on each action row |
| التقييمات | into الخطة (the line above the findings) |
| التقدم | **التقدم**: numbers, reports, handover; a link to the activity record |
| سجل النشاط | into التقدم (link) |
| الاجتماعات | **الاجتماعات** |
| الطلبات | **الطلبات والملفات** |
| المستندات | into الطلبات والملفات |
| الفريق | **الفريق** |
| الإغلاق | "بدء الإغلاق" in the header menu for a lead; the tab appears once closing has started |

The last-visit card moves off the project page (Today already lists it), so the tab row starts at about 190 px for everyone.

### Action page (reviewer)

One first card that states what waits and on whom. If the firm must decide (evidence to review, a date change, a risk acceptance to close on), the decision's buttons are in that card, one solid, and the thing being judged (the file, the requested date and reason) is in the same card. If the client must act, the card says so and offers nothing but the rare items behind a menu ("إغلاق الإجراء", "إعادة فتح"). Empty cards (evidence list, firm notes, second sign-off when one review is enough) are not drawn.

### Actions pages

`/actions` with two views (all; waiting for review with waiting days and sign-off stage). `/oversight` keeps its exceptions table with "remind" for people who lead a client; the health label goes, the counts stay.

### Gaps a role runs into today (no new features, only what the screens show missing)

- **Observer:** the indicator, meeting, assessment and recommendation-link controls must not be drawn (and the indicator ones must be refused).
- **Staffed consultant:** Today must not list under "waiting for your review" an action he cannot review; Today's "decisions" heading must match who may decide.
- **Lead of a firm-run client:** the project header and the action page must say the consultant records for the client; a recorded piece of evidence must show how and when the client sent it; texts that speak of the client signing in ("they see each item", "talk with the client") must not appear for a client with no accounts.
- **Lead:** a pending join request should be at the top of the client page, not its last card; a pending date change should be in the action's first card.
- **Everyone, Arabic:** the bell count must read 17, not 71.
- **Everyone at 768 px:** the project's tab row must show that it scrolls, or fit.

---

## 5. Open questions

1. **One home or two?** The guidelines put Overview and Today side by side. On these screens they disagree with each other (N2, N3) and repeat each other. Is Today the home for firm staff, with Overview folded into it?
2. **Other clients' names.** Every consultant sees the name of every client of the firm, to be able to ask to join. The walkthrough says Al-Nukhba "does not exist" for lead2. Which is the rule? If names must be hidden, how does a consultant ask to join?
3. **What may an observer do?** Today an observer can add firm notes (by design), enter and correct the client's indicator figures (by oversight), and is shown meeting controls that fail. Is "reads everything, changes nothing" meant literally, notes included?
4. **Who may decide a date change?** Code lets any consultant on the project; Today's text says the client's lead or the firm admin. Which is intended?
5. **Who reviews on a firm-run client with one consultant?** lead2 records the evidence for Al-Waha and is its only consultant. Does the firm admin review, or may he verify his own record?
6. **The project health label** ("متعثر / تحت المراقبة / على المسار"): is a threshold label acceptable under "Selah never judges", or should Oversight show only the counts?
7. **Inquiries and templates for consultants:** should a consultant with no inquiry and no author right see these rows at all?
8. **Evidence-list action:** the walkthrough says one item is answered; the observer's screen shows three waiting. Is the data or the screen wrong? (Not captured for a reviewer; worth one look.)
