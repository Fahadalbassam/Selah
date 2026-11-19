# Batch 4 review (branch `batch4/action-page`, 11e3e2d + 73c31af on 9336206)

Independent adversarial review, 19 Nov 2026. I fixed nothing and committed nothing. The probes ran against `selah_test_u` from a temporary test file in the reviewer's own worktree, which I deleted afterwards. The mutants were applied to that database and then restored.

## Verdict

**Not ready to merge as it stands. One blocker, and it is about merging, not security.** The branch does not merge cleanly onto current `main` (fec20f9). After a merge its own test fails, and the migration's snapshot is out of date.

On the substance, the D1 rules hold everywhere I attacked them. That covers who may, own organisation only, the status not changing, drafts, finished actions, other clients, switched-off people, typed names, who is told, and the audit row. Item 12 cannot skip a sign-off, accept an item without a file, or change who may verify. I found no leak to client readers.

Four things should be fixed before or with the merge:
- The "given to you" line and the owner history line never reach the people they are written for.
- A sent-back action can get stuck in the new one-step flow.
- "Reassign their actions first" opens the switch-off dialog.
- The project activity tab shows the new event as "made a change".

## Blocking

**B1. It does not merge onto current main, and the migration must be regenerated after the rebase.**
- `apps/web/drizzle/meta/_journal.json`: the branch adds `0240_action_owner` as idx 98. Main already has 0098, 0099 and 0100 at idx 98 to 100. Trial merge (`git merge --no-commit origin/main`, then aborted): `CONFLICT (content): Merge conflict in apps/web/drizzle/meta/_journal.json`.
- `drizzle/meta/0240_snapshot.json` has prevId = the 0097 snapshot, so it lacks main's `org_chart_plans` schema. Its name also sorts last. `drizzle-kit generate` diffs against the last-sorting snapshot (build brief), so the next generate would try to create `org_chart_plans` again, or report drift. The number 0240 also skips 0101 to 0239.
- After the merge, `tests/action-page.test.ts` "only the one dialog has a file field" fails. Main's `app/(app)/clients/[id]/structure/import/import-wizard.tsx` has two `type="file"` inputs (lines 284 and 299). Seen: `× only the one dialog has a file field … + "app/(app)/clients/[id]/structure/import/import-wizard.tsx"`. It is an import (a workbook or document read in), so it belongs in `IMPORTS`. Either way the test fails until someone decides.
- Main also changes `team/departure-dialog.tsx`, which S3 touches. Re-check S3 after the rebase.

Fix: rebase onto main, renumber the migration (0101), regenerate its snapshot from 0100, then run `drizzle-kit check` and the "No schema changes" probe. Add the org-chart import wizard to `IMPORTS`.

## Should fix

**S1. "This action was given to you" and the history line "gave it to …" are invisible to the new owner and to every client reader except the client admin.**
- `services/queries.ts:779-790` reads `activity_events` under the reader's row policy. Since 0071 (`scoped_read`) that policy lets only firm staff and the client admin read activity.
- `actions/[id]/page.tsx:170-192` therefore never builds `givenToMe` for an action owner, a coordinator or a sponsor.
- Probe P1, after the coordinator gave A.open to owner2: timeline entries of kind "owner" were 0 for owner2 (the new owner), 0 for the coordinator, 1 for the client admin and 1 for the staffed consultant. owner2 reading the `owner_changed` rows directly: 0.
- So page audit 4.5 block 2 ("this action was handed over to you") does not work for its reader. `docs/placement.md` ("It shows as one history line on the action") and the dialog's own line `ownerChange.told` ("recorded in the action's history") are untrue for client readers.
- Fix: a SECURITY DEFINER reader guarded by `app_can_see_action`, like `app_action_refilings` (0071), returning only at, actor and to for this action. Add a test as the new owner.

**S2. A sent-back action whose revised file was "saved without sending" cannot be sent for review without uploading again.**
- The dialog defaults to review, but on a sent-back action it lets the owner choose "Save without sending". The file is stored and the status stays `revision_requested`.
- The page then offers only "Send the revised file for review" (`lib/action-next.ts`, revision_requested branch). With no new file, `send-file.tsx:75-79` posts `transition {to:"awaiting_review"}` from `revision_requested`. The server has no such move.
- Probe P2: `revision_requested -> awaiting_review` was refused (forbidden, so a 404 and the generic error on screen). `revision_requested -> in_progress` is allowed, but the page no longer offers "Resume work" for that state.
- The only way out is to upload a file again, or pick the same file again from "Choose from Selah files", which makes a duplicate submission.
- Fix: when there is no file and the action is `revision_requested`, move it through `in_progress` first, as `submitEvidence` and `files.ts:410` already do. Or hide "Save without sending" in that state. Add a test.

**S3. "Reassign their actions first" sends an admin to the Switch-off dialog, which hands over everything the person holds on every project.**
- Where: `projects/[id]/project-people.tsx:100-113` links to `/team?handover=<id>` (the client admin) or `/clients/<id>/people?handover=<id>` (the firm admin). `team/people-panels.tsx:108` then opens `"off"`, which is `DepartureDialog`, the switch-off flow (F26).
- Scenario: a client admin wants to take Sara off one project. She clicks the link and lands in "Switch off Sara". The one-step hand-over there (`app_hand_over`, kind `action`) moves Sara's open actions on every project to the colleague, not just this project's.
- The switch-off button stays disabled until a reason is typed, so nobody is switched off by accident. But the hand-over is easy to over-apply.
- The audit asked for "the link … to the hand-over on Team", and the only hand-over on Team is this one. So it is a product question: either a hand-over that does not switch anyone off, or the per-project action list that non-admins already get here (`actionsHref({project, owner})`), where each action has its own D1 control.

**S4. The project's activity tab shows the new event as "made a change".**
- The page tries `project.events.action_owner_changed`, then `project.events.owner_changed`, then falls back to `events.other` (`projects/[id]/page.tsx:703-709`). Neither key exists under `project.events`. The `owner_changed` key sits under inquiries, and `action_owner_changed` under notifications.
- Add the Arabic and English line ("gave an action to a colleague").

**S5. Two of the database rule's clauses are not pinned by any test.** These are SQL mutants run on `selah_test_u` against `tests/db/action-owner.test.ts` and `tests/db/follow-through.test.ts`:

| Mutant | Result |
|---|---|
| m1: any client manager may | 4 tests fail (good) |
| m2: owner and status changed in the same step | 1 test fails (good) |
| m3: old owner's notice on the action | 3 tests fail (good) |
| m5: verified or closed actions allowed | 2 tests fail (good) |
| m7: no lead or deputy notice | 1 test fails (good) |
| m4: `p.state <> 'closed'` removed | **all pass** |
| m6: firm observer clause removed | **all pass** |

- m4 and m6 are covered today by the service: `authorize()` treats a closed project as read-only and refuses an observer before the database is asked.
- But `check_action_transition` checks the D1 rule only for client users (`is_client`). For the firm side the database rule is read only by the services, so nothing pins those two clauses.
- Add a closed-project case and a firm-observer `app_can_change_owner()` case, or say in the docs that the firm side is enforced in the service.

## Notes

- **N1. The notice function can be used to send false notices.** `app_tell_owner_changed(aid, old_owner)` (0240) can be called by anyone allowed to reassign, without a change being made and with any active colleague as "old owner". Probe P5: the client admin called it for A.open with the plain manager as old owner. The manager got `action.owner_moved` and the lead, the deputy and the staff got `action.owner_changed`, though nothing changed. No HTTP route reaches it, but "cannot be used to send notices" (docs) is only half true. Harden it: read the old owner from the latest `owner_changed` event in the same transaction, or refuse when the owner equals the last recorded one.
- **N2. Item 12 with two sign-offs.** The `if (state?.required) throw` guard (`services/actions.ts:197`) has no test. But probe P3 shows `app_sign_off()` already refuses the first sign-off while an item is only submitted ("every evidence request must be accepted or waived first"). So by the time a second reviewer verifies, every item is already settled, and `acceptItems` cannot skip the first reviewer's judgement. Item 12 otherwise holds:
  - `canTransition` runs first, so a submitter, the owner or a client is refused (test plus code).
  - An item with nothing sent blocks the step (a test that fails without its rule).
  - `decided_by` is the verifier.
  - Firm-run clients go through the same submitter rule.
- **N3. Too many notices.** Verifying with `acceptItems` sends the owner one `evidence_request.accepted` notice per item plus `action.verified_complete`.
- **N4. The verify button mixes the two verbs.** It is labelled "Accept and verify / قبول واعتماد", while `docs/placement.md` keeps Accept for parts and Verify for the action. Batch 5 vocabulary.
- **N5. Unenforced job-title rule.** `docs/rules.md` cites `refuse_minimal_records()` for D1. That trigger is on documents and contacts; the job-title rule is a hint in the screen only. The `minimalOwner` error mapping in `action-panel.tsx` (it looks for "job title") is never produced by the server.
- **N6. Lost e2e check.** `e2e/core-flow.e2e.ts` lost the bug #11 check (verifying with an open item shows the right error), and nothing replaces it. I could not run the e2e suite.
- **N7. Wrong hint on internal projects.** `sendFile.afterHint.review` ("Your consultant is told") also shows to a consultant owner on an internal project.
- **N8. Builder's choices, consistent with the docs:**
  - the firm admin and the client's deputy may reassign without being staffed;
  - "Not an item on the list" is offered in the file dialog, while the audit text says a file always goes to an item;
  - the "this is an update on the work" checkbox stays, and on a client the firm runs it adds the "how and when" fields;
  - nobody is told about a draft;
  - the audit row holds ids only (probe: `{from, to}` ids, `typed` for a name).
- **N9. Weak tests.** `tests/client-pages.test.ts` uses source regexes (`canMute: true`, `<ActionPageMenu`) that pin text, not behaviour.

## Attacked and held (with probes)

**D1 permissions:**
- Refused (404): a plain manager, the action's own owner, another owner, a firm observer, a consultant on nothing of the client's (tests and probe P4).
- The database refuses a plain manager straight in SQL.
- `app_can_change_owner` is false for the client admin on another client's action (P6).
- A department-limited coordinator goes through `app_can_see_action` → `app_action_dept_ok` (0087), so another department's action is refused (by reading the code; not probed).
- Targets: a switched-off colleague and a firm user are both refused ("must be on the project team", P6); someone off the project or at another client is refused (test).
- A typed name on a client with accounts is refused from the firm too (P4).
- Firm-run clients cannot have client accounts ("this client is managed by the firm and has no accounts", P7), so the client-side typed path is moot.
- `updateAction` follows the same rule: the coordinator may, the plain manager and the observer may not; a client's `ownerName` and a verified action are refused (P4).

**State:**
- The status is unchanged (test, and m2 is caught).
- A draft only by the firm, telling nobody.
- Verified or closed refused (m5 caught).
- A closed project: see S5.

**Who is told:**
- the new owner on the action; the old owner on the project only, with text that names the project and not the action (test, m3 caught);
- the lead, deputy and staffed consultants (m7 caught); never the observer or the person who made the change;
- the hand-over (`app_hand_over`) is still allowed for the client admin under the new trigger: it excludes drafts, closed projects and finished actions, the same as D1.

**The one dialog:**
- Every caller keeps its own endpoint and checks.
- The audience picker is still sent from the project upload and the request answer (`file-explorer.tsx:197`, `info-requests-tab.tsx:389`).
- Evidence has no picker, as before (#175).
- The signed-out page still posts to its token endpoint, with only the shared `FileField` and error mapping added.
- Scans, sizes and types are decided on the server, unchanged.

**The client view:**
- Not drawn for client readers: the ladder, date history, sign-off count, firm notes, reviewers' names (`reviewers` is computed only for firm principals) and the judged-files block.
- `nextStep` offers only moves from `canTransition` and the follow-through rights.

## Check results (`selah_test_u`, reset and migrated from empty)

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test`: 54 files, 824 tests passed.
- `npm run test:db`: 85 files, 1232 tests passed.
- The SQL mutants (S5) and probes P1 to P7 are described above.
- Trial merge with `origin/main`: conflict in `_journal.json`; `tests/action-page.test.ts` then fails 1 of 17. Merge aborted, worktree clean.
