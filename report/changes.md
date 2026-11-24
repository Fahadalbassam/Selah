# Changes to the CS 511 final report (Nov24 version)

**Compared with:** the team's file "CS 511 Project Final Report Template (draft) Nov24(2).docx". The original is kept beside it as "... Nov24(2) - before Chapter 4.docx".

**The updated file** is the same file name in Downloads. It has no Word comments. The table of contents, the list of tables and the list of figures were updated in Word, with page numbers and links. The report is 96 pages.

## Summary

| Chapter | What changed |
|---|---|
| 1 | One word: "Eish provides" corrected to "Selah provides" (1.5). Nothing else. |
| 2 | Nothing. |
| 3 | The screens table (3.15) and the functions table (3.16) were replaced with the fuller versions. The opening paragraph of 3.3.3 was replaced, and the 3.3 headings now number themselves. |
| 4 | Written in full: methodology, system design and interface design, keeping the team's Agile text. The two feature-by-role tables are not included. |
| 5, 6 | Text unchanged. The two chapter titles now use the same automatic numbering as Chapters 1 to 4, and they look the same. |

## Chapter 1: Introduction

| Where | Old | New | Why |
|---|---|---|---|
| 1.5 Justification | Eish provides a shared workspace | Selah provides a shared workspace | Wrong product name. |

## Chapter 2: Background and Review of Literature

No changes.

## Chapter 3: SPMP & Requirement Specification

| Where | Old | New | Why |
|---|---|---|---|
| Table 3.15 | "User interface": 8 screens (Login, Maayish dashboard, User management, Client workspace, Recommendation page, Documents and assistant, Meetings and reminders, Progress reports) | "User interface screens": 19 screens. Adds the firm and client homes, People, the Plan and action page, Clients and inquiries, Projects, the Actions list, Files, Indicators, Governance assessment, Organization structure, Deliverables, Notifications, Help and the Audit log | The design has more screens than the old table listed, and Chapter 4 refers to them. |
| Table 3.16 | "Main system functions": 13 rows with no numbers. Status words "Awaiting consultant review, Changes requested, Approved". Client managers could edit goals and plans | 22 numbered functions, FR-01 to FR-22. The status words match Chapter 4 (Not started, In progress, Waiting, Needs attention, Verified, Closed), and the firm writes the plan | Chapter 4 points to the FR numbers. The old table contradicted the design in Chapter 4 (who edits the plan, the status words). |
| 3.3.3, first paragraph | "Assigned consultants and client managers can create recommendations, assign actions, change deadlines, and edit goals or plans ... Client managers must discuss changes with the consultant first." | "In the design, assigned consultants will create findings, recommendations and actions, name owners, set and change deadlines, and release actions within their projects. Client users will not edit the plan ..." and it points to Table 3.16 | The old sentence let client managers edit the plan. Everywhere else, the firm writes the plan and the client answers it. |
| 3.3 and 3.3.1 to 3.3.4 headings | Typed numbers ("3.3.1 External interface requirements") with Word numbering switched off | The same headings with Word's automatic numbering, like the rest of Chapter 3; "non-functional" now has a capital N | One numbering system for every heading, so the numbers stay right if a section is added. |

The rest of Chapter 3 is unchanged, including 3.3.1, 3.3.2, 3.3.4 and the "Assessment and AI monitoring" paragraph. The notes below list three sentences there that no longer match Chapter 4.

## Chapter 4: Methodology & Design

The chapter in the Nov24 file had the template's instruction text, the team's Agile method (4.1 with five activities), and empty 4.2 and 4.3. It now holds the full chapter:

| Section | Content |
|---|---|
| 4.1 Proposed Methodology | Opens with the team's Agile text (why Agile was chosen). Then how the team arrived at the features: 4.1.1 Understanding the Firm's Work, 4.1.2 Finding the Problem, 4.1.3 Walking Through an Engagement from Both Sides, 4.1.4 From Role Needs to Features, 4.1.5 Checking Each Feature Against the Problem and Confidentiality, 4.1.6 Decision Points and Planned Scenario Walkthroughs (Table 4.1). New 4.1.7 Development Process holds the team's five Agile activities as 4.1.7.1 to 4.1.7.5, with the team's wording. Figure 4.1. |
| 4.2 System Design | 4.2.1 Architecture (Figure 4.2), 4.2.2 Users and Roles (Table 4.2), 4.2.3 Permission Model and Tenant Isolation (Figure 4.3), 4.2.4 Data Model (Figure 4.4), 4.2.5 Core Workflow and Action States (Table 4.3, Figures 4.5 and 4.6), 4.2.6 Use Cases (Figures 4.7 and 4.8), 4.2.7 Assistant Design (Figure 4.9, including the rules the assistant follows and the planned reference library), 4.2.8 Design Status (Figure 4.10, Table 4.4 Planned features), 4.2.9 Deployment Design. |
| 4.3 Interface Design | 4.3.1 Design Principles, 4.3.2 Arabic Screens (Figures 4.11 to 4.16), 4.3.3 English, Dark Mode and Tablet Width (Figures 4.17 and 4.18), 4.3.4 Help and Accessibility. |

What differs from the earlier Chapter 4 draft:

| Change | Why |
|---|---|
| The two feature-by-role tables (old Tables 4.4 and 4.5) are removed. The paragraph that introduced them is replaced by one sentence with the three rules that run through the design. | Asked by the team: they were long and distracting. Table 4.2 and the use-case diagrams still show each role. |
| "Planned features and why each is needed" is now Table 4.4, and the text and Table 4.1 point to it. | Numbering after the removal. |
| The template's instruction paragraphs ("Suggested content is ...", "[The students should add ...]") are removed. | They are template notes, not report text. |
| Headings use Word's automatic numbering; captions use the same "Table 4.x" and "Figure 4.x" fields as Chapters 2 and 3; tables have the same dark header row as the team's tables. | One look and one numbering system across the report. |
| References to the Chapter 3 tables now say Table 3.15 and Table 3.16. | Chapter 3 numbering in this file. |

## Chapters 5 and 6

Text unchanged. The titles "Chapter 5: Implementation and Testing" and "Chapter 6: Conclusion" now come from the automatic chapter numbering, as in Chapters 1 to 4, and look the same on the page.

## Front matter

The table of contents now lists every Chapter 4 heading. The list of tables has 21 entries (2.1, 3.1 to 3.16, 4.1 to 4.4) and the list of figures 19 (3.1, 4.1 to 4.18). Word filled in both lists, with page numbers.

## Notes from the run-through (not changed; for the team to decide)

Ordered by importance.

1. **3.3.1, 3.3.2 and 3.3.4 still say some things are "to be agreed" that Chapter 4 and Table 3.16 now decide.** 3.3.2 says "the full interface language or languages still need to be agreed", while Chapter 4 makes Arabic the default with English available. 3.3.1 says "the AI model will be chosen during design" and that file limits "still need to be agreed", while Chapter 4 names a local model and FR-08 sets 20 MB. Either reword these as decided in the design (pointing to Chapter 4), or keep them open and soften Chapter 4. As it stands, a reader sees two answers.
2. **1.9 Project Organization still says "Chapter 3 explains the development methodology and the system, and interface design"** and skips Chapter 4. Chapter 3 is the project plan and the requirements; Chapter 4 is the methodology and design.
3. **Figure 4.10 counts 47 features (13 Set, 25 To refine, 9 To plan)**, but with the feature-by-role tables removed, the report no longer lists those 47 features. Either keep the figure as a summary and say so in one sentence, or remove it. Table 4.4 still lists the planned features.
4. **The "Assessment and AI monitoring" paragraph after Table 3.16** says AI monitoring "flags possible delays or reported obstacles". Chapter 4 says late, stuck and blocked work is found by rules and that AI highlighting of concerns is for a later phase. Align the two, for example "AI monitoring summarizes permitted updates; possible delays and obstacles are flagged from the records, and AI highlighting is planned for a later phase."
5. **4.1 now has two parts that should be linked in one sentence.** The Agile text describes how the system will be developed; the next paragraph describes how the features were worked out. Suggested link at the start of the second paragraph: "Before development, the team used a requirements-first design method ..."
6. **2.3.4 has an informal tone in places** ("the whole mess", "Turns out"). Reword in the same style as the rest of Chapter 2.
7. **2.4 refers to "the software comparison"**, but the chapter has no separate comparison. See the earlier proposal: say the comparison is of the systems described in the reviewed papers, each covering part of the work.
8. **Title page date** says October 2026. Update it to the submission month.
9. **A blank page before Chapter 6.** It was already in the Nov24 file. Remove it before submitting.
10. **The non-functional requirements in 3.3.4 have no numbers.** Number them (for example NFR-01 Security and privacy to NFR-07 Maintenance) so Chapter 5 can trace tests to them, as the functions are traced through FR-01 to FR-22.
11. **Chapters 5 and 6** are still the template's instruction text, as planned for next semester.

## What Chapter 5 should cover next semester

### Where the material stands today

The project already holds test suites, a labelled question set, 34 written scenarios and first measurements. They are a rehearsal, not yet results for the report. Three rules for using them:

- Report only numbers from runs the team made on the frozen version, on a named machine, on a stated date.
- Each scenario result in the report comes from a run by a named team member, by hand, on the production build.
- A number that was not measured is written as "not measured". It is never estimated.

| Material | What it gives Chapter 5 | First figures on record | Still to do |
|---|---|---|---|
| Unit tests | Rules in code, parsers, screen words | 1,188 tests; 1 fails because it reads a setting of the machine | Fix that test; record run time |
| Database tests | The database refuses what the wrong user asks | 1,492 passed | Record run time at today's size |
| Upload scanning tests | Infected files are refused | 6 passed | None |
| AI service tests | Answer check, citations | 181 passed | None |
| End-to-end tests | Whole flows in a browser | 67 passed, 1 failed, 3 not run (assistant tests written for another model) | Adapt the assistant tests; run on a staging server |
| Labelled question set | Retrieval and answer quality | Right passage sent for 81 of 89 questions; 0 passages from another project in 118 questions; 20 full answers reviewed by one person | Larger answer sample; two reviewers; run on the server |
| Scenarios 1 to 34 | Real tasks, step by step, per role | Failed steps noted in 7 scenarios | Scenario 19 (isolation sweep) not finished; failed steps not re-run |
| Denial tests | A wrong user is refused | About 460, estimated from test titles | An exact count |
| Page response times | Speed | Development-server figures only | Measure on a production build on the server |
| Assistant answer time | Speed | Median 117 s on a laptop processor | Measure on the real server |
| Value test | Time with and without the assistant | Not run | Run it, with more than one tester |
| Gap list (70 items) | Defects found and fixed | 14 high, 29 medium, 27 low | Fix the privacy items first, G05 before all |

### Section 5.1: methods, algorithms, tools and techniques

**What to include.**

- Methods: layered web application; one permission check in the application repeated by row-level security in the database; the action state machine enforced by a database trigger; an append-only audit log with a hash chain; background jobs.
- Algorithms: retrieval by meaning and by keyword with an Arabic spelling fold, and how the two lists are merged; cutting files into passages; the rule-based scanner that replaces sensitive numbers; the citation check that drops unsupported citations.
- Tools: the web framework, the database and its vector extension, the file store, the virus scanner, the PDF service, the model server, the two models, the container setup, the test tools.
- Techniques: a test as the wrong user for every rule; sample data; Arabic-first interface with right-to-left layout.

**Trade-offs to discuss** (each with the alternative and what was given up).

| Decision | Alternatives | What to weigh |
|---|---|---|
| Isolation in one database with row-level security | Application checks only; a database per client | Safety if one check is missed; operating effort |
| Local model | Hosted model | Confidentiality against speed and answer quality |
| Answer model size | The chosen 4B model against one or two larger local models | Quality on the same questions against time per answer on the server |
| Search model | bge-m3 against a multilingual E5 model | Chapter 2 cites two studies in which E5 gave the best Arabic retrieval, so this choice needs a measured reason |
| Search method | Keyword only; meaning only; both | Hit rate on the labelled set, by language |
| Passage vector store inside the main database | A separate vector database | One permission filter for records and passages |

**Selection-criteria table** (the template requires it). Rows are the candidates; columns are the criteria; cells are measured values or a stated fact, not ticks.

| Criterion | Why it matters for Selah |
|---|---|
| Data stays on the firm's server | Client confidentiality |
| Arabic and mixed Arabic-English support | Arabic-first product |
| Enforces isolation below the application | One missed check must not leak |
| Runs on the available server | No budget for new hardware |
| Licence and cost | Student project; later use by the firm |
| Measured quality on the labelled set | Evidence, not preference |
| Team's skill and learning time | Six students, one semester |

**Feeds from.** `docs/data-architecture.md`, `docs/authorization.md`, `docs/security.md`, `docs/assistant.md`, `docs/system-map.md`, `docs/operations.md`, `docs/assistant-eval-results.md` (the Arabic fold before and after; the note on running the same questions on other models).

**Still to do before writing.** Run the model and search-model comparisons on the same labelled questions. Run the three search methods (keyword, meaning, both) on the full set. Record every tool's version at the frozen commit.

### Section 5.2: results achieved and benchmarking

| Area | What to measure | How | Baseline or comparison | Feeds from |
|---|---|---|---|---|
| Functions | Scenario pass rate: steps passed, passed with friction, failed, by scenario and by side | Team members run scenarios 1 to 34 by hand on the production build, Arabic and English | The requirement list FR-01 to FR-22: share with a passing scenario | `docs/review/scenarios/` (01 to 34), `docs/team/gaps-and-priorities.md` section 1 |
| Isolation | Number of record addresses opened as each account that must be refused; number that returned data | The isolation sweep (scenario 19) on every data copy, run by someone other than the author of the feature | Target 0 | `docs/review/scenarios/urls-A.json`, `urls-b.json`, `urls-C.json`, `urls-D.json`; `docs/review/final-status.md` section 4.6 |
| Denial tests | Exact count of tests that assert a refusal, by area; all pass | Tag or list them; run the unit and database suites | The estimate of about 460 is replaced by the count | `docs/team/testing-guide.md` sections 3 and 4; `apps/web/tests/`, `apps/web/tests/db/` |
| Cross-client probes | Requests for another client's data through the interface layer | The end-to-end probe file | Target: all refused | `apps/web/e2e/api-probes.e2e.ts` |
| Retrieval | Hit rate (right passage among those sent), recall, right passage first; split by Arabic and English and by question group | Labelled set, retrieval mode, all questions | Keyword only against meaning only against both; before and after the Arabic fold | `apps/web/scripts/assistant-eval/testset/`, `docs/assistant-eval-results.md` |
| Leak probes | Passages from a project the asker may not use; leak words in what is sent and in answers | Labelled set and the access-probe scripts, on the shipped model | Target 0 | `docs/assistant-eval-results.md`; `docs/review/final-status.md` section 4.6 |
| Answer support | Correct, partly correct, wrong; faithful (no claim beyond the cited passages); "cannot confirm" given when the answer is absent; answer in the question's language | Full-answer mode on a larger sample that covers every question group; two reviewers score separately, then report agreement | The measures of the citation and faithfulness studies in 2.3.8; the chosen model against one other model | `docs/assistant-eval-results.md` (the review sheet) |
| Assistant speed | Median, fastest and slowest time per answer; search time | Same run, on the real server | The NFR target; the laptop figure for context | `docs/review/final-status.md` sections 4.1 and 4.2 |
| Page response | Median and 9-in-10 time for the main pages of each role (home, actions list, action page, project page, files) | Production build on the real server, warm, repeated runs, one user and then several at once | The NFR-05 target | `docs/review/final-status.md` section 4.8 (states what is missing) |
| Value of the assistant | Time and correctness for six tasks with and without the assistant | The value test, with several testers who did not build the assistant | The same task without the assistant | `docs/value-test.md`, `docs/value-test-score-sheet.csv` |
| Ease of use | Task completion and a standard usability questionnaire | A short session per role, with consultants of the firm if it agrees | The questionnaire's published average | Scenario files as task scripts |
| Accessibility | Automatic accessibility checks per role, language and theme | The end-to-end crawl | Target: no violation at the chosen level | `apps/web/e2e/` (crawl), `docs/review/final-status.md` section 4.9 |
| Reliability | Core workflow with the assistant switched off; time to restore from a backup | One drill each, written down | Reliable operation (3.3.4) | `docs/operations.md` |

**On benchmarking.** No published system does the same job on the same data, so most comparisons are internal: one method against another on the same questions, and measured values against the targets set in Chapter 3. Figures from Chapter 2 (for example Arabic retrieval recall in other studies) can be quoted for context only, with a sentence that says the data differs.

### Section 5.3: test plan

Follow the IEEE test documentation structure, as the template suggests.

| Part | Content |
|---|---|
| Scope | What is tested (FR-01 to FR-22 and each non-functional requirement in 3.3.4) and what is not (features marked for a later phase; an outside security test) |
| Levels | Unit; database rules; upload scanning; AI service; end-to-end; scenarios (system test); acceptance session with the firm; non-functional (speed, accessibility, isolation) |
| Approach per level | What each level protects and why it exists |
| Environment | Server and laptop specifications, versions, the frozen commit, sample data and its fictional firm and clients, test accounts by role |
| Entry and exit criteria | For example: exit when no high-severity defect is open and the isolation sweep returns 0 |
| Pass and fail rule | Per test case and per scenario step (pass, pass with friction, fail) |
| Roles and schedule | Who runs what, in which week; the author of a feature does not run its isolation check |
| Test cases | A table of 25 to 40 representative cases in the chapter; the rest in an appendix |
| Traceability | Requirement to test to scenario |

Test case table columns: ID, requirement, role, precondition, steps, expected result, actual result, status. Include refusal cases, not only success cases: at least one "wrong user" case for each of FR-01 to FR-09 and FR-12.

**Feeds from.** `docs/team/testing-guide.md` (sections 1, 2 and 5), `apps/web/e2e/README.md`, `.github/workflows/ci.yml`, `docs/review/scenarios/` (each file is already a step table), `docs/walkthrough.md` (accounts and sample data).

**Still to do.** The requirements map in the testing guide uses labels from the old draft (PF1 to PF9, PP1 to PP8). Redo it against FR-01 to FR-22 and the NFRs.

### Test report

| Part | Content | Feeds from |
|---|---|---|
| Summary by suite | Tests run, passed, failed, skipped, run time, date, commit | `docs/review/final-status.md` section 3 (as the format), new runs for the numbers |
| Test case results | The table from 5.3 with "actual result" and "status" filled in | New runs |
| Scenario results | One row per scenario: steps, passed, friction, failed, language, who ran it, date | `docs/review/scenarios/`, `docs/team/gaps-and-priorities.md` section 2 |
| Isolation results | Addresses checked, accounts, refusals, any finding | The sweep |
| Defects | Count by class and seriousness; found, fixed, open; two or three written up in full (what was found, how, the fix, the test that now guards it) | `docs/team/gaps-and-priorities.md` sections 3 and 4, `docs/testing/bug-tracker.md` |
| Known limits | Flaky or environment-dependent tests; what was not measured | `docs/team/testing-guide.md` section 6, `docs/review/final-status.md` section 6 |

A defect written up in full is strong evidence that testing worked. G05 is a good candidate once it is fixed: a new version of a file kept permission for the assistant to read it without a new consent.

### Before Chapter 5 can be written

In this order:

1. Fix the privacy gap G05, with a test that fails before the fix. Then the other privacy items of the first batch (G01 to G04, G70).
2. Make "Not found" pages return a real 404 (G07). The isolation sweep needs it to tell a refusal from a page.
3. Finish the isolation sweep (scenario 19) on every data copy.
4. Fix the one unit test that depends on the machine, so the full suite passes everywhere.
5. Set up the real server or a staging server. Run the end-to-end suite there. Adapt the assistant tests to the local model.
6. Measure page response times on a production build on that server.
7. Measure assistant answer times on that server. Take the result to the firm (is the time acceptable?).
8. Re-run the labelled set: retrieval on all questions for each search method; full answers on a larger sample; two reviewers. Give the set its own database.
9. Run the model and search-model comparisons for the 5.1 table.
10. Run the value test with several testers.
11. Team members re-run every scenario by hand on the production build, including the steps that failed earlier (in scenarios 1, 5, 9, 13, 15, 18 and 20).
12. Hold the usability session, if the firm agrees.
13. Do one backup restore drill and write down the time.
14. Freeze the version. Record the commit, the machines and the dates. Keep the raw result files and screenshots with the project, so every number in the chapter can be traced.

### Suggested outline for Chapter 5

```
5.1 Methods, Algorithms, Tools and Techniques Applied
    5.1.1 Development method as applied
    5.1.2 Architecture and tools
    5.1.3 Access control and tenant isolation
    5.1.4 The action workflow
    5.1.5 Retrieval and the assistant
    5.1.6 Trade-offs and selection criteria
5.2 Results Achieved and Benchmarking
    5.2.1 What was built, against the requirements
    5.2.2 Isolation and access control
    5.2.3 Retrieval and answer quality
    5.2.4 Response times
    5.2.5 Usability and the value of the assistant
5.3 Test Plan
    5.3.1 Scope, levels and approach
    5.3.2 Environment and data
    5.3.3 Entry, exit and pass criteria
    5.3.4 Test cases
    5.3.5 Traceability
5.4 Test Report
    5.4.1 Results by suite
    5.4.2 Test case and scenario results
    5.4.3 Defects found and fixed
    5.4.4 Known limits
```

The template names three subsections and places the test report inside the third. If the supervisor wants exactly three, make 5.4 the last part of 5.3.

**Tables to include.**

| Table | Content |
|---|---|
| 5.1 | Tools and versions |
| 5.2 | Trade-offs: decision, alternatives, what was given up |
| 5.3 | Selection criteria against candidates (required by the template) |
| 5.4 | Requirements delivered: FR, status, evidence |
| 5.5 | Isolation sweep and denial tests by area |
| 5.6 | Retrieval results by method and by language |
| 5.7 | Answer review: correct, faithful, "cannot confirm", by question group |
| 5.8 | Response times by page and role; assistant times |
| 5.9 | Value test: time and correctness with and without the assistant |
| 5.10 | Test levels: what each protects, size, tool |
| 5.11 | Test cases |
| 5.12 | Traceability: requirement, tests, scenarios |
| 5.13 | Results by suite |
| 5.14 | Scenario results |
| 5.15 | Defects by class and seriousness |

**Figures to include.**

| Figure | Content |
|---|---|
| 5.1 | The system as built (update of Figure 4.2) |
| 5.2 | Retrieval hit rate by search method (bar chart) |
| 5.3 | Answer time distribution on the server |
| 5.4 | Page response times by page |
| 5.5 | Scenario steps: passed, friction, failed, per scenario |
| 5.6 | Defects found and fixed over the weeks |
| 5.7 to 5.10 | Screens of the working system for the core cycle, one from each side |

### Chapter 5 checklist

- [ ] Every number has a date, a machine, a commit and a named run behind it.
- [ ] Every requirement FR-01 to FR-22 and each non-functional requirement in 3.3.4 appears in the traceability table.
- [ ] Every target set in Chapters 3 and 4 has a measured result, or the words "not measured" and a reason.
- [ ] The selection-criteria table is present and its cells hold values, not ticks.
- [ ] Each comparison names its baseline.
- [ ] The isolation sweep is finished and reported, including anything it found.
- [ ] Answer quality is scored by two reviewers and the agreement is stated.
- [ ] Who the testers were is stated for scenarios, usability and the value test.
- [ ] Failed tests and open defects are reported, not hidden.
- [ ] Sample data is stated wherever results appear.
- [ ] No table of contents or reference table inside the chapter, and nothing repeated from Chapter 1 (the template's rule).
- [ ] The assistant takes its share of the chapter and no more: the workflow and isolation results come first.

---
