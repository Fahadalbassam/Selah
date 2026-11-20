# Scenario 10. A steering meeting from booking to follow-ups (copy B)

Copy B, Arabic, desktop. Khalid, Mansour (sponsor@nukhba.test), Reem (manager@nukhba.test, "Reem (client)"). Meeting «اجتماع اللجنة التوجيهية الخامس» (`f195adb9-d498-4945-bc26-53f2f084f56b`). Screenshots `shots/10/`. M8 applies (follow-ups, not actions).

| # | Who | Result | Clicks | Notes |
|---|---|---|---|---|
| 1 | Khalid | PASS with friction | 8 for the whole booking (about 15 s of scripted time, a human 1 to 2 minutes) | **حجز اجتماع**: title, kind (لجنة توجيهية), date (calendar popup), time, 60 minutes, online call, link, attendees (Mansour ticked; Reem ticked then unticked), «مشترك مع العميل» on. When Reem is ticked the form warns: «اجعله بدلًا من ذلك اجتماعًا للإدارة المعنية، أو أزل الاسم من الدعوة.» and offers **اجعله اجتماع أمانة مجلس الإدارة**. Friction: the call link only accepts Google Meet, Teams or Zoom addresses (my first test link on another host was refused with a red message that appears only at the foot of the form, below the **حجز** button's reach on a small screen). |
| 2 | Khalid | PASS | 1 | Toast «تم حجز الاجتماع». Mail to Mansour in Mailpit within 30 s: subject «دعوة اجتماع \| Meeting invitation» (Arabic + English), `invite.ics` attached (METHOD:REQUEST, 08:00Z for 11:00 local, correct). `/api/meetings/<id>/ics` returns 200 `text/calendar`. |
| 3 | Mansour | PASS | 0 | Before the meeting the page has the title, status «مجدول», **الانضمام إلى الاجتماع**, **إضافة إلى التقويم**, **سأحضر / ربما / أعتذر**, then the agenda and attendees. No summary, decisions or follow-ups cards. |
| 4 | Khalid | PASS | 0 | Agenda built by itself: «بانتظار المراجعة: عرض المسودة على المجلس واعتمادها» and «ما تغيّر منذ الاجتماع السابق» (eight items with their state). There is no «متأخرة» group because none was late any more after scenarios 3 to 5 (I had cleared them). |
| 5 | Khalid | PASS with a workaround | 2 | **تأكيد انعقاده** shows only once the start time has passed (code: `scheduled && started`). I booked it for 25 Nov, so I edited the date and time to today 01:30 (the time had passed) through **تعديل أو تغيير الموعد** (PATCH 200, `sequence` 1), then pressed **تأكيد انعقاده**. A real meeting day would not need this. After "held" the page keeps the agenda first and the summary box below it, so the summary is not "the main card". |
| 6 | Khalid | PASS with a confusing switch | 4 | Wrote the summary, **حفظ واعتماد**: «تم اعتماد الملخص», but the card then said «خاص بالمكتب» (firm only). The switch beside the language list is labelled «خاص بالمكتب» but ON means shared; I opened **تعديل الملخص**, switched it ON, saved: card now «مشترك مع العميل». The label never changes, so a consultant can easily publish or withhold the wrong way. |
| 7 | Khalid | PASS | 6 | **تسجيل قرار** ×2 (text, owner of the decision, shared switch already ON). Decisions listed 1 and 2 with «بقرار من …»; the form says decisions are not edited, a new one replaces. |
| 8 | Khalid | PASS | 14 | **إضافة متابعة** ×3 (title, assignee, due date by calendar popup, **إضافة**); one assigned to Reem, two «غير مسندة». No conversion to an action (M8): follow-ups are separate items with **تمت**. |
| 9 | Reem | PASS | 0 | Home **متابعاتك**: «إرسال مسودة الميثاق النهائية لأعضاء المجلس · حوكمة مجلس الإدارة · يستحق في 30/11/2026 · فتح». Reem opening the meeting URL directly: «غير موجود» (this is a whole-project meeting and she has limited access, as designed). |
| 10 | Mansour | PASS | 0 | Sees summary (shared), the two decisions, the three follow-ups, attendees. No firm-only notes, no transcript card. |

Server and console errors: none.

## Confusions
- Call link rule and its error placement; the **تخصيص** audience link and the warning about Reem both sit in a long form.
- Summary switch label.
- After the meeting the order of cards is unchanged (agenda first).
- Time zone and 24h: time field shows «11:00 AM» in an Arabic screen.

## Four plain-words answers
1. Yes, a consultant can do all of it. The summary visibility switch needs care.
2. Nothing lost; the client side saw only shared items; Reem was refused the whole-project meeting.
3. No. The agenda is built from records, never from judgement.
4. Rename the switch to «مشاركة مع العميل» and move the summary above the agenda once the meeting is held.
