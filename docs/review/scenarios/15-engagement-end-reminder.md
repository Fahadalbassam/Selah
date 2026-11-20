# Scenario 15 (reminder check only): does anyone at the firm notice Sahm's engagement is about to end?

Copy A, Arabic, 20 Nov 2026. Only step 8 of the plan's scenario 15 belongs to copy A (the archive and pack steps are copy C's). Sahm's engagement «تعاقد الحوكمة التشغيلية» was recorded in scenario 1 with an end date 25 days out (15 Dec 2026).

**PRIVACY findings:** none. No Sahm person received any engagement notice.

**Result: PASS.**

| # | Who | Step | Result | Screenshot | Notes |
|---|---|---|---|---|---|
| 8a | helper | Run `npm run job:follow-ups` by hand in `apps/web` with the copy's environment | PASS | – | Output: «follow-ups for 2026-11-20: 7 notifications, 8 summary mails». |
| 8b | Majed (lead), Sara (firm admin) | Read the bell | PASS | shots/15/01.png | Both got `engagement.ending`: «ينتهي التعاقد «تعاقد الحوكمة التشغيلية» في 15/12/2026». Both also got `engagement.ended` for the seeded Rawdah engagement (end date 15/11/2026, «ولا يزال مفتوحًا»). Sahm has no deputy, so none went to a deputy. |
| 8c | Sahm people | Check nothing reached the client | PASS | – | Database query on `notifications`: the four `engagement.*` rows are only for lead2@ and admin@mizan.test. admin@, ops@, hr@, owner@sahm.test got none. |
| 8d | Mailpit | The mail | NOT SEEN, expected | – | The summary mail (`follow_up.digest`) is work mail and is held until Sunday 22 Nov 07:00 Riyadh (today is a Friday; see scenario 1, "Mail"). |

## Four answers
1. Could a real firm person notice? Yes: the bell says the date and the engagement's name. It depends on the daily job running; the walkthrough does not run it, so someone must start `job:follow-ups` (a production deployment must schedule it).
2. Anything wrong? No leak. The same job also reported an already-ended engagement still open (seed), which is useful.
3. Did Selah act like the consultant? No; it only reminds.
4. One change: say in the notice what to do next (renew, close projects, archive), and link to the engagement.
