# Scenario 21. A file and a meeting kept from one person (copy B)

Copy B, Arabic, desktop. Khalid, Fahd (admin@nukhba), Reem (manager@), Salma (finance@), Mansour, Abdullah (owner@), Omar. Files D11a `restructuring-proposal.docx`, D11b `salary-bands.xlsx`; the seeded deliverable «مقترح إعادة تنظيم أمانة مجلس الإدارة.docx» (left out: Reem). Screenshots `shots/21/`. M20 applies. Checked as each person: project page, project Files tab, project Meetings tab, plan and progress tabs, Actions, Deliverables, Help, the sidebar **الملفات** panel (with its search box), the bell (notification list) and Mailpit.

**PRIVACY findings: none.** Nobody left out found anything, not even a count.

| # | Who | Result | Notes |
|---|---|---|---|
| 1 | Khalid | PASS | Upload dialog: **العميل والمكتب**, then **تخصيص** opens **كل من له صلاحية، عدا…**; typing «ريم» offers «ريم الحربي» (client side) as a chip; the line says «يراه: الجميع عدا شخص واحد». Needed a click elsewhere to close the suggestion list before **إضافة ملف** would take the click (a scripted click was blocked by the open list). The file shows **جمهور محدود** on his Files tab. |
| 2 | Reem | PASS | The file is absent from: the project Files tab (2.0 KB page, no hit for «restructuring»), the **الملفات** panel and its search («لا توجد ملفات تطابق البحث» for «restructuring» and for the seeded Arabic title), Actions, Deliverables, the plan and progress tabs, the Meetings tab, the bell, and Mailpit (no mail to her). No «hidden item» line and no count. The assistant was not asked: neither file is allowed for the assistant, so it could not answer from them in any case. |
| 3 | Khalid, Fahd | PASS | Both see the chip **جمهور محدود** on the file; Khalid's **من يراه** dialog says «يراه: الجميع عدا شخص واحد» with **تخصيص** and the chip «ريم الحربي»; the dialog says «لن يُبلَّغ من تُبعدهم». (Fahd sees the seeded deliverable too, with its marker.) |
| 4 | Fahd | PASS with friction | Client upload dialog has **العميل والمكتب** / **شركتك فقط**, a department list, and **تخصيص**. In **هؤلاء فقط…** Fahd is already in the list as a locked chip. Typing «سلمى» finds nobody («لا يوجد من يطابق») while the file's department is "company-wide": an action owner does not see company-wide files, so she is not offered. After classifying the file under **الإدارة المالية**, Salma is offered; saved. The dialog keeps saying «يبقى فريق المكتب على هذا العمل ممن يرونه. لإخفاء ملف عن المكتب اجعله خاصًا بشركتك.» so the firm (Khalid, Omar) still sees it with the marker, as M20 says (Omar's search found it). |
| 5 | Salma, Reem | PASS | Salma finds it (Files tab, and the panel search) with the **جمهور محدود** marker. Reem, Mansour and Abdullah find nothing. |
| 6 | Fahd | PASS | The UI offers no way to leave out the firm team on a shared file. Server probes (as Fahd, signed in): except-list naming Khalid refused 400 «on your company's own items, choose among your company's people»; only-list adding Reem refused 400 «pick only people who can already see it»; only-list naming Omar (a firm person who can already see it) accepted 200. |
| 7 | Fahd | PASS | `PUT /api/documents/<id>/audience` with `{"mode":"only","people":[]}` returns 400 «an "only" list needs at least one person». With a list that omits him (`people:[Salma]`) the server returned 200 and put him back in (his own row is always kept). |
| 8 | Khalid | PASS | Booked «اجتماع مجلس مغلق: إعادة التنظيم» with **تخصيص > هؤلاء فقط…**: the panel shows «يراه: فقط 5 أشخاص» (organizer, firm admin, deputy, client admin, Mansour) with the note «أنت من يحدد من يراه، فلا يمكن استبعادك.» Booked; the card shows **جمهور محدود**; only Mansour got the invitation mail. |
| 9 | Reem, Omar | PASS | The meeting URL says «غير موجود» for both; it is not on their Meetings tab, home, Files panel, bell or Mailpit. The firm's Omar (on the project) is left out too. |
| 10 | Khalid | PASS | Seeded deliverable: **من يراه > تخصيص**, removed the «ريم الحربي» chip, **حفظ**: `PUT …/audience {"mode":"everyone"}`. Reem then finds it in her Files panel and project Files tab with no marker, no bell item and no mail about the earlier restriction. |
| 11 | Sara | PASS | Audit log lists «تغيير من يرى ملفًا» (Khalid and Fahd, five entries), «تغيير من يرى اجتماعًا» (Khalid), uploads and meeting bookings. Each entry stores counts only (`{"to":"only","from":"everyone","people":2,"withdrawnMails":0}`), no names. |

Console and server errors: none.

## Confusions
- The suggestion list stays open and blocks the **إضافة ملف** button until you click elsewhere.
- Salma cannot be added to a company-wide file; you must first choose her department. The dialog does not say so; the list just says nobody matches.
- «شركتك فقط» keeps the firm out; the "only" list never does. The note says so in a small line.
- The audit log row for the audience change gives no names, so Sara cannot see who was left out (by design).

## Four plain-words answers
1. Mostly. The choice of "who" needs an explanation for the department rule.
2. Nothing leaked and nothing broke. The client admin cannot be left out.
3. No.
4. When search finds nobody, say why (the file is company-wide; choose a department).
