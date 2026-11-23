# Scenario 23. An inquiry from the public form to the discovery session, and a pitch (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010, mail http://localhost:8035), fresh seed, 23 Nov 2026 (a Monday, about 01:45 on the machine), Arabic desktop 1280 px. English checked on the public form's first screen only. Screenshots and results are outside the repo at `C:\Projects\selah-scenario-shots\23\` (`results.json` in the folders `23\b\` and `23\o\`). Page times are the development server and say nothing about production.

**How it was driven.** A headless browser script (Playwright, outside the repo) clicked the real controls; "should be denied" checks are page visits and same-origin `fetch` calls made from inside each signed-in account's own session. Sessions are reused because sign-in is limited to 10 tries per account in 15 minutes.

**Shortcuts that are not user actions.** None.

**Roles.** A prospect (signed out), Sara (firm admin), Noura (deputy; owns the inquiry and starts the pitch), Omar (consultant), Layla (observer), Fahd, Abdullah (Al-Nukhba client people), Hind (Rawdah client admin).

**PRIVACY findings: none.** The inbox, the inquiry and the pitch were "not found" or absent for everyone they should be hidden from.

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Prospect | Fill the public form `/inquiry`: organisation, sector, contact, role, e-mail; services (two); why now; urgency; review | Reference number on screen | PASS | `23\a-step1-filled.png`, `23\a-step2.png`, `23\a-step4.png`, `23\a-submitted.png` | Four numbered steps. Reference **INQ-5C0F36AF**. Step 3 is fully optional. The right-hand column says what happens next in three lines. |
| 2 | Prospect | On step 4 press **إرسال الطلب** without ticking the privacy box | Not sent; the box is marked | PASS | `23\a-submit-without-consent.png` | Red text «يُرجى تأكيد اطّلاعك على إشعار الخصوصية». No request left the page. |
| 3 | Prospect | Look at Mailpit | One acknowledgement with the reference | PASS | Mailpit message «استلمنا طلبك \| We received your request» to laila@ofoq-trading.test | The subject is Arabic first, then English, for an Arabic reader. A second inquiry from the same address made no second mail (one a day per address). |
| 4 | Sara | Open `/inquiries` | The new inquiries, with status and conflict state | PASS | `23\c-inbox.png` | Shows «مفتوحة 7», each row with services, urgency, status «بانتظار المكتب», owner «غير مسند», conflict «لم يُفحص». The honeypot submission (check D8) is not in the list. |
| 5 | Sara | Open INQ-904938F8 (the second inquiry from the same prospect), **إسناد مسؤول** | Owner set; the owner is told | PASS with friction | `23\d-assign.png`, `23\h-assign-noura.png` | The dialog defaults to the first name in the list (Khalid), not to the suggested consultants shown on the same page (Omar, Noura with reasons). I picked Noura. Whether Noura got a bell notice was not checked. |
| 6 | Sara | **ابحث عن تعارض المصالح**, then **تسجيل الفحص** → «لا تعارض» with a note | Conflict check recorded | PASS with friction | `23\d-conflict-search.png`, `23\d-conflict-record.png`, `23\e-conflict-no.png` | The record dialog **defaults to «يوجد تعارض»** (known gap from scenario 1). The step list says the check is required before making a client. |
| 7 | Sara | **قيّم** (five signals), then **سجّل الاتفاقية** (NDA signed 23 Nov) | Saved; the card reads «أعد التقييم» and «صحّح التاريخ» | PASS with friction | `23\f-qualify-filled.png`, `23\g-nda-day-picked.png` | The date box cannot be typed into: it is a calendar pop-up only (typing `2026-11-23` did nothing and the dialog stayed). The qualification dialog needs five choices before saving. |
| 8 | Sara | **حجز جلسة استكشافية** (26 Nov, 10:00, video call), then **تسجيل النتيجة** «المضي قدماً» | The step list moves to step 3, proposal | PASS | `23\i-discovery-filled.png`, `23\i-after-discovery.png`, `23\j-after-outcome.png` | Steps 1 and 2 read «تمّت». New buttons **أُرسل العرض** and **تحويله إلى عميل**. |
| 9 | Sara | **أُرسل العرض**, then **تحويله إلى عميل** | A dialog to make the client, record the engagement and name the lead | PASS (dialog only) | `23\k-convert.png` | Dialog fields: new or existing client, names, participation mode (full, limited, run by the consultant), lead, first project, signed engagement (title, date, scope, exclusions, start, end, data agreement date). **Not completed here**: the full win is covered by scenarios 1 and 16 (Sahm). |
| 10 | Sara | Close INQ-40FC5376 with reason «اعتذرنا», then **إرسال اعتذار لبق** and confirm | Inquiry closed; a decline mail goes only after a confirm | PASS with friction | `23\l-close-dialog.png`, `23\l-closed.png`, `23\q-decline-confirm.png`, `23\q-decline-sent.png` | The close dialog does not mention a decline mail. After closing, **إرسال اعتذار لبق** opens a **confirm box (an alert dialog, which my first attempt did not look for and wrongly reported as "nothing happens")**; after confirming, `POST .../decline-mail` returned `{"ok":true}`, the database row `inquiry.declined` was sent at once, and Mailpit holds «بخصوص طلبك \| About your request» to the prospect. After sending, the screen shows no toast (none captured) and no line saying the decline was sent. The step list also marks step 1 «تمّت» on an inquiry nobody ever read or owned. |
| 11 | Noura | `/clients` → **بدء عرض**: Zahra Logistics / الزهراء للخدمات اللوجستية, first project «Operating model review» | A pitch only the firm sees | PASS | `23\n-pitch-dialog.png`, `23\n-pitch-created.png` | The dialog says it stays inside the firm and no client accounts exist. The client page reads «عميل محتمل» and «عرض: داخل المكتب فقط، ولا يراه إلا الزملاء المشاركون فيه». The project is «مسودة». The pitch appears in Noura's and Sara's `/clients` list only. |
| 12 | Sara (control) | Open the pitch client and its project | She sees both | PASS | `23\o\results.json` | Firm admin sees the pitch and the draft project. |
| 13 | Anyone | English: open the public form | Same four steps in English | PASS | `23\p-en-form.png` | «Tell us about your organisation», «Step 1 of 4». The English submit was not run (the form's own limit of 5 an hour was already used by D7). |

**Should be denied checks (account, what was asked, what came back).** Pitch client id `c5a3f4bb-a215-423b-8de9-2fc79fbbde98`, its project `b938ac97-4b2b-4480-884f-db31b44837a7`, inquiry `cbe5d0a5-57b2-4fba-bc70-4982859ace66` (owner Noura). All as the signed-in account in the browser, 23 Nov 2026. "Not found body" = page text «غير موجود. الصفحة غير موجودة أو لا تملك صلاحية الوصول إليها», served with HTTP 200 (known gap).

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | admin@nukhba.test (Fahd) | Open `/clients/<pitch client>` and `/projects/<pitch project>` | Not found body on both |
| D1 | owner@nukhba.test (Abdullah) | same | Not found body on both |
| D1 | admin@rawdah.test (Hind) | same | Not found body on both |
| D1 | consultant@mizan.test (Omar, firm, not added to the pitch) | same | Not found body on both |
| D1 | observer@mizan.test (Layla) | same | Not found body on both |
| D2 | the same five accounts | Open `/clients` and look for the pitch name | The name is absent from every list (Omar's "client names" directory does not include a pitch) |
| D3 | admin@nukhba.test, owner@nukhba.test, admin@rawdah.test | Open `/inquiries` and `/inquiries/<inquiry>` | Not found body on both pages |
| D4 | consultant@mizan.test, observer@mizan.test | Open `/inquiries/<inquiry>` (not theirs) | Not found body. Their `/inquiries` page opens but is headed «الطلبات التي أسندها إليك مدير المكتب...», their own only |
| D5 | signed out | `POST /api/inquiries` with `consent:false` | `400 {"error":"bad_request","fields":["consent"]}` |
| D6 | signed out | `POST /api/inquiries` with an old privacy notice version (`2020-01-01`) | `400 ... "fields":["privacyNoticeVersion"]` |
| D6b | signed out | `POST /api/inquiries` with channel `phone` and no number | `400 ... "fields":["phone"]` |
| D7 | signed out | Six form posts in the same hour: two from laila@ofoq-trading.test (steps 1 and the retest) and then ratetest@example.test | The 4th ratetest post (the 6th in all from this machine) returned `429 {"error":"rate_limited"}`; posts 5 and 6 also 429. The limit counted across two different e-mail addresses, so it is per network address (or per both); the docs say "each address". |
| D8 | signed out | `POST /api/inquiries` with the hidden `website` field filled | `201 {"ref":"INQ-FE894E1E"}` but **no inquiry appears in Sara's inbox**: a bot is told it worked and nothing is stored. |
| D9 | signed out | `GET /api/inquiries` (the inbox list) | `405` (no list endpoint; the real check is D3) Proves nothing: there is no such endpoint. |

Not run: whether Noura (a non-admin) is refused when she tries to record the engagement that turns the pitch into a client (the page showed no such button; no API probe was made); the winner's mail "client assistant" and invitation; Sara's bell notice for a new inquiry.

Console and server errors: not collected.

## Confusions
- The owner dialog defaults to a name that is not one of the suggested consultants.
- The conflict dialog defaults to «يوجد تعارض» (known).
- The date field in the NDA and session dialogs cannot be typed into.
- After the decline mail is sent, nothing on the screen says so (I saw no toast and no log line); the close dialog never mentions a decline.
- A closed inquiry that nobody opened reads «تمّت» for the step "read and give an owner".
- A prospect who submits twice from one address makes two inbox rows with no sign that they are the same person.

## Four plain-words answers
1. Mostly. The steps are numbered and clear; the two defaults and the date field slow you down.
2. Nothing leaked and nothing broke. The bot form is quietly dropped.
3. No.
4. Say on screen that the decline mail went; default the conflict choice to "not checked yet"; let the date be typed.
