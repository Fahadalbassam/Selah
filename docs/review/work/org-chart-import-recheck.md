# Re-check: `feature/org-chart-import` (org chart, part 4) after the review fixes

Reviewer: independent agent, 19 Nov 2026.
Checked at `368c0e0`: the branch's fix commits `ec9899d`..`8f76a78` plus the merge of `origin/main` `15116ad` (part 3, #181), migration `0098_org_chart_planned_holders`.
Earlier review: `org-chart-import-review.md` (at `e0556c1`).

Method:
- Read the fix commits and the merged result in full:
  - `services/org-chart-import.ts`, the `draftRows` and `checkOrgImport` changes in `lib/org-chart-import.ts`;
  - `0098` and the schema file, the routes, the wizard, the structure page and outline editor changes;
  - the AI service endpoint, prompt and tests; the messages and docs.
- Read the code the fixes lean on: `app_publish_org_chart`, `app_reset_org_chart_draft`, `close_dropped_holdings`, `check_position_holder` (`0097`), and `app_mask_terms_in` (`0089`), `services/masking.ts`, `scripts/local.mjs`, `docker-compose.yml`, `README.md`.
- Ran every check on `selah_test_t`, reset (drop schema `drizzle`, `DROP OWNED BY selah_owner`) and migrated from empty.
- **Probes R1 to R5:** a throwaway database test file (`tests/db/zz-recheck-probe.test.ts`), with a fake model that records what it receives, eleven people (firm admin, lead, staffed consultant, observer, team member staffed on nothing, client admin, manager, action owner, another client's admin, another client's lead, a client manager who leaves), three clients. Also one Python probe of the AI service with hosted settings (in my scratchpad).
- **Mutations M1 to M7:** removed one guard at a time, ran the branch's tests, restored. SQL mutations were followed by a reset and a fresh migrate.
- The probe file and helper scripts are deleted. `git status` is clean. No container was touched, no other database was written.

## Verdict

**Not ready to merge yet: one blocking finding (narrow, a few lines to fix), two should-fix, six notes.**

B2 is closed. B1 is closed wherever the web app and the AI service agree on the provider. It is **open where they disagree**, and the repository's own documented setup produces that disagreement.

- **Blocking:**
  - **N-B1:** the "local model only" gate reads the **web app's** `LLM_PROVIDER` and treats an unset value as local. The AI service, which actually picks the model, never checks. In the README's "backing services in Docker, app with `npm run dev`" setup, the web's `.env.local` (from `.env.example`) has no `LLM_PROVIDER`. With the root `.env` set to `openai_compat`, the paste option shows, and every pasted name goes to the hosted model as written, unmasked.
- **Should fix:**
  - **N-S1:** publishing leaves the plans on the published version's positions. They vanish from the new draft, nobody is placed, and nothing says so, while the screens promise "placed when published". At a consultant-managed client, the leftover plans then block minimal records for good, with no screen to remove them.
  - **N-S2:** no test fails when planned names stop blocking minimal records (mutation M7).

Everything else holds:
- No client person, observer, or anyone of another client reads a plan: by SQL, through the readers, the export, the masking list, the snapshot or the audit.
- Holdings are never written by an import.
- The new tests fail without their fixes (except M7).
- The merge with part 3 is clean.

## Earlier findings

| Finding | Status | How checked |
|---|---|---|
| **B1** names reach a hosted model through the paste path | **Closed with a gap (N-B1)** | The schema, the prompt and zod have no person field; `draftRows` takes no holder; the screen says "write titles only" (`en.json:3305`); the paste tab only when `importContext().assistant`. Probe R1: `openai_compat`, `Ollama` and `"ollama "` all hide it. **Unset shows it**, and the service accepts a hosted draft (see N-B1). |
| **B2** imports write real holdings into the draft | **Closed** | Probe R2: an import of 3 rows with holders writes 3 plans and 0 holdings. R5: a plan on a published position is refused ("people are planned only for positions of the draft"). Another client's lead, with `org_id` spoofed to their own client, is refused by RLS (the trigger resets `org_id` before `WITH CHECK`). Part 3's "holdings only on the live structure" now passes with the import: `org-chart-import` 20/20 and `org-chart-editor` 39/39 on the merged code. |
| S1 round trip with a hand level, more holders than planned | Closed | Branch test "round-trips what the app itself allows" (`tests/db/org-chart-import.test.ts:397`); `levelParent` and `tooManyHolders` are warnings. |
| S2 Replace drops positions with people, silently | Closed | `plan.leaving` lists each position with "Held today by …" (`import-wizard.tsx:392-425`); saving waits for the tick; "Skip this row: removes 2.1.1 from the draft" (`removedIfSkipped`). |
| S3 Excel turns 2.10 into 2.1 | Closed | The template's code columns are Text (`templateSheets`, `text: ORG_CODE_FIELDS.includes(f)`); a numeric code cell gets the `numericCode` warning; branch test `:493`. |
| S4 the assistant doubles a position | Closed | `draftRows` keeps one position per title per unit unless the text lists it separately (`lib/org-chart-import.ts`, after `:427`); unit tests updated. The holder half went with B1. |
| S5 the filled export is open to every reader by API | Closed | `orgChartWorkbook` starts with `importContext` (editors only) and a 10-per-10-minutes limit. Probe R2: observer, client admin, manager, owner, another client's admin and lead all get 404. Mutation M4 fails 2 tests. |
| S6 merge with part 3 | Closed | Merged in `368c0e0`. **Import** sits in the Structure header beside the edit link, also on the empty state (`structure/page.tsx`). The editor's plan line is passed only when editing a draft. Typecheck, lint and all tests pass. |
| S7 length checked before masking | Closed | Checked after masking too, "text too long: N" (`services/org-chart-import.ts:330`). Mutation M5 fails the test. |
| N1-N10 | Not re-checked one by one | N8 is moot for imports (plans, not holdings). N10 stands. |

## Findings

### Blocking

**N-B1. The "local model only" gate fails open: the web app guesses the provider, and the AI service drafts with a hosted model anyway.**

- **Where:**
  - `apps/web/src/services/org-chart-import.ts:81`: `localModel(provider = process.env.LLM_PROVIDER ?? "ollama")`, so unset means local.
  - `services/ai/app/main.py:255-272`: `/v1/org-chart/draft` never looks at `settings.llm_provider`.
- **Failing scenario:**
  - **Probe R1:** with `LLM_PROVIDER` unset in the web's environment, `importContext().assistant` is `true`. `draftFromText(…, "Finance Manager: Khalid Al-Otaibi\nAccountant: Reem Al-Harbi")` sent the model exactly that text. Masking is also off, because `maskingOn()` makes the same guess.
  - **Python probe:** the service with `Settings(llm_provider="openai_compat", …)` answers 200 to `/v1/org-chart/draft`, and its LLM receives `<text>\nFinance Manager: Khalid Al-Otaibi\n</text>`.
- **Why this is a real setup, not a contrived one:**
  - `README.md:76-87` documents the hot-reload setup: `docker compose up … ai`, which reads the root `.env`, then `cd apps/web; cp .env.example .env.local; npm run dev`.
  - `apps/web/.env.example` has no `LLM_PROVIDER`.
  - `docs/walkthrough.md:58` and `scripts/local.mjs:300` tell people to put `LLM_PROVIDER=openai_compat` in the root `.env`. The lead's own root `.env` ends with that today, and its `apps/web/.env.local` has no `LLM_PROVIDER`.
  - `npm run dev:local` and the compose `web` service pass the same value to both, so they are safe. The documented manual path is not.
  - The decision was "the paste option appears only when `LLM_PROVIDER` is `ollama`". The model that runs is chosen by the service's setting, not the web's.
- **Fix (small):**
  - The AI service refuses `/v1/org-chart/draft` unless `settings.llm_provider == "ollama"` (for example 409 "local model only"). Add a service test with hosted settings.
  - The web maps that refusal to the paste option being off.
  - Optionally, add `LLM_PROVIDER=ollama` with a comment to `apps/web/.env.example` so the two are set together.
  - The assistant's masking has the same default (`services/masking.ts:12`): that one predates this branch, but the same remark applies.

### Should fix

**N-S1. Publishing does not place the plans, does not clear them, and does not say so; afterwards they can block minimal records for good.**

- **Where:**
  - `app_publish_org_chart` (`drizzle/0097_org_chart_editor.sql`) flips the draft to published, keeping its position ids, and copies it into a new draft with `app_org_chart_copy`, which knows nothing of plans.
  - `check_minimal_records` (`0098`) refuses while any plan exists, in any version.
- **Failing scenario (probe R3):**
  1. Import 3 rows with holders, then publish through `OC.publish`.
  2. The 3 plans now sit on the **published** version's positions. Holdings: 0. The editor's plan line and `importContext` for the new draft are empty, so the plan is gone from every screen.
  3. The editors' whole masking list still has the planned names.
  4. At a consultant-managed client, the same import, publish, then the firm admin switches to minimal records: refused, "remove the names of people from the client's structure before switching to minimal records". No screen shows or removes a plan on a published version, and the trigger refuses plans there, so a re-import cannot clear it either.
- **What the screens say instead:**
  - "Planned: placed in the position when this version of the structure is published, not before" (`en.json:3438`);
  - "Planned, placed when published: {names}" (`:3508`);
  - the template guide (`:3484`).
- **Today's reach:** no route or screen publishes yet (part 5), so a user cannot hit this today. The services and the walkthrough seed can. Part 5 must land the conversion together with this, or the database must hold the line now.
- **The branch's own test:** "publishing leaves the plans for part 5" (`tests/db/org-chart-import.test.ts:421`) records this behaviour as intended.
- **Fix (decide one):**
  - `app_publish_org_chart` refuses while the draft has plans, until part 5 converts them;
  - or it moves them to the new draft (same lineage);
  - or it deletes them with an `org_chart.plan` audit, and the screens stop saying "placed when published" until part 5.
  - Either way, `check_minimal_records` should not be blocked by plans on non-draft versions that nobody can see.
- **Privacy:** none. After publishing, no client reader saw a plan (R3: client admin and manager read 0 rows; `getStructure` and the snapshot have no planned name).

**N-S2. No test covers "minimal records refused while a plan names someone".**

- Mutation M7 removed the `org_chart_planned_holders` clause from `check_minimal_records`: `org-chart-import` and `org-chart-editor` all pass (59/59).
- The editor tests at `org-chart-editor.test.ts:494` and `:983` cover holdings only.
- Add: a draft plan with a typed name blocks the switch; removing it through a re-import with an empty holder unblocks it.

### Notes

- **N-N1. `app_mask_terms_in()` confirms planned names to anyone who can see the project.**
  - Probe R2: the client admin, the manager, the action owner and the observer each get 3 forms back from `app_mask_terms_in(P, 'Zubair Planned-Typed')`, while their `app_mask_terms` has no planned name.
  - This is by design (`0098` comment: only names written in the text). What reaches the user is only that their own text is masked before a hosted model: the result goes to the masker, not the screen, and the counts go to the firm's audit. It is still an oracle on the database surface, the same as for typed holder names.
  - Acceptable. If kept, say so in `docs/rules.md` next to "the whole masking list gives it to the draft's editors only".
- **N-N2. Leaving does not touch plans, and the round trip then breaks.**
  - Probe R4: a client manager planned by e-mail leaves. The plan stays, and the editor's plan line still shows "Leaving Person".
  - The draft export writes `leaver@example.test`, and bringing it back with Replace fails: "rows with errors: 3" (`holderNotUser`).
  - Either end plans in `end_holdings_on_leaving`'s spirit, or let the check say "no longer at the client; remove or replace".
- **N-N3. The only way to remove a plan is a re-import.** Part 3's editor shows the plan line but has no "remove" (`outline-editor.tsx`, the `plannedLine` span). Draft reset (`app_reset_org_chart_draft`) and "Remove position" drop plans by cascade with no `org_chart.plan` audit. Harmless for privacy.
- **N-N4. A doc is stale.** `docs/import-export.md:81` still lists `changeHolder` among the services the save goes through. It no longer does.
- **N-N5. `docs/rules.md` says "only while the AI service runs the local model".** The code checks the web's setting (see N-B1). Fix the code or the sentence.
- **N-N6. Text over 21,000 characters gets "invalid input".** The draft route's body is capped at `ORG_IMPORT_LIMITS.text + 1000` (`import/draft/route.ts`), so a 21,001-character paste fails zod and gets the generic message, not "shorten it by N". Minor.

## What I checked and found sound

**Who reads a plan (probe R2, after an import of 3 plans, one typed, two by account):**

| Reader | Table (RLS) | `app_mask_terms` planned names | `getStructure("draft")` | Workbook |
|---|---|---|---|---|
| Firm admin, lead, staffed consultant | 3 | yes | no names (plans are not in it) | served |
| Observer | 0 | none | no plan | 404 |
| Team member staffed on nothing | 0 | none (empty list) | refused | 404 |
| Client admin, manager | 0 | none | refused (no draft) | 404 |
| Action owner | 0 | list refused | refused | 404 |
| Another client's admin and lead | 0 | none (empty list) | refused | 404 |

- The one non-planned match the client admin, manager and observer get in `app_mask_terms` is the leaving manager's own account name (`user:` entry), as before. `app_mask_names()` is not executable by `selah_app`.
- **Audit:** `org_chart.plan` carries counts only. No audit row holds a planned name (R2).
- **Notifications:** none written by an import.
- **After publishing (R3):** no client reader reads a plan, and the published snapshot has no planned name.
- **The editor's plan line:** `plannedNames` is read under RLS and passed only while editing the draft (`structure/page.tsx`). An observer or client admin gets `{}` (branch test `:355`).
- **Search, PDF, the assistant index:** no code reads `org_chart_planned_holders` besides `services/org-chart-import.ts` and the masking functions (grep of `src`).
- **The assistant's draft:** no person field in the prompt, the service schema (`additionalProperties: false`), zod (`ai-client.ts`) or `draftRows`. A reply carrying `holder` is dropped (branch test `:580`). The audit keeps the length and hash only.
- **The merge with part 3:**
  - Holdings stay on the published structure only: `check_position_holder` from `0097` is untouched, and the import never calls `changeHolder`.
  - Merged suites: `org-chart-import` 20/20, `org-chart-editor` 39/39, the whole database suite green apart from one timing flake, typecheck and lint clean.

## Do the tests fail without their fix?

| Mutation | Result |
|---|---|
| M1: `app_mask_terms` without the `planned:` filter | 1 fails ("publishing leaves the plans… no client reader") |
| M2: `editor_read` policy `USING (true)` | 2 fail ("lets only the draft's editors read or write a plan", "publishing leaves the plans…") |
| M3: `localModel()` always true | 1 fails ("is offered only when the AI service runs the local model") |
| M4: `orgChartWorkbook` without `importContext` | 2 fail ("is for the draft's editors only", "is limited like the PDF") |
| M5: no length check after masking | 1 fails ("checks the length after masking") |
| M7: `check_minimal_records` ignores plans | **0 fail** (N-S2) |
| (no mutation possible) the service's provider check | does not exist (N-B1) |

Each change was restored. SQL mutations were followed by a reset and a fresh migrate.

## Check results

All on `selah_test_t`, reset and migrated from empty, `TZ=UTC`:

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` (unit) | 54 files, 829 passed, 2 skipped |
| `npm run test:db` | 84 files, 1194 passed, 1 failed: `ops-check.test.ts` "not checked for 40 hours" got 39, a timing flake. The branch does not touch it, and it passes 4/4 alone. |
| `services/ai` pytest (Python 3.13 venv) | 35 passed |
| Probes R1-R5 and the service probe | findings as quoted above |
| Mutations M1-M5, M7 | table above |
