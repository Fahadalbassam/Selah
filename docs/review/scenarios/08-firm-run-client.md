# Scenario 8. A firm-run client with no accounts (Al-Waha)

Copy A (`--full`), Arabic, 20 Nov 2026. Accounts: Majed (lead of Al-Waha), Sara (adds Turki), Turki (second consultant). File: `ميثاق-عربي.docx` (D4, Arabic only, 37 KB). The project is the seeded «ميثاق العائلة»; the action is «تشكيل مجلس العائلة» (owner typed name «ماجد الواحي (مدير المكتب)»).

**PRIVACY findings:** none.

**Result: passed with friction.**

| # | Who | Step | Result | Clicks | Time | Screenshot | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Majed | Start the action; post a discussion note with «هذا ما أبلغك به العميل», choose how (e-mail) and when (today) | PASS | 3 + 3 | 51 s | shots/08/01.png | Ticking the box opens two fields: «كيف وصل من العميل» (in a meeting / by e-mail / by phone / in a document) and «تاريخ الوصول» (today by default). The posted note reads «استُلم من العميل بالبريد الإلكتروني في 20/11/2026» and is marked «ملاحظة تقدّم». The page says clearly «لا حساب للعميل في صلة، فلا يصله شيء مما يُكتب هنا». |
| 2 | Majed | «إرسال للمراجعة» with D4 and the same how/when | PASS | 4 | 62 s | shots/08/02.png | The same dialog has «كيف وصل من العميل» and «تاريخ الوصول» before the file. History: «إضافة ملف، بواسطة ماجد السبيعي … ميثاق-عربي.docx 37 KB» and «استُلم من العميل بالبريد الإلكتروني في 20/11/2026». The banner «يسجّل المكتب هذا العمل نيابة عن العميل» is on the page. The Arabic file name displayed correctly. Scan status clean (the dialog says every file is scanned). |
| 3 | Sara | Add Turki to the Al-Waha client team and project | PASS | 8 | 84 s | shots/08/03.png | Not part of the scenario text; needed. Same dialogs as scenario 1. |
| 4 | Turki | Open the action in review; «اعتماد» | PASS | 2 + 1 | 27 s + 7 s | shots/08/04.png | Two-step: «اعتماد» then «تأكيد» («القبول يجعل هذا الإجراء مكتملاً ومُتحققاً منه. يمكن للمستشار إعادة فتحه لاحقاً مع ذكر السبب.»). Status «تم التحقق». The history line «قبول الدليل، بواسطة تركي المالكي» names who reviewed. |
| 5 | Majed | Try to verify his own recorded evidence | PASS | 0 | – | shots/08/05.png | No approve or verify button is offered to him. The page says «لا أحد آخر في الفريق يستطيع مراجعة هذه الجولة، فسيراجعها مدير المكتب» (no one else on the team can review this round, so the firm administrator will). This is a reason, but it says the admin will review, not that Majed is not allowed to. I could not test the server refusal itself (the scenario forbids calling the API outside the isolation checks). |
| 6 | Majed | Report / project page | PASS (partly) | 0 | – | shots/08/06.png | The project page shows the typed owner names «ماجد الواحي (مدير المكتب)», the banner «يسجّل المكتب هذا العمل نيابة عن العميل» and «تحقّق المستشار من 1 من 2 (50%)». There is no family-charter report type in «تقرير جديد» (only «التقدّم الشهري», «ملخص اللجنة التوجيهية», «ملخص الإغلاق», or none), so I did not create one. |

## Four answers
1. Could a real consultant do it alone? Yes. The how/when fields appear where the firm needs them.
2. Anything break or leak? No. The action's owner is the typed name of a person at the family office; no account involved.
3. Did Selah act like the consultant? No; the second human verified.
4. One change: when the lead is the only recorder and no one else is on the team, say «اطلب من زميل المراجعة» on the action, not that the admin will review.
