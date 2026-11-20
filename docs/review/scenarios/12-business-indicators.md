# Scenario 12. Business indicators, a month at a time (Sahm part)

Copy A, Arabic, 20 Nov 2026. Only the Sahm half runs here (the Al-Nukhba half, Reem and Khalid, belongs to copy B; English belongs to copy D). Accounts used: Sahm admin, ops@sahm.test (manager), Majed (Sahm lead; used in place of Khalid), Leila (observer@mizan.test). File: `indicators-3-months.xlsx` (D7).

**PRIVACY findings:** none.

**Result: passed with friction.** Typing is quick (3 clicks), the import never overwrote, wording says the numbers are client-reported. Friction: the import is hidden until the client admin first chooses a data mode, and Leila had to be staffed as an observer on the project before she could be tested.

| # | Who | Step | Result | Clicks | Time | Screenshot | Notes |
|---|---|---|---|---|---|---|---|
| 1 | ops | Enter September 2026 = 88 for indicator 1 («إدخال قيمة») | PASS | 3 (open, pick period, save) + 1 to open the dialog | 12 s | shots/12/01.png | Quick. Shows «+3» change from the previous period and who entered it. (Reem's version of this step is copy B's.) |
| 2a | Sahm admin | Create three indicators: two from «ابدأ من مؤشر شائع» (التسليم في الموعد, شكاوى العملاء), one custom | PASS | 4 to 5 each | 11 to 15 s | shots/12/02.png | The common list fills name, unit, direction (complaints presets «الأقل أفضل»). I renamed them to the file's names. The «مؤشر جديد» button is on the home page only; after creating the first one the page did not show it until reloaded. |
| 2b | Sahm admin | Find «استيراد الأرقام» | PASS with friction | 3 | – | shots/12/02b.png | The import link appears **only after** the client admin chooses «ملفات تصدّرها وترفعها» on «كيف تصل الأرقام إلى صلة» (a card on home «تنتظر قرارك»). Even after choosing, the page showed no link until reloaded. A person looking for the import before that finds nothing. |
| 2c | Sahm admin | Upload D7, «قراءة الملف», match, «مراجعة الأرقام» | PASS | 4 | 9 s + 7 s | shots/12/03.png | Steps «الملف · المؤشرات · الأرقام». Layout «صف لكل مؤشر» detected itself; the three headings matched the indicators by name. Counts «جديدة 8 / تصحيحات 0 / دون تغيير 0 / مستبعدة 1». The September 91 row says «أُبقي (مختلف)». |
| 3 | Sahm admin | Save without «تصحيح الأرقام المختلفة» | PASS | 2 (save + confirm) | 14 s | shots/12/03d.png | A confirmation «حفظ 8 أرقام و0 تصحيحات؟» appears (the page's role is an alert dialog; my first click only opened it, so the first attempt looked like nothing happened). Afterwards the indicator shows September **88** (ops), October 93 and November 94 marked «من ملف». The old value stayed. |
| 4 | Majed (in place of Khalid) | «ربط» to a recommendation | PASS | 3 | 13 s | shots/12/04.png | Linked; text says the link does not claim the recommendation caused any change. The Sahm client admin sees **no** Link or Unlink buttons (shots/12/04b.png). |
| 5 | Leila | Open the indicator | PASS | 0 | 4 s | shots/12/05.png | She had to be staffed on the Sahm project first (Majed: client Team «إضافة مستشار», then project People «تكليف بالمشروع» as «مراقب»; 6 clicks). She then sees the indicator with no Enter, Edit, Correct, Link or other buttons. |
| 6 | everyone | Wording | PASS | – | – | shots/12/05.png | «هذه الأرقام يبلّغ عنها العميل وليست أثرًا موثّقًا. تغيّر المؤشر ليس دليلًا على أن توصية ما هي السبب.» on every view. No "better/worse" label; the page says «أعلى من خط الأساس» (above baseline), neutral. |
| 7 | (Reem's step, done by import instead) | Value past the baseline for the lower-is-better complaints indicator | PASS | – | – | – | The October value 19 against baseline 12 (lower is better) made the app tell **Majed** (the client's lead) once (`indicator.moved_away`, table `kpi_moved_away_log`), and not the admin who brought the file in, as the rules say. The status-pack job run by hand did not add more. |

## Four answers
1. Could a real person do it alone? Typing yes. The import: the admin must first find and answer the data-mode card, which is easy to miss.
2. Anything break or leak? No. The import did not overwrite.
3. Did Selah act like the consultant? No. Every screen says the figures are client-reported.
4. One change: show «استيراد الأرقام» (greyed, with a short reason) before the data mode is chosen, or choose the mode as part of pressing «استيراد».
