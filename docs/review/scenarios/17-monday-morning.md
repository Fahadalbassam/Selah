# Scenario 17. A busy Monday morning (copy B, read-only baseline)

Run first on copy B (instance `scenb`, http://localhost:3050), before any other scenario changed data. Arabic, desktop 1440 px. Screenshots: `shots/17/`. Driven with Playwright, one signed-in context per account. Clicks counted from sign-in landing (home is the landing page). Page times are dev-mode (Next dev), after warm-up.

| # | Who | Result | Clicks | Page time | Notes |
|---|---|---|---|---|---|
| 1 | Khalid (lead@) | PASS | 0 | 2.5 s | Home lists, in order: **بانتظار قرارك** (3: date request on مراجعة حدود الصلاحيات المالية, answered request item محاضر الجمعية العامة الأخيرة, structure suggestion قسم للمشتريات), **بانتظار مراجعتك** (1: عرض المسودة على المجلس), **متأخر أو مستحق هذا الأسبوع** (3), **اجتماعاتك هذا الأسبوع** (2), then **منذ زيارتك الأخيرة** and one count line: 3 late, 1 awaiting review, 0 reviews older than 7 days, 1 blocked. Every row has a button (اتخاذ القرار, مراجعة, فتح, الاطلاع على الملف). |
| 2 | Majed (lead2@) | PASS with a note | 0 | 2.6 s | Home: Omar's join request (**اتخاذ القرار**), the Rawdah meeting "Hand-over of the quarterly reviews" this week, changes since last visit. Nothing of Al-Nukhba. The plan expected "Rawdah closing items": there are none for Majed because the final close is Sara's; he sees no closing row. All counters 0, which is true. |
| 3 | Sara (admin@) | PASS | 0 | 2.6 s | Omar's join request (**اتخاذ القرار**), Strategic Plan 2027 **جاهز للإغلاق النهائي** (**الإغلاق النهائي**), Abdullah's message (**تعليم كمُعالَج**), two new inquiries (Bayan Training Institute, شركة الفجر التجارية) with **فتح**. |
| 4 | each | PASS | 0 | under 10 s | All three found what needs them on the first screen, without searching or clicking. |
| 5 | each | PASS with notes | 3 (one per filter) | 1 to 2 s each | The count line links to `/actions?filter=late`, `awaiting-review`, `blocked`. Khalid: late 3 = list 3, awaiting review 1 = list 1, blocked 1 = list 1. Sara: same numbers, same lists (firm-wide). |

## Notes (what a real user would notice)
- "Nothing appears twice" is almost true. The action *مراجعة حدود الصلاحيات المالية* is on Khalid's home twice: once as a date request under **بانتظار قرارك** and once under **متأخر أو مستحق**. They are two different asks (decide the date vs it is late), but a reader sees the same title twice. *ترشيح الأعضاء المستقلين* (late and blocked) is one row, as wanted.
- Sara's count line says 3 late and 1 blocked while her home has no late rows (she is not on the board project; the rows list only work she follows). The counts open the firm-wide lists, so they agree with what they open, but the line does not say "all clients".
- The count line sits at the very bottom, after the cards, under a heading that only says "in all the actions you can open". Easy to miss.
- Warm-up of the app opens each main page once, so the first sign-in of a role was already compiled. A real first load in dev mode takes several seconds longer.

## Four plain-words answers
1. Yes. Each of the three found what needs them on the first screen with no clicks.
2. Nothing broke or showed the wrong thing. No cross-client rows (Majed sees only Rawdah and Al-Waha). One title appears twice on Khalid's home (see above).
3. No. Selah lists, never decides. Every row hands the decision to the person (**اتخاذ القرار**, **مراجعة**).
4. Put the count line at the top of the page, and say whether it is "mine" or "everything I can open".
