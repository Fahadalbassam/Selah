# Re-check: `feature/org-chart-editor` (org chart, part 3), after the builder's fixes

Reviewer: independent agent, 18 Nov 2026.
Checked at `c736906` (branch tip: the fix commits `9f3866a` B1, `ee70dba` B2, `446340b` S1, `05d996a` S2, `33def4f` S3, `119833e` S4, `ba84c01` S5, `8a430c2` S6, `eb32204` notes, then the merges of #176 and #177). The earlier review is `org-chart-editor-review.md`. The migration is still named `0160_org_chart_editor.sql` in this checkout; the builder is renumbering it to 0096, so this re-check is about its logic, not its number. Line numbers are those of `0160_org_chart_editor.sql` at `c736906` unless a file is named.

Method:

- Read the whole fix diff `4e14422..eb32204`, and compared each redefined function with its earlier text (`check_position_holder()` with `0091_org_chart.sql:693-768`, `app_accept_invitation()`, `end_holdings_on_leaving()`), plus the routes, services, components and messages it touches.
- Ran every check on `selah_test_d`, reset (drop schema `drizzle`, `DROP OWNED BY selah_owner`) and migrated from empty, `TZ=UTC`.
- **Probes:** a throwaway database test file in my worktree (`tests/db/zz-recheck-probe.test.ts`, its own fixture, deleted afterwards, never committed), calling the services and the database as each reader, with two connections for the races. Quoted below as "probe X".
- **Mutations:** each fix taken out one at a time (9 in the database, 10 in the services, including the earlier M1 to M3), then `org-chart-editor.test.ts` run. The database was then reset and migrated again before the full run.

## Verdict

**Ready to merge after one small should-fix; no blocking finding.**

- **B1 and B2 are closed.** No path I could find places anyone from the draft or puts a name on a draft-only position: not the services, the routes, an invitation, the leaving replacement, part 1's `changeHolder()`, or a direct insert as the app role (signed in, signed out, or as the schema owner). Leaving now ends every started holding on the day and removes a not-yet-started one, audited as a count, with the lead told and no name written anywhere.
- **S1 to S6, N3 and N4 are closed**, with one exception in S5. Accepting an invitation now takes the chart lock, but only after it has inserted the membership, which locks the client's `organizations` row. A publish takes the chart lock first, then that row. The two can deadlock (**R1**, probe C reproduces it). Postgres resolves the deadlock by failing the acceptance, and the person sees an error. Taking the lock before the membership removes it (probe C2).
- **R2** is from part 1, not a regression, but it is the question asked: publishing leaves holdings on the positions it drops (a not-started one becomes a one-day holding, a later end date keeps running). S1's new list now shows them.
- All 19 mutations but two are caught by a test. The two that are not are notes N1 and N6.
- All checks pass: lint, typecheck, 727 unit tests, and the database tests (78 of 80 files in the full run; the two org chart files timed out in their `beforeAll` while lint and typecheck ran beside them, and pass 72/72 run alone, see N9).

## The earlier findings

| # | Earlier finding | Now | Why |
|---|---|---|---|
| B1 | Placing someone from the draft editor changes the client's published structure | **Closed** | **Database:** `check_position_holder()` (272-344) refuses a new holding unless its lineage is on the current published version, for everyone: the app role signed in or not, and the schema owner (probe A: lead, client admin, no user and owner all refused on a draft-only position; a draft copy's id is "no such position"). **Services:** `changeHolder()` and `holderPosition()` refuse a draft position (`org-chart.ts:1115, 1203`), so `listHoldings()`/`removeHolder()` do too. **Other paths:** an invitation (`vacancyLineage()`, `check_invitation_position()`) and a leaving replacement named through the draft copy are refused (probe A). **Screen:** `HoldersPanel` is now used only by `PeopleView`, which is offered only on the published version (`structure-body.tsx:54`). The outline editor shows today's holders read only, with a link (`outline-editor.tsx:669-694`). **Races:** an insert waits on a publish under way and is then refused (probe B2 ii; part 1's test at `org-chart.test.ts:1080`). Mutations: the 0091 rule put back fails the B1 test; each service check taken out fails it. |
| B2 | Leaving does not end a holding with a later end date; a future start becomes a one-day holding | **Closed** | `end_holdings_on_leaving()` (158-191) ends every holding that has started and is not over on the leaving day. It deletes the not-started ones and audits them as `org_chart.holder_cancel` with `{client, count, leaving}`. The leaving report lists both (`positionsHeldBy()`, `org-chart.ts:1368`), and a replacement is refused for a cancelled one (`accounts.ts:222`). Probe D3: the started holding ends today, the one from +10 is gone, one count row, the lead and deputy get a notice and a mail with only a link. No name in `audit_log`, `notifications` or `outbound_emails`. **The "only the leaving moves an end date earlier" rule (287-291) holds against a crafted update:** probe D1 fakes `selah.leaving` (the person's id, empty, unset) on an ended typed-name holding, and every attempt is refused, because the app's own statement runs at trigger depth 1. The app role cannot create a trigger of its own to get deeper: it has no TEMP right (`db/init/01-roles.sh:31`, checked as `selah_app`). Mutations: each of the later-end, cancel and depth changes fails a test. The setting comparison is not tested (N1). |
| S1 | Names on positions a later version dropped can never be removed | **Closed** | `droppedHoldings()` (`org-chart.ts:1298`) lists them for holder writers only. `removeHolder()` takes a dropped position's last row (`holderPosition(…, { dropped: true })`), and only when the lineage is not on the current version. Probe E: a client manager and an action owner are refused. The client admin and the deputy see the same list, all names the admin already reads on earlier versions (`full_read`). Nothing from the draft is listed (`v.state = 'superseded'`). The test reaches minimal records afterwards. Mutations: both checks fail a test. N6: the service's own permission check is not what the test proves. |
| S2 | "Start again" and "Remove position" silently delete draft-only holdings | **Closed** | No draft-only holding can exist now (B1). A second lock, `check_position_holdings()` (351-366), refuses deleting a draft-only position that somehow holds someone. The confirmations say what is lost (`messages/en.json` `restartConfirm`, `removePositionConfirm`). The reset's audit row counts the units and positions replaced. Mutation: dropping the trigger fails the S2 test. |
| S3 | An archived client's editors get a Structure tab and an "Add unit" that always fails | **Closed** | `abilities()` and `getDraft().canStart` require `status <> 'archived'`; `hasStructure()` no longer short-cuts for an archived client (`org-chart.ts:186-195, 375, 458-460`). An archived client's published structure still reads. Mutations: both fail the S3 test. |
| S4 | The empty Structure page talks about levels and a PDF | **Closed** | `structureHint()` picks `hintEmpty` when nothing is drawn (`clients/[id]/structure/page.tsx:92`). Unit tests check the wording in both languages. |
| S5 | Accepting checks the position before the chart lock; nobody is told when no holding starts | **Partly closed** | The check now runs after the lock (116-128), so a publish under way finishes first and a dropped position is never filled. The inviter gets `org_chart.invite_not_placed`, a notice without a name, linking to People in positions (probe E: the client admin's notice opens `/departments/structure?view=people`; the firm's opens `/clients/:id/structure?view=people`). The hint is reworded in both languages. **But the lock is taken after the membership insert, which can deadlock with a publish (new finding R1).** Mutation: without the notice two tests fail. Moving the lock back cannot be caught by a test (a race). |
| S6 | Untested rules | **Closed** | Re-run of the earlier mutations: M1 (accept without `v.state = 'published'`) fails the S6/M1 test; M2 (`personWork()` without `liveProjects`) fails the S6/M2 test; M3 (leaving without the archived guard) fails the S6/M3 test. The replacement from another client and the firm-only file are tested. |
| N3, N4 | "More" under the wrong list; Alt+arrow reaching the browser | **Closed** | `moreLate`/`moreOpen` (`org-tree-view.tsx:113, 135`). `preventDefault()` whenever Alt with a side arrow is pressed on a row, busy or not (`outline-editor.tsx:141-148`). |

The client's own view: nothing from the draft reaches it. The client side gets only the dropped names (admin, People in positions), the not-placed notice, the reworded invite hint and leaving dialog, and S3's read-only flags. The read-only holders and the empty-page hint are on the firm's page only.

## New findings

### Blocking

None.

### Should fix

**R1. Accepting an invitation can deadlock with a publish (S5's lock is taken in the wrong order).**

- **Where:** `app_accept_invitation()`:
  - `0160:111` inserts the membership. Its trigger (`check_membership_mode()` → `app_check_client_account()`, `0000_baseline.sql:4611`) locks the client's `organizations` row `FOR UPDATE`.
  - Only then does `0160:117-120` take the chart's lock (shared). The insert's own `check_position_holder()` takes it again at 318, for everyone since B1.
- **Against:** `app_publish_org_chart()` takes the chart's lock exclusively first (`0091:457`). Its `INSERT INTO org_chart_versions` (`0091:479`) then checks the foreign key to `organizations`, which takes `FOR KEY SHARE` on the same row, and `FOR UPDATE` blocks that. `app_reset_org_chart_draft()` has the same order (lock at 247, then `app_org_chart_copy()` inserts rows with the same foreign key at 261). I did not probe the reset.
- **Probe C:**
  - A publisher's transaction holds the chart lock (as a publish does at its start).
  - An acceptance with a position starts. It inserts the membership, then waits for the lock.
  - The publish continues and needs the organizations row.
  - After about 1 s: `40P01 deadlock detected`. Postgres failed the acceptance; the publish went through.
  - `acceptInvitation()` (`services/onboarding.ts:40-44`) then deletes the new account. The person sees an error and must fill the form again.
- **Probe C2:** the same scenario, with the lock taken before the membership insert. No deadlock: the acceptance waited for the publish, then placed the person.
- **Why not blocking:** the windows are short, nothing is half-written, and a retry works. But it is a new failure brought by the fix.
- **Fix:** in `app_accept_invitation()`, look up the chart and take the shared lock before `INSERT INTO org_memberships`. The later lock calls are then re-entrant and harmless. A test can hold the lock in one connection and check that the acceptance waits, then finishes.

**R2. Publishing leaves holdings on the positions it drops, with the same shape as B2 (part 1, not a regression).**

- **Where:** `app_publish_org_chart()`, `0091:476-478`: `SET to_date = greatest(h.from_date, today) WHERE … h.to_date IS NULL`.
- **Probe B1:** before a publish that drops two positions:
  - Planner was held from +10, not started.
  - Officer was held until +60 (notice given).
  - After the publish, the Planner holding is `2026-11-28 → 2026-11-28`, a one-day holding on a day the position no longer exists. The Officer holding runs to `2027-01-17`.
  - S1's new list now shows both with those dates, under "Names on positions no longer in the structure".
  - Probe B2 (i): a holder added from +5 just before a publish that drops the position gets the same one-day holding. The lock works; this is the publish rule itself.
- **Why it matters:** the record says that someone held a position on a day it did not exist, or held one the structure no longer has. This is what the lead ruled out for leaving in B2.
- **Fix (the lead's call):** apply B2's rule at publish for the positions the new version drops: end a started holding with a later end date today, and remove a not-started one (audited as a count). At least, word the publish rule in `docs/rules.md` to match what it does.

### Notes

- **N1. The leaving guard's setting test is not covered, and it fails open on NULL.**
  - With `current_setting('selah.leaving', true) = OLD.user_id::text` removed (288-289), all 34 tests still pass. Only the trigger-depth part is tested.
  - The comparison is NULL when the setting was never set or the holding is a typed name (`user_id` NULL). The whole `IF` is then NULL and the `RAISE` is skipped. So any update made from inside a trigger could move an end date earlier.
  - It is not reachable today: only `end_holdings_on_leaving()` updates holdings from a trigger, and it sets the value first.
  - Fix: write it `current_setting('selah.leaving', true) IS NOT DISTINCT FROM OLD.user_id::text AND OLD.user_id IS NOT NULL`, or coalesce. Add a test.
- **N2. The leaving report can omit a holding the trigger ends or cancels.** `positionsHeldBy()` maps holdings onto the current version and skips the rest (`org-chart.ts:1391`). A holding on a position R2 left behind is not listed, but the trigger still ends or deletes it. Probe D3: the person's Officer2 holding to +60, on a dropped position. The report showed `[]`, and afterwards the holding ended today.
- **N3. The same position twice on the report.** A person who holds a position until +5 and again from +10 gets two report rows with the same `positionId`: one to replace, one cancelled (probe D3). `departure-dialog.tsx:274` keys the rows by `positionId`, so React gets a duplicate key. Key by holding instead.
- **N4. A successor already scheduled makes a named replacement fail the whole switch-off.**
  - The case: the leaver held Clerk until +60, and a successor starts at +61. The admin names a replacement from tomorrow.
  - `changeHolder()` refuses with `overlap` (one-person position, an open holding starting later), and nothing is switched off (probe D2). "Leave vacant" works.
  - The dialog shows `orgChart.errors.overlap` ("The current holder started on or after that day…"), which does not fit this dialog. Rare. Consider a leaving-specific message.
- **N5. The cancellation row cannot be tied to what was cancelled.** `org_chart.holder_cancel` keeps `{client, count, leaving}` with the client as resource (185-187). The earlier `holder_start` rows point at holder ids that no row now explains. This follows the lead's "a count without names". Holder ids and positions are not names, though, and `holder_remove` keeps both. Worth adding.
- **N6. `droppedHoldings()`'s own permission check is not what the test proves.** Without `assertAllowed()` (`org-chart.ts:1300`), all 34 tests pass. The refused readers in the test (team, another client's admin, observer) cannot open that client at all. Row-level security still keeps raw holdings from a manager. So this is defence in depth, but the test does not show it. Add a client manager of a client with a dropped position.
- **N7. Wording.** `orgChart…positionsHint` (`messages/en.json:2148`, and the Arabic) says "Each position they hold ends … the position stays": the position both ends and stays. Say "Each of their holdings ends…". The Arabic should say the same.
- **N8. `check_position_holdings()` (354) lets `selah.discard = 'on'` through.** The app role can set that itself. This is the codebase's existing pattern (0009, 0025, part 1's own rules), and the rule is a second lock behind B1, so I only record it.
- **N9. The two org chart database files are close to the 10 s hook limit.** Their `beforeAll` builds the whole fixture through the services, and part 3 added more to it. In my full run, with lint and typecheck running beside it, both timed out in `beforeAll`. Run alone, they pass 72/72 in 43 s. Consider a `hookTimeout` for these files (the database config sets only `testTimeout`), so a loaded CI machine does not fail them.

## Check results

All on `selah_test_d`, reset and migrated from empty, `TZ=UTC`, at `c736906`:

| Check | Result |
|---|---|
| `npm run lint` | pass (exit 0) |
| `npm run typecheck` | pass (exit 0) |
| `npm test` (unit) | 50 files, 727 passed, 2 skipped (a first run beside the probe timed out once in `privacy-address.test.ts`, a file scan; alone it passes) |
| `npm run test:db` | full run: 78 of 80 files, 1068 passed, 72 skipped (1012 s); `org-chart-editor` and `org-chart` failed only on the 10 s `beforeAll` hook timeout while lint and typecheck ran in parallel. Re-run alone on the same database: 2 files, 72/72 pass |
| Database mutations (each fix out, `org-chart-editor.test.ts`) | 0091 holder rule: 2 fail; leaving later-end: 1; leaving cancel: 1; depth check: 1; setting check: **0 (N1)**; inviter notice: 2; M1: 1; M3: 1; S2 trigger dropped: 1 |
| Service mutations | `changeHolder` draft: 1; `holderPosition` draft: 4; removal of dropped: 1; dropped-but-current check: 2; archived abilities: 1; `hasStructure` archived: 1; report filter: 1; replacement for a cancelled one: 1; M2 `liveProjects`: 1; `droppedHoldings` permission: **0 (N6)** |
| Probes | A (every draft path refused), B1/B2 (R2; insert waits then refused), C (R1 deadlock) and C2 (fixed order, none), D1 (faked setting refused), D2 (N4), D3 (B2 holds; N2, N3; no name written), E (S1 readers; notice link) |
| Afterwards | probe file deleted, sources restored (compared byte for byte with backups), database reset and migrated again before `test:db`; worktree clean apart from the ignored `.env.local` |
