# Page audit: action owners and the first sign-in

Accounts: `owner@nukhba.test` (عبدالله المطيري), `finance@nukhba.test` (سلمى الشهري), `owner@rawdah.test` (دانة العمري).

Sources: the phase 1 capture for the three accounts in Arabic and English, the second pass (`phase1-extra`: Files card, `/assistant`, `/team`), and the code where a screen needed explaining. Evidence paths are relative to `docs/review/shots/phase1/`; second-pass paths start with `../phase1-extra/`.

Limits of the material, so nothing below is read as more than it is:

- The consent page was captured in Arabic only (it was accepted during the Arabic pass). The English consent text is judged from `apps/web/messages/en.json`, not from a screenshot.
- 768 px screenshots exist in Arabic only. "English at 768" for Rawdah is judged from the Arabic 768 shots (the data is English) and the English 1280 shots.
- The second pass is complete for all three accounts in both languages. `/assistant` and `/team` answer "غير موجود / Not found" for all three, as the walkthrough expects (so do `/departments`, `/audit`, `/group`, `/leaving` and `/indicators/*` where they were tried). The Files card opens for all three with a search box, a close button and the folder rows, and no button to add a file.
- The black "N" circle and the "1 Issue" / "Compiling" pill in the corner of the shots are the development tool, not Selah.

The test applied to every screen: a department head with ten minutes between meetings asks "what do they want from me, by when, and how do I send it?"

---

## 1. One row per page

Controls are counted in the page body for the busiest of the three accounts (buttons + items inside menus; there are no menus on any owner page). Links are given separately where they matter.

| Route | Roles | Purpose | Controls | First screen 1280x800 | First screen 768x1024 | Verdict | Reason | Evidence |
|---|---|---|---|---|---|---|---|---|
| `/consent` | owner@rawdah (first sign-in only) | Accept the terms, the privacy notice and the AI notice before anything opens. | 4 + 0 counted (3 tick boxes, "ليس الآن، تسجيل الخروج") plus the solid "قبول ومتابعة", which is disabled until all three are ticked; 3 links | Whole form fits: three small cards, each one sentence, one link, one tick box. The sign-out link is cut at the fold (page is 1.1 screens). | Fits in one screen, centred. | **keep** | Short and plain: about 25 words per document. One fault: the third card describes an assistant this role never gets. | `owner_at_rawdah.test/ar/001-consent-1280-full.png`, `…/001-consent-768.png` |
| `/` Overview | all three | Cannot be said in one sentence for an owner: four counters about the firm's view of his work, plus a list of what is late or sent back. | 0 + 0 (Rawdah: 1, "إخفاء الترحيب"), 2 links | Four counter cards, the red "متأخرة: 1" bar, a one-row table, a footnote. Rawdah: the welcome card first, then counters, then "لا يوجد ما يحتاج انتباهك الآن." | Counters in a 2x2 grid take the top half; the list starts at 540 px. No overflow. | **merge** into `/actions` (My actions becomes the owner's home) | An owner has two or three actions. The counters describe them in the firm's words and leave out the ones not started. The list shows only late or sent-back work, so it can say "nothing needs your attention" while an action is open. | `owner_at_nukhba.test/ar/001-home-1280.png`, `finance_at_nukhba.test/ar/001-home-768.png`, `owner_at_rawdah.test/ar/002-home-1280.png` |
| `/actions` ("إجراءاتي" in the sidebar, "الإجراءات" as page title) | all three | The list of actions given to this person. | 1 + 0 ("Excel"), 4 to 6 links | The whole list (2 or 3 rows): action, project, owner, due, status. | Same, all columns kept. | **keep** (trim the "المسؤول" column and "Excel"; group open work above finished work) | This is the page that answers "what do they want from me". The owner column always shows the reader's own name. Closed and verified rows sit between open ones. | `owner_at_nukhba.test/ar/005-actions-1280.png`, `finance_at_nukhba.test/ar/005-actions-1280.png` |
| `/actions/:id` | all three (7 actions captured, 6 states) | Do one action: read what is asked, send the proof, talk to the consultant. | up to 11 + 0, 2 text boxes on the page and a third in the upload dialog (finance, action with an evidence list) | "الخطوة التالية" card with one to three buttons and the progress-note box; side panel with project, recommendation, owner, due date, department, expected evidence, client; the date-change card at the fold. | Side panel drops below the history: the due date, the expected evidence and "طلب موعد جديد" are 1.7 to 2.5 screens down. | **trim** (see part 4 for the order and what goes) | The right page, but it shows everything it has. Details per state below the table. | `owner_at_nukhba.test/ar/007-actions_a6a726cb-1280-full.png`, `…/007-actions_a6a726cb-768.png`, `finance_at_nukhba.test/ar/014-actions_60d3d21a-1280-full.png` |
| `/projects` | all three | List the projects this person is on. | 0 + 0, 1 link | One card: a "عميل" badge, the project name, "العميل: <own company>", a bar, "3 إجراءات · 0 مُتحقق · 0 بانتظار المراجعة". | Same. | **cut** for owners | A list of one. The project name is already on every action row and on the action page. An owner on several projects gets the grouping on My actions. | `owner_at_nukhba.test/ar/006-projects-1280.png` |
| `/projects/:id` tab "التوصيات / Recommendations" | all three | The recommendations that carry this person's actions. | 1 + 0 ("Excel"; in English also 3 "Show in English"), 6 tabs, 3 to 6 links | Project title, description, tab row at 148 px (208 px on the closing project), then one card per recommendation with the reader's own actions under it. | Same, no overflow. | **merge** into `/actions` | It is My actions again, grouped by recommendation, with the same rows. The only new facts are the recommendation's one-line reason and "الأدلة المطلوبة", which belong beside the action. | `owner_at_nukhba.test/ar/008-projects_8c55994f-1280-full.png`, `owner_at_rawdah.test/ar/009-projects_61d37bdc-768.png` |
| `/projects/:id` tab "الاجتماعات / Meetings" | all three (empty for Rawdah) | List the project's meetings. | 0 + 0, 3 links | Three rows: name, date, "انعقد" or "مجدول". | Same. | **cut** for owners | It lists every meeting of the project, including ones the owner is not invited to. An invited owner reaches the meeting from the invitation mail and the notification. | `owner_at_nukhba.test/ar/009-projects_8c55994f_tab_الاجتماعات-1280.png` |
| `/projects/:id` tab "الطلبات / Requests" | all three | Documents the firm asked the client for. | 0 + 0 | "طلبات المعلومات. ما تحتاجه الشركة منكم لهذا المشروع. لم تطلب الشركة أي شيء بعد." | Same. | **cut** for owners | Empty for all three owners, although Al-Nukhba has a request list. An owner cannot answer it; the tab only says something untrue ("the firm has not asked for anything"). | `owner_at_nukhba.test/ar/010-projects_8c55994f_tab_الطلبات-1280.png` |
| `/projects/:id` tab "المستندات / Documents" | all three | Files of the project the person may open. | 0 + 0, 1 or 2 links | One or two rows: the owner's own evidence files, "الإصدار 1", "مشترك مع العميل". | Same. | **cut** for owners | The same files are in the history of the action they belong to. | `owner_at_nukhba.test/ar/011-projects_8c55994f_tab_المستندات-1280.png` |
| `/projects/:id` tab "سجل النشاط / Activity" | all three | Nothing for an owner. | 0 + 0 | "لا يوجد نشاط مسجل." | Same. | **cut** for owners | Always empty for this role (three accounts, three empty tabs). | `owner_at_nukhba.test/ar/012-projects_8c55994f_tab_سجل_النشاط-1280.png` |
| `/projects/:id` tab "الفريق / Team" | all three | Who stands for the client on the project. | 0 + 0 | "أدوار العميل": sponsor, coordinator, steering committee, "معتمد التسليمات", observer. The consultants are not listed. | Same. | **merge** into `/help` ("مستشاروك" already names the people) | The sentence under the title is about escalation. The people an owner needs (his consultants) are on Help, not here. | `owner_at_nukhba.test/ar/013-projects_8c55994f_tab_الفريق-1280.png` |
| `/projects/:id` tab "الإغلاق / Closing" | owner@rawdah | What happens to the open actions when the project closes. | 0 + 0 | Lock banner "هذا المشروع قيد الإغلاق…", the closing card, a table with the owner's own action: "سُلِّم · يتولاه دانة العمري". | Same. | **merge** into `/actions/:id` | This is the only place Dana learns that her open action was handed over to her. That one line belongs on the action. | `owner_at_rawdah.test/ar/015-projects_61d37bdc_tab_الإغلاق-1280.png` |
| `/recommendations/:id` | all three | Show one recommendation, the client's answer and its actions. | 0 + 0 (English: 1 "Show in English"), 3 to 5 links | Title, status, the "رد العميل" card with instructions the owner cannot follow, the "الإجراءات" card, a side panel with finding, priority, due date, source, proof of completion. | Stacked; side panel below. | **trim** (for owners: drop the answer instructions and other people's actions) | The background is useful ("why was I asked this"). The answer card tells the reader to say whether he agrees, then says someone else answers. The actions card links to pages that answer "غير موجود". | `owner_at_nukhba.test/ar/017-recommendations_e25c9908-1280.png`, `…/017-recommendations_e25c9908-768.png` |
| `/meetings/:id` | owner@nukhba (invited to none of the three), finance (invited to two) | One meeting: time, agenda, summary, decisions, follow-ups, attendees. | 3 + 0 (finance: "قبِل / ربما / اعتذر"; or "تمت" on her follow-up), 1 to 3 links | Time and "الانضمام إلى الاجتماع" (solid), the agenda with every late and waiting action of the project and raw status keys, then empty "الملخص" and "القرارات" cards. | Stacked, attendees last. | **trim** (for owners: only meetings they are invited to; no agenda of other people's work; no empty cards before the meeting) | Useful to an invited owner for three things: when, how to join, and "my follow-up". The rest is the steering committee's material. | `owner_at_nukhba.test/ar/021-meetings_574c3428-1280-full.png`, `finance_at_nukhba.test/ar/016-meetings_beaa4143-1280-full.png`, `finance_at_nukhba.test/ar/017-meetings_5ec72542-1280.png` |
| `/notifications` | all three | Read what changed; choose when mail arrives. | 15 + 0 (6 notification rows, "تحديد الكل كمقروء", 2 pickers, 2 time pickers, 3 switches, "حفظ"), 4 fields | The notification rows, then the heading "البريد" and the first mail options. | Same order, 1.4 screens. | **trim** (the mail options move to the user menu, beside "التحقق بخطوتين") | The list is 6 rows; the mail settings and the muted-actions box are two thirds of the page. An owner opens the bell to see what changed, not to set quiet hours. | `owner_at_nukhba.test/ar/002-notifications-1280-full.png`, `owner_at_rawdah.test/en/002-notifications-1280-full.png` |
| `/security` | all three | Switch on two-step sign-in. | 1 + 0, 1 field | One card: explanation, password field, "متابعة". | Same. | **keep** | One job, one field, one button. | `owner_at_nukhba.test/ar/003-security-1280.png` |
| `/help` | all three | Cannot be said in one sentence: first steps, how to ask, a problem form, a fourth list of the owner's actions, the consultants, seven questions. | 7 + 0 (the seven questions), 1 field, 8 to 13 links | "الخطوات الأولى" (three cards, each ending in the same link "فتح إجراءاتي"), then "اسأل مستشارك" and "مشكلة تقنية" side by side. | First steps, then "اسأل مستشارك", then the problem form; the consultants are 1.5 screens down. | **trim** (drop "الخطوات الأولى" and "إجراءاتك المفتوحة"; keep the consultants, the problem form, the questions) | 2.1 to 2.5 screens. The first two blocks repeat the home page and My actions. | `owner_at_nukhba.test/ar/004-help-1280-full.png`, `owner_at_rawdah.test/en/004-help-1280-full.png` |
| "الملفات / Files" floating card (sidebar foot) | all three | Browse every file the person may open. | 1 + 0 ("إغلاق") plus the tree rows, 1 search field | A dark card over the page: search box, project folder (2), "الأدلة" (2). | Not captured. | **cut** for owners | Read-only for this role (no "add a file" button on the card). It holds the owner's own evidence, which is on the action. A sidebar entry called "Files" next to three upload buttons invites the wrong guess that files are sent from here. | `../phase1-extra/owner_at_nukhba.test/ar/001-card_files-1280.png` |
| "غير موجود / Not found" (`/assistant`, `/team`, `/departments`, `/audit`, `/group`, `/leaving`, `/indicators/*`, and two actions linked from a recommendation) | owner@nukhba, finance | Say the page cannot be opened. | 0 + 0, 1 link ("العودة للرئيسية") | Title, one sentence, one button. | Same. | **keep** | Correct for pasted addresses. The fault is the page that links to it (see part 2, dead links). | `../phase1-extra/owner_at_nukhba.test/ar/003-assistant-1280.png`, `owner_at_nukhba.test/ar/022-actions_9cc4daf7-1280.png` |

Count: 19 rows. keep 4, trim 5, merge 4, cut 6.

### The action page, state by state

Six states were captured. Labels are given as Arabic / English.

| State (status word) | Account and shot | First thing at 1280x800 | First thing at 768x1024 | Buttons in "الخطوة التالية / Next step", in reading order | Is there one clear next step? |
|---|---|---|---|---|---|
| Sent back, late ("مطلوب تعديل / Revision requested") | owner@nukhba, `…/ar/007-actions_a6a726cb-1280-full.png` | Next-step card: "استئناف العمل / Resume work" (solid), "إرفاق دليل / Attach evidence", the line "استأنف العمل وأجرِ التعديلات، ثم أرسله للمراجعة من جديد.", the progress-note box. Under it the evidence list with a second solid button "إرسال ملف / Send a file". | Same two cards; due date not on screen. | استئناف العمل · إرفاق دليل | No. Two solid buttons on the first screen in two cards. "Resume work" only changes the status word. The file can be sent three ways and only one of the later ones reaches the consultant's queue (see below). |
| Not started ("مُسند / Assigned") | owner@nukhba, `…/ar/014-actions_1531cd35-1280-full.png` | "بدء العمل / Start work" (solid), the progress-note box, the discussion. | Same. | بدء العمل | Yes, one button. But nothing on the main column says what the work is; the expected evidence is the sixth row of the side panel (below the history at 768). |
| In progress, late, date request waiting ("قيد التنفيذ / In progress") | finance, `finance_at_nukhba.test/ar/007-actions_8b57150a-1280-full.png` | "الإبلاغ عن تعثر / Mark as blocked", "إرسال للمراجعة / Submit for review" (solid), "إرفاق دليل / Attach evidence", the progress-note box. | Same. | الإبلاغ عن تعثر · إرسال للمراجعة · إرفاق دليل | Partly. The solid button is the right one, but "blocked" is still read first. Nothing in the card says that her request to move the date to 28/11 is waiting; that is in the side panel ("التأجيل إلى 2026/11/28 · بانتظار الرد · طُلب بعد موعد الاستحقاق"). |
| In progress with an evidence list | finance, `finance_at_nukhba.test/ar/014-actions_60d3d21a-1280-full.png` | The same three buttons, then "قائمة الأدلة / Evidence list" with three items, each "بانتظار الإرسال / Waiting", each with a solid "إرسال ملف / Send a file". | Same; the list fills the screen. | الإبلاغ عن تعثر · إرسال للمراجعة · إرفاق دليل, then إرسال ملف x3 | No. Four solid buttons on one screen, three of them in one card. |
| In progress, project closing, handed over | owner@rawdah, `owner_at_rawdah.test/en/007-actions_69741cad-1280-full.png` | "Mark as blocked", "Submit for review" (solid), "Attach evidence". | Same (`…/ar/008-actions_69741cad-768.png`). | Mark as blocked · Submit for review · Attach evidence | No. The page does not say the project is closing or that the action was handed over to her. It still tells her to submit to a firm that is leaving. |
| Verified ("مكتمل ومُتحقق منه / Verified complete") | owner@rawdah, `owner_at_rawdah.test/en/015-actions_c3eca1fe-1280-full.png` | A card titled "Next step" that says "Verified by the firm." | Same. | none | Yes (nothing to do), but under the heading "Next step". |
| Closed, risk accepted ("مغلق / Closed") | owner@nukhba, `owner_at_nukhba.test/ar/015-actions_80a85aa9-1280-full.png` | Grey banner "أُغلق: قُبلت المخاطر" with the consultant's note and name, then "الخطوة التالية: لا يوجد ما تقوم به في هذا الإجراء الآن." followed by the progress-note box. | Same. | none | Yes, but a finished action still offers "إضافة ملاحظة تقدم / Add a progress note" and a comment box. |

Not captured for an owner: "بانتظار المراجعة / Awaiting review" and "متعثر / Blocked" (no owner account has an action in either state).

**How many places a file can be sent from.** Three buttons on the action page, all opening the same dialog with different effects:

1. "إرسال للمراجعة / Submit for review": opens the dialog titled the same, with tabs "ارفع ملفًا جديدًا / Upload a new file" and "اختر من ملفات صلة / Choose from Selah files", a file field, "ملاحظة للمراجِع (اختياري) / Note for the reviewer (optional)", and the button "إرسال للمراجعة الآن / Send for review now". The file is optional. When several list items are open it asks "أيّ بند من قائمة الأدلة يجيب عنه الملف؟".
2. "إرفاق دليل / Attach evidence": the same dialog, titled "تقديم دليل / Submit evidence", button "رفع / Upload". It does not send anything for review and never asks which list item the file answers (code: `action-panel.tsx:153-156, 399`).
3. "إرسال ملف / Send a file" on one item of the evidence list: the same dialog, titled "إرسال ملف لـ: <item>". It answers the item but does not send the action for review (code: `follow-through-panels.tsx:136-143`, `submit={false}`).

The owner cannot tell these apart, and the screens prove it. On سلمى's action the history shows she sent "مراجعة حدود الصلاحيات المالية.docx" with the note "مذكرة المقارنة". The evidence list on the same page still shows "مذكرة المقارنة مع الحدود الحالية · بانتظار الإرسال". The file went in through "إرفاق دليل", so it answered no item. (The walkthrough says this action has "one item answered and one open"; the screen shows three items, all open.) `finance_at_nukhba.test/ar/014-actions_60d3d21a-1280-full.png`.

The explainer over the list tries to cover this in words: "ما طلبه المستشار منك. أجب عن كل بند بزر «إرسال ملف» الخاص به. الملف المرسل مع «إرسال للمراجعة» يُحسب للبند المفتوح الوحيد، أو للبند الذي تختاره إذا كانت عدة بنود مفتوحة. وسيقبله المستشار أو يوضح ما ينقص." / "What the consultant asked you to send. Answer each item with its own "Send a file" button. A file sent with "Submit for review" answers the only open item, or the one you choose when several are open…". Four sentences to explain three buttons.

In the sent-back state the trap is sharper. The rejected item has a solid "إرسال ملف". Pressing it attaches the new file, and the action stays "مطلوب تعديل": it is not in the consultant's review queue. The owner must still press "استئناف العمل" and then "إرسال للمراجعة". Three steps, and the first one looks like the last. (Read from code, `follow-through-panels.tsx:136-143` and `services/evidence.ts:99-100, 180`; no capture shows the after state.)

The Files card and the project Requests tab are not ways to send for an owner: the card has no add button for this role and the tab is empty. So for owners the count is three, all on one page.

**Text boxes.** Three, with no word on the page about who gets which:

| Box | Label and button | Who reads it (from the page text and code) |
|---|---|---|
| Progress note, inside the next-step card | "إضافة ملاحظة تقدم / Add a progress note", placeholder "ما الذي تغيّر منذ آخر تحديث؟ / What changed since the last update?", button "نشر الملاحظة / Post note" | Everyone who can open the action. It lands in "السجل / History" as "نشر تحديثاً / posted an update". Nobody is told. |
| Discussion | "النقاش / Discussion", placeholder "اكتب تعليقاً… / Write a comment…", buttons "إشارة / Mention" and "نشر / Post" | "يقرأ هذا النقاش كل من يرى الإجراء." A person is notified only if mentioned; "اسأل مستشارك" mentions the lead for you. |
| Note in the upload dialog | "ملاحظة للمراجِع (اختياري) / Note for the reviewer (optional)" | Shown under the file in the history. |

An owner with a question has two boxes on the first screen and will write in the upper one, which notifies no one.

**Where the consultant's reason is.** In two places, neither at the top. (1) Inside the evidence-list item, worded as a status: "غير مقبول: اللائحة لا تذكر صلاحيات اللجنة ولا دورية اجتماعاتها ولا علاقتها بالمراجع الخارجي." (2) At the bottom, in the history: "عمر الزهراني طلب تعديلاً" with the same text. The next-step card, which is first, says only "استأنف العمل وأجرِ التعديلات". The Help page has a question whose answer is "اقرأ سبب المستشار في سجل الإجراء": the page needs Help to say where the reason is. On an action with no evidence list the reason would be in the history only. The file history is visible: the first file sits in the item and in the history with "تنزيل".

**The firm's machinery on the owner's action page.**

- "التذكيرات / Reminders": four steps with dates and audiences, "تذكير · متأخر · تصعيد · تصعيد أخير / Reminder · Overdue · Escalation · Final escalation", ending in "المسؤول ومديرو العميل ورئيس الإدارة والمستشار الرئيس والراعي ومسؤولو حساب العميل ومسؤولو الشركة المتابعون". Shown on every state, also on the closed and the verified action, there with the line "متوقفة ما دام الإجراء بانتظار الشركة، أو انتهى، أو كان المشروع غير نشط." and the old dates still listed.
- "سجل المواعيد / Date history": "2026/11/28 ← 2026/11/14 في 2026/11/16" on عبدالله's action and "Nov 26, 2026 → Nov 12, 2026, On Nov 16, 2026" on سلمى's. Both say the date was moved **earlier**, after it had passed, with no name. This comes from the way the sample data makes an action late, but it shows what an owner would see whenever the firm edits a date in the plan: an unexplained line that reads "someone made me late".
- "كان موعده الأصلي 2026/12/26 · أُجّل مرة واحدة، بزيادة 10 أيام على الموعد الأصلي" and the badge "طُلب بعد موعد الاستحقاق / Asked after the due date": the firm's slip record, phrased as a mark against the owner.
- "كتم البريد / Mute mail" in the page header, beside "اسأل مستشارك", on every action including finished ones.
- Side panel rows "المسؤول" (the reader) and "العميل" (the reader's company).
- No second sign-off text was seen on an owner's page (no owner has an action awaiting review), and no aging badge appeared.

### The first sign-in (owner@rawdah)

**Consent page.** Title "قبل أن تبدأ / Before you start". One line of introduction, then three cards. Each card has a title, one sentence, a link "اقرأها كاملة (الإصدار 2026-10-24) / Read it in full (version …)" that opens the full text in a new tab, and one tick box. Three boxes to tick; "قبول ومتابعة / Accept and continue" stays grey until all three are ticked; "ليس الآن، تسجيل الخروج / Not now, sign out" is the way out. About 100 words in Arabic in total. It fits one screen at 768 and almost one at 1280 (the sign-out link is cut at 800 px).

- Plain words: yes for the terms ("حسابك لك وحدك…") and for privacy ("ما نحفظه عنك، ومن يراه، وأنه يبقى في المملكة…").
- The third card is the weak one: "لا يقرأ المساعد إلا ما يحق للسائل فتحه، ويعمل افتراضيًا على خادم المكتب، ولا يعتمد شيئًا ولا يقرر." / "The assistant reads only what the person asking may open, runs on the firm's server by default, and never approves or decides anything." Dana has no assistant and Rawdah has none. "خادم المكتب / the firm's server" is not a plain word. She must tick that she has read about a thing she will never see.
- What happens next: the page goes straight to the home page. Nothing on the consent page says so, and nothing needs to.
- English: not captured; the English strings in `messages/en.json` are as short and say the same.

**Welcome on the home page.** A card above the counters: "أهلًا بك في صِلَة، دانة / Welcome to Selah, Dana", then "تعرض لك صِلَة ما يطلبه منك مستشارك، والدليل على إنجازه." and "ثلاث نقاط للبدء": "افتح إجراءاتي — كل إجراء يوضح ما عليك فعله بعده", "ارفع الدليل — أرفق الملف في صفحة الإجراء نفسها", "المساعدة — كيف تعمل صِلَة، وكيف تتواصل مع مستشارك". `owner_at_rawdah.test/ar/002-home-768.png` (the 1280 shots caught it mid-animation).

- It does not point at her one job. She has one open action, "Hold the first quarterly review", due 15/01/2027. The card does not name it. The first and the second link both open the list (`/actions`); "ارفع الدليل" does not open anything about evidence.
- Directly under the welcome the page says "قيد العمل 1" and then "لا يوجد ما يحتاج انتباهك الآن." A new person reads: welcome, three places to start, nothing to do.
- The sentence "كل إجراء يوضح ما عليك فعله بعده" promises what the action page does not deliver for her action (no description, no expected evidence).
- Help repeats the card as "الخطوات الأولى" with three more links to the same list.

### Help for owners

- **Repeats.** "الخطوات الأولى" repeats the welcome (three steps, three identical links "فتح إجراءاتي"). "إجراءاتك المفتوحة" repeats My actions with one row fewer. The per-project consultants card repeats a name from the card above it (نورة القحطاني appears twice for Al-Nukhba).
- **"اسأل مستشارك".** Clear on the action page: one button, it jumps to the discussion and mentions the lead. On Help it is a paragraph about that button, and its own button is labelled "إجراءاتي" and opens the list, so "ask" takes Help → list → action → button. Below it Help gives the consultants' mail addresses "لكل ما لا يخص إجراءً بعينه": a second channel, with no word on which the firm prefers.
- **Problem form.** Good: one box, one button, and a clear line on who gets it ("يصل البلاغ إلى مسؤولي النظام في المكتب، لا إلى مستشاريك. حتى 5 بلاغات في اليوم."). The owner's earlier report is listed with "مُرسَل". For Rawdah the per-project card says "No consultant is on this project yet. Ask your lead consultant." on a project that is closing, which reads as a fault.

---

## 2. Marks

### Numbers that disagree

| Account | Home counters (shot) | Home list "يحتاج متابعتك" | "إجراءاتي" | Help "إجراءاتك المفتوحة" | Projects card |
|---|---|---|---|---|---|
| owner@nukhba | قيد العمل 1 · بانتظار المراجعة 0 · متعثرة 0 · مكتملة 0; "متأخرة: 1" (`owner_at_nukhba.test/ar/001-home-1280.png`) | 1 row, status "مطلوب تعديل" | 3 rows: مطلوب تعديل, مغلق, مُسند (`…/005-actions-1280.png`) | 2 rows (`…/004-help-1280-full.png`) | "3 إجراءات · 0 مُتحقق · 0 بانتظار المراجعة" (`…/006-projects-1280.png`) |
| finance | قيد العمل 2 · 0 · 0 · 0; "متأخرة: 1" (`finance_at_nukhba.test/ar/001-home-768.png`, `…/en/001-home-1280.png`) | 1 row | 2 rows, both "قيد التنفيذ" (`…/ar/005-actions-1280.png`) | 2 rows | "2 إجراءات" |
| owner@rawdah | قيد العمل 1 · 0 · 0 · مكتملة 1 (`owner_at_rawdah.test/ar/002-home-1280.png`) | empty: "لا يوجد ما يحتاج انتباهك الآن." | 2 rows | 1 row | "2 إجراءات · 1 مُتحقق" |

What this means for the reader:

- owner@nukhba has three actions and the four counters add up to one. The not-started action ("مُسند") and the closed one are in no counter. The one that is counted sits under "قيد العمل / In progress" while its row says "مطلوب تعديل / Revision requested" (code: `queries.ts:217` adds the two together).
- The not-started action is on no part of the home page. An owner who reads only the home page never learns he has it.
- owner@rawdah is told "nothing needs your attention right now" directly under a counter that says one action is in progress.
- Three lists of "my actions" with three lengths for the same person (home 1, Help 2, My actions 3).
- The Arabic 1280 shot of finance's home shows "قيد العمل 1"; the 768 and English shots show 2. The numbers count up when the page opens and the shot caught one mid-way. The true value is 2. It is still a number on screen that was wrong for a moment (`finance_at_nukhba.test/ar/001-home-1280.png`).

Does the home page tell the owner what to do first? Only when the first thing is late or sent back. Then the row is the right one to click. It does not say what to do (the row gives a title, a date and a status word), and it is silent about work not yet started.

### Links that lead to "Not found"

- Page: `/recommendations/e25c9908…` "تشكيل لجنة المراجعة", card "الإجراءات — العمل الذي ينفّذ هذه التوصية", as owner@nukhba. It lists three actions as links. "إعداد لائحة عمل اللجنة" is his and opens. "ترشيح الأعضاء المستقلين للجنة" (منصور العنزي, متعثر) and "اعتماد قرار تشكيل اللجنة ونشره" (فهد الدوسري, مسودة) open "غير موجود. الصفحة غير موجودة أو لا تملك صلاحية الوصول إليها." Shots: `owner_at_nukhba.test/ar/017-recommendations_e25c9908-1280.png` (the list), `…/022-actions_9cc4daf7-1280.png` and `…/023-actions_f55a1d16-1280.png` (the answers).
- How he gets there: Projects → the project → the recommendation's title. The project page itself lists only his own action under that recommendation (`…/008-projects_8c55994f-1280-full.png`); one click further the recommendation page lists everyone's. The two pages disagree about what he may see.
- What he would think: the page is broken, or the action was deleted. "Not found" is the right answer to a pasted address; it is the wrong answer to a link Selah itself drew. He also now knows the title, owner, status and date of two actions he may not open, one of them a draft the firm has not released.
- The meeting agenda repeats the leak without links: `owner_at_nukhba.test/ar/021-meetings_574c3428-1280-full.png` names eight actions of other people with their states, on a meeting he is not invited to.

### Decoration rather than information

- Home, all three: the four counter cards for a person with two or three actions; the numbers count up and the icons animate.
- Home, owner@rawdah: the welcome title types itself letter by letter with a blinking cursor ("أهلًا بك في صِلَة،|"), the middle sentence gets a highlight sweep, and the three links fade in from a blur. In the English shot the three links are still blurred and unreadable when the page is captured (`owner_at_rawdah.test/en/001-home-1280-full.png`).
- Top bar on every page: the slogan "متابعة تنفيذ التوصيات الاستشارية / Consulting implementation follow-up".
- Projects list: a progress bar and a "عميل" badge on a single card.

### Text that explains the screen

- Action page, evidence list: the four-sentence explainer quoted above.
- Home footnote: "الأرقام من سجلات العمل الفعلية. تقدم العميل المعلن ليس تحققًا: وحده قرار المستشار يجعل الإجراء مكتملًا ومُتحققًا منه، وهذا لا يثبت أثرًا فعليًا على أعمال المنظمة." Written for an auditor, shown to a department head.
- Help, "اسأل مستشارك": a 40-word paragraph that describes a button on another page, then a button "إجراءاتي" that opens the list.
- Notifications: "تصلك الإشعارات داخل صلة دائمًا. هذه الخيارات تغيّر فقط ما يصل إلى بريدك ومتى." then "كل رسالة سطر قصير ورابط…", then a grey box about Fridays.
- Reminders card: "من يُذكَّر ومتى، ما دام الإجراء مفتوحًا."
- Recommendation page: "بيّن هل توافق على هذه التوصية. إن وافقت فاذكر ما سيُنفَّذ وموعده…" addressed to a reader who cannot answer, followed by "يرد مدير حساب العميل أو راعي المشروع."

### Wrong language, raw keys, errors

- Raw status keys in the meeting agenda, Arabic and English: "(revision_requested)", "(in_progress)", "(blocked)", "(closed)", "(verified_complete)", "(awaiting_review)", "(assigned)". `owner_at_nukhba.test/ar/021-meetings_574c3428-1280-full.png`, `finance_at_nukhba.test/ar/017-meetings_5ec72542-1280.png`.
- English interface, Al-Nukhba meetings: the agenda headings stay Arabic ("متأخرة", "بانتظار المراجعة", "متوقفة", "ما تغيّر منذ الاجتماع السابق", "(الاستحقاق 2026-11-10)") because the agenda is stored text. `owner_at_nukhba.test/en/019-meetings_beaa4143-1280.png`.
- Console error "Hydration failed" on both scheduled meetings, for both Al-Nukhba owners, both languages (`…/020-meetings_5ec72542`, `…/021-meetings_574c3428`). Not on the held meeting.
- Arabic grammar: history lines use the masculine for a woman ("سلمى الشهري قدّم دليلاً", "نشر تحديثاً"); consent says "اقرأها كاملة" for "إشعار الخصوصية" (masculine); meeting reply buttons are third person past ("قبِل · ربما · اعتذر") where the reader is answering for herself.
- The product name is written "صِلَة" on consent and welcome and "صلة" on Notifications, Help and the upload dialog.
- No overflow and no cut-off text in any of the 768 shots for the three accounts (`overflowX` is 0 on every record).
- English, owner@rawdah: no Arabic left in the app's own labels on any of the 16 pages. Arabic appears only in data (her name, the consultant's name, the bilingual project title). At 768 the Arabic interface with English data reads cleanly.

### More than one solid button in a card

- Evidence list card, finance: three solid "إرسال ملف" in one card, plus the solid "إرسال للمراجعة" in the card above. `finance_at_nukhba.test/ar/014-actions_60d3d21a-1280-full.png`.
- Sent-back action: solid "استئناف العمل" and solid "إرسال ملف" on the same first screen (two cards). `owner_at_nukhba.test/ar/007-actions_a6a726cb-1280.png`.

### Selah doing the consultant's job

None seen on an owner's screen. The counters and the "late" flags are plain counts. The "Show in English" buttons on the English interface give a machine translation of the consultant's text; that is labelled as such by the code, but it is an AI feature shown to a role that otherwise has none (see part 5).

### Words an owner would not understand, or that mean two things

Every status word and label an owner meets is listed here. "?" marks the ones a non-specialist would stumble on; "2x" marks a word used for two things.

| Where | Arabic | English | Problem | Plain word suggested |
|---|---|---|---|---|
| Action status | مُسند | Assigned | ? An owner reads it as "given to me", which is true of all his actions. | لم يبدأ / Not started |
| Action status | قيد التنفيذ | In progress | 2x: the home card calls the same thing "قيد العمل". | Keep "قيد التنفيذ" everywhere |
| Action status | متعثر | Blocked | ? "متعثر" sounds like a failing loan. 2x: the meeting agenda says "متوقفة" for the same state. | متوقف لسبب خارجي / Stuck |
| Action status | بانتظار المراجعة | Awaiting review | Fine, but does not say who has it. | عند المستشار / With the consultant |
| Action status | مطلوب تعديل | Revision requested | Fine. | أُعيد إليك للتعديل / Sent back to you |
| Action status | مكتمل ومُتحقق منه | Verified complete | ? Two words for one fact. | قبله المستشار / Accepted by the consultant |
| Action status | مغلق · "أُغلق: قُبلت المخاطر" | Closed · "Closed: Risk accepted" | ? "risk accepted" needs the sentence under it. | أُغلق دون إكمال / Closed without completing |
| Action status (seen on another person's row) | مسودة | Draft | ? A firm state. | Should not be shown |
| Home card hint | مطالبات تقدم من العميل، غير متحقق منها | Client-claimed progress, not verified | ? The firm talking about the reader in the third person. | ما تعمل عليه الآن / What you are working on |
| Home card hint | بلّغ عنها المسؤولون | Reported by owners | ? Same. | أبلغتَ أنها متوقفة |
| Home | يحتاج متابعتك | Needs your follow-up | ? "Follow-up" is what a manager does; an owner does the work. | مطلوب منك الآن / Waiting for you |
| Action page | الاستحقاق | Due | ? "الاستحقاق" is accounting language. 2x: the recommendation page says "الموعد" for the same thing. | آخر موعد / Due date |
| Action page | الإبلاغ عن تعثر | Mark as blocked | ? | عندي عائق / I am stuck |
| Action page | استئناف العمل | Resume work | ? After a send-back it means "I have read your note". | ابدأ التعديل / Start the changes |
| Action page | إرفاق دليل · تقديم دليل · رفع · إرسال ملف · إرسال للمراجعة · إرسال للمراجعة الآن · ارفع الدليل (welcome) · قدّم دليلاً (history) | Attach evidence · Submit evidence · Upload · Send a file · Submit for review · Send for review now · Upload evidence · submitted evidence | 2x and more: eight wordings for sending a file. | Two only: "إرسال ملف / Send a file" and "إرسال للمراجعة / Send for review" |
| Action page | الدليل الذي يتوقعه المستشار · قائمة الأدلة · (project page) الأدلة المطلوبة · (recommendation page) الدليل على الإنجاز | Evidence the consultant expects · Evidence list · Required evidence · Evidence that shows it's done | 2x: four names for "what to send". | المطلوب إرساله / What to send |
| Evidence item | بانتظار الإرسال | Waiting | 2x in English: "Waiting" is also the state of a date request. | لم يُرسل بعد / Not sent yet |
| Evidence item | أُرسل، بانتظار المراجعة · مقبول · غير مقبول · غير مطلوب | Sent, to review · Accepted · Not accepted · Not needed | Fine. | |
| Date request | بانتظار الرد · تمت الموافقة · مرفوض | Waiting · Approved · Declined | 2x: "بانتظار الرد" is also the state of a recommendation with no client answer. | بانتظار رد المستشار / Waiting for the consultant |
| Date card | طلبات تغيير الموعد · طلب موعد جديد | Due date changes · Ask for a new date | The card title is a list name; the owner looks for "more time". | أحتاج وقتًا أطول / I need more time |
| Date card | طُلب بعد موعد الاستحقاق · سجل المواعيد · أُجّل مرة واحدة، بزيادة 10 أيام على الموعد الأصلي | Asked after the due date · Date history · Moved later once, 10 days past the original date | ? Firm record. | Hide |
| Reminders | تذكير · متأخر · تصعيد · تصعيد أخير; مديرو العميل · رئيس الإدارة · المستشار الرئيس · الراعي · مسؤولو حساب العميل · مسؤولو الشركة المتابعون | Reminder · Overdue · Escalation · Final escalation; Client managers · Department head · Lead consultant · Sponsor · Client admins · Firm admins watching | ? "تصعيد" and the audiences are the firm's process. | Hide, or one line: "يُبلَّغ مديرك في 21/11" |
| Whole app | المسؤول | Owner | 2x and more: the action's owner; the person answering for a recommendation ("المسؤول: ريم الحربي", English "Accountable"); administrators ("مسؤولو حساب العميل", "مسؤولي النظام في المكتب"); the role name "مسؤول تنفيذ". | Owner of an action: "المكلَّف"; keep "مسؤول" for administrators |
| Whole app | المكتب · الشركة · الشركة الاستشارية · فريق الاستشارات | the firm · the consulting team | 2x: "الشركة" means the firm in "ما تحتاجه الشركة منكم", "بانتظار الشركة", "لم تحدد الشركة تواريخ هذا العام", and the client everywhere else (the client is "شركة النخبة القابضة"). | "المكتب الاستشاري" for the firm, always |
| Help, reminders | المستشار الرئيسي / المستشار الرئيس | Lead consultant | Two spellings. | One |
| Recommendation | موافَق عليها · موافَق عليها جزئيًا · بانتظار الرد | Agreed · Partly agreed · Awaiting response | Fine, but not the owner's to act on. | |
| Recommendation | يرد مدير حساب العميل أو راعي المشروع | The client's admin responds, or the project's sponsor | ? "مدير حساب العميل" reads as an account manager at the firm. | مسؤول النظام في شركتكم |
| Recommendation | تعالج الملاحظة · المصدر · النتيجة المستهدفة | Answers the finding · Source · Target outcome | ? "الملاحظة" for a finding is mild; fine in context. | |
| Project | badge "عميل" · "العميل: شركة النخبة القابضة" · "مشترك مع العميل" | Client · Client: … · Shared with client | ? The reader is the client. Firm point of view. | Remove on client screens |
| Project team | الراعي · المنسّق · اللجنة التوجيهية · معتمد التسليمات · مراقب · جهة اتصال | Sponsor · Coordinator · Steering committee · Acceptor · Observer · contact | ? "معتمد التسليمات / Acceptor". | من يستلم المخرجات |
| Closing | قيد الإغلاق · سُلِّم · يتولاه | closing · Handed over · Sustained by | ? "Sustained by". | يكمله / Carried on by |
| Meeting | مجدول · انعقد · لجنة توجيهية · ورشة عمل · مشترك مع العميل · لم يرد بعد · قبِل · ربما · اعتذر · المنظِّم · اختياري | Scheduled · Held · Steering committee · Workshop · Shared with client · No answer yet · Accepted · Maybe · Declined · Organiser · optional | Reply buttons in the third person. | سأحضر · ربما · أعتذر |
| Notifications | أُسند إليك الإجراء… | … was released to you | ? "released" is the firm's word for publishing a draft. | … was given to you |
| Notifications | التذكيرات والتصعيد · ساعات الهدوء · ساعات رمضان | Reminders and escalations · Quiet hours · Ramadan hours | "تصعيد" again. | |
| Help | مُرسَل · عولج | Sent · Handled | Fine. | |
| Not found | العودة للرئيسية | Back to overview | Third name for the home page ("نظرة عامة", "الرئيسية"). | One name |
| Sidebar / page | إجراءاتي (sidebar) · الإجراءات (page title) | My actions · Actions | Two names for one page. | إجراءاتي on both |

---

## 3. The 18 findings and the batch 0 bugs, for these pages

| # | Finding | Today, for owners | Evidence |
|---|---|---|---|
| U01 | Many screens list the same actions | **Still true.** An owner's two or three actions are listed on the home list, My actions, Help "إجراءاتك المفتوحة", the project's Recommendations tab, the recommendation page and the meeting agenda: six places, three different lengths. | `owner_at_nukhba.test/ar/001-home-1280.png`, `…/005-actions-1280.png`, `…/004-help-1280-full.png`, `…/008-projects_8c55994f-1280-full.png` |
| U02 | Project page with too many tabs | **Partly true.** An owner gets 6 tabs (7 on a closing project), 1 button. Two tabs are always empty for this role (Requests, Activity), one repeats My actions, one repeats the action's files. | `owner_at_nukhba.test/ar/010-…`, `…/012-…` |
| U03 | Action page: three uploads, three text boxes, wrong next step | **Still true.** Three send buttons with three effects; three text boxes; "الإبلاغ عن تعثر" is still read before "إرسال للمراجعة" (the solid colour is now on the right one); "استئناف العمل" still sits beside "إرفاق دليل". The screen agrees with the code reading. | `finance_at_nukhba.test/ar/014-actions_60d3d21a-1280-full.png`, `owner_at_nukhba.test/ar/007-actions_a6a726cb-1280-full.png` |
| U04 | Client home does not show the client's job; counters contradict the list | **Still true.** See the table in part 2. | `owner_at_rawdah.test/ar/002-home-1280.png` |
| U05 | Five ways to send a file | **Partly true for owners: three**, all on the action page. The screen corrects the code reading on one point: the Files card has no "add a file" for an owner, so it is not a fourth way. | `../phase1-extra/owner_at_nukhba.test/ar/001-card_files-1280.png` |
| U09 | Long sidebars | **Fixed for owners in length** (3 rows + Help + Files). Still one row too many: Projects and Files add nothing for this role, and "نظرة عامة" and "إجراءاتي" are two homes. | any shot |
| U10 | Too many status words | **Still true.** An owner meets 8 action states, 5 item states, 3 date-request states, 3 recommendation states, 4 reminder steps, meeting and closing words: about 35 state words, with the doubles listed in part 2. | part 2 table |
| U11 | Clients see the firm's machinery | **Still true.** Reminder and escalation ladder on every action; date history and slip count; "طُلب بعد موعد الاستحقاق"; the steering agenda. | `finance_at_nukhba.test/en/007-actions_8b57150a-1280-full.png` |
| U12 | Firm vocabulary on client screens | **Still true.** "مطالبات تقدم من العميل، غير متحقق منها", "بلّغ عنها المسؤولون", "مشترك مع العميل", the "عميل" badge, "released to you". | `owner_at_nukhba.test/ar/001-home-1280.png`, `…/011-…`, `owner_at_rawdah.test/en/002-notifications-1280-full.png` |
| U14 | Meeting page shows everything before the meeting | **Still true.** A scheduled meeting shows "الملخص: لا يوجد ملخص بعد." and "القرارات: لم تُسجَّل قرارات." | `finance_at_nukhba.test/ar/017-meetings_5ec72542-1280.png` |
| U15 | Rare actions as visible buttons | **Partly true.** "Excel" on a three-row list and on the project page; "كتم البريد" in the header of every action. | `owner_at_nukhba.test/ar/005-actions-1280.png` |
| U17 | Help is a second home page | **Still true.** First steps (three cards, three identical links), a fourth list of the owner's actions, then the real help. | `owner_at_nukhba.test/ar/004-help-1280-full.png` |
| U18 | Lists hide what matters | **Still true.** My actions mixes the closed action between the late one and the one not started; the owner column is always the reader. | `owner_at_nukhba.test/ar/005-actions-1280.png` |
| B1 | Raw status keys on the agenda | **Still true.** | `owner_at_nukhba.test/ar/021-meetings_574c3428-1280-full.png` |
| B3 | Reminder ladder with past dates on finished actions | **Still true.** Verified action with steps dated 5, 9, 15 and 22 Nov; closed action with four steps listed under "متوقفة…". | `owner_at_rawdah.test/en/015-actions_c3eca1fe-1280-full.png`, `owner_at_nukhba.test/ar/015-actions_80a85aa9-1280-full.png` |
| B5 | Hydration error on the meeting page | **Still true** on the two scheduled meetings (one page error each, both languages, both Al-Nukhba owners). The code reading could not tell; the capture can. | `pages.json` records 20 and 21 for owner@nukhba, 17 and 18 for finance |

U06, U07, U08, U13, U16, B2 and B4 do not touch an owner's pages.

---

## 4. Proposed target for action owners

### Sidebar

| Today | Target |
|---|---|
| نظرة عامة / Overview | (gone: opening Selah lands on My actions) |
| إجراءاتي / My actions | **إجراءاتي / My actions** |
| المشاريع / Projects | (gone: the project is a group heading on My actions and a line on the action) |
| foot: المساعدة / Help | foot: **المساعدة / Help** |
| foot: الملفات / Files (card) | (gone for owners) |
| user menu (from the code reading; not captured open): language, theme, two-step sign-in, Help (second time), sign out | user menu: language, theme, two-step sign-in, **mail options** (moved from Notifications), sign out |
| top bar: sidebar toggle, language, theme, bell | top bar: sidebar toggle, bell |

One row, one foot row. The bell keeps the notification list.

### My actions as the home (reorder of what exists)

- Three groups in this order: "مطلوب منك الآن" (sent back, late, in progress, not started; sent back and late first), "عند المستشار" (awaiting review), "منتهية" (accepted, closed), folded.
- Columns: action with its recommendation under it, due date, status. No owner column. The project is the group heading when the person has more than one.
- A date request that is waiting shows beside the due date ("طلبتَ 28/11، بانتظار رد المستشار"), so a late row is not just red.
- The counters, the red bar, the footnote and "Excel" go.
- The welcome (first two weeks) stays as one short card on top. Its first link opens the action itself when there is exactly one open action, the list otherwise. No typing effect.

### Tabs

| Page | Today | Target for an owner |
|---|---|---|
| Project page | التوصيات · الاجتماعات · الطلبات · المستندات · سجل النشاط · الفريق (· الإغلاق) | No project page. Recommendation context is on the action; consultants are on Help; a meeting opens from its invitation; the handover line is on the action. |
| Recommendation page | answer card, actions card, facts panel | Facts panel and the client's recorded answer (read only, no instructions); only the reader's own actions listed. Reached from the recommendation's name on the action page, which is plain text today. |
| Meeting page | time, agenda, summary, decisions, follow-ups, attendees | Only for invitees: time and join, the reply, "my follow-ups", attendees; summary and decisions once the meeting is held. |
| Help | first steps · ask · problem · open actions · consultants · per-project consultants · questions | consultants (one list) · problem form · questions |
| Notifications | list · mail options · muted actions | list only |

### The target action page for an owner

Order of the blocks, top to bottom. Everything named exists on the page today.

1. **Header.** Title, the status in a plain word, and the due date with the late flag beside it (moved up from the side panel, so it is on the first screen at 768 too).
2. **What happened last, if anything did.** One banner, only when it applies:
   - sent back: the consultant's reason, who wrote it and when (today in the list item and at the bottom of the history);
   - closed: the closing note (already a banner);
   - date request waiting: "طلبك تأجيل الموعد إلى 28/11 بانتظار رد المستشار" (today in the side panel);
   - project closing and action handed over: the line from the Closing tab.
3. **What to send.** One block that joins the side-panel row "الدليل الذي يتوقعه المستشار", the action's description and "قائمة الأدلة". Each list item keeps its state, its last file and its own outline button "إرسال ملف". The four-sentence explainer goes.
4. **The next step: one solid button per state.**

   | State | The single solid button | Notes |
   |---|---|---|
   | Not started | بدء العمل / Start work | as today |
   | In progress | إرسال للمراجعة / Send for review | opens the one upload dialog |
   | Sent back | إرسال النسخة المعدّلة للمراجعة / Send the revised file for review | opens the one upload dialog. The service already moves a sent-back action through "in progress" to "awaiting review" in one go when a file is sent for review (`services/evidence.ts:180-184`); only the page does not offer that button in this state. "استئناف العمل / Resume work" goes from this state |
   | With the consultant | none; "عند المستشار منذ <date>" | today "بانتظار قرار المستشار." |
   | Stuck | استئناف العمل / Resume work, under the reason | as today |
   | Accepted, closed | no "next step" card at all | the banner says the outcome |

   Under the button, one quiet row of three text links that exist today in three different corners of the page: "عندي عائق" (today the first button in the card), "أحتاج وقتًا أطول" (today in the side-panel card), "اسأل المستشار" (today in the page header).
5. **One way to send a file.** One dialog. With an evidence list, a file always goes to an item (the dialog's existing choice "ليس بندًا في القائمة" covers the rest), and the dialog's last line is the existing choice between sending for review now and saving without sending. "إرفاق دليل / Attach evidence" as a separate button goes; so do the three titles and three button labels of the dialog.
6. **Discussion.** One text box. The progress-note box merges into it: both are read by the same people, and the history already shows both.
7. **History.** Files and decisions, last, as today.
8. **Side panel** (below the main column at 768): project, recommendation (as a link), department. The rows "المسؤول" and "العميل" go for owners.

Out of sight for an owner: the reminder and escalation ladder (at most one line: when the next reminder goes and to whom), "سجل المواعيد", the slip sentence and "طُلب بعد موعد الاستحقاق", the progress-note box and the comment box on finished actions, "كتم البريد" (the muted-actions list already lives with the mail options).

### Asking for more time, saying "I am stuck", asking a question: today

| Need | Where today | Found in ten seconds? | Clicks from the home page |
|---|---|---|---|
| More time | Side-panel card "طلبات تغيير الموعد", button "طلب موعد جديد / Ask for a new date". Not offered while a request waits. | At 1280: yes, if the owner reads the side panel; the button sits at the fold (about 765 px). At 768: no, it is below the history, about two screens down. | 2 to open the dialog when the action is on the home list (row, button); 3 when it is not (My actions, row, button). Then the form. |
| "I am stuck" | "الإبلاغ عن تعثر / Mark as blocked", first button of the next-step card. | Yes, when the action is in progress. **Not offered at all** on an action not started or sent back: the owner must first press "بدء العمل" or "استئناف العمل", which says the opposite of what he means. | 2 or 3, same as above. |
| A question | "اسأل مستشارك / Ask your consultant" in the page header; it jumps to the discussion with the lead consultant mentioned. | Yes, on every state. But the progress-note box is nearer and looks like the place to write. Help offers a second route: mail addresses of the consultants. | 2 or 3, then typing. |

### What an owner needs and does not get today

Only gaps these screens show.

- **A follow-up from a meeting is not in any of the owner's lists.** سلمى owns "إرسال جدول مقارنة الحدود المالية للجنة", due 14/11 (late), with a "تمت" button. It exists only inside the held meeting's page, four clicks from home (Projects, project, Meetings tab, meeting). `finance_at_nukhba.test/ar/016-meetings_beaa4143-1280-full.png`.
- **The not-started action is missing from the home page** (owner@nukhba), and an in-progress action is missing too when it is not late (owner@rawdah).
- **No way to say "I cannot start" or "I cannot fix this"** without first pressing Start or Resume.
- **The handover is not on the action** (owner@rawdah): the action page still offers "Submit for review" with no word that the project is closing.
- **A waiting date request is not shown where the lateness is shown** (home, My actions, the top of the action).
- **What the work is.** No captured action shows a description. The owner has the title and, in the side panel, one line of expected evidence. Rawdah's open action has neither a description nor expected evidence: the page asks her to submit and does not say what.

---

## 5. Open questions

1. Should an owner see the titles, owners, states and dates of other people's actions at all? The walkthrough says owners see only their own work, but the recommendation page and the meeting agenda show the rest, including a draft the firm has not released.
2. Should an owner see, and be able to join, meetings he is not invited to?
3. After a send-back, may the page offer "send the revised file for review" directly, so that one press does what takes three today? The service already supports it; the page shows only "استئناف العمل". Is the separate "resume" step wanted by the firm as a signal that the owner has read the reason?
4. May an owner report "stuck" on an action he has not started, or one that was sent back?
5. Does the firm want owners to know when their manager and sponsor will be told (the reminder ladder), or is one line enough?
6. Owners on several projects: is a group heading on My actions enough, or do they need a project page of their own?
7. The consent page shows the AI notice to people who never get an assistant (owners; all of Rawdah). Keep it for everyone, or only where an assistant can be switched on? The same question for "Show in English" (machine translation) on an owner's screens.
8. On a closing project, what should an owner's handed-over action offer: still "send for review", or nothing?
9. The held steering meeting shows "لا يوجد ملخص بعد" to the owners, while the walkthrough says it has a summary. Is the summary meant to be hidden from owners, or is it missing?
