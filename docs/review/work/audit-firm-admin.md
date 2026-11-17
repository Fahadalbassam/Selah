# Page audit: the firm admin

Account: `admin@mizan.test` (سارة العتيبي, firm admin, Mizan Advisory). Captured 16 Nov 2026: 103 screens in Arabic, 103 in English.

Evidence paths are relative to `docs/review/shots/phase1/admin_at_mizan.test/`, written `ar/NNN-…` or `en/NNN-…`.

## 0. Read this first

**What was not captured.** The capture has no screen of `/team`, `/team/expertise`, `/settings`, `/assistant`, the Files card, `/indicators/import`, or the departments page of a client that has departments switched on. I judged those from code only and say so in the rows. `/help` was captured and is "Not found" for the firm admin (by design: it is a client page).

**One broken screenshot.** `ar/011-projects_8c55994f-1280.png` and its `-full` version show an empty main area, although the record holds the page's text. The same page is fine in `en/011-…` and in `ar/011-…-768.png`. I treat it as a capture fault (the page was 2,380 px long with 3,128 characters of text when the shot was taken, so the content was there but not drawn). It is worth one manual look: the Arabic project page may stay blank for a moment after a slow load.

**Counts are from the page body** (sidebar and top bar excluded), as recorded in `pages.json`. "24 + 11" means 24 visible buttons and 11 items behind menus.

**The project page in numbers** (busiest project, "حوكمة مجلس الإدارة", 4 recommendations, 9 actions, 4 requests, 12 files):

| | Today |
|---|---|
| Tabs | 11 (9 on an internal project) |
| Where the tab row starts, 1280x800 | 517 px on a first visit or when something moved since the last visit (`ar/013`, `ar/017`); 192 px when nothing moved (`en/011`). Other projects: 509 / 252, 351 / 172, 348 / 208. The busier the project, the lower the tabs |
| Where the tab row starts, 768x1024 | 578 px; the row does not fit: the last two tabs (الفريق, الإغلاق) are cut off and reached by sideways scroll (`ar/011-…-768.png`) |
| Controls per tab (buttons + menu items; the 3 header buttons are in every number) | Recommendations 24 + 11 · Progress 5 · Needs attention 3 · Trace 3 · Meetings 4 · Assessments 4 · Requests 27 · Documents 21 + 13 · Activity 3 · Team 12 · Closing 4 (8 once closing has started) |
| Controls on the whole page, each counted once | 104, plus the 11 tab buttons = 115. The 30 Oct review counted 93. Nothing was removed; the number follows the data |

---

## 1. One row per page

| Route | Roles | Purpose | Controls | First screen 1280x800 | First screen 768x1024 | Verdict | Reason | Evidence |
|---|---|---|---|---|---|---|---|---|
| `/` Overview | firm admin | Four counters for the whole firm and a list of actions that are late or waiting. | 0 buttons, 8 links | Everything fits: 4 cards (5 / 1 / 1 / 4), "متأخرة: 3", a 4-row table, a footnote. | Fits, no overflow. | **trim** | Drop the "يحتاج انتباهك" table: its 4 rows are shown again on Actions, Awaiting review and Oversight. Put Today's sections here instead (see part 4), so there is one home. | `ar/001-home-1280.png` |
| `/today` | firm admin | What waits for me today across clients. | 0 buttons, 2 links | Two short lists: 1 join request, 1 project changed. The rest of the screen is empty. | Same. | **merge** into `/` | For the admin it shows 2 rows while 3 actions are late, 1 review is "yours", 1 date request and 1 project closure wait. It only covers clients the admin follows, and never says so. | `ar/005-today-1280.png` |
| `/projects` (and `?kind=client`, `?kind=internal`) | firm admin | All projects as cards. | 1 button | 6 cards with a bar and three counts each. | Fits. | **keep** | Clear. Fix the bar (it divides by 9 where every other screen divides by 8) and turn the three sidebar sub-entries into a filter on the page. | `ar/071-projects-1280.png` |
| `/projects/:id` header (above the tabs) | firm admin | Name, client, contract, and what moved lately. | 3 buttons + 11 tab buttons | Title, 2 buttons, contract line, then a 300 px card "تحرّكت 8 إجراءات في آخر 7 أيام". Tabs at 517 px; about 240 px of the tab's own content is visible. | Tabs at 578 px, two tabs cut off. | **trim** | Move the "moved" card into the Progress tab. Then the tabs always start near 190 px. | `ar/013-…-1280-full.png`, `en/011-projects_8c55994f-1280.png`, `ar/011-…-768.png` |
| `/projects/:id` tab "التوصيات" Recommendations | firm admin | The plan: findings, then recommendations with their actions. | 24 + 11 in menus | (English, tabs at 192 px) Findings section fills the screen; the first recommendation starts at 640 px. | Findings first; recommendations start below the fold. | **trim** | This is the right default tab. Findings should not come first: show the finding as one line on its recommendation. "إضافة توصية" is on screen 4 times (3 finding rows + section header). | `en/011-…-1280-full.png`, `ar/011-…-768.png` |
| tab "التقدم" Progress | firm admin | The project's numbers and its frozen reports. | 5 | The handover card ("التسليم") fills the first screen; the percentage starts at 740 px. | Same order, longer. | **keep** | The numbers are good and agree with the client page and the report. Put the numbers first and the handover card after them. | `en/012-…-Progress-1280-full.png`, `ar/012-…-1280.png` |
| tab "يحتاج انتباهاً" Needs attention | firm admin (firm only) | Open actions that break a fixed rule (late and so on). | 3 | A paragraph of explanation, then 3 rows. | Fits. | **merge** into the plan tab | The 3 rows are the same 3 late actions already listed on the Recommendations tab, Overview, Actions and Oversight. Make it a filter ("متأخر 3") on the plan. | `ar/013-…-1280-full.png` |
| tab "التتبّع" Trace | firm admin | The plan as a tree: finding, recommendation, action, evidence, review. | 3 | Explanation line, then the tree. | Fits. | **merge** into the plan tab | It is the Recommendations tab drawn again, plus the evidence file and review result per action. Show those two lines when an action row is opened. | `ar/014-…-1280-full.png` |
| tab "الاجتماعات" Meetings | firm admin | Meetings of this project. | 4 | 3 rows and "حجز اجتماع". | Fits. | **keep** | Short and clear. | `ar/015-…-1280.png` |
| tab "التقييمات" Assessments | firm admin | Assessments run for this client in this project. | 4 | One row: name, template, "37.5% · 6 فجوات", مسودة. | Fits. | **merge** into the plan tab | One row is not a tab. An assessment is where findings come from: show it as a "source" line at the top of the plan. | `en/016-…-Assessments-1280.png` |
| tab "الطلبات" Requests | firm admin | Files and information the firm asked the client for. | 27 | Header with 2 buttons, first item with 5 buttons. | Fits; rows wrap. | **merge** into a "Files" tab | Requests and documents are both "files of this project". Each row shows 5 to 7 buttons; keep "إرسال ملف" and put the rest in a menu. | `ar/017-…-1280-full.png`, `ar/017-…-768.png` |
| tab "المستندات" Documents | firm admin | Every file of the project. | 21 + 13 in menus | 12 rows; the first 6 have no control at all, the other 6 have 3 each. | Fits. | **keep** (as "Files", with the Requests section and an upload button) | There is no way to add a file here: the only upload is the Files card in the sidebar. | `ar/018-…-1280-full.png` |
| tab "سجل النشاط" Activity | firm admin | Who did what, newest first. | 3 | A list of events. | Fits. | **merge** into Progress | A log read rarely. Put it at the foot of Progress as "السجل". | `ar/019-…-1280.png` |
| tab "الفريق" Team | firm admin | Who works on this project: firm team, client people, client roles. | 12 | Two cards side by side, roles card below. | Stacks, 1.8 screens. | **keep** (as "Setup", with Closing and "تعديل البيانات") | Needed but rare. Rows say "أعد إسناد إجراءاته أولًا" and no screen lets anyone change an action's owner (see part 4). | `ar/020-…-1280-full.png` |
| tab "الإغلاق" Closing | firm admin | Close the project in order: open actions, lessons, case-study consent. | 4 (8 once started) | One card with "بدء الإغلاق". | Fits. | **merge** into Setup | Used once per project. While closing runs, the banner that already says "هذا المشروع قيد الإغلاق" should link to it. | `ar/052-…-1280-full.png`, `ar/021-…-1280.png` |
| `/projects/:id/import` | firm admin | Read a plan from Excel or Word. | 2 buttons, 1 field | Three steps, a file box, what can be read. | Fits. | **keep** | One job, rare, clear. | `ar/075-…-1280.png` |
| `/recommendations/:id` | firm admin | One recommendation: the client's answer, linked indicators, its actions. | 4 | All visible. | 1.5 screens. | **keep** | One of the four things. No "add action" button here, though this is where one would expect it. | `ar/076-…-1280-full.png` |
| `/actions` | firm admin | Every action of every client. | 1 (Excel), 37 links | 11 of 17 rows; the first three are finished ones. | Due date and status columns are off screen (sideways scroll inside the table). | **keep** | The one list of actions. It needs filters (late, awaiting review, blocked, client) so it can replace the two tabs beside it. | `ar/007-actions-1280-full.png`, `ar/007-actions-768.png` |
| `/review` Awaiting review | firm admin | Evidence waiting for the firm's decision. | 0 | One row. | Fits. | **merge** into `/actions` | It is the Actions list filtered to one status, with two more columns (waiting time, review stage). | `ar/039-review-1280.png` |
| `/oversight` | firm admin | Per project: a health word and counts; then a list of rule breaks with "تذكير المالك". | 7 | 4 tiles and the project table. The exceptions list is below the fold. | Project table cut at the fifth column. | **merge**: exceptions into `/actions`, project columns into `/projects` | The exceptions are the same 3 late rows again. The project table belongs on the Projects list. The health word is a judgment by the app (see part 2). | `ar/040-oversight-1280-full.png`, `en/031-oversight-1280-full.png`, `ar/040-oversight-768.png` |
| `/actions/:id` | firm admin | One action: next step, evidence, talk with the client, history. | up to 12 buttons, 2 fields, 8 cards | Next step, evidence list, discussion; facts on the side. | Next step first; facts move to the end. | **trim** | The next step card is good when a review waits. It is wrong when a date request waits (the card says only "إغلاق الإجراء"; approve and reject sit in a side card). Fold "التذكيرات" and "الاعتماد الثاني" into the facts panel. | `ar/024-…-1280-full.png`, `ar/022-…-1280.png`, `ar/055-…-1280-full.png` |
| `/meetings/:id` | firm admin | One meeting: time, agenda, summary, decisions, follow-ups. | 14 (held), 9 (scheduled) | Time, agenda, start of summary; attendees on the side. | Fits, 1.9 screens. | **trim** | Before the meeting it already shows four empty cards (الملخص, القرارات, المتابعات, النص المفرّغ). The agenda prints raw keys. | `ar/084-…-1280-full.png`, `ar/083-…-1280-full.png` |
| `/assessments/:id` | firm admin (firm only) | Answer a questionnaire for a client. | 165 (answer buttons), 29 fields, 9.7 screens | Score card, first question. | 7.8 screens. | **keep** | A long form is right for a questionnaire. Labelled "للمكتب فقط". | `ar/080-…-1280.png` |
| `/reports/:id` | firm admin | Numbers frozen for a period, shared with the client. | 1 | All visible. | Fits. | **keep** | Clear, and its 13% matches the Progress tab. | `ar/079-…-1280-full.png` |
| `/clients` | firm admin | All clients and who works on them. | 2 | 5 rows. | Fits. | **keep** | Clear. Should also hold groups as a filter. | `ar/086-clients-1280.png` |
| `/clients/:id` | firm admin | I cannot say it in one sentence: it is progress, indicators, projects, contracts, people and nine settings cards. | 25 buttons, 16 cards, 3.3 screens | Progress card; two settings cards on the side. | 4.3 screens, one column. | **replace** with a client page of three tabs | See part 4. Two cards are a dashboard, four are people, eight are settings, two are rarely used. | `ar/096-…-1280-full.png`, `ar/096-…-768.png` |
| `/clients/:id/people` | firm admin | The client's accounts. | 6 + 12 in menus | Table of 3, three small cards. | Fits. | **merge** into the client page, People tab | People are managed in three places for one client (this page, the client page, the project Team tab). | `ar/091-…-1280.png` |
| `/clients/:id/departments` | firm admin | Switch departments on, add them. | 2 | Switch, empty list. | Fits. | **merge** into the client page, People tab | A switch and a list do not need a page. | `ar/090-…-1280.png` |
| `/departments/:id` | firm admin | One department: its share of the work, members, indicators, open actions. | 1 | Progress and members. | 1.4 screens. | **trim** | Drop the open-actions table (link to Actions filtered by department). | `ar/102-…-1280.png` |
| `/clients/groups` | firm admin | Holding groups. | 1 | One row. | Fits. | **merge** into `/clients` | One row; a sidebar entry of its own is too much. Show groups as a filter or a second tab on Clients. | `ar/087-…-1280.png` |
| `/clients/groups/:id` | firm admin | A group: numbers across member companies, members, who may see it. | 9 | All visible. | 1.3 screens. | **keep** | Clear, and the numbers add up (1 of 9 = 1 of 8 + 0 of 1). | `ar/098-…-1280.png` |
| `/engagements/:id` | firm admin | A signed contract: scope, projects, deliverables. | 2 | All visible. | Fits. | **keep** | Small, clear, rarely opened. | `ar/074-…-1280.png` |
| `/indicators/:id` | firm admin | One client indicator: trend, values, linked recommendations. | 16 | Trend and facts. | 2 screens. | **keep** | Clear. Each value row shows two buttons (تصحيح, تعليم كمُطابَق); a menu would do. | `ar/081-…-1280-full.png` |
| `/indicators/data?client=…` | firm admin | Choose how the client's figures reach Selah. | 4 | Three options and a log. | Fits. | **keep** | One decision, clear. The text speaks to the client ("أنظمتكم") although the firm is reading it. | `ar/088-…-1280.png` |
| `/inquiries` (open, won, closed) | firm admin | New requests from the public form. | 1 | 2 rows. | Fits. | **keep** | Clear. | `ar/006-inquiries-1280.png` |
| `/inquiries/:id` | firm admin | Decide whether a request becomes a client. | 9 buttons in 7 cards | "الخطوة التالية" with 3 buttons, the request; 5 more cards with their own buttons on the side. | 2.6 screens. | **trim** | One card is now called the next step, but it offers three steps at once and the side cards hold five more. See part 2. | `ar/038-…-1280-full.png` |
| `/templates` | firm admin | The firm's assessment templates. | 3 | One row and an "authors" card. | Fits. | **keep** | Admin tool, where an admin expects it. | `ar/008-templates-1280.png` |
| `/templates/:id` | firm admin | One template and its versions. | 4, 6.4 screens | Header and first questions. | 5.3 screens. | **keep** | Long by nature. | `ar/068-…-1280.png` |
| `/audit` | firm admin | Who did what, tamper-proof. | 9, 4.5 screens | Four tiles, the seal line, filters, 4 rows. | 5.7 screens. | **keep** | Earns its page. Show plain words only: the code names (`auth.sign_in`, `to=awaiting_review from=in_progress outcome=null`) are printed beside them. | `ar/009-audit-1280.png` |
| `/notifications` | firm admin | My notifications. Also: problems clients reported, my mail options, muted actions. | 16, 2 screens | The list, the reported problem, start of mail options. | 1.6 screens. | **trim** | Three jobs on one page. Mail options and muted actions are personal settings: move them behind the user menu. | `ar/002-notifications-1280-full.png` |
| `/security` | firm admin | Set up two-step sign-in. | 1 button, 1 field | One small form, outside the app frame. | Fits. | **keep** | One job. | `ar/003-security-1280.png` |
| `/help` | firm admin gets "غير موجود" | Client help page. | 0 | "الصفحة غير موجودة". | Same. | not judged here (client page) | No link leads the admin there; correct. | `ar/004-help-1280.png` |
| `/team` | not captured | Firm accounts, invitations, workload. | from code: about 20 | not seen | not seen | **keep** (from code only) | Admin tool in the right group. | none |
| `/team/expertise` | not captured | Who can lead what. | not seen | not seen | not seen | **merge** into `/team` as a tab (from code only) | One table about the same people. | none |
| `/settings` | not captured | Firm settings: 8 form cards (intake, indicators, follow-through, accounts, records, assistant chats, Ramadan, audit). | not seen | not seen | not seen | **keep** (from code only) | Earns a page. It is only in the user menu; see open questions. | none |
| `/assistant`, Files card, `/indicators/import` | not captured | | | | | not judged | | none |

Count of judged screens: 41. **keep 20, trim 8, merge 12, replace 1, cut 0.** After the merges: 29.

---

## 2. Marks

### The same rows shown again (U01)

The three late actions of "حوكمة مجلس الإدارة" (ترشيح الأعضاء المستقلين للجنة, مراجعة حدود الصلاحيات المالية, إعداد لائحة عمل اللجنة) are listed on these screens for the firm admin:

1. Overview table (`ar/001`)
2. Actions (`ar/007`)
3. Oversight, exceptions (`ar/040`)
4. Project, Recommendations tab (`en/011` full)
5. Project, Needs attention tab (`ar/013`)
6. Project, Trace tab (`ar/014`)
7. Project, the "moved in the last 7 days" card, on every tab (`ar/013`)
8. Recommendation page (`ar/077`, in the record)
9. Meeting agenda (`ar/083`, `ar/084`)
10. Department page, open actions (`ar/102`)

They are counted on four more: Oversight project table, client page, group page, report. They are **not** on Today for the admin.

The one action awaiting review (عرض المسودة على المجلس واعتمادها) is on Overview, Actions, Awaiting review, the project plan, Trace and the meeting agenda.

Which lists are the same rows:

| List | Rows today | Same as |
|---|---|---|
| Overview "يحتاج انتباهك" | 4 | Actions rows 4, 5, 6 and 11 |
| Awaiting review | 1 | Overview row 4 |
| Oversight "الاستثناءات" | 4 | Overview rows 1, 2, 3; the fourth is row 1 again under the rule "متوقف" |
| Project "يحتاج انتباهاً" | 3 | Overview rows 1, 2, 3 |

### Numbers that disagree

| # | What | Value A | Value B |
|---|---|---|---|
| 1 | Verified share of "حوكمة مجلس الإدارة" | Projects list: bar of 1 out of 9, "9 إجراءات · 1 مُتحقق" (about 11%) (`ar/071-projects-1280.png`) | 13%, "1 من أصل 8": Progress tab (`en/012-…-full.png`), client page (`ar/096-…-full.png`), report (`ar/079-…-full.png`) |
| 2 | "Needs attention" for the same project | Tab badge: 3 (`ar/013`) | Overview table: 4 rows (`ar/001`); Oversight exceptions: "الكل 4" (`ar/040`). The three sets have different members |
| 3 | Reviews waiting for the admin | Awaiting review: "واحد بالانتظار، واحد لمراجعتك" (`ar/039-review-1280.png`) | Today: no review section at all (`ar/005-today-1280.png`) |
| 4 | Open projects | Oversight: "من 5 مشاريع مفتوحة" (`ar/040`) | Projects list: 6 cards; the sixth is a proposal for a prospect (`ar/071`) |
| 5 | Gaps in the assessment | Assessments tab: "6 فجوات" (`en/016`) | Assessment page: "فجوات مقترحة 6 (0 مؤكدة)" (`ar/080-…-1280.png`). The tab presents six unconfirmed suggestions as gaps |
| 6 | Late or not | Progress tab: "متأخرة 3" | Same screen: "لا يوجد إجراء مفتوح تجاوز موعده الأصلي" and "تم التحقق في الموعد 100%" (`en/012-…-full.png`, also `ar/079`). Correct by definition (current date against first date) but it reads as a contradiction |
| 7 | The word "متعثر" | Overview card "متعثرة 1" = one blocked action (`ar/001`) | Oversight tile "متعثر 1 من 5 مشاريع" = one project off track; the same screen calls blocked "متوقف 1" (`ar/040`) |
| 8 | A finished action with a future reminder | Action "Publish the 2027 implementation roadmap" is "مكتمل ومُتحقق منه" | Its reminders card lists "تصعيد أخير 22/11/2026", six days ahead (`ar/054-…-1280-full.png`) |

Numbers that do agree: late = 3 on Overview, Oversight, Progress, client page, report; verified = 4 on Overview and across the project cards; مؤسسة الروضة = 75% (3 of 4) on client page, Progress tab and project card; group 11% = 1 of 9 = both members added.

Not a disagreement, but it reads badly on fresh data: the audit page shows "الإدخالات في السلسلة 0", "بانتظار الختم 163", "آخر فحص للسلامة: لم يُفحص بعد" and a seal of 64 zeros (`ar/009`). Real values; they say nothing has been sealed yet.

### Where Selah appears to judge

| What the screen shows | Is a human clearly behind it? | Evidence |
|---|---|---|
| Oversight, card "سلامة الارتباطات": each project gets "متعثر" (red), "تحت المراقبة" or "على المسار"; a tile counts "متعثر 1". The rule is printed above: off track when a quarter of open actions are late or one is 60 days past its first date. | **No.** The app gives the word by a fixed rule. The reason line beside it ("3 من 6 متأخرة · 1 متوقفة") is a neutral fact and would be enough. This is the "project is unhealthy" case that rule 1 forbids. Firm only: said in the subtitle, no lock or badge. | `ar/040-oversight-1280-full.png`, `en/031-oversight-1280-full.png` |
| Assessment page: "النقاط (مؤشر) 6/16 · 37.5%", "فجوات مقترحة 6 (0 مؤكدة)". | Mostly yes. The answers are a consultant's, the score is arithmetic, "suggested" and "0 confirmed" are said, the lock and "للمكتب فقط" are there. | `ar/080-…-1280.png` |
| Project, Assessments tab: "37.5% · 6 gaps". | **No.** The word "suggested" and the lock are gone. | `en/016-…-1280.png` |
| Inquiry page and client page, card "مستشارون مقترحون": three named consultants with reasons ("يطابق حوكمة الشركات العائلية · يتحدث لغتهم · عميلان نشطان", "لا يستقبل عملاء جدداً"). | Yes: "اقتراح فقط، والقرار لك". It is still a ranked list of people made by the app; firm only, no lock. | `ar/038-…-1280-full.png`, `ar/096-…-full.png` |
| Indicator badges "أفضل من خط الأساس" with an arrow. | A person set the direction; the app puts the value word on the client's number. A disclaimer sits under it. | `ar/081-…-full.png`, `ar/076-…-full.png` |
| Project, Needs attention tab: rule name "متأخر", days late. | Neutral fact. | `ar/013` |
| Inquiry, "تأهيل الطلب": "قيّم خمس إشارات… التقييم دليل لا يحسم القرار". | Yes, a person rates. | `ar/038` |
| File rows: "الملخص" (sparkle icon) and "اسأل المساعد"; "اسأل المساعد" also on recommendations, actions, meetings. | Cannot tell: the dialogs were not captured, so I did not see whether the text is labelled as AI. | `ar/018-…-full.png` |

### Decoration rather than information

- Progress tab: the percentage is drawn with rolling digits. The Arabic full-page shot caught it mid-roll as "0⁄%" where the value is 13% (`ar/012-…-1280-full.png`).
- Clients list: consultants are three grey circles "عا · لا · نا" with no names (`ar/086`).
- Sparkle icons on "إضافة القالب المبدئي" (`ar/008`) and "الملخص" (`ar/018`): they suggest AI where the first is a stored template.
- Project header: the "moved in the last 7 days" card repeats rows the tab below shows, on all 11 tabs.

### Text that explains the screen

- Oversight: a three-line rule above the table (`ar/040`).
- Needs attention tab: "القواعد هي التي تحدد ما يُحتسب، ولا شيء هنا حكم على شخص" (`ar/013`).
- Trace tab: a line explaining how the parts connect, then a second line under the card title (`ar/014`).
- Client page: each of the 16 cards opens with one or two lines of explanation (`ar/096`).
- Inquiries list: the header explains the whole process (`ar/006`).
- Action page: the discussion card explains who reads it; the evidence list explains itself (`ar/024`).
- Progress tab: the handover card has two explaining paragraphs (`en/012`).
- Audit: the seal line asks the admin to copy a code off the server (`ar/009`).

### Wrong language, raw keys, RTL, overflow, cut text, console errors

- Meeting agenda, "ما تغيّر منذ الاجتماع السابق": raw status keys `(in_progress)`, `(revision_requested)`, `(blocked)`, `(closed)`, `(verified_complete)`, `(awaiting_review)` (`ar/084-…-full.png`, record of `ar/085`).
- Meeting agenda: due dates as raw `2026-11-12`, a different form from every other date on the page (`ar/083`, `ar/084`).
- Audit log: code names and raw details in every row (`ar/009`).
- Inquiries list: the staff band "10–49" is drawn reversed as "49–10", and "50–249" as "249–50" (`ar/006-inquiries-1280.png`).
- Actions list and Overview: English action titles are cut at the start, not the end: "…blish the 2027 implementation roadmap", "…pt the 2027 strategic plan with measurable KPIs" (`ar/007`).
- Client page: indicator names cut: "متوسط أيام اعتماد الـ…", "قرارات المجلس المنفـ…" (`ar/096`).
- Team tab: the note "كل أشخاص العميل مضافون إلى هذا المشروع" is squeezed into a narrow column beside the card title (`ar/020-…-full.png`).
- English Oversight at 1280: the last column is cut ("Recorded by the") (`en/031-…-full.png`).
- Tablet: Actions table hides due date and status (`ar/007-actions-768.png`); Oversight table hides its last four columns (`ar/040-oversight-768.png`); the project tab row hides two tabs (`ar/011-…-768.png`).
- Console errors: "Hydration failed" on both scheduled meetings in both languages (`ar/084`, `ar/085`, `en/084`, `en/085`) and on English Oversight (`en/031`, the screenshot shows the red "1 Issue" badge). Attribute mismatch warnings on English Notifications (`en/002`), English Departments (`en/090`), Arabic plan import (`ar/092`).

### Solid buttons and firm-only labels

- Action page, next step card: a solid black "الاعتماد الثاني والتحقق" beside a solid red "طلب تعديل". Two solid buttons in one card, and red is meant for removal, not for asking for a revision (`ar/024-…-full.png`).
- Firm-only with no lock or badge: Oversight (text only), Needs attention tab, Awaiting review, the assessment row on the project tab, "مستشارون مقترحون".
- Recommendation badge "موافَق عليها" is green (`ar/076`, `en/011`). Green is reserved for verified work; this is the client's agreement.

### Links to "Not found"

None found for this role. `/help` is "Not found" but nothing shown to the admin links to it.

---

## 3. The 18 findings and the batch 0 bugs, for these pages

| # | Today | One sentence | Evidence |
|---|---|---|---|
| U01 same late actions on six screens | **still true** | Ten screens list them for the admin and four more count them. | `ar/001`, `ar/007`, `ar/040`, `ar/013` |
| U02 project page, 11 tabs, ~93 controls | **still true** | 11 tabs, 104 controls counted once (115 with the tab buttons), tabs at 517 px when something moved. | `ar/013-…-full.png`, `en/011-…-full.png` |
| U03 action page: three uploads, three text boxes, wrong next step | **partly true** | The next step card is right for a review; it is wrong when a date request waits or the action is blocked (only "إغلاق الإجراء" is offered); three text boxes remain (progress note, discussion, firm note). | `ar/022`, `ar/010`, `ar/055-…-full.png` |
| U05 five ways to send a file | **still true** | On these screens: "إرفاق دليل" and "إرسال للمراجعة" on the action, an evidence-list item, "إرسال ملف" and "إرسال رابط رفع" on a request, "رفع نسخة جديدة" in the file menu, and the Files card; the Documents tab itself has no upload. | `ar/017`, `ar/018`, `ar/055` |
| U06 "Add recommendation" in four places, findings first | **still true** | Four "إضافة توصية" buttons on one tab plus "استيراد"; findings come before recommendations. | `en/011-…-full.png` |
| U07 client page: dashboard plus ten settings cards | **still true** | 16 cards, 25 buttons, 3.3 screens, no tabs. | `ar/096-…-full.png` |
| U09 long sidebars | **partly true** (for this role) | 10 rows and 7 sub-entries; it fits 768 px; the tools are the admin's own, but the three Projects sub-entries and "مجموعات العملاء" are filters, not places. | `ar/011-…-1280.png` |
| U10 status words | **still true** | "متعثر" means blocked action and off-track project; blocked is also "متوقف"; "طلب" names inquiries, information requests, join requests and date requests; "اعتماد" is sign-off, verify and finalise an assessment. | `ar/001`, `ar/040`, `ar/080` |
| U13 people in four places | **still true** | For one client: client page (team, contacts, join requests), `/clients/:id/people`, `/clients/:id/departments`, project Team tab (three cards), plus `/team` and the templates "authors" card. | `ar/096`, `ar/091`, `ar/020`, `ar/008` |
| U14 meeting page before the meeting | **still true** | A scheduled meeting shows four empty cards. | `ar/084-…-full.png` |
| U15 dense rows | **still true** | Request rows 5 to 7 buttons; client team rows 3; indicator value rows 2; evidence item 3. | `ar/017`, `ar/096`, `ar/081`, `ar/023` |
| U16 inquiry page, five next steps | **partly true** | Only one card is now titled "الخطوة التالية", with one solid button; but it offers three moves at once and five side cards each hold another step, with no order shown. | `ar/038-…-full.png` |
| U17 help page | not this role | "Not found" for the firm admin. | `ar/004` |
| U18 lists that hide what matters | **still true** | Actions: 17 rows, no filter or search, no client column, finished actions first. | `ar/007-…-full.png` |
| B1 raw keys on the agenda | **still true** | Six raw keys visible. | `ar/084-…-full.png` |
| B2 three percentages for one project | **partly fixed** | Three screens now agree on 13%; the Projects list bar still divides by 9. | `ar/071`, `ar/096`, `ar/079` |
| B3 reminder ladder on finished actions | **still true** | Now headed "متوقفة…", but the dates stay, one of them in the future. | `ar/054-…-full.png`, `ar/041` |
| B4 departments switch | **cannot tell** | Both captured department pages have departments off, and the switch is drawn off. No capture of a client with departments on. | `ar/090` |
| B5 hydration error on the meeting page | **still true** | On both scheduled meetings, both languages; not on the held one. Also on English Oversight. | `ar/084`, `en/031` |

U04, U08, U11, U12 are client-side and not in this area.

**Against the code reading** (`work/code-recheck.md`): it agrees with the screens on U01, U02, U06, U07, U14, U15, B1, B3, and on the missing upload button. Three places where the screen says more:

- It calls U16 "still true in substance". On screen it is better than that: one card clearly leads. I rate it partly true.
- It says B2 "cannot be told from code" for two of the three paths. On screen those two agree (13%); only the Projects list differs.
- It lists six Today sections. The firm admin sees two. The code limits the admin's Today to followed clients and projects (`src/services/today.ts`, the `staffed` rule), and the screen does not say so.

---

## 4. Proposed target

### Sidebar

| Today (firm admin) | Target |
|---|---|
| نظرة عامة · اليوم (one row, two links) | الرئيسية (one home) |
| المشاريع ▸ كل المشاريع / مشاريع العملاء / المشاريع الداخلية | المشاريع (the three kinds become a filter on the page) |
| العملاء ▸ كل العملاء / مجموعات العملاء | العملاء (groups become a filter or second tab on the page) |
| الطلبات الواردة | الإجراءات |
| الإجراءات (with tabs Awaiting review, Oversight) | الطلبات الواردة |
| قوالب التقييم | group "المنظمة": الفريق (expertise as a tab on the page) |
| المساعد الذكي | قوالب التقييم |
| group "المنظمة": الفريق ▸ الأشخاص / الخبرات | سجل التدقيق |
| سجل التدقيق | الإعدادات (if the owner agrees; today it is only in the user menu) |
| foot: الملفات | foot: المساعد الذكي, الملفات (both open a floating card, so they sit together) |
| user menu: language, theme, الإعدادات, security, sign out | user menu: language, theme, mail options, security, sign out |

10 rows and 7 sub-entries become 9 rows and no sub-entries.

### The home, Actions, and where each part of Today goes

One home at `/`. One Actions page with filters. Nothing is lost:

| Today has | Goes to |
|---|---|
| بانتظار قرارك (join requests, date requests, closure requests, answered requests) | Home, first section |
| Waiting for my review | Actions, filter "بانتظار المراجعة", mine first; the home counter links to it |
| Late or due within 7 days | Actions, filters "متأخر" and "يستحق قريباً"; the home's red "متأخرة: 3" line links to it |
| My follow-ups | Home, section "متابعاتي" |
| My meetings today and this week | Home, section "اجتماعات هذا الأسبوع" |
| منذ زيارتك الأخيرة | Home, last section |
| Overview's four counters | Home, top (kept) |
| Overview's "يحتاج انتباهك" table | Removed; the counters and the late line link to the Actions filters |
| Awaiting review columns (waiting time, review stage) | Shown on Actions when that filter is on |
| Oversight exceptions and "تذكير المالك" | Actions filters "متأخر" / "متوقف"; the remind button becomes a row action there |
| Oversight project table (open, late, blocked, oldest review, lead, client last active) | Projects page, as a table view of the same projects. The reason line stays ("3 من 6 متأخرة"); the health word goes, or is set by a person (open question 1) |

### Project page: 11 tabs to 5

| Today | Target |
|---|---|
| التوصيات · التقدم · يحتاج انتباهاً · التتبّع · الاجتماعات · التقييمات · الطلبات · المستندات · سجل النشاط · الفريق · الإغلاق | **الخطة** · **التقدم** · **الملفات** · **الاجتماعات** · **الإعداد** |

Header: name, client, contract line, two buttons. Tabs start near 190 px always.

Where each thing lives:

| Thing today | Target place |
|---|---|
| Recommendations with their actions | الخطة: the list, default tab |
| Findings section | الخطة: one line "تعالج: …" on each recommendation (already there); findings with no recommendation in a short group at the end; "إضافة ملاحظة" inside the tab's add menu |
| 4 "إضافة توصية" buttons, Excel, استيراد | الخطة: one solid "إضافة توصية"; Excel and استيراد in a menu beside it |
| Needs attention tab | الخطة: filter chips "متأخر 3 · بانتظار المراجعة 1 · متوقف 1 · محل خلاف" |
| Trace tab: evidence file and review result per action | الخطة: shown when an action row is opened |
| Trace tab: indicator links | Already on the recommendation page and the indicator page |
| Assessments tab | الخطة: a "source" line above the list (name, status, lock) and "بدء تقييم" in the add menu; the score stays on the assessment page |
| Progress numbers, reports, handover | التقدم: numbers first, then reports, then handover |
| "Moved in the last 7 days" card | التقدم, top |
| Activity tab | التقدم, last section "السجل" |
| Requests tab | الملفات: section "مطلوب من العميل" |
| Documents tab | الملفات: section "كل الملفات", with an upload button |
| Meetings tab | الاجتماعات, unchanged |
| Team tab (firm team, client people, client roles) | الإعداد |
| "تعديل البيانات", contract link | الإعداد (the contract line stays in the header) |
| Closing tab | الإعداد: card "إغلاق المشروع"; while closing runs, the grey banner links straight to it |

Rough control count after: الخطة about 12 visible (one add button, one menu, chips, one menu per recommendation); الملفات about 10 (one main button per request, the rest in a row menu).

### Client page: split in three tabs

| Tab | Holds (cards of today) | Kind |
|---|---|---|
| **نظرة** (default) | التقدم عبر المشاريع · مؤشرات الأعمال · المشاريع (with "مشروع جديد") · a notice when a join request waits | dashboard |
| **الأشخاص** | الفريق (firm consultants) · أشخاص العميل (the whole `/clients/:id/people` page) · جهات اتصال العميل · طلبات الانضمام · الإدارات (the whole `/clients/:id/departments` page) | people |
| **الإعداد** | طريقة مشاركة العميل · الملف النظامي · الأسماء المختصرة · الاعتماد الثاني للأدلة · مساعد العميل · التعاقدات الموقعة · الأرشفة والاحتفاظ · فحص التعارض (prospects) | settings; the last three are rarely used |

"مستشارون مقترحون" moves inside the "إضافة مستشار" dialog: on شركة النخبة القابضة the card only says there is nothing to match (`ar/096`); I did not check the text of this card on the other four clients.

### Inquiry page: one step at a time

The steps are already stated on the list page: conflict check, discovery session, won or closed. On the inquiry page, number them in that order in one card and offer only the current one as the solid button; "إغلاق الطلب" stays as a quiet link. Owner, NDA and rating stay on the side as facts with an edit link.

### Gaps the admin runs into on these screens

- **No way to change an action's owner.** The project Team tab tells the admin "أعد إسناد إجراءاته أولًا" on four of five client people (`ar/020`), and the action page shows the owner as plain text (`ar/024`). The code reading confirms there is no control anywhere.
- **No upload on the project's Documents tab** (`ar/018`).
- **The admin's home misses decisions that are the admin's.** A project is ready to close and the notification says "وتغلقه أنت" (`ar/002`, `ar/052`), a date request waits with approve and reject buttons (`ar/022`), a review is "yours" (`ar/039`). None is on Today (`ar/005`).
- **No filter, search or client column on Actions** (`ar/007`).
- **No "add action" on the recommendation page** (`ar/076`).

---

## 5. Open questions for the product owner

1. Oversight calls a project "متعثر / Off track" by a fixed rule. Rule 1 says the app must not judge a project. Remove the word and keep the counts, or let the lead consultant set it?
2. Should the firm admin's home show decisions for every client, or only for clients the admin follows (today's behaviour, unexplained)?
3. Firm settings sit in the user menu, beside personal items. Move them to the sidebar's admin group?
4. Is a finding a first-class step (shown first, as today) or a note on a recommendation?
5. The Assessments row shows "37.5% · 6 gaps" on the project page. Should a score appear outside the assessment page at all?
6. A proposal for a prospect ("مقترح: حوكمة الشركة قبل الطرح") is listed among projects but not counted as an open project. Is a proposal a project?
7. "طلب" is used for inquiries, information requests, join requests and date requests. Which one keeps the word?
8. The captures missed `/team`, `/team/expertise`, `/settings` and the assistant. Should they be captured before the sidebar is decided?
