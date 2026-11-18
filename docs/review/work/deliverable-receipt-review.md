# Review: deliverable handed over, client confirms receipt, decision 4a (branch `feature/deliverable-receipt`)

I reviewed commit `1e2118c` (merge of #167 into `a34b309`; the migration is now `0091_deliverable_receipts`) against `origin/main` (`ebd8ae7`), in the worktree `C:\Projects\selah-fresh\.claude\worktrees\agent-a90b397dea5452d7b` (detached head). I only read that branch and committed nothing. Paths are relative to `apps/web` unless they start with `docs/`.

Database work ran on `selah_test_r` only. I reset it (dropped schema `drizzle`, then `DROP OWNED BY selah_owner`) and ran `npm run db:migrate` from empty with `TZ=UTC`. My probes were a throwaway test file. I copied it into `tests/db/` for each run and removed it straight after; the source stays in my scratch folder. It seeds one client as `selah_owner` and then calls the services and SQL as `selah_app` with `selah.user_id` set, the way the builder's tests do. For the mutation runs I edited `0091` in my worktree, reset and migrated the database, ran the tests and restored the file with `git checkout`. Afterwards I migrated the real file again and the new tests passed again (20/20). The worktree is clean.

## Verdict

**Not ready to merge: 1 blocking, 9 should fix, 12 notes.**

The core access rules hold, and the service, `authorize()` and the database functions agree on them:
- another client gets 404 everywhere;
- only the client's acceptors, admins and sponsor answer, and only when they can open every file;
- the firm never confirms for a full client;
- a round is frozen once it is answered;
- a replaced round is refused;
- the summary mail keeps every earlier line.

The blocking finding is about how a firm-only file gets shared. The hand-over dialog offers every firm-only upload of the client, because every firm upload has purpose `deliverable`. One press of "Hand over" then shares the ticked file with the client for good. There is no confirmation, and the request says nothing about sharing. The file's own "Share with the client" asks first.

The should-fix items:
- A round still waiting when its project closes can never be answered.
- A consultant staffed on any project of the client can hand over any engagement's deliverable, with files the acceptor cannot open, and nobody can see who was asked.
- An acceptor can see "Received" while a newer round waits for the admin.
- The closure PDF tells the client admin about "the client".
- Seven rule groups in the migration can be removed without any test failing.

## Blocking

### B1. A hand-over shares firm-only files in one click, from a list of every firm upload of the client

- **Where:**
  - `src/services/deliverables.ts:332` (`handOverChoices` offers the latest firm-only version of every chain).
  - `src/services/deliverables.ts:354-358` (`handOverDeliverable` calls `shareDocument` for each firm-only id, with nothing in the request that asks for it).
  - `src/components/deliverables/hand-over-dialog.tsx:120` (the only warning is a muted line under a ticked box).
  - Every firm upload is purpose `deliverable` (`src/services/files.ts:488`), and a firm upload is firm-only by default, so the list holds the firm's working files across all the client's projects.
  - The existing share asks first: `src/components/file-actions.tsx:49-50, 119` and `shareWithClientConfirm` («سيراه كل من يستطيع فتح هذا المشروع لدى العميل. لا يمكن التراجع عن المشاركة»).
- **Scenario:**
  1. The lead opens "Hand over" on *Board charter*.
  2. Next to the shared files, the list shows *Internal notes on the CEO.docx*, a firm-only working note. It can come from any project of the client.
  3. She ticks it by mistake (or a crafted `POST /api/deliverables/:id/hand-over {"versionIds":[<firm-only id>]}` names it).
  4. One submit shares it with everyone at the client who can open that project. A share cannot be undone.
  5. The receivers are also notified.
- **Probe 1:**
  - The note was offered with `firmOnly: true`.
  - After one `handOverDeliverable`, its `visibility` was `shared`.
  - A manager on the project with no client role read it (`documents` count 0 before, 1 after).
- **Fix (pick one):**
  - **(a) Simplest, and in line with the decision:** offer and accept only files already shared with the client. The dialog then says "Share it first from the file's menu". Decision 2 says the audience "can be set … when the firm shares a deliverable with the client", so sharing should stay on the file's own path, which the audience picker will extend.
  - **(b)** Keep sharing on the way, but require an explicit `share: [ids]` in the body that matches the firm-only picks. The server refuses a mismatch. The dialog shows the same confirmation text as the file's share action, naming each file that becomes visible. A firm-only version is never ticked by default.

## Should fix

### S1. A round still waiting when its project closes can never be answered or reminded, and closing does not warn

- **Where:**
  - `drizzle/0091_deliverable_receipts.sql:245-247` (`app_open_handover` refuses on a closed project) and `:389` (no reminder).
  - `src/services/deliverables.ts:197` (`open` is false, so no buttons).
  - `app_closure_blockers` (`drizzle/0020_project_closure.sql`) does not list waiting rounds.
- **Scenario:**
  1. The final report is handed over on Monday.
  2. The firm admin closes the project on Tuesday.
  3. The client can no longer confirm or comment: the API answers 404 and the database refuses "a closed project's deliverables stay as they are".
  4. The reminder is never sent.
  5. The closure report says "Handed over (waiting)" for good. The product owner asked for "receipts in the closure report".
  6. The only way out is to reopen the project.
- **Probe 6:** after the close, `recordReceipt` failed with "forbidden", `app_remind_deliverables` returned 0, and the client admin's view was `waiting` with every action false.
- **Fix:** allow `deliverable.receive` and `deliverable.comment` on a closed project, and drop the closed check from `app_open_handover`. A receipt records what already happened, like the closing pulse (`pulse.answer`) and case-study consent, which `OPEN_WHEN_CLOSED` already lets through after closing. Keep the hand-over refused, and keep the reminder for closed projects until the client is archived. Also list waiting rounds on the closing checklist as a warning, not a blocker. If you prefer to keep "nothing after close", make a waiting round a closure blocker instead, and say so to the product owner, since the firm cannot clear it for a full client.

### S2. "Staffed" means staffed anywhere at the client, and the files can come from any of its projects

- **Where:**
  - `src/authz/policy.ts:92` (`working`) and `drizzle/0091…sql:261` (`app_firm_changes_kpis` is client-wide, as for indicators).
  - `src/services/deliverables.ts:310-318` (the choices are not limited to the deliverable's projects).
- **Scenario:**
  1. A consultant staffed only on *HR review*, under another engagement, hands over *Board evaluation* of the governance engagement, using a file from *HR review*.
  2. The project's acceptor cannot open that file. She is skipped without anyone being told, and the client admin is asked instead.
  3. The firm's screen does not say who was asked (a round has no receivers field). It does not say when nobody could be asked either: an empty receiver list happens when no admin is active and the acceptor cannot open a file.
- **Probe 2:** round 1 was made by that consultant. The only person told was the client admin, not the acceptor. The acceptor got 404 on the deliverable.
- **Fix:**
  - Count staffing only on a project the deliverable relates to (`app_deliverable_projects`), or as the client's lead or deputy, in the policy (a new scope or a check in the service) and in `app_hand_over_deliverable`.
  - Offer files from those projects first, or only those.
  - Show in the dialog who will be asked ("Reem, the acceptor"), or that nobody at the client can open all the picked files.

### S3. An acceptor sees "Received" while a newer round waits for someone else

- **Where:**
  - `src/services/deliverables.ts:147-190` (`roundsOf` returns only the rounds the reader may read).
  - `src/lib/deliverables.ts` (`receiptStatus` uses the newest round the reader can see).
- **Scenario:**
  1. Round 1 (the matrix) is confirmed by the acceptor.
  2. Round 2 adds an annex filed under Finance.
  3. The acceptor's home card, and her closure PDF, still say "Received" for round 1. The admin's say "Handed over (waiting)" for round 2.
- **Probe 3:** the acceptor saw `received [1]`; the admin saw `waiting [2, 1]`.
- **Fix:** take the status word from the real latest round through a definer function that returns only the word, and mark her visible older round "Replaced by a later hand-over". Or drop the deliverable from the home card of someone who does not answer its latest round.

### S4. Client readers are told about "the client"

- **Where:**
  - `messages/ar.json:2507-2508` and `en.json:2507-2508`: `closurePdf.deliverablesTitle` «ما سُلِّم للعميل», and `deliverablesNote` «وصلت إلى العميل، بتأكيده أو بتسجيل المكتب» / "reached the client, confirmed by the client".
  - `deliverables.text.recorded` at `ar.json:3286` / `en.json:3286` («نيابةً عن العميل» / "for the client"), which goes into `deliverables.csv` of the client's own export pack.
- **Scenario:** the client admin exports the closure report. The builder's own test does this (`closurePdf` as `cadmin`). The section reads «ما سُلِّم للعميل». The rest of this PDF says «الجهة». The build brief's rule 4 forbids talking about "the client" to the client.
- **Fix:** choose the words by reader, as `indicator_moved_away` does with `reader, select`. For example «ما سلّمه المكتب لشركتكم» / "What the firm handed over to your company", and «وصلت الملفات إلى شركتكم». Use neutral wording in the export pack.

### S5. Seven rule groups are not covered by any test

I removed all of these at once from `0091`. `deliverable-receipts.test.ts` and `export-pack.test.ts` still passed (20/20). So did `rule-parity`, `mail-choices`, `follow-through`, `walkthrough-seed`, `closure` and `offboarding` (121/121).

| # | Rule removed | `0091` lines | Test to add |
|---|---|---|---|
| 1 | The summary mail filter: a reminder is mailed only while its round still waits and the reader still answers for it | 438-443 | Remind, then confirm (or move the file to a department the reader is not in), then `app_queue_digests`: the reminder is not mailed. Probe 5 shows the rule works today. |
| 2 | The database refuses a hand-over on a closed project | 264-266 | `app_hand_over_deliverable` as the lead after closing |
| 3 | No reminder for a firm-run client, a closed project, or a round replaced by a newer one | 388-390 | One test per case |
| 4 | A comment goes to the firm admins when the client has no lead or deputy | 332 | Comment on a client with neither |
| 5 | The scan check in the database (the service checks it too) | 275 | Direct SQL call with a `pending` file |
| 6 | Only a client admin or manager answers (an action owner never does, even if the client role stays after their role changes) | 107 | Demote an acceptor to `action_owner`, then try to confirm |
| 7 | The trigger rule that `reminded_at` is set once, only by the job | 214-216 | Owner `UPDATE` of `reminded_at` twice, and as the app |

The rules the tests do cover fail when removed, as they should, each on its own:
- (T1) "opens every file" in `app_deliverable_receiver_ok`: 1 failed.
- (T2) the widened `deliverable_read`: 5 failed.
- (T3) `reminded_at IS NULL` in the reminder: 2 failed.
- (T5) the round check in `app_open_handover`: 1 failed.

### S6. The client home card keeps every deliverable ever handed over

- **Where:** `src/app/(app)/page.tsx:67, 77, 135-146` and `src/services/deliverables.ts:265-268` (`handedOverOnly` lists received and commented ones as well).
- **Scenario:** a client admin with twelve deliverables received over a year still sees all twelve on her home, each with its files and download buttons, under "Download each deliverable, then confirm…". That breaks the screen standard ("what to do next", fewer buttons).
- **Fix:** list only the rounds waiting for this reader. Fold the others under one line ("Received earlier (n)"), or leave them to the engagement page for the admin.

### S7. The export pack dates the hand-over in UTC

- **Where:** `src/services/export-pack.ts:307` (`r.deliveredAt.toISOString().slice(0, 10)`).
- **Scenario:** a hand-over at 01:30 Riyadh time on 18 Nov shows as 2026-11-17 in `deliverables.csv`, while the receipt text beside it uses the firm's day.
- **Fix:** use the firm day (`firmToday(r.deliveredAt)` or `app_firm_date`).

### S8. The dialog offers firm-only files the person cannot share, and the hand-over then fails

- **Where:** `src/services/deliverables.ts:332` (no `fileControls().shareWithClient` filter, and closed projects are not excluded).
- **Probe 6:** the dialog of another deliverable offered a firm-only file of the closed project, and handing it over was refused.
- **Fix:** filter the choices with `fileControls`. This disappears if B1 is fixed with option (a).

### S9. Merge gate with the audience picker (not on `main`, so not enforced here)

- **Where:** `drizzle/0091…sql:83-96` (`app_user_opens_document`).
- **Scenario:** `feature/audience-picker` adds a restrictive `audience` policy on `documents` (0110-0119). `app_user_opens_document` is a security-definer twin of the documents rules, and it will not know that policy. A person left out of a file would then still be told about the hand-over and reminded, would read the round, and would see "1 file you can't open". The decision says left-out people see no row and no count and are never notified.
- **Fix:** whichever branch merges second adds `app_audience_ok` for the target person to `app_user_opens_document`, with a test. The hand-over's share (B1) should go through the picker.

## Notes

- **N1. Holidays and timing** (`0091…sql:163-166, 391`).
  - Selah has no holiday calendar, so Eid al-Fitr, Eid al-Adha, Founding Day and National Day count as working days, and a reminder can come early or land in a holiday. The mail send-time rule holds only Fridays, Saturdays and Ramadan hours.
  - `>= 10` fires on the morning of the 10th working day, if the job runs early, so it is "after 9 full days plus part of the hand-over day".
  - Friday and Saturday are counted correctly as off. The count does not depend on the session time zone: probe 7 gave 15 in UTC, Riyadh, Los Angeles and Kiritimati.
- **N2. Today and comments** (`src/services/today.ts:539`). A comment stays on the lead's Today until a new round, so a comment that needs no new version cannot be settled. When the client has no lead or deputy, the firm admins are told, but they get no Today item.
- **N3. Digest wording for the firm.** The summary mail now says "…or files handed over to you" (`src/lib/mail-templates.ts`) to everyone, firm staff included.
- **N4. The "Commented" colour.** "Commented" uses the red problem tone (`deliverable-list.tsx:14`), so on the client's own screen their comment reads as a problem. Amber ("waiting for the firm") would judge less.
- **N5. The firm-side hint.** `handOverHint` says "The client's acceptor is told" (`en.json:3254`), but it may be the admin or the sponsor. See S2.
- **N6. Deliverables with no project.** A deliverable tied to no project has no closing rule: it can be handed over, answered and reminded after every project of its engagement has closed (the checks at `0091…sql:245, 264, 389` look only at `d.project_id`).
- **N7. Reading every deliverable first.** `listDeliverables` without an engagement reads every deliverable the reader may see before filtering by client (`src/services/deliverables.ts:250-252`). For the firm admin, that is every client's, on each client page, closure PDF and export pack. The `deliverable_read` policy also evaluates `app_answers_for_deliverable` per row. This is about speed, not correctness.
- **N8. Mail choices.** The hand-over and comment mails go in whatever the reader's mail choices are, like `pulse.requested` and `support.requested`. This is the existing pattern; noted only.
- **N9. Migration number.** `feature/org-chart-data` also uses `0091` (`0091_org_chart.sql`); one of them renumbers. `feature/audience-picker` (0110-0119) does not redefine `app_queue_digests`, `app_document_settled`, `app_work_mail_kinds` or `outbound_kind`, so nothing there overwrites 0091's lines.
- **N10. Docs wording.** The firm admin row in `docs/authorization.md` says "hands nothing over unless staffed as a consultant would be"; a firm admin is never a consultant. It should say "never hands over".
- **N11. Scan pending.** While the newest version is still being scanned, the dialog quietly starts at the older version.
- **N12. Wrong round number.** A crafted `round` higher than the latest gets "a newer version was handed over since".

## Checked and found sound

- **Another client.** 404 for every route and the database shows 0 rows, for the other client's admin and for a consultant of another client. The builder's test covers this, and I read the functions.
- **Wrong people.** A manager with no role and an action owner cannot answer. Client roles need an admin or manager (`check_client_role`), and `app_deliverable_receiver_ok` checks the role again.
- **The firm and receipts.** The firm cannot confirm for a full client. A firm-run client is recorded only through `app_record_deliverable_receipt`, which checks the mode in the database, with who, how and a day between the hand-over and today.
- **Crafted requests:**
  - an old round is refused;
  - a second answer is refused;
  - another client's file is refused;
  - an older firm-only version is refused and stays firm-only (probe 4);
  - a file not cleared by the scan is refused (probe 4);
  - a client upload or evidence is refused (purpose check).
- **Visibility:**
  - Client readers see only rounds whose every file they open. `app_user_opens_document` matches the documents rules on main (project, draft, label, department, uploader, one-by-one share), so a client reader never sees a hidden-file count.
  - Earlier versions shown in rounds were already shared.
  - The wider `deliverable_read` adds only answerers (acceptor, sponsor and admin who open the files); the firm side is unchanged. No other reader of `engagement_deliverables` changes: `engagements.ts` stays behind `engagement.read`, and `today.ts` is firm-only.
  - Department limits (D8) hold: a deliverable has no department, and its files keep their own rules.
- **Rounds:**
  - the trigger freezes the files, who handed over and when;
  - an answer is final;
  - the app cannot write the table;
  - a deliverable that was handed over cannot be removed;
  - a file handed over cannot be withdrawn (`app_document_settled` keeps 0063's lines);
  - withdrawal is the only way to archive a file;
  - projects never return to draft, so the archive step never deletes a file that was handed over.
- **Purge.** The client purge and the discard of a prospect delete documents, engagements and organisations together, and the trigger lets the rounds go (no `app_uid`, or `selah.discard`). Users are erased by an update, never deleted, so the foreign keys to `user` hold. The export pack and the closure PDF therefore never meet a round whose files are gone.
- **Archived client.** The freeze is checked by `offboarding.test.ts` against `CLIENT_FROZEN_TABLES`.
- **`app_queue_digests`.**
  - 0091 against 0090, line by line: only the two deliverable lines and the six-line filter are added; nothing is lost.
  - 0090 against 0081, 0081 against 0078 and 0078 against 0050 are each pure additions, so every earlier line survives, including the moved-away mute, audience and fixed-notice lines.
  - `outbound_kind` and `app_work_mail_kinds` are 0060's lists plus the two new kinds, and `WORK_MAIL_KINDS` in TypeScript matches.
- **Mail and wording:**
  - the mails carry no titles;
  - the four status words are right in both languages;
  - "Received" is never green and is worded as receipt only on the client card, the confirm dialog, the mail, the engagement page and the PDF;
  - one solid button on the home card.
- **Walkthrough seed.** It hands over two deliverables to the acceptor; one is received and one waits, and `walkthrough-seed.test.ts` passes.

## Check results

| Check | Result |
|---|---|
| `npm run lint` | 0 problems |
| `npm run typecheck` | clean |
| `npm test` (unit) | 38 files, 580 passed |
| `npm run test:db` on `selah_test_r`, migrated from empty | 75 files, 981 passed |
| `npx drizzle-kit check` | "Everything's fine" |
| `npx drizzle-kit generate --name probe` | "No schema changes, nothing to migrate"; no file created |
| Reviewer probes (7 scenarios, 8 tests) | All behaved as described above |
| Mutation runs | 7 rule groups removed together: no test failed (S5). T1, T2, T3 and T5 each removed alone: 1, 5, 2 and 1 tests failed |

**Not checked:**
- the screens in a browser (the app was not started, as instructed);
- the e2e tests;
- the PDF section rendered through Gotenberg;
- the mails in Mailpit.
