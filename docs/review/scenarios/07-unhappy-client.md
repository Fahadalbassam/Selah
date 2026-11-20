# Scenario 7. An unhappy client and a consultant switch (copy B, Arabic only)

Copy B, run after 13 and after scenario 6 (so the lead is already Noura, Reema is deputy and already on the project). Reem (client, manager@nukhba.test), Omar, Sara, Reema (firm). Screenshots `shots/7/`. The English run on copy D was not done. M4 and M6 apply.

| # | Who | Result | Notes |
|---|---|---|---|
| 1 | Reem | PASS | Sidebar **المساعدة**: she sees **مستشاروك**, **راسل إدارة المكتب** (text box and **إرسال الرسالة**) and the questions list, without scrolling much. A person who wants to complain would likely find it, but the page is a long help page and its first card is the consultant list. |
| 2 | Reem | PASS | Typed the complaint, **إرسال الرسالة** (2 clicks): «وصلت رسالتك إلى إدارة المكتب». The page says only management reads it (up to 5 a day). Omar's home does not show it. |
| 3 | Sara | PASS | Her home lists the message with the sender, company and address, and **تعليم كمُعالَج**. After she pressed it, Reem's bell shows «عالج المكتب الرسالة التي أرسلتها إلى إدارته». (The first **تعليم كمُعالَج** button on the home is for another seeded message; the button text does not tell which message it applies to when several are listed.) |
| 4 | Sara | PASS | Board project **الأشخاص**, **المزيد لـ عمر الزهراني > إزالة من المشروع**, confirm **متابعة** (DELETE 200). Reema was already on the project (made deputy in scenario 6), so no extra staffing was needed. Omar owned no open action. |
| 5 | Omar | PASS | Project URL and the action URL: «غير موجود» at once (page answers HTTP 200 with the not-found text). |
| 6 | Reema | PASS with a note | Her home lists the awaiting review (*عرض المسودة…*) and the date/request decisions. The action history still shows «طلب تعديل، بواسطة عمر الزهراني» under his name. Omar had no pending review of his own: the only review waiting was the one needing a second sign-off, and the form says «من يمكنه إعطاء الاعتماد الثاني: ريما السالم ونورة القحطاني». |
| 7 | Reema | PASS | Replied in the action thread of Reem's own action: Reem sees «أهلاً ريم، أنا ريما السالم وسأتابع معك من الآن بدلاً من عمر…». |
| 8 | Reem | PASS (gap recorded) | **المساعدة > مستشاروك** now lists Noura (lead), Reema (deputy); Omar is gone. No notice told Reem that her consultant changed; only the lead change is notified (to client admins). |

Errors: none.

## Four plain-words answers
1. Yes, but she has to know to look for Help; no button on her home.
2. Nothing leaked; Omar's access ended at once; his history stays.
3. No.
4. Tell the client's manager when her consultant changes, or put the "write to the firm" box on her home.
