# Re-check of changed screens: client accounts

Helper report, 18 Nov 2026. Brief: `work/recheck-brief.md` (method from `work/audit-brief.md`).

Accounts: admin@nukhba, sponsor@nukhba, manager@nukhba (limited to the board secretariat), owner@nukhba (action owner, head of Legal), finance@nukhba (action owner, head of Finance), admin@rawdah, manager@rawdah, owner@rawdah. Rawdah has no departments.

Material: `recheck1/<account>/<ar|en>/` against `phase1/<account>/<ar|en>/`, matched by route, tab and heading (ids differ). Every evidence path below is relative to `docs/review/shots/`. Code read at `C:\Projects\selah-lead` (HEAD c78a7a9, which is #165 plus review docs).

Things to know before reading the counts:

- **Walkthrough data changed, not only screens.** #165 put the sponsor in all three departments (`apps/web/scripts/walkthrough/seed.ts:279-285`). He now sees Legal work he did not see in phase 1: actions 16 links (phase 1: 14), home 12 links (9), one more notification. #165 also added two Rawdah meetings (`seed.ts:711-741`). #161 changed the matrix sample (N15). Count changes from these are data, not faults.
- The crawler follows links on the screen. A screen with no link to a page never opens it. So the limited manager's "Not found" on a whole-project meeting does not appear in recheck1 (see check 3).
- Not captured in recheck1: the floating Files card, dialogs (the meeting form and its new warning), Excel exports, mails. I judged these from the code only, or not at all, as stated.
- The "N" and "Compiling…" bubbles in the screenshots come from the dev server, not the app.
- Recheck1 has no tablet overflow and no console events on any page for these eight accounts. Every page answered 200. No client account reached a "Not found" page by following a link. In phase 1, manager@nukhba hit one and owner@nukhba hit two.

## 0. The five blocking checks: all pass

| Check | Result | Evidence |
|---|---|---|
| No draft action visible to a client anywhere | **Pass** | The draft's title «اعتماد قرار تشكيل اللجنة ونشره» appears 0 times in the recheck1 `pages.json` of all five Nukhba accounts, in both languages. Phase 1 (AR): admin 5, sponsor 5, manager 5, owner 1. The English "Draft" status also appears 0 times (phase 1: 2/4/4/1). Admin `/actions` has 8 rows (phase 1: 9, the draft included). `/projects` reads "8 إجراءات · مُتحقق: 1" (phase 1 drew 1 of 9). The home department table adds up to 8. Recommendation «تشكيل لجنة المراجعة» lists 2 actions for the admin. The manager's "1 more action" counts only the Legal action, so the draft is not counted. No notification and no agenda names it. `recheck1/admin_at_nukhba.test/ar/006-actions-1280.png`, `.../036-recommendations_bbdc8a3e-1280.png`, `.../011-projects_f19fbafb-1280-full.png`, `.../001-home-1280-full.png`, `.../005-projects-1280.png` |
| An action owner sees no title and no count of other people's actions | **Pass** (Files card not recaptured) | owner@nukhba: the recommendation page lists only his action, with no "N more" (phase 1 listed 3, the draft included). Meetings tab: none (phase 1: 3 meetings with the full agenda, N5). Notifications: only his own. `/projects` shows "3 إجراءات", his own. finance@nukhba on the 3rd steering meeting (whole project, she is invited): the agenda is built from her own work only; the follow-ups show only hers (the admin sees 3); the decision shows. The Files card had no recheck pass. The code keeps a teammate's file but no longer names its action (`apps/web/src/services/files.ts:168-173`). Not verified on screen. `recheck1/owner_at_nukhba.test/ar/016-recommendations_bbdc8a3e-1280.png` vs `phase1/owner_at_nukhba.test/ar/017-recommendations_e25c9908-1280.png`; `recheck1/owner_at_nukhba.test/ar/009-projects_f19fbafb_tab_الاجتماعات-1280.png`; `recheck1/finance_at_nukhba.test/ar/015-meetings_58746940-1280.png` vs `recheck1/admin_at_nukhba.test/ar/039-meetings_58746940-1280-full.png` |
| A department-limited manager sees nothing by title from other departments, and gets "Not found" on a whole-project meeting | **Pass**, with an evidence gap for "Not found" | Her Meetings tab lists no meeting, so recheck1 never opened one. "Not found" is shown in the lead's own check `check-agenda/manager_at_nukhba.test/ar/001-meetings_574c3428-1280.png` (17 Nov, phase-1 data). The code agrees: a RESTRICTIVE `whole_project` policy on meetings (`apps/web/drizzle/0082_whole_project_meetings.sql`), so `loadMeeting` finds no row and the page answers 404. Titles: the recommendation page reads «إجراء واحد آخر لا يظهر لك», with no title. On `/departments` only her own department is a link: 1 link (phase 1: 3, and the Finance link led to "Not found"). The Activity tab and the Finance workshop are gone. Her home, `/actions` (4 rows) and indicator pages show only secretariat or company-wide work. `recheck1/manager_at_nukhba.test/ar/024-recommendations_bbdc8a3e-1280.png`, `.../008-departments-1280.png`, `.../012-projects_f19fbafb_tab_الاجتماعات-1280.png`, `.../001-home-1280-full.png` |
| At Rawdah an invited action owner opens the meeting and sees only her own tasks on its agenda | **Pass**, with one new fault (F1) | owner@rawdah opens «Hand-over of the quarterly reviews». The agenda reads «إجراءاتك المدرجة في جدول أعمال هذا الاجتماع فقط» and lists her 2 actions. The admin reads 4. She does not see the other meeting, to which she is not invited. One attendee shows as "—" (F1). `recheck1/owner_at_rawdah.test/ar/017-meetings_6834f191-1280.png`, `recheck1/admin_at_rawdah.test/ar/029-meetings_6834f191-1280.png`, `recheck1/owner_at_rawdah.test/ar/010-projects_daf3dd74_tab_الاجتماعات-1280.png` |
| A client admin has no Link / Unlink | **Pass** | Indicator pages have 9 buttons (phase 1: 11, with «ربط» and «فك الربط»). Recommendation pages have 2 buttons (phase 1: 4). On «تشكيل لجنة المراجعة» the empty "Linked indicators" card with its Link button is gone: no empty card is left (`linked-indicators-card.tsx:21`). Rule: `apps/web/src/authz/policy.ts:267` (firm only). `recheck1/admin_at_nukhba.test/ar/025-indicators_1f0dfa02-1280-full.png`, `.../024-indicators_40f1951c-1280.png`, `.../035-recommendations_50687788-1280.png`, `.../036-recommendations_bbdc8a3e-1280.png` |

## 1. One row per changed screen

Counts are visible buttons (+ menu items) from the Arabic `pages.json`, today vs phase 1.

| Route (tab) | Accounts | What changed since phase 1 | Right? | New faults | Screen standard (main action; controls today vs phase 1; labels) | Evidence (`recheck1/…`) |
|---|---|---|---|---|---|---|
| `/` home | all 8 | Drafts left out of the counters and lists at Nukhba. Rawdah admin: the "how should your figures reach Selah" card is gone. | Yes | F6 (Rawdah admin: the indicators card stays, empty) | Admin@nukhba 7 (7): the data-mode card still sits on top with the solid «تأكيد». Admin@rawdah 2 (7): the only solid button is «مؤشر جديد». Sponsor 1 (1), manager 1 (1), owners 0 / 0 / 1 (same). Labels speak about the client: «مطالبات تقدم من العميل»; the indicators hint «مقاييس العميل الخاصة لأعماله»; the banner (F4). U04 is still true at Rawdah: «لا يوجد ما يحتاج انتباهك الآن» while two recommendations wait for her answer. | `admin_at_nukhba.test/ar/001-home-1280-full.png`, `admin_at_rawdah.test/ar/001-home-1280-full.png`, `manager_at_nukhba.test/ar/001-home-1280-full.png`, `owner_at_nukhba.test/ar/001-home-1280.png` |
| `/notifications` | all 8 | Same layout. No draft notice. Owners see only their own work. List changes come from data: the sponsor gained the conflict-of-interest notice and lost "update about something you can no longer open"; finance lost "new evidence requested" (seed). | Yes | none | 17/15/17/15/14/12/14/13 (phase 1: 17/15/17/15/15/12/14/13). | `*/ar/002-notifications-1280.png` |
| `/projects` | all 8 | The card counts released work only: "8 إجراءات · مُتحقق: 1", and the bar draws 1 of 8 (B2). Owners see their own count only ("3 إجراءات", "إجراءان"). | Yes | none | 0 buttons (0). The chip «عميل» and «العميل: شركة النخبة القابضة» call the reader's own company "the client". | `admin_at_nukhba.test/ar/005-projects-1280.png`, `owner_at_nukhba.test/ar/006-projects-1280.png` |
| `/actions` | all 8 | The draft row is gone. | Yes | none | 1 button (Excel). Links: admin 16 (18), manager 8 (10), sponsor 16 (14, data). | `admin_at_nukhba.test/ar/006-actions-1280.png`, `manager_at_nukhba.test/ar/006-actions-1280.png` |
| `/departments` | admins, managers | B4: readers see the word «مفعّلة» / «متوقفة» instead of a dimmed switch. For the limited manager only her own department is a link. | Yes | none | Admin@nukhba 23 (21): two more because the sponsor now sits in Legal (data). U15 is still true: three department cards with 23 visible buttons. Readers 0 (0). | `manager_at_nukhba.test/ar/008-departments-1280.png`, `manager_at_rawdah.test/ar/008-departments-1280.png`, `admin_at_nukhba.test/ar/008-departments-1280.png` |
| `/departments/:id` | Nukhba admin and managers | The manager reaches only the secretariat (in phase 1 she reached Finance and got "Not found"). Content unchanged. | Yes | none | 1 (1) for the admin, 0 for managers. The indicators card carries the banner (F4). | `manager_at_nukhba.test/ar/017-departments_9915082b-1280.png` |
| `/team` | admins, managers | The manager's view gains the line «المشاريع: ما يعمل عليه كل شخص من المشاريع التي يمكنك أنت فتحها» (N13 explained). | Yes | none | Admin@nukhba 7 (+12), admin@rawdah 5 (+6), managers 0: same as phase 1. Role labels «مدير لدى العميل», «مدير حساب العميل». | `manager_at_nukhba.test/ar/007-team-1280.png` |
| `/projects/:id` Recommendations | all 8 | Draft gone (admin links 18 vs 19). The manager gets a new finding line «تعالجها توصية في إدارة أخرى» with no recommendation title. Owners see only recommendations that hold their own actions, and only those actions. | Yes | none | Tabs: admin 10 (10), sponsor 9 (10), manager 8 (9), owners@nukhba 5 (6), admin@rawdah 10 (10), manager@rawdah 9 (10), owner@rawdah 6 (7). Tab row: admin 517 px, sponsor 473, manager 405, owners 148/208, Rawdah 509/465. All 10 tabs fit at 768 px. U02 is still true. | `admin_at_nukhba.test/ar/011-projects_f19fbafb-1280-full.png`, `manager_at_nukhba.test/ar/009-projects_f19fbafb-1280.png`, `owner_at_nukhba.test/ar/008-projects_f19fbafb-1280.png` |
| tab Activity | admins only now | Gone for managers and owners (the phase 1 tab counts drop by one). Kept for both client admins. Rows now read «…، بواسطة». | Yes | none | 1 (1). One row reads «تسجيل قبول العميل للمخاطرة». | `admin_at_nukhba.test/ar/018-projects_f19fbafb_tab_سجل_النشاط-1280.png` |
| tab Progress | admins, managers | N14 fixed for the manager: the late card now reads "1–30 يومًا: 1". In phase 1 it read "no open action passed its original date" next to "late 1". | Yes | F5 (hint text no longer true) | Admin 1 (1), others 0. «راعي العميل». | `manager_at_nukhba.test/ar/010-projects_f19fbafb_tab_التقدم-1280-full.png` vs `phase1/manager_at_nukhba.test/ar/010-projects_8c55994f_tab_التقدم-1280-full.png` |
| tab Meetings | all 8 | Department rule and whole-project rule applied. Manager@nukhba: none (phase 1: 3). Owner@nukhba: none (3). Finance: 2, the meetings she is invited to (3). Rawdah: 2 new meetings; owner@rawdah 1. | Yes | F2 (the manager reads «لا توجد اجتماعات بعد») | Admin 2 (2), manager 1 (1): «حجز اجتماع» is solid. | `manager_at_nukhba.test/ar/012-projects_f19fbafb_tab_الاجتماعات-1280.png`, `finance_at_nukhba.test/ar/009-projects_f19fbafb_tab_الاجتماعات-1280.png` |
| tabs Assessments, Requests, Documents, Team, Closing | as in phase 1 | Looks the same as phase 1 for these accounts (counts identical). The Assessments tab still reads «لم تُشارك معكم أي تقييمات بعد». | — | none | The Documents badge «مشترك مع العميل» and the Team card «أدوار العميل» still speak about "the client". | `admin_at_nukhba.test/ar/015…`, `017…`, `019…`, `020…` |
| `/recommendations/:id` | all 8 | Owners: only their own actions, no count. Limited manager: "1 more action is not shown to you". Admin: draft gone, Link/Unlink gone, empty linked-indicators card gone. | Yes | none | Admin 2 (4/3/4), sponsor 2 (2), manager 1 (1), owners 0 (0), Rawdah 1/0 (1/0). One solid button when an answer is due («الرد»). Labels: «رد العميل»; «يرد مدير حساب العميل أو راعي المشروع»; «مؤشرات العميل التي يُتوقع أن تحرّكها هذه التوصية»; the banner. An owner reads «بيّن هل توافق على هذه التوصية…», which he cannot do (unchanged). | `owner_at_nukhba.test/ar/016-…`, `manager_at_nukhba.test/ar/024-…`, `admin_at_nukhba.test/ar/036-…` |
| `/indicators/:id` | Nukhba admin, sponsor, manager | Link / Unlink gone for the client admin. | Yes | F4 (banner wording; not new) | Admin 9 (11), sponsor 7 (7), manager 7 (7). One solid «إدخال قيمة». Each value row still has its own «تصحيح» button, 5 per page (row 28 still true). | `admin_at_nukhba.test/ar/025-indicators_1f0dfa02-1280-full.png`, `manager_at_nukhba.test/ar/018-indicators_40f1951c-1280.png` |
| `/indicators/data` | both client admins | Same as phase 1. At Rawdah it is no longer pushed onto the home. | Yes | none | 4 (4). Footer «هذه أرقام يعلنها العميل من سجلاته…». | `admin_at_nukhba.test/ar/023-…`, `admin_at_rawdah.test/ar/020-…` |
| `/meetings/:id` | all who may open | B1: statuses in words and dates formatted. In phase 1 the agenda showed «(revision_requested)» and «2026-11-10». B5: no hydration error (phase 1: 1 page error on every scheduled meeting for all five Nukhba accounts; now 0). New per-reader agenda for owners and limited readers, and the whole-project gate. | Yes | F1 (nameless attendee), F3 (agenda language), F7 (two "late" lists) | 4th steering: admin 3 (3), sponsor 3 (3). Finance workshop: finance 3 (3). Hand-over: admin 3 and owner 3 (new), manager 0. One solid «الانضمام إلى الاجتماع». U14 is still true: Summary and Decisions show as empty cards before the meeting. The badge «مشترك مع العميل». | `owner_at_rawdah.test/ar/017-…`, `finance_at_nukhba.test/ar/015-…`, `admin_at_nukhba.test/ar/041-meetings_932ac4de-1280.png` |
| `/actions/:id` | all 8 | Draft gone. The reminder ladder no longer shows on finished actions (B3), and the date-change card is gone where it does not apply. The matrix's answered item now shows «تنزيل» (N15, seed). | Yes | none | Admin 5–7 (5–6), sponsor 5–12 (6–13), finance 6/10 (6/11), owner 4–10 (4–10). U11 is still true: the ladder and the sign-off count show on open actions. | `admin_at_rawdah.test/ar/022-actions_ffca057c-1280.png`, `owner_at_nukhba.test/ar/014-actions_92253cad-1280.png`, `finance_at_nukhba.test/ar/013-…` |
| `/reports/:id` | Nukhba admin and managers | Whole-project numbers, no action titles. | Yes | Question 3 (the firm's own note names Finance work) | 1 (1). | `manager_at_nukhba.test/ar/025-reports_bc7713a9-1280-full.png` |
| `/security`, `/consent` | all / owner@rawdah | A language button «English» was added (#153): 2 buttons (1), consent 5 (4). Nothing else. | Yes | none | — | `*/ar/003-security-1280.png`, `owner_at_rawdah.test/ar/001-consent-1280.png` |

## 2. Faults found (most serious first)

None is blocking: nobody sees what they may not.

**F1. A meeting attendee with no name (medium, new screen).** owner@rawdah, «Hand-over of the quarterly reviews»: the attendee list reads «ماجد السبيعي · المنظِّم», «—», «دانة العمري». The "—" is the client admin, Hind. The admin and the manager see her name. On the owner's own Team tab she is named as the sponsor («الراعي | هند الزهراني»). Cause:

- Attendee names are read from the user table under row-level security (`apps/web/src/services/meetings.ts:235-248`), and the page falls back to "—" (`apps/web/src/app/(app)/meetings/[id]/page.tsx:401`).
- `app_can_see_user` (`apps/web/drizzle/0000_baseline.sql`) lets an action owner see a colleague only through project membership.
- At Rawdah the client admin is not a project member (`seed.ts:679`). A client admin often is not, so this is a product fault, not a seed artefact.

Evidence: `recheck1/owner_at_rawdah.test/ar/017-meetings_6834f191-1280.png`, `…/768.png`, `recheck1/owner_at_rawdah.test/en/016-meetings_6834f191-1280.png`.

**F2. "No meetings yet" for an invitee who may not open them (medium).** manager@nukhba's Meetings tab reads «لا توجد اجتماعات بعد», and its only main action is the solid «حجز اجتماع». She is an attendee of the 3rd and 4th steering meetings (`seed.ts:529, 555`), and a calendar invite was sent for the 4th (`seed.ts:558`; `app_send_meeting_invites` mails every attendee, `0000_baseline.sql`).

- No leak: the invite carries the title and the call link, no Selah link and no agenda (`apps/web/src/lib/ics.ts:68-70`).
- But the screen states something untrue, and D8 asks the screen to say when something is left out, without titles.

Evidence: `recheck1/manager_at_nukhba.test/ar/012-projects_f19fbafb_tab_الاجتماعات-1280.png`.

**F3. The agenda follows the meeting's language, not the reader's (low; the language part of B1 is still true).**

- Rawdah's meeting is held in English. On the Arabic page the admin, the manager and the owner read «Changed since the last meeting» and «(In progress)» / «(Verified complete)». In the owner's card this sits under an Arabic line.
- Nukhba agendas stay Arabic on the English pages.
- The list for owners and limited readers is built for each reader when they open the page (`apps/web/drizzle/0085_live_agenda.sql`, which passes `m.spoken_lang`). So that list at least could follow the page language.

Evidence: `recheck1/owner_at_rawdah.test/ar/017-…`, `recheck1/admin_at_rawdah.test/ar/029-…`, `recheck1/finance_at_nukhba.test/en/016-meetings_721bc08b-1280.png`.

**F4. The indicator banner speaks about "the client" to the client (low; the lead's question, confirmed).** «هذه الأرقام يبلّغ عنها العميل وليست أثرًا موثّقًا…» / "These figures are reported by the client…" (`apps/web/messages/ar.json:4828`, `en.json:4828`). One key serves every reader. It appears:

- under the title of `/indicators/:id` (`indicators/[id]/page.tsx:120-123`): admin@nukhba `024`, `025`; sponsor `020`, `021`; manager@nukhba `018`;
- on the linked-indicators card of `/recommendations/:id` (`linked-indicators-card.tsx:69`): admin `035`, `037`; sponsor `030`, `032`; manager `023`;
- under the Business indicators card on the home and on `/departments/:id` (`indicators-card.tsx:173`): admin@nukhba, sponsor and manager@nukhba homes and their department pages; admin@rawdah's home too, under an empty card.

A variant sits on `/indicators/data`: «هذه أرقام يعلنها العميل من سجلاته…» (`ar.json:5072`), seen by admin@nukhba `023` and admin@rawdah `020`. The same cards also say «مقاييس العميل الخاصة لأعماله» (`ar.json:4817`) and «مؤشرات العميل التي…» (`ar.json:4891`). Rawdah's empty card adds «أضف المقاييس التي يتابعها العميل أصلًا» (`ar.json:4825`).

Not shown to the three action owners or to manager@rawdah, who reach no indicator card. The banner is not new (phase 1 row 28 already asked for "plain words for the disclaimer on client screens", batch 1). #165 edited both files without changing it. The client wording is already decided («أرقام شركتكم كما أُبلغ عنها، وليست أثرًا موثّقًا», build brief), and #167 already switches its notice text by reader (`ar.json`, `indicator_moved_away`, `reader, select, client`).

**F5. A Progress hint that is no longer true (low).** «يرى مديرو العميل ومسؤولوه الأرقام نفسها» / "The client's admins and managers see the same numbers" (`ar.json:1613`, `en.json:1613`). manager@nukhba sees 25 % (1 of 4), the admin 13 % (1 of 8). The text is from before batch 0; D8 makes it plainly wrong. It also speaks about "the client". Evidence: `recheck1/manager_at_nukhba.test/ar/010-projects_f19fbafb_tab_التقدم-1280-full.png` vs `recheck1/admin_at_nukhba.test/ar/012-projects_f19fbafb_tab_التقدم-1280.png`.

**F6. Rawdah admin home: an empty indicators card (low).** The data-mode card is gone, as asked. But at a client with no indicators and a closing project, the Business indicators card still shows:

- an empty state that speaks about "the client" («أضف المقاييس التي يتابعها العميل أصلًا»);
- a disclaimer about figures that do not exist;
- the page's only solid button, «مؤشر جديد».

Evidence: `recheck1/admin_at_rawdah.test/ar/001-home-1280-full.png`.

**F7. Two "late" lists for one meeting (observation, not a fault in real use).** On the 3rd steering meeting finance@nukhba reads «لا يتضمن جدول أعمال هذا الاجتماع أيًّا من إجراءاتك». The admin's stored agenda lists her «مراجعة حدود الصلاحيات المالية» as late. Two definitions are at work:

- the stored text counts "late" as of booking;
- the per-reader list counts "late" as of the meeting's day (`0085_live_agenda.sql`).

The seed books this past meeting today, so the two disagree. In real use they can still differ for an action that falls due between booking and the meeting. Evidence: `recheck1/finance_at_nukhba.test/ar/015-meetings_58746940-1280.png` vs `recheck1/admin_at_nukhba.test/ar/039-meetings_58746940-1280-full.png`.

## 3. Phase 1 marks on these screens

| Mark | Today | Screenshot (`recheck1/…` unless noted) |
|---|---|---|
| N1 owner sees others' actions on a recommendation, links "Not found" | **Fixed** | `owner_at_nukhba.test/ar/016-…` vs `phase1/owner_at_nukhba.test/ar/017-…` |
| N2 draft listed and opened for client admin and managers; 9 rows vs "1 of 8" | **Fixed** | `admin_at_nukhba.test/ar/006-actions-1280.png`, `005-projects-1280.png` |
| N3 limited manager sees other departments' work (agendas, Finance workshop, Activity, report) | **Fixed** for agendas, the workshop and Activity. The report keeps whole-project numbers by decision, with no titles; the firm's free-text note is question 3. | `manager_at_nukhba.test/ar/012-…`, `009-…` (8 tabs), `025-reports…` |
| N5 agenda names everyone's late work to an owner on meetings he is not invited to | **Fixed** | `owner_at_nukhba.test/ar/009-…الاجتماعات…`; `check-agenda/owner_at_nukhba.test/ar/003-meetings_574c3428-1280.png` ("Not found") |
| N14 "Late: 1" beside "no open action passed its original date" | **Fixed** (manager) | `manager_at_nukhba.test/ar/010-…التقدم-1280-full.png` |
| N15 answered evidence item shown as "not sent" | **Fixed** (seed) | `finance_at_nukhba.test/ar/013-actions_d5108ece-1280.png` |
| N13 Team "Projects" number changes with the reader | **Partly**: explained by a footnote for managers | `manager_at_nukhba.test/ar/007-team-1280.png` |
| B1 raw status keys and raw dates on the agenda; Arabic headings on the English page | **Partly**: words and dates fixed; language still follows the meeting (F3) | `admin_at_nukhba.test/ar/041-…` vs `phase1/manager_at_nukhba.test/ar/031-…` |
| B2 Projects card draws 1 of 9 | **Fixed** | `admin_at_nukhba.test/ar/005-projects-1280.png` |
| B3 reminder ladder with past dates on finished actions | **Fixed** on verified and closed actions | `admin_at_rawdah.test/ar/022-…`, `owner_at_nukhba.test/ar/014-…` |
| B4 departments switch drawn "off" for readers | **Fixed** | `manager_at_nukhba.test/ar/008-departments-1280.png` |
| B5 hydration error on scheduled meetings | **Fixed** for all client accounts (0 events, was 1 per scheduled meeting) | `admin_at_nukhba.test/ar/041-…` |
| Row 4e meeting filed under a department follows the department rule | **Fixed** | `manager_at_nukhba.test/ar/012-…` |
| Row 4i Activity not for managers and owners | **Fixed** | tab counts in section 1 |
| Row 6 recommendation lists only openable actions and says how many more | **Fixed** (owners get no count, by decision) | `manager_at_nukhba.test/ar/024-…` |
| Row 24 / Departments link to "Not found" | **Fixed** | `manager_at_nukhba.test/ar/008-…` (1 link) |
| Row 28 indicator: row menu for value buttons; plain words for the disclaimer | **Still true** (5 «تصحيح» buttons; F4) | `admin_at_nukhba.test/ar/025-…` |
| Row 29 indicators/data card on the client admin home; hidden at a client with no indicators and a closing project | **Partly**: fixed at Rawdah; still the first card at Nukhba; the empty indicators card stays at Rawdah (F6) | `admin_at_rawdah.test/ar/001-…`, `admin_at_nukhba.test/ar/001-…` |
| 3.8 Rawdah home asks how figures reach Selah | **Fixed** | `admin_at_rawdah.test/ar/001-home-1280-full.png` |
| §7 "Should Link / Unlink be the firm's alone?" | **Done** | `admin_at_nukhba.test/ar/024-…`, `025-…` |
| U04 client homes do not show the client's job | **Still true** (Rawdah admin: «لا يوجد ما يحتاج انتباهك الآن» with 2 recommendations awaiting her answer) | `admin_at_rawdah.test/ar/001-…` |
| U11 firm machinery on client pages | **Still true** (ladder and «تم اعتماد واحد من اثنين» on open actions) | `manager_at_nukhba.test/ar/020-actions_573c6a60-1280.png` |
| U12 firm vocabulary, "the client" spoken to the client | **Still true** («رد العميل», «مشترك مع العميل», «أدوار العميل», «العميل:», the banner) | `owner_at_nukhba.test/ar/016-…`, `owner_at_rawdah.test/ar/017-…` |
| U14 meeting page full before the meeting | **Still true** (Summary and Decisions empty on scheduled meetings) | `owner_at_rawdah.test/ar/017-…` |
| U15 departments: 21 buttons for 3 departments | **Still true** (23, data) | `admin_at_nukhba.test/ar/008-…` |
| N17 meeting reply only inside the meeting | **Still true** (owner@rawdah home: nothing waits, while the hand-over meeting waits for her reply) | `owner_at_rawdah.test/ar/002-home-1280.png` |

## 4. Open questions for Fahad

1. Use the decided client wording («أرقام شركتكم كما أُبلغ عنها، وليست أثرًا موثّقًا») for client readers on the indicator banner and the indicator cards now, or keep it for batch 1 as planned (F4)?
2. A department-limited manager invited to a whole-project meeting: should her Meetings tab say how many meetings are not shown, without titles, as recommendation pages do for actions? And should she still get the calendar invite (F2)?
3. A shared report's "Notes" are written by the firm. Here they name Finance work to a secretariat-only manager: «مصفوفة الصلاحيات متأخرة أسبوعين» (`manager_at_nukhba.test/ar/025-reports_bc7713a9-1280-full.png`). Accept, since the firm wrote and shared it, or warn the firm when it shares?
