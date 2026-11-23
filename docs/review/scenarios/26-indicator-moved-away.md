# Scenario 26. The indicator "moved away" alert (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010, mail http://localhost:8035), 23 Nov 2026 (the machine clock, Riyadh time about 02:15 on a Monday), Arabic desktop 1280 px; English checked on the notice and the indicator page. Evidence is outside the repo at `C:\Projects\selah-scenario-shots\26\` (screenshots; `results.json` in `26\a\`, `26\d\`, `26\f\`). Page times are the development server and say nothing about production.

**About this copy's data.** The lead copy was started with `dev:local -- --full --fresh`, which loads the basic seed (`db:seed`), not the walkthrough seed. Its indicators are «قرارات المجلس المنفذة في موعدها» (higher is better, baseline 42 %, target 80 %) and «متوسط أيام الموافقة على مشتريات» (lower is better, baseline 18). The walkthrough seed's "Customer complaints" indicator, which the seed text says already carried a moved-away notice, is **not** in this copy, and the table `kpi_moved_away_log` was empty at the start. So the alert was made here from scratch, not found pre-made.

**How it was driven.** Real screens (indicator page → row menu → **تصحيح**; **إدخال قيمة**) by a headless browser script (Playwright, outside the repo). The numbers behind each notice were read from the database with `psql` (read only).

**Shortcuts that are not user actions.**
1. **A database call moved time forward for the monthly job:** `select app_judge_kpi_periods('2026-12-02'::date)` was run as the database owner, which is what the monthly job calls with today's date. It stands for "the monthly job ran on 2 December".
2. The corrections were made through the screen, but they are corrections of the seeded October value (66 to 38 to 35), because a new ended period with a bad value cannot be made without waiting for a month to end.
3. Reading `notifications`, `kpi_moved_away_log` and `outbound_emails` with `psql`.

**Roles.** Reem (client manager, typed the values), Fahd (client admin), Khalid (lead), Noura (deputy), Sara (firm admin), Abdullah (action owner), Omar (consultant staffed on a different project), Layla (observer), Hind (Rawdah admin), Majed (firm, not on Al-Nukhba).

**PRIVACY findings: none.**

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Reem | Indicator page → October 2026 row menu → **تصحيح**: value 38 (baseline 42, higher is better), note | Correction saved; the page says "below baseline" | PASS | `26\c-correct-dialog.png`, `26\d-correct-filled.png`, `26\d-corrected.png` | Dialog: «الرقم من سجلاتك لهذه الفترة.», value, reason. Page: «أدنى من خط الأساس», latest 38 %, change since baseline ‎-4. The page keeps «أرقام شركتكم كما أُبلغ عنها، وليست أثرًا موثّقًا». No red, no "worse". |
| 2 | Khalid, Noura, Fahd | Open the bell after the correction | One notice each, figures only | PASS | `26\d-notifications-admin.png` (the file name is shared by Fahd and Sara, so it shows Sara's list; Fahd's list is in the text below and `26\f-en-notifications-fahd.png`), `26\d-notifications-deputy.png`, `26\d-notifications-lead.png`, `26\d\results.json` | Fahd: «قرارات المجلس المنفذة في موعدها: 38 % في أكتوبر 2026، خط الأساس 42 %، الأعلى أفضل. أرقام شركتكم كما أُبلغ عنها، وليست أثرًا موثّقًا.» The firm's two read «أرقام يبلّغ عنها العميل» instead of «شركتكم». Database: 3 rows `indicator.moved_away` (lead, deputy, client admin), one log row for October. |
| 3 | Reem, Abdullah, Layla, Omar, Hind, Sara | Open their bells | No notice | PASS | `26\d\results.json` | Reem typed the figure, so she is not told. The others are outside the audience (the lead, the deputy and the client's admins only). Sara (firm admin) is not told either; by design, she is not the lead. |
| 4 | Reem | Correct October again (38 to 35) | No second notice for the same period | PASS | `26\e-nov-entered.png` | Database: still 3 rows; the log still has one row for October. The October row now reads «مصحّحة» with the note «تصحيح ثانٍ.» |
| 5 | Reem | **إدخال قيمة** for November (the running month) 30 | No notice yet | PASS | `26\e-enter-dialog.png`, `26\e-nov-entered.png` | Database unchanged after the save (3 rows). The row says 30 %, change ‎-5. The notice waits for the monthly job. |
| 6 | the monthly job (shortcut 1) | `app_judge_kpi_periods('2026-12-02')` | November judged once | PASS | psql output | Returned `1`. Three new rows (lead, deputy, client admin), the log has October and November. A second call returned `0`. |
| 7 | Fahd | English screen: the notice and the indicator page | Same facts in English | PASS | `26\f-en-notifications-fahd.png`, `26\f-en-indicator-fahd.png` | «Board decisions carried out on time: 30 % in Nov 2026, baseline 42 %, higher is better. Your company's reported figures, not verified impact.» The indicator's Arabic name is shown under the English title (the data holds both). |
| 8 | Fahd | Mute and unmute the mail about this indicator (`PUT .../mute`) | Works for a person who is told | PASS (API only) | `26\f\results.json` | `200 {"muted":true}` then `{"muted":false}`. The route's own comment says in-app notices still come. The screen path to this switch was not clicked. |
| 9 | anyone | Is there a **mail** for the moved-away notice? | The handbook says a notice in the bell; the mute says "mail about one indicator" | NOTE | `outbound_emails` table | The table's allowed mail kinds contain no `indicator.moved_away`, and no such mail row exists. So the notice is bell-only today and the "mute mail" switch has no mail to silence. |

**Should be denied checks (account, what was asked, what came back).** Indicator `40f1951c-392a-453f-bd67-0734f8254231`, 23 Nov 2026, as the signed-in account.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | owner@nukhba.test (Abdullah) | Open `/indicators/<id>` | Not found body (HTTP 200) |
| D1 | admin@rawdah.test (Hind) | same | Not found body |
| D1 | lead2@mizan.test (Majed) | same | Not found body |
| D2 | the same three | `POST /api/indicators/<id>/values` (period 2026-10-01, value 1) | `404 {"error":"not_found"}` each |
| D3 | the same three | `PUT /api/indicators/<id>/mute {"muted":true}` | `404 {"error":"not_found"}` each |
| D4 | observer@mizan.test (Layla) | `POST /api/indicators/<id>/values` | `404 {"error":"not_found"}` (observers read, never edit) |
| D5 | manager@nukhba.test (Reem) | `POST .../values` for October again (a plain entry, not a correction) | `409 {"error":"conflict","message":"that period already has a value; correct it instead"}` (English message on an Arabic screen) |
| D6 | observer@mizan.test, manager@nukhba.test | `PUT .../mute {"muted":true}` although they are **not** in the audience | `200 {"muted":true}`: a harmless switch (they are never told), but it accepts a person the notice never goes to. |

Not run: the **target-date** case (a figure short of the target after the date passed; the target dates here are in 2027); a notice for a file import, a sheet read or a system push (where the person who brought it in is also told); a lower-is-better indicator; the screen that holds the mute switch; Sara's silence in English.

Console and server errors: not collected.

## Confusions
- The notice has no link text about what to do next (it states the figures only, as designed), and no mail goes with it.
- The seed text promised a moved-away notice that this copy does not have (data difference, not an app fault).
- A plain value entered twice for one period shows an English «that period already has a value; correct it instead» on an Arabic screen.

## Four plain-words answers
1. Yes. The sentence and the page agree and never judge.
2. Nothing leaked and nothing broke. Once per period holds.
3. No.
4. Say on the notice what the figures changed from and to, and decide whether a mail should follow.
