# Scenario 3. Evidence sent back twice (copy B)

Copy B, Arabic, desktop. Action *إعداد لائحة عمل اللجنة* (id `7875847f-96ad-4b2b-841a-8622983f9dcc`). Owner Abdullah (owner@nukhba.test), Khalid (lead@), Noura (deputy@) for the second sign-off. Files D2 `evidence-better.docx`, D3 `evidence-good.pdf`. Screenshots: `shots/3/`. Mismatch M14 applies: the seed already holds one send-back (by Omar) and the seeded file.

| # | Who | Result | Clicks | Time | Notes |
|---|---|---|---|---|---|
| 1 | owner | PASS | 0 (home) + 1 | 2.8 s | Home lists the action first with «إرسال الملف المعدَّل للمراجعة»; the action page shows the status **مطلوب تعديل**, the reason (by Omar) and his earlier reply. |
| 2 | owner | PASS | comment 2, send 4 (open dialog, pick evidence item, choose file, send) | 6.9 to 11.7 s | Comment «ما المطلوب بالضبط؟…» in **النقاش**. The send dialog makes the owner pick which evidence item the file answers (one combobox) and offers «إرسال للمراجعة الآن» or «حفظ دون إرسال». Status becomes **بانتظار المراجعة**; next step «عند المستشار منذ 20/11/2026.»; and the line «ويتحقق منه مستشار ثانٍ أيضًا». |
| 3 | Khalid | PASS | 3 (open, **طلب تعديل**, type a reason, **تأكيد**) | | Status **مطلوب تعديل**; the reason shows on the owner's page; `action.revision_requested` notification and mail created: mail «طُلب تعديل على إجراء / A revision was requested» reached Mailpit (sent after I made it due, see note A). |
| 4 | owner | PASS | 2 + 4 | | Sees Khalid's reason with name and time, replies in the thread, sends D3. The "evidence item" shows all three files side by side (seed file, D2, D3); each has a download link; Download check: the file I uploaded as version 2 downloads (HTTP 200, signed link); the seeded first file does **not** (HTTP 409 «this file has not been cleared for download»): the walkthrough seed stores its files with scan status `skipped`, and a `--full` copy (scanner required) refuses to serve them. So on this copy the seeded old version is listed but cannot be opened (seed artefact, not a product fault). History log lists every upload and both send-backs with time and who. The thread is one list on the action page. |
| 5 | Khalid | PASS with friction | see below | | **Not one step.** Khalid pressed **اعتماد (الأول من اثنين)** and the server answered 409; the dialog says in Arabic «اقبل كل بند في قائمة الأدلة أو أعفِ منه أولاً». He first has to press **قبول** on the evidence item (a spinner of 3 to 5 s), then sign. Because this is a critical-priority action under Al-Nukhba's rule, a second sign-off is also needed: Khalid signs first, Noura's page offers **الاعتماد الثاني والتحقق** and the action became `verified_complete`. Khalid cannot give both: after his sign-off the page says «تم اعتماد واحد من اثنين… يعطي الاعتماد الثاني مستشار آخر… عمر الزهراني ونورة القحطاني». |
| 6 | Khalid | PASS | 1 | | **الإجراءات → أُعيدت للتعديل مرتين أو أكثر** shows 1 (this action) after the second send-back. |
| 7 | owner | PASS | 0 | | While the action waited for the firm there was no reminder, no escalation and no mail to him; the next-step line said «عند المستشار.» |
| 8 | firm | PASS | | | `npm run job:follow-ups` (in `apps/web`) printed «4 notifications, 7 summary mails»: overdue reminders to finance@ and sponsor@ for their own late actions, none to owner@nukhba for this action. The reviewers were told when the owner submitted (`action.awaiting_review` to Khalid, Noura, Omar). The job also made `engagement.ended` notices for admin@mizan and lead2@ (finished engagements). |
| 9 | Khalid | PASS (cannot fully check) | 1 | | Project **التقدم**: «مراجعات طلبت تعديلات 50%», «تم التحقق من 2 من أصل 8 (25%)». With two send-backs and two verified decisions that is consistent with 2 of 4 reviews. The page does not show the numerator and denominator, so I could not prove it from the screen. |

Note A (mail): every "work" mail (assigned, revision requested, comment, verified) is held until the person's next sending time. Today is Friday 20 Nov, so all of it waits until Sunday 22 Nov 07:00 (Riyadh) (`outbound_emails.next_attempt_at`). Nobody tells the person this. I moved one row to "now" to read it. Real users will get the mail late on weekends, as designed (working days).

Errors: console clean; one 409 (above) is a normal refusal. Tool note: the action buttons ignore a click made while an earlier request is still running (a "قبول" spinner), so a fast reviewer may click sign-off before the item is accepted.

## Confusions
- Khalid has to accept the evidence item before he can sign; the sign-off button gives no hint on the page until it is pressed (error shows inside the dialog).
- "Waiting for the office" and "waiting for review" appear next to each other in the header (two badges) and read like duplicates.
- After a sign-off the history shows «قبول الدليل، بواسطة نورة القحطاني» for the item Khalid accepted first (the log shows the second signer for the acceptance step; check).

## Four plain-words answers
1. Yes for the owner: reasons, files and thread are in one place. The reviewer needs to know to accept the item before signing.
2. Nothing lost, nothing shown to the wrong person. Old versions kept. Mail held until Sunday (by design, but invisible).
3. No. Selah only carried the decisions the consultants took.
4. Let the reviewer sign and accept the item in one dialog.
