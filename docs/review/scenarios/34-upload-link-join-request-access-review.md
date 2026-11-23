# Scenario 34. Edges: the legal pages, a no-login upload link, ask-to-join and watch, the access review (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010, mail http://localhost:8035), 23 Nov 2026, Arabic desktop 1280 px. English not run. Evidence is outside the repo at `C:\Projects\selah-scenario-shots\34\` (screenshots; `results.json` in `34\b\` to `34\l\`). Page times are the development server and say nothing about production.

**What could not be run.** **Translation on demand** (the "show in English / اعرض بالعربية" control and its background job) was **not run**: no such button appears on an action's discussion in either language, and the assistant side of this copy returns errors (see scenario 27), so a translation job could not be produced. The `ai_jobs` table held no rows.

**How it was driven.** A headless browser script (Playwright, outside the repo) for the screens; same-origin `fetch` for "should be denied" checks; Mailpit's API for the mail.

**Shortcuts that are not user actions.** (1) Layla's join request was made with a direct `POST /api/clients/<id>/join-requests` (the call behind the Ask-to-join dialog). (2) `psql` read-only for ids. Neither moved time.

**Roles.** Noura (deputy, makes the upload link), an outside person with no account (`auditor@external-firm.test`), Sara (firm admin), Omar and Layla (consultants who ask to join Rawdah), Hind (Rawdah client admin), Khalid, Fahd, Abdullah, Majed.

**PRIVACY findings: none.**

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | anyone, signed out | Open `/legal/terms`, `/legal/privacy`, `/legal/ai`, `/legal/security`, `/legal/data-agreement`, `/legal/sub-processors`, and a made-up `/legal/nothing` | The notices open without sign-in; unknown ones are not found | PASS with notes | `34\peek-01.png` to `34\peek-04.png`, `34\b\peek-01.png` | All open with «الإصدار 2026-10-24». `/legal/nothing` → not found body (HTTP 404 here, unlike the app's other "not found" pages). **The AI notice says «اليوم مستشارو المكتب ومسؤولوه. وليس المساعد متاحًا لمنسوبي العملاء»: the client assistant now exists (scenario 27), so a client admin reading this notice is told the opposite.** The security page's panel «هذا الموقع الآن» reports this copy: «مستضاف لدى مزوّد، مع إخفاء الأسماء» for the model, two-step «غير إلزامي (نسخة تطوير)». The same page says a second encrypted backup copy is kept at another site «يُحفظ مفتاحها خارج الخادم»; the Production path says no second disk, no key off the server and no drill are done yet. |
| 2 | Noura | Files tab → an item's menu → **إرسال رابط رفع**: e-mail, 1 day | A link is made and mailed | PASS | `34\a-item-menu.png`, `34\a-link-dialog.png`, `34\b-link-filled.png`, `34\b-link-sent.png` | Dialog: «من يفتحه يرى هذا البند واسم المكتب فقط، ويستطيع إرسال ملفاته حتى تنتهي صلاحية الرابط ... يُسجَّل كل استخدام.» Choices: 1, 3, 7, 14, 30 days. `201`; mail «مطلوب منك مستند \| A document is requested from you» arrived at once; it names no item and no firm. (The handbook says «1 hour to 30 days»; the screen offers 1 day to 30 days.) |
| 3 | outside person | Open the link; send a valid `.docx` | One file received | PASS | `34\c-upload-page.png`, `34\c-upload-done.png` | Page: «مطلوب من ميزان للاستشارات», the item title «عقد التأسيس وتعديلاته», the type and size rule, one file at a time, expiry «حتى 24 نوفمبر 2026 في 3:24 ص». After: «وصل الملف. شكراً لك.» and the file name. |
| 4 | outside person | Send an `.exe` | Refused in plain words | PASS | `34\c-upload-bad.png` | «هذا النوع من الملفات غير مقبول. استخدم PDF أو Word أو Excel أو PowerPoint أو صورة أو نصًا.» (`400 file rejected: type`). |
| 5 | outside person | A made-up token of the right length; a wrong-length token | "This link does not work" | PASS | `34\c\results.json` | «هذا الرابط لا يعمل. ربما انتهت صلاحيته أو أُلغي، أو أُغلق الطلب. اطلب رابطاً جديداً ممن أرسله.» for both. |
| 6 | Noura | Look at the item after the outside upload; then revoke the link | The file shows with its source; the link stops | PASS | `34\d-item-after-upload.png`, `34\d\results.json` | The item reads «بانتظار المكتب · final-report.docx · عبر رابط رفع من auditor@external-firm.test» and lists the links with their expiry. `DELETE /api/info-request-links/<id>` → `200`. |
| 7 | outside person | Open the revoked link; post a file to it directly | Refused | PASS | `34\d-link-revoked.png`, `34\d\results.json` | Page: «هذا الرابط لا يعمل»; `POST /api/upload/<token>` → `404 {"error":"not_found"}`. |
| 8 | Sara | Rawdah → People → **موافقة** on Omar's join request | He is accepted; he is told | PASS with friction | `34\e-join-request.png`, `34\e-join-approved.png`, `34\f\results.json` | **Approve acts at once, with no confirm.** Omar's bell: «قُبل طلبك للانضمام إلى مؤسسة الروضة». Omar can then open the Rawdah client page, but **not** its project (not found) until the lead staffs him on it: being accepted only makes him eligible, as the handbook says. |
| 9 | Sara | **رفض** on Layla's new join request | Declined; she is told | PASS with friction | `34\f-join-request-layla.png`, `34\f-decline-click.png` | Decline acts at once too: no reason box and no confirm (database: `declined`). The same shape as the date-request decline of scenario 5. |
| 10 | Sara | Watch a client (`PUT /api/clients/<id>/watch {"on":true}`) | Firm admin can watch | PASS (API only) | `34\f\results.json` | `200 {"watching":true}`. The screen control was not clicked. |
| 11 | Hind | Team → **الوصول** → **مراجعة الصلاحيات**: untick Dana (who still owns an open action) with a reason | Refused until her work is handed over | PASS with friction | `34\h-review-dialog.png`, `34\i-unticked.png`, `34\j-review-filled.png` | Unticking opens a reason box. The server refused: `409 {"message":"hand over what this person still holds before switching the account off"}` in **English**; the dialog closes without recording any part of the review, and Dana is still active. |
| 12 | Hind | The same review with everyone ticked | Review recorded | PASS | `34\k-reviewed.png`, `34\k\results.json` | `201`; the card then reads «آخر مراجعة في 23/11/2026» (before: «لم تُراجع بعد»). |

**Should be denied checks (account, what was asked, what came back).** 23 Nov 2026, as the signed-in account unless said.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | admin@nukhba.test, owner@nukhba.test, observer@mizan.test, admin@rawdah.test, lead2@mizan.test | `POST /api/info-requests/<item>/links` (make an upload link) | `404 {"error":"not_found"}` for all five |
| D2 | the same five | `DELETE /api/info-request-links/<link>` | `404` for all five |
| D3 | signed out | the used, revoked or made-up upload link; a file posted to a revoked link | «هذا الرابط لا يعمل»; `404` (steps 5 and 7) |
| D4 | signed out | an upload of an `.exe` through a valid link | `400 file rejected: type` (step 4) |
| D5 | observer@mizan.test (Layla, the requester), consultant@mizan.test (Omar, firm consultant), admin@rawdah.test (Hind), lead@mizan.test (Khalid, another client's lead), admin@nukhba.test (Fahd) | `POST /api/join-requests/<Layla's request>/decision {"approve":true}` | `404 {"error":"not_found"}` for all five |
| D5 | consultant@mizan.test (Omar), earlier, on **his own** request | the same | the audit log holds `join_request.decide`, outcome `deny`, reason `scope:lead` for his try (my script lost the response text for that run, so the HTTP code is not recorded) |
| D6 | consultant@mizan.test (Omar), admin@rawdah.test (Hind) | `PUT /api/clients/<Rawdah>/watch {"on":true}` | `404` for both (only the firm admin may watch) |
| D7 | consultant@mizan.test (Omar), before approval | open the Rawdah client page and project | not found body on both; after approval, the client page opens and the project is still not found |
| D8 | Hind (client admin) | remove Dana (owner of open work) in the access review | `409` as above; nothing recorded |

Not run: **translation on demand** (see the top); the 90-day access-review mail and the countdown; an access review that suspends someone who holds nothing; revoking a link after a partial upload; ten files through one link (the limit); an expired link (a one-day link cannot be aged without moving time); the sub-processor list and the data agreement text were opened but not read in full.

Console and server errors: the client page Rawdah → People raised a React hydration warning in the development console when a button was pressed («A tree hydrated but some attributes of the server rendered HTML didn't match the client properties»); not seen elsewhere. It may be development-only.

## Confusions
- The AI notice says clients have no assistant.
- The security page lists protections (a second-site encrypted backup, the key kept off the server) that the Production path says are not done.
- Approve and decline of a join request act at once, with no confirm and (for decline) no reason.
- A refused access review gives an English sentence, loses the rest of the review, and does not offer the hand-over.
- The upload-link choices start at 1 day while the handbook says 1 hour.

## Four plain-words answers
1. Mostly. The outside upload page is clear and short.
2. Nothing leaked and nothing broke. The outsider sees one item's title and the firm's name, nothing else.
3. No.
4. Correct the AI notice; let the access review offer the hand-over instead of refusing in English.
