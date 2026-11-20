# Scenario 9. Someone leaves the client company

Copy A, Arabic, 20 Nov 2026. Accounts: Sahm admin (admin@sahm.test, نوف الحمدان), hr@sahm.test (هالة الخالدي, owner of four actions and head of the HR department), ops@sahm.test (ناصر الرشيد), Turki, Majed.

**PRIVACY findings:** none.

**Result: passed with friction; one expectation not met (who is told).** The work is not lost and the admin did it herself without asking the firm (decision D1 works). But only the new owner is told.

| # | Who | Step | Result | Clicks | Time | Screenshot | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Sahm admin | People, row menu on hr, «إيقاف الحساب» | PASS | 2 | 3 s | shots/09/pre.png | The row menu is «إجراءات لـ هالة الخالدي». The dialog first shows only the title and reason box; the list «إجراءات مفتوحة يملكها (4)» with the four actions and their status appears after about 4 seconds (a person who is fast might think nothing is listed). |
| 2 | Sahm admin | «التسليم إلى», type a name, «تسليم» | PASS | 3 | 12 s | shots/09/01.png, 02b.png | One choice hands all four at once to ops. The list then empties. No confirmation message was visible in the dialog afterwards. |
| 3 | Sahm admin | HR department head | PASS with friction | 9 | 39 s | shots/09/02b.png | The dialog lists «إدارات يرأسها (1) سمِّ بديلاً مؤقتاً: الموارد البشرية» and says «سمِّ رئيساً جديداً من صفحة الإدارات», but offers no control: the «إيقاف» button stays disabled until the admin leaves the dialog, adds a person to HR on the Departments page, makes him head, comes back to the People page, and opens the dialog again. The wording «سمِّ بديلاً مؤقتاً» looks like a button but is a label. After that, «إيقاف» with a reason worked and the list shows hr as «موقوف: استقالة من الشركة». |
| 4 | Turki | Bell and action page | **FAIL against the plan** | 0 | 6 s | shots/09/04.png | The plan says the new owner, the old owner, Turki and the lead are told. Database and screens agree: only **ops** got four «أُسند إليك الإجراء» notices (`action.assigned`). **Turki, Majed and hr got nothing**, and the action's History does not show an «owner changed» line (the page shows the new owner in the side panel only). The notification kinds in the last minutes were only `action.assigned`, `action.verified_complete`, `indicator.due`, `report.pack_drafted`. |
| 5 | Sahm admin | What is left | PASS | 0 | – | shots/09/pre.png | People page shows hr as «موقوف»; ops's action list shows 9 (his own 4, hr's 4, owner's 1 in his department); no action without an owner. An already open session of hr was sent to the sign-in page on the next click (access ended at once). |

Note: hr's action list still contains the test file `t2.txt` that I uploaded in scenario 2 step 10 (a test string, scanned `clean` because my harness first sent a version without its backslash; harmless text).

## Four answers
1. Could a real client admin do this alone? Yes, once she discovers she must leave the dialog to name a new HR head.
2. Anything break or leak? Nothing lost. The lead and the consultant on the project were not told that a client person left and that owners changed.
3. Did Selah act like the consultant? No.
4. One change: put the «name a new head» control inside the departure dialog, and send the owner-changed notice to the lead and the project's consultants.
