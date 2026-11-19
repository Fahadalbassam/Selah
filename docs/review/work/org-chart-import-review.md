# Review: `feature/org-chart-import` (org chart, part 4: the ways in)

Reviewer: independent agent, 18 Nov 2026.
Reviewed at `e0556c1` (one commit on `origin/main` `e324f8d`).

Method:
- Read the whole diff:
  - `lib/org-chart-import.ts` and `services/org-chart-import.ts` in full;
  - the five routes, the import page and `import-wizard.tsx`;
  - the AI service endpoint, its prompt and its checks;
  - messages, docs and both test files.
- Read the code they lean on: `lib/office/*`, `lib/masking.ts`, `services/masking.ts`, `services/org-chart.ts` (part 1's writes) and `drizzle/0091_org_chart.sql` (triggers, foreign keys, policies).
- Ran every check on `selah_test_d`, reset (drop schema `drizzle`, `DROP OWNED BY selah_owner`) and migrated from empty.
- **Probes R1 to R11:** a throwaway database test file in my worktree (`tests/db/zz-review-import-probe.test.ts`, deleted afterwards, never committed), with a fake model that records what it receives.
- **Mutations M1 to M4:** removed one guard at a time, ran the branch's tests, restored the file.
- **Part 3 trial merge:** `git merge --no-commit feature/org-chart-editor` in my worktree, with the one code conflict resolved by hand. I migrated with part 3's `0160`, ran the org chart tests and the probes, then aborted the merge.
- **The coordinator's rule:** I simulated "no holding on a position outside the current published structure" with a throwaway trigger on `selah_test_d`, ran part 4's tests, then dropped the trigger.

Line numbers are at `e0556c1`. No container was touched, no other database was written, and the worktree is clean.

## Verdict

**Not ready to merge: two blocking findings, seven should-fix, ten notes.**

**Blocking:**
- **B1, privacy:** the paste screen tells the user that names are hidden from the model. In fact only names Selah already holds are hidden. Every other name in a pasted job list reaches a hosted model as written.
- **B2, holders:** part 4 writes **real holdings** into the draft. Under the coordinator's decision for part 3, that is not allowed: "planned holders" kept with the draft's positions, turned into holdings at publishing. Once the database refuses such holdings, every import with a filled holder cell fails as a whole. I proved this with a simulated rule: 7 of the 12 database tests fail.

**Should fix:**
- The round trip breaks on data the services allow.
- "Replace" silently drops positions with people in them.
- Excel turns typed codes such as 2.10 into 2.1.
- The assistant can double a position.
- The filled-template export is an open API with no screen.
- The paste hint promises more than the code does.
- The merge with part 3 needs hand work.

**What holds:**
- Access: only the draft's editors, and 404 for everyone else.
- The server checks every row again; crafted holder e-mails are refused.
- The save is one transaction, and nothing is published.
- The model cannot add anything that is not in the text.
- The export is formula-safe.
- The upload limits and the scan.
- The AI service endpoint (token, limits, strict schema).
- Selah never judges a structure.

All checks pass: lint, typecheck, 694 unit tests, 1116 database tests and 34 AI service tests.

## The coordinator's question: the holder column against "holders only on the live structure"

**What part 4 does today:**

| Case | What happens |
|---|---|
| A position the import **creates** | A filled holder cell becomes a real `position_holders` row through `OC.changeHolder(... from: today)` (`services/org-chart-import.ts:375-382`). The row is a holding from the day of the import, on a draft-only lineage. |
| A position **kept by its code** ("Replace") | The holder cell is silently ignored. The only sign is a note: "it is updated, and the people in it stay as they are" (`en.json:3186`). |
| The export (`orgChartWorkbook`) | Writes the holdings read through `getStructure`. |

**Why that is wrong under the decision:**

1. **It creates holdings from the draft.** Before publishing, the client cannot read them: holder reads need a published lineage, and the client admin reads published lineages only. But they are real holdings. After publishing:
   - They start on the import day, before the version takes effect, so the history says the person held a position that did not yet exist.
   - The lead is never told, because the notice trigger fires only for published lineages when the holding is inserted.
   - Until then, a holding the client admin cannot see still blocks switching to minimal records (part 3's rule).
2. **It will fail outright.** I simulated the refusal ("a holding only on a position of the current published structure") with a trigger on `selah_test_d`.
   - `tests/db/org-chart-import.test.ts`: 7 of 12 tests fail.
   - The first import with a filled holder cell is refused at `changeHolder` ("people are placed in positions of the published structure"), so the whole save rolls back. The assistant's draft rows, which carry names, fail the same way.
   - The screen would show only "That didn't work".
3. **Draft-only holdings are deleted without trace.** "Replace" deletes positions the rows do not hold (`services/org-chart-import.ts:358-361`). `position_holders.position_lineage_id` cascades on delete (`0091:131`), so a draft-only position's holding vanishes with no `org_chart.holder_remove` audit (probe R5: 1 holding before, 0 after; the audit shows only `position_delete`). Part 3's own rule says holdings are removed only through `app_remove_position_holder()`. Planned holders make this harmless.

**What part 4 must change (for the coordinator to scope):**

- **A schema place for planned holders that the client can never read.** Use a separate table, for example `org_chart_planned_holders (position_id → positions ON DELETE CASCADE, user_id → user, name, created_by)`:
  - RLS for the firm's draft readers only, insert and delete for `app_org_chart_editor()`, no client grant;
  - a trigger that refuses a position of a non-draft version, and refuses a client with minimal records (as `check_position_holder` does);
  - a user who must be an active client member.
- **Not a column on `positions`.** The client admin and managers can SELECT every column of a published version's `positions` rows (`0091:969`, `scoped_read` via `app_org_chart_version_readable`). A planned name left on a row at publishing would reach a manager outside her branch, and with "show names" off. If a column is chosen anyway, publishing must empty it in the same statement that freezes the row. `app_org_chart_snapshot_of()` (`0091:396-404`) and `app_org_chart_copy()` (`0091:416-424`) list their columns, so neither would carry a new field, and the copy must not.
- **`saveImport`:**
  - writes planned holders, never holdings;
  - for new positions, the row's list;
  - for positions kept by code, the row's list replaces the planned list, while the live holdings stay untouched;
  - the review notes say "placed when this version is published", not "from today".
  - Drop the `from: today` holding code path entirely.
- **Export (`orgChartWorkbook`, `structureRows`):** for the draft, write the planned holders where there are any, otherwise the current holders. For a client reader, never anything planned. Add a test.
- **Checks:** keep `holderNotUser`, `holderName` and `namesNotKept` for planned holders. They must hold again at publishing, because the person may have left in between: publishing re-checks active membership and skips a person who left, saying so.
- **Masking:** planned typed names are names a hosted model must not receive raw, so `app_mask_names()` should include them like typed holder names. Mind the managers' list (part 1 re-check B1).
- **Part 5 (publishing):** turn the planned holders into holdings from the effective date, tell the lead once, as for any change on the published structure, and clear the plans.
- **Tests:**
  - a client admin and a manager read no planned holder (by SQL and through every reader);
  - they are not in the snapshot, the PDF, the client workbook or the assistant index;
  - publishing converts them;
  - the round trip keeps them;
  - "Replace" deletes plans only, never a holding.

## Findings

### Blocking

**B1. The paste screen promises that names are hidden from the model; names Selah does not hold are sent as written.**

- **Where:**
  - `services/org-chart-import.ts:232-235`: `textMasker` masks only the names in `app_mask_terms_in()` (Selah's people, contacts, departments and typed holders), e-mails, phones and cities.
  - The screen: `messages/en.json:3061` and `ar.json:3061`, `source.textHint`: "Names are hidden from the model before the text leaves Selah" / «وتُخفى الأسماء عن النموذج قبل أن يغادر النص صلة».
  - `docs/assistant.md` says the opposite of the screen: "Names Selah does not hold are sent as written".
- **Failing scenario (probe R1):**
  - With masking on (a hosted model), the lead pastes: "Finance Manager: Khalid Al-Otaibi / HR Manager: سارة القحطاني / Accountant: Reem Al-Harbi".
  - The fake model received exactly that text, every name raw.
  - A pasted organisation chart is mostly names of employees who have no Selah account and are not typed into the chart yet. So the hosted model gets exactly the names the product owner wanted kept from it: "Add holders' typed names to `app_mask_terms` so a hosted model never receives them raw" (section 5.3.3). The screen tells the consultant the opposite.
- **Fix (decision for the product owner; minimum first):**
  1. Make the screen true. Say that names of people Selah does not know yet are sent as written, and ask the consultant to leave names out.
  2. With B2's planned holders, ask the model for titles and units only when masking is on, and drop the `holder` field from the prompt and the schema. Names then come back only through Excel or Word, which never leave the server.
  3. Or offer the paste option only with the local model (`maskingOn()` false).
- **Test:** an unknown name in the pasted text either never reaches the model, or the screen says it does.

**B2. Part 4 creates real holdings in the draft.** See the section above. Once part 3's refusal lands, every import with a filled holder cell fails (simulated: 7 of 12 tests fail). Without the refusal, it breaks the new rule silently.

### Should fix

**S1. The round trip breaks on data the services allow.**

- **Where:**
  - `lib/org-chart-import.ts:919` (`levelParent`: "a unit sits at a lower level than its parent");
  - `:996` (`tooManyHolders`), checked even for positions kept by code, whose holders "Replace" ignores anyway.
- **Why the data exists:**
  - Part 1's `updateUnit` accepts any level from 1 to 12.
  - Part 3's outline editor exposes a level field (`outline-editor.tsx:464-472`), and its `relevel` only runs on a move.
  - `updatePosition` lets the planned number drop below the current holders.
- **Failing scenario (probe R3):**
  1. Import, then set "Internal audit" to level 1 (as its parent) and fill the Accountant with 2 holders.
  2. Lower its planned number to 1.
  3. Export the draft and upload it unchanged with "Replace": "rows with errors: 5,6" (`tooManyHolders`, `levelParent`).
- **Why it matters:** the decision says the template "round-trips", and its test list has "export then import gives the same chart". A chart the firm made in Selah's own editor cannot come back.
- **Fix:**
  - Make `levelParent` a note, or drop it (the level is a label the firm sets).
  - Check holder counts only for positions whose holders the import writes.
  - Add a test that round-trips a hand-set level.

**S2. "Replace" drops positions with people in them, and the review step names neither the positions nor the people.**

- **Where:**
  - `checkOrgImport` (`lib/org-chart-import.ts:1045-1046`) gives only `removePositions` codes;
  - the wizard shows a count (`import-wizard.tsx:325-331`) and the confirm a number (`en.json:3103`);
  - in "Replace", **"Skip this row"** (`import-wizard.tsx:519-523`, `en.json:3093`) means "remove it from the draft".
- **Failing scenario (probe R4):**
  1. The draft is published, and "Khalid Typed" holds Finance director 2.1.1.
  2. The lead renumbers it to 2.1.10 in Excel and uploads with "Replace". The review shows `removePositions: ["2.1.1"]`, a new position, and no note about anyone.
  3. Saved and published: Khalid's holding ended the same day (`to_date` = today), and 2.1.10 is vacant with a new lineage, so its history is cut.
  4. The same happens when a row with an error is skipped: S1's rows are exactly what someone would skip.
- **Why it matters:**
  - Codes are the only identity in the file. Any renumbering, deleted row or skipped row ends people's holdings at the next publish, without a word.
  - The spec: "A position outlives the person in it".
- **Fix:**
  - The review step lists each position to be removed with its current people, and says their holding ends when the draft is published.
  - In "Replace", "Skip" reads "Leave out (removed from the draft)".
  - Consider refusing removal of a position with current holders unless the person ticks it.
  - Part 3's single "Remove position" has the same gap (`removePositionConfirm` says nothing about people).

**S3. Excel turns codes typed into the template into numbers: a "reports to" 2.10 silently points at 2.1.**

- **Where:**
  - `templateSheets()` (`services/org-chart-import.ts:437-470`) writes every column in the General format: no `numFmtId 49` and no column style (probe R6, read from the generated file).
  - `xlsx-read` returns a numeric cell's stored value.
- **Failing scenario (probe R6):**
  1. A CEO office "2" has positions 2.1 to 2.11.
  2. A row's "reports to" is typed as 2.10. Excel stores the number 2.1, which `<v>2.1</v>` reproduces.
  3. It is read as "2.1", with no error and no note: the row now reports to the CEO.
  4. A unit 2.10 becomes 2.1, and is either a "duplicate code" for a different unit (confusing) or silently renamed.
- **Why it matters:** the template's whole scheme is dotted codes, and the tenth child of anything ends in 0. Many Saudi companies have ten or more departments.
- **Fix:**
  - Give the four code columns the Text format in the template (`@`, a `cellXfs` entry with `numFmtId="49"`, used as the column style in `<col>`).
  - In `sheetRows`, flag a numeric cell in a code column ("Excel may have changed this code; check it"). `xlsx-read` knows the cell type.

**S4. The assistant can double a position, and give one name to several positions.**

- **Where:** `draftRows`, `lib/org-chart-import.ts:388-417, 488-491`.
  - A position is kept when its title has a mention no other position took. So a title written twice gives two positions: "The Finance Manager leads it… An Accountant reports to the Finance Manager".
  - The branch's own unit test expects that: `tests/org-chart-import.test.ts`, "keeps what is in the text", expects two "Finance Manager" rows from a text naming one.
  - Holders are checked with no pool. Probe R9: one "Khalid" in the text was kept as the holder of 3 positions.
- **Why it matters:** scenario 20 says "the assistant's draft holds only positions that were in the pasted text". A mention inside "reports to the X" is not a position.
- **Fix:**
  - At least, add a review note on a repeated title ("same title as row N: is this a second position?").
  - Give each holder mention one position, the same way titles take mentions.
  - With B1's option 2, the holder part goes away.

**S5. The filled-template export is open to every reader by API, holds more than the tab, and has no limit.**

- **Where:** `app/api/clients/[id]/structure/workbook/route.ts`, `orgChartWorkbook()` (`services/org-chart-import.ts:486-519`).
- **What:**
  - No screen offers it to anyone but the draft's editors, and to them only for the draft (`import-wizard.tsx:259-261`).
  - Yet the client admin, managers and firm observers get it by address (probe R10). Owners and another client are refused.
  - It holds e-mail addresses (probe R10: true for the observer and the client admin), planned numbers and specialties, none of which the Structure tab shows.
  - `docs/authorization.md` and `docs/rules.md` say it "holds exactly what the reader's Structure tab holds".
  - The PDF has a 10-per-10-minutes limit; this route has none.
  - The e-mails are readable under `app_can_see_user`, so this is not a leak, but it is a wider surface than any screen needs.
- **Fix (decision):**
  - Either limit the route to the draft's editors until part 5 puts an "Excel" button on the tab,
  - or keep it open, add the PDF's rate limit and correct the docs.

**S6. Merging with part 3 needs hand work, and the import has no way in until it does.**

- **Conflicts:** `git merge-tree` and the trial merge conflict in:
  - `apps/web/src/app/(app)/clients/[id]/structure/page.tsx`: both rewrite the data loading and the `PageHeader`;
  - `docs/authorization.md`, `docs/progress-checklist.md`, `docs/rules.md`, `docs/walkthrough.md`.
- **The entry point:**
  - On this branch alone, a client with no chart has no Structure tab (`hasStructure`), so the only "Import" link (`structure/page.tsx:56-60`) is unreachable (`docs/import-export.md` admits it).
  - Part 3 gives editors the tab always. The merge must put "Import" into part 3's header, where it also shows in the empty state. I did that in the trial merge: typecheck passes.
  - The import page's back link (`structure/import/page.tsx:30-35`) should then always go to the Structure tab.
- **Part 3's `relevel` in `moveUnit` does not break "Replace".**
  - Units are processed parents first, and every unit after the first move gets its level set from the rows (`services/org-chart-import.ts:305-326`).
  - Probe R11 on the merged code swapped a parent and child with a hand level 5 below: the final levels were exactly the rows'.
- **Merged test results:**
  - `org-chart-import`, `org-chart-editor`, `org-chart`, `org-chart-tree` and `walkthrough-seed`: 98/98.
  - Unit tests `org-chart-import`, `org-chart-outline` and `org-chart-tree`: 72/72.
  - B2 is what breaks once part 3 adds the coordinator's refusal.

**S7. The masked text can exceed the AI service's limit, and the user gets "the assistant could not draft rows".**

- **Where:** the web checks 20,000 characters **before** masking (`services/org-chart-import.ts:229`). The service refuses over 20,000 **after** masking (`services/ai/app/main.py:112`). A three-letter city «جدة» becomes the nine-character `[PLACE_1]`.
- **Failing scenario (probe R8):** a 19,981-character job list of «مدير فرع جدة» lines masks to 29,203 characters. That is a 422 from the service, a 503 on the web, and the screen says to try again.
- **Fix:** check the masked length (and say "too long" in words), or give the service headroom (for example 40,000).

### Notes

- **N1. The review checks against "Add" until a mode is chosen.**
  - `import-wizard.tsx:160` runs `checkOrgImport(rows, ctx, mode ?? "add")`.
  - On a round trip, every position row shows red ("already in your draft") and "Rows to fix: N" before the person has chosen anything.
  - Show nothing, or a neutral state, until "Replace" or "Add" is picked.
- **N2. Arabic number agreement.**
  - `review.confirm`, `confirmReplace`, `modeQuestion` and `removesHint` (`ar.json:3076-3103`) put the number before a singular noun («4 وحدة و4 وظيفة»). For 3 to 10 it must be plural (وحدات، وظائف).
  - Use ICU plurals, as `review.blocked` already does.
- **N3. The template's file name is Latin only.** `selah-structure-template-<date>.xlsx`: the template route passes no title, unlike the workbook route and the other exports.
- **N4. Data minimisation.** The page sends every active client member's name and e-mail to the browser (`importContext` → `ctx.people`, `services/org-chart-import.ts:94-100`), and the check never uses the name. Allowed under row-level security, but send e-mails only.
- **N5. The scan runs before authorization.**
  - The upload is scanned in `prepare`, before any check of who is asking: any signed-in user can make the server scan 20 MB against any client id, then get 404. This is the pattern of every upload route.
  - An infected import file is audited as `document.upload` on resource type `organization` (`services/evidence.ts:50-61` fallback).
- **N6. Rows past 2,000 are dropped without a word.** `xlsx-read` stops at row 2,000 and sets `truncated`; `parseImportFile` ignores it. Large sheets are refused at 500 rows anyway, so this matters only for data placed below row 2,000.
- **N7. The audit's file hash is not tied to the rows saved.** The save's audit names the hash of the file read, but the rows sent are not bound to it: any token from one's own upload accepts any rows. That is harmless, because the rows are checked again and the editor could upload them anyway. But `docs/import-export.md`'s "read from the file or text with this hash" overstates it.
- **N8. Part 3's "holdings are removed only through `app_remove_position_holder()`"** is not true while any position delete (part 3's own "Remove position", its draft reset, part 4's "Replace") cascades to holdings. B2's planned holders end this for part 4.
- **N9. The template route's guard has no test.** `canImport` is tested as a function, and mutation M4 fails the test. But the route `import/template` itself is untested. It serves an empty template, so nothing leaks.
- **N10. Errors land as "generic".** The wizard maps a server refusal it does not recognise to "That didn't work. Reload the page and try again". That includes part 1's `code_taken` from two editors importing at once, and B2's refusal.

## What I checked and found sound

**Privacy of the assistant draft:**
- Known names, e-mails, phones and the city list are masked before the text leaves (branch test, and mutation M2 fails it).
- `unmask` only puts back placeholders this text produced: an unknown `[PERSON_99]` stays and is dropped.
- `draftRows` keeps a unit, position, holder or specialty only when written in the text. A holder e-mail must be in the text, then match an active member of this client.
- HTML from the model is plain text everywhere (React, no `dangerouslySetInnerHTML`).
- The audit keeps the text's length and hash, never the text.

**Crafted saves (probe R2).**
- Rows posted straight to `confirm` with a holder e-mail of another client's admin, of the firm's lead, or of a client person who left are refused ("rows with errors"). Nothing is saved.
- The server rebuilds the context from the database and runs `checkOrgImport` again. Mutation M1 (no re-check) fails 4 tests.

**Who may import.**
- Only the firm admin, lead, deputy and staffed consultants. Observers, the team member staffed on nothing, every client person and another client get 404 from the service.
- Tokens are for one client and one person, for a day.
- Mutation M4 (`canImport` true for any firm person) fails the test.

**The save.** One transaction (the route's): a refusal at any step rolls everything back. Nothing is published, and the client admin sees no structure after an import (branch test).

**Files.**
- 20 MB, `.xlsx`/`.docx` only (`.xlsm` refused by name), zip magic, ClamAV.
- Zip limits: 2,000 entries, 40 MB per entry, 80 MB total, a 200:1 ratio.
- 2,000 rows, 60 columns and 30 sheets read. Hidden sheets are skipped, and formulas are never evaluated.
- Nothing is stored.
- The export writes every text as an inline string. Probe R7: titles, names and specialties starting with `=`, `+`, `-` and `@` gave 0 formula elements and 28 inline strings.

**The export's names.**
- Through `getStructure`: a manager with names off gets no names and no e-mails (probe R10).
- Minimal records keep no names (branch test).
- A client person asking for the draft gets 404 (probe R10).

**The AI service.**
- Bearer token, 1 to 20,000 characters, `chat_json` with a closed schema, `check_org_draft` re-checking the shape, 502 on a bad reply.
- 34/34 tests, including the new ones for the token, limits and schema.

**Never judges.** No note about width, depth, spans or layers (unit test with 40 positions in one unit and a 12-level chain). The prompt forbids suggesting or judging, and no message says "good", "bad", "too" or "should". The kind read from a unit's name is shown as a fact.

**Screens.**
- One solid button per step: "Upload and check", or "Draft from text", then "Save to draft". The rest are outline or ghost.
- Plain labels, Arabic first in the template headings, RTL sheets.
- Logical classes, codes `dir="ltr"`, file names in `<bdi>`.
- The confirm says nothing is published.

## Do the tests fail without their rule?

| Mutation | Result |
|---|---|
| M1: no server re-check in `saveImport` | 4 database tests fail ("refuses the whole save…" first) |
| M2: text sent unmasked | 1 database test fails (the masking test) |
| M3: an unknown e-mail becomes a typed name | 1 unit test fails ("flags a holder e-mail…") |
| M4: `canImport` true for any firm person | 1 database test fails ("only the draft's editors") |

Each file was restored, and `git status` was clean afterwards.

**Not tested:**
- B1 (an unknown name reaching the model);
- S1's round trip with a hand-set level;
- S2 (people in removed positions);
- S3 (numeric codes);
- S5 (who may fetch the workbook, and its content for a client reader);
- the template route;
- a doubled position from a repeated title (the test expects it).

## Check results

All on `selah_test_d`, reset and migrated from empty, `TZ=UTC`:

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` (unit) | 45 files, 694 tests passed |
| `npm run test:db` | 80 files, 1116 tests passed (809 s) |
| `services/ai` pytest | 34 passed |
| Probes R1 to R11 (throwaway file) | 11 run; findings as quoted above |
| Mutations M1 to M4 | each fails at least one test (table above) |
| Trial merge with `feature/org-chart-editor` | conflicts in the firm structure page and 4 docs; with the page resolved: typecheck pass, org chart database tests 98/98, unit 72/72; merge aborted |
| Simulated "holdings only on the published structure" | `org-chart-import.test.ts` 7 failed / 5 passed; trigger dropped, database reset and migrated again, 12/12 |
