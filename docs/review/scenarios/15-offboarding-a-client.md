# Scenario 15: offboarding a client at the end of the engagement (copy C, Arabic, 1280 px)

Copy C, 20 Nov 2026, after 18 and 14 (both Rawdah projects closed). Dev server timings, not production. Step 8 (Sahm's reminder) belongs to copy A and is reported in `15-engagement-end-reminder.md`; here I only ran the job and read the result on copy C.

**PRIVACY findings:** none. The export pack holds only shared records (checked: no lessons text, no firm notes, no canary in any file or csv). Rawdah people could not read anything after the no-grace archive.

**Result: PASS with friction.** Not seen: the refusal when a project is still open (both projects were already closed by 14).

| # | Who | Step | Result | Screenshot | Notes |
|---|---|---|---|---|---|
| 1 | Sara | Rawdah, **الإعداد**, **أرشفة العميل**, grace and note | PASS | shots/15/01-archive-dialog.png, 02-sara-archived.png | Dialog: «يحتفظ أفراده بالقراءة فقط طوال المهلة، ويُبلَّغ مديروه. وتُحفظ السجلات 10 سنوات…»; choices: no grace, 30, 60 (default), 90 days. I kept 60 (the custom dropdown would not open with my selectors; a person would). Banner «أُرشف هذا العميل في 20/11/2026. كل ما هنا للقراءة فقط، ويمكن لمدير المكتب استعادته.» Hind got the mail `client.archived` (sent at once, not held). |
| 2 | Sara | **إعداد حزمة التصدير**, **تنزيل**, SHA-256 | PASS | shots/15/03-pack.png | ZIP of 6 files, 14.2 KB; the page shows `74bb923e…ee020`; `sha256sum` of the downloaded file matches. ZIP has projects, recommendations, actions (8, with the closing decision and who carries it on), files with their own SHA-256, deliverables, manifest, README. Folder names inside the ZIP for Arabic titles come out garbled in my unzip tool (encoding), the files are there. |
| 3 | Hind, Yousef, Dana | Open home | PASS | shots/15/04-admin-banner.png, 04-owner-banner.png | Banner «أرشف المكتب حساب منظمتكم. يمكنكم قراءة سجلاتكم وتنزيلها حتى 19 يناير 2027، ولا يمكن تغيير شيء.» Only Hind (client admin) gets the link «حزمة التصدير الخاصة بكم»; Dana does not. Dana's closed action shows no write boxes (shots/15/05-dana-action-readonly.png). Friction: the meeting row «الرد على الدعوة» with **سأحضر / ربما / أعتذر** is still offered on an archived client (I did not press it). The progress sentence still reads «…5 من أصل 6 إجراءً ما زالت قائمة». |
| 4 | Hind | **حزمة التصدير الخاصة بكم**, download, **تأكيد الاستلام** | PASS | shots/15/08-hind-pack.png, 09-confirm-dialog.png, 10-receipt.png | Her download has the same SHA-256. Confirm dialog says it is recorded once and cannot change. Receipt shows «أُكّد الاستلام بواسطة هند الزهراني في 20/11/2026» and her note; Sara sees the same plus a `client.pack_received` notice. Friction: Hind's page also shows **إعداد حزمة التصدير** (making a pack), which reads like a firm button. |
| 5 | Dana | Help | PASS | shots/15/07-dana-help.png | «سجلات شركتك للقراءة فقط أثناء مغادرتها صلة، فلا يمكن كتابة تعليقات جديدة. ما زال بإمكانك مراسلة مستشاريك أو إدارة المكتب من هذه الصفحة.» The write-to-management box is there («حتى 5 رسائل في اليوم»). |
| 6 | Sara, Hind | Restore (reason required), archive again with **بلا مهلة**, Hind opens the app and signs in fresh | PASS with friction | shots/15/12-restore-dialog.png, 13-archive-nograce.png, 14-hind-after-nograce.png, 15-hind-fresh-signin.png | Her open session was sent to `/sign-in?error=no_access`; a fresh sign-in says «حسابك غير مرتبط بمنظمة نشطة.» Friction: it does not say the company's account was archived or whom to ask. |
| 7 | Sara | History, legal hold, other clients | PASS | shots/15/16-clients-list.png, 17-hold.png | **أرشفة سابقة** lists «أُرشف في … واستُعيد في … بواسطة سارة العتيبي» with the reason. **وضع حجز نظامي** (reason) shows «قائم»; **رفع الحجز** needs a reason. In the client list Rawdah carries a «مؤرشف» tag; the other four clients show no change and the project states are unchanged (4 active, 1 draft, 2 closed = Rawdah's). |
| 8 | job | `follow-ups` on copy C (`npx tsx --env-file=.env.local scripts/follow-ups.ts` in apps/web) | PASS (no engagement notice expected) | – | «follow-ups for 2026-11-20: 3 notifications, 6 summary mails». No `engagement.ending` or `engagement.ended` because Rawdah was archived and there is no Sahm on this copy. Summary mails (`follow_up.digest`) are queued until Sun 22 Nov 07:00 Riyadh (Friday hold). Sahm's reminder: see scenario 15 reminder file (copy A). |

**End state on copy C:** Rawdah restored (hold released) so the sweep can use its accounts; its two projects are closed.

## Four answers
1. **Without help?** Yes. The pack, checksum and receipt are clear. Sara would want a visible reason when closing is refused and a note on what "grace" means for the people.
2. **Anything break or show the wrong thing?** Nothing shown to the wrong person. Friction: RSVP buttons on an archived client; the generic «غير مرتبط بمنظمة نشطة» sign-in message; the client admin sees a «make pack» button.
3. **Selah acting like the consultant?** No. Archive, restore and hold are explicit, with reasons.
4. **One change:** on the no-access sign-in page say «أُرشف حساب منظمتكم، تواصلوا مع المكتب».

**Not seen:** the refusal to archive while a project is open (both were closed). Not run: scenario 19 (sweep).
