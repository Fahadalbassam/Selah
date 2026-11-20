# Scenario 6. The lead leaves: a planned handover (copy B)

Copy B, Arabic, desktop, run after 10, 11, 21. Sara, Khalid, Noura, Reema (new), Fahd, Reem. Screenshots `shots/6/`. M3 and M4 apply (the notices are built).

| # | Who | Result | Notes |
|---|---|---|---|
| 0 | Sara | PASS | **الفريق > دعوة شخص** (name, e-mail, role consultant): mail «دعوة للانضمام إلى صلة / You're invited to Selah» with a 7-day link. Reema opened it, set a password, signed in, accepted the three notices on **قبل أن تبدأ**, landed on a welcome home. Then **إضافة مستشار** on the Al-Nukhba page: she picks Reema by name; Reema has the client in her list and is told (`client.assigned`). |
| 1 | Khalid | NOT RUN (seed state used) | The seed already holds one review that waits for a second sign-off (*عرض المسودة على المجلس…*, shown to Khalid and Noura under **بانتظار مراجعتك**). I did not add Omar's first sign-off. |
| 2 | Sara | PASS | Al-Nukhba **الأشخاص**, **⋯** on Noura > **تعيين مسؤولاً**: dialog «تعيين نورة القحطاني مستشارًا رئيسيًا» tells her who is notified and has a **ملاحظة التسليم** box. After saving: Noura **مسؤول**; the handover card «كتبها سارة العتيبي… عند انتقال العميل من خالد الشمري… لفريق المكتب على هذا العميل فقط، ولا يراها العميل.» Then **⋯** on Reema > **تعيين نائباً** (confirm box «هل تريد تعيين هذا المستشار نائباً؟… يبقى المستشار الرئيسي هو المسؤول.», **متابعة**): Reema **نائب**. (Two attempts were needed because the first click of a menu item opened nothing while the page was loading.) |
| 3 | Fahd | PASS | Bell: «المستشار الرئيسي لشركتكم لدى المكتب الآن هو نورة القحطاني». |
| 4 | Khalid | PASS | Bell: «انتقلت قيادة شركة النخبة القابضة إلى نورة القحطاني، وأصبح المستشار الرئيسي له…». |
| 5 | Sara | PASS with a note | **الفريق > إجراءات لـ خالد الشمري > إيقاف الحساب**: the holdings list loads after about 8 s (first it shows only the intro); it then said «لا يحمل هذا الشخص شيئاً يحتاج إلى تسليم.» Because the lead change had already moved his client, and his review can be done by Noura, there was nothing to list; the box that names «مراجعات لا يقوم بها غيره» did not appear. |
| 6 | Sara | PASS | Reason typed («غادر الشركة بعد تسليم العميل»), **إيقاف**; the team list shows «موقوف: غادر الشركة بعد تسليم العميل». |
| 7 | Khalid | PASS | His saved session: reload the board project URL, the home and `/api/...`: redirected to the sign-in page at once (pages) and `401 unauthenticated` (API). |
| 8 | Noura | PASS | Her home lists *عرض المسودة على المجلس واعتمادها* under **بانتظار مراجعتك** (the review Khalid held) and the two meetings. Meetings Khalid organizes (steering meeting 4, the one I booked) still name him as organizer; nobody is prompted to take them over. |
| 9 | Sara | PASS | Audit log: «تسمية المستشار الرئيسي لشركة», «تعيين نائب للمستشار الرئيسي», «إضافة مستشار إلى فريق شركة», «إيقاف حساب», invitation sent and accepted, each with person and time. |
| 10 | Fahd, Reem | PASS with note | Fahd got the bell notice only (and a held mail for Sunday). Reem got nothing (only client admins are told); her **المساعدة > مستشاروك** lists Noura (lead), Reema (deputy), Omar, so she can find out, but she is not told. The handover note is firm-only. |

Errors: none in the console. 

## Four plain-words answers
1. Yes for Sara. The suspend dialog loads slowly and then says there is nothing to hand over.
2. Nothing lost; Khalid was cut off at once; the client admin was told; managers were not.
3. No: Sara chose lead and deputy; the app only notified.
4. List meetings the leaver organizes in the suspend dialog.
