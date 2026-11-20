# Scenario 16. A holding group (copy B)

Copy B, Arabic, desktop. Screenshots `shots/16/`.

**Sahm in this copy was created by me for the leak check, as the coordinator decided (minimal):** the public form `/inquiry` (4 steps, privacy box required) made INQ-1A0E3E05 «شركة سهم للخدمات اللوجستية»; Sara assigned it (Majed), triaged it, ran and recorded the conflict check, qualified it, booked and recorded a discovery session, recorded the NDA, marked the proposal sent and pressed **تحويله إلى عميل** (new client, lead Majed, engagement «اتفاقية خدمات الهيكل التنظيمي», signed 20 Nov); then she invited admin@sahm.test (client admin) who created the account from the mailed link (Arabic then English body) and accepted the three notices. No other Sahm accounts, no projects. Intake steps were in a clear order, but each needed several clicks and, on the first click of many dialogs, nothing happened until the page had finished loading.

| # | Who | Result | Notes |
|---|---|---|---|
| 1 | Sara | PASS | **العملاء > مجموعات العملاء > مجموعة النخبة** (Al-Nukhba Group): «التقدّم على مستوى المجموعة», members شركة النخبة القابضة (الشركة القابضة) and النخبة للتطوير العقاري (linked). |
| 2 | Sara | PASS | Group 22% = 2 of 9 verified; parts: holding 2 of 8 (25%, 4 open), subsidiary 0 of 1 (0%, 1 open). 2+0 of 8+1; the holding's own page shows 25% and 2 of 8, the subsidiary 0 of 1. |
| 3 | Sara | PASS | **إلغاء الاطلاع** (confirm **متابعة**) made Fahd's **مجموعتنا** row disappear; **منح الاطلاع** (pick «فهد الدوسري · مدير حساب العميل») brought it back. The dialog says «يرى الأعداد لكل شركة، لا سجلات الشركات.» |
| 4 | Noura | PASS with a note | She sees both members because she is deputy of Al-Nukhba and lead of the subsidiary; so "her member client only" holds only in that she sees no one else's. Group notes are shown to the firm. |
| 5 | Fahd | PASS | **مجموعتنا** shows group progress and per-company counts only; the firm-only notes («للمكتب فقط») and other clients' work are not there. |
| 6 | Rawdah admin, Sahm admin | PASS | Group URL, both Al-Nukhba client URLs: «غير موجود». Al-Nukhba's admin on Rawdah and Sahm client URLs: «غير موجود». `/assistant` for Rawdah's admin and Sahm's admin: «غير موجود» (closes scenario 13 step 16). All pages answer HTTP 200 with the not-found text inside. |

Errors: none.

## Four plain-words answers
1. Yes for the group; the intake chain is long but clear.
2. No leak, numbers add up.
3. No.
4. Fewer dialogs for intake; and make a first click wait for the page rather than vanish.
