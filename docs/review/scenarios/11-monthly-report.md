# Scenario 11. The monthly report (copy B)

Copy B, Arabic then English PDF. Khalid (writer, sender), Noura (approver), Mansour (reader). New report «تقرير التقدم الشهري، نوفمبر 2026» (`abc5fb57-944a-41df-a400-72db9786f14d`); the seed already holds one shared report «تقرير المتابعة الشهري». Files and screenshots: `shots/11/` (`report-ar.pdf`, `report-en.pdf`, page images). M17 applies.

| # | Who | Result | Clicks | Notes |
|---|---|---|---|---|
| 1 | Khalid | PASS | 5 | **التقدم > تقرير جديد**; pick **التقدّم الشهري** (template fills a four-point note with «- …» bullets), title, period start (calendar), add a line to the note, **إنشاء التقرير**. The draft is «للمكتب فقط», «بانتظار الموافقة»; the numbers are frozen as of 20/11/2026. The dialog says a report cannot be edited after creation (correct by writing a new one). |
| 2 | Khalid | PASS | 2 | **إرسال إلى العميل** (the dialog takes 3 to 9 s to load on this dev copy): «قبل إرساله يوافق عليه المستشار الرئيسي للعميل أو نائبه أو مدير المكتب، ولا يوافق عليه من كتبه.» There is no send button for him. |
| 3 | Noura | PASS | 2 | **موافقة**, then a «هل أنت متأكد؟» box that says it cannot be undone (**متابعة**). Report says «بموافقة نورة القحطاني في 20/11/2026». |
| 4 | Khalid | PASS | 3 | **إرسال إلى العميل** now shows «بموافقة نورة…», who will see it («مديرو شركة النخبة القابضة ومسؤولوها… ولا يقرأ أصحاب الإجراءات التقارير») and «لا يمكن التراجع عن الإرسال»; **إرسال**: visibility `shared`. No bell notification and no mail goes to the client when a report is shared (checked in `notifications`, none of kind report). |
| 5 | Mansour | PASS with notes | home 0, then Projects > project > التقدم > report = 4 | The new report is listed under the project's **التقدم** tab, with the older one. It is not on his home page, so he must know to look there. About 20 s for a person. His page carries the caution «التقرير المشترك يحسب كل عمل المشروع المشترك، أما أرقامك أنت … قد يختلف الرقمان.» **Gap:** the report has no section that separates verified work from the client's own claims; it counts verified/partly done/risk accepted/etc. only. The shared note still carries the template's empty «- …» bullets (Selah let the consultant send an unfinished skeleton). |
| 6 | Khalid | PASS with defects | 1 + 1 | **PDF** exports in Arabic (RTL, 2 pages) and, after **EN**, in English (LTR, 2 pages). Numbers in both equal the screen (25%, 2 verified, 2 risk accepted, 4 open, 0 overdue, 2 moved, 37 days slipped). **Defects:** (a) the PDF header says «بواسطة خالد الشمري في 2026/11/19» and the English one «By … on Nov 19, 2026», while the screen says 20 Nov (written at 02:xx local, the PDF uses the UTC day). (b) The English PDF's notes are the Arabic template text (written Arabic), as expected, but the header mixes scripts. (c) Arabic PDF footer reads «سلة · نُشر من…» for the product name. Text extraction of the PDFs is not clean (Arabic shaping), the rendered pages are right (checked as images). |
| 7 | Khalid | PASS | 0 | Every number matches a count I can read: total 8; verified 2 (صياغة مسودة الميثاق, إعداد لائحة عمل اللجنة); risk accepted 2 (seeded one + scenario 4); open 4; overdue 0 (nothing past its current date); moved 2 (two actions) with 1 moved twice; days slipped 37 = 16 + 21; «1–30 days late against the original date» = 1 (مراجعة حدود الصلاحيات, 4 days past 16 Nov). 25% = 2 of 8. The project page shows the same 25%. |
| 8 | monthly job | PASS with a note | `job:status-packs` 1 run, **إصدار** 3 clicks | The job drafted 3 packs (one per project), titled «Status pack 2026-10» (English title on an Arabic screen), period October, «مسودة لا يراها إلا المكتب»; issuing needs another colleague's approval before sending. Because the period is October, the pack's «قبول المخاطر» and «تم التحقق» lists are empty (my scenario 4 and 3 events are November), so I could not check that the risk acceptance shows there. |

Console and server errors: none.

## Confusions
- Report visible to the client only from inside the project's **التقدم** tab; no notice reaches the client.
- Unfinished template can be sent.
- The date on the PDF differs from the screen late at night (UTC day).
- The pack is for the previous month while the figures are current ("the numbers update until you issue it").

## Four plain-words answers
1. Yes for the consultants (about 13 clicks end to end). Mansour needs to be told where to look.
2. Nothing broke. One wrong thing shown: the PDF date can be the previous day.
3. No. Two people decide (writer, approver) and the system only counts.
4. Tell the client when a report is shared, and refuse a send while the template still has empty «…» lines.
