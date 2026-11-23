# Scenario 25. A deliverable handed over, received, and commented on (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010), fresh seed, 23 Nov 2026, Arabic desktop 1280 px. Not run in English (the screens use the same labels from the shared message files; see "Not run"). Evidence is outside the repo at `C:\Projects\selah-scenario-shots\25\` (screenshots, the two test `.docx` files, `results.json` in `25\g\`, `25\h\`, `25\i\`, `25\k\`, `25\l\`). Page times are the development server and say nothing about production.

**How it was driven.** Headless browser script (Playwright, outside the repo) for the screens; same-origin `fetch` for "should be denied" checks.

**Shortcuts that are not user actions.** (1) The second deliverable (`ملحق منهجية التقييم`) was added by a direct `POST /api/engagements/<id>/deliverables` call as the firm admin, the second file `methodology-annex.docx` was uploaded by a direct `POST /api/projects/<id>/documents` call, and the second hand-over was a direct `POST /api/deliverables/<id>/hand-over`; the same calls the screens make, used to save clicks. The first deliverable, its file and its hand-over were done through the screens. (2) The two `.docx` files were built by a script (a minimal valid Word file).

**Roles.** Sara (firm admin, adds the deliverable), Noura (deputy, uploads and hands over; Khalid was locked out, see scenario 22), Fahd (client admin, the receiver: the project has no named acceptor), Reem (client manager and coordinator), Abdullah (action owner), Hind (Rawdah admin), Layla (observer), Majed (firm, not on Al-Nukhba).

**PRIVACY findings: none.**

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Sara | Engagement page → **إضافة مُخرَج** (title, how the client accepts it, due date, project) | A deliverable on the engagement | PASS | `25\a-add-deliverable.png`, `25\b-deliverable-added.png` | Page text: ««استُلم» يعني أن الملفات وصلت إلى العميل، ولا يعني أبدًا أنه قبِل العمل.» Only the firm admin has the button (Noura's engagement page has only **تسليم**). |
| 2 | Noura | **تسليم** before any shared file exists | A reason, not an empty dialog | PASS | `25\c-handover-dialog.png` | «لا يوجد ملف من مشاريع هذا التعاقد جاهز للتسليم: أضفه من تبويب الطلبات والملفات ... ثم شاركه مع العميل». It also names the firm-only file that is left out. |
| 3 | Noura | Project Files tab → **إضافة ملف** → «العميل والمكتب» → `final-report.docx` | File added, scanned, shared | PASS | `25\d-upload-dialog.png`, `25\e-upload-filled.png`, `25\e-uploaded.png` | Dialog: «يُفحص الملف من الفيروسات ثم يُحفظ بشكل خاص»; the file shows «مشترك مع العميل» in the list after the reload. |
| 4 | Noura | **تسليم**, tick the file, confirm | Round 1 handed over; the dialog says who will be asked | PASS | `25\f-handover-dialog.png`, `25\f-after-handover.png` | `POST .../hand-over` → `{"round":1}`; the preview call returned `{"asked":[{"name":"فهد الدوسري","as":"admin"}],"skipped":[]}`. My capture right after ticking did not show the "who will be asked" line (it loads a few seconds later); a later capture in scenario 32 shows it: «سيُطلب تأكيد الاستلام من: فهد الدوسري (مسؤول لدى العميل).» |
| 5 | Fahd | Open Home | "Files waiting for your confirmation" with the right words | PASS | `25\g-fahd-home.png`, `25\g-fahd-deliverables.png` | Card «تأكيدك استلامها»: «سلّمها المكتب لشركتكم. نزّلها، ثم أكّد استلامها أو اكتب ملاحظة. تأكيد الاستلام لا يعني أبدًا قبولكم للعمل.» State «سُلِّم (بانتظار التأكيد)». Buttons **تنزيل**, **تأكيد الاستلام**, **ملاحظة**. |
| 6 | Fahd | **تنزيل** | The file downloads (scan clean) | PASS | `25\h-confirm-dialog.png` | A download event named `final-report.docx` fired. |
| 7 | Fahd | **تأكيد الاستلام**, confirm | State «استُلم» with who and when | PASS with friction | `25\h-confirm-dialog.png`, `25\h-received.png` | Dialog: «يُبلغ هذا المكتبَ ... ويُسجَّل مرة واحدة لهذا التسليم». State: «أُكِّد الاستلام في 23/11/2026 بواسطة فهد الدوسري». Friction: the dialog's top-right **Close** (X) is the last button in it, so a script that clicks "the last button" cancels (my first run did). |
| 8 | Noura, Sara | Look at the bell after the receipt | The firm is told | FAIL (small) | `25\i-notifications-Noura.png`, `25\i-notifications-Sara.png` | Neither bell lists the receipt (search of the list text for «استلام»). The receipt shows only on the engagement page. For a **comment** the firm is told (step 10). |
| 9 | Fahd | Second deliverable: **ملاحظة** with text instead of a receipt | Comment recorded; round closed | PASS | `25\l-comment-dialog.png`, `25\l-commented.png` | Dialog: «اذكر ما ينقص أو ما يحتاج إلى تعديل. يقرؤها المكتب ويمكنه تسليم نسخة جديدة.» State «عليه ملاحظة». |
| 10 | Noura | Bell after the comment | She is told | PASS | `25\l-noura-notifications.png` | First line: «كتب العميل ملاحظة على «ملحق منهجية التقييم» بدل تأكيد استلامه» (11 s old). |
| 11 | Fahd | Confirm receipt after he commented | Refused: one answer per round | PASS with friction | `25\l\results.json` | `409 {"error":"conflict","message":"this round was already answered"}`: the message is English on an Arabic screen (the buttons were not offered, so this was a direct call). Same for a second receipt: `409`. |

**Should be denied checks (account, what was asked, what came back).** Deliverable 1 `e3e11825-07ae-447f-a7a7-b189db4127f3`, engagement `c69e87f3-c631-4e47-9475-302e3927eb35`, 23 Nov 2026, as the signed-in account. "Not found body" = page text «غير موجود...» with HTTP 200.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | manager@nukhba.test (Reem) | Open `/deliverables` | Page opens, reads «لم يُسلَّم إليك شيء بعد.» (no title, no file name of the deliverable; checked by text search) |
| D1 | admin@rawdah.test (Hind) | Open `/deliverables` | Same empty message; the Al-Nukhba title and file name are absent |
| D1 | owner@nukhba.test (Abdullah), observer@mizan.test, lead2@mizan.test | Open `/deliverables` | Not found body |
| D2 | Reem, Abdullah, Hind, Majed | Open `/engagements/<id>` | Not found body. (Layla the observer can open it: she is on the project.) |
| D3 | Reem, Abdullah, Hind, Majed | `GET /api/deliverables/<id>` | `404 {"error":"not_found"}` each |
| D3 | observer@mizan.test (Layla) | same | `200` (she is on the project and reads) |
| D4 | Reem, Abdullah, Hind, Layla, Majed | `POST /api/deliverables/<id>/comment {"round":1,"comment":"..."}` | `404 {"error":"not_found"}` for all five |
| D5 | the same five | `POST /api/deliverables/<id>/receipt {"round":1}` (made **after** Fahd confirmed, so on a round already answered, but each got 404 before the round was looked at) | `404 {"error":"not_found"}` for all five |
| D6 | the same five | `POST /api/deliverables/<id>/hand-over {"versionIds":["00000000-0000-4000-8000-000000000000"]}` | `404 {"error":"not_found"}` for all five |
| D7 | admin@nukhba.test (Fahd) | `POST /api/deliverables/<id>/receipt {"round":1}` again | `409 {"error":"conflict","message":"this round was already answered"}` |

Run later, in scenario 32: **a new version** (round 2) handed over for deliverable 1 after a new file version was uploaded: **تسليم نسخة جديدة** lists «النسخة 2» and «النسخة 1», preselects the latest, and `POST .../hand-over` returned `{"round":2}`; round 1 stays pinned to «final-report.docx (النسخة 1)». Not run: round 2 being answered; a firm-run client (Al-Waha), where the consultant records the receipt with who, how and when; naming a project acceptor so the admin is not the receiver; the English screens; whether Fahd got a bell or mail when the deliverable was handed over (his Home card shows it); the "not handed over / handed over / received / commented" labels in English.

Console and server errors: not collected.

## Confusions
- The firm is not told when the client confirms receipt (it is told when the client comments).
- A refusal ("already answered") arrives in English on an Arabic screen.

## Four plain-words answers
1. Yes. The wording «استُلم لا يعني القبول» is clear on every screen.
2. Nothing leaked and nothing broke. Receivers who are not the named client person cannot answer.
3. No.
4. Tell the firm when a receipt is confirmed.
