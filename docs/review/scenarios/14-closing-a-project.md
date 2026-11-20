# Scenario 14: closing a project properly (copy C, Arabic, 1280 px)

Copy C, 20 Nov 2026. Dev server, so page times are 5 to 30 s (first hits much longer); not production figures.

**PRIVACY findings:** none. Lessons stay firm-only (the closure PDF carries no lessons; Hind's closing tab shows none).

**Result: PASS with friction.**

**Deviation (M2):** scenario 18 had already pressed **إيقاف الإغلاق** on the seeded Rawdah project, so the seeded "closing" state was gone. 14a was run from "Hind asks" instead of from the seed. The closing tab is called **الإغلاق** (as in the plan); my first failure was my selector (text click works, role "button" did not after a reload). Real finding: on an **active** project the **الإغلاق** tab is not shown at all; **بدء الإغلاق** is only in the «المزيد لهذا المشروع» (three dots) menu. The tab appears after Hind's request or once closing starts.

## 14a: Rawdah "Strategic Plan 2027" (project f44b4a7c)

| # | Who | Step | Result | Screenshot | Notes |
|---|---|---|---|---|---|
| 1 | Hind | Menu, only item **اطلب من المكتب الإغلاق**, note, **إرسال الطلب** | PASS | shots/14/02-hind-ask-dialog.png | The dialog says plainly that only the firm closes. Sara and Majed got `closure.requested`. |
| 2 | Majed | **الإغلاق** tab shows Hind's note, then **بدء الإغلاق** and confirm | PASS | shots/14/05-majed-closing-tab.png, 07-majed-closing-started.png | «بقي أمران للتسوية»: one open action needs a decision, lessons not written. «جولات سابقة» shows the earlier round (started and stopped the same day). |
| 3 | Sara | Try to close with something undecided | PASS (by absence) | shots/14/08-sara-closing-tab.png | There is **no «إغلاق المشروع» button** until everything is settled, so the refusal «لم يُقرَّر» cannot be triggered from the screen. Safe; the two-line list says what is left. |
| 4 | Majed | **قرّر** on the open action: **سُلِّم** to Hind, note | PASS | shots/14/09-decide-dialog.png, 11-decided.png | «بعهدة هند الزهراني». The person picker is the field «يُسمّى لاحقاً»; it does not look like a picker. |
| 5 | Majed | **تدوين الدروس** (three boxes) | PASS | shots/14/12-lessons-form.png | «سُوِّي كل شيء. يستطيع مدير المكتب إغلاق المشروع الآن.» Lessons from the earlier round are not carried over; each round starts empty. |
| 6 | Hind | Case-study consent **دون ذكر الاسم** | PASS (given in the seed, survived Stop closing) | – | |
| 7 | Sara | **إغلاق المشروع**, confirm «هل أنت متأكد؟ … تُحذف محادثات المساعد بعد 90 يوماً» | PASS | shots/14/14-sara-close-confirm.png, 15-sara-closed.png | Banner «هذا المشروع مغلق وللقراءة فقط.»; the tab then offers **تقرير الإغلاق (PDF)** and **إعادة فتح**. Hind and Majed got `project.closed`. |
| 8 | Sara | **تقرير الإغلاق (PDF)** | PASS | shots/14/17-closure-pdf-1.png | Arabic page: counts (5 actions, 4 verified, 1 open at closing), the handed-over action with «بعهدة هند الزهراني» and its note. `pdftotext` shows broken Arabic (font mapping); the rendered page is correct. |
| 9 | Sara | **إعادة فتح** with **سبب إعادة الفتح** | PASS with friction | shots/14/18-reopen-dialog.png, 20-audit.png | Project active again. Notice `project.reopened` went to **Majed only; Hind (client admin) got none** (the plan expected the people on the project to be told). The audit table has `project.reopen`; the audit page shows it under the generic group «المشاريع والاجتماعات والتقارير» (I did not open «التفاصيل» to read the reason). |
| 10 | Majed, Sara | Close again | PASS | shots/14/22-second-round.png, 23-closed-again.png | Second round needed a new decision and new lessons; the page still printed «كما طُلب» about the old request. |

## 14b: new Rawdah project "Trustee training programme 2027" (project 53b9c22f)

| # | Who | Step | Result | Screenshot | Notes |
|---|---|---|---|---|---|
| 1 | Majed | **مشروع جديد**, client Rawdah, title | PASS | shots/14/25-new-project-dialog.png, 26-new-project.png | Draft banner «مسودة: لا يرى العميل هذا المشروع حتى يشمله تعاقد موقّع». |
| 2 | Sara | Client page, **الإعداد**, **تسجيل تعاقد**, tick the project | PASS | shots/14/28-engagement-dialog.png, 29-engagement-filled.png | The project became **planned**. The plan's «ضمّ مشاريع» button is not on this screen; recording a new engagement is the route. |
| 3 | Majed | **الأشخاص**, **إضافة شخص**: Dana, Hind, Yousef | PASS with friction | shots/14/32-add-person.png, 33-people-added.png | The owner list in «إضافة إجراء» said «لا يوجد من يطابق» until people were on the project; one line at the bottom of the dialog explains it. |
| 4 | Majed | One recommendation and four actions | PASS with friction | – | The «إسناده إلى المكلَّف الآن» switch appears to be **on by default** once an owner and date are chosen; my click turned release **off** (three drafts), the one I left alone was released. The same happened in scenario 18. The switch state is hard to read. I released two with **إسناد إلى المكلَّف**. |
| 5 | Dana | Send a file on one action; **عندي عائق** with a reason on another | PASS | shots/14/34-blocker-dialog.png | States reached: awaiting review, blocked, open, draft. |
| 6 | Hind | **اطلب من المكتب الإغلاق** with a note | PASS | – | |
| 7 | Majed | **بدء الإغلاق** | PASS | shots/14/35-b-closing-started.png | Sara got `closure.lead_started`. Four actions «لم يُقرَّر». |
| 8 | Majed | **قرّر**: handed over, deferred, withdrawn, waived | PASS with friction | shots/14/36-withdraw-dialog.png, 37-b-decided.png | Reason is required for withdrawn and waived. The row order changes after each decision, so my dispositions did not land on the actions I had planned. The awaiting-review action still blocked closing («تسليم واحد بانتظار المراجعة»); Majed had to approve it (**اعتماد**, **تأكيد**), after which it is verified and the earlier decision is moot. |
| 9 | Majed | **تدوين الدروس** | PASS | – | «سُوِّي كل شيء». The consent line says «لا يمنع إغلاق المشروع». |
| 10 | Hind | **إعطاء الموافقة**, **دون ذكر الاسم** | PASS | shots/14/39-consent-dialog.png | Recorded with her name and date. Dialog asks the level, whether a quote is allowed (default «لا»), and conditions. |
| 11 | Sara | **إغلاق المشروع**, then the PDF | PASS with friction | shots/14/40-b-closed.png, 41-closure-pdf-b-1.png | The PDF says 3 project actions, 1 verified, 2 closed without full verification, 1 open at closing. That adds to 4, so the total is off by one (the deferred draft is counted as open but not in the total). |

## Four answers
1. **Without help?** Mostly yes. Hesitations: the hidden **الإغلاق** tab and the three-dots menu on an active project; why the close button is missing; the "release now" switch; the person picker «يُسمّى لاحقاً».
2. **Anything break or show the wrong thing?** Nothing shown to the wrong person. Possible bugs: the PDF count is off by one; no `project.reopened` notice to the client admin; the second round still says «كما طُلب».
3. **Selah acting like the consultant?** No. Each decision is a person's choice with a reason; closing needs the firm admin's confirm.
4. **One change:** make **بدء الإغلاق** a visible button on the project header (or always show the tab), and say on the tab why «إغلاق المشروع» is not yet offered.

**Not seen:** the refusal text «لم يُقرَّر» (the button is absent); "draft deleted per agreement" (the draft was deferred in my run).
