# Scenario 4. A blocked action and an accepted risk (copy B)

Copy B, Arabic, desktop. Action *ترشيح الأعضاء المستقلين للجنة* (`8b0f1f04-d7b0-464a-a8ae-b947dc865ff6`), owner Mansour. Screenshots `shots/4/`. M15 applies: the stale rule is "no change, no progress note, no evidence for N days", and on a fresh seed everything was touched today.

| # | Who | Result | Clicks | Notes |
|---|---|---|---|---|
| 1 | Mansour (sponsor@) | PASS | 0 | Plain next step «متعثر: بانتظار موافقة الجمعية العامة على مكافآت الأعضاء المستقلين» with **استئناف العمل**, **أحتاج وقتًا أطول**, **اسأل المستشار**. **عندي عائق** is not offered again. Header shows «يحتاج متابعة», «متعثر», «متأخر: كان موعده 14/11/2026». |
| 2 | Khalid | PASS | 0 | Same block reason, and «عند العميل.» (the ball is with the client). The firm filter **متعثرة** lists it (count 1). |
| 3 | Sara | PASS with a workaround | settings 3 | Settings is `/settings` (not in the sidebar for the firm admin; reached from the user menu). I set **راكد بعد** (stale days) to 1 as M15 says: list **بلا نشاط** stayed empty because every seeded action had been touched today. I restored 14 and instead made the action 15 days old in the database (`updated_at`, triggers off, a test harness shortcut that I name here). The list then showed the action with «متأخر 6 أيام · متعثر · بلا تغيير منذ 15 يوماً». The action page itself shows no stale marker (only the list does). The settings change is in the audit log. |
| 4 | Fahd (admin@nukhba) | PASS with friction | 5 | **⋯ > قبول مخاطر عدم إكماله** opens «قبول المخاطر». The statement box looks prefilled but only shows a grey hint («لماذا تقبل شركتكم عدم تنفيذه…»); **توقيع** stays disabled until text is typed and the box «أقبل مخاطر عدم إكمال هذا الإجراء نيابةً عن شركتي» is ticked, with no message saying why. Saving takes about 3 s with «جار الحفظ…». Offered to client admin (Fahd), client managers (Mansour, Reem); **not** offered to owners (Salma, Abdullah see only «كتم البريد»). The firm team (Khalid, Noura, Omar) got `risk.accepted`. |
| 5 | Khalid | PASS | 4 | **⋯ > إغلاق الإجراء**, choose **قُبلت المخاطر** (the dialog explains each outcome), a note, **إغلاق الإجراء**. Status `closed`, outcome `risk_accepted`. The action page shows the signed acceptance (Fahd's name and text) under **قبول المخاطر**. |
| 6 | Khalid | PASS | 0 | Project chips: **متأخرة** 3 to 1 (the other drop is scenario 3's verification), **متعثرة** gone. The «status pack lists it under قبول المخاطر» part is checked in scenario 11. |
| 7 | Sara | PASS with a note | 1 | Audit log lists «توقيع قبول مخاطر، بواسطة فهد الدوسري» and «نقل إجراء من «متعثر» إلى «مغلق»، بواسطة خالد الشمري» with time and person. I did not open the details to read the statement text there; the statement is in `risk_acceptances` and on the action page. The "oversight" view: the action no longer shows in the **بلا نشاط** list once closed. |

Console errors: none. Server errors: none.

## Confusions
- The risk-acceptance statement field: placeholder looks like real text, and the disabled button gives no reason.
- Stale rule is invisible on the action page; only managers who open the rule list see it.
- Settings is hard to find for a firm admin.

## Four plain-words answers
1. Yes, though the client admin needs to know to type the statement and tick the box.
2. Nothing broke or leaked; owners could not accept the risk.
3. No: the client signed, the consultant chose the outcome.
4. Disable reason text on **توقيع**, or prefill the statement.
