# Scenario 27. The assistant on and off: the firm's offer, the client's consent, the withdrawal, the file switch (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010), 23 Nov 2026, Arabic desktop 1280 px; English checked on the consent page only. Evidence is outside the repo at `C:\Projects\selah-scenario-shots\27\` (screenshots; `results.json` in `27\c\`, `27\g\`, `27\h\`; `27\en\peek-01.png`). Page times are the development server and say nothing about production.

**What could not be run.** **No assistant answer was obtained on this copy.** Every question that passed the access checks came back from the AI service as `{"type":"writing"}` then `{"type":"error"}`, and the card shows «تعذّر على المساعد الإجابة الآن، ولم يُحتسب سؤالك. حاول بعد قليل، أو اسأل مستشارك.» (5 attempts: Yousef 3, Reem 2). The AI service log shows `POST /v1/answer/stream 200` and the model server's log shows only embedding calls (`/api/embed`), never a chat call; `qwen3.5:4b` is installed but was not loaded. The cause was not confirmed (the copy's settings are in a file that was not opened, by rule). One clue: this copy's public security page (`/legal/security`, "this site now") says «النموذج الذكي: مستضاف لدى مزوّد، مع إخفاء الأسماء» (a **hosted** model with names masked), not the local `qwen3.5:4b` the handbook calls the default, so the failure is probably a hosted model that this copy cannot reach. So **answer quality, "sources", the progress draft and the @ attach were not run**; this scenario tests only the switches, the consent and what each account may ask. The card's own behaviour on failure is itself a finding: it said the question was not counted, and the page header read «أسئلة اليوم: 0 من 10» afterwards, which agrees.

**How it was driven.** Real screens (client page Setup, the consent page, the assistant card) by a headless browser script (Playwright, outside the repo); "should be denied" checks are same-origin `fetch` calls from inside each signed-in account.

**Shortcuts that are not user actions.** None. Notification and audit rows were read with `psql` (read only).

**Roles.** Sara (firm admin), Hind (Rawdah client admin), Yousef (Rawdah client manager), Abdullah (Al-Nukhba action owner), Reem (Al-Nukhba client manager; the assistant was already on for Al-Nukhba in this seed), Khalid (lead), Noura (deputy, uploaded the file), Layla (observer), Fahd (Al-Nukhba client admin), Majed (firm, not on Al-Nukhba). The client used for the offer is **Rawdah**, which starts with the assistant off.

**PRIVACY findings: none.**

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Sara | Rawdah → Setup → **مساعد العميل** → **تغيير**: switch on, keep the roles, limit 10 a day, **حفظ** | The card reads "waiting for the client" | PASS with friction | `27\b-offer-dialog.png`, `27\c-offer-filled.png`, `27\c-offered.png` | Dialog: «يجيب فقط من السجلات والملفات التي يمكن لكل شخص فتحها أصلاً ... يُبلَّغ مسؤول العميل وعليه أن يوافق أولاً.» Roles listed: client admin, client manager, with «لا يتاح للمكلَّفين بالإجراءات: فهم يرون عملهم فقط.» Friction: the roles box starts with **client admin unticked**, so the offer reaches only managers; after saving, the card reads «بانتظار العميل» and «من يمكنه استخدامه: مدير لدى العميل». The admin has to consent but cannot ask. |
| 2 | Hind | Sign in; open `/assistant` before consenting | Sent to the consent page | PASS | `27\c-before-consent-admin.png`, `27\c\results.json` | `/assistant` lands on `/assistant/consent` («موافقة المساعد الذكي»). Her bell has «عرض المكتب على شركتك المساعد. اقرأ الإشعار لتفعيله» (10 s old). |
| 3 | Hind | Read the notice; try **موافق، فعّله** before ticking | Button disabled until she ticks | PASS | `27\d-consent-ticked.png` | The button is disabled before the box «قرأت هذا وأوافق نيابة عن شركتي.» is ticked. The notice has five plain points (answers only from what the asker can open; never sees firm notes, scores, other clients; no legal rulings; chats private to the asker, deleted on the same schedule; every question logged) and the notice version 2026-10-24. |
| 4 | Hind | Tick and **موافق، فعّله** | Consent recorded | PASS | `27\d-consented.png` | `POST /api/assistant/consent` 200. Page: «الموافقة سارية بموافقة هند الزهراني في 23 نوفمبر 2026.» «من يمكنه استخدامه: مدير لدى العميل. عدد الأسئلة لكل شخص في اليوم: 10.» The firm is told: database rows `client_ai.consented` for Sara and Majed (Rawdah's lead). |
| 5 | Yousef | Open `/assistant`, open the card, ask one question | Allowed; answer or a clear failure | PASS (access) / NOT RUN (answer) | `27\e1-card-open.png`, `27\e1-typed.png`, `27\f1-90s.png` | He reaches the card and the question is accepted (`POST /api/assistant/query` 200). The answer is the error above. |
| 6 | Hind | Press **أوقف المساعد** → confirm | The whole company is switched off at once | PASS | `27\g-stop-dialog.png`, `27\g-stopped.png` | Dialog «إيقاف المساعد لجميع منسوبي شركتك؟ تبقى محادثاتهم مخفية، ويمكن للمكتب عرضه مجدداً.» `DELETE /api/assistant/consent` 200. The page goes back to «قبل تفعيل المساعد». The firm is told (`client_ai.withdrawn` rows for Sara and Majed). |
| 7 | Yousef | Open `/assistant` and ask again after the stop | Closed at once | PASS | `27\g\results.json` | Page: not found body; `POST /api/assistant/query` → `404 {"error":"not_found"}`. |
| 8 | Sara | Look at Rawdah's Setup after the stop | The card shows what happened | PASS with friction | `27\g-sara-after-stop.png` | «بانتظار العميل ... على مسؤول العميل قراءة الإشعار والموافقة». It does not say that the client stopped it (and when). The audit log has the row. |
| 9 | Noura, Khalid, Sara | The file switch **السماح للمساعد بقراءته** on `final-report.docx`: Noura (uploader) ON, Khalid OFF, Sara ON | ON by the uploader or the owning side's admin; OFF by anyone on the owning side | PASS | `27\h\results.json` | Noura `200 {"aiIndexable":true}`; Khalid OFF `200 {"aiIndexable":false}`; Sara ON `200 {"aiIndexable":true}`. These were direct calls to the route behind the switch, not clicks on the screen. |
| 10 | Hind | English: open the consent page | Same notice in English | PASS | `27\en\peek-01.png` | «Assistant consent», «Agree and switch on». Friction: the **Switch off the assistant** button is shown before the assistant has ever been switched on. |

**Should be denied checks (account, what was asked, what came back).** Rawdah client id `e32a9e3e-ac46-42fb-b7fd-62c2f9c112ec`; file `2b2b9304-938b-4b48-b449-3e330bbc8338` (`final-report.docx`, shared, uploaded by Noura). 23 Nov 2026, as the signed-in account.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | admin@rawdah.test (Hind) | `POST /api/assistant/query` while her role is **not** among the offered roles (assistant on, consent given) | `404 {"error":"not_found"}`; `/assistant` opens the consent page, not the card |
| D2 | owner@nukhba.test (Abdullah) | open `/assistant`; `POST /api/assistant/query` | not found body; `404 {"error":"not_found"}` |
| D3 | manager@rawdah.test (Yousef) | same two, **after** Hind stopped the assistant | not found body; `404 {"error":"not_found"}` |
| D4 | lead@mizan.test (Khalid, staffed on the project, not the uploader) | `PUT /api/documents/<file>/assistant {"on":true}` | `404 {"error":"not_found"}` (he can open the file; the refusal is "not found", not "only the uploader or an admin") |
| D4 | observer@mizan.test (Layla) | same, ON, and OFF | `404` both |
| D4 | admin@nukhba.test (Fahd, client admin; the file is firm-owned) | same, ON, and OFF | `404` both |
| D4 | lead2@mizan.test (Majed, not on Al-Nukhba) | same, ON | `404` |

Not run: any answer (see the top); the daily limit being reached; changing the roles after consent (the doc says it ends the consent); the firm admin's off switch; the staff assistant for Khalid; the client's chats being hidden after a withdrawal; the confirm dialog that says which kinds of personal number a file holds when the switch goes on (the call was made directly); asking on a case with "Ask the assistant".

Console and server errors: not collected.

## Confusions
- The offer's roles start without the client admin.
- The firm's card says «بانتظار العميل» after the client stopped the assistant; it does not say that the client stopped it.
- A person who may read a file but not switch it on gets "not found".
- The English consent page offers «Switch off the assistant» before it is on.
- On a failed answer the card says "try again, or ask your consultant" with no sign of what failed.

## Four plain-words answers
1. Yes for the consent: the notice is short and the button waits for the tick.
2. Nothing leaked and nothing broke. A stop takes effect on the next request.
3. No.
4. Let the firm's card say who stopped the assistant and when; start the offer with the client admin ticked.
