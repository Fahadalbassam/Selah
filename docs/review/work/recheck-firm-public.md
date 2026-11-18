# Screen re-check: signed-out pages and the firm accounts

Re-checked 18 Nov 2026 from the `recheck1` captures (main after #165), against `phase1`. Accounts: the signed-out pages, admin, lead, deputy, consultant, observer and lead2 @mizan.test. Read only. Evidence paths are relative to `docs/review/shots/`. Record ids differ from phase 1; pages are matched by route, tab and heading.

**In one line:** no privacy fault in this area. The batch 0 changes are right for the firm and the signed-out pages. One new fault from #153 (two language switches on every signed-out-style Not found inside the app), one old fault made visible by new data (agenda words in the meeting's language, not the page's), and a few wording marks.

## What was not captured, and how it was judged instead

- **Screens 33 and 34** (reset password with a made-up link: mismatch, dead after submit) do not exist any more. Since #153 a made-up link opens "هذا الرابط لا يعمل" with no form (`recheck1/public/ar/31-reset-password-wellformed-fake-1280.png`).
- **75-sending and 76-sent** (the inquiry is being sent; the confirmation) were not captured. The confirmation changes are judged from code only (`(public)/inquiry/inquiry-form.tsx`, `Sent`): no green tick, focus moves to the heading, the address is one left-to-right piece.
- **93 "real upload link" is a dead-link page.** The script found no fresh link ("linkMade: by an earlier run") and took a link from an older mail still in Mailpit, whose token does not exist in the fresh data. Screen 92 shows the item "عقد التأسيس وتعديلاته" still "بانتظار الإرسال" with no live link. So the live upload page (who asks, the file-type line, the file field) was not seen this round. The header change is seen on the dead state; the file-type line is judged from code. Side note: `public/notes-upload-security.json` now holds the full token (phase 1 had `<token>`); it is dead and local, but the script's redaction slipped.
- **No keyboard pass, no mails this round** (no `notes-inquiry-keyboard.json`, `notes-choice-row-keys.json`, `mails/`). Focus on steps 3 to 5 and after sending is judged from code. The invitation mail is judged from `src/lib/mail-templates.ts`.
- **The "too many tries" message** was not triggered; judged from code (`sign-in-form.tsx`, `lib/retry-after.ts`).
- **Not captured for the firm:** `/team`, `/settings`, the Files card, the assistant card (no second pass this round), and the meeting form's warning (a dialog). `/team` and the warning are judged from code and messages.
- **#167 (indicator moved-away notice) is not in these captures** (the indicator page has no "Mute mail" and the seed value is 11 days). The lead's indicator question is answered from `recheck1` and from `check-indicator/lead_at_mizan.test` (captured 01:49, 18 Nov, on #167).
- `consultant_at_mizan.test/en/004-help` was captured before the page drew (its h1 is the sidebar text). Capture timing, not a fault.

## 1. One row per changed screen

Counts are from `pages.json`: buttons / links / fields, Arabic, phase 1 → today. "Solid" is the number of black buttons.

### Signed-out pages (#153)

| Route | What changed since phase 1 | Right? | New faults | Screen standard | Evidence (`recheck1/public/`) |
|---|---|---|---|---|---|
| `/sign-in` and its states (02–09, 11) | Corner language switch. Line under the link button now plain: "إن دُعيت لمتابعة عمل أو تنفيذه، نرسل لك رابط دخول. مسؤولو الحسابات وفريق المكتب يدخلون بكلمة المرور." Subtitle now says "مسؤول حسابك" like the other pages. "Too many tries" gives the real minutes (code). | **Yes** | None | One solid "دخول". 2/2/2 → 3/2/2 (the switch). Still on one screen. | `ar/01-sign-in-1280.png`, `en/01-sign-in-1280.png`, `ar/04-sign-in-done-invited-1280.png`, `ar/11-sign-in-link-asked-1280.png` |
| `/sign-in/link/:token` (20–25) | Switch added; hydration error gone (events 2 → 0 on 21–25). Bad token: says so and links to sign-in. | **Yes** | None | One solid button. 0/1/0 → 1/1/0. | `ar/22-sign-in-link-real-1280.png`, `ar/20-sign-in-link-bad-token-1280.png` |
| `/forgot-password` (10, 12) | Switch added. | **Yes** | None. Old mark still true: the subtitle "سنرسل إليك رابطاً" stays above "الرابط في طريقه إليك". | 1/1/1 → 2/1/1. | `ar/10-forgot-password-1280.png`, `ar/12-forgot-password-sent-1280.png` |
| `/reset-password/:token` (30–32) | A made-up or malformed link says "هذا الرابط لا يعمل" at once, with "اطلب رابطاً جديداً". No more bare Not found (was 404) and no form to fill first. Real link: form as before, plus the switch. | **Yes** | None | Dead: 1/1/0, no solid. Real: 1/1/2 → 2/1/2, one solid. | `ar/30-…`, `ar/31-reset-password-wellformed-fake-1280.png`, `ar/32-reset-password-real-link-1280.png` |
| `/invite/:token` (40, 41) | Dead invitation now offers "الذهاب إلى تسجيل الدخول". Valid state still not seen. | **Yes** for the page | Invitation mail still names nothing ("You have been invited to Selah.", `mail-templates.ts` l. 44–45, untouched by #153). Phase 1 row 46 planned this for batch 0. | 0/0/0 → 1/1/0. | `ar/41-invite-wellformed-fake-1280.png` |
| `/confirm-email/:token` (50–52) | Dead link says so at once (no button that fails after the press), with "الذهاب إلى تسجيل الدخول". Malformed link no longer a bare 404. | **Yes** | None | 1/0/0 → 1/1/0, no solid. | `ar/51-confirm-email-wellformed-fake-1280.png`, `ar/52-…-after-press-1280.png` |
| `/consent` (seen under owner@rawdah) | Switch added; the privacy card no longer says "stays in the Kingdom" ("وأين يُحفظ"). | **Yes** | None | Judged by the client helper for layout. | `owner_at_rawdah.test/ar/001-consent-1280.png` |
| `/security` (62; also `/security` for every firm account) | Corner switch added. No app shell here, so only one switch. | **Yes** | None | 1/1/1 → 2/1/1, one solid. | `ar/62-security-lead-1280.png`, `admin_at_mizan.test/ar/003-security-1280.png` |
| `/inquiry` steps 1–5 (70–75) | Title shows at once (16 letters at 291 ms; was blank for 2 s, then typed). Review step now shows preferred language, the free message and "how did you hear" ("دون إجابة" when empty). The four "تعديل" buttons now have names ("تعديل قسم «المنشأة»"). Step panels take focus on arrival (code). | **Yes** | Possible keyboard regression, unsure: with the same script, after choosing "دورك" from the list with the keyboard, the next Tab now starts at the top of the page (6 presses to the e-mail field; 2 in phase 1). `notes-inquiry.json` keyboard.toEmail. Cause not found. | Counts unchanged (3/0/4, 10/0/6, 16/0/4, 23/0/2, 13/1/1). Step 5: 1.5 → 1.6 screens (three more rows). Old marks still true: no firm name (D7, batch 1), "الاسم بالعربية" on the Arabic form, English step "About you", the chosen option drawn solid black. | `ar/70-inquiry-1280.png`, `ar/75-inquiry-step5-review-1280-full.png`, `en/75-inquiry-step5-review-1280-full.png` |
| `/inquiry` confirmation (76) | Not captured. From code: no green tick, focus on the heading, address kept whole. | Yes (code) | — | — | `inquiry-form.tsx` `Sent` |
| `/privacy` (80) | Version now "⁦2026-10-24⁩" like the legal pages. | **Yes** | None | 0/1/0, same. Merge into `/legal` is batch 1. | `ar/80-privacy-1280.png` |
| `/legal/:doc` (81–87) | Sub-processors: the mail row now reads the setting ("غير مستخدم في هذا الموقع" on this copy). Addresses in the texts are links (links 5 → 6 on privacy, ai, data agreement). Data agreement and sub-processors now write "صلة". | **Yes** | Small: the link text is still the raw path ("/privacy", "/legal/sub-processors") inside an Arabic sentence. "صِلَة" still in `/legal/privacy` and `/legal/ai`. | No buttons. | `ar/85-legal-sub-processors-1280-full.png`, `ar/82-legal-privacy-1280.png` |
| `/upload/:token` (90, 91, 93) | Header: wordmark (not a link) and language only; "تسجيل الدخول" gone. The item name is an h1. File-type line wrapped left to right (code). | **Yes** (header seen; live page not seen) | — | Dead state 0/0/0, same. | `ar/90-upload-bad-token-1280.png`, `ar/93-upload-real-link-768.png` |
| Not found, signed out (95, 87) | Corner switch added. The "script tag" console error is gone (events: only the 404). | **Yes** | None. Old mark: no wordmark, unlike the other signed-out pages. | 0/1/0 → 1/1/0. | `ar/95-not-found-signed-out-1280.png`, `ar/87-legal-unknown-1280.png` |

No overflow at 1280 or 768 on any signed-out page; no raw keys.

### Firm accounts

| Route (tab) | Accounts | What changed since phase 1 | Right? | New faults | Screen standard | Evidence |
|---|---|---|---|---|---|---|
| In-app Not found (`/help` for firm staff) | all six | The root Not found page now draws the corner switch inside the app shell. | **No** | **Two language switches**: top bar "EN" / "عربي" and a body "English" / "العربية" (fault F1). | 0/1/0 → 1/1/0. One outline button "العودة للرئيسية". | `admin_at_mizan.test/ar/004-help-1280.png`, `…/en/004-help-1280.png`, `…/ar/004-help-768.png`; same in lead, deputy, consultant, observer, lead2 |
| `/projects` | admin, lead, deputy, consultant, observer, lead2 | One count per card, labelled: "8 إجراءات · مُتحقق: 1 · بانتظار المراجعة: 1" (was 9, counting a draft). Pitch card says "عرض", not "عميل". "إجراء واحد" / "1 action". | **Yes** (B2 fixed) | None | 1 outline button "مشروع داخلي جديد", same. | `admin_at_mizan.test/ar/071-projects-1280.png` vs `phase1/admin_at_mizan.test/ar/071-projects-1280.png` |
| `/projects/:id` header and Plan | all with the project | Firm-run client (Al-Waha): a line "يسجّل المكتب هذا العمل نيابة عن العميل." on every tab. Otherwise the same as phase 1. | **Yes** | None | Same as phase 1: 24 + 11 in menus, 11 tabs, tab row at 517 px, 3 screens (U02 still true, batch 3). | `admin_at_mizan.test/ar/011-projects_f19fbafb-1280-full.png`, `…/ar/056-projects_5aee9518-1280.png` |
| tab Progress | all | Percentages agree with the card (13 %, 1 of 8). Al-Waha shows the firm-run line. | **Yes** | None. Old: on Al-Waha the page still says client managers see these numbers and asks for a client sponsor (N24 rest, batch 4). | 5 buttons, same. | `lead_at_mizan.test/ar/011-projects_f19fbafb_tab_التقدم-1280.png`, `admin_at_mizan.test/ar/057-projects_5aee9518_tab_التقدم-1280-full.png` |
| tab Assessments | all | "37.5 % · 6 فجوات مقترحة، 0 مؤكدة · 🔒 للمكتب فقط" (was "6 فجوات"). Observer: "بدء تقييم" gone. | **Yes** (N8, N4 part) | None. Old: version and date scrambled in Arabic ("2026/11/v1 · 18"). | admin 4 → 4; observer 2 → 1. | `admin_at_mizan.test/ar/016-…التقييمات-1280.png`, `observer_at_mizan.test/ar/015-…التقييمات-1280.png` |
| tab Meetings | all | Lists the two new Rawdah meetings (new walkthrough data). | Yes | None | Same buttons. | `admin_at_mizan.test/ar/046-…الاجتماعات-1280.png` |
| tab Activity | firm (kept) | Lines now "<event>، بواسطة <name>" (no gendered verbs). | **Yes** | Wording: "تغيير الحالة إلى «مغلق» بعد «قيد التنفيذ»" reads oddly (F5). | 3 buttons, same. | `admin_at_mizan.test/ar/019-…سجل_النشاط-1280-full.png` |
| tabs Documents, Requests, Team, Needs attention, Trace, Closing | all | Same as phase 1 (Al-Waha gains the firm-run line). | — | — | Same counts. Request rows still 5 buttons each (U15). | `public/ar/92-requests-tab-with-link-firm-side-1280.png` |
| `/recommendations/:id` | all | Firm sees every action, the draft with its "مسودة" chip. Observer: Link / Unlink gone, and the "المؤشرات المرتبطة" card is not drawn when nothing is linked (no empty card). | **Yes** | None. The "not visible to the client" line is on the action page only; here the chip alone (fine for the firm). | admin 4 / 2 / 4 → same; observer 3 / 2 / 3 → 1 / 1 / 1 (only "اسأل المساعد"). | `admin_at_mizan.test/ar/077-recommendations_bbdc8a3e-1280-full.png`, `observer_at_mizan.test/ar/039-recommendations_bbdc8a3e-1280.png` |
| `/actions/:id`, a draft | lead, deputy, consultant, observer | Line under the title: "لا يراه العميل حتى تُصدره. وما يُكتب هنا من تعليقات يطّلع عليه العميل بعد الإصدار." Reminder ladder gone on the draft. | **Yes** | Arabic verb mismatch, and the observer reads "you release" though he cannot (F4). | 8 buttons, same; one solid "إسناد إلى المسؤول". | `lead_at_mizan.test/ar/042-actions_64f9a053-1280.png`, `observer_at_mizan.test/ar/030-actions_64f9a053-1280.png` |
| `/actions/:id`, finished (verified, closed) | all with access | Reminder ladder gone (was dates in the past); "الاعتماد الثاني" card moves up. | **Yes** (B3) | None | Same buttons. | `lead_at_mizan.test/ar/041-actions_92253cad-1280.png`, `admin_at_mizan.test/ar/041-actions_9c528297-1280.png` |
| `/actions/:id`, open | all with access | Empty "طلبات تغيير الموعد" card gone when nothing is asked. Back-dated sample no longer shows as a date move: "كان موعده الأصلي 2026/11/14 · متأخر 4 أيام". Discussion box now starts on the right. | **Yes** (N15b, small fault fixed) | None new. Old: the date request card has two solid buttons ("موافقة", "رفض"); "الخطوة التالية" offers only "إغلاق الإجراء" while a date decision waits (U03). | 10 buttons, same. | `admin_at_mizan.test/ar/022-actions_8442d62b-1280-full.png` vs phase 1 `022-actions_8b57150a` |
| `/actions/:id`, firm-run client (Al-Waha, Nukhba Real Estate) | admin, deputy, lead2 | Firm-run line; progress note asks "كيف وصل من العميل" and "تاريخ الوصول"; evidence text "لا حساب للعميل في صلة…"; discussion says nothing reaches the client; ladder names firm roles only; history shows "استُلم من العميل بالبريد الإلكتروني في 2026/11/15". | **Yes** (N24, the guideline part) | None | 11 → 13 buttons, 2 → 3 fields (the two new inputs). First card: 4 buttons, one solid "إرسال للمراجعة" (who reviews is still unsaid, N25). | `admin_at_mizan.test/ar/055-actions_91f35dfe-1280-full.png`, `lead2_at_mizan.test/ar/041-actions_f5644a29-1280.png` |
| `/meetings/:id` | all with access | Status words in words, dates as dates; no hydration page error. A department's meeting (Finance workshop) lists Finance work only. Observer: read-only (only "اسأل المساعد"). New Rawdah meetings for lead2. | **Partly** | Agenda headings and status words follow the meeting's language, not the page's (F2). A lighter hydration warning now shows on meetings (F3). | admin 14 / 9 / 12, same; observer 13 / 8 / 11 → 1 / 1 / 1. Scheduled meetings still show empty Summary, Decisions, Follow-ups and Transcript (U14, batch 1). One solid "الانضمام إلى الاجتماع". | `admin_at_mizan.test/ar/085-meetings_932ac4de-1280-full.png`, `…/ar/084-meetings_721bc08b-1280.png`, `lead2_at_mizan.test/ar/009-meetings_6834f191-1280.png`, `observer_at_mizan.test/en/047-meetings_932ac4de-1280.png` |
| `/indicators/:id` | admin, lead, deputy, consultant, observer | Observer read-only: 16 → 1 ("عرض كجدول"). Firm staff keep Link / Unlink (16 → 16). | **Yes** (D4, links firm-only) | None. Banner: see lead's point 2. | Value rows still two buttons each (U15, batch 1). One solid "إدخال قيمة". | `admin_at_mizan.test/ar/081-indicators_1f0dfa02-1280-full.png`, `observer_at_mizan.test/ar/043-indicators_1f0dfa02-1280.png` |
| `/indicators/data` | admin, lead, deputy, consultant, lead2 (the crawl no longer reached it as observer) | For the observer no link led there this time (phase 1 it showed him "اقتراح على العميل"); the page gives that button only to people who may manage indicators (`services/indicator-data.ts` l. 200). Text unchanged. | **Partly** | Still speaks to the firm as the client (F6). | 4 buttons, same. | `admin_at_mizan.test/ar/088-…`, `…/ar/099-…` |
| `/clients/:id` | observer | "مؤشر جديد" gone for the observer (2 → 1). Others unchanged. | **Yes** | None | — | `observer_at_mizan.test/ar/049-clients_530fbdcc-1280.png` |
| `/clients/:id/departments`, `/departments/:id` | all | Switch drawn as a word for readers who cannot change it: "مفعّلة" / "متوقفة". Department page has a back link "شركة النخبة القابضة: الإدارات". Observer loses "مؤشر جديد" there too. | **Yes** (B4) | Small: "تم التحقق من 0 من أصل 2 إجراء ما زالت قائمة" (singular noun, plural verb). | lead 0 / 4 / 0, same; observer 1 → 0 on `/departments/:id`. | `lead_at_mizan.test/ar/066-clients_530fbdcc_departments-1280.png` vs phase 1 `066-clients_5cbbfdd6_departments-1280.png`; `admin_at_mizan.test/ar/102-departments_b3bf14e8-1280.png` |
| `/inquiries`, `/inquiries/:id` | admin (consultants: empty list) | Staff band reads "10–49" (was "49–10"); history "إرسال الطلب، بواسطة النموذج العام". | **Yes** | None | Same counts (1; 9). Several next steps at once (U16, batch 5). | `admin_at_mizan.test/ar/006-inquiries-1280.png`, `…/ar/038-inquiries_2d44d0ed-1280-full.png` |
| `/today` | all firm | Date-change text matches the rule (N27). lead2 gets "اجتماعات هذا الأسبوع" (new data). | **Yes** | None | 0 buttons. | `admin_at_mizan.test/ar/005-today-1280.png`, `lead2_at_mizan.test/ar/005-today-1280.png` |
| `/notifications` and the badge | all | Badge digits right in Arabic ("17", was "71"). Page the same. | **Yes** (N12) | Lighter hydration warning on 5 loads (F3). | Same counts. | `lead_at_mizan.test/ar/001-home-1280.png` vs phase 1 |
| `/team` | firm | Not captured. Code adds one line under the table: "المشاريع: ما يعمل عليه كل شخص من المشاريع التي يمكنك أنت فتحها." | Partly (explains N13, does not change the number) | — | — | `apps/web/src/app/(app)/team/page.tsx` l. 89 |

No overflow at 768 and no raw keys on any firm screen except the audit log (unchanged, batch 5).

## 2. Faults found

No **blocking** fault. Firm staff on a project see all of it by the agreed rule; the observer now changes nothing on indicators, meetings or assessments; lead2 sees nothing of Al-Nukhba except the client names on Clients with "طلب الانضمام" (unchanged, by design).

**F1. Two language switches on every in-app "Not found".** All six firm accounts, both languages, 1280 and 768. The top bar has "EN" / "عربي"; the page body adds "English" / "العربية". Cause: `apps/web/src/app/not-found.tsx` line 11 always draws `<CornerLocaleToggle />` (#153), and a `notFound()` inside a signed-in page renders that page inside the app shell. Since #165 a limited client reader gets this page for every whole-project meeting, so it will be seen more. Signed-out Not found (`public/ar/95`, `87`) and `/security` are fine (one switch). Fix: draw the corner switch only where there is no top bar (for example an `(app)/not-found.tsx` without it). Evidence: `admin_at_mizan.test/ar/004-help-1280.png`, `…/en/004-help-1280.png`.

**F2. Agenda words in the meeting's language, not the page's.** On the Arabic page, lead2's Rawdah meeting reads "Changed since the last meeting" and "(Verified complete)", laid out left to right (`lead2_at_mizan.test/ar/009-meetings_6834f191-1280.png`). On the English page the Al-Nukhba meetings read "متأخرة", "بانتظار المراجعة", "متوقفة", "ما تغيّر منذ الاجتماع السابق" and "(قيد التنفيذ)" (`observer_at_mizan.test/en/047-meetings_932ac4de-1280.png`, `admin_at_mizan.test/en/085-…`). The code says this is on purpose (`meetings/[id]/page.tsx` lines 60–69: "one stored text in the meeting's language"). These are app-made words, so rule 2 is broken. B1 is partly fixed: raw keys and raw dates are gone. Also "Verified complete" is not one of D3's six words (batch 5).

**F3. Lighter hydration warnings remain.** "A tree hydrated but some attributes of the server rendered HTML didn't match" on: meetings 11 loads (phase 1: none of this kind, but 20 hard errors, now gone), notifications 5 (was 2), action pages 3 (was 1), departments 1 (was 3), plan import 1 (was 6). Phase 1 batch 0 listed "the lighter warnings" too. The record cuts the text at 400 characters, so the attribute is unknown. Evidence: `recheck1/<account>/<lang>/pages.json` `events`, for example `admin_at_mizan.test/en` record 83.

**F4. The draft line uses a third Arabic verb, and speaks to the observer as if he could release.** The line says "حتى تُصدره … بعد الإصدار"; the button says "إسناد إلى المسؤول"; the add dialog says "إرساله إلى المسؤول الآن" (`messages/ar.json` 470, 2778). English is "release" everywhere. The observer reads "until you release it" but has no button (`observer_at_mizan.test/ar/030-actions_64f9a053-1280.png`). Suggest one verb, and "until the firm releases it".

**F5. Activity line reads backwards in Arabic.** "تغيير الحالة إلى «مغلق» بعد «قيد التنفيذ»، بواسطة …" (`admin_at_mizan.test/ar/019-…-full.png`). Plainer: "تغيير الحالة من «قيد التنفيذ» إلى «مغلق»". English "moved In progress to Closed" is fine.

**F6. `/indicators/data` still speaks to the firm as if it were the client.** "لا يخرج شيء من أنظمتكم", "تدخل أنت أو مستشارك". On the firm-run client (Al-Waha) the firm admin gets "تأكيد" and "يمكنك تغييره … من «مشاركة البيانات» في قائمة حسابك", a menu entry of the client admin. Phase 1 row 29 planned this for batch 0 or 2; unchanged. Evidence: `admin_at_mizan.test/ar/088-…`, `…/ar/099-…`.

**F7. Unsure: inquiry form, keyboard focus after choosing "دورك".** Same script, different result: the next Tab now starts at the page top (6 presses to e-mail, was 2). `public/notes-inquiry.json` vs `phase1/public/notes-inquiry.json`. Worth one manual check.

Small, unchanged from phase 1 but on screens that changed: two solid buttons in the date-request card (`admin/ar/022`); version and date scrambled on the Assessments tab ("2026/11/v1 · 18"); raw path as link text in the legal texts; "صِلَة" still in two legal texts; no wordmark on Not found.

## 3. Phase 1 marks on these screens

| Mark | Now | Evidence |
|---|---|---|
| U02 project page: 11 tabs, 104 controls, tab row 517 px | Still true (batch 3) | `admin_at_mizan.test/ar/011-…-full.png` |
| U03 action page: three text boxes, wrong next step | Still true | `admin/ar/055`, `admin/ar/022` |
| U14 meeting page shows everything before the meeting | Still true (batch 1) | `admin/ar/085-…-full.png`, `lead2/ar/009` |
| U15 dense rows | Still true (requests 5 buttons a row; indicator values 2) | `public/ar/92`, `admin/ar/081` |
| U16 inquiry page | Partly true, unchanged | `admin/ar/038` |
| B1 raw keys and dates on the agenda; Arabic headings on the English page | Partly fixed: words and dates fixed; language of the agenda still wrong (F2) | `admin/ar/085`, `observer/en/047`, `lead2/ar/009` |
| B2 three percentages | Fixed for the firm (card 1 of 8 = Progress 13 %) | `admin/ar/071`, `lead/ar/011` |
| B3 reminder ladder on finished and draft actions | Fixed | `lead/ar/041`, `lead/ar/042` |
| B4 departments switch drawn off while on | Fixed ("مفعّلة" / "متوقفة") | `lead/ar/066`, `lead2/ar/048` |
| B5 hydration error on meetings and the sign-in link | Fixed (hard errors gone); lighter warnings remain (F3) | `public/ar/22`, `admin/ar/085` |
| N4 observer not read-only | Fixed on indicators, links, meetings, assessments, new indicator | `observer/ar/043`, `/045`, `/015`, `/039`, `/049` |
| N6 public pages send the whole catalogue | Fixed (code: `i18n/signed-out-messages.ts`, root layout sends none) | — |
| N8 "6 gaps" without "suggested" and "firm only" | Fixed | `admin/ar/016` |
| N12 badge digits reversed | Fixed | `lead/ar/001` |
| N13 Team "Projects" number | Partly: a hint line explains it; not captured | `team/page.tsx` |
| N15b back-dating shown as a date move | Fixed | `admin/ar/022` |
| N19 nobody says who this is from | Still true (D7, batch 1) | `public/ar/70`, `public/notes-upload-security.json` |
| N20 "reply to this mail", no reply address | Still true (`replyTo: []`; texts unchanged) | `public/notes-auth-flows.json` |
| N21 no language switch on sign-in pages | Fixed | `public/ar/01`, `22`, `31`, `41`, `51`, `62` |
| N22 dead links behave five ways | Fixed: every dead link says so at once and offers a way on | `public/ar/20`, `31`, `41`, `51`, `90` |
| N23 three statements that do not hold | Fixed: lockout minutes (code), mail row reads the setting, consent no longer says "stays in the Kingdom" | `public/ar/85`, `owner_at_rawdah.test/ar/001` |
| N24 firm-run client | Partly fixed: line, how and when received, firm-only ladder. Client roles card and the sponsor on Progress remain (batch 4) | `admin/ar/055`, `/057`, `/065` |
| N25 lone consultant offered "Send for review" | Still true (batch 4) | `admin/ar/055` |
| N27 Today text on date changes | Fixed | `admin/ar/005` |
| 3.8 "1 actions"; pitch as "Client"; staff band "49–10"; masculine history lines; discussion box starts left | Fixed | `admin/en/071`, `admin/ar/071`, `admin/ar/006`, `admin/ar/019`, `lead/ar/042` |
| 3.8 two Arabic spellings of the name | Partly: "صِلَة" left in `/legal/privacy` and `/legal/ai` | `public/ar/82`, `83` |
| Signed-out row 46: invitation mail names organisation and role | Still true (code) | `mail-templates.ts` l. 44–45 |
| Signed-out row 53: drop "Sign in" from the upload header; fix the file-type line | Header fixed (seen); line fixed in code, live page not seen | `public/ar/90`, `upload-form.tsx` |
| Signed-out marks: subtitle above "حسابك جاهز"; future tense after "sent"; English step "About you"; Latin-only wordmark | Still true (not in #153) | `public/ar/04`, `12`, `en/72` |

## The lead's two points

**1. Two language switches on the in-app Not found: confirmed.** See F1. Seen for all six firm accounts in both languages and at 768. The labels also differ ("EN" against "English", "عربي" against "العربية").

**2. Indicator page, firm side, the banner: fine for the firm.** It reads «هذه الأرقام يبلّغ عنها العميل وليست أثرًا موثّقًا. تغيّر المؤشر ليس دليلًا على أن توصية ما هي السبب.» / "These figures are reported by the client and are not verified impact. A change in an indicator is not proof that a recommendation caused it." For the firm, "reported by the client" is the right subject, it judges nothing, and it uses the decided word "موثّقًا". Same text for admin, lead, deputy, consultant and the observer (`admin_at_mizan.test/ar/081-…-full.png`, `…/en/081-…`). On #167's build the firm's notice line is "Figures reported by the client, not verified impact." / «أرقام يبلّغ عنها العميل، وليست أثرًا موثّقًا.», also fine (`check-indicator/lead_at_mizan.test/ar/001-notifications-1280.png`). Two things next to it weaken it, neither blocking: the "أفضل / أسوأ من خط الأساس" chip just below (N8b, for phase 3), and on #167's data "نحو المستهدف ‎-45.5%" when the value moved away (`check-indicator/lead_at_mizan.test/ar/002-indicators_1f0dfa02-1280.png`), a negative "toward" number that reads oddly. Small: the same disclaimer has a second wording on `/indicators/data` («هذه أرقام يعلنها العميل من سجلاته…»).

## 4. Open questions for Fahad

1. **Agenda language (F2):** should the agenda follow the reader's page language (headings and status words translated, titles as written), or stay in the meeting's language as the code now says on purpose?
2. **One Arabic verb for "release" (F4):** "إرسال إلى المسؤول", "إسناد" or "إصدار"? The draft line, the next-step button and the add dialog should use the same one.
