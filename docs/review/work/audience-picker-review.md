# Review: "Who sees an item, part 2" (`feature/audience-picker`)

Reviewed 18 Nov 2026, branch at `4f30064` (9 commits on `origin/main` `16ece4d`), detached in my own worktree. I read the whole diff, both migrations (`0110`, `0111`) in full, and every service and screen they touch, and I ran the checks. I made no change to the branch. Database work ran only on `selah_test_r`. The lead's restart had dropped that database, so I created it again the way `db/init/01-roles.sh` does, then migrated it from scratch. Probes P1 to P7 below come from one throwaway test file that I copied into my worktree's `tests/db`, ran against `selah_test_r`, then deleted (`git status` is clean). Line numbers are those of `4f30064`.

## Verdict

**Not ready to merge.** The core is solid. The database rule is RESTRICTIVE on all 17 tables, it is AND-ed in, and it never lets anyone in: I checked this by reading every policy and every definer that touches these items, and the builder's never-widen property test does fail without the sixth question. The people who always see an item are worked out live on the server, and crafted request bodies are refused. Two things block it:

1. **A widening through a routine flow.** "Use an existing file as evidence" copies a narrowed file into a new evidence document. Evidence never has an audience, so the copy reaches the people who were left out of the file: they see its title and can download it (P1).
2. **The mail withdrawal.** `app_set_audience()` deletes rows from the mail queue. The product owner asked to be consulted before anything deletes user data, and this was not raised. The delete also does not do its job: the mail sender reads the meeting past every rule and never checks the audience again, so an invite it has already claimed still goes to the person who was just left out, and the deleted row leaves no trace that it went (P5).

Six things should be fixed before or with the merge:

- A no-change save of an "only" list by someone else silently shuts out the person who set it (P4).
- Booking a meeting with an invitee who is left out in the same step is accepted, although adding that invitee afterwards is refused (P6).
- Old assistant chats about an item stay readable to someone later left out of it (P7).
- A follow-up's existing assignee can be left out of the meeting.
- The upload and booking forms can send a stale audience after the form changes.
- Four definer functions answer the app role about any item in any tenant (P2).

## Blocking

### B1. Attaching a narrowed file as evidence shows it to the people left out of it (a widening)

`apps/web/src/services/files.ts:322-394` (`attachExistingEvidence`). The function guards the label: line 334, "only files shared with the firm can be evidence". It also guards archived state and the virus scan. It does not guard the audience. It then inserts a new document with `purpose = 'evidence'`, `visibility = 'shared'`, no department, the same title, and a copy of the bytes (`copyObject`, line 393). Evidence can never carry an audience (`app_can_manage_audience` refuses it), so the copy is open to everyone who sees the action.

- **Failing scenario (probe P1, run):** at Al-Nukhba, the client's admin narrows "Salary review canary" to "everyone except" manager `nmgr`. A second manager in the same department, `nmgr2`, who still sees the file (it carries the "Limited audience" marker), owns an open action. In the Files picker he chooses "use this file" as evidence for it. As `nmgr`, `SELECT id, title, purpose FROM documents WHERE title = 'Salary review canary'` then returns the evidence copy, `{"title":"Salary review canary","purpose":"evidence"}`, and `createDownloadLink` gives her a signed URL to the bytes. Nobody was warned. The person who was left out gets the exact file the admin hid from her.
- The same copy also appears in the action's evidence list, the firm's review and the Files card, and the assistant reaches it through `evidence_submissions` (`assistant.ts:555`). The Excel exports list evidence-request titles, not file titles, so they are not affected.
- **Fix:** in `attachExistingEvidence`, refuse a source that has an audience (`audiencesForMe(...).has(id)` is not enough, because it answers about the caller only). Ask `EXISTS (SELECT 1 FROM item_audiences WHERE item_type = 'document' AND item_id = source)` through a small definer such as `app_document_narrowed(doc)`. Answer with a sentence in both languages: "This file is limited to some people; upload the evidence instead." Mirror it in the database: either make the copy go through a definer that checks, or have `check_evidence_document()` refuse an evidence row whose `sha256` and project match a narrowed document. Add the case to `tests/db/audience.test.ts`.

### B2. Queued meeting mail is deleted without the product owner's say, and the delete has a race that still sends the invite

`apps/web/drizzle/0111_audience_rules.sql:382-386` (inside `app_set_audience`) runs `DELETE FROM outbound_emails WHERE meeting_id = item AND sent_at IS NULL AND failed_at IS NULL AND <recipient now left out>`.

- **Consultation.** The product owner asked to be consulted before anything deletes user data. Neither the branch nor the hand-back raises this.
- **What the delete loses.**
  - The table has no status column. It keeps `sent_at`, `failed_at`, `attempts`, `next_attempt_at` (also the sender's claim) and `last_error`.
  - Each row is one mail, to one address, for one meeting (`meeting.invite` or `meeting.cancel`), so no other content is lost with it.
  - Digests (`follow_up.digest`) have no `meeting_id` and are not touched.
  - What is lost is the only record that an invite was queued for that person and withdrawn. Nothing audits it: `writeAudience` logs a count of people, not of withdrawn mails.
  - Deleting unsent queue rows does have precedent: a superseded password reset or sign-in link, and an erased user (`0000_baseline.sql:4107, 5986`, `0056`, `0025`).
- **The race (probe P5, run):** the lead books a meeting with `nmgr2` invited (one invite queued). Later he adds `nmgr` as optional and sends invites again, which queues `nmgr2` and `nmgr`. The mail job (`apps/web/src/jobs/mail.ts:40-79`) claims the batch. While it is sending the first mail, the lead leaves `nmgr` out (`setMeetingAudience`, committed). The job still delivers to `nmgr`, because it holds the claimed rows in memory. `meetingIcs()` (`mail.ts:83-127`) reads the meeting as the schema owner with no audience check. Result: delivered to `["nmgr2","nmgr2","nmgr"]`, and the `.ics` sent to `nmgr` carries the title "Pay committee canary", the time and the call link. The queue then holds 0 rows for her, so there is no trace that it went. The window is a few seconds per batch, but the claim "no invite reaches anyone left out" is not true.
- **Smaller gaps.**
  - The match is `lower(u.email) = lower(o.to_email)`, so an invite queued before the person changed their address is not withdrawn.
  - A client contact (no account) whose address equals a left-out user's address loses their invite too.
- **Recommendation.** Ask the product owner. Whatever they decide:
  1. Make the sender re-check at send time. For a row with `meeting_id`, skip it unless the address belongs to a client contact on the meeting or to a user for whom `app_audience_ok('meeting', meeting_id, user)` holds. This closes the race whatever happens to the rows.
  2. Instead of `DELETE`, mark the row. Add `withdrawn_at` (a column plus `AND withdrawn_at IS NULL` in the sender's claim and in `ops-check.ts`). Do not reuse `failed_at`: `ops-check.ts:31` counts `failed_at` rows as mail that "gave up" and would raise a false alarm.
  3. Put the number of withdrawn mails in the audit row's `meta`. It is a count, so no names.

## Should fix

### S1. Re-saving an "only" list shuts out the person who set it, and the picker hides them (borderline blocking: not a leak, but access changes with no one choosing it)

`0111_audience_rules.sql:73` (`target = setter THEN 'self'`) together with `:368-374`: locked people are never written to the list, and "self" means whoever saved last (`set_by`).

- **Probe P4 (run):** consultant `cons2` (staffed; not the uploader, lead or deputy) sets "only [nmgr2]" on "Open plan" and sees it, locked as "self". The firm admin opens the picker. Its `selected` list is `[admin, cons, deputy, lead, ncadmin, nmgr2]`: `cons2` appears neither as a chip nor as locked. The admin saves that list unchanged, and `cons2` can no longer open the file. The picker misstates who sees the item, and a save that changes nothing removes someone.
- **Fix:** when a save keeps or sets "only", write the caller onto `item_audience_people`. They are a real pick, not a frozen lock, and they stay removable later. Alternatively, keep the previous setter on the list when someone else saves. Add the case to the tests.

### S2. Booking a meeting with an invitee who is left out in the same step is accepted

`apps/web/src/services/meetings.ts:159-173` inserts the attendees before `:185-188` writes the audience, and `check_audience_attendee()` (`0111:463-471`) only runs on insert.

- **Probe P6 (run):** the lead books with `nmgr` (optional) invited and "except [nmgr]". This is accepted, and the builder's own fixture does the same at `tests/db/audience.test.ts:217-219`. `nmgr` stays on `meeting_attendees`. Everyone else's meeting page lists her (`["lead","nmgr","nmgr2"]`), and their calendar file names her address. She never gets an invite.
- **Same gap, after booking.** Leaving out an existing optional attendee is also accepted. She keeps the invite she already received, with its call link, and no cancellation is sent. This follows from "nobody is told", but it should be a decision.
- **Fix:** in `bookMeeting`, write the audience before the attendees, so the trigger refuses as it does in `addAttendee`, or refuse up front when an invitee is on the "except" list or missing from the "only" list. Decide with the product owner whether leaving out an existing attendee also removes them from the attendee list.

### S3. A follow-up's existing assignee can be left out of the meeting

`app_set_audience` (`0111:360-375`) checks locks only: the organiser, required attendees and the others. It never checks follow-up assignees. `check_audience_follow_up()` guards new assignments only.

- **From the code (not probed):** a follow-up of a meeting is assigned to manager X, and the meeting is then narrowed to "except [X]". X keeps a task she can no longer see: it is gone from her schedule and her Today. The firm sees it assigned to her and overdue.
- **Fix:** refuse leaving out an open follow-up's assignee ("give their follow-ups to someone else first"), or count assignees as locked.
- **A note on trigger order:** for a direct insert carrying only `meeting_decision_id`, the trigger `audience_follow_up` fires before `follow_up_rules`, which fills in `meeting_id`. The audience check then sees no meeting. `addFollowUp` always sets `meeting_id`, so this matters only for direct inserts.

### S4. Old assistant chats about an item stay readable after the person is left out

`ai_conversations` and `ai_messages` have no audience rule. The baseline hides a chat once its project is out of sight "otherwise a consultant taken off a client could still read old answers quoting that client's files" (`0000_baseline.sql`, Assistant chats, rule 1).

- **Probe P7 (run):** `nmgr` asked about the salary file, in a chat whose case is that file, before she was left out. After she is left out she still reads the chat, titled "Summarise the salary review", and the answer "The salary review canary raises grade 7 by 12%."
- **Fix:** add a RESTRICTIVE policy on `ai_conversations`: `case_type NOT IN ('document','meeting') OR app_audience_ok(case_type, case_id, app_uid())`. Through the existing subquery, the messages follow it. Decide whether an answer that cites a narrowed file's passage also goes. The citation labels are already looked up live and come back empty.

### S5. The upload and booking forms can send a stale audience

`apps/web/src/components/audience-field.tsx:69` keeps the picks across a new people list (`setState((cur) => cur ?? …)`) and does not call `onChange` again.

- In the upload dialog the field is re-mounted only when the project changes (`file-explorer.tsx:279`, `key={project.id}`), not when the label or department changes. The booking form (`meeting-form.tsx:388`) has no key at all, while its URL changes with every invitee and department.
- **Scenario:** a consultant leaves a client manager out with "Shared" chosen, then switches to "Firm only". The client people drop from the list, but the form still sends them. The server refuses with 400 ("pick only people who can already see it"), and the person sees only the generic error.
- **Scenario:** in the booking form, the organiser leaves Y out and then invites Y. Y becomes a locked required attendee, and the save is refused with no reason given.
- **Fix:** key the field on its URL (or reset the picks and call `onChange` when `people` changes). Map the database's refusals to sentences in both languages instead of `errors.invalid`.

### S6. Four functions answer the app role about any item, in any tenant, for anyone

`0111:412-415` grants `app_audience_ok(text, uuid, uuid)`, `app_audience_entity_ok`, `app_audience_side` and `app_audience_mine` to `selah_app`. All are SECURITY DEFINER. None checks that the caller can see the item.

- **Probe P2 (run).** As another client's admin, who reads 0 rows of the file:
  - `app_audience_ok(doc, NULL)` is `false`, which says the file exists and is narrowed.
  - `app_audience_ok(doc, nmgr)` is `false` and `app_audience_ok(doc, nmgr2)` is `true`, which says who is left out.
  - `app_audience_side(doc)` is `'client'`, and `NULL` for an id that does not exist, which makes it an existence oracle.
- As the left-out manager, `app_audience_mine('document', [doc])` returns `{mode: "except", listed: true}`. That function filters only on project visibility, not on the item's own audience.
- No route passes an arbitrary user or item id to them today. The services pass the principal's own id and ids already read under row-level security. So this is defence in depth, not a live leak.
- **Fix:**
  - Give the policies a two-argument `app_audience_ok(kind, item)` that uses `app_uid()`, and grant only that. Keep the three-argument form for definers (the assistant can use `app_uid()` too).
  - Add `AND app_audience_ok(a.item_type, a.item_id, app_uid())` to `app_audience_mine`.
  - Return `app_audience_side` only for a meeting or document the caller can see.
- Every definer on the branch does have `SET search_path = public, pg_temp`. The per-person helpers (`app_user_opens_project`, `app_user_sees_file`, `app_user_sees_document`, `app_user_sees_meeting(_as)`, `app_user_sees_item`, `app_audience_lock(_of)`, `app_audience_locked`, `app_audience_project`, `app_document_versions`) are revoked from PUBLIC and granted to nobody, which is right.

## Notes

- **N1. Archived files: the refusal is in the service only.** `documents.ts:190` refuses an archived file, but `app_set_audience` does not (P3, run: `SELECT app_set_audience('document', <withdrawn file>, 'except', …)` succeeds for the uploader). Add `state <> 'archived'` to `app_can_manage_audience` or `app_set_audience`.
- **N2. The never-widen database twin is empty for five tables.** `tests/db/audience.test.ts:287-320` compares row sets on all 17 tables, but no rows are seeded in `content_translations`, `document_summaries`, `info_request_files` or `assessment_evidence`, and no `ai_chunks` row of a meeting note. For those five, "it takes people away" is untested: dropping their policy would still pass. Also untested:
  - an information-request answer with an audience (commit `8324572`)
  - editing a meeting's audience through `PATCH /api/meetings/:id`
  - the mail race (B2)
  - the evidence copy (B1)
  - P4, P6 and S3
- **N3. "14 fail without the fix" proves little.** Without `0110`, `0111` and the services, `beforeAll` in `tests/db/audience.test.ts` throws (`setDocumentAudience` does not exist), so every test there fails without telling which rule each one pins. I confirmed the unit claim separately: with only the sixth question in `authorize()` switched off, `tests/audience-authorize.test.ts` fails 6 of 7 (the five property seeds and "a denial reads like any other"; "the picker is for firm staff…" pins `policy.ts`). Switching off one database piece at a time would show which tests pin which rule.
- **N4. Someone left out can still infer that a file exists.** An information request answered with a narrowed file shows "Received" to its owner even if she is left out of the file. The link row is hidden, but the status says a file exists. A signed download URL issued before someone was left out works until it expires (`DOWNLOAD_TTL_SECONDS`).
- **N5. Content copied by a person goes past the audience.** A meeting summary that cites a narrowed file hides the source row from people left out of the file, but not the summary text the summary's author wrote from it. This is a person copying content; consider warning when a narrowed file is added as a source.
- **N6. Audit labels.**
  - The new labels read differently from their neighbours. Arabic "تغيير من يرى ملفًا" is a verbal noun among past-tense verbs (`messages/ar.json:3863-3864`, next to "غيّر رمز مؤشر"); English "Who sees a file changed" sits next to "Changed an indicator's code". Suggested: "غيّر من يرى ملفًا / Changed who sees a file", and the same for meetings.
  - The audit's `people` count is what the form sent: on "only" it includes the locked people, who are not stored.
- **N7. Wording for a client.**
  - `audience.locked.clientAdmin` reads "مدير حساب العميل يرى كل ما يخص شركته دائمًا" ("the client's account admin…"). On the client's own items the client admin reads it, so it talks about "the client" to the client. On client items it should say "مدير حساب شركتك" ("your company's account admin").
  - `locked.firmAdmin` calls the firm admin "مدير الشركة", where elsewhere the firm is "المكتب". It should be "مدير المكتب".
  - "جمهور محدود" ("limited audience") is a translation of the English. It is clear enough, but plainer would be "يراه بعضهم فقط" ("only some people see it").
  - The other new strings (`menu`, `dialogTitle`, `dialogHint`, `loadFailed`) are natural Arabic and speak to the reader. Each screen keeps one solid button: Save in the audience editor is outline; the share dialog's primary button is the one main action.
- **N8. A misplaced comment in the seed.** `scripts/walkthrough/files.ts:78`: the new file was inserted between `nukhbaPrivateNotes` and its comment. The comment "The consultant's own working notes: firm-only…" now sits above the restructuring proposal, which is shared.
- **N9. Missing person.** Leaving out someone who could not see the item is refused, using the per-person mirror `app_user_sees_file()`. For action owners that mirror follows `authorize()`: own uploads, department and shares. Row-level security alone would let an owner read a non-department file. The picker therefore never offers such an owner, which is consistent with what the screens show.
- **N10. The spec's "meeting series" does not exist in the schema** (no series or recurrence columns). Projects never move a file or a meeting between projects; `app_move_department_work` only changes the department, and an audience survives it.

## Checked and found sound

- **Never widens.** All 17 `audience` policies are `AS RESTRICTIVE` (confirmed in `pg_policies`, 17 rows on `selah_test_r`). `authorize()` asks its sixth question last and only ever denies (`authorize.ts:77-78`, `checkAudience`). Locked people pass only the audience check, never the other rules. In `pg_policies`, the only permissive policies that name the audience are `manage_read` on the two audience tables. Inside the permissive meeting rules, `app_audience_ok` is always AND-ed (`app_can_see_meeting`, `app_meeting_open_to_me`). The one `OR` in any function is `reader IS NULL OR app_audience_ok(...)` in `app_meeting_agenda`, where a NULL reader means the agenda is being written at booking.
- **Definers that read these items past row-level security.** I listed every function in `public` whose body names a document or meeting table (56 functions). The ones a reader can reach ask the audience:
  - `app_can_see_meeting`, `app_meeting_open_to_me`, and through them `app_can_run_meeting`, `app_meeting_agenda_for` and the attendee, decision, summary and transcript rules
  - `app_meeting_agenda` (its "last held" counts only meetings the reader opens)
  - `app_send_meeting_invites`

  The rest are triggers, purge, archive or evidence functions, or run with the caller's rights (`app_trace`, `app_translation_source`). All three views are `security_invoker`. `app_mask_terms` holds names only. No notification today uses the entity types `document` or `meeting`, so `drop_left_out_notification` is a guard for later. The digest mail carries no content, only a link to `/notifications`. Status packs, metrics, oversight and the client overview count no documents or meetings.
- **Commit `a1ce57d`, `app_user_opens_project(target, pid)`.** It equals `app_can_see_project()` for the caller (latest definition: `0008`), and is no broader:
  - It calls `app_user_sees_project` (the baseline), plus a consultant with an active membership in the project's firm who is the client's lead or deputy on a client project. That is exactly `app_is_client_lead` (`0051`).
  - `client_assignments` has no end dates: ended assignments are deleted rows.
  - The client-admin "draft project" difference is covered by `app_user_sees_file`/`_meeting_as` (`p.state <> 'draft'` for client people).

  It is used only inside `app_user_sees_file` and `app_user_sees_meeting_as`, which serve the picker's list, the locked chips and the "could already see it" refusal. It is in no policy and not granted to the app role.
- **Locked people are worked out live and never trusted from the page.** I sent crafted bodies:
  - leaving out the setter (self), the uploader, the client admin, the firm admin, the lead or the deputy: refused
  - another client's admin: "pick only people who can already see it"
  - firm people on a client's own item: "your company's people"
  - an empty "only" list: refused in the service and in the function
  - "only" with only locked people: stored with nobody on the list and seen only by the locked people, which matches the picker's rule that locked chips count

  A deputy named after an "only" list was saved is let in (tested).
- **Who may change it.**
  - Client managers, action owners, observers, the other side, evidence, a closed project and someone left out: 404 or "not allowed", in `authorize()` (`document.audience`, `meeting.audience`) and in `app_can_manage_audience`.
  - A client admin cannot change a firm item's audience, and the firm cannot change a client item's.
  - For meetings, managing the audience follows `app_can_see_meeting`. That is the same as running it for firm staff (`app_can_run_meeting` lets any firm person who sees the meeting run it).
- **Refusals for people left out.**
  - Inviting someone left out after booking, making them required (the role change is checked against the old row, so it is refused) and giving them a new follow-up: refused (tested).
  - A one-by-one share is refused by the trigger, and the app has no share screen. No code inserts into `document_shares`.
- **Versions.** All versions carry the rows (`app_document_versions`, `copy_item_audience`). Deleting an item drops its audience.
- **Audit.** `writeAudience` logs the mode before and after and a count, never ids or names (`audience.ts:213`; tested). Errors that name a refusal go only to the person changing the audience, who may see the list anyway. Someone left out only ever gets 404, the same as a missing record.
- **The assistant.** `scopeFilter()` puts `app_audience_ok` inside the search's `WHERE`, with the principal's id. Citations and linked records are read under the person's own row-level security. `services/ai` keeps no index of its own: passages live only in `ai_chunks`.
- **Migrations.** `drizzle-kit check` reports "Everything's fine". `drizzle-kit generate --name probe` reports "No schema changes" and created no file. Synthetic data only; the walkthrough firm is the fictional one.

## Check results (on `selah_test_r`, TZ=UTC)

| Check | Result |
|---|---|
| `npm run lint` | passed (exit 0) |
| `npm run typecheck` | passed (exit 0) |
| `npm test` (unit) | 38 files, 578 tests passed, 0 failed |
| `npm run test:db` (run as `vitest --config vitest.db.config.ts --hookTimeout 120000 --testTimeout 120000`) | 74 files, 971 tests passed, 0 failed. My first run used the default 10 s hook timeout. Its first file, `assessments.test.ts`, skipped all 17 tests because their setup timed out: the machine was running the lead's walkthrough and two other helpers' suites at the same time. I stopped that run and ran the suite again with longer timeouts, and it passed. Not caused by the branch. |
| `npx drizzle-kit check` | Everything's fine |
| `npx drizzle-kit generate --name probe` | No schema changes, nothing written |
| `tests/audience-authorize.test.ts` with the sixth question switched off | 6 of 7 failed (as the builder said), then restored |
| Reviewer probes P1 to P7 (throwaway file, deleted) | all 7 confirmed the behaviour described above |
