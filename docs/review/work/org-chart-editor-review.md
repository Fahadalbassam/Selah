# Review: `feature/org-chart-editor` (org chart, part 3: the outline editor, holders, the leaving and invite hooks, the work card)

Reviewer: independent agent, 18 Nov 2026.
Checked at `4e14422` (on `origin/main` `e324f8d`, #175 merged in). Line numbers are at that commit.

Method:

- Read the whole diff, then the part 1 rules it rests on (`drizzle/0091_org_chart.sql`: `check_position_holder()`, `app_org_chart_holders()`, publishing, the policies), `services/org-chart.ts`, `accounts.ts`, `files.ts`, `queries.ts`, the routes, the four components, the messages and the docs.
- Ran every check on `selah_test_u`, reset (drop schema `drizzle`, `DROP OWNED BY selah_owner`) and migrated from empty, `TZ=UTC`.
- **Probes**: a throwaway database test file in my worktree (`tests/db/zz-review-probe.test.ts`, deleted afterwards, never committed). It has its own fixture and calls the services and functions as each reader. The results are quoted below as "probe X".
- **Mutations**: the builder's `sabotage-0160.sql`, and three of my own (one rule removed at a time). Then the database was reset and migrated again, and the builder's file passed 22/22 on the clean database.

## Verdict

**Two blocking problems, six should-fix points.**

The privacy side of the work card holds:

- Everything on the card is read as the viewer, under row-level security, through `listActions()` and `listFiles()`. No definer function reads on anyone's behalf.
- `data-person` ids reach the browser only for names the reader may see.
- Removing a holding never writes the name anywhere.

The two blocking problems are about people's data on the client's published structure:

- **B1.** The draft editor says "the draft is the firm's alone", but placing someone there changes the client's published structure at once, and ends the real holder.
- **B2.** Switching someone off does not end a holding that has an end date or a start date in the future. The person who left stays named on the company's structure, and nothing in the app can end it.

All checks pass: lint, typecheck, 676 unit tests, 1126 database tests.

## Findings

### Blocking

**B1. Placing someone from the draft editor changes the client's published structure at once, and ends the real holder.**

- **Where:**
  - `components/org-chart/outline-editor.tsx:648-652`: the position panel in "Edit the draft" carries `HoldersPanel`.
  - The editor's own hint, `messages/en.json:5584`: "The draft is the firm's alone: the client does not see it". The page banner says the same («مسودة المكتب: لا يراها العميل»).
  - `services/org-chart.ts:1130-1139` (`changeHolder()`).
  - `0091_org_chart.sql`, `check_position_holder()`: a holding belongs to the lineage, so `in_current` is true for any draft copy of a published position.
- **Probe K:** the lead opens the draft copy of "Chair" and places "Draft Only Chair" from today. The client admin's current version then shows `['Draft Only Chair']`. The real chair, Hessa, was ended yesterday: the position is planned for one person, so `changeHolder()` ends whoever holds it.
- **Failing scenario:** the lead plans a restructuring in the draft.
  - She renames the CFO position there and places the planned successor, from 1 January, to see how the new structure looks.
  - The client's admin immediately sees "from 1 Jan: <successor>" under "People in positions" on the published structure.
  - From 1 January, managers in Finance see the successor as CFO on the published chart, although the restructuring was never published.
  - The lead and deputy get an `org_chart.holder_changed` notice.
  - If she picks today as the start date, the real CFO's holding ends yesterday.
  - Nothing on the screen says the position is shared with the published structure. The panel's own hint only says the lead is told "of each change on the published structure".
- **Why it blocks:** it discloses a firm-only plan (who replaces whom) to the client, and it changes the company's record of who holds what, from a screen that promises the client sees nothing.
- **Fix (your call):** in the outline editor, offer the holders panel only for positions that exist only in the draft. For a position already on the current version, link to "People in positions" instead. At the very least, say plainly in the panel that changes there show to the company at once. Add a test.

**B2. Leaving does not end a holding with a future end date, and a future start becomes a one-day holding.**

- **Where:**
  - `drizzle/0160_org_chart_editor.sql:145-148`: `WHERE … x.to_date IS NULL`, and `greatest(x.from_date, app_firm_today())`.
  - `services/org-chart.ts:1283-1290` (`positionsHeldBy()`: `from_date <= today` and `to_date is null`).
  - `0091_org_chart.sql:709`: a holding that already has an end date can never be changed.
- **Probe A1:** the client admin records the leaver as Clerk until today+60 (for example, "notice given, last day 17 Jan"), and as Legal counsel from today+10 (an appointment not yet started). Then she switches the leaver off.
  - The leaving report listed **no** positions (`[]`), so the dialog offered no "leave vacant / replacement".
  - Afterwards the holdings were `2025-01-01 → 2027-01-17` and `2026-11-28 → 2026-11-28`.
  - The published chart in 30 days still shows "leaver person" as Clerk.
  - On the 28th it shows them as Legal counsel.
- **Failing scenario:**
  - An employee resigns with a last day of 31 December, and the admin ends the holding on that date.
  - The employee leaves on 15 December and the account is switched off.
  - Until 31 December the company's chart (and the PDF, and "your manager" for their reports) names a person who has left.
  - "End this holding" is not offered, because the holding already has an end date. The database refuses to change it anyway.
  - The only way out is "Remove, entered by mistake", which deletes true history.
  - The work card also still opens for them.
  - The builder's claim "every position they still hold ends on the leaving day" is untrue for these holdings.
- **Fix:**
  - On leaving, also end every holding whose end date is after the leaving day: let the trigger shorten it, as the owner may.
  - Delete or close (with an audit row) a holding that has not started yet.
  - List both on the leaving report.
  - Add a test for each.

### Should fix

**S1. A name on a position a later version dropped can never be removed, so minimal records stay blocked: the dead end the lead's decision was meant to remove.**

- **Where:**
  - `services/org-chart.ts:1177`: `holderPosition()` refuses superseded positions with "history", and `listHoldings()` and `removeHolder()` both go through it.
  - `messages/en.json:2641`: the engagement page says "Remove them from the structure first."
- **Probe C:**
  - At a consultant-managed client, the lead types "Typo Secretry" into "Secretary" and publishes.
  - The next version drops Secretary, and publishing ends the holding.
  - `removeHolder()` and `listHoldings()` with the old position both answer `history` ("Earlier versions do not change").
  - The firm admin's switch to minimal records is refused: "remove the names of people from the client's structure".
  - No screen lists that holding.
- **Note:** the database function itself would allow it (the lineage is published and the lead is an editor). Only the service and the screens are missing.
- **Fix:**
  - Let the people who change holders list and remove holdings of positions the current version no longer has, for example an "Earlier positions" list on People in positions, or a list of the remaining names beside the engagement page's message.
  - Test that minimal records becomes possible after a restructuring.

**S2. "Start again from the current version" and "Remove position" silently delete the people placed in positions only the draft has.**

- **Where:**
  - `0160:195-226`, and the foreign key `position_holders.position_lineage_id → positions(id) ON DELETE CASCADE` (`0091:131`).
  - `outline-editor.tsx:149,153`.
  - `messages/en.json:5602` (`removePositionConfirm`) and `:5604` (`restartConfirm`).
- **Probe B:** the lead adds "Trainer" in the draft and places the HR director in it from 2024-03-01. After the reset:
  - Acme has 10 → 9 holdings. The published holdings are untouched (good).
  - The trainer holding is gone.
  - The audit log has only `org_chart.draft_reset` with the client. No row says a holding was deleted, and nothing says whose.
- **What the confirmations say:**
  - The reset: "every change made to it since is lost". It says nothing about people.
  - Removing a position talks only about reporting lines.
- **Fix:**
  - Name the effect in both confirmations ("…and the people placed in positions only the draft has are removed").
  - Write one `org_chart.holder_remove` row per holding deleted this way, without the name, as the removal does.

**S3. An archived client's editors get the Structure tab and a solid "Add unit" button that always fails.**

- **Where:** `services/org-chart.ts:449-453` (the editors' shortcut in `hasStructure()` ignores `status`).
- **Probe I:** Fresh is archived. `hasStructure(lead)` returns `true`. The first unit fails with "this client is archived; the firm admin can restore it", which `orgChartError()` does not map, so the screen shows a generic error.
- **Fix:** no tab and no editor for an archived client with no structure (its people only read), or a read-only empty state.

**S4. The empty Structure page tells the editor to choose levels and download a PDF.**

- **Where:** `clients/[id]/structure/page.tsx:87`, and `orgChart.hint` (`messages/en.json:5510`): "This client's structure as the firm drew it… Choose how many levels to show, or download it as a PDF."
- **Failing scenario:** lead2 opens Rawdah's new tab (walkthrough). There is no structure, no levels control and no PDF button. The only way forward is "Add unit".
- **Fix:** use a header line for the empty case that says what to do ("Start the structure with its top unit; the company sees nothing until it is published"). This is part 2's tab now shown always to editors (your item 7). The client side is unchanged: probe and the builder's test show no tab before a published version.

**S5. Accepting an invitation checks the position before taking the chart lock, and nobody is told when no holding starts.**

- **Where:**
  - `0160:110-121`: the "still on the current version and has room" check runs before `pg_advisory_xact_lock_shared`.
  - `check_position_holder()` skips its own "published structure" check when nobody is signed in (`0091:736`), which is the case on the public accept page.
  - The invite form hint, `messages/en.json:2127`: "When the invitation is accepted, the person holds this position from that day."
- **Failing scenarios:**
  - **A publish lands between the check and the insert.** The holding starts on a position that publish just dropped. It is never ended, it is invisible on the current chart, and S1 makes it unremovable. The window is narrow and I did not force it.
  - **The position was filled meanwhile, or the firm dropped it.** Probe D shows the person correctly just joins. But the inviter was promised a holding, and neither the inviter nor the lead is told that none started. The admin finds out only by looking at the chart.
- **About the "two acceptances at once" race:** it does not happen today. Probe E: two acceptances into a one-person vacancy, in parallel, ended with 1 holder. This is only because `app_check_client_account()` locks the client's `organizations` row (`FOR UPDATE`) on each new membership, an unrelated lock this rule silently depends on.
- **Fix:**
  - Take the lock first, then check.
  - When no holding starts, tell the inviter (a notice).
  - Or reword the hint ("…if the position is still vacant then").

**S6. Untested rules (your item 8): each of these survives a mutation.**

The builder's sabotage bites: 9 of its 22 tests fail with `sabotage-0160.sql` applied. These three mutations pass all 80 tests of `org-chart-editor`, `org-chart` and `org-chart-tree`:

- **M1.** `app_accept_invitation()` without `v.state = 'published'`: 22/22 pass. My probe D then fails: 1 holding started in a position the current version dropped.
- **M2.** `personWork()` without `liveProjects: true` (`org-chart.ts:1366`): all pass. Probe F then fails: an open action of a closed project shows on the card. With the rule, the card correctly hides it.
- **M3.** `end_holdings_on_leaving()` without the archived-client guard: all pass.

Also untested:

- B1 to B2 and S1 to S4 above;
- the card on an earlier version for a manager (probe M: 404, correct);
- a firm-only file for a client viewer (probe F: hidden from the client admin, shown to the lead, correct);
- a replacement from another client (probe H: refused by the database, "a holder is one of the client's own active people", correct).

Add a test for each, at least M1 to M3.

### Notes

- **N1. Removing real history.** "Remove, entered by mistake…" is offered on earlier, ended holdings too (`holders-panel.tsx:189`). Probe J: the client admin removed the 2019–2024 CEO, and the chart for 2020 now reads the CEO position as vacant. This is within your decision (anyone who may change holders, asked first), and the confirmation is clear. But an ended holding of a real person is rarely a typo. Consider offering removal only on open or upcoming holdings, or only to the firm on earlier ones.
- **N2. "Late" under a person's name includes "Awaiting review".** `isOverdue()` counts an action waiting for the firm's review past its due day as late, so the card puts it under the person's name in the "Late" list. The firm is the one holding it. The status is shown beside it, and the rule is the app's own overdue rule, but on a card about one person it reads as a judgement. Worth a look with D3's "Waiting for the firm".
- **N3. The "more" line sits only under "Open tasks"** (`org-tree-view.tsx:134`), but it is also shown when only the late list was cut. Its words ("Only the ones due soonest are shown") fit both lists. Put it under whichever was cut. There is no count: good.
- **N4. Keyboard.**
  - The Alt+arrow moves call `preventDefault()` only when not busy (`outline-editor.tsx:137`). Alt+Left pressed while a move is saving goes to the browser, which navigates Back in Chrome, Edge and Firefox (Alt+Right in an RTL setup).
  - Prevent the default for Alt+Left and Alt+Right whenever the row has focus.
- **N5. The removal's `on_published`** is computed before the lock (`0160:179-184`). If an editor removes a holding from a draft-only position while that draft is being published, the lead is not told. This is harmless and rare.
- **N6. Levels.** `relevel()` clamps at 1 and 12. Moving a deep branch down past 12 collapses levels, and moving it back up does not restore them. Probably theoretical.
- **N7. The scratchpad.** The session scratchpad is shared with the builder. My logs there (`checks.txt`, `db.log`, `lint.log`, `typecheck.log`, `unit.log`, `npmci.log`, `tools/`) are mine, not the builder's.

## What I checked and found sound

**The work card (item 1).**

- `personWork()` (`org-chart.ts:1357`) opens only for a holder the reader sees named on the shown version: `getStructure()` read as them, `h.named && h.userId`. For a manager outside her branch, with "show names" off, on an earlier version (probe M) or with departments off, `app_org_chart_holders()` never sends the user id, so the card cannot open.
- A typed name has no id. A person who holds no position, another client's people, the team member staffed on nothing, and action owners all get the same 404 (builder's tests).
- Actions come from `listActions()` (row-level security plus `authorize`) and files from `listFiles()` (row-level security, the label, the audience picker, `document.download`).
- Probes F and G, and the builder's tests, cover:
  - another department's action and file;
  - a draft action;
  - an action on a closed project (probe F);
  - the file the manager was left out of (#175);
  - a private file;
  - a firm-only file for the client admin, while the lead sees it (probe F).
- One membership per person (`org_memberships_user_id_unique`) and the `clientOrgId` filter keep another client's work off the card.
- **No score, ranking, count or judging colour:** the late list uses the same muted text as the rest; "more" is a yes/no.

**`data-person` and what reaches the browser (item 2).**

- Probe G: the Finance manager's drawing carries only the analyst's id. The HR director, outside her branch, has none. With names off there are none. The client admin's drawing has all three account holders.
- `StructureBody` stays a server component. `OrgTreeView` gets only the escaped HTML, the client id and the version.
- The outline editor and People in positions receive the positions with holders (ids, dates) and the client's people with their e-mails, only for the firm's editors and the client admin, who read all of it anyway.
- For a manager or an observer the views fall back to the drawing.

**Removing a holding (item 3).**

- Only through `app_remove_position_holder()`; the app has no delete right.
- The client admin is refused in the draft; managers, owners, observers, the team and other clients are refused.
- The row really goes; it is asked first.
- The audit row holds `{client, holder}` only, and the start rows never held a name either. The notice and the mail carry no name.
- The masking list loses it. Minimal records is allowed once nothing is left (subject to S1).

**Reset (item 4).** Firm editors only, at the service and in the database. It refuses a stale draft id, is audited, and leaves published holdings alone (probe B: only the draft-only one went).

**Leaving and invite (item 5).**

- The common case is right: the holding ends on the leaving day, and the replacement starts the next day.
- A replacement must be an active person of this client (database, probe H).
- An invitation can name only a published position of the same client, and only by a holder writer (trigger plus `vacancyLineage()`).
- Accepting after the position was filled or dropped just joins (probe D).
- The Position list is offered only to the client admin (`/team`) and the firm admin (the client's People page), built from `listVacancies()` read as them.

**The editor (item 6).**

- Every write goes through part 1's services and their triggers: draft only, firm only, the cycle triggers.
- Levels follow a move (tested).
- Logical classes throughout, `dir` on codes and names, the side panel from the reading end, one solid button at most per view, plain labels in both languages.

## Check results

All on `selah_test_u`, reset and migrated from empty, `TZ=UTC`, at `4e14422`:

| Check | Result |
|---|---|
| `npm run lint` | pass (exit 0) |
| `npm run typecheck` | pass (exit 0) |
| `npm test` (unit) | 45 files, 676 tests, all pass |
| `npm run test:db` | 80 files, 1126 tests, all pass (1023 s) |
| Builder's `sabotage-0160.sql` | 9 of 22 `org-chart-editor` tests fail (they bite) |
| My mutations M1 to M3 | none of the 80 org chart database tests fail (S6) |
| After all probes and mutations | database reset and migrated again; `org-chart-editor.test.ts` 22/22; probe file deleted; worktree clean |
