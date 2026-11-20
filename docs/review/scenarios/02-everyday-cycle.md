# Scenario 2. The everyday cycle, done right

Copy A (`--full`), Arabic, 20 Nov 2026 (Friday). Accounts: owner@sahm.test (the Sahm action owner the cast names; created in scenario 1, lead decision), Turki, Majed. English re-run belongs to copy D, not done here.

**PRIVACY findings:** none.

**Result: passed with friction.** The two-sign-off rule works as the scenario requires (Turki cannot give the second one; Majed can; owner told). Reports could not be compared for the same number (see step 9).

| # | Who | Step | Result | Clicks | Time | Screenshot | Notes |
|---|---|---|---|---|---|---|---|
| 0 | Majed | Client Setup tab, «الاعتماد الثاني للأدلة» set to «الأعمال ذات الأولوية العالية» | PASS | 2 (plus opening) | 12 s | shots/02/00.png | The Sahm client admin has **no** Setup page (it says «غير موجود»), so only the firm can set the rule: the plan expected either. The change shows who changed it and when. |
| 1 | owner | Home row «بدء العمل», then the action page | PASS with friction | 2 | 3 s + 2 s | shots/02/01.png | The home button «بدء العمل» only **opens** the action page; a second click on «بدء العمل» there starts it. Then there is one solid button, «إرسال للمراجعة», plus «عندي عائق» and «أحتاج وقتًا أطول». |
| 2 | owner | Progress note | PASS | 2 | 7 s | shots/02/02.png | Appears in «النقاش» marked «ملاحظة تقدّم». The tick «هذا تحديث عن سير العمل» is off by default. |
| 3 | owner | Two evidence files (D1 weak saved without sending, D3 good sent for review now) | PASS | 1 + 3 | 12 s + 9 s | shots/02/03.png | One file per dialog. The send button changes name with the choice (حفظ دون إرسال / إرسال للمراجعة). Both files are in the history with who and when. Scan status in the database: `clean` (not skipped). The owner's next step reads «عند المستشار منذ 20/11/2026. ويتحقق منه مستشار ثانٍ أيضًا.» The owner's view does not show a scan result; the reviewer sees both files, including the weak draft, with no hint which is the real evidence. |
| 4 | Turki | Home row «مراجعة» | PASS | 1 | 4 s | shots/02/04.png | Next step shows «اعتماد (الأول من اثنين)» and «طلب تعديل» and the text «يحتاج هذا العمل إلى اعتمادين». |
| 5 | Turki | First sign-off | PASS | 2 | 13 s | shots/02/05.png | Dialog explains another consultant must also verify. Afterwards: «تم اعتماد واحد من اثنين ... من يمكنه إعطاء الاعتماد الثاني: ماجد السبيعي». It left Turki's home review list. |
| 6 | Turki | Look for the second sign-off | PASS | 0 | – | shots/02/05.png | Not offered to him. |
| 7 | Majed | Second sign-off and verify | PASS | 3 | 27 s | shots/02/07.png | Dialog: «أنت المستشار الثاني ... ويُبلَّغ المكلَّف به». Status shows «تم التحقق». History lists the first sign-off, the second, the status change. |
| 8 | owner | Home and bell | PASS | 0 | 9 s | shots/02/08.png | The action is folded under «منتهية (1)»; bell: «قُبل الإجراء ... وتم التحقق منه». **Mail:** held until Sunday 22 Nov 07:00 (Friday, quiet hours). I released that one queued row by setting `next_attempt_at = now()` in my own database to check the content: «تم التحقق من إنجاز إجراء / An action was verified» with a working link, Arabic then English. |
| 9 | Majed | Same number in four places | PASS (partly) | 7 | – | shots/02/09client.png, 09progress.png | Project header «تحقّق المستشار من 1 من 9 (11%)»; Progress tab «تم التحقق 1 من أصل 9 ... 11%»; client page «المنفَّذ 11% ... 1 من 9» and per-department rows (Operations 1 of 3, 33%); projects list «مُتحقق: 1». All agree. **The monthly report could not be compared:** the status pack the daily job made (`npm run job:status-packs`, 4 drafts) covers October, before any Sahm work existed, so it cannot show today's verified action. |
| 10 | hr | EICAR string as evidence on a second action | PASS | 3 | 10 s | shots/02/10.png | Refused with «رصد فاحص الفيروسات مشكلة في الملف ولم يُحفظ»; no document row. Method note: a test file written to disk was deleted by the laptop's antivirus and the upload then showed the generic «لم تنجح العملية. أعد تحميل الصفحة وحاول مجدداً» — that was my harness, not the app; the second attempt built the string in memory. The same action requires choosing which evidence-list item the file answers before the save button works; once the one item is answered the chooser disappears. |

## Four answers
1. Could a real person do this without help? Yes. The owner always saw one next step; the two consultants saw the decision they were asked for.
2. Anything break, lose data, or show the wrong thing? No. Friction: "Start work" on home is two clicks; the monthly report can only show last month.
3. Did Selah act like the consultant? No. It asked for the second human; it never signed.
4. One change: make the home «بدء العمل» button start the work (or label it «افتح»).
