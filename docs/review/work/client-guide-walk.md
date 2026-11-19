# Client guide walk-through

A tester followed the client guide (`docs/handbook/client/ar.md` and `en.md`) step by step on a fresh copy of the app and recorded every place where the guide and the screen disagree.

- **Copy:** worktree `C:\Projects\selah-fresh\.claude\worktrees\guide-walk` at `origin/main` 4ffb703, database `selah_check` rebuilt and seeded with the walkthrough data, app on http://localhost:3930.
- **Method:** Playwright scripts, signed in as each role. Every step was actually done (click, fill, submit), in Arabic first and then in English. Only synthetic text and the repo's sample files (`tests/fixtures/office/plan-outline.docx`, `plan-ar.xlsx`) were used.
- **Extra accounts made during the walk:** `walk.owner1@nukhba.test` (action owner) and `walk.manager1@nukhba.test` (client manager). Both were invited through the app, with the walkthrough test password.
- **Firm-side setup, used only to make one English step possible:** as `lead@mizan.test`, the draft action "اعتماد قرار تشكيل اللجنة ونشره" was given to `walk.owner1` and released. This gave an action in the "not started" state for the English "Start work" step.
- **Mail:** queued mail was sent to the mail catcher by running `npm run job:mail` once by hand. The dev server does not send mail on its own.
- **Already known, not repeated here:** the guide shows "en.md"/"ar.md" as plain text, and "I am stuck" does not notify the firm.

## Summary

| Section | Result | Short note |
|---|---|---|
| #first-sign-in | Partly matches | There is a sign-in step after **Create my account** that the guide leaves out. The three tick boxes are not mentioned. Two-factor sign-in could not be tested (switched off in this local setup). |
| #home | Partly matches | Several home rows are not in the guide's list (indicators, files to confirm, group). The owner's home heading is **Home**, not **My actions**. The button reads **EN** or **عربي**, never "EN / عربي". In Arabic, requested-document titles show in English. |
| #answer | Matches | All labels match in both languages. The partly-agree choice has no separate "which part" box. |
| #start | Partly matches | The **Next step** card shows only the due date and a reminder date. The "who is told" line appears only when the firm has set it up. |
| #evidence | Does not match | The window is titled **Send for review** (**إرسال للمراجعة**), not **Send a file**. The file-type hint shows empty "()". The guide does not say how to send a file that was saved earlier. The history says "sent a file" for a saved file. For an owner, a returned file shows under **Waiting for you**. The Arabic resend label differs between home and the action page. |
| #documents | Matches, with notes | The home **Send a file** opens the project tab; the user must press **Send a file** again there. The count line says "received" while the item says **Waiting for the firm**. |
| #more-time | Partly matches | It works and the message matches word for word. But **Answers to the dates you proposed** never shows on an action owner's home. |
| #stuck | Matches | **Needs attention** plus a second badge, **Blocked** (**متعثر**). **Resume work** works. |
| #ask | Matches, with notes | **Ask the consultant** already mentions the lead consultant. A tick box, **This is an update on the work**, is not explained. |
| #invite | Matches | All labels match. The project People tab calls the client admin **مسؤول النظام** ("system admin"), a third name for the role. |
| #give-action | Matches, with notes | In English, typing an English name (e.g. "Salma") finds nobody; only Arabic names match. The picker also offers the client admin, while the guide says client admins do not do actions. |
| #receipt | Partly matches | Confirmed in Arabic; there is an extra confirm window. **All files handed over to your company** is reachable only while something waits; after that there is no link to it. English: labels checked, confirm not repeated (nothing left to confirm). |
| #assistant | Partly matches / cannot do (answers) | The home button is **Read and decide** (**الاطلاع والقرار**), not **Choose** (**الاختيار**). After switching off, the notice shows "Switch off the assistant" as a bullet. Questions get no answer locally, and the card shows no error. |
| #help | Matches | All three parts are there, plus an **Open your guide** link the guide does not mention. |

## Details

Labels are given as English / Arabic. "Guide" means the guide text; "screen" means what the app showed.

### Your first sign-in (#first-sign-in)

Done as `walk.owner1@nukhba.test` (Arabic, invited by the client admin) and `walk.manager1@nukhba.test` (English). Also checked with `owner@rawdah.test` (English), whose notices were not yet accepted.

| Step | Result | Guide vs screen |
|---|---|---|
| 1. Open the link, type name and password, **Create my account** / **إنشاء حسابي** | Matches | The page also asks for the password a second time (**Type it again** / **أعد كتابتها**, 12 to 128 characters). The email field was empty and had to be typed. |
| (missing step) | **Does not match** | After **Create my account**, the app does not go to **Before you start**. It goes to the sign-in page with "Your account is ready. Sign in with your new password." / «حسابك جاهز. سجّل الدخول بكلمة المرور الجديدة.» The user must type their email and password again. The guide goes straight from step 1 to step 2. |
| 2. **Before you start** / **قبل أن تبدأ**, **Accept and continue** / **قبول ومتابعة** | Matches, missing detail | **Accept and continue** stays greyed out until three boxes are ticked: "I accept the terms of use.", "I have read the privacy notice.", "I have read how Selah uses AI." The guide says only "Read them". The third notice is titled "How Selah uses AI" / «كيف يستخدم صلة الذكاء الاصطناعي», not "the assistant notice". Action owners see it too, although they never get the assistant. |
| 3. Client admin sets up two-factor sign-in | **Cannot do** | Two-factor sign-in is switched off in this local setup (`TWO_FACTOR_REQUIRED=false`). `admin@nukhba.test` signed in with a password only, and **People** lists every account's two-factor sign-in as "Not on" / «غير مفعّل». This step needs a check on a setup where two-factor sign-in is required. |
| What happens next: welcome on home | Matches | "Welcome to Selah, …" / «أهلًا بك في صلة، …», with three places to start. |
| **Email me a sign-in link** / **أرسل لي رابط الدخول بالبريد** | Matches | Tried as the new manager. Screen says "Check your inbox … It works once, for 15 minutes." The emailed link opens a page where the user must still press **Sign in**. The guide does not mention that extra press, or that the link lasts 15 minutes and works once. |

### Your home page (#home)

Done as client admin, client manager, the sponsor, and action owners, in both languages.

- **Labels that match:** **Recommendations waiting for your company's answer** (**Answer**), **Your actions that are late or stopped**, **Documents asked of you** (**Send a file**), **Meetings waiting for your reply** (**Reply** / **الرد على الدعوة**), **Your follow-ups**, **Waiting for your choice**. Owner groups **Waiting for you** / **تنتظرك**, **With your consultant** / **لدى مستشارك**, **Finished (n)** / **منتهية (n)**.
- **Rows on screen that the guide leaves out:**
  - **Indicators waiting for a value** / **مؤشرات تنتظر قيمة** (button **Enter the value** / **إدخال القيمة**): shown to the admin, manager and sponsor.
  - **Files waiting for your confirmation of receipt** / **ملفات تنتظر تأكيدك استلامها**: the guide names it only under #receipt, not in the home list.
  - **Answers to the dates you proposed**: not in the home list either (see #more-time).
  - The **Al-Nukhba group** block / «مجموعة النخبة».
  - For an owner, **Meetings waiting for your reply** and **Your follow-ups** show as separate rows. The guide covers these with "your meetings and your follow-ups", which is fine.
- **"My actions in three groups":** the owner's page heading is **Home** / **الرئيسية**. "My actions" / «إجراءاتي» is the sidebar item, and it opens the same page. Empty groups are hidden, so a new owner may see only one group.
- **"The EN / عربي button":** the button reads **EN** (with a globe icon) in the Arabic screen and **عربي** in the English one. Neither shows "EN / عربي". The icon beside it is a sun (dark mode); this matches.
- **Wording that would confuse a client (Arabic):** the client admin's **مستندات مطلوبة منك** rows show the English titles "Articles of association and their amendments", "Current delegation of authority" and "Organisation chart". The project's **الطلبات والملفات** tab shows the Arabic titles «عقد التأسيس وتعديلاته» and so on for the same items. Screenshot: `shots/guide-walk/02-home-docs-english-titles-ar.png`.

### Answer a recommendation (#answer)

Done in Arabic as the client admin (**Agree**) and in English as the sponsor (**Disagree**).

| Step | Result | Note |
|---|---|---|
| 1. **Answer** / **الرد** on home, or the **Plan** / **الخطة** tab | Matches | |
| 2. **Your company's answer** / **ردّ شركتكم** card → **Respond** / **الرد** | Matches | In Arabic, the home button and the card button are both «الرد», and the window title is «ردك على هذه التوصية». Fine. |
| 3. **Agree** / **موافق**: **What will be done** / **ما سيُنفَّذ**, **By when** / **الموعد**, who answers for it | Matches | The field is **Who answers for it (optional)** / **المسؤول عنه (اختياري)**. There is also a **Comment (optional)** / **تعليق (اختياري)** box. |
| **Partly agree** / **موافق جزئيًا** | Matches, small gap | The fields are **What will be done**, **Who answers for it**, **By when** and **Reason** / **السبب**. There is no separate box for "which part you accept"; the user must put that in **Reason**. |
| **Disagree** / **غير موافق** | Matches | Only **Reason**. The status becomes **Disputed** / «محل خلاف». |
| 4. **Record the response** / **تسجيل الرد** | Matches | The response showed after a reload, with **Change the response** / **تغيير الرد** and "Current" / «الحالي». |
| Window close button | Note | Its accessible label is the English word "Close" in the Arabic screen, in this and every other window. |

### Start work on an action (#start)

Done in Arabic as `owner@nukhba.test`, and in English as `walk.owner1` (on the action released by the firm).

- **Steps:** **Start work** / **بدء العمل** → status **In progress** / **قيد التنفيذ**; the main button becomes **Send for review** / **إرسال للمراجعة**; **What to send** / **المطلوب إرساله** is there. Matches.
- **Does not match:** the **Next step** card does not show "two plain lines". On both actions it showed one line: "Due Dec 14, 2026. A reminder goes out on Dec 11, 2026." / «آخر موعد له … يصل تذكير في …». The line "If it is still open on …, … will be told too." exists in the app, but appears only when the firm has set up who is told. On this project it never appeared. The guide should say "and, if your firm set it up, who is told", or drop the second line.

### Send evidence (#evidence)

Done in Arabic as `owner@nukhba.test` (**Send for review now**, and a revised file after a revision request), and in English as `walk.owner1` (**Save without sending**, then send).

| Step | Result | Guide vs screen |
|---|---|---|
| 1. **Send for review** / **إرسال للمراجعة**, or **Send a file** beside an item | Matches | |
| 2. "In the **Send a file** window" | **Does not match** | When opened from **Send for review**, the window is titled **Send for review** / **إرسال للمراجعة**. When opened from **Send the revised file for review**, it is titled with that label. Only the per-item button opens a window called **Send a file**. Screenshots: `01-send-dialog-ar.png`, `03-send-dialog-en.png`. |
| Item list, **Not an item on the list** / **ليس بندًا في القائمة** | Matches | Label: "Which item on the evidence list does the file answer?" / «أيّ بند من قائمة الأدلة يجيب عنه الملف؟». The item must be chosen even when the action has only one item; until then the send button stays greyed out. |
| **Upload a new file** / **ارفع ملفًا جديدًا**, **Choose from Selah files** / **اختر من ملفات صلة**, accepted types, 20 MB | **Wording bug** | The hint reads "PDF, Word, Excel, PowerPoint, images or text **()**, up to 20 MB." with empty brackets, in both languages: «… أو صورة أو نص ()، بحد أقصى 20 ميغابايت». |
| **Note for the reviewer (optional)** / **ملاحظة للمراجِع (اختياري)** | Matches | |
| **Then** / **بعد ذلك**: **Send for review now** / **Save without sending** | Matches | With **Save without sending** picked, the send button's label changes to "Save without sending". |
| After **Save without sending**: how to send it later | **Missing step** | Nothing on the action shows the saved file waiting: no list item, no banner. The history says "مستخدم تجريبي أول **sent a file**", which reads as if it was sent. To send it, the user must press **Send for review** again and press the button with no new file. It then goes for review with the saved file. The window still shows an empty **File** field, so a user will think they must upload again. The guide says only "send it for review once everything is there". |
| What happens next: **Waiting for the firm** / **بانتظار المكتب**, "With the consultant since …" / «عند المستشار منذ …» | Matches | Two extra items the guide does not explain: a second badge, **Awaiting review** / «بانتظار المراجعة», and the line "A second consultant checks it too." / «ويتحقق منه مستشار ثانٍ أيضًا.» |
| **Request revision**: "the action shows under **Files sent back to you**" | **Does not match for action owners** | **Files sent back to you** / **ملفات أُعيدت إليك** exists only on the admin and manager home. On an action owner's home, the returned action shows under **Waiting for you** / **تنتظرك**, marked late. The guide addresses this to the owner too. |
| **Send the revised file for review** / **إرسال النسخة المعدّلة للمراجعة** | Matches on the action page | The Arabic home row uses a different label for the same step: «إرسال **الملف المعدَّل** للمراجعة». The English label is the same in both places. On the action page there is also a **Resume work** / **استئناف العمل** button beside it, which the guide does not mention. Two buttons for "one step" may confuse. |

### Send a document the firm asked for (#documents)

Done in Arabic and English as the client admin.

- **Steps 1–2:** match. The home **Send a file** / **إرسال ملف** is a link to the project's **Requests and files** / **الطلبات والملفات** tab, not to the item. The user lands on the list and must press **Send a file** beside the item again. The guide reads as if the home button opens the upload directly.
- **Window:** titled **Send a file**, "For: <item>". In English it also showed "Seen by: everyone with access · Customise". That line did not appear in the Arabic window for the other item, which is not explained.
- **What happens next:** the item reads **Waiting for the firm** / **بانتظار المكتب**. Matches. But the count line at the top reads "4 items · 1 waiting · **3 received**" / «… 2 مستلم». "Received" sits beside items that each say **Waiting for the firm**, which reads like a contradiction to a client.
- **Cannot do:** the no-login upload link. None was sent in this data.

### Ask for more time (#more-time)

Done in Arabic as `owner@nukhba.test` (on an action waiting for the firm), and in English as `owner@rawdah.test` (on an action in progress).

- **Steps:** **I need more time** / **أحتاج وقتًا أطول** → window **Propose a new date** / **اقتراح موعد جديد** → **New due date** / **موعد الاستحقاق الجديد**, **Reason** / **السبب**, **Send request** / **إرسال الطلب**. Matches.
- **Message:** "The new date you proposed, Feb 5, 2027, is waiting for your consultant's answer." / «الموعد الجديد الذي اقترحته (08‏/01‏/2027) بانتظار رد المستشار.» Matches. **I need more time** disappears while one is waiting. Matches.
- **Does not match:** "Their answer shows on your home under **Answers to the dates you proposed**." That row is built only for the client admin and manager home. An action owner, the main person this section is for, never sees it. `finance@nukhba.test` has a request the consultant approved; her home shows no such row. The answer shows instead on the action itself: "The new date …, agreed by … on …" / «الموعد الجديد …، بموافقة … في …».

### Say you are stuck (#stuck)

Done in Arabic and English as `finance@nukhba.test`.

- **Steps:** **I am stuck** / **عندي عائق** → **Reason** / **السبب** → **Confirm** / **تأكيد**. Matches.
- **Result:** **Needs attention** / **يحتاج متابعة** with a second badge, **Blocked** / **متعثر**. "Blocked: <reason>" shows at the top of the card. **Resume work** / **استئناف العمل** brings it back to **In progress**. Matches.
- **Note:** **I need more time** is still offered while the action is blocked. Fine.

### Ask your consultant (#ask)

Done in Arabic as `finance@nukhba.test` and in English as `owner@rawdah.test`.

- **Steps:** **Ask the consultant** / **اسأل المستشار** puts the cursor in the comment box. **Mention** / **إشارة** lists only people who can see the action, marked Firm / «المكتب» and Your company / «شركتكم». **Post** / **نشر**. Matches.
- **Not in the guide:**
  - **Ask the consultant** already adds the lead consultant as a mention.
  - A tick box, **This is an update on the work** / **هذا تحديث عن سير العمل** ("Kept as a progress note on the action, so it counts as activity"). It is not explained, and a client will not know when to tick it.
- **English screen:** people's names show in Arabic only. This matters for #give-action (below).

### Invite a colleague (#invite)

Done in Arabic (action owner) and English (client manager with a structure position) as the client admin.

- **Steps 1–3:** **People** under **Company** → **Invite someone** / **دعوة شخص** → **Name**, **Email**, **Role**, **Position in the structure (optional)** / **المنصب في الهيكل (اختياري)**. Only the vacancy "Legal counsel" was offered. Matches. The Arabic window writes the product name in Latin letters: «لا ينشئ **Selah** صناديق بريد».
- **Step 4:** project → **People** / **الأشخاص** → **Your people on this project** / **زملاؤكم في هذا المشروع** → **Add a person** / **إضافة شخص**. The window's button is **Add** / **إضافة**. Matches.
- **Open invitations under Access** / **الوصول**, with **Revoke** / **إلغاء**. Matches. The email arrived with a link that works for 7 days. Matches.
- **Managers cannot invite:** confirmed. The manager's **People** page has no invite button.
- **Wording:** on the project People tab, the client admin is called «**مسؤول النظام**» ("يرى مسؤولو النظام في شركتكم كل المشاريع"). Everywhere else the role is «مدير حساب العميل». The client manager shows as «مدير», not «مدير لدى العميل». People with open actions show «أعد إسناد إجراءاته أولًا» ("Reassign their actions first") as a greyed-out button with no visible reason. A client will not know what it is for.

### Give an action to a colleague (#give-action)

Done in Arabic as the client admin, and in English as the project coordinator (`manager@nukhba.test`).

- **Steps:** **Give to a colleague** / **إسناده إلى زميل** beside the owner → **Colleague** / **الزميل** → **Give it** / **إسناد**. Matches.
- **What happens next:** the status stays the same. The history reads «إسناده إلى …». The previous owner gets "Not found". The new owner sees it under **With your consultant**. All match.
- **Does not match, in English:** "Type part of the Colleague's name". In the English screen, typing "Salma", "Reem" or "finance" finds nobody. Only Arabic letters («سلمى») match, even though **People** shows "Salma Al-Shehri" in English.
- **Contradiction:** the picker offers the client admin («فهد الدوسري»), and the seed data has an action owned by the client admin. The guide says "A client admin does not do actions" (#evidence).
- **Minor:** the new owner's home describes the moved action as "You sent these for review", although the previous owner sent it. A date request from the previous owner also stays on the action.

### Confirm you received what the firm handed over (#receipt)

Done in Arabic as the acceptor (`manager@nukhba.test`). English: labels checked on screen and in the text files; confirmation was not repeated, because nothing else was waiting.

| Step | Result | Note |
|---|---|---|
| Home **Files waiting for your confirmation of receipt** / **ملفات تنتظر تأكيدك استلامها** | Matches | Shown to the acceptor and to the client admin. |
| 1. Download | Matches | **Download** / **تنزيل** downloaded the .docx. |
| 2. **Comment** / **ملاحظة** (text needed) | Matches, small gap | With an empty box, pressing **Comment** does nothing and shows no message. |
| 2. **Confirm receipt** / **تأكيد الاستلام** | Matches, missing step | It opens a second window, "Confirm your company received these files", that must be confirmed again. The guide does not mention it. |
| "Everything … is on **All files handed over to your company**" | **Does not match after the last confirmation** | That link appears only inside the home card, and the card shows only while a hand-over waits. After confirming, the card and the link both disappear. The sidebar **Files** / **الملفات** opens a file browser, not this page. `/deliverables` (titled **Files handed over to your company**) can then be reached only by typing the address or from a notification. |

### The assistant (#assistant)

Done as the client admin: switch off and agree in Arabic, then switch off and agree in English through the sidebar. Use was tried as the admin (Arabic) and the manager (English). An action owner was checked to have no assistant.

| Step | Result | Guide vs screen |
|---|---|---|
| 1. Home **Waiting for your choice**: "Your consultants' firm offered your company the assistant" → **Choose** / **الاختيار** | **Does not match** | The row's button is **Read and decide** / **الاطلاع والقرار**. **Choose** / **الاختيار** is the button of the other row, "How should your business figures reach Selah?". Screenshot: `04-home-assistant-offer-en.png`. The sidebar **Assistant** route matches. |
| 2. Read the notice | Matches | |
| 3. Tick "I have read this and agree for my company." / «قرأت هذا وأوافق نيابة عن شركتي.» → **Agree and switch on** / **موافق، فعّله** | Matches | |
| Switch off: menu under your name → **Assistant consent** / **موافقة المساعد الذكي** → **Switch off the assistant** / **أوقف المساعد** | Matches, missing step | A second window, "Are you sure?", asks to **Continue** / **متابعة**. Its text says "The firm can offer it again", which suggests the firm must offer it again. In practice the client admin could agree again straight away. |
| Notice after switching off | **Wording bug** | The notice lists "**Switch off the assistant**" / «أوقف المساعد» as one of its bullet points, as if it were a statement. Screenshot: `05-consent-page-after-switch-off-en.png`. |
| Use 1: **Assistant** opens a card; **All your projects** / **كل مشاريعكم** or one project | Matches | |
| Use 2: ask; sources; count of today's questions | **Cannot do** | Every question failed on this machine: the dev log shows "ai service: the answer failed", and the local model server has only an embedding model. The card showed no error: the question stayed in the box and "Questions today: 0 of 30" did not change. A client would not know anything went wrong. Answers and sources need checking on a setup with an answering model. |
| Action owners never get it | Matches | No sidebar item; `/assistant` shows "Not found". |
| Wording | Confusing | "The assistant runs on this computer, so answers may take a minute." / «يعمل المساعد على هذا الجهاز». A client will read "this computer" as their own computer. |

### The Help page (#help)

Done in Arabic as the action owner and in English as the client admin.

- **Help** sits at the foot of the sidebar and in the menu under your name. Matches.
- **Your consultants** / **مستشاروك**: lead, deputy and others, with projects and work email. Matches.
- **Write to the firm's management** / **راسل إدارة المكتب**: sent in both languages. It shows under **Your messages** as "Sent". Limit: 5 a day. Matches.
- **Questions people ask** / **أسئلة شائعة**: matches.
- **Not in the guide:**
  - An **Open your guide** / **افتح دليلك** link that goes to the reader's role in the guide.
  - The user menu also holds **Mail options**, **Two-factor sign-in**, **Data sharing** (admin) and "Your manager: …", none of which the client guide mentions.

## Steps a new user would need that the guide does not have

1. **Signing in after creating the account:** the app returns to the sign-in page after **Create my account**.
2. **The three tick boxes** on **Before you start**, without which **Accept and continue** stays greyed out.
3. **Sending a file that was saved without sending:** reopen **Send for review** and press the button without choosing a new file.
4. **Choosing the evidence item** when re-sending a revised file. It is required, even when there is only one item.
5. **The second confirm windows** for **Confirm receipt** and **Switch off the assistant**.
6. **Where to find files handed over earlier** once nothing waits, and what the sidebar **Files** / **الملفات** browser is. The guide never mentions it.
7. **Where an action owner sees the answer to a proposed date:** on the action itself, not on home.

## Wording that would confuse a non-technical client

- Empty "()" in the accepted-files hint (every upload window, both languages).
- English document titles on the Arabic home (`02-home-docs-english-titles-ar.png`).
- "3 received" beside items that each say **Waiting for the firm**.
- History "sent a file" for a file that was only saved.
- Three names for the client admin in Arabic: «مدير حساب العميل», «مسؤول النظام», and «Selah» written in Latin letters inside Arabic sentences.
- «أعد إسناد إجراءاته أولًا» as a greyed-out button with no reason given.
- "The assistant runs on this computer".
- "Switch off the assistant" as a bullet in the assistant notice.
- The assistant failing silently when an answer cannot be produced.
