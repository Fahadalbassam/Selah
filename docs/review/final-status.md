# Selah review run: final status (22 Nov 2026)

Source: `origin/main` at d57b778 (22 Nov 2026), after `git fetch`. "The owner" is the product owner. Every number below comes from a file on `origin/main` or from the pull request list; where a source is silent the text says so. Data is synthetic throughout (the walkthrough cast of a fictional firm and its fictional clients).

---

## 1. Done

### 1.1 Gates and decisions

| Item | What it does or decided | PR |
|---|---|---|
| Phase 1 audit and Gate A (answers 17 Nov) | Every page audited in Arabic and English (778 screens per language, 14 accounts); eight decisions put to the owner and answered | #152 (audit files), #154 (audit checked against the October review) |
| D1 | Give one action to a colleague (client admin, project coordinator, sponsor): yes | #184 (batch 4) |
| D2 | Remove Trace; Today becomes the home; Oversight becomes filters on one Actions list: yes | #182 (Trace), #179 (home), #178 (Actions filters) |
| D3 | Six status words; "Verified" and "Closed" stay apart: yes | #188 (batch 5) |
| D4 | A consultant changes client indicators only when staffed (not as observer) or as lead or deputy: yes | #156 |
| D5 | Show counts instead of the "Off track" label: yes | Batch 2 (#178 to #180); PR: see lead log for the single number |
| D6 | Clients do not see draft actions until the firm releases them: yes | #160 (migrations 0076, 0077) |
| D7 | The firm's own name on signed-out pages and mails, from its record, never from the code: yes | Batch 1 (#176, #177); PR: see lead log for the single number |
| D8 | Department-limited people see nothing by title from other departments; four leaks closed at once, agenda rebuild left to the owner's choice | #156 |
| Gate A follow-ups (17 Nov) | The owner's written answers and the two approved features recorded | #157 |
| Agenda option C ("the agenda follows the meeting") | A department's meeting lists only that department's work; a whole-project meeting opens only for people who may see everything; invited action owners may open it and see only their own follow-ups | #165 (stop-gap in #156) |
| Action owners see only their own actions (follow-up 1b; the request called it "owner-only tasks") | Row-level security and `authorize()`: no titles and no counts of others' actions on any screen, mail, export, search or assistant answer | #165, #203 (a full client's admin is never given an action) |
| Indicator links firm-only (follow-up 1c) | Only firm staff link an indicator to a recommendation | #165 |
| Gate B (answers 19 Nov, two parts) | Every recommendation on the list accepted (including item 20); value test run by the owner alone; model, order and working rules set | Documents: `docs/review/unfinished-assessment.md`; PR: see lead log |
| Gate B items built | See 1.4 | |

### 1.2 Phase 1: batches 0 to 5

| Batch | What | PRs |
|---|---|---|
| Tooling | A second copy of Selah beside the first on one machine (`SELAH_INSTANCE`) | #151 |
| 0 | Broken test date on `main` fixed; signed-out page bugs; tests with fixed dates; the privacy leaks; Next.js 16.4.2 to 16.4.6 and Node 22.12 or newer; drafts hidden from clients (D6); remaining screen bugs; agenda option C, owners see their own actions, indicator links firm-only; fixes from the re-check; a dated security-check exception for a picomatch advisory with no fix | #150, #153, #155, #156, #158, #160, #161, #165, #173, #163 |
| 1 | 1A: the client's pages show the client's work, not the firm's machinery. 1B: Help keeps three things, dense rows get one button and a menu, a shorter inquiry form | #176, #177 |
| 2 | 2C: one Actions list with filters, a Projects table. 2A: one home per role. 2B: one sidebar per role and a user menu | #178, #179, #180 |
| 3 | Project page built around the plan, 11 tabs to 5 | #182 |
| 4 | One way to send a file, one action page, give an action to a colleague (D1) | #184 |
| 5 | Six status words, client page in tabs, numbered inquiry steps, plain-words audit log | #188 |
| Test fixes | Retention days worked out in the database; three indicator dates that would expire | #185 |

### 1.3 The approved features

| Feature | What it does | PRs |
|---|---|---|
| Visibility picker ("who sees an item") | "Everyone with access, except..." or "Only these people..." on files (never evidence) and meetings; only ever takes people away; enforced in the database, `authorize()`, mail, search, exports and the assistant | #162 (screens), #175 (enforced everywhere) |
| Org chart, 5 parts | Positions not people; draft and published versions; drawn tree and PDF; editor, holders, vacancies, the person work card; Excel, Word and the assistant's draft from pasted text; publishing, the client's view, suggestions, "your manager". Never grants or limits access | #168, #172, #181, #183, #186 |
| Deliverable receipt (4a) | Firm hands over a deliverable, the client confirms receipt or comments; four plain states; "Received" never means "accepted as good" | #171 |
| Indicator "moved away" alert (4b) | One factual notice per ended period when a figure is on the wrong side of baseline or short of target after the date; client-reported, not verified impact | #167 |
| Org chart ids fix (found in scenario 20) | Ids made at publish were not valid; fixed and stored ids repaired (migration 0115) | #215 |

### 1.4 Phase 2 and phase 3

| Item | What it does | PRs |
|---|---|---|
| Phase 2: handbook (Arabic and English) and README fixes | Firm guide, client guide, limits, technical pack; README now says a consultant sees only the projects they are staffed on | #189 |
| Phase 2: help | 95 tooltips, first-visit lines, empty states, a guide per role on `/help/guide`, FAQ and tab-name wording | #190 |
| Client guide corrections | Guide matches the screen after a step-by-step walk on a fresh copy | #194 |
| Local model switch | Context size sent on every call, JSON fallback on Ollama, honest GPU note; then `qwen3.5:4b` made the default | #191, #207 |
| Slow local answers | The AI service sends a "wait" every 10 s; the card says "Still working"; 10-minute ceilings | #208 |
| Masking fails closed | If the web app and AI service disagree about a local model, masking stays on; heading-only answers refused; stale words and docs | #192 |
| Leak fixes | Five proven leaks (firm-only title in a leaving report, private file name in the audit log on withdraw, withdrawn names kept as "shared", shared report and PDF counting firm-only work, progress history for client managers); confidential-request bypass by a new version; a client manager moving another person's file | #193 (migration 0106) |
| Restricted clients | The client admin can do the work on actions they own | #197 |
| Privacy batch | Only the uploader or an admin switches a file's assistant on (anyone on the owning side switches it off); whole-project invitations refused for department-limited managers; "I am stuck" notifies the firm | #200 |
| Words and small bugs; client assistant gaps; give to a colleague | Neutral indicator words; "who is my consultant", "my deadlines" for the asker only, legal answers with the documents' facts, facts-only progress draft; search by name in both languages | #196, #198, #202 |
| Lead change and end reminder | Client and old lead told of a lead change with a handover note; reminder before an engagement ends (30 days or less) | #199 |
| Report flow | Consultants' facts-only progress draft, "Use as draft" into the report page, approval by a second person, confirmed send; three templates (monthly progress, steering summary, closing summary); @-attach a Selah file in the assistant | #201, #204, #206 |
| Value test and later improvements | Single-tester trial prepared (six tasks and a score sheet); later improvements and reference library plan written down, nothing built | #195 |
| Audit-row clean-up script | Cleans private file names from old withdrawal records; written, not run (run before go-live) | #205 |
| Section 7 | Labelled test set and first local run (#207); Arabic spelling fold for search and masking (#209); translations, summaries and org chart draft as background jobs (#211); sensitive-number scanner (#213). Reranker not built: the test set gave no evidence for it | #207, #209, #211, #213 |
| End-to-end suite on the production-like stack | Suite refreshed to the merged screens; four image updates checked | #210 |

### 1.5 Scenarios, documents, map, Dependabot

| Item | What it does | PRs |
|---|---|---|
| Scenario runs | 21 scenario texts prepared; scenarios run on four copies (see section 2); reports merged | #214, #220, #221, #222 |
| Scenario fix | Org chart publish ids (scenario 20) | #215 |
| Docs, map, PDFs | `CLAUDE.md` and `docs/system-map.md`; the three team documents (handbook, workflows, production path; PDFs in `docs/team/`); the interactive Selah map (`docs/selah-map.html`, `npm run map`; 37 nodes, 70 links, 123 shared files at build; Arabic node text still needs native review); lead log milestones and the pause note | #214, #217, #218, #219, #223, #224, #225, #212 (tunnel live-test note) |
| Dependabot merged | Next.js group and 14 others (taken as #158); mailpit, pydantic-settings, fastapi, uvicorn; the three GitHub Actions bumps (merged by the owner); the four image updates after the stack check (gotenberg, rustfs, caddy, cloudflared); on 22 Nov: pytest, fastapi, pydantic-settings, mailpit, web minor-and-patch group | #149, #141, #52, #51, #49, #46, #50, #140, #139, #142, #143, #144, #230, #231, #233, #234, #235 |
| Dependabot closed with a reason | Python 3.15, Node 25, TypeScript 7, @types/node 26 (earlier PRs) | #148, #45, #54, #56 |

---

## 2. Scenarios 1 to 21

Titles come from the scenario plan (`docs/review/work/scenarios-plan.md`); the big prompt (section 9.3) is not in the repository, so its wording could not be checked. Screenshots: local only, not in the repo, at `C:\Projects\selah-scenario-shots\<nn>\` (two-digit scenario number). Copies: A (`scena`, Arabic), B (`scenb`, Arabic), C (`scenc`, Arabic), D (`scend`, English). Date: every file that states one says 20 Nov 2026; copy B files 03 to 21 carry no date line (the lead log and `00-copy-b-status.md` place copy B on 20 Nov). No file says 21 Nov. Results are as written in each file; "friction" means the step could be done with something confusing.

| # | Title | Result | Copy and language | Evidence file (`docs/review/scenarios/`) | Date |
|---|---|---|---|---|---|
| 1 | A new client from first contact to a working plan | Passed with friction. 24 steps passed, 1 failed (step 13: a consultant cannot set his own expertise). Plan import could not name owners before the client's people were in the project | A, Arabic | `01-new-client-to-plan.md` | 20 Nov |
| 2 | The everyday cycle, done right | Passed with friction (two-sign-off rule works; reports could not be compared for one number) | A, Arabic | `02-everyday-cycle.md` | 20 Nov |
| 2 | Same, English | Passed (all 11 steps, friction noted); run on the seeded Al-Nukhba because copy D has no Sahm | D, English | `02-everyday-cycle-en.md` | 20 Nov |
| 3 | Evidence sent back twice | Passed with friction (9 steps; approving needs the evidence item accepted first; step 9 numbers could not be proven from the screen) | B, Arabic | `03-evidence-sent-back-twice.md` | 20 Nov (file shows 20/11/2026 inside the app; no date line) |
| 4 | A blocked action and an accepted risk | Passed with friction (workaround for the stale-days list; accept-risk form hint unclear) | B, Arabic | `04-blocked-and-accepted-risk.md` | 20 Nov (no date line) |
| 5 | Asking for more time, twice | Failed step: 4 (declining a date request carries no reason or meeting offer); step 5 partial; other steps passed | B, Arabic | `05-asking-for-more-time.md` | 20 Nov |
| 6 | The lead leaves: a planned handover | Passed (step 1, extra sign-off, not run: seed state used) | B, Arabic | `06-lead-leaves.md` | 20 Nov (no date line) |
| 7 | An unhappy client and a consultant switch | Passed (all steps) | B, Arabic | `07-unhappy-client.md` | 20 Nov (no date line) |
| 7 | Same, English | Passed (one friction: the client has to know to look in Help; she is not told when her consultant changes) | D, English | `07-unhappy-client-en.md` | 20 Nov |
| 8 | A firm-run client with no accounts | Passed with friction (step 6 partly) | A, Arabic | `08-firm-run-client.md` | 20 Nov |
| 9 | Someone leaves the client company | Passed with friction; step 4 failed against the plan (only the new owner is told; the old owner, the consultant and the lead get nothing) | A, Arabic | `09-someone-leaves-client.md` | 20 Nov |
| 10 | A steering meeting from booking to follow-ups | Passed with friction (confirm-held button only after start time; summary switch labelled firm-only but ON means shared) | B, Arabic | `10-steering-meeting.md` | 20 Nov (no date line) |
| 11 | The monthly report | Passed with defects (PDF header can show the previous day because it uses UTC; sharing sends no client notice) | B, Arabic | `11-monthly-report.md` | 20 Nov |
| 12 | Business indicators, a month at a time | Passed with friction (import hidden until a data mode is chosen). Sahm half only | A, Arabic | `12-business-indicators.md` | 20 Nov |
| 12 | Same, English | Passed with friction; whole scenario on Al-Nukhba | D, English | `12-business-indicators-en.md` | 20 Nov |
| 13 | The assistant, on both sides, under pressure | Passed with notes. 17 steps: no privacy finding; step 5 numbers FAIL (progress draft said 0 verified and 1 late, the project page says 1 of 8 and 3 late); step 17 (value test) not done | B, Arabic (local model `qwen3.5:4b`) | `13-assistant.md` | 20 Nov (no date line) |
| 14 | Closing a project properly | Passed with friction (closing starts only from the menu on an active project; closure PDF total off by one) | C, Arabic | `14-closing-a-project.md` | 20 Nov |
| 15 | Offboarding a client at the end of the engagement | Passed with friction (the refusal while a project is open was not seen) | C, Arabic | `15-offboarding-a-client.md` | 20 Nov |
| 15 | End-of-engagement reminder (step 8 only) | Passed | A, Arabic | `15-engagement-end-reminder.md` | 20 Nov |
| 15 | Offboarding and reminder, English | Passed with friction; step 3d failed (small): Reply and "I'll attend" offered on an archived client and refused with the wrong reason | D, English | `15-offboarding-and-reminder-en.md` | 20 Nov |
| 16 | A holding group | Passed (Sahm made from inquiry INQ-1A0E3E05 with one admin; group 22% equals the sum of parts) | B, Arabic | `16-holding-group.md` | 20 Nov (no date line) |
| 17 | A busy Monday morning | Passed with notes (all three people found what needs them on the first screen) | B, Arabic | `17-monday-morning.md` | 20 Nov (no date line) |
| 18 | English, dark mode, tablet (768 px) | Passed with friction; step 0c failed (twice): "release now" switch ON by default, easy to switch off by mistake, drafts saved | D, English, 768 px dark | `18-english-dark-tablet-768.md` | 20 Nov |
| 18 | Layout, keyboard, language (the 1280 px Arabic part) | Passed with friction | C, Arabic | `18-english-dark-tablet.md` | 20 Nov |
| 19 | Isolation sweep | **Not finished** (see below) | A to D | No `19-isolation-sweep.md` on `origin/main` | Interrupted 20 Nov |
| 20 | The client's structure, from the firm's slide to a printed chart | **Failed steps 10 to 12** (the next draft could not be edited after the first publish: HTTP 400; invitation into a vacant position failed); 14 steps passed, 2 failed; step 11 not run (dialog checked). Bug fixed afterwards in #215; not re-run | A, Arabic | `20-structure-to-printed-chart.md` | 20 Nov |
| 21 | A file and a meeting kept from one person | Passed (one friction); nobody left out found anything, not even a count | B, Arabic | `21-limited-audience.md` | 20 Nov (no date line) |

Totals the lead log gives for copy A: scenarios 1, 2, 9, 12, 8, 20, 15-reminder had 70 steps passed and 4 failed. No other copy has a total in the sources.

**Scenario 13 value test (the owner's timed trial of the six tasks):** not run. `docs/value-test.md` holds the tasks, answer keys and `docs/value-test-score-sheet.csv`; the run record is empty. The step 17 row of `13-assistant.md` says "NOT DONE"; assistant times were noted (find a clause 85 to 96 s, draft a follow-up 97 s) but no manual times.

**Scenario 19, isolation sweep: not finished.** The sweep (a reviewer opening every record's address as every account that must get "Not found") was cut off twice, by a laptop crash on 20 Nov and then by a pause at the owner's request. No sweep report file is on `origin/main`. What exists:
- The address lists it was to use: `urls-A.json`, `urls-b.json` (partial), `urls-C.json`, `urls-D.json` in `docs/review/scenarios/`.
- The lead log states "no PRIVACY finding" on any copy; this rests on the isolation checks inside the individual scenarios (for example scenario 1 step 23: Turki and a Sahm manager got "Not found" for the Rawdah, Al-Nukhba, Al-Waha, internal and real-estate project addresses; scenario 16: every cross-client page returned "Not found" and the assistant page is closed to Rawdah and Sahm admins; scenario 21: no leak of a left-out item).
- Not stated anywhere as run: the 45 rows of `docs/walkthrough.md` section 6 across all copies, and the per-account checks of search, bell, mail, exports and PDFs described in the plan.
- Scenario 13 note: the "Not found" page for a closed route answers HTTP 200 (the words are inside the page); also seen in the audit.

Other facts for the scenario chapter:
- Scenario runs used shortcuts that are not user actions, each named in its file: an action backdated in the database (4); a queued mail released by editing its retry time (3); seeded files cannot be downloaded on a `--full` copy because their scan status is "skipped" (3, 13).
- `docs/review/scenarios/work-log.jsonl` (138 lines) is the step log of scenario 20 on copy A.

---

## 3. Tests

**Full test results (filled in by the lead):**

**Final `npm run test:all`, 22 Nov 2026,** on `main` at d57b778 (after #235), run as `SELAH_INSTANCE=lead npm run test:all` on the lead's laptop copy (Windows 11, Docker Desktop, `TZ=UTC` as in CI):

| Suite | Result | Counts |
|---|---|---|
| Lint | pass | — |
| Type check | pass | — |
| Unit tests | **FAIL** (1 test) | 78 files: 77 passed, 1 failed; 1,188 tests: 1,185 passed, **1 failed**, 2 skipped |
| Database tests (row-level security) | pass | 100 files, 1,492 tests passed |
| Upload scanning tests (ClamAV) | pass | 1 file, 6 tests passed |
| AI service tests (Python) | pass | 181 passed |
| End-to-end tests | **not run** by `test:all` here | `test:all` skips them in a named copy by design (they run only in the default copy, which is the owner's own walkthrough copy and would be re-seeded). They were run separately on the production-like `docker-compose.test.yml` stack on 19–20 Nov: 67 passed, 1 failed, 3 not run (see section 4.9). |

**The one unit failure:** `tests/masking-on.test.ts` › `modelIsLocal` › "is true only when the service answers local: true" expected the request to go to `http://ai.test:8000/v1/model` (the address the test sets) but it went to `http://localhost:8010/v1/model` (the lead copy's own AI service address). The test depends on the machine's environment: it passes in GitHub CI (green on every PR, including the five Dependabot merges of 22 Nov) where that variable is not set. It is a test-isolation fault, not an application fault. Next step: make the test override the setting so the machine's value cannot win.

Latest counts recorded in the sources, for comparison (each from a reviewer's run, not from `origin/main` today):

| Where | Counts | Source |
|---|---|---|
| Report flow review (19 Nov) | unit 1,081; AI service 174; database 1,366 of 1,367 pass (the one failure is the `ops-check` timing test) | `docs/review/work/report-flow-review.md` |
| Leak fixes review (#193) | database 89 files, 1,316 tests pass | `docs/review/work/leak-fixes-review.md` |
| Restricted-client fix review (#197) | unit 65 files, 1,020 passed, 2 skipped; database 89 files, 1,310 passed | `docs/review/work/restricted-fix-review.md` |

**Known flaky or environment-dependent tests found in the sources**

| Test or area | What happens | Where it was seen |
|---|---|---|
| `ops-check.test.ts`, "not checked for 40 hours" | Got 39: a timing flake; passes alone (4 of 4) | `org-chart-import-recheck.md`, `report-flow-review.md` |
| `sign-in-links` | Timed out once under load; passed alone | Lead log, Phase 1 test run |
| Database test setup (10 s default hook timeout) | Setup times out when lint, typecheck, a dev server or other suites share the machine | `org-chart-editor` and `org-chart` (`org-chart-editor-recheck.md`); `department-move`, `indicator-data`, `status-pack` (`org-chart-tree-review.md`, waiting on disk sync); `dead-links`, `metrics`, `status-pack` (`recheck-fix-review.md`); `assessments` skipped all 17 tests (`audience-picker-review.md`); a first full run on the lead's copy (lead log, "A failure, explained") |
| Remedy used | Run the database suite with `--hookTimeout 120000 --testTimeout 120000`, with nothing else running; reviewers' clean full runs took 722 s (983 tests, 74 files), 797 s (1,034 tests, 77 files) and 1,012 s (1,068 passed, 72 skipped, 78 of 80 files) | `audience-picker-recheck.md`, `recheck-fix-review.md`, `org-chart-editor-recheck.md` |
| `privacy-address.test.ts` (unit, filesystem scan) | Timed out once in a run made beside a probe; passes alone | `org-chart-editor-recheck.md` |
| Tests with fixed dates | `assistant-chats` seeded an action due 15 Nov, so `main` was red from 16 Nov (#150); more dates moved in #155 and #185 (retention days worked out in the database, time-zone independence) | Lead log |
| Time zone | Reviewers ran with `TZ=UTC`; two retention tests were made independent of the machine's time zone (#185) | `restricted-fix-review.md`, lead log |
| End-to-end: work mail hold | The "owner gets a mail" test passes only inside mail hours (hold 20:00 to 07:00, never Friday); the test now releases the hold | `e2e-stack-run.md` |
| End-to-end: sign-in setup | 8.4 min of the 35.3-min run (one sign-in a minute, rate limit) | `e2e-stack-run.md` |
| End-to-end: rerun on the same data | A second full run on the same database trips the inquiry conflict search; use a fresh database | `e2e-stack-run.md` |
| End-to-end: assistant tests | Written for a hosted model; with the local model one fails (the answer only echoed the question) and one fails (no citation of type `status`); 1 failed, 3 not run in the final run | `e2e-stack-run.md` |
| End-to-end: Windows | `pdftotext` lost Arabic letters (needs `-enc UTF-8`); the database helper assumed container name `selah-db-1` (now `E2E_DB_CONTAINER`) | `e2e-stack-run.md` |
| Assistant test set | Needs a database of its own: two builders sharing one wiped each other's seed twice | `assistant-eval-results.md` |
| Scanned PDF indexing on Windows | `pdftotext` cannot read standard input there, so the scanned test PDF was not indexed by the job (one miss, N27, in the second run) | `assistant-eval-results.md` |

**Also seen during this run (in builder and reviewer reports, not in a repo file):** `masking-on.test.ts` reads the machine's `AI_SERVICE_URL` (the failure above); `deliverable-receipts` and `follow-through` hit a 10-second setup timeout when lint and unit tests ran at the same time, and passed alone; `org-chart-tree` timed out in setup while an AI service ran alongside, and passed alone (20/20); `office.test.ts` ("refuses zip bombs before inflating them") timed out once while lint ran at the same time, and passed alone (7/7). All are load- or environment-dependent; none failed in CI.

---

## 4. Measurements for Chapter 4

### 4.1 Machine

Laptop used for the model runs: Intel Core i7-13700H, 32 GB memory, Windows 11, an RTX 4060 (8 GB) that the model container did **not** use. The model ran on the processor only (Ollama 0.40.6 in Docker with 20 threads and 16 GB given to Docker). Production server (stated in `docs/value-test.md`): GTX 1050 with 16 GB, also running the 4B model on the processor; the laptop's processor is faster, so laptop times are a best case. Chat model `qwen3.5:4b` (3.3 GB), search model `bge-m3`, `think: false`, context 16,384.

### 4.2 Local-model answer times (PR #207 run, 19 Nov 2026)

Source: `docs/assistant-eval-results.md`. Measured by the evaluation script on the AI service's answer call (the card's prompt and answer check), 20 questions out of 118 (a sample chosen as every weak case of the earlier run plus a spread), one run.

| Measure | Result |
|---|---|
| Median time for one answer | 117 s |
| Fastest / slowest | 12 s / 350 s (the 350 s one was a follow-up across clients that the script could not score) |
| Largest prompt | 2,738 tokens (none above 4,096) |
| Prompt reading speed seen | about 30 tokens a second |
| Scenario 13 (copy B, same model, through the assistant card, one person at a time) | 24 s (warm) to 132 s per answer; the first call after start took 2.0 min while the model loaded |
| Median search time (embedding the question and both searches) | 0.74 s |

Before the #208 fix, 4 of the first 9 answers failed after exactly 120 s with no output on this processor.

### 4.3 Retrieval (118 questions, no model; 89 have marked passages)

| Run | Right passage sent (hit rate) | Recall | Right passage first | Arabic / English | Other-project passages | Leak words in what was sent |
|---|---|---|---|---|---|---|
| #207, first run | 81 of 89 (91%) | 0.89 | 59 of 89 (66%) | 40 of 43 (93%) / 41 of 46 (89%) | 0 in 118 | 0 (8 questions with a leak list) |
| #209, first run, before the Arabic fold | 79 of 89 (89%) | 0.871 | 57 of 89 (64%) | 39 of 43 / 40 of 46 | 0 | 0 |
| #209, first run, after | 80 of 89 (90%) | 0.882 | 59 of 89 (66%) | 40 of 43 / 40 of 46 | 0 | 0 |
| #209, second run (after review fixes), before | 81 of 89 (91%) | 0.893 | 59 of 89 (66%) | 40 of 43 / 41 of 46 | 0 | 0 |
| #209, second run, after | 81 of 89 (91%) | 0.893 | 60 of 89 (67%) | 40 of 43 / 41 of 46 | 0 | 0 |

Search time per question: 0.68 to 0.75 s median in the #209 runs. The fold's cost to index: 2.5 ms a passage (about 4 minutes per 100,000 passages, 20,000 passages of 1,656 characters measured on the same laptop; allow 2 to 3 times that on a slower server). The eight misses are long files crowding each other, one Arabic question against an English file, and follow-ups; the report's own words: the fold "is not a big gain" on this set.

### 4.4 Answer quality, citation support (#207 run, 20 answers, builder's own review)

| Measure | Result |
|---|---|
| Right / partly right / wrong (19 scored; 1 not finished) | 10 / 3 / 6 |
| Automatic check (answer where there is one, "can't confirm" where there is none) | 14 of 20 |
| Grounded answers that cite a marked passage | 13 of 13 |
| Share of citations that hold a marked passage | 0.87 |
| Faithful (no claim beyond the cited passages) | 16 of 19 |
| Answer in the question's language | 19 of 20 |
| Invented answer found | N28 (a scanned page): a confident, cited, invented answer |

Single reviewer (the builder); a second reviewer's sheet was prepared but not filled.

### 4.5 Number scanner (#213)

No timing run is recorded in the sources. What the sources do state: every step is linear in the text length; the tests assert that 10,000 spaces after a word, or 100,000 characters in one run, take under 50 ms (`tests/sensitive-numbers.test.ts`; described in `docs/assistant.md`); on the 164 test-set files (91 number-like runs: dates, amounts, years, figures) it tagged nothing. A review found and fixed one catastrophic-backtracking pattern (passports). Re-index after migration 0114: "about 3.5 hours per 10,000 files on the server's processor" is a reviewer's estimate, not a measurement (`docs/operations.md`). Measured timings of the scanner alone: not measured.

### 4.6 Leak probes and isolation

| What | Result | Source |
|---|---|---|
| Retrieval over 118 questions (#207) | 0 passages from a project the asker may not use; 0 leak words | `assistant-eval-results.md` |
| Phase 3 re-run with a stand-in local model (`qwen2.5:7b-instruct`, 19 Nov, not the shipped model) | Staff set 55 questions: 14 of 14 access probes as expected; client set 54 questions: 31 of 31 probes as expected; no canary or other client's word in any answer or in anything sent to the model; "0 leaks in 164 questions over three runs, 59 of 59 probes" | `phase3-assistant-redaction.md` |
| Earlier hosted-model runs (22 to 25 Oct, GPT-OSS-120B on Ollama's cloud, local embeddings) | Staff: every access probe refused, no other project's passage; client: all 30 probes as expected, no canary in any answer or request | `docs/assistant.md` |
| Scenario 13 (local model, 15 answers on both sides) | In 15 of 15 answers no citation named another client or a firm-only file for a client asker; owners and the Rawdah admin get "Not found" on `/assistant` | `13-assistant.md` |
| Scenarios 1 to 21 | "PRIVACY findings: none" in every file that states it; lead log: no privacy finding on any of copies A to D | scenario files, lead log |
| Isolation sweep (scenario 19) | Not finished | section 2 |
| Classification assessor | 10 proofs of leaks written as tests run as the wrong user; all passed (each pass meaning the problem was real); fixed in #193 | `phase3-classification.md` |

### 4.7 Permission-denial tests

Counts of denial tests as such are not stated in the sources. What is stated: the database suite passed 1,316 tests after the leak fixes (89 files) and 1,366 of 1,367 after the report flow; each privacy fix came with a test that failed before the fix (lead log, batch 0 and #193); the picker brought a never-widen property test over `authorize()` and its database twin (decision file). Number of tests that are specifically denials: not measured.

### 4.8 Page response times

Not measured against a production build. Every scenario file states its page times came from the development server (`next dev`) and "say nothing about production". Figures they do give, for the record: scenario 17, home page after sign-in 2.5 s, 2.6 s and 2.6 s for three accounts (dev server, after warm-up), "under 10 s" for each person to find what needs them; a first save in a dialog 8 to 15 s because the page compiles on first use; one step took 175 s (scenario 1). The lead log also records a "measure page and AI response times before and after each feature" rule for later work; no such figures exist yet.

### 4.9 End-to-end suite (production-like Docker stack, 19–20 Nov)

Source: `docs/review/work/e2e-stack-run.md`.

| Run | Result | Duration |
|---|---|---|
| Suite as found | 56 passed, 5 failed, 10 not run | 27.6 min |
| Final, all four image updates, fresh database | 67 passed, 1 failed, 3 not run (the failure and the 3 not run are the assistant file, which was written for a hosted model); crawl of 7 roles x (Arabic light, English dark) with axe: 14 of 14 pass | 35.3 min (8.4 min of it sign-in setup) |
| Fixes | Test drift only (6 files, 31 lines, #210); no app bug found | |
| Image checks | gotenberg 15 of 15 PDF tests; rustfs (upgraded over old data) 18 of 18 file tests; caddy config validates in both modes and proxies the same; cloudflared only started, no tunnel | |

### 4.10 Other numbers

- Pull requests merged in the run: #150 to #235 as listed in section 1 (the PR list shows the dates, 16 to 22 Nov 2026 for review work; #189 to #213 on 19 Nov); migrations end at 0115.
- Page audit: 778 Arabic screens and the same in English across 14 accounts (first pass); final capture 4,753 screens, 14 accounts, 0 failures.
- Selah map: 37 nodes, 70 links, 123 shared files.
- Org chart import in scenario 20 (copy A): a pasted job list to a draft took 135 s on the processor-only model (10 positions); a first attempt failed in 17 s because that copy's model service had no models.

---

## 5. Not done

| Item | Why | Next step |
|---|---|---|
| Open Dependabot #226 (rustfs 1.0.4 to 1.0.6), #229 (cloudflared 2026.10.4 to 2026.11.0), #232 (caddy 2.11.7 to 2.11.9) | Image updates; CI is green but CI does not run the Docker images. The earlier cloudflared update was only started, never run with a tunnel | Run the full-stack check (as in `e2e-stack-run.md`); test the tunnel live with a real token |
| #227 (node 22 to 26 image), #228 (gotenberg 8.39 to 9.6), #237 (vitest 5), #238 (@types/node 26), #239 (undici 8) | Checks failing on each: #227 and #228 the database check; #237 web, database and scan checks; #238 and #239 the web check. For vitest 5 the earlier triage found it needs `vite` added as a dev dependency; for @types/node 26 the earlier triage found the runtime is Node 22 and typecheck failed in the clamd files. Causes for #227, #228 and #239 are not in the sources | Fix or close each; ignore rules for major bumps were suggested in the triage |
| #236 (eslint 10) | Deferred by the owner: CI passes only because `legacy-peer-deps` hides that the Next lint plugins do not declare eslint 10 support | Revisit when the plugins support it |
| #240 (web minor-and-patch group, 5 updates) | Opened 22 Nov, CI green; not discussed in any source | Review and merge or close |
| Assistant value test | The owner runs it alone on his laptop, each of six tasks with and without the assistant; run record empty | Owner runs it with `docs/value-test.md`; report as a single-tester trial |
| Staging end-to-end | No staging server exists; the suite ran on the production-like local stack | Run on a staging server when there is one |
| Scenario 19 isolation sweep | Interrupted by a crash, then a pause | Bring up the four copies without `--fresh` and run the sweep on `urls-A.json`, `urls-b.json`, `urls-C.json`, `urls-D.json` |
| Scenario report (section 9.4) and independent re-run of every failed step | Not started. Failed steps: 1/13, 5/4, 9/4, 15 English/3d, 18 English/0c, 20/10 to 12 (fixed in #215, not re-run), 13/5 (numbers) | Do after the sweep |
| Gate C | Not reached; waits on the sweep and the report | Owner decision |
| After-scenarios list | Not started (waits on Gate C): OCR for scanned pages; save an assistant answer as a note; staff "what changed since my last visit" and meeting drafts; concern flags (facts, no score); export language following the screen; leftovers from the screen batches (date-request words, two words for "inquiry", tab stops added by tooltips); assessment guidance written for the consultant shown to the client; findings from the labelled test set (versions split by language, follow-ups across clients, long files crowding, scanned page invents an answer, "due this week" mislabelled); an answer that only echoes the question shown as grounded; org chart draft from pasted text giving 0 units (seen in scenario 20); owner change telling only the new owner (scenario 9); plan import before the people are added (scenario 1); plus the failures and confusions in the scenario files | Plan after Gate C |
| Findings from the scenarios not yet fixed | Declining a date request carries no reason; the client is not told when her consultant changes (found in scenarios 7 and 6); progress draft numbers differ from the project page; an unreadable attached file is answered as if it were another file; legal refusal without a pointer; sharing a report sends no client notice; PDF header date uses UTC; "release now" switch defaults ON and caused saved drafts (scenario 18, twice); "Not found" page returns HTTP 200; dialogs ignore clicks before they finish loading; names missing on logo link, radios and checkboxes (accessibility); dark-mode contrast of switches and check boxes | Add to the after-scenarios list |
| R7 accessibility checks | Marked partly done on the checklist (keyboard tooltips and focus, #190); R6 "AI operations and consent" is ticked with #191, #192, #208, #211, #213 in the same PR as this file | Do before real client data; scenario 18 findings above feed it |
| Reranker | Not built: the owner's rule was "only if the test set shows it helps"; the 9 misses are cross-language versions, a scanned page, a cross-client follow-up and long files crowding, none a ranking problem | Re-check when the test set grows |
| Map: Arabic labels | Arabic node text needs a native review | A native Arabic reader reviews `docs/selah-map.html` |
| "Built, not proven" (production path, `docs/team/`) | A sending domain on the firm's side with SPF, DKIM and DMARC; a second backup disk, a key kept off the server and one restore drill written down; legal texts not reviewed by a lawyer (hosting location, retention and duties not confirmed); no outside penetration test | Go-live checklist items 6 to 10 stay "Open" in `docs/team/src/03-selah-production-path.md` |
| Pre-go-live items | Run the audit-row clean-up script (#205) once on the live database; size the 0109 end reminders; test the tunnel live; plan the 0112 search rewrite (exclusive lock) and the 0114 re-index; run 0115 with the app stopped; direct way in instead of the tunnel; real client files only to a local model | Operator checklist in `docs/operations.md` (Before go-live) |
| Rotating the hosted-model key (owner) | A helper's search printed lines of an environment file that holds a hosted-model key (not used; logs only). The owner was advised to rotate it and was rotating it | Owner rotates; confirm done |
| Clean-up of scenario copies, worktrees and test buckets | Later | `SELAH_INSTANCE=<name> npm run reset:local`, remove volumes, remove the three evaluation buckets on the lead's storage |
| Other open notes | A department-limited manager's Meetings tab reads "none for you yet" although she is invited; a Tab pressed within about 100 ms of choosing from a list can still be lost (end-to-end test planned); organisation names like «أمل» over-mask (safe direction); text already containing "[ORG_1]" is unmasked into a name the reader can already see; old append-only audit and activity rows are not rewritten (script not run) | Gate B or later questions |

---

## 6. Limitations and honest caveats

- **Synthetic data only.** Fictional firm and clients; no real client file was ever used, and the real-client rule (local model only) is written down but not exercised.
- **One laptop.** Everything ran on one Windows laptop; the production server is a smaller machine (GTX 1050, 16 GB). Disk was at 98 percent full at one point; builders were cut from three to two at a time until about 65 GB was freed, then back to three.
- **Processor-only model timing.** The 117 s median is the 4B model on this laptop's processor with the graphics card unused; the real server will differ.
- **Scenario runs were done by AI helpers on development servers**, not by consultants or clients. Page times are dev-server times and are not production figures. Helpers used database shortcuts in a few steps (named in the files). Several scenarios were run on a different client than the plan (2 and 12 English on Al-Nukhba; 2 with Khalid in Turki's place), and some had to be re-ordered because earlier scenarios changed shared records.
- **Scenario evidence is partly outside the repository.** Screenshots are local only at `C:\Projects\selah-scenario-shots\<nn>\`.
- **Isolation sweep unfinished.** "No privacy finding" rests on the checks inside the scenarios and the tests, not on the full sweep.
- **Numbers from a single test set.** 164 synthetic files, 100 questions plus 18 reference-library questions; full answers for 20 only; one reviewer; one run per setting (two for the Arabic fold); the set's Arabic is written consistently and under-tests the fold; the set's long files are partly artificial, which overstates crowding.
- **Stand-in model for one set of probes.** The 19 Nov leak and access re-run used `qwen2.5:7b-instruct`, not `qwen3.5:4b`. Earlier October runs used a hosted model.
- **Assistant quality is not settled.** Drafts need a rewrite (scenario 13); a scanned page produced an invented answer; the 4B model mislabels "due this week"; follow-ups across clients fail.
- **The value test has not happened**, so there is no time-saving figure.
- **End-to-end ran locally, not on staging**, and two assistant tests were written for a hosted model.
- **Dependabot:** several updates are open and unverified (section 5).
- **Production readiness is not claimed:** no outside penetration test, no lawyer review, no sending domain, no second backup disk.
- **Working rules.** Helpers ran on different models by task (Opus for privacy, permissions, database, AI and reviews; Sonnet for UI, wording, docs; Haiku for tests and screenshots); the lead checked every non-Opus result. A usage limit stopped helpers several times; each resumed from saved work. Independent review was applied only to privacy, permission, AI and database changes.
- **Lead mistakes recorded:** the test database of one copy was reset while helpers used it (18 Nov); one test database was given to two builders twice (19 Nov); a message string was reworded without re-running the database tests (#156).

---

## 7. How to run it

From the repository folder, with Docker Desktop running and Node.js 22.12 or newer.

| Task | Command |
|---|---|
| Start the walkthrough (first time or to reset data) | `npm run walkthrough -- --fresh` |
| Start it again, keeping the team's changes | `npm run walkthrough` |
| With the virus scanner and the local model | `npm run dev:local -- --full` (the scenario copies used `--full`) |
| Without the assistant | `npm run walkthrough -- --no-ai` |
| Skip the page warm-up | `npm run walkthrough -- --no-warm` |
| A second copy beside the first | set `SELAH_INSTANCE=<short name>` (letters and digits), then run the same commands; `SELAH_PORT_OFFSET` in tens changes the distance (default 10); keep the variable set for every command in that copy |
| Stop the containers (data kept) | `npm run stop:local` |
| Stop and delete the local sample data | `npm run reset:local` |
| All tests | `npm run test:all`; without the end-to-end suite: `npm run test:all -- --quick` (in a named copy the end-to-end suite is skipped anyway) |
| Database tests with a longer limit | in `apps/web`: `vitest --config vitest.db.config.ts --hookTimeout 120000 --testTimeout 120000` |
| Rebuild the Selah map | `npm run map` (also checks every path in it exists) |
| Audit-row clean-up (not run yet) | `docker compose run --rm --no-deps jobs npm run pre-go-live:clean-private-names`, then add `-- --apply` to apply |
| Assistant evaluation (staff and client runs) | in `apps/web`: `npm run db:seed`, `npx tsx scripts/assistant-eval/seed.ts`, `npm run job:index-documents`, then `run.ts`; the client run adds `client-seed.ts` and `client-run.ts` (exact lines and variables in `docs/assistant.md`, "Evaluating with a real model") |
| Labelled test set | `testset-seed.ts` (needs `EVAL_DB_OK` set to a disposable database name), the index job, then `testset-run.ts` with `MODE=retrieval` or `MODE=full` (the full run refuses unless the model is local); results in `docs/assistant-eval-results.md` |

**Warning on `--fresh`:** it deletes that copy's local database and stored files and loads the walkthrough again (downloaded models are kept). Without `SELAH_INSTANCE` it acts on the first copy. Never run it while helpers use the same database server: it deleted helpers' test databases once. Dates are relative to the day the data is loaded, so run `--fresh` on the day of a demo or test. The app runs in development mode; each page compiles the first time it is opened.

**Accounts** (all use the published test password `123456789@Pass`; localhost only; set `WALKTHROUGH_PASSWORD` before a `--fresh` load to change it).

| Email | Person | Role |
|---|---|---|
| admin@mizan.test | Sara Al-Otaibi | Firm admin |
| lead@mizan.test | Khalid Al-Shamri | Lead consultant, Al-Nukhba |
| deputy@mizan.test | Noura Al-Qahtani | Deputy lead, Al-Nukhba; leads the firm-run subsidiary |
| consultant@mizan.test | Omar Al-Zahrani | Consultant on the board project |
| observer@mizan.test | Layla Al-Harbi | Observer on the board project |
| lead2@mizan.test | Majed Al-Subaie | Lead of Rawdah and Al-Waha |
| admin@nukhba.test | Fahd Al-Dosari | Client admin, Al-Nukhba |
| sponsor@nukhba.test | Mansour Al-Anzi | Client manager and sponsor, Al-Nukhba |
| manager@nukhba.test | Reem Al-Harbi | Client manager and coordinator, Al-Nukhba |
| owner@nukhba.test | Abdullah Al-Mutairi | Action owner (legal), Al-Nukhba |
| finance@nukhba.test | Salma Al-Shehri | Action owner (finance), Al-Nukhba |
| admin@rawdah.test | Hind Al-Zahrani | Client admin and sponsor, Rawdah |
| manager@rawdah.test | Yousef Al-Ghamdi | Client manager, Rawdah |
| owner@rawdah.test | Dana Al-Omari | Action owner, Rawdah (never signed in) |

The firm is the fictional Mizan Advisory; the clients are Al-Nukhba Holding, Rawdah Foundation, and two with no accounts (Al-Waha Family Office, Al-Nukhba Real Estate Development). The scenarios created extra accounts on their own copies (for example turki@mizan.test, reema@mizan.test, and Sahm's people at sahm.test); they are not in the walkthrough seed.

**Ports.** First copy: app 3000, mail 8025, database 5432, storage 9000, virus scanner 3310, local model 11434, AI service 8000, SMTP 1025, PDF renderer 3001. A named copy adds its offset to every port (default 10, so 3010 and 8035).

| Copy | Name | Offset | App | Mail |
|---|---|---|---|---|
| Default | none | 0 | 3000 | 8025 |
| Scenario copy A | `scena` | 40 | 3040 | 8065 |
| Scenario copy B | `scenb` | 50 | 3050 | 8075 |
| Scenario copy C | `scenc` | 60 | 3060 | 8085 |
| Scenario copy D | `scend` | 70 | 3070 | 8095 |

The scenario copies' data volumes were kept; Docker and the local model app were shut down at the pause.
