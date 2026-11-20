# Scenario 5. Asking for more time, twice (copy B)

Copy B, Arabic, desktop. Salma (finance@nukhba.test), Noura (deputy@), Khalid. Actions *مراجعة حدود الصلاحيات المالية* (`fa23e5dd-…`, seed: one request pending) and *تحديث مصفوفة الصلاحيات ورفعها للمجلس* (`46a49bbb-…`, already moved once). Screenshots `shots/5/`.

| # | Who | Result | Clicks | Notes |
|---|---|---|---|---|
| 1 | Salma | PASS | 0 | Her page says «الموعد الجديد الذي اقترحته (02/12/2026) بانتظار رد المستشار.» Next step stays «إرسال للمراجعة». |
| 2 | Noura | PASS | 2 | Home, **بانتظار قرارك** row «تغيير موعد · اقتراح 02/12/2026 من سلمى الشهري», **اتخاذ القرار** opens the action; her request text and reason are shown with **موافقة** / **رفض**. **موافقة** is one click, no confirmation. Date moved to 02/12; Salma's page: «الموعد الجديد 02/12/2026، بموافقة نورة القحطاني في 20/11/2026.» Khalid's page keeps «كان موعده الأصلي 16/11/2026», «أُجّل مرة واحدة، بزيادة 16 يومًا على الموعد الأصلي», «متأخر 4 أيام عن الموعد الأصلي», and **سجل المواعيد** «16/11/2026 ← 02/12/2026». |
| 3 | Salma | PASS | 6 | **أحتاج وقتًا أطول** opens «اقتراح موعد جديد»; the date is a calendar popup (no typing), the reason is free text; **إرسال الطلب**. She sees «الموعد الجديد الذي اقترحته (16/12/2026) بانتظار رد المستشار.» Her home has no section «ردود على المواعيد التي اقترحتها» as the plan expected. |
| 4 | Noura | **FAIL** (the reason) | 1 | **رفض** declines at once. There is no reason box and no place to offer a meeting (the table holds only the requester's reason). Noura's only route is the discussion thread (I wrote «سلمى، لم نوافق على 16 ديسمبر… نقترح اجتماعاً قصيراً غداً…» there, 3 clicks). A decline cannot be taken back from the page. |
| 5 | Salma | PARTIAL | 0 | Her page says «لم يُقبل الموعد المقترح 16/12/2026، بقرار من نورة القحطاني في 20/11/2026.» The reason arrives only because Noura wrote it in the thread; Selah's own refusal carries none. Bell: `deadline.rejected`. |
| 6 | Khalid | PASS | 0 | Date history shows the original date, the approved move and the refusal (the refused request is counted as a request, the action counted "moved once"). |
| 7 | Noura (second action) | PASS | Salma 6 + Noura 2 | Salma asked for 20/01/2027, Noura approved: «أُجّل مرتين، بزيادة 21 يومًا على الموعد الأصلي». The firm list **تأجّلت مرتين أو أكثر** shows it «تأجّل موعده مرتين 20/01/2027». The client's page shows only «الموعد الجديد 20/01/2027، بموافقة نورة القحطاني»: one plain line, no history. The first action (moved once, one refusal) is not in the rule list, as it should not be (a refusal is not a slip). The status pack part is not checked here (see scenario 11). |

Console and server errors: none.

## Confusions
- The refusal has no reason or meeting offer in the product; the plan and the client expect one.
- Approve and decline are instant with no confirmation; a wrong click cannot be undone from the page.
- The date field is a calendar popup only.

## Four plain-words answers
1. Yes for Salma. Noura can decide in one click from her home, but cannot explain a refusal there.
2. Nothing lost. Original date stays recorded; the slip is flagged only after the second approved move.
3. No. The consultant decides each request.
4. Add a reason (and "offer a meeting") field to **رفض**, shown to the requester.
