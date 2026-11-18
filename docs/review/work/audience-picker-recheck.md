# Recheck: "Who sees an item, part 2" after the review fixes (`feature/audience-picker`)

Rechecked 18 Nov 2026 at `19b0fd6` (the 11 fix commits after `4f30064`, migrations `0112` to `0119`), detached in my own worktree. I read the whole diff since `4f30064`, the latest text of every function and policy the fixes touch (and `0110`, `0111` where they change them), and every reader the brief names. I made no change to the branch and committed nothing. Database work ran only on `selah_test_r`: I reset it (dropped schema `drizzle`, `DROP OWNED BY selah_owner`) and migrated it from empty, ran the checks, ran six throwaway probes (R1 to R6, two temporary files in my worktree's `tests/db`, deleted; `git status` is clean), switched each fix off one piece at a time to see which test pins it, then reset and migrated it from empty again. No Docker container was touched. Line numbers are those of `19b0fd6`.

## Verdict

**No blocking problem left, but not quite ready.** Every earlier finding is closed or explicitly carried forward, and the checks are green. The 18 audience policies are all RESTRICTIVE on the same tables and commands. With the switch to two-argument functions, each of the 11 seeded people reads exactly the same rows on all 18 tables as with the old three-argument policies (probe R1). The mail job checks the person it is mailing, and no other kind of mail carries a narrowed item's content. Each fix has a test that fails without it, except the service half of B1. Four things should be dealt with before or with the merge:

- **S7. Copy made first, narrowed later.** A file already copied into evidence can still be narrowed. The copy then stays in front of the person left out, and nobody is warned (R2). This is B1 the other way round.
- **S8. A false refusal on the client's own meetings.** The new follow-up check stops a client admin from setting an "only" list on her company's meeting while a firm consultant has an open follow-up on it. She cannot clear that refusal herself (R6).
- **S9. Invited optional attendees.** Leaving out an optional attendee who is already invited is still allowed (R4). The lead intends to refuse it, and below I say what that needs.
- **S10. A new dependency.** The audience rule now relies on two hand-copied copies of the file and meeting rules. A future permissive path that is not copied into them would let people who are left out back in without any warning. A small test would guard it.

## The earlier findings

| Finding | Now | Why |
|---|---|---|
| **B1** narrowed file copied into evidence | **Closed for the order found; one gap carried as S7** | The service refuses (`files.ts:335-338`, `app_document_narrowed()`). The Files picker offers no narrowed file (`file-explorer.tsx:453`, `:542`) and says why (`:617`). The database refuses any evidence row whose checksum matches a narrowed file of the same client, however it is written (`0112_audience_evidence.sql:36-51`). Tested, and the test fails without the trigger. Narrowing a file after it was copied is not checked: S7. A fresh upload of the same bytes is refused too, which helps against leaks but has two side effects (note N11). |
| **B2** queued meeting mail deleted, and the race | **Closed** | `app_set_audience()` marks rows `withdrawn_at` instead of deleting them (`0119:80-86`), and the audit row counts them (`withdrawnMails`). The claim skips withdrawn rows (`mail.ts:47`). Just before each meeting mail, `app_meeting_mail_ok(meeting, address)` runs as the schema owner (`mail.ts:59-69`, `0114:9-17`). It checks the **recipient**, not the job: the address must belong to an invited contact, or to an invited user for whom the three-argument `app_audience_ok('meeting', id, that user)` holds. `ops-check.ts` and `app_mail_failing()` ignore withdrawn rows. The earlier smaller gaps are closed: an old address is no longer an attendee's, so it is not sent; a contact at the same address keeps her invite; addresses are unique whatever their case. Only `meeting.invite` and `meeting.cancel` carry a `meeting_id` or an item's content. Action mails link to an action, the digest only links to `/notifications`, and nothing mails about a file. A very small window remains (note N12). Both tests fail without their piece. |
| **S1** re-saving an "only" list shut out its setter | **Closed** | The saver is written onto an "only" list as an ordinary pick (`0119:58-63`) and never onto an "except" list (tested). It cannot widen anything: the saver passed `app_can_manage_audience()`, which requires that they see the item and are not left out, and being on the list only removes a restriction, never grants access. A saver who later loses access through their role (taken off the project, a department change) is hidden by the other rules, because the policy is AND-ed in. If they get that access back, they are on the list again, which is what they chose. One edge: the picker lists only people who can see the item now. If someone re-saves while the former saver lacks access, she drops off the list. That is acceptable. No backfill is needed, since nothing has shipped. |
| **S2** booking that invites someone it leaves out | **Closed (in the service only)** | `bookMeeting()` refuses before anything is written (`meetings.ts:132-144`). The test fails without it. The booking form sends every invitee as required (`meeting-form.tsx:151-154`), so on screen the person is a locked chip and drops off the "except" list with a line saying so. The database still accepts the same thing through any other path, because attendees are written before the audience. S9 would move the rule into the database. |
| **S3** follow-up assignee left out; trigger order | **Closed, but it over-refuses (S8)** | Leaving out a required attendee now gets its own sentence. Leaving out someone with an open follow-up is refused (`0119:65-73`). The trigger was renamed `follow_up_seen_by`, so it runs after `follow_up_rules` (checked in `pg_trigger`), and it also fires on a change of `meeting_decision_id`. Both tests fail without the fix. |
| **S4** old chats readable after being left out | **Closed** | RESTRICTIVE `audience` on `ai_conversations` (`0117:27`, the function as of `0118:81-93`), and the messages follow it through their subquery. R5 tried a chat whose case is a meeting, one citing the meeting as a record and one citing its note: all three are hidden, and her chat list is empty. Neither the title nor the first question shows anywhere. The list and the chat are read under row-level security (`assistant.ts:936-1003`). No other service, count or search reads chats. The retention purge only archives and deletes them. A translated answer is read through `app_translation_source()`, which runs with the caller's rights, so it is hidden too. Nothing is deleted. The test fails without the policy. |
| **S5** stale audience from the forms | **Closed** | `AudienceField` asks again when its address changes (label, department, invitees). It drops picks that no longer fit, says who in one line, and sends the new value (`audience-field.tsx:94-115`). Every form maps the database's refusals to their own sentences in Arabic and English (`lib/audience.ts:128-146`, unit tested, every key present in both files). |
| **S6** functions answering the app about anyone | **Closed; see S10 and note N14** | The app now gets `app_audience_ok(kind, item)`, `app_audience_entity_ok(etype, id)` and `app_audience_side_for_me()`, which ask about the person signed in. The three-argument forms and `app_audience_side` are revoked from `selah_app` (`0118:99-101`; the test fails if they are granted again). `app_audience_mine`, `app_document_narrowed` and `app_chat_audience_ok` answer only about items the caller sees (`0118:63-93`). Details are under "S6, the recreated policies" below. |
| **N1** archived file, database side | **Closed** | `0119:25-27`. The test fails without it. |
| **N2** empty tables in the never-widen twin | **Closed** | The seed now puts a row in all 18 tables (`audience.test.ts:257-294`). Every case I listed has a test: the information-request answer, the edit through PATCH, the mail race, the evidence copy, and P4, P6 and S3. |
| **N3** which test pins which rule | **Closed, with one exception** | Audiences are now written straight into the tables, so each rule is tested on its own. I switched off eight database pieces together (the saver, the follow-up check, the archived check, the withdrawal, the evidence trigger, the trigger order, the chat policy, the grants). Exactly the 10 tests for those pieces failed, and nothing else. Then I switched off the three service checks (the mail job's send-time check, the booking check, the evidence check). The mail and booking tests failed. The evidence service check is **not pinned**: the trigger raises the same words, so the test passes without it (note N15). |
| **N4** an answered request's status hints a file exists | **Carried forward** (note N17) | |
| **N5** a summary's text written from a narrowed file | **Carried forward** (note N18) | |
| **N6** audit labels | **Labels closed; the count is carried forward** | "Changed who sees a file" and «غيّر من يرى ملفًا» are fixed (unit tested). The audit's `people` still counts what the form sent, which on "only" includes the locked people. Minor. |
| **N7** wording | **Mostly closed** | `locked.clientAdminYours` («مدير حساب شركتك…», used on the client's own item) and «مدير المكتب» are fixed. The marker still reads «جمهور محدود». The plainer «يراه بعضهم فقط» was a suggestion, not a fault. |
| **N8** misplaced seed comment | **Closed** | `scripts/walkthrough/files.ts:90`. |
| **N9, N10** | **No action needed** | They were observations. |

## S6, the recreated policies and the readers

- **Policies.** `pg_policies` on `selah_test_r` has 18 `audience` policies, all RESTRICTIVE, all `TO selah_app`, on the same 17 tables as `0111` plus `ai_conversations`. Each keeps its command: `ALL` everywhere except `notifications`, which is `SELECT`.
- **Same rows as before.** The two-argument `app_audience_ok(kind, item)` is "not left out, or an item the caller cannot see anyway" (`0118:35-38`). It equals the three-argument check for anyone who passes the other rules, but only as long as `app_caller_sees_document()` and `app_caller_sees_meeting()` match those rules exactly. Today they do:
  - files: `scoped` plus `department` on `documents`
  - meetings: `scoped_read`, `department` and `whole_project` on `meetings`
  - **Probe R1 (run):** I recreated the 18 policies with the three-argument check, snapshotted every seeded person's rows on all 18 tables, and compared. Everything was identical except one notice I planted for someone outside the project. The new form shows it and the old one hid it, exactly as the rules before the feature did. So this is not a widening.
  - The tables under a meeting are covered twice anyway. Their permissive rules ask `app_can_see_meeting()` or `app_meeting_open_to_me()`, and both still contain the three-argument check.
- **Readers that run as the signed-in person.** The app has only one connection, as `selah_app` (`db/client.ts:17`), so every one of these goes through row-level security and asks about `app_uid()`:
  - the agenda, through `app_meeting_agenda_for()` with reader `app_uid()`
  - notifications and the activity feed (RLS)
  - the Excel exports (tested)
  - the export pack, read under its maker's rules; its maker is an admin, who always sees the item
  - the Files card, the project's lists, Today and the schedule (`v_schedule` is `security_invoker`)
  - the assistant's vector search. `scopeFilter()` now asks the two-argument form inside the `WHERE` (`assistant.ts:499-501`), so a forged `scope.userId` gains nothing (tested).

  There is no calendar subscription feed: the `.ics` file is per meeting and loaded under RLS. `app_mask_terms` holds names only.
- **Definers that act for someone else.** All still check the right person with the three-argument form (checked in `pg_proc`):
  - `app_send_meeting_invites()`: each attendee
  - `app_meeting_mail_ok()`: the recipient
  - `drop_left_out_notification()`: the person the notice is for, so notices written for others are covered
  - `app_meeting_agenda(…, reader)`: the reader
  - `check_audience_share`, `_attendee`, `_follow_up`: the person being shared with, invited or assigned

  The follow-up job writes notices about actions, never files or meetings, and the digest has no content. No definer calls the two-argument form, and none would get a null `app_uid()`.

## New findings

### Blocking

None.

### Should fix

#### S7. Narrowing a file after it was copied into evidence leaves the copy in front of the person left out (B1 the other way round)

`0119_audience_archived.sql:4-89` (`app_set_audience`) does not look for evidence copies. The trigger `evidence_not_narrowed` (`0112:50`) runs only when an evidence row is inserted.

- **Probe R2 (run).** In order:
  1. Manager `nmgr2` uses "Bonus table canary" (a client file nobody narrowed) as evidence on his open action.
  2. The client's admin then leaves `nmgr` out of the file. The save succeeds, and nothing warns her.
  3. As `nmgr`, `SELECT … FROM documents WHERE title = 'Bonus table canary'` returns the evidence copy, `{"purpose":"evidence","title":"Bonus table canary"}`.
  4. `createDownloadLink` gives `nmgr` a signed URL to the copy.
- **Why it matters.** The admin believes the file is hidden from `nmgr`, but the same bytes and title stay on the action. This leaves exactly the state B1's database check forbids ("an evidence file with the bytes of a narrowed file"), reached by the other order. It is not a widening compared with the moment before the change, since `nmgr` could already see the copy. That is why I put it under should fix. If "people left out see nothing" is read strictly, the lead may treat it as blocking.
- **Fix.**
  - In `app_set_audience()`, for a document set to "except" or "only", refuse when an evidence document of the same client has the checksum of any version. Say it plainly, in both languages: "A copy of this file is evidence on an action, and everyone who can see that action sees the copy." Add the key to `AUDIENCE_REFUSALS`.
  - Alternatively, allow the save but tell the person saving. Refusing matches B1.
  - Add the case to `tests/db/audience.test.ts`.

#### S8. A client admin cannot narrow her company's meeting to "only" while a firm consultant has an open follow-up on it

`0119:66-73`. On an "only" list, the check counts an assignee as covered only through `app_audience_lock()`. That leaves out the firm's people on a client's own item, who always see it (`app_audience_locked()`, `0111:109-115`).

- **Probe R6 (run).**
  1. The client's admin books a meeting. The meeting belongs to the client (`app_audience_side_for_me` = `client`).
  2. The lead gives consultant `cons` (staffed, not lead or deputy) a follow-up on it.
  3. The client's admin sets "only [herself, nmgr2]". It is refused: "that person has an open follow-up on this meeting: give it to someone else first".
  4. She cannot do what the sentence says: follow-ups are written by the firm (`firm_write`). Adding `cons` to the list is refused too ("on your company's own items, choose among your company's people").
  5. Once the follow-up is done, the same save goes through, and `cons` still sees the meeting, as the firm always does on a client's item.

  So the refusal guards nothing and blocks a legitimate change.
- **Fix.** Replace `app_audience_lock(kind, item, f.assignee_user_id, app_uid()) IS NULL` with `NOT app_audience_locked(kind, item, f.assignee_user_id, app_uid())`. Add the case to the tests.

#### S9. Leaving out an optional attendee who is already invited (the S2/S3 decision)

`app_set_audience()` lets it through for an optional attendee, because only required attendees are locked. The fixture does exactly this (`audience.test.ts:498`).

- **Probe R4 (run).**
  - After she is left out, `nmgr2` still sees `nmgr` on the attendee list, and `nmgr2`'s calendar file names her address.
  - Her own Selah views (meeting, schedule, Today, response) hide the meeting.
  - She keeps any invite that was already sent, with its title, time and **call link**. Nothing tells her calendar of a later change or a cancellation, so the link keeps working.
  - "Take them off the meeting first" does not help today either. `removeAttendee()` (`meetings.ts:599-608`) queues nothing, and in R4 her only mail row was the withdrawn invite.

  This leak is small, because she already had the invite. It keeps her a working link, and others see an attendee who cannot open the meeting.
- **What refusing it would need** (the lead's intent):
  1. **In the database.** In `app_set_audience()` for a meeting, refuse when any invited user would be left out: on "except", an attendee in `people`; on "only", an attendee not in `keep` and not covered by `app_audience_locked()`. Suggested sentence: "that person is invited: take them off the meeting first". This covers booking, editing and the picker alike, and replaces the service check in `bookMeeting()`, which can stay as an early, plain refusal.
  2. **In the picker.** Show invited optional attendees as locked chips with a new reason, "invited", in `app_audience_lock_of()` (`0111:68-89`). That means a new lock reason in `AUDIENCE_LOCK_REASONS`, a tooltip in both languages, and a sentence key in `AUDIENCE_REFUSALS`. `reconcileAudience()` already drops locked people from an "except" list.
  3. **A product decision on removal.** Should `removeAttendee()` queue a `meeting.cancel` to the person removed, when an invite went to her? Without it, her calendar keeps the event and the link. It tells her she is off the meeting, which is a change notice about a meeting she already knew of, not about the audience.
  4. **Tests.** "except" and "only" with an optional attendee, the booking, `PATCH /api/meetings/:id`, the picker's lock, and, if decided, the cancellation.

#### S10. The audience rule now relies on hand-copied rules for files and meetings

The copies are `0112:10-19` (`app_caller_sees_document`) and `0118:13-21` (`app_caller_sees_meeting`).

- **The risk.** The two-argument check says "not left out, **or the caller cannot see the item by these copies**". If someone later adds a permissive path to `documents` or `meetings` (main's deliverable hand-over, say), or changes `scoped`, `department` or `whole_project`, without updating the copies, then someone left out who gets in through the new path sees the item. Nothing would fail. The three-argument form did not depend on how access was granted.
- **Today they match** (R1). Main's `0090`/`0091` add no policy on these tables.
- **Fix (cheap).** Keep R1 as a permanent test: for every seeded person, the row sets with the two-argument policies equal those with the three-argument ones. Or assert directly that `app_caller_sees_document(id)` equals "the row is visible once its audience rows are removed", and the same for meetings. Then add a comment on the `scoped` policies of both tables pointing at the copies.

### Notes

- **N11. Uploading the same bytes as evidence: an existence oracle and a confusing sentence.**
  - **Probe R3 (run).** `nmgr` is left out of the salary file and owns an action. She uploads, as evidence, a file with the same checksum. It is refused, and the database's sentence reaches her (`http.ts:316`, 409). The action page shows "A file with a limited audience can't be used as evidence. Upload the evidence instead." (`action-panel.tsx:82`, `en.json:494`).
  - She learns that a narrowed copy of a file she holds exists. She has to have the exact bytes, so this is weak.
  - The person who is not left out is told to "upload the evidence instead" on the very upload she just made.
  - A file nobody narrowed is accepted.
  - Refusing the same bytes is right, as the builder argued. Consider a message for a fresh upload that does not send her back to uploading, for example "This file can't be used as evidence; ask the person who shared it" in both languages, and no wording that confirms a narrowed copy exists.
- **N12. A very small mail window remains.** The send-time check runs, then the calendar file is built and the mail is delivered (`mail.ts:63-74`). An audience change that commits inside that window, which lasts one SMTP send, still goes out. Before the fix the window was a whole batch. To close it fully, do the check and the send in one transaction that holds the row with `SELECT … FOR UPDATE`. The `UPDATE` in `app_set_audience()` then waits, and the mail counts as sent before the change.
- **N13. `authorize()`'s sixth question is now a guard only.** For someone left out, `app_audience_mine` returns nothing (`0118:63-73`), so `checkAudience()` (`authorize.ts:175-181`) can never deny with data from the database. The migration says so. Row-level security does the enforcing, and every service reads under the app role, so there is no live gap. The `authorize()` row in `docs/authorization.md`'s table still reads as if it enforced. Reword it.
- **N14. The two-argument check still answers `false` to someone left out who passes the other rules** (`true` for an unknown id). That is inherent in any row-policy predicate, which must say no to hide the row. It can only be reached with SQL as the app role, and no route passes a user's id into it.
- **N15. The B1 service check is not pinned.** With `files.ts:338` switched off, the B1 test still passes, because the trigger raises the same words. Add an assertion that only the service could satisfy, for example that the message is the service's (no "upload the evidence instead").
- **N16. Wording in `scripts/send-mail.ts:35`.** "withdrawn (addressee left out of the meeting)" also counts an address that is simply no longer an attendee's (taken off, or a changed address).
- **N17 (was N4). An answered request's status.** Still open. A client person left out of the file that answered a request still sees it marked "Received", with no file. She would notice if the request is hers to follow ("someone answered with something I can't see"). It shows that a file exists, not what is in it, but it is the "1 hidden item" the spec rules out. A decision for the lead: warn the person answering when the file is narrowed and the request's own people are left out, or accept it.
- **N18 (was N5). Summary text written from a narrowed file.** Still open. The sources are pointed at by hand (`addSummarySource()`, `meetings.ts:451-476`), and the AI summaries are per file and covered by the audience. So this is a person copying content, and a client notices only if the text quotes the file. Consider a warning when a narrowed file is added as a summary source.

## Check results (on `selah_test_r`, TZ=UTC)

| Check | Result |
|---|---|
| `npm ci` | done in my worktree |
| `npm run lint` | passed (exit 0) |
| `npm run typecheck` | passed (exit 0) |
| `npm test` (unit) | 38 files, 585 tests passed, 0 failed |
| Database tests: `vitest --config vitest.db.config.ts --hookTimeout 120000 --testTimeout 120000`, after a reset and a migration from empty | 74 files, 983 tests passed, 0 failed (722 s) |
| `npx drizzle-kit check` | Everything's fine |
| `npx drizzle-kit generate --name probe` | No schema changes, nothing written |
| `pg_policies` | 18 `audience` policies, all RESTRICTIVE, same tables and commands as `0111`, plus `ai_conversations` |
| Each fix switched off (database pieces together, then the service pieces) | 10 failed, then 2 failed, each the fix's own test. The B1 service check is not pinned (N15). Afterwards I reset `selah_test_r`, migrated it from empty and ran `audience` and `mail` again: 51 passed. |
| Probes R1 to R6 (throwaway files, deleted) | R1: rows unchanged by S6. R2: S7. R3: N11. R4: S9. R5: S4 closed. R6: S8. |
