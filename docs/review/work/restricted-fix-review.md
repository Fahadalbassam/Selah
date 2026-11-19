# Revie<scratchpad>ix/restricted-client-work (restricted client admin does the owner's work)

Reviewe<scratchpad>git diff origin/main...HEAD` at `adc47c1` in `.claude/worktrees/restricted-fix` (after the coordinator's rebase on `d211bc7`). Independent, adversarial. No edits, no push.

## Verdict

**No blocking findings.** The change does what it says. `authorize()` widens only `client_admin` on restricted clients, only for the four work permissions, only as `assigned`. Migration 0107 only narrow<scratchpad>hree RESTRICTIVE insert policies and one BEFORE trigger that can only raise. Nothing changes for full clients, firm-run clients, action owners, client managers, firm staff or jobs. Two should-fix items and some notes follow.

## What I ran

- Rebuilt `selah_test_r` from empt<scratchpad>dropped it, created it owned by `selah_owner`, added `vector` and `pgcrypto` as `postgres` (the migrations expect them to exist already), then `scripts/migrate.ts`. All migrations through 0107 applied.
- Unit tests (TZ=UTC): 65 files, 1020 passed, 2 skipped.
- DB tests (TZ=UTC, `selah_test_r`): 89 files, **1310 passed**, including the new `tests/db/restricted-work.test.ts`.
- My own probes, using raw SQL as `selah_app` with `selah.user_id` se<scratchpad>cript `<scratchpad>`. Results are below. The probe truncates `selah_test_r`, so re-run the suite before relying on that database again.
- I grepped the diff for the partner firm's name (Latin and Arabic spellings), real people's names, emails, keys and tokens. Nothing found. The test fixtures use `example.test` and placeholder names.

## Probe results (DB layer, restricted client with two admins A and B)

| # | Attempt | Result |
|---|---|---|
| 1 | A sets owner to self and moves status in one UPDATE | Refused (`check_action_transition`, D1 "owner and status not together") |
| 2 | A takes B's action (owner only), then moves it in a second statement | **Allowed** (see N1) |
| 3 | A takes an unowned action, then writes progress | **Allowed** (see N1) |
| 4 | A rewrites `blocked_reason` on B's blocked action with no status change | **Allowed** (see S1) |
| 5 | A runs `SET status = status` on B's action | Passes, but changes nothing |
| 6 | A writes progress on another client's action | Refused (existing RLS) |
| 7 | A writes progress with A's own project/org and another client's `action_id` | Refused (`restricted_admin`) |
| 9 | A writes progress on, or moves, a firm-only-label action A owns | Refused (`recommendation_label`); the update touches 0 rows |
| 10 | A writes progress on a draft A owns | Refused (`draft`) |
| 11 | Client switched to ful<scratchpad>writes progress on, and moves, B's action | Allowed. This is the full client's existing DB behaviour; `authorize()` still refuses. Switching back restores the rule at once, because nothing is stored. |
| 12 | Full client's admin writes progress on an unowned action (DB) | Allowed, as before (no change for full clients) |
| 13 | Firm lead writes progress on a restricted client's action | Refused (`set_record_source`, unchanged) |
| 14 | Firm lead moves a restricted client's action (DB) | Passes the new trigger. `app_role()` is not `client_admin`, so the existing rules still decide. |
| 15 | Another restricted client's admin calls `app_restricted_admin_works(<A's action id>)` | Returns `false` for an action they cannot see; `true` for a random id (see N3) |
| 17 | B is switched of<scratchpad>writes progress on B's still-owned action | Refused until it is handed over (see N2) |

## Should-fix

**S1. The trigger checks only `status`, so on a restricted client an admin can still rewrite `blocked_reason` on a colleague's action.**
`apps/web/drizzle/0107_restricted_admin_work.sq<scratchpad>49` and `:55` (`BEFORE UPDATE OF status`, `IF NEW.status IS DISTINCT FROM OLD.status ...`).
`check_action_transition()` lists `blocked_reason` among the client columns (`client_cols`). So `UPDATE actions SET blocked_reason = '...' WHERE id = <B's blocked action>` run as A succeeds (probe 4). The "I am stuck" text is part of the owner's work that 0107 says the admin does "only on actions they own". No service path does this today; `transitionAction` writes `blocked_reason` only together with a status change. So this is defence in depth, not a reachable API hole. Fi<scratchpad>make it `BEFORE UPDATE OF status, blocked_reason`, and check `(NEW.status, NEW.blocked_reason) IS DISTINCT FROM (OLD.status, OLD.blocked_reason)`. Add one line to the DB test.

**S2. Migration order at merge with `fix/classification-leaks` (0106). Watch the `when` order, not just the file names.**
`apps/web/drizzle/meta/_journal.json`: this branch adds `id<scratchpad>106, ta<scratchpad>0107_restricted_admin_work, whe<scratchpad>1795081064373`. `origin/fix/classification-leaks` adds `id<scratchpad>106, ta<scratchpad>0106_classification_leaks, whe<scratchpad>1795077078084`. Both `0106_snapshot.json` and `0107_snapshot.json` have `prevId` = 0105's `7530c9e8-...`.
- The drizzle pg migrator (`node_modules/drizzle-orm/pg-core/dialect.j<scratchpad>57-62`) applies a migration only if its `when` is greater than the newest `created_at` already applied. If 0107 merges and is migrated anywhere first (dev, `selah_check`, CI images), a later-merged 0106 with an **earlier** `when` is **silently skipped** on those databases.
- So 0106 merges first. Then rebase this branc<scratchpad>journal entry `id<scratchpad>107`, keep or raise its `when` (it must stay greater than 0106's, which it is now), set `0107_snapshot.json` `prevId` to 0106's id `a4ead913-4bb9-413d-99f3-4a39ae064b3f`, and keep the snapshot body equal to 0106's. It is equal no<scratchpad>neither migration changes the drizzle schema, so both snapshots match 0105 except for `id`/`prevId`.
- If 0107 must merge first, renumber the other PR to 0108 with a newer `when`; do not keep it as 0106.
- The two migrations touch no common object. 0106 changes documents, activity_events and metric_snapshots policies and functions; 0107 changes progress, evidence and deadline insert policies and the actions trigger. Their order does not matter for behaviour.

## Notes

**N1. "Only on actions they own" is one click from "any action".** On a restricted client, D1 lets the client admin give any released open action to anyone on the project, themselves included (`action.assign_owner`: `client_admi<scratchpad>"any"`, and `app_can_change_owner`). Probes 2 and 3 show admin A can take B's action, or an unowned one, and then work it. This is audited (`action.owner_change`), and B is told (`action.owner_moved`). It fits the owner decision, and same-statement owner+status is refused. But `docs/authorization.md` (the new "A restricted client" paragraph) and `docs/engagement.md` (the new section) say a colleague's or an unowned action "answers 404, and the database refuses". That reads as a hard wall. Suggest one sentenc<scratchpad>"to work it, the admin first gives it to themselves (D1), which is recorded and tells the previous owner." Also confirm the product owner is fine with that.

**N2. A leaver's actions are stuck until handed over.** If admin B is switched off, admin A cannot work B's actions until they are handed over (`app_hand_over()` / owner control). Probe 17 is refused, which is correct. On a restricted client with at most two admins, the switch-off dialog's hand-over is the path. That already exists, so this is just worth a line in the client guide.

**N3. A small cross-tenant oracle in the SECURITY DEFINER function.** `app_restricted_admin_works(aid)` (`0107...sq<scratchpad>20-27`) is executable by `selah_app` and reads `actions`/`organizations` past RLS. A client admin of any org who could run SQL would learn whether an action id exists in some restricted client and is not theirs (`false`) or not (`true`). The app never exposes raw SQL and ids are random UUIDs, so the risk is negligible. Other `app_*` helpers in this codebase behave the same way. To close it at no cost, add `AND a.org_id = (SELECT org_id FROM org_memberships WHERE user_id = app_uid() AND active LIMIT 1)`, or simply accept it.

**N4. Full client<scratchpad>he DB is still wider than `authorize()`. This predates the branch.** Probes 11 and 12: the database lets a full client's admin record progress and move any action of their client; `authorize()` refuses. The docs now say a full client's admin "does not record progress or evidence". That is true at the API, not in RLS. It is out of scope for this PR; worth a later ticket if the defence-in-depth matrix wants it.

**N5. RESTRICTIVE vs PERMISSIV<scratchpad>correct.** Each new policy is `AS RESTRICTIVE FOR INSERT TO selah_app` with only `WITH CHECK`, so it ANDs with the existing permissive `scoped_insert`/`request` and the existing restrictive `draft`/`owner`/`recommendation_label`/`department`. It cannot widen anything and leaves SELECT alone. Both functions use `SECURITY DEFINER SET search_path = public, pg_temp`. EXECUTE is revoked from PUBLIC and granted to `selah_app`. The trigger function has no explicit grant, which is fin<scratchpad>iggers do not need EXECUTE for the caller. `STABLE` is right.

**N6. Trigger behaviour with jobs, firm staff and `SECURITY DEFINER` callers.** The trigger skips when `app_uid()` is null (jobs and migrations), and the function returns true for any role other than `client_admin`. So `app_close_project()` (0059, firm), `app_hand_over()` and D1 (owner-only updates, which do not fire an `UPDATE OF status` trigger) are untouched. The trigger reads the pre-update row (`OLD.id`, and the table as the statement sees it), so a combined owner+status update cannot slip through. That case is refused earlier anyway.

**N7. Separation of duties holds.** The client side cannot leave `awaiting_review` (`check_action_transition`), reviews are firm-only in RLS, and `canTransition()` refuses review or close by an assignee or submitter. The new test covers the restricted admin and the firm-run self-review cases.

**N8. Every service that checks these permissions builds its resource from `loadAction()`.** That is `progress.ts`, `evidence.ts` (`submitEvidence`, `attachExistingEvidence`), `follow-through.ts` (`requestDeadlineChange`, `actionFollowThrough`), `actions.ts` (`transitionAction`) and `queries.ts` (`getActionDetail`). `loadAction()` carries `engagementMode` and `assignees = [owner_user_id]`, so `RESTRICTED_POLICY` applies everywhere, with labels and drafts still checked. Home and board resources lack `engagementMode`, but they only do read checks, so this has no effect.

**N9. Worktree state seen during the review.** When I started, the worktree was mid-rebase, with a `UU` conflict in `src/lib/handbook-content.ts`. The coordinator then finished the rebase (`adc47c1`, clean). My test runs are on `adc47c1`.
