# Selah testing guide

For anyone on the team who needs to know what the tests protect, how to run them, and how far they go. Every number here comes from reading the test files at commit `818d544` (`main`, 22 Nov 2026), or from the run records named next to it. Nothing was run to write this page.

Sources: `docs/review/final-status.md` (sections 3, 4.7, 4.9, 7), `docs/review/work/e2e-stack-run.md`, `docs/assistant.md`, `docs/assistant-eval-results.md`, `docs/review/scenarios/`, the `package.json` scripts, the three vitest configs, `apps/web/playwright.config.ts`, `scripts/local.mjs`, `.github/workflows/ci.yml` and `CLAUDE.md`.

## 1. The suites at a glance

| Suite | Where | Protects | Last recorded result | Time recorded |
|---|---|---|---|---|
| Unit | `apps/web/tests/*.test.ts` (78 files) | Permission rules in code, screen words, parsers, the number scanner, the route guard | 22 Nov: 1,188 tests, 1,185 passed, 1 failed (environment), 2 skipped | Not measured |
| Database (row-level security) | `apps/web/tests/db/*.test.ts` (100 files) | The database rules as the app's own role: who reads and writes which row | 22 Nov: 1,492 passed | 651 s to 1,023 s in reviewers' full runs (older, smaller suite) |
| Upload scanning | `apps/web/tests/scan/scan.test.ts` (1 file) | Infected files are refused and audited, with a real ClamAV | 22 Nov: 6 passed | Not measured |
| AI service | `services/ai/tests/` (2 files) | The answer check, citations, prompt wrapping, model settings | 22 Nov: 181 passed | Not measured |
| End-to-end | `apps/web/e2e/` (13 spec files) | Whole flows in a browser against the full Docker stack | 19 to 20 Nov: 67 passed, 1 failed, 3 not run | 35.3 min (8.4 min of it sign-in setup) |
| Assistant labelled test set | `apps/web/scripts/assistant-eval/testset/` | Retrieval quality and leaks over 164 synthetic files and 118 questions | 19 Nov: 81 of 89 right passage found, 0 leaks | About 2 min per full answer (median 117 s); search 0.74 s median |
| Scenarios | `docs/review/scenarios/` | Real tasks done end to end by a person (AI helpers) on a local copy | 20 Nov: 21 scenarios; 19 (isolation sweep) not finished | Not measured as a whole |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests and a build, and in separate jobs the database, upload-scanning and AI service suites, on every pull request. CI does not run the end-to-end suite, the test set or the scenarios.

## 2. Each suite

### 2.1 Unit tests

- **What it protects.** The permission rules in `authorize()` (allow and deny for each role), the route guard (every API route goes through `route()`), the screen words in Arabic and English, file readers (Excel, Word, PDF, zip bombs), the number scanner, plan and org chart import parsing, the assistant's search words and guards.
- **Why it exists.** These are fast checks that need no database. The rules in code answer before a write; the database is the backstop (section 2.2).
- **How to run.** From `apps/web`:
  - `TZ=UTC npm test` (in PowerShell: `$env:TZ="UTC"; npm test`). UTC matches CI.
  - One file: `npx vitest run tests/authorize.test.ts`.
  - With the other suites: `npm run test:all -- --quick` from the repository folder (needs Docker).
- **Time.** Not measured.
- **Flaky or environment-dependent.**
  - `tests/masking-on.test.ts`, "is true only when the service answers local: true": reads the machine's `AI_SERVICE_URL`. On the lead's copy the request went to `http://localhost:8010/v1/model` instead of the test's `http://ai.test:8000`. This is the one failure of 22 Nov. It passes in CI. Fix: make the test override the setting.
  - `tests/privacy-address.test.ts` (scans the file system): timed out once beside another job; passes alone.
  - `tests/office.test.ts`, "refuses zip bombs before inflating them": timed out once while lint ran; passes alone (7 of 7).
  - `tests/extract-text.test.ts`: two tests run only when `pdftotext` is installed (`it.runIf`). These are the 2 skipped tests.
  - Tests with fixed dates broke once when the calendar passed them (#150, #155, #185). Use `TZ=UTC`.

### 2.2 Database tests (row-level security)

- **What it protects.** Each file builds its own data in a real Postgres with all migrations, then acts as each kind of person through the app's database role. It checks that the database itself refuses what the code should never allow: another client's rows, another project, another department, firm-only work, drafts, a closed project, the wrong role.
- **Why it exists.** One missed check in app code must not leak data (README, "The rules that keep data separate"). `CLAUDE.md` asks for a test as the wrong user in the policy, the service and the database for every permission change.
- **How to run.** From `apps/web`, with a test database (never the walkthrough database):
  - `DATABASE_OWNER_URL=$TEST_DATABASE_OWNER_URL npm run db:migrate`, then `npm run test:db`. It needs `TEST_DATABASE_OWNER_URL`, `TEST_DATABASE_APP_URL` and `TEST_DATABASE_AUTH_URL`.
  - On a busy machine: `npx vitest --config vitest.db.config.ts --hookTimeout 120000 --testTimeout 120000`.
  - Or `npm run test:all -- --quick` from the repository folder: it starts the database and runs the migrations for you.
  - Files run one at a time (`fileParallelism: false`); each test may take 30 s.
- **Time.** Recorded full runs: 651 s (70 files), 722 s (74), 797 s (77), 809 s (80), 965 s (83), 1,012 s and 1,023 s (80). There is no recorded time for today's 100 files.
- **Flaky or environment-dependent.**
  - Setup hits the 10 s hook limit when lint, typecheck, a dev server, an AI service or another suite runs at the same time. Seen in `org-chart-editor`, `org-chart`, `org-chart-tree`, `department-move`, `indicator-data`, `status-pack`, `dead-links`, `metrics`, `deliverable-receipts`, `follow-through`, and `assessments` (all 17 skipped once). Remedy: the longer limits above, with nothing else running.
  - `ops-check.test.ts`, "not checked for 40 hours": got 39 once (timing); passes alone.
  - `sign-in-links.test.ts`: timed out once under load; passes alone.
  - Never share one test database between two people or two runs: seeds were wiped twice that way.

### 2.3 Upload scanning (ClamAV)

- **What it protects.** `prepareUpload()` with a real ClamAV daemon: infected uploads are refused with "file rejected: infected" and an audit row with outcome "deny"; a clean PDF is accepted as scanned.
- **Why it exists.** The scanner is outside the app. Only a real daemon proves the wiring.
- **How to run.** `docker compose up clamav -d`, wait until it is healthy (the first start takes minutes), then in `apps/web`: `CLAMD_HOST=localhost npm run test:scan`. ClamAV needs 3 GiB of free memory (4 preferred).
- **Time.** Not measured. The test timeout is 60 s per test.
- **Flaky or environment-dependent.** Fails if ClamAV is not up or not healthy. No flaky test recorded.

### 2.4 AI service (Python)

- **What it protects.** The answer check (invented citations dropped, a heading-only answer asked again, malformed output marked ungrounded), the passage and history wrappers against injected text, size limits and the token, streaming and caller hang-up, the "local model" check, the org chart draft never returning people, the model context size and its warnings.
- **Why it exists.** The service decides what counts as a grounded answer. A model is replaced by a fake, so the tests need no model.
- **How to run.** In `services/ai`: `pip install -r requirements-dev.txt`, then `python -m pytest -q`. `test:all` runs it in a `python:3.13-slim` container.
- **Size.** 78 test functions (77 in `test_service.py`, 1 in `test_stream_hangup.py`); with `parametrize` they run as 181 tests.
- **Time.** Not measured.
- **Flaky or environment-dependent.** None recorded.

### 2.5 End-to-end (Playwright)

- **What it protects.** Whole flows as each role in a real browser: recommendation to verified action (with an EICAR file refused), intake to staffing, invitation and password mail, meetings, assessments, reports, the assistant, files, Excel and Word import and export, cross-client API probes, and a crawl of every screen for 7 roles in Arabic (light) and English (dark) with axe (WCAG AA).
- **Why it exists.** It is the only suite that runs the real stack together: web app, Postgres, file storage, ClamAV, the PDF renderer, mail and the AI service.
- **How to run.** See `apps/web/e2e/README.md`. In short, from the repository folder:
  - `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d`
  - `docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm seed`
  - `docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm seed npx tsx scripts/assistant-eval/seed.ts`
  - then `cd apps/web` and `npx playwright test` (one file: `npx playwright test core-flow`).
  - `npm run test:all` runs it too, but only in the first copy (no `SELAH_INSTANCE`); it re-seeds that copy.
- **Size.** 13 spec files plus `auth.setup.ts`; 71 tests at run time (the crawl and the setup make one test per role).
- **Time.** 35.3 min for the final run (8.4 min sign-in setup, 19.8 min crawl); 27.6 min for the run as found. The README says about 20 minutes; the recorded runs took longer.
- **Flaky or environment-dependent.**
  - `assistant.e2e.ts` was written for a hosted model. With the local model, test 1 failed (the answer only repeated the question) and test 3 failed (no citation of type `status`); the 3 after the failure did not run.
  - The "owner gets a mail" test in `core-flow` depends on mail hours (held 20:00 to 07:00, never Friday). The test now releases the hold itself.
  - Sign-in setup is slow: one sign-in a minute because of the rate limit.
  - A second full run on the same database trips the inquiry conflict search. Use a fresh database.
  - Windows: `pdftotext` needs `-enc UTF-8` for Arabic; the database helper's container name is set by `E2E_DB_CONTAINER`.
  - It has never run on a staging server; there is none.

### 2.6 The assistant labelled test set

- **What it protects.** Whether search sends the right passages to the model, in Arabic and English, and never a passage from a project the asker may not use. 164 synthetic files over three clients, 100 questions with the answer passages marked, and 18 reference-library questions whose right answer today is "I can't confirm".
- **Why it exists.** Model and search choices are made on it. `tests/assistant-eval-set.test.ts` (a unit test) checks the set itself: sizes, ids, and that the indexer never cuts a marked passage.
- **How to run.** In `apps/web`, on a disposable database only (see `docs/assistant.md`, "The labelled test set"):
  - `npm run db:seed`
  - `EVAL_DB_OK=<that database's name> EVAL_S3_BUCKET=selah-eval npx tsx scripts/assistant-eval/testset-seed.ts > ids.json`
  - `S3_BUCKET=selah-eval npm run job:index-documents` (twice: 100 files a round)
  - `CONTENT=ids.json MODE=retrieval ... npx tsx --conditions=react-server scripts/assistant-eval/testset-run.ts`, or `MODE=full` for answers. A full run refuses unless the model is local.
- **Time.** Search: 0.74 s median per question. Full answers on the laptop processor: median 117 s, 12 s to 350 s. 100 full answers would take over three hours, so only 20 were answered.
- **Results (19 Nov).** Right passage sent: 81 of 89 (91%). Other-project passages: 0 in 118 questions. Leak words: 0. Answers: 10 right, 3 partly right, 6 wrong of 19 scored; one invented answer on a scanned page (N28). Scored by one reviewer.
- **Flaky or environment-dependent.** It needs its own database: two builders sharing one wiped each other's seed. On Windows `pdftotext` cannot read standard input, so the scanned PDF was not indexed by the job (one miss, N27).

The older evaluation scripts in the same folder (`run.ts`, `client-run.ts`) check access probes and canaries through the real pipeline. Their last full runs were in October with a hosted model; a 19 Nov re-run used a stand-in local model (`qwen2.5:7b-instruct`): 0 leaks in 164 questions, 59 of 59 probes as expected.

### 2.7 Scenarios

- **What they protect.** That a real task can be done from start to finish on the screens, in Arabic and English, by the right person, and that nobody else sees it. Each file is a step-by-step record with a result per step.
- **Why they exist.** They find what automated tests cannot: confusing screens, missing notices, wrong numbers on a page.
- **How to run.** By hand, on a named local copy started with `SELAH_INSTANCE=<name> npm run dev:local -- --full` (copies `scena`, `scenb`, `scenc`, `scend`). The steps are in `docs/review/work/scenarios-plan.md` and in each scenario file.
- **Time.** Not measured as a whole. Page times in the files are from the development server and say nothing about production.
- **Results.** All 21 were run on 20 Nov except 19. Failed steps: 1/13, 5/4, 9/4, 13/5 (numbers), 15 English/3d, 18 English/0c, 20/10 to 12 (fixed in #215, not re-run). Scenario 19, the isolation sweep (every record's address opened as every account that must get "Not found"), was cut off twice and is **not finished**.
- **Caveats.** Run by AI helpers, not by consultants or clients. Some steps used database shortcuts (named in the files). Screenshots are outside the repository.

## 3. Unit and database tests by area

**How the counts were made.** A script read every `*.test.ts` file under `apps/web/tests/`, `tests/db/` and `tests/scan/` and counted the calls `it(` and `test(` (with `.only`, `.skip`, `.runIf` and similar). It ignored `.test(` on regular expressions and whole-line comments. Calls to `it.each(` or `test.each(` are counted once each and shown separately, because each one runs once per row of its table. Each file is placed in one area by its name and first comment.

**These are static counts** from source at commit `818d544`. They are lower than the run-time counts, because `.each` tables, `describe.each` (3 in the unit files) and `it(` inside `for` loops make many tests from one call:

| Suite | Files | Static calls (of which `.each`) | Run-time tests (final-status, 22 Nov) |
|---|---|---|---|
| Unit | 78 | 805 (16) | 1,188 |
| Database | 100 | 1,475 (3) | 1,492 |
| Upload scanning | 1 | 3 (1) | 6 |

The file counts match final-status (78 and 100).

| Area | Unit files | Unit cases (`.each`) | Database files | Database cases (`.each`) | Denial candidates (unit / db) | Example test |
|---|---|---|---|---|---|---|
| Permissions and isolation | 7 | 135 (3) | 11 | 238 (1) | 152 (46 / 106) | `tests/db/drafts-hidden.test.ts`: "each client role reads neither the draft nor any row under it; firm roles read all of them" |
| Accounts, sign-in, roles and staffing | 5 | 31 | 11 | 109 | 36 (6 / 30) | `tests/db/two-factor.test.ts`: "is required for firm admins, consultants and client admins only" |
| Workflow states (recommendations, actions, evidence, review) | 7 | 75 (2) | 15 | 240 (2) | 77 (11 / 66) | `tests/db/second-review.test.ts`: "nobody signs off work they submitted, and an observer, outsider or client signs off nothing" |
| Clients, projects, intake, assessments and closing | 12 | 155 (3) | 23 | 273 | 97 (21 / 76) | `tests/db/closure.test.ts`: "the firm admin closes a client project; consultants and the client cannot, even its lead" |
| Masking, redaction and the number scanner | 2 | 44 (2) | 2 | 18 | 3 (2 / 1) | `tests/db/number-scanner.test.ts`: "stores tags, never the numbers, in every passage, and leaves look-alikes as written" |
| Files, upload and import/export | 7 | 54 | 3 | 37 | 22 (4 / 18) | `tests/office.test.ts`: "refuses zip bombs before inflating them" |
| Reports, progress and metrics | 5 | 22 | 5 | 55 | 22 (5 / 17) | `tests/db/report-send.test.ts`: "is built from work every client reader may see: never firm-only work, never a department's (review B2)" |
| Org chart | 5 | 101 | 7 | 162 | 75 (14 / 61) | `tests/db/org-chart.test.ts`: "is 404 for every account of another client, through every service" |
| Meetings and transcripts | 5 | 21 | 5 | 50 | 27 (6 / 21) | `tests/db/whole-project-meetings.test.ts`: "an action owner not invited gets Not found, and it is not on her list" |
| Business indicators | 2 | 22 (2) | 4 | 66 | 36 (0 / 36) | `tests/db/indicators.test.ts`: "the services agree: a manager outside the department gets not found; an action owner gets nothing" |
| Notifications and mail | 0 | 0 | 3 | 48 | 10 (0 / 10) | `tests/db/mail-choices.test.ts`: "goes at once inside the working day and waits out quiet hours over midnight" |
| Assistant, retrieval and AI jobs | 10 | 72 (3) | 8 | 156 | 38 (3 / 35) | `tests/db/ai-sources.test.ts`: "never returns a passage from a file the person can't open, for anyone, in any project" |
| Audit, operations, legal pages and dates | 8 | 44 (1) | 2 | 17 | 5 (0 / 5) | `tests/db/audit-log.test.ts`: "the app only inserts: it can't read, change or remove an entry, or reach the chain" |
| Words and translations of the screens (i18n) | 3 | 29 | 1 | 6 | 8 (5 / 3) | `tests/tips.test.ts`: "has the same keys in Arabic and English" |
| **Total** | **78** | **805 (16)** | **100** | **1,475 (3)** | **608 (123 / 485)** | |

The upload-scanning file (`tests/scan/scan.test.ts`, 3 calls, 1 `.each`) belongs to "Files, upload and import/export" and is not in the unit or database columns.

Which file is in which area:

- **Permissions and isolation.** Unit: `authorize`, `audience-authorize`, `audience-picker`, `route-guard`, `row-actions`, `not-found`, `http-invalid-id`. Database: `rls`, `audience`, `privacy-leaks`, `classification-leaks`, `drafts-hidden`, `private-recommendations`, `privacy-batch`, `file-controls`, `restricted-work`, `nav-facts`, `today`.
- **Accounts, sign-in, roles and staffing.** Unit: `attempts`, `sign-in-links`, `signed-out-messages`, `retry-after`, `person-match`. Database: `accounts`, `two-factor`, `sign-in-links`, `consent`, `client-roles`, `deputy`, `handover`, `expertise`, `people-leaving`, `observers`, `dead-links`.
- **Workflow states.** Unit: `action-filters`, `action-page`, `status-words`, `status-words-render`, `screen-text`, `firm-run-recording`, `info-requests`. Database: `action-board`, `action-comments`, `action-owner`, `follow-through`, `second-review`, `owner-actions`, `recommendation-responses`, `info-requests`, `plan-changes`, `slips`, `screen-ladder`, `screen-received-on`, `screen-firm-run`, `walkthrough-seed`, `rule-parity`.
- **Clients, projects, intake, assessments and closing.** Unit: `client-page`, `client-pages`, `project-page`, `inquiry-form`, `inquiry-steps`, `intake-constants`, `october-batch5`, `screen-components`, `home`, `navigation`, `help-in-app`, `help-page`. Database: `engagement`, `engagements`, `projects`, `prospects`, `intake`, `conflicts`, `client-profile`, `client-groups`, `client-group-viewers`, `client-overview`, `closure`, `offboarding`, `project-page`, `case-study`, `screen-small`, `screen-team`, `team-load`, `home`, `help`, `firm-settings`, `assessments`, `pulse`, `deliverable-receipts`.
- **Masking, redaction and the number scanner.** Unit: `masking-on`, `sensitive-numbers`. Database: `number-scanner`, `clean-private-names`.
- **Files, upload and import/export.** Unit: `upload-rules`, `upload-links`, `clamd`, `office`, `extract-text`, `export-pack`, `plan-import`. Database: `files`, `upload-links`, `export-pack`. Scan: `scan`.
- **Reports, progress and metrics.** Unit: `report-html`, `client-report-html`, `report-send-ui`, `report-templates`, `deliverable-words`. Database: `report-send`, `status-pack`, `metrics`, `insight`, `oversight`.
- **Org chart.** Unit: `org-chart-import`, `org-chart-outline`, `org-chart-reading`, `org-chart-text`, `org-chart-tree`. Database: `org-chart`, `org-chart-copy-ids`, `org-chart-editor`, `org-chart-import`, `org-chart-publish`, `org-chart-tree`, `department-move`.
- **Meetings and transcripts.** Unit: `agenda`, `ics`, `meeting-form`, `meeting-left-out`, `transcripts`. Database: `meetings`, `meeting-attendee-names`, `meeting-screens`, `whole-project-meetings`, `transcripts`.
- **Business indicators.** Unit: `indicator-import`, `indicator-notice`. Database: `indicators`, `indicator-data`, `indicator-moved-away`, `observer-indicators`.
- **Notifications and mail.** Database: `mail`, `mail-choices`, `lead-change-end-reminder`.
- **Assistant, retrieval and AI jobs.** Unit: `ai-jobs`, `ai-patient-fetch`, `ai-stream`, `assistant-attach`, `assistant-eval-set`, `assistant-in-flight`, `assistant-search`, `client-assistant-gaps`, `index-documents`, `legal-rulings`. Database: `ai-jobs`, `ai-sources`, `arabic-search`, `assistant-attach`, `assistant-chats`, `client-assistant`, `client-assistant-gaps`, `translations`.
- **Audit, operations, legal pages and dates.** Unit: `audit-labels`, `audit-sentences`, `activity-labels`, `ops`, `legal`, `privacy-address`, `rules-catalogue`, `dates`. Database: `audit-log`, `ops-check`.
- **Words (i18n).** Unit: `tips`, `recheck-text`, `draft-messages`. Database: `batch5-words`.

Many files test more than one thing. Notices, for example, are tested in many areas besides "Notifications and mail". The areas are a reading aid, not a strict split.

## 4. Denial tests

Final-status 4.7 says the number of denial tests was not measured. This section gives an estimate.

**What counts.** A denial test asserts that a person must not see or do something: a "Not found" or 403, an empty list, zero rows, a refused write, or an error thrown for the wrong user, role, client, project or department. A test that refuses bad input (a malformed file, a wrong date) does not count, because no person is being kept out.

**The rule used.** A static test case is a *candidate* when its title has both:

1. a word of refusal or absence: not, never, no one, nobody, nothing, none, neither, nor, cannot, can't, isn't, doesn't, don't, won't, refuses, denied, forbidden, hidden, hides, kept from, left out, leak, blocked, rejects, outsider, 403, 404, wrong, stranger; and
2. a word for a person or role: admin, client, consultant, owner, lead, deputy, observer, manager, sponsor, firm, staff, person, people, user, reader, someone, anyone, everyone, role, she, he, they, colleague, member, caller, asker, uploader, department, the app, editor, viewer, attendee, whoever.

**Checking the rule.** Two random samples of the 608 candidates (60 and 40 titles, 100 in all) were read by hand. 76 of the 100 were real denial tests. The rest were mostly about refused input, mail not sent, or wording ("speaks to the client as 'your company', never about 'the client'").

**Estimate.**

| | Unit | Database | Total |
|---|---|---|---|
| Candidates by the title rule | 123 | 485 | 608 |
| Estimated real denial tests (candidates x 0.76) | about 95 | about 370 | **about 460** |

So about 460 of the 2,283 static test cases (about 1 in 5) are denial tests. With a sample of 100, the share could be between about 0.68 and 0.84, so between about 410 and 510.

**What the rule misses.** Some denial tests do not say so in the title, for example "only the firm admin switches it on; then only the client's admin consents". A second pass found 420 more cases whose title names a person and whose body has a denial assertion (`rejects.toThrow`, `toThrow(`, `toBe(403)` or `toBe(404)`, `toHaveLength(0)`, `toEqual([])`, `toBeNull()`, `notFound`, `forbidden`, `.not.toContain`, `toBe(false)`, `toBe(0)`). A sample of 50 of them held 22 real denial tests (44%), so about 185 more. Counting those, the total could be about 650. These are estimates from titles and simple patterns, not a hand count of every test. They count static cases, so a denial written once and run per role by a loop counts once.

Per area, the candidate counts are in the table in section 3. The precision was measured only over all areas together.

Examples of denial tests:

- `tests/db/privacy-leaks.test.ts`: "an action owner sees their own action, never the titles of the others, nor how many there are"
- `tests/authorize.test.ts`: "an owner cannot move someone else's action"
- `tests/db/rls.test.ts`: "the app role cannot read the audit log"
- `tests/db/export-pack.test.ts`: "only the firm admin or the client's own admin; never a consultant, a manager or another client"
- `tests/db/assessments.test.ts`: "clients never read templates; consultants not on a project never reach its assessments"
- `tests/db/org-chart-tree.test.ts`: "refuses an action owner, another client's people and a firm person outside the client, and prints nothing"

Outside vitest there are more denial checks: 13 cross-client and role probes in `e2e/api-probes.e2e.ts`, "another client's denial" in `e2e/meetings.e2e.ts`, the leak probes in the test set (0 leaks in 118 questions), and "Not found" checks inside the scenarios.

## 5. Requirements map (report Chapter 3)

**What Chapter 3 holds.** In the report draft (`draft-original.docx`), Chapter 3 is the project plan (estimates, work plan, resources, budget), then "Overall description" with 3.2.1 Product Perspective and 3.2.2 Product Functions. The sections for specific requirements (external interfaces, user interfaces, functional requirements, non-functional requirements) are headings with no text. The draft has no requirement IDs and no table of screens or functions. So the table below uses the draft's own wording, with short labels added here: **PF** for the nine Product Functions bullets (in order), **PP** for the statements in Product Perspective and the Overall description.

| Label | Requirement (draft's words, shortened) | Automated tests that cover it | Scenarios |
|---|---|---|---|
| PF1 | User, role, organization and engagement management | `tests/db/accounts`, `client-roles`, `two-factor`, `deputy`, `handover`, `people-leaving`, `expertise`, `engagement`, `engagements`, `observers`; `tests/authorize`; `e2e/accounts`, `e2e/intake-staffing` | 1, 6, 7, 9 |
| PF2 | Recommendation and action assignment with owners and deadlines | `tests/db/follow-through`, `action-owner`, `owner-actions`, `slips`, `plan-changes`; `tests/plan-import`, `tests/action-page`; `e2e/core-flow`, `e2e/plan`, `e2e/import-export` | 1, 2 |
| PF3 | Progress tracking and evidence submission | `tests/db/follow-through`, `files`, `info-requests`, `upload-links`; `tests/upload-rules`; `tests/scan/scan`; `e2e/core-flow`, `e2e/files` | 2, 3 |
| PF4 | Consultant review, feedback and follow-up | `tests/db/second-review`, `action-comments`, `follow-through`, `oversight`, `recommendation-responses`, `slips`; `e2e/core-flow` | 3, 4, 5 |
| PF5 | Document and consulting-output management with controlled access | `tests/db/files`, `file-controls`, `audience`, `privacy-batch`, `classification-leaks`, `deliverable-receipts`, `export-pack`; `tests/audience-picker`, `tests/office`, `tests/extract-text`; `e2e/files`, `e2e/import-export` | 21, 14 |
| PF6 | Role-based dashboards, status reporting, reminders and notifications | `tests/db/home`, `today`, `action-board`, `report-send`, `status-pack`, `metrics`, `insight`, `mail`, `mail-choices`, `lead-change-end-reminder`, `follow-through`; `tests/report-html`, `tests/report-templates`, `tests/home`; `e2e/reports`, `e2e/crawl`. The look of the dashboards is checked only by the crawl (errors, direction, axe) | 11, 15 (reminder), 17 |
| PF7 | Meeting and engagement history for continued follow-up | `tests/db/meetings`, `meeting-screens`, `meeting-attendee-names`, `whole-project-meetings`, `transcripts`, `engagement`; `tests/agenda`, `tests/ics`, `tests/meeting-form`; `e2e/meetings` | 10 |
| PF8 | RAG retrieval, source-referenced answers and progress summaries using only authorized information | Access and citations: `tests/db/ai-sources`, `assistant-chats`, `assistant-attach`, `client-assistant`, `arabic-search`, `report-send` (progress draft); `tests/assistant-search`, `tests/client-assistant-gaps`; `services/ai/tests`; `e2e/assistant`. **Answer quality is not covered by an automated pass/fail test**: it is measured by the labelled test set and one person's review | 13 |
| PF9 | Optional governance assessment that produces findings and recommendations; outside recommendations entered directly | `tests/db/assessments` (findings from gaps; "direct recommendations still work without any assessment"); `tests/plan-import`; `e2e/assessments`, `e2e/import-export` | 1 |
| PP1 | Two sides: a consultant workspace and a client workspace | `tests/navigation`, `tests/client-pages`, `tests/project-page`, `tests/help-in-app`; `e2e/crawl` (7 roles) | 17, 18 |
| PP2 | Client administrators manage users and permissions; managers monitor; action owners update progress and submit evidence | `tests/db/client-roles`, `accounts`, `owner-actions`, `action-owner`, `action-board`; `tests/authorize` | 1, 2, 9 |
| PP3 | Restricted or consultant-managed engagements when a client does not use the platform | `tests/db/engagement`, `restricted-work`, `screen-firm-run`, `insight`; `tests/firm-run-recording` | 8 |
| PP4 | Access controlled by organization, role, engagement and resource permissions | `tests/authorize`, `tests/audience-authorize`, `tests/route-guard`, `tests/row-actions`; `tests/db/rls`, `audience`, `privacy-leaks`, `drafts-hidden`, `private-recommendations`; `e2e/api-probes` | 21 |
| PP5 | Client data isolated from other organizations | `tests/db/rls`, `privacy-leaks`, `classification-leaks`, `org-chart` ("is 404 for every account of another client"), `recommendation-responses`, `upload-links`; `e2e/api-probes`, `e2e/reports`, `e2e/meetings` | 1 (step 23), 16. The full sweep, scenario 19, is not finished |
| PP6 | The AI assistant follows the same access restrictions (retrieves only authorized information) | `tests/db/ai-sources`, `client-assistant`, `assistant-chats`, `client-assistant-gaps`; `e2e/assistant` (who can ask); test set: 0 other-project passages in 118 questions | 13 |
| PP7 | Final decisions stay with human users | Partly: `tests/db/report-send` ("is marked as a draft, asks the model for a draft, and is kept as one"), `tests/db/org-chart-import` (an AI draft "publishes nothing"), `tests/db/second-review` (sign-off by people). **No test asserts that the assistant itself cannot verify or approve anything** | 13 |
| PP8 | Selah does not replace consultants, HR, finance or ERP systems | **Not covered by an automated test.** It is a scope statement, not something a test can check | — |

**Count.** Of the 17 statements, 1 has no automated test (PP8, a scope statement). 2 more are only partly covered: PF8 (answer quality) and PP7 (human decision). The other 14 have at least one automated test; 13 of them have database tests (PP1 has unit and end-to-end tests only).

**Chapter 1 objectives, for reference.** The five objectives in section 1.6 fall on the same rows: the firm workspace (PF1, PF6, PP1), client workspaces with controlled access (PP2, PP4, PP5), the recommendation and action workflow (PF2 to PF4), meetings and notifications (PF6, PF7), and AI-assisted progress monitoring (PF8). One part of the last objective, AI that identifies "potential deviations or concerns", is **not built** (concern flags are on the after-scenarios list in final-status section 5), so it has no test. The rule-based oversight across projects is tested in `tests/db/oversight.test.ts`.

## 6. Gaps worth knowing

- No staging run of the end-to-end suite; it ran only on the local production-like stack.
- The isolation sweep (scenario 19) is not finished. "No privacy finding" rests on the tests above and the checks inside each scenario.
- No measured times for the unit, upload-scanning or AI service suites, and none for the database suite at today's size.
- Page response times have not been measured on a production build.
- Answer quality rests on 20 answers, one run and one reviewer.
