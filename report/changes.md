# Changes to the CS 511 final report draft

File: `report/CS511-final-report-draft.docx` (a copy of the team's draft; the original was not touched). Every changed or new paragraph carries a Word comment by "Selah review" (149 comments). 18 figures and 9 tables were added; the list of tables now has 13 entries and the list of figures 19.

**Chapters 5 and 6 are not touched.** They are next semester's work and are exactly as in the team's draft (template text). Content drafted for them earlier was removed on 23 Nov 2026, together with its comments, its list entries and five sentences in Chapters 1, 3 and 4 that pointed to it.

How to read the tables: "where" is the section and paragraph; old and new text are shortened; "why" names the source. Sources: `docs/review/final-status.md` (results and numbers), the code, the testing guide (job 2), the gap list and scenarios 22 to 34 (`docs/team/gaps-and-priorities.md`, helper 4), the target-product document (job 1, `docs/future/selah-target.md`), the course template, and the partner firm's two slide decks (used only to understand how the firm works).

Rules kept: nothing that was already correct was rewritten; the "fully local AI" statements, the six-person authorship and the timeline are as the team wrote them; real numbers only, "not measured" where none exist.

## Chapter 1: Introduction

### Changes

| Where | Old text (short) | New text (short) | Why |
|---|---|---|---|
| 1.1 Introduction, paragraph 4 | The project will also investigate AI-assisted progress monitoring to help consultants review client updates a… | The project also includes an AI assistant that works under the same access rules as the rest of the platform.… | Selah has no AI that monitors progress or finds deviations. The assistant answers with sources and drafts; overdue and stuck work is found by fixed rules (final-status; code: v_deviations is a database view, not a model). |
| 1.5 Justification | Eish provides | Selah provides | Wrong product name ("Eish"). |
| 1.5 Justification | AI is included as a supporting tool to summarize information and highlight important updates, while | AI ... answers questions from permitted documents with their sources and drafts summaries, while | The assistant does not pick out important updates on its own. |
| 1.6 Aims & Objectives, objective 5 | Investigate AI-assisted progress monitoring to support consultants in reviewing authorized client updates, su… | Provide an AI assistant that supports consultants, and client users where the firm offers it, by answering qu… | AI "identifying potential deviations or concerns" is not built; the objective now states what the assistant does. |
| 1.7.1 Project Scope, paragraph 4 | Authorized users will also be able to maintain goal statements and plans, arrange meetings and checkups, and … | Authorized consultants will maintain the plans (findings, recommendations and actions), and authorized users … | Clients do not edit plans (policy.ts: finding.write, recommendation.write and action.write are firm only, and a database trigger repeats it). No separate "goal statement" record exists in the code: team to confirm the wording. |
| 1.7.1 Project Scope, paragraph 5 | The project will investigate whether AI assistance can support this process by summarizing updates and identi… | These items are identified by fixed rules on recorded dates and states (late, blocked, no recent activity, a … | No AI deviation detection exists; the oversight lists are rule-based. |
| 1.7.2 Limitations, paragraph 3 | AI-generated responses, summaries, and identified concerns will remain subject to human review. | AI-generated responses, summaries, and drafts will remain subject to human review. | The AI does not identify concerns. |
| 1.7.2 Limitations, new paragraph 4 | (none) | As built, the prototype has further limits. It has been exercised with synthet… | Limits of the product as built (final-status section 6; design rule: 768 pixels and wider). |
| 1.8.4 Ethical Use of AI, paragraph 2 | AI-generated summaries and alerts should be presented | AI-generated answers, summaries and drafts should be presented | There are no AI-generated alerts; alerts and reminders are rule-based. |
| 1.9 Project Organization | Chapter 3 explains the development methodology and the system, and interface design. Chapter 5 | Chapter 3 presents the software project management plan and the requirements specification. Chapter 4 explain… | The sentence gave Chapter 4's content to Chapter 3 and left Chapter 4 out; it now matches the template and the report. |

### What the three reviews found, and what was fixed

**Grader (template).** The edited sentences now match the product, but the chapter still mixes the proposal's future tense ("will provide") with the new "as built" sentences; the sentence on fixed rules named two rules ("a date moved twice, work sent back twice") that Chapter 3 did not mention; "design, develop, and evaluate" needed a plain statement that no real user has evaluated the system.
**Partner firm.** "Facts-only" is jargon; the repeated "clients do not edit the plan" reads as distrust unless the ways a client does shape the plan are named; sections 1.2 to 1.4 still describe a consultant-only dashboard (the team's text).
**Technical.** No fault found in the changed sentences.
**Fixed.** "Facts-only progress updates" became "progress summaries that restate what is recorded". The two rules are now also in Table 3.6 (FR-11). The new limitation paragraph says that evaluation was technical only and that no consultant or client has used the system.
**Left for the team (not changed, outside "fix only what no longer matches").** The future tense of the proposal in 1.1, 1.6, 1.7 and 1.10; the template's instruction paragraph still under the Chapter 1 heading; the words "goals" and "goal statements" in 1.1 and objective 4 (the code has no separate goal record: the plan is findings, recommendations and actions); the title "AI-Assisted Governance and Consulting Implementation Platform" (the partner-side review finds it leads with the weakest part); "checkups" (the product says check-ins).

## Chapter 2: Background and Review of Literature

### Changes

| Where | Old text (short) | New text (short) | Why |
|---|---|---|---|
| 2.4 Knowledge Gap, last paragraph | The software comparison shows that | The software comparison in Table 2.1 shows that | The draft refers to a software comparison but contains no comparison table; Table 2.1 is added below and named here. |
| 2.4 Knowledge Gap, before the last paragraph: new paragraph, Table 2.1 and closing paragraph | (none) | Table 2.1 (22 feature rows, 7 columns of existing practice and software, and Selah) with an introducing and a closing paragraph | The template asks for detailed tables of features in existing applications and which are missing; the draft named a software comparison but had none. Selah's column lists only features that exist in the code. The three commercial columns are general descriptions and must be checked by the team against current product documentation before submission. |
| Literature summary table after the chapter summary | (none) | Caption "Table 2.2 Summary of the reviewed literature" | The table had no caption, so it could not appear in the list of tables. Text of the table unchanged. |

### What the three reviews found, and what was fixed

**Grader.** The template asks for detailed feature tables of existing applications; the draft named a "software comparison" but had none. In the first version of the new table Selah was "Yes" on every row, the commercial columns were unnamed categories, the conclusion came before the table, and the literature table was never cited.
**Partner firm.** The real incumbent (a spreadsheet plus e-mail) was missing; several cells were unfair to task boards and audit tools (owners and due dates, approval steps, auditor-written findings, date extensions, risk acceptance and control questionnaires are standard there); "isolated in the database" and "hash chain" cannot be judged for commercial products; "independent consultant review" overstated.
**Technical.** No fault in the "Selah" column.
**Fixed.** A "Spreadsheet and e-mail (current practice)" column was added; four rows were added where Selah is the weaker one (real clients, phone, connections to other systems, scanned pages); the disputed cells were changed; two rows were reworded to what a user can judge; the table and its two paragraphs now come before the paragraph that draws the conclusion; Table 2.2 is cited; the Selah column is headed "prototype, sample data" and the closing paragraph says several features still need refining.
**Left for the team.** The commercial columns are desk judgments about kinds of product, not sourced tests of named products: name two or three products per column with a source before submission, or keep the categories and say so (the text now says so). The citation numbers clash inside the chapter (for example [5] and [2] point to different works in 2.2 and 2.3) and the reference list is still the template's two sample entries. The literature table sits after the chapter summary.

## Chapter 3: SPMP & Requirement Specification

### Changes

| Where | Old text (short) | New text (short) | Why |
|---|---|---|---|
| 3.2.1 Product Perspective, paragraph 1 | share all internal information. | share all internal information. In every mode the plan itself is written and changed by the firm; client user… | Clients do not edit plans (policy.ts and the database trigger). |
| 3.2.2 Product Functions, seven new bullets after the last one | (none) | Seven bullets: An action cycle with eight recorded states (draft, assigned, in progr… | Features that exist in the product and were missing from the list (eight action states, client answers, date requests and risk acceptance, indicators, structure, intake to archiving, file controls and audit log, help). |
| 3.3 Specific requirements: 3.3.1 to 3.3.4 | Four headings numbered "2.3.1" to "2.3.4" with no text | Headings renumbered 3.3.1 to 3.3.4; text for each; Table 3.5 (19 screens) and Table 3.6 (22 functions, numbered FR-01 to FR-22); non-functional requirements numbered NFR-01 to NFR-07; two empty numbered template paragraphs removed | The section was empty. Tables are numbered 3.5 and 3.6 because the draft's Chapter 3 captions stop at 3.4 (the lead's earlier numbers 3.15 and 3.16 came from another version). Corrections made to the reused text: consultants, not clients, answer assessment questions; clients do not edit plans; "Waiting for the client" is the status word for a requested revision; action owners have no assistant; the client administrator, not the firm, places people in the structure; backups are written but not proven; page times were not measured; "automatic flagging of likely delays" replaced by "no AI monitoring; concern flags planned". |
| Captions of Table 3.1, Table 3.2, Figure 3.3, Table 3.4 | Plain text numbers | Same words; the number is a Word SEQ field | So the lists of tables and figures can include them. No wording changed. |

### What the three reviews found, and what was fixed

**Grader.** Section 3.3 read as a description, with no requirement numbers to trace tests against; "six status words" beside a list of seven; contradictions with later chapters (model "on the firm's server" although tests ran on a laptop; "the former lead and the client's administrators are told" beside a limitation that says the client is not told; mail notices although no sending domain exists); empty numbered template paragraphs around 3.3.
**Partner firm.** The intake wording read as a sales system; "risk acceptance" is audit jargon; "scores stay with the firm" needs what the client does see; the acceptor role was missing; "the client's rule" for the second sign-off reads as if the client sets it; "connected source" clashed with "no connection to client systems"; "representative user roles" suggests real users.
**Technical.** Six imprecise or wrong lines: file summaries are for firm staff only; give-to-a-colleague is the client admin or the project's coordinator or sponsor; the firm's editors can also place people in the structure; ladder days are per-project defaults; virus scanning is mandatory in production only; the hosted-model option still exists, so "runs locally" needed "by default".
**Fixed.** All six technical points. Functions are numbered FR-01 to FR-22 and the non-functional paragraphs NFR-01 to NFR-07. The six status words are named, with "Waiting" explained. The model sentence says "by default" and that tests ran on a laptop; e-mail "tested with a local mail catcher only"; the report row says how the client reads a report and that a notice is missing. Intake reworded ("a record of each inquiry ... no pricing or invoicing"); risk acceptance glossed; the client sees answers and confirmed findings; acceptor named; "the rule set for that client"; "a linked sheet"; "test accounts for each role". The two empty numbered paragraphs were removed.
**Left for the team.** "Table X" for the training table and the missing captions of the training and resource tables; the caption numbers 3.1, 3.2, Figure 3.3, 3.4 (kept as written); the Budget Allocation section, which is still the template's bullets; WBS tasks 4 to 6 still "Not Complete" (timeline kept exactly as written); "multiple browsers and mobile devices" in the resource table (the product has no phone layout); no measurable targets for the non-functional requirements (none exist in the sources).

## Chapter 4: Methodology & Design

### Changes

| Where | Old text (short) | New text (short) | Why |
|---|---|---|---|
| Chapter 4, whole chapter | Template instruction text only ("Suggested content is ...", the three headings, "[The students should add ...]") | Introduction; 4.1 Proposed Methodology (4.1.1 to 4.1.6: research first, page audit and gates, small reviewed changes, independent review, human decisions and the review of AI output, scenario testing); 4.2 System Design (4.2.1 to 4.2.9); 4.3 Interface Design (4.3.1 to 4.3.4); Figures 4.1 to 4.18; Tables 4.1 to 4.6 | The chapter was empty. Written to the template's three headings. The eight empty paragraphs and the instruction lines of the template were removed. |

### What the three reviews found, and what was fixed

**Grader.** Undefined project words (gate, batch, helpers, product owner, lead, target document); the method covers the final review week in detail and the earlier weeks in one sentence; who did what between students and AI tools is not stated; "all ten passed, which showed the leaks were real" reads backwards; Figure 4.1 and Table 4.1 disagreed on where redaction falls; figure faults (a dashed line through text in 4.3, the legend over a bar in 4.10, an actor with no use case in 4.8, no start marker in 4.5); the two 94-row feature-by-role tables are long for a chapter body; a contradiction between "Project closing: full" and the test "only the firm admin closes".
**Partner firm.** The research paragraph paraphrased the slides and was blunt about the firm; "did not adopt" read as a rejection although the firm left the choice open; the chain had no worked example; "Verified" needs its limit (evidence accepted for a step, not lasting change); the roles table lacked the other client roles and gave the observer too little; use cases lacked "record work for a firm-run client", "run an assessment", "read progress and reports", "ask to close"; "68 of 85 built" overstates, since 36 have known faults.
**Technical.** The most serious finding of the whole review: the claim that "a person reviews what a helper produced" is not supported. The lead that checked helpers' work was itself an AI model; a person (the product owner) decided at the gates. Likewise the test-set answers were scored by the builder of the set, not by an independent person. Others: fusion keeps 8 file passages (12 is the overall cap); the daily limit is a per-client setting (20 by default); only an authorize() refusal writes an audit row, and the "Not found" page answers HTTP 200; only a consultant hands over a deliverable (the target document's S10 cell for the firm admin is wrong); file summaries are firm-only (I8); indicator "moved away" and file import are already built (R5 row); observer and action-owner rows imprecise; Gate A decision 4 wording; batch 0 began 16 Nov; only scenario 18 ran at 768 pixels.
**Fixed.** All technical points, in text, tables and figures. Section 4.1 now says plainly that a lead agent (an AI model working under the product owner's direction) checked helpers' results, that the product owner took the decisions, and that the scoring was a single, non-independent review; 4.1.5 is renamed "Human decisions and the review of AI output". Gate, batch and product owner are defined where first used; the research paragraph was rewritten in the team's own words; a worked example from the sample data and the limit of "Verified" were added; Figures 4.1, 4.3, 4.5, 4.7, 4.8, 4.9 and 4.10 were redrawn; short notes are kept in the feature-by-role cells (a star marks a longer note left out), which removes the closing contradiction; three cells are corrected against the code and the text says which (W7, S10, I8).
**Not done, with the reason.** The feature-by-role tables stay in Chapter 4 because the task asked for them there (they could move to an appendix). No deployment or navigation diagram was added. The earlier increments are not documented step by step because their records were not among the sources. The split of work between the six students and the AI tools is for the team to state.

## Added beyond the template and the draft

The template gives only these headings for Chapter 4: 4.1 Proposed Methodology, 4.2 System Design, 4.3 Interface Design. None of the sub-headings below are in the template or in the team's draft; they were added to organise the new Chapter 4 text, and can be removed or merged (the text would then sit directly under 4.1, 4.2 and 4.3).

| Added | Where |
|---|---|
| 4.1.1 Research first; 4.1.2 Page audit and gates; 4.1.3 Small, reviewed changes; 4.1.4 Independent review of privacy, permission, AI and database changes; 4.1.5 Human decisions and the review of AI output; 4.1.6 Scenario testing | Under 4.1 |
| 4.2.1 Architecture; 4.2.2 Users and roles; 4.2.3 Permission model and tenant isolation; 4.2.4 Data model; 4.2.5 Core workflow and action states; 4.2.6 Use cases from the consultant's and the client's side; 4.2.7 Assistant design; 4.2.8 Target design: what is built and what is planned; 4.2.9 Deployment design | Under 4.2. 4.2.8 holds the target design from the future-product document (Figure 4.10, Tables 4.4 to 4.6), which the task asked for; the template does not name it |
| 4.3.1 Design principles; 4.3.2 Arabic screens; 4.3.3 English, dark mode and tablet width; 4.3.4 Help and accessibility | Under 4.3 |
| Table 2.1 (comparison of existing tools) and the caption "Table 2.2" on the existing literature table | Chapter 2, 2.4. The template asks for feature tables of existing applications but names no table |
| Text, Table 3.5 (screens) and Table 3.6 (functions) under 3.3.1 to 3.3.4 | Chapter 3. The headings are in the template (numbered 2.3.1 to 2.3.4 there) and were empty in the draft; only their numbers were changed to 3.3.x |
| Seven bullets in 3.2.2 Product Functions; one paragraph in 3.2.1; one paragraph in 1.7.2 | Chapters 1 and 3 |
| Entries in the List of Tables and List of Figures | Front matter |

## Front matter: lists of tables and figures, table of contents

| Where | Old text (short) | New text (short) | Why |
|---|---|---|---|
| List of Tables and List of Figures | One sample entry from the template; empty list of figures | 13 tables and 19 figures, as Word fields linked to the captions | Every table and figure must be listed. Page numbers are filled by Word when the fields update. |

Captions use Word SEQ fields so the lists can be refreshed. New table captions sit above the table and figure captions below the figure. The table of contents and both lists are marked to refresh when the file is opened in Word (accept the prompt, or select all and press F9).

Tables: Table 2.1 Features of existing software compared with Selah as built; Table 2.2 Summary of the reviewed literature; Table 3.1 Staffing plan by project phase; Table 3.2 Work Breakdown Structure; Table 3.4 Schedule Constraints and Milestones; Table 3.5 User interface screens; Table 3.6 Main system functions; Table 4.1 Gates and what they decided; Table 4.2 Roles on both sides; Table 4.3 The eight stored action states and the six status words; Table 4.4 Feature by role, the firm's side (target design; built, refine or planned); Table 4.5 Feature by role, the client's side (target design; built, refine or planned); Table 4.6 Planned features (not built).

Figures: Figure 3.3 Project Gantt Chart; Figure 4.1 The development process: research, phases and gates; Figure 4.2 Selah system architecture; Figure 4.3 Permission model: authorize() in the application and row-level security in the database; Figure 4.4 Simplified entity-relationship diagram of the main tables; Figure 4.5 Action state diagram; Figure 4.6 Sequence diagram: sending evidence and reviewing it; Figure 4.7 Use-case diagram: the consultant's (firm) side; Figure 4.8 Use-case diagram: the client's side; Figure 4.9 The assistant's retrieval pipeline with the permission filter and masking; Figure 4.10 Target design: features by area, built, to refine, and planned; Figure 4.11 Home page of a lead consultant (Arabic, right to left); Figure 4.12 Home page of a client administrator (Arabic); Figure 4.13 An action as the reviewing consultant sees it (Arabic); Figure 4.14 The same action as its owner sees it: discussion and history (Arabic); Figure 4.15 Project page, Progress tab (Arabic); Figure 4.16 The assistant card with a cited answer (Arabic interface); Figure 4.17 An action page for its owner (English, dark mode, 768 pixels); Figure 4.18 Home page of an action owner (English, dark mode, 768 pixels).

Figure files are in `report/figures/` (ten diagrams drawn for this report, eight real screenshots copied from the scenario runs).

## Where the slides and the product differ

The two slide decks were read only to understand the firm's work. They are not requirements, the report is not organized around their five example solutions, and their wording is not copied. Where they differ from the product, the product and the team's decisions win.

| The slides ask or suggest | What Selah does |
|---|---|
| Choose one of five example tools (maturity assessment, recommendations board, board-decision system, strategy and KPI platform, structures and policies tool) | One product around one chain: finding, recommendation, owner and deadline, action, evidence, consultant review, follow-up. Assessments, indicators, decisions and the structure are side parts that serve it |
| Follow each recommendation with an owner and a deadline, so the consultant knows the status without calling the client | This is the core and it matches. It depends on the client signing in and sending evidence, or on the consultant recording the work for a firm-run client |
| Status "at one glance" with traffic-light colors | Counts and the share verified by a consultant; no health word or color verdict |
| KPIs calculated automatically from company data, with alerts on deviation | Figures entered by the client, labeled "reported by the client, not verified impact"; one rule-based "moved away" notice that states figures only; no AI watches for deviations |
| A live compliance percentage and automatic governance reports | Selah never says "compliant". A report needs a second person's approval and a confirmed send |
| A maturity tool that produces diagnostic reports automatically | A consultant answers each assessment question and confirms each gap; scores stay with the firm |
| An interactive organization chart tied to an authority matrix, with a check that the matrix is applied | A descriptive structure of positions in published versions. It never grants or limits access. No authority matrix |
| A policy platform every employee searches; procedures as enforced step-by-step workflows | Not in Selah. Only people on a project have accounts; action owners have no assistant |
| Board decisions with automatic alerts | Decisions are recorded inside meetings and never edited; a decision can become a recommendation with actions and reminders |
| A mobile app is one of the options | Desktop and tablet only (768 pixels and wider) |
| The firm's phased work (strategy, operating plan, organization building) | One project per phase or agreed scope; Selah does not write the deliverables. Hand-over with a confirmed receipt, then the action cycle |
| Impact that lasts: the decks show the decay at three months and one year | Selah shows steps verified, with check-ins at 30, 60 and 90 days; a re-check at 6 and 12 months is only a proposal |
| A reading list of six governance and strategy sources | The same six are the planned reference library, after a license check. Not built |
| Real data is limited by client confidentiality; a prototype is expected | Sample data only; production readiness is not claimed |

## Verification of the file

Checked: the .docx unzips; every XML part is well formed; the skill's validator (`scripts/office/validate.py`, schema checks against the original) passes; all 18 images are embedded and referenced; `word/comments.xml` holds one comment per marked paragraph and every comment has its range in the document; captions and both lists agree; new text uses Times New Roman 12 pt, justified, 1.5 line spacing, as the draft's body text; headings reuse the draft's own heading paragraphs (the template's 4.1 to 4.3 and 5.1 to 5.3 lines, Heading 3 for sub-sections, Heading 2 for 3.3.1 to 3.3.4).

Not checked, because no document renderer is installed on this machine: page breaks and page count; how the wide tables (Tables 2.1, 4.4, 4.5) wrap; the placement of figures next to their captions; the page numbers in the table of contents and the two lists (they are filled when Word refreshes the fields); the look of the Arabic words in Table 4.3.

## Uncertain, for the team to decide

1. **Who reviewed the AI helpers' work.** The sources say the lead that checked helpers' results was itself an AI model, and a person (the product owner) decided at the gates. Section 4.1 now says this plainly. The team should decide how to present the students' own share of the work.
2. **Table 2.1.** The commercial columns are general judgments, not sourced tests of named products.
3. **Has the firm seen the prototype?** No source says. The report says only that no consultant or client has used the system.
4. **"Goals" in Chapter 1** and the proposal's future tense were left as written.
5. **The target document on main** (after #243 and #244) is the source of Tables 4.4 to 4.6; it now carries the W7, S10, I8 and R5 corrections. Its row S6 still gives "a consultant cannot set their own expertise" as a refine reason, although scenario 31 shows that fault fixed.
6. **Table numbers in Chapter 3.** The requirement tables are 3.5 and 3.6 (the lead's earlier 3.15 and 3.16), because the draft's captions stop at 3.4.
7. **Screenshots** were taken on a development server (a small "N" badge shows in a corner) and the two English ones show a first-visit card mid-animation.
