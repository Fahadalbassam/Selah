# Scenario 33. Notifications and mail: choices, quiet hours, Friday, Saturday and Ramadan (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010, mail http://localhost:8035), 23 Nov 2026, a Monday. The machine's clock read about 03:20 in Riyadh (night, inside the default quiet hours 20:00 to 07:00). Arabic desktop 1280 px; English checked on the mail page's sentence. Evidence is outside the repo at `C:\Projects\selah-scenario-shots\33\` (screenshots; `results.json` in `33\b\` to `33\e\`). Page times are the development server and say nothing about production.

**How it was driven.** A headless browser script (Playwright, outside the repo) for the screens; same-origin `fetch` for the API calls; `psql` read-only for the mail queue.

**Shortcuts that are not user actions.**
1. **Releasing held mail:** I set `next_attempt_at` to now on the two held rows for Reem with `psql` and ran the mail job by hand (`npx tsx --env-file=.env.local scripts/send-mail.ts` in `apps/web` of the lead copy). On a server the job runs on a schedule and the hold ends at 07:00.
2. **The Friday, Saturday and Ramadan rules were checked by calling the database's own rule function** `app_mail_send_time(...)` with chosen times, because the real clock cannot be moved. The function is the one the mail queue uses.
3. **Ramadan dates in the firm settings were set to 20 Nov to 18 Dec** (not the real dates) through `PATCH /api/firm/settings`, then put back to none.
4. The two mentions of Reem were posted with `POST /api/actions/<id>/comments` (same call as the discussion box).

**Roles.** Reem (client manager and owner of the action), Noura (deputy, writes the comments), Sara (firm admin, Ramadan dates), Fahd (his notification id is used in a denied check).

**PRIVACY findings: none.** A mail holds no name, title or file text.

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Reem | Open **خيارات البريد** (`/notifications/mail`) | Choices that change only the mail, never the bell | PASS | `33\a-mail-page.png`, `33\peek-01.png` | «تصلك الإشعارات داخل صلة دائمًا. هذه الخيارات تغيّر فقط ما يصل إلى بريدك ومتى.» Two groups: «تحديثات إجراءاتك» and «التذكيرات والتصعيد», each: now / daily digest / weekly (Sunday) / off. Quiet hours from-to, «البريد يوم السبت» (off by default), «ساعات رمضان», and a list of muted actions and indicators. |
| 2 | Reem | The page's own summary line | Says when a work mail would go if added now | PASS | `33\c-updates-immediate.png`, `33\d-en-mail-page.png` | «لا يُرسل شيء يوم الجمعة. أما الدعوات ورسائل كلمة المرور والعنوان ودعوات الاجتماعات فتُرسل فورًا دائمًا. بهذه الخيارات، تُرسل رسالة العمل التي تُضاف الآن الاثنين 7:00 ص.» English: «With these choices, a work mail queued now goes out Monday 7:00 AM.» So **the choices page does say when a held mail will go**; what is still missing is any sign on the item or in the bell (below). |
| 3 | Reem | Set «تحديثات إجراءاتك» to **متوقف** and **حفظ** | Saved | PASS | `33\c-updates-off.png`, `33\c\results.json` | `PUT /api/notifications/mail` → `{"updates":"off",...}`. |
| 4 | Noura | Comment on the action mentioning Reem while her updates are off | No mail; the bell still gets it | PASS | `33\c\results.json` | Mail rows for Reem: 6 before and 6 after; bell rows of kind `action.mentioned`: 2 (the new one included). |
| 5 | Reem | Set the updates back to **فورًا**; Noura mentions her again | A mail is queued but held for the quiet hours | PASS | `33\c\results.json` | `outbound_emails`: kind `action.mentioned`, `sent_at` empty, `next_attempt_at` 04:00 UTC = 07:00 Riyadh. Reem's choices call returns `"nextMailAt":"2026-11-23T04:00:00.000Z"`. |
| 6 | Reem | Is she told on the item or in the bell that the mail is held? | A sign | FAIL (logic, small) | `33\g-reem-notifications.png` | Reem's notification list (looked at after the mail had been released, so it shows no state at all) carries only the notice sentence and its age («أُشير إليك في إجراء · قبل 3 دقائق»); no notice has any mail status wording, so no sign existed while the mail was held either. Only the choices page says when mail goes (step 2). Same finding as scenarios 1 to 3. |
| 7 | the mail job (shortcut 1) | Release and send | Two short mails | PASS | Mailpit | Subjects «ذُكر اسمك في تعليق \| You were mentioned in a comment» and «تم التحقق من إنجاز إجراء \| An action was verified». Body: «ذكرك أحدهم في تعليق على إجراء في صلة. سجّل الدخول لقراءته والرد عليه.» then the same in English, and one link to the action. No name, title or comment text. Arabic first, English second (known). |
| 8 | (database rule, shortcut 2) | Thursday 14:00, Thursday 21:00, Friday 10:00, Saturday 10:00 (switch off / on) in Riyadh time, default quiet hours | Thu 14:00 now; Thu 21:00 and Friday go Sunday 07:00; Saturday goes Sunday unless the person opted in | PASS | psql output | `app_mail_send_time`: Thu 14:00 → same time; Thu 21:00 → Sun 29 Nov 07:00; Fri → Sun 07:00; Sat (off) → Sun 07:00; Sat (on) → at once. |
| 9 | (database rule) | Ramadan 8 Feb to 9 Mar 2027, work mail 10:00 to 15:00: Wed 09:00, 12:00, 17:00; and the day after Ramadan | Before the hours goes 10:00 the same day; inside is at once; after goes 10:00 next day; outside Ramadan the normal rule | PASS | psql output | 09:00 → 10:00 that day; 12:00 → at once; 17:00 → 10:00 next day; 10 Mar 12:00 → at once. |
| 10 | Sara | Set Ramadan dates 20 Nov to 20 Dec (31 days) and hours 10:00 to 15:00 | Saved | FAIL (small) | `33\d\results.json` | `409 {"error":"conflict","message":"refused by a data rule"}`: a span of 31 days is refused, with no reason and in English. 20 Nov to 18 Dec (29 days) was accepted. |
| 11 | Reem | The mail page and her next mail time with the firm's Ramadan hours on, then her own switch off | The page names the hours; her switch lets her out | PASS | `33\e-ramadan-on.png`, `33\e\results.json` | Page: «في رمضان (من 20/11/2026 إلى 18/12/2026) لا تُرسل رسائل العمل إلا بين 10:00 ص و3:00 م.» and «... تُضاف الآن الاثنين 10:00 ص.» (`nextMailAt` 07:00 UTC). With her own Ramadan switch OFF it is 04:00 UTC again (7:00 Riyadh). |
| 12 | Reem | A quiet-hour value that is not a clock time (`25:00`) | Refused | PASS | `33\d\results.json` | `400 ... "fields":["quietFrom"]`. |
| 13 | Reem | Ask for Saturday mail | Saved, off by default | PASS | `33\d\results.json` | `"saturday":true` stored (I put it back to false afterwards). |

**Should be denied checks (account, what was asked, what came back).** 23 Nov 2026, as the signed-in account.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | manager@nukhba.test (Reem) | `POST /api/notifications/read {"ids":["<Fahd's unread notification>"]}` | `200 {"unread":10}` (her own count) and **Fahd's row stayed unread** (database check: `read_at` still empty). The call is accepted but changes nothing of someone else's. |
| D2 | deputy@mizan.test (Noura, firm deputy) | `PATCH /api/firm/settings {"ramadanStarts":"2026-11-20"}` | `404 {"error":"not_found"}` |
| D3 | manager@nukhba.test (Reem) | `PUT /api/notifications/mail {"quietFrom":"25:00"}` | `400` (only her own row can be set at all; the call has no person id) This is an input check, not a denial. |
| D4 | manager@nukhba.test (Reem) | Mail while updates were **off** | none queued (step 4) |
| D5 | (security mail) | A password reset or sign-in link requested in the quiet hours | **sent at once**, not held: the reset and invitation mails of scenario 28 left at about 02:30 to 03:00 Riyadh time, while the work mail waited. |

Not run: the **daily and weekly digests** (their content and the Sunday send); the real Friday and Saturday clock; a mail for a person who chose "daily"; muting one action by the screen; a mail that fails and retries; the English mail body (only the page sentence was seen in English); the mail list when Mailpit is full.

Console and server errors: not collected.

## Confusions
- A held work mail gives no sign on the notice or in the bell; only the mail-choices page says when mail goes.
- The Ramadan span rule (31 days refused) is answered with «refused by a data rule», in English.
- Mails for Arabic readers are Arabic first, then English, in one message.
- Clicking "mark read" on someone else's notification answers 200 and does nothing; harmless but silent.

## Four plain-words answers
1. Yes. The mail page's sentence about the next send time is clear in both languages.
2. Nothing leaked and nothing broke. Mails carry no names or titles; mail that must go at once does.
3. No.
4. Say on the notice itself that its mail is waiting until 07:00.
