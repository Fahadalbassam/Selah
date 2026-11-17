# Review: D6, draft actions hidden from clients (branch `batch0/drafts-hidden`)

Reviewed at commit `36f61f4` ("D6: a draft no longer withholds the stored agenda from a manager"), against `origin/main`, in the worktree `C:\Projects\selah-fresh\.claude\worktrees\agent-ac7f1dee3f216d891`. Read only there. Paths are relative to `apps/web` unless they start with `docs/`. The `DELETE FROM notifications` that the builder removed from `0076` is not reported.

Database work ran on `selah_test_r` only (reset, then `npm run db:migrate` on an empty schema, `TZ=UTC`). Two throwaway probe scripts, kept outside the repository, ran SQL as `selah_app` with `selah.user_id` set, the way the tests do. Their results are quoted below as "probe".

**Count: 0 blocking, 3 should fix, 10 notes.**

## 1. Findings, most serious first

| # | Severity | Where | What is wrong | How I know | What to do |
|---|---|---|---|---|---|
| 1 | **should fix** | `drizzle/0076_drafts_hidden.sql:17-21` (`coalesce(..., true)`), used by the `draft` policies on `activity_events` (`:82-84`), `notifications` (`:94-95`) and `content_translations` (`:86-88`); drafts are deleted in `src/services/plan-changes.ts:194-198` (`withdrawRecord`) and `:236` (`deleteRecord`) | `app_action_visible_to_client()` answers *true* when the action no longer exists. Only drafts can be deleted, so a missing action under `entity_type = 'action'` is always a former draft. Once the firm deletes a draft (for example by withdrawing its recommendation), the draft's activity events, written with the default `shared` visibility (`src/services/plan.ts:293-301`), come back into the client admin's Activity tab. The tab reads "Lead added an action" (`messages/en.json` `project.events.created`, page `src/app/(app)/projects/[id]/page.tsx:695-700`), plus "commented on an action" for each firm comment, for an action the client never saw. | Probe: draft with a `created`/`draft` event, client admin reads `[]`. The lead deletes the draft (`DELETE` returns 1), and the client admin then reads `[{"event":"created","entity_type":"action","to_state":"draft"}]`. | In the three "rows about an action" policies, treat a missing action as hidden for a client: `app_org_kind() = 'firm' OR EXISTS (SELECT 1 FROM actions a WHERE a.id = entity_id AND a.status <> 'draft')`. That needs a second function or a parameter, because the child-table policies must keep "missing passes" for rows with a NULL `action_id`. Or delete a draft's activity events when the draft is deleted, since the client never saw it, as the delete dialog already says ("nothing is kept"). Add the case to `drafts-hidden.test.ts`. |
| 2 | **should fix** | `drizzle/0076_drafts_hidden.sql:301-325` (release re-check); `src/server/http.ts:316`; `src/app/(app)/actions/[id]/action-panel.tsx:55-73`; `messages/en.json:470`, `messages/ar.json` (`action.errors`) | A client admin can now switch off someone named on a draft without being stopped. Nothing tells the firm, and `v_deviations` "orphaned" excludes drafts. The firm learns of it only when it presses Release. The trigger then raises `the owner must be an active member of the project team`, a 23514 with no constraint, so the API returns 409 with that text. The action panel matches none of its phrases and falls back to 409 → `conflict`: "Someone else changed this action. Reload to see the latest." / "غيّر شخص آخر هذا الإجراء…". Reloading never helps, and the firm is not told to name another owner. | Read the code path. The DB error is proven by the branch's own test (`drafts-hidden.test.ts:469-472`) and by my probe (owner taken off the team, then release, gives the same error). No message key for this case exists in either messages file. | Map `"owner must be an active member"` in `send()` to a new key (en: "The owner has left or is no longer on the project team. Name another owner, then release." ar: "المسؤول عن هذا الإجراء غادر أو لم يعد ضمن فريق المشروع. اختر مسؤولاً آخر ثم أرسله."). Better still, show it on the draft before the click: the firm's action page can show that the owner is inactive or off the team. Optionally tell the client's lead (firm) when a client admin switches off someone named on a draft. |
| 3 | **should fix** | `drizzle/0020_project_closure.sql:331-360` (`app_dispose_action`, no status rule beyond "finished"); `drizzle/0059_closure_settles_actions.sql:26,30` (`app_close_project` closes only `app_action_open()`, which excludes `draft`); `src/services/closure.ts:65-66` (the firm's list includes drafts) | At closing, the firm can mark a draft "handed over" to the client and name a client person to sustain it. After D6 the client never sees that action. Closing leaves it a `draft` for ever, hidden from the client admin and from the named sustainer, and its closure item is hidden too. So the closure record says work was handed to the client, while the client has no way to see it. (A "withdrawn" draft also stays `draft` in a closed project. That behaviour predates this branch and is harmless now that it is hidden.) | Probe: `app_dispose_action(draft,'handed_over',…, own1)` ok. Close project ok. Statuses after close: the handed-over draft is still `draft`. `own1` and the client admin read only the released action and its item. `app_name_sustainer` by the client admin on it gives `no such handed-over action`. | In `app_dispose_action`, refuse `handed_over` for a draft ("release it first, or withdraw it"), or release handed-over drafts at close. Hide or disable that choice for drafts in the closure screen. Add a closure-with-drafts case to the tests (none exists today). |
| 4 | note | `drizzle/0050_status_packs.sql:122-163` (`app_queue_digests`, latest definition; the update-kinds branch at `:138`) with the kept notices (`0076:90-95`) | Notices about drafts written for client people before 0076 are kept and hidden. The digest job runs as owner and does not apply the rule. For anyone whose update mails are daily or weekly, an unread, unmailed notice from the last 8 days queues a "you have something new" mail to `/notifications`, where the person finds nothing. At release the same notices reappear in the list, with their old dates and still unread, beside the new "released to you" notice. One-off, after deploy only, because the trigger drops new ones. | Probe: legacy `action.commented` for `own3` about a draft; `own3` reads `[]`, cannot mark it read (UPDATE count 0); `app_queue_digests()` then queued one `follow_up.digest` to `own3`. | Mark those rows `mailed_at = now()` in the migration (not a delete) so the digest skips them. Accept the reappearance at release, or also set `read_at`. Say so in `docs/authorization.md` "Telling people". |
| 5 | note | `drizzle/0032_department_move.sql:55` (`department_moved` event, `entity_type = 'project'`); activity tab `src/services/queries.ts:374-390` | When the firm admin moves a department's work and the only work there is a draft, the client admin's Activity tab still shows "moved a department's unfinished work to another department". The row's `meta.actions` holds the draft's id, though the app does not show `meta`. A trace of a draft, not its title. | Probe: dry run counts `actions: 1` (the draft). The client admin reads the event with `meta.actions = [draft id]`, and `app_action_refilings(draft)` returns `[]`. | Leave drafts out of the move's event (or skip the event when only drafts moved), or accept it and document it. |
| 6 | note | `drizzle/0000_baseline.sql:1782-1786` (superseded successor rule); `src/services/follow-through.ts:194-203` | The firm may close a released action as "superseded" by a draft, and the replacement list offers drafts. The client then sees "Closed as superseded" with no "Replaced by" line until the draft is released. The raw `superseded_by` id is in the row it reads. | Probe: lead closes the released action as superseded by a draft (1 row). The client manager reads `closure_outcome: superseded, superseded_by: <draft id>`, and the successor gives `[]`. | Allow only a released successor (DB rule and replacement list), or show "a replacement is being prepared" to clients. |
| 7 | note | `drizzle/0076_drafts_hidden.sql:17-25` | `app_action_visible_to_client()` is executable by `selah_app` and answers false for a draft id, true for an unknown id. It is an oracle that tells draft ids from non-existent ones. Clients cannot run SQL through the app, and ids are random, so this is theoretical. The same holds for the RLS-versus-foreign-key error text on an insert under a draft. | Probe: `(draft, released, missing) → (false, true, true)`. | Fine to keep. If finding 1 changes the function, make missing ids answer false for clients too. |
| 8 | note | `src/services/queries.ts:78-82` | The Projects card now counts released work for the firm too, so the firm's number drops by its drafts. That is a firm-visible change outside D6 ("firm roles see drafts exactly as before"), justified by page audit B2 and documented in `docs/walkthrough.md`. Lists are unchanged. | Code; `drafts-hidden.test.ts:368-372` asserts 3 for the firm. | Confirm with the product owner that B2 is meant to ship in this PR. |
| 9 | note | the thread on a draft (`src/services/comments.ts`), `drafts-hidden.test.ts:439-440` | After release, every comment the firm wrote on the draft becomes readable by the client. That is by design, and the test asserts it. But D6 now tells the firm that a draft is "the firm's", so a consultant may treat the draft's thread as private. Firm notes (`action_notes`) are the private place. | Test and docs. | Add a one-line hint in the thread composer on a draft (both languages): the client reads this thread once the action is released; use a firm note for internal remarks. |
| 10 | note | `drizzle/0076_drafts_hidden.sql:82-95` | The new RESTRICTIVE policies on `activity_events` and `notifications` call a SECURITY DEFINER SQL function per row. Such a function is not inlined, and it calls `app_org_kind()` again for every row, even for firm users. Status packs and the activity tab scan `activity_events`. | Read; not measured. | Measure on a production-sized copy. If it is slow, test `app_org_kind() = 'firm'` in the policy before calling the function, so the firm short-circuits. |
| 11 | note | `messages/ar.json:2742` (`plan.action.releaseHint`) | "لا يراها أحد لدى العميل، ولا المسؤول عنه" reads as "nor its owner". The English says "the owner included". "حتى المسؤول عنه" is the more natural way to say "even its owner". Both changed keys exist in both files, and the second (`planImport.review.releaseHint`) reads well. | Read. | "يُبلَّغ فوراً. وإلا يبقى مسودة لا يراها أحد لدى العميل، حتى المسؤول عنه، إلى أن يرسله فريق الشركة." |
| 12 | note (pre-existing, related) | `drizzle/0071_activity_readers.sql:10-14` (policy `scoped_read` on `activity_events`); `src/services/plan.ts:293-301`, `src/services/actions.ts:241` write events without a label | Not introduced here, found while checking finding 1. Activity events of an action under a firm-only recommendation keep the default `shared` label, so the client admin reads them ("added an action", status changes) while the action itself is hidden. The D6 policy checks only `status`, not the label. | Probe: client admin reads the firm-only action `[]` and its event `[{"event":"created","to_state":"assigned","visibility":"shared"}]`. | Separate fix: label the events, or extend the policy to `app_action_label_ok(entity_id)` for `entity_type = 'action'`. |
| 13 | note (tests) | `tests/db/drafts-hidden.test.ts` | Parts of the decision with no test: closing a project with drafts (finding 3); the firm admin's hand-over moving a draft (my probe: it moves, `app_hand_over` returns 1); `app_name_sustainer` and `app_action_refilings` refusing a draft; Today (`src/services/today.ts`) and the Files card (`src/services/files.ts`) changes; a deleted draft (finding 1); release when the owner left the team (not only switched off); activity events appearing at release. Counts on the client page, department page, group roll-up and status pack rely on older `status <> 'draft'` filters, which `client-overview`, `client-groups`, `status-pack` and `metrics` tests already cover. | Read; grep of `tests/db`. | Add the closure, deleted-draft and hand-over cases at least. |

## 2. Checked and found sound

**Migration and build**
- `0076` and `0077` read in full. `0076` now has no `DELETE`.
- Fresh migrate on `selah_test_r`: "migrations applied". `npx drizzle-kit check`: "Everything's fine". The snapshot chain 0075 → 0076 → 0077 is intact (`prevId`s match, content equal; policies are not modelled in TypeScript).

**Each redefined function against its previous latest definition**

| Function | Previous definition | What changed |
|---|---|---|
| `app_can_see_action` | `0019` | Draft clause only |
| `app_user_sees_action` | `0046` | `a.status <> 'draft'` in the client branch only |
| `app_owns_action_under` | `0021` | — |
| `app_second_review_state` | `0062` | — |
| `app_name_sustainer` | `0020` | — |
| `app_person_holdings_of` | `0034` | Two lines (diffed) |
| `drop_hidden_action_notification` | `0006` | The `OR a.status = 'draft'`; still an inner join to `recommendations`, and `recommendation_id` is NOT NULL |
| `check_action_owner` and trigger | `0034` / `0000` | Release clause; trigger now also `UPDATE OF status` |
| `app_reads_all_actions` | `0072` | One line |

None lost a condition, a label, department or firm-private check, `SECURITY DEFINER` or `search_path`. `CREATE OR REPLACE` keeps grants. The new function is revoked from PUBLIC and granted to `selah_app`.

**Policies**
- Every table with a foreign key to `actions` that `selah_app` can read carries a RESTRICTIVE `draft` policy for ALL commands (query on `pg_constraint` and `pg_policies`): `progress_updates`, `evidence_submissions`, `evidence_requests`, `reviews`, `review_signoffs`, `risk_acceptances`, `deadline_change_requests`, `action_notes`, `action_comments`, `action_due_changes`, `action_reminders`, `follow_ups`, `mail_mutes`, `project_closure_items`, and `actions` itself.
- `follow_up_log` has no app grant.
- `notifications` is SELECT-only. That is enough: UPDATE with a WHERE also applies it (probe: mark-read count 0), and there is no DELETE policy.

**Definer functions**
I listed all 90 SECURITY DEFINER functions that touch `actions` or its children and read each one a client can reach.
- **Firm-only by their own check:** `app_closure_blockers`, `app_dispose_action`, `app_clear_disposition`, `app_second_reviewers`, `app_sign_off`, `app_team_*`, `app_move_department_work`, `app_client_last_active`, `app_archive_blockers`, `app_write_lessons`.
- **Already exclude drafts:** `app_client_group_rollup`, `app_actions_left_out`, `app_meeting_agenda` (via `app_action_open` and `app_changed_actions`), `app_follow_ups_due`, `app_draft_status_packs`, `covered_project_starts`.
- **Updated here:** the functions in the table above.
- **Harmless:** `app_mask_terms` (server-side masking list), `app_evidence_accepted` and `app_submitted_this_round` (the caller's own rows), `app_notify_*` (the trigger drops client recipients). `app_report_pack_for` returns a pack built by `app_status_pack`, which excludes drafts.
- **Views and invoker functions:** `v_project_metrics`, `v_deviations` and `v_schedule` are `security_invoker` and exclude drafts. `app_project_progress`, `app_client_progress`, `app_status_pack`, `app_action_slips` and `app_changed_actions` exclude drafts. So health weeks, metric snapshots, status packs, the client page, department page, group roll-up, Today's "changed", the agenda and calendar entries cannot move because of a draft.

**Notices and mail**
- On `notifications`, the BEFORE INSERT triggers fire in name order: `hide_private_action` before `mail_action_notification`. A dropped notice is never mailed (the branch test asserts no `outbound_emails` row).
- Firm comments on a draft do not notify client people (`app_user_sees_action`), and a mention of one is refused.

**The release moment**
- Owner told once: one `action.assigned` row (test).
- No due-date history while a draft (`record_due_change` skips `OLD.status = 'draft'`), and the baseline is set at release (`keep_baseline`), so slips start from release.
- No reminders while a draft (`app_owner_holds`), and `check_action_reminder` refuses drafts.
- Activity events from the draft period appear at release with their true dates. That is history, not a duplicate.

**Regressions**
- Firm roles pass every new check through `app_org_kind() = 'firm'`. Observers, deputies and staffed consultants read drafts as before; the full suite passes.
- Closing a project with drafts still works (probe).
- The firm admin's departure report lists a draft and blocks on it. The firm admin's hand-over moves it, and no one is told (probe). The client admin's report hides it, the switch-off is not blocked, and the draft stays put (test).
- Internal projects and consultant-managed clients (no `owner_user_id`) skip the new release check or pass it as before.
- Walkthrough seed read: only a comment changed, and no later step touches the draft as a client.

**Services and exports**
- The Excel exports (test) and the export pack (`export-pack.ts:118`) leave drafts out for everyone.
- The assistant scope filter adds `a.status <> 'draft'` for client scopes. Old citations resolve labels live under RLS, so they show "not available".
- `actionLadder` now asserts `action.read` before calling the definer.
- `authorize()` denies `action:draft` after the label check for any non-firm principal.

**Tests**

| Run | Result |
|---|---|
| `tests/db/drafts-hidden.test.ts`, `ai-sources`, `follow-through`, `privacy-leaks` (first run, before the builder's `0077`) | All passed except the agenda case, which `0077` then fixed |
| Full DB suite on the final commit | 65 files, 864 tests, all passed (600 s) |
| `tests/authorize.test.ts` | 75 passed |

**Docs**
`docs/authorization.md` "Draft actions", `rules.md`, `data-model.md`, `meetings.md`, `assistant.md` and `walkthrough.md` match the code, apart from findings 1, 3 and 4.

## 3. Could not check
- The walkthrough seed was not run, so the walkthrough's "lists 8 / card counts 8" was not checked on real data.
- No browser check of the action panel, closure screen or activity tab. Findings 1, 2 and 5 are from code and SQL.
- The cost of the per-row policy functions on production-sized tables (finding 10).
- How many notices about drafts production holds for client people (finding 4).
- Whether each test in `drafts-hidden.test.ts` failed before the change, as its header says. It was not run against a database at `0075`.
- Report PDFs were not rendered. Their data comes from `app_report_pack_for` and `app_status_pack`, both checked above.
