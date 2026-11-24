# Changes to the CS 511 final report draft

File: `report/CS511-final-report-draft.docx`. The Word file has no comments; every change is listed here. The report has 14 tables and 19 figures. The table of contents, the list of tables and the list of figures are live Word fields with page numbers; after editing, right-click one and choose Update Field.

**The report is a plan.** This semester the team planned and designed Selah. Developing and evaluating it is next semester's work (Chapter 5). Chapters 1 to 4 therefore describe the design as proposed: what Selah will do, what is decided and what is still open. The interface figures are interface designs on sample data.

**Chapters 5 and 6 keep the team's text.** They are next semester's work. Only their headings were formatted like the rest of the report (see Formatting).

How to read the tables below: "where" is the section and paragraph; old and new text are shortened; "why" is the reason.

Rules kept: nothing that was already fine was rewritten; the literature, the "fully local AI" statements, the six-person authorship and the timeline are as the team wrote them.

## Chapter 1: Introduction

Kept as the team wrote it, with these corrections.

| Where | Old | New | Why |
|---|---|---|---|
| 1.5 Justification | Eish provides | Selah provides | Wrong product name. |
| 1.7.1 Project Scope, paragraph 4 | Authorized users will also be able to maintain goal statements and plans, arrange meetings and checkups, and record the follow-up ... | Authorized consultants will maintain the goals and plans, while client users will respond to them, update their assigned actions and submit evidence. Authorized users will also be able to arrange meetings and checkups and record the follow-up ... | In Selah the firm keeps the plan; clients answer it and do the work. |
| 1.9 Project Organization | Chapter 3 explains the development methodology and the system, and interface design. | Chapter 3 presents the software project management plan and the requirements specification. Chapter 4 explains the methodology and the system and interface design. | The sentence gave Chapter 4's content to Chapter 3 and skipped Chapter 4. |
| 1.10 Chapter Summary | The platform is built as a prototype | The platform is planned as a prototype | Chapters 1 to 4 are submitted as the plan; the prototype is presented next semester. |

## Chapter 2: Background and Review of Literature

Text kept exactly as the team wrote it, including 2.4.

| Where | Old | New | Why |
|---|---|---|---|
| Literature summary table | No caption | Caption "Table 2.1 Summary of the reviewed literature" above it | So the table is numbered and appears in the list of tables. |
| "Chapter summary" | Unnumbered | 2.5 Chapter Summary | Same numbering as 1.10 Chapter Summary. |

## Chapter 3: SPMP & Requirement Specification

Kept as the team wrote it, with these additions and corrections.

| Where | Old | New | Why |
|---|---|---|---|
| Staffing table, implementation row | using AI tools | integrating the AI/RAG component | The skill meant is building the assistant part of Selah. |
| 3.2.1 Product Perspective | ... share all internal information. | + In every mode the plan itself is written and changed by the firm; client users answer it, update their actions and send evidence. | States who keeps the plan. |
| 3.2.2 Product Functions | (nine bullets) | Seven more bullets: action states and status words, client answers, requests for more time and risk acceptance, client-reported indicators and the organization structure, inquiry to archiving, file controls and the audit log, help in Arabic and English | Functions in the design that the list was missing. |
| 3.3 Specific Requirements, 3.3.1 to 3.3.4 | Four empty headings numbered "2.3.1" to "2.3.4" | Text, a table of screens, a table of functions (FR-01 to FR-22) and NFR-01 to NFR-07 | The template asks for these sections and they were empty. |
| 3.3.3, "Assessment and AI" paragraph | (new text) | AI-assisted progress monitoring supports the consultant: the assistant summarizes progress, and highlighting possible deviations or concerns for the consultant to review is planned for a later phase | Matches objective 5 in Chapter 1. |
| Training table | No caption; the text called it "Table X" | Caption "Table 3.2 Training plan"; the text says "Table 3.2" | "Table X" was a placeholder. |
| Resource allocation table | No caption | Caption "Table 3.5 Resource allocation by major work activity" | So the table is numbered and listed. It continues on the next page as a second table without a caption. |
| Table and figure numbers | Tables and the Gantt figure shared one count (Table 3.1, 3.2, Figure 3.3, Table 3.4) | Tables and figures are counted separately, as in Chapter 4: Tables 3.1 to 3.7 and Figure 3.1. References in the text follow: Work Breakdown Structure is now Table 3.3, the Gantt chart Figure 3.1, screens Table 3.6, functions Table 3.7 | One numbering rule for the whole report, and Word renumbers by itself. |
| Table captions | Below the tables | Above the tables | Same place as in Chapter 4: table captions above, figure captions below. |

## Formatting (all chapters)

| What | Before | After |
|---|---|---|
| Heading styles | Mixed: some headings were Word headings, some bold body text; "Overall description" was a chapter-level heading; 3.3 was a bullet | Chapter titles Heading 1; sections (1.1, 2.4, 3.2) Heading 2; subsections (1.7.1, 4.2.3) Heading 3; Chapter 3 parts (Estimates, Work Breakdown Structure, Resource Allocation, Budget Allocation) Heading 4; all Times New Roman, black |
| Heading numbers | "2.1.", "3.1.2.  Work Plan", "6.2Findings", "2.4. Knowledge Gap." | "2.1", "3.1.2 Work Plan", "6.2 Findings", "2.4 Knowledge Gap" |
| Heading capitals | Mixed ("Social, Professional, legal, and ethical Implications", "Non-functional requirements", "Users and roles") | Title case everywhere |
| "Overall description" | Unnumbered | 3.2 Overall Description |
| "D. Budget Allocation" | Letter "D." with no A to C | Budget Allocation |
| Empty heading lines | 19 empty paragraphs styled as headings | Plain empty paragraphs, so the contents has no blank entries |
| Chapter 5 | Started mid-page after Chapter 4 | Starts on a new page like the other chapters |
| Table of contents, list of tables, list of figures | The list of tables was typed text; the lists were out of date | All three are Word fields, updated in Word, with page numbers and links |
| Caption numbers | Fixed numbers inside the fields | Fields that restart at each chapter, so Word renumbers when a table or figure is added |

## Proposed changes for Chapters 1 and 2 (not made; for the team to decide)

1. **2.4 Knowledge Gap, last paragraph: "The software comparison shows that ..."** The chapter has no separate comparison of software, so a reader will look for one. Rethink: say that the comparison is of the systems and tools described in the reviewed papers, where each covers part of the work (tracking, evidence, documents or AI help) and leaves gaps; and add that Selah also has limits, because it supports the consultant and the client but cannot take the consultant's place. For example: "Comparing the systems described in the reviewed papers shows that action tracking, evidence review, document management, and AI assistance already exist in separate tools, each covering only part of the work."
2. **1.1 and objective 4: "goals" and "goal statements".** The design has no separate goal record: the plan is findings, recommendations and actions. Rethink whether "goals" means the recommendations, or a goal record the design should add.
3. **Future tense in Chapter 1.** Chapter 1 uses "will" throughout, which fits a plan. Keep it this semester; when the prototype is submitted next semester, the tense will need to describe what was built.
4. **The report title** ("AI-Assisted Governance and Consulting Implementation Platform") leads with AI. Rethink whether it should lead with the follow-through between consultants and clients, which is the main purpose, with AI as support.

## Chapter 4: Methodology & Design

The chapter held only the template's instructions in the draft. It is written to the template's three headings and describes the plan.

### 4.1 Proposed Methodology

Section 4.1 shows how the team arrived at the features Selah needs. It has no dates. The sub-sections are a sequence:

| Sub-section | Content |
|---|---|
| 4.1 opening, Figure 4.1 | The method in one paragraph and one figure: eight steps, each producing a written result for the next |
| 4.1.1 Understanding the firm's work | What the team learned from the firm's two briefing sessions (in the team's own words) |
| 4.1.2 Finding the problem | Recommendations are handed over and then not followed; the one chain the design is centred on |
| 4.1.3 Walking through an engagement from both sides | The consultant's side, the client's side, and what goes wrong in real work |
| 4.1.4 From role needs to features | Each role's needs turned into features, grouped in nine areas |
| 4.1.5 Checking each feature against the problem and confidentiality | The two questions asked of every feature, and the design rules that came out of them |
| 4.1.6 Decision points and planned scenario walkthroughs | Table 4.1 (eight decision points, no dates) and the scenario walkthroughs planned to check the design |

Removed from 4.1: all dates; the former sub-section on human decisions and review; and every detail about how changes were produced and checked. The principle "the system suggests and a person decides" is kept only where it describes the product (4.2.7).

### 4.2 System Design

| Where | Change | Why |
|---|---|---|
| 4.2.1 Architecture | "is designed as", "the design uses", "are planned to run" | Design wording. |
| 4.2.2 Users and roles | "The design has five account roles"; in Table 4.2 the client manager signs a risk acceptance "as sponsor" | Design wording; matches the role check below. |
| 4.2.3 Permission model | Counts and internal names removed; the last paragraph now says how isolation will be checked next semester | Describes the design, not a result. Figure 4.3 redrawn with plain words. |
| 4.2.4 Data model | Three sentences explain Figure 4.4, which is redrawn (see below) | The old figure was hard to read. |
| 4.2.5, Table 4.3 | The Arabic column is removed (three columns remain) | Asked by the team. |
| 4.2.6 Use cases | "Solid ovals belong to the core design; dashed ovals are planned for a later phase" | New legend in Figures 4.7 and 4.8. |
| 4.2.7 Assistant | Opens by saying the assistant supports the core workflow and is not the centre of Selah; a new paragraph says it follows the rules and instructions of the consulting work and lists the planned reference library (CMA governance guide, IFC handbook, OECD principles, Balanced Scorecard, Good Strategy/Bad Strategy, MEP strategic-plan guide). | Asked by the team. |
| 4.2.7 Assistant (earlier) | Text follows the seven numbered steps of the redrawn Figure 4.9; "the system suggests and a person decides" stated here | Clearer flow. |
| 4.2.8 | Renamed "Design status: what is set and what is still to work out"; three marks (Set, To refine, To plan) in the text, Figure 4.10 and Tables 4.4 to 4.6 | See below. |
| 4.2.9 Deployment | "is designed to be deployed"; the deployment design lists backups, restore drill, upgrade and rollback steps | Design wording. |

### 4.2.8 in detail

- **Marks.** Set: decided and designed. To refine: thought through, with details still open. To plan: still to write and think through.
- **Shorter.** The section went from about 4,000 words to about 1,750, tables included. The text is three short paragraphs; the tables carry the detail.
- **How the tables were shortened.** Closely related features share a row (47 rows; 13 Set, 25 To refine, 9 To plan). The Lead and Deputy columns are one column, because the deputy stands in for the lead (as in Table 4.2). Parts that serve every role in the same way (the permission check, search and masking, background jobs, backups, deployment) are described in 4.2.3, 4.2.7 and 4.2.9 and are not rows. Cell words are short: full, own, view, via firm, and a dash for no access.
- **Table 4.6** is "Planned features and why each is needed": the nine features marked To plan, what each will do and why it is needed.

### Feature-by-role tables: cells changed by the logical check

Every cell of Tables 4.4 and 4.5 was checked by asking: is this what the role should be able to see and do in a consulting engagement? Inputs were the role descriptions in 4.2.2, the team's permission rules and the team's target design notes. Where they disagreed, the choice that makes sense for the role was taken.

| Feature | Role | Was | Now | Reasoning |
|---|---|---|---|---|
| People and access reviews | Observer (firm) | none | view | An observer is a member of the firm and needs to know who is on the project they follow. |
| Client record | Lead / deputy | view | full (profile of own clients) | The lead knows the client best and keeps its profile up to date; the firm admin creates the record. The permission rules agree. |
| Client record | Client admin | view | own (own company's details) | A company keeps its own name and contact details correct. The permission rules agree. |
| Change of lead with handover note | Lead / deputy | view (told) | own (writes or receives the note) | The outgoing lead is the one who can write the handover note; the new lead receives it. |
| Change of lead | Consultant | none | view (told) | People who work under a lead must know when the lead changes. |
| Change of lead | Sponsor, coordinator | none | view (told) | A consulting relationship is personal: the client's senior person and the day-to-day contact must know. The permission rules tell only the client's administrators; logic was chosen. FR-14 in Table 3.6 says the same now. |
| Engagement record | Client admin | none | view (the record only) | The client signed the engagement and should be able to read what was agreed. It does not get the firm's end reminder. The permission rules agree. |
| Requests for more time | Deputy | full | full (third move), with the lead | The deputy stands in for the lead. |
| Risk acceptance | Coordinator | full (signs) | view | Deciding not to carry out a step is a decision for someone with authority: the client admin or the sponsor. The permission rules allow any manager; logic was chosen. Table 4.2 says the same now. |
| Risk acceptance | Firm-run client | none | via firm | A client with no accounts can still decide to accept a risk; the consultant records the signed decision. |
| Progress reports | Firm-run client | none | via firm | A client with no accounts still needs the report; the consultant sends the PDF. |
| Business indicators | Firm roles | full (enters, links, checks) | full (links, checks) | The figures are "reported by the client", so the client enters them; the firm links them to recommendations and checks them, and enters them only for a firm-run client. The permission rules also let a consultant enter values; logic was chosen. |
| Closing survey | Deputy | none | view, with the lead | The deputy stands in for the lead. |
| Closing survey and case-study consent | Coordinator | full (answers; consent) | own (survey only) | Consent to a case study is given by the sponsor or the client admin, not by the day-to-day contact. |
| Re-check at 6 and 12 months (To plan) | Lead / deputy | none | full (does the re-check) | The consultant who knows the client is the one to look again. |
| Handing over a leaver's work | Client admin | (firm only) | full (own people) | The row now covers leavers on both sides; a client admin hands on the work of its own leaver. |
| Workload and concern facts (To plan) | Consultant | view (concern flags) | none | Facts about colleagues' workloads belong with the people who manage the team: the firm admin and the lead. |
| Assistant extensions (To plan) | Observer | mixed | view | One row now; an observer reads and changes nothing. |

### 4.3 Interface Design

| Where | Change | Why |
|---|---|---|
| 4.3.1 | "The figures below show the interface design, on sample data of a fictional firm and fictional clients." | The figures are interface designs. |
| Captions of Figures 4.11 to 4.18 | Each starts with "Interface design:" and names the screen | Asked by the team. |
| Figure 4.18 | Shows the home page of a new action owner with the complete first-visit card | The earlier picture caught the card half drawn. |
| 4.3.4 Help and accessibility | States the accessibility aims of the design and that they will be checked next semester | Results removed. |

### Redrawn figures

All ten diagrams were redrawn and each picture was looked at before it was accepted: text sits inside its box, and no text crosses a line.

| Figure | What changed |
|---|---|
| 4.1 | New: the eight steps from the firm's briefing to the planned walkthroughs; no dates |
| 4.2 | Plain names; counts removed |
| 4.3 | Plain names for the two layers; the "refused" paths no longer cross text |
| 4.4 | New simplified entity-relationship diagram: 13 main entities in four groups (organizations and people; engagement, project and plan; meetings and files; action and evidence); every line labelled, with "1" and "many" at its ends; no crossing lines |
| 4.5 | Labels moved so that none overlaps an arrow |
| 4.6 | Plain participant names; numbered messages that fit their arrows |
| 4.7, 4.8 | Same diagrams; legend is now "core design" and "planned for a later phase" |
| 4.9 | New numbered flow of seven steps, readable at page width |
| 4.10 | Counts of Set, To refine and To plan by area, taken from Tables 4.4 and 4.5 |
| 4.11 to 4.18 | Interface designs; a small tool mark in the corner of each picture was removed |

### Three reviews of this chapter

**Grader.** The chapter follows the template's three headings and reads as a plan: method, design, interface design; what is open is marked. **Partner firm.** The role check above was made from the firm's point of view (who signs, who is told, who enters figures). The roles and rules remain the team's reading of the firm's need until the firm answers the open questions. **Proofreader.** No dates in 4.1; no statement that the system exists or was run; all figure text inside its boxes.

## Added beyond the template and the draft

The template gives only 4.1 Proposed Methodology, 4.2 System Design and 4.3 Interface Design for Chapter 4. The items below are additions; sub-headings can be removed and their text kept under the heading above.

| Added | Where |
|---|---|
| 4.1.1 to 4.1.6 (listed above) | Under 4.1 |
| 4.2.1 Architecture; 4.2.2 Users and roles; 4.2.3 Permission model and tenant isolation; 4.2.4 Data model; 4.2.5 Core workflow and action states; 4.2.6 Use cases from the consultant's and the client's side; 4.2.7 Assistant design; 4.2.8 Design status; 4.2.9 Deployment design | Under 4.2 |
| 4.3.1 Design principles; 4.3.2 Arabic screens; 4.3.3 English, dark mode and tablet width; 4.3.4 Help and accessibility | Under 4.3 |
| Figures 4.1 to 4.18 and Tables 4.1 to 4.6 | Chapter 4 |
| Text, Table 3.6 and Table 3.7 under 3.3.1 to 3.3.4 | Chapter 3 (the headings are the template's, renumbered) |
| Seven bullets in 3.2.2; one sentence in 3.2.1 | Chapter 3 |
| Entries in the List of Tables and List of Figures | Front matter |

## Front matter: lists of tables and figures, table of contents

The table of contents and both lists are Word fields that Word filled in, with page numbers and links to each heading, table and figure: 14 tables (2.1; 3.1 to 3.7; 4.1 to 4.6) and 19 figures (3.1; 4.1 to 4.18).

## Where the slides and the product differ

The firm's two briefing decks were read to understand how the firm works. They are not requirements, and their wording is not copied. Where they differ from the design, the design follows the team's decisions.

| The slides ask or suggest | What the design of Selah does |
|---|---|
| Choose one of five example tools (maturity assessment, recommendations board, board-decision system, strategy and KPI platform, structures and policies tool) | One product around one chain: finding, recommendation, owner and due date, action, evidence, consultant review, follow-up. Assessments, indicators, decisions and the structure serve it |
| Follow each recommendation with an owner and a deadline, so the consultant knows the status without calling the client | This is the core and it matches. It depends on the client signing in and sending evidence, or on the consultant recording the work for a firm-run client |
| Status "at one glance" with traffic-light colors | Counts and the share verified by a consultant; no health word or color verdict |
| KPIs calculated automatically from company data, with alerts on deviation | Figures entered by the client, labeled "reported by the client, not verified impact"; one rule-based notice that states figures only; no AI watches for deviations |
| A live compliance percentage and automatic governance reports | Selah never says "compliant". A report needs a second person's approval and a confirmed send |
| A maturity tool that produces diagnostic reports automatically | A consultant answers each assessment question and confirms each gap; scores stay with the firm |
| An interactive organization chart tied to an authority matrix | A descriptive structure of positions in published versions. It never grants or limits access. No authority matrix |
| A policy platform every employee searches; procedures as enforced workflows | Not in the design. Only people on a project have accounts; action owners have no assistant |
| Board decisions with automatic alerts | Decisions are recorded inside meetings and never edited; a decision can become a recommendation with actions and reminders |
| A mobile app is one of the options | Desktop and tablet only (768 pixels and wider) |
| The firm's phased work (strategy, operating plan, organization building) | One project per phase or agreed scope; Selah does not write the deliverables. Hand-over with a confirmed receipt, then the action cycle |
| Impact that lasts: the decks show the decay at three months and one year | Steps verified, with check-ins at 30, 60 and 90 days; a re-check at 6 and 12 months is marked To plan |
| A reading list of governance and strategy sources | The reference library, marked To plan, after a license check of each source |
| Real data is limited by client confidentiality | Sample data only; production readiness is not claimed |

## Verification of the file

- The .docx unzips and every XML part is well formed.
- The validator of the document tool passes (schema checks against the previous version).
- Chapters 5 and 6: the text from "Chapter 5: Implementation and Testing" to "References" is identical, byte for byte, to the team's original draft.
- 33 captions (14 tables, 19 figures) and 33 list entries, with the same titles; numbering restarts in each chapter. Word updated the contents and both lists; no blank pages were added.
- All 18 pictures are embedded and are the same files as in `report/figures/`.
- New text uses Times New Roman and the draft's own heading and caption styles.
- The document was opened in Word and printed to PDF as a check (96 pages): the tables of 4.2.8 fit the page width, and every figure sits above its caption.
- Word search over Chapters 1 to 4 and the front matter. Remaining hits and why they are legitimate: "agent" and "multi-agent" (9) are in the literature review, describing a published framework; "implemented" (10) and "tested" (10) are in the literature review and its summary table, describing the reviewed studies; "merged" (2) and "repository" (1) are in the literature table; "code" (3) is "code editor/IDE" in the team's resource table and "authenticator code" for sign-in; "2026" (6) is the year of cited papers. Every other searched word has no hit. The word "model" remains where it describes the product's local model.

## Uncertain, for the team to decide

1. **Present tense for the design.** Sections 3.3 and Chapter 4 describe the design in the present tense ("the assistant keeps only ..."), with a sentence at the start of each saying that this states what Selah will do. If the supervisor prefers "will" throughout, the sentences need a further pass.
2. **Rows of Tables 4.4 and 4.5.** To bring 4.2.8 under half its length, related features share rows and the deputy shares the lead's column. If the team wants one row per feature again, the section grows back.
3. **Role decisions that need the firm.** Who is told when the lead changes, who may sign a risk acceptance, and whether a consultant may ever enter a client's figures (see the table of changed cells). Also: a client admin works on actions only at a restricted client; in a small family company the administrator may also own actions, so the firm should confirm this.
4. **Interface figures.** They show sample data with fictional names and e-mail addresses. The pictures of Figures 4.13 and 4.14 show dates of the sample data.
5. **"Goals" in Chapter 1** and the proposal's future tense were left as written.
6. **Table numbers in Chapter 3.** The requirement tables are 3.5 and 3.6, because the draft's captions stop at 3.4.

# Part 2: Recommendations for each chapter and for Chapter 5

These are proposals for the team to decide on. Nothing in this part has been changed in the report.

For the CS 511 team. Written after reading the full report draft (96 pages), the course template, the change list, the firm's two briefing sessions and the project's test and review material.

**How to read this.** Every item is a proposal. The team decides. Chapters 1 and 2 keep their narrative: the items there only correct what is wrong or fill a hole the template asks for. Chapters 1 to 4 stay a plan this semester, so nothing here asks the team to say that something is built or tested.

**Priority words.**

| Word | Meaning |
|---|---|
| Must | Needed for this semester's submission. A grader will notice if it is missing. |
| Should | Clearly improves the report. Do it this semester if time allows, otherwise early next semester. |
| Later | Next semester, with Chapter 5 and Chapter 6. |

**The five things that matter most this semester.**

1. The reference list is still the template's two examples, and section 2.2 uses different citation numbers from the rest of Chapter 2.
2. Template text is still in the report: the front pages, the paragraph under the Chapter 1 title, the first paragraph of 3.1, and the whole Budget Allocation section.
3. Chapter 3 promises risk management and has none. The work breakdown has six tasks and lacks the columns the template lists.
4. Chapter 4 explains how the features were found, but does not name and justify the development method, and does not say how the design will be evaluated.
5. Chapter 2 promises a software comparison in three places. The team decided not to add one, so the three sentences must change.

---

### 1. Recommendations by chapter

#### Across the whole report

| # | Where | What to add or change | Why | Priority |
|---|---|---|---|---|
| A1 | References | Replace the template text and its two example references with the real list. Chapter 2 cites sources up to [31]. Build the list with a reference manager so the numbers are generated, in one style. | The template asks for automatic citations in a set style. A report with 30 citations and no list fails a basic check. | Must |
| A2 | Title page, declaration, acknowledgement, abstract | Fill in the title, program, six names and IDs, supervisor, group number and date. Write the abstract as a plan: motivation, scope, method, and the expected outcome. Half a page to one page, in italics, with no citations and no abbreviations. | The template sets these rules. The pages are still placeholders. | Must |
| A3 | Appendix | Collect the bi-weekly status reports now (the template asks for at least four), the plagiarism report, the presentation slides, and the table of responses to evaluator comments. | The template lists them. Status reports cannot be written afterwards with honest dates. | Must |
| A4 | Whole report | One proofreading pass for small errors. Examples found: "client Organization", "Access restrictions will separate from different organizations" (1.7.1), "the actions await their attention" (1.8.1), "five-principal framework" and "Favors" (2.3.2), "Consultant and client's usability" (2.4), the punctuation around the Arabic name in 1.1. | These are errors, not style. They are cheap to fix. | Should |

Example abstract outline (A2): one sentence on the problem (recommendations are handed over and then not followed); one on what Selah is; two on the method (requirements from the firm's briefings, a design around one chain from finding to verified action, access control checked twice); one on the supporting assistant; one on how it will be evaluated next semester.

#### Chapter 1: Introduction

The narrative stays. The four proposals already on the change list (the wording of "goals", the future tense, the title, and the 2.4 sentence) still stand and are not repeated here.

| # | Where | What to add or change | Why | Priority |
|---|---|---|---|---|
| 1.1 | Under the chapter title, before 1.1 | Delete the paragraph that starts "This chapter comprises the background of the project ...". It is the template's instruction to students. | It is not the team's text and it sits on the first page a grader reads. | Must |
| 1.2 | 1.2 Problem Statement | Keep the paragraph. Add one sentence of evidence, and fix "Consulting Companies" and the last clause. | The template asks for a problem stated "with brevity and high level of clarity". A number makes it concrete. The evidence is already in Chapter 2. | Should |
| 1.3 | 1.6 Aims & Objectives | Do not change the five objectives. Add one sentence after the list that says how each will be judged, pointing to the evaluation plan (see 4.2 below). | The aim says "design, develop, and evaluate". Nothing in the report says what counts as success. Chapter 6 will need this to report findings. | Should |
| 1.4 | 1.7.2 Limitations | Add one short paragraph of exclusions that are already decided in Chapters 3 and 4 but missing here. | The template asks to "state what shall be excluded". A grader reads scope in Chapter 1, not in 3.3.1. | Should |
| 1.5 | 1.8.3 Legal and Confidentiality Considerations | Name the law. Add one sentence on the Saudi Personal Data Protection Law. | A grader in Saudi Arabia will look for it under "legal". The design already masks national ID, Iqama and IBAN numbers, so the report has a real answer. | Should |
| 1.6 | 1.3 Background and 1.4 Motivation | Both describe only a dashboard for the consultant. Section 1.5 then says Selah is not "only a reporting dashboard". Add a half sentence in 1.4 for the client's side. | The three sections should not disagree. The firm's stated problem has two halves: the consultant does not know, and the client forgets. | Should |

Example sentences:

- 1.2: "In one hospital study, the status of 22% of 254 issued recommendations could not be determined at follow-up, and no action had been taken on a further 33% [18]." This is the figure already quoted in 2.3.2. If the firm agrees in writing, its own survey of Saudi companies could be cited as well; do not use it without that agreement.
- 1.3: "Each objective will be evaluated next semester against the measures set out in section 4.1; the results will be reported in Chapter 5."
- 1.4: "The first version is a web application for desktop and tablet screens, with no phone layout. It has no connection to a client's HR, finance or ERP systems and no pricing or invoicing. It will be developed and evaluated with sample data only, and it is not offered as ready for operational use: an outside security test and a legal review are outside this project."
- 1.5: "Because Selah will store names, e-mail addresses and work records of client staff, its operation will fall under the Saudi Personal Data Protection Law and its implementing regulations; the retention periods and the hosting location will be agreed with the firm before any real data is used." Cite the official text.
- 1.6: "... and to give the client's staff one place to see what is asked of them and to show what was done."

#### Chapter 2: Background and Review of Literature

The narrative stays. No comparison table is proposed.

| # | Where | What to add or change | Why | Priority |
|---|---|---|---|---|
| 2.1 | 2.2 Background (all four parts) | The citation numbers in 2.2 do not match the rest of the chapter. In 2.2.1, [1] is the consulting lifecycle study, which is [14] in 2.3.1 and 2.4. In 2.2.2, Hanisch is [4]; in 2.3.3 it is [6]. In 2.2.3, [6] is Lewis et al., but [6] is Hanisch elsewhere. Sources such as Ames and Lewis et al. may not be in the list at all. Renumber 2.2 from the one reference list (A1). | A wrong citation is the most serious kind of error in a literature chapter. It will be found by anyone who checks one reference. | Must |
| 2.2 | 2.1 (fourth sentence), 2.4 (last paragraph), 2.5 (first and fourth sentences) | Three places promise or report a comparison of existing software: "A comparison of existing software and services complements the academic review", "The software comparison shows ...", "reviewed the background, literature, and existing software" and "Existing applications offer substantial ... capabilities". The chapter has none. Reword all three to speak of the systems described in the reviewed papers. | The change list already proposes this for 2.4. The same promise is in 2.1 and 2.5. The template asks for feature tables in development projects, so a grader will look for what the text announces. | Must |
| 2.3 | 2.3.4 AI in Consulting, AI Governance, and Human Oversight | The five paragraphs are written in a spoken style: "the whole mess that is AI governance research", "Turns out", "AI creeping into their work", "did okay", "a solid margin". Each also starts with a bare author line. Keep every fact and rewrite only the wording to match the rest of the chapter. | The register is wrong for a report, and it differs sharply from 2.3.1 to 2.3.3. It reads as unfinished notes. | Must |
| 2.4 | 2.3.2, last paragraph (AlQurashi, the Shamel platform) | The paragraph stops after "81 representatives of audited entities". Add what the survey found, why it matters for Selah, and its limit, as the other paragraphs do. Also remove the stray title "Lessons in the Aftermath of Incident Investigations" at the start of the Wrigstad paragraph. | Shamel is the closest system to Selah in the whole review and it is Saudi. It is the one paragraph a local grader will read closely. | Must |
| 2.5 | Table 2.1 | It has no mention in the text, and it sits after the chapter summary. Refer to it once ("Table 2.1 summarizes the reviewed studies") and place it before 2.4, or move it to an appendix. Check each row against the text: Das et al. is 2026 in 2.3.5 and 2025 in the table; "evident graph" in 2.3.5 is "eventic graph" in the table. | Every table should be cited in the text. A summary section should be the last thing in a chapter. | Should |
| 2.6 | 2.3.3 and 2.3.4, end of each | Add one closing sentence that says what the group of studies means for Selah. Sections 2.3.2, 2.3.7 and 2.3.8 already do this; these two do not. | A grader looks for synthesis, not a list of summaries. One sentence each is enough. | Should |
| 2.7 | 2.2.4 Controlled Access to Organizational Knowledge | Add two or three sentences, with two or three sources, on access control for the platform itself: role-based access control and keeping tenants apart in one database. Today the chapter covers access control only for the assistant. | The template asks for "the techniques that are widely used for solving such problems". The permission model is the largest technical part of Chapter 4, and it has no literature behind it. | Should |
| 2.8 | Reference numbers | [17] is never cited in the chapter. Check that every listed source is cited and every citation is listed. | Follows from A1. | Should |

Example sentences:

- 2.2, for 2.1: "Because the project develops an application, the review also notes the systems and tools described in the reviewed papers."
- 2.2, for 2.5: "This chapter reviewed the background and the literature relevant to ..." and "The systems described in the reviewed studies cover tracking, evidence or document assistance separately ...".
- 2.3, one paragraph as a model: "Sele and Chugunova (2024) [25] tested the common assumption that human oversight improves algorithmic decisions. Almost 300 participants either delegated a decision fully to an algorithm or could adjust its recommendation. The ability to adjust increased trust in and use of the algorithm, but reduced the accuracy of the final decisions."
- 2.6, for 2.3.4: "Taken together, these studies support a design in which the assistant drafts and a consultant decides, and they show that the presence of a human reviewer is not by itself evidence of reliability."
- 2.7: start from the standard role-based access control model (Sandhu et al., 1996) and one source on row-level isolation in multi-tenant databases. Read each source before citing it.

#### Chapter 3: SPMP & Requirement Specification

| # | Where | What to add or change | Why | Priority |
|---|---|---|---|---|
| 3.1 | 3.1.2, Budget Allocation | The section holds only the template's bullets. Replace them with a budget table: one block per work activity, one line per resource type (personnel, travel, meetings, computing, software tools, testing facilities, administrative support), with the amount in SAR. | The template asks for exactly this, and the section is empty. Zero is a valid amount if it is stated and explained. | Must |
| 3.2 | 3.1, first paragraph | The paragraph is the template's own text. It promises plans for "risk management, project work, project tracking and project close-out". Replace it with the team's sentence, and add a risk table plus two short paragraphs on tracking and close-out. | The report promises three plans it does not contain. A risk plan is the part of an SPMP graders check first. | Must |
| 3.3 | Table 3.3 Work Breakdown Structure | Add two columns the template lists: acceptance criteria, and predecessor and successor. Split Task 5 (ten weeks, one line) into work packages. Update the Status column on the day of submission (Task 4 still reads "Not Complete"). | The template says to decompose "to a level that exposes all project risk factors". One ten-week line hides all of next semester. | Must |
| 3.4 | 3.3.4, NFR-05 and the other non-functional requirements | NFR-05 says "Page response targets will be set and measured next semester". Set the targets now; measure next semester. Give every NFR a measure and a way to check it. | A requirement without a target cannot be tested. Setting a target is planning, not a result. | Must |
| 3.5 | Figure 3.1 and Critical Path Analysis | After 3.3 is done, redraw the GP2 half of the Gantt chart with the work packages, show which run in parallel, and restate the critical path. | The template asks the schedule to show "opportunities for concurrent work activities". Today every task follows the one before it, so the critical path is the whole list. | Should |
| 3.6 | Table 3.7 Main system functions | Add two columns: the objective each function serves (1 to 5) and its phase (core design or later phase). Add a short requirements-to-objectives table after it. | It shows that every objective has requirements and every requirement has a reason. It becomes the first column of the test tables in Chapter 5. | Should |
| 3.7 | Table 3.1 Staffing and Table 3.5 Resource allocation | Table 3.1 shows "All 6 team members" in every phase. Add the roles within the team for next semester and how many members hold each. Then make Table 3.5 agree with Chapter 4: it lists "React, TypeScript", "candidate database tools" and "Cloudflare and Resend if selected", while 4.2.1 names Next.js, PostgreSQL 16 and the other chosen parts. | The template asks for "numbers of personnel by skill level" in each phase. Two chapters should not name different tools. | Should |
| 3.8 | 3.3.1, "AI connection" | The requirement names the model files ("qwen3.5:4b", "bge-m3"). State the requirement ("a language model that runs on the firm's own server") and leave the product names to 4.2.1. | A requirement says what is needed; the design says with what. The model may change after next semester's comparison, and the requirement should survive that. | Should |

Outlines and examples:

**3.1 Budget table (the team fills in real amounts).**

| Work activity | Resource | Amount (SAR) | Note |
|---|---|---|---|
| 5. Prototype and testing | Personnel | 0 | Student effort is not costed |
| | Computing: server for the local model | (real figure) | Existing machine or its cost |
| | Software tools | (real figure) | Free and open-source tools: 0; a domain name if bought |
| | Testing facilities | 0 | Sample data on the team's machines |
| | Administrative support | 0 | Supervisor and firm feedback |
| 6. Final report | Printing and binding | (real figure) | |
| Total | | (sum) | Confidence: medium |

**3.2 Risk table (examples drawn from the project; the team sets likelihood and impact).**

| Risk | Likelihood | Impact | Response | Owner |
|---|---|---|---|---|
| The firm answers the open questions late | | | Design with a stated assumption for each; list them; revisit at each milestone | |
| The local model is too slow on a server without a suitable graphics processor | | | Keep the core workflow independent of the assistant; measure early; agree an acceptable time with the firm | |
| A defect lets one client see another's data | | | Rules checked twice (application and database); a test as the wrong user for every rule; a full isolation sweep before any demonstration | |
| The scope grows beyond one semester (47 features) | | | Build the features marked core first; freeze scope at a set week | |
| A team member is unavailable during exams | | | Two people know each part; reserve weeks in the schedule | |
| No real client data is available | | | Evaluate on sample data and say so; plan a pilot as future work | |

Tracking: weekly team meeting, bi-weekly status report to the supervisor, re-estimation at each milestone. Close-out: final report, source code, presentation, hand-over notes to the firm.

**3.3 Task 5 split (durations are the team's to set; they must add up to the ten weeks).**

| # | Work package | Deliverable | Acceptance criterion | Predecessor |
|---|---|---|---|---|
| 5.1 | Accounts, roles, permission check, isolation | Sign-in and access rules | Every rule passes as the right user and is refused as the wrong user | 4 |
| 5.2 | The action cycle with evidence and review | Core workflow | The core scenarios pass in Arabic and English | 5.1 |
| 5.3 | Meetings, reports, notices | Follow-up features | Their scenarios pass | 5.2 |
| 5.4 | The assistant | Cited answers under the permission filter | No passage from a file the asker cannot open; retrieval measured on the labelled set | 5.1 (parallel with 5.2 and 5.3) |
| 5.5 | Testing and measurement | Test report | Every planned measure in the evaluation plan has a result | 5.2 to 5.4 |
| 5.6 | Fixes and freeze | Frozen version | No open high-severity defect | 5.5 |

**3.4 NFR targets (format; the values are examples only and the team sets them).**

| NFR | Measure | Target | How it will be checked |
|---|---|---|---|
| NFR-01 Security | Requests by a wrong user that return data | 0 | Isolation sweep and denial tests |
| NFR-05 Performance | Time to open a home page or a list, production build, on the server | for example "within 2 s for 9 of 10 requests" | Timed runs for each role |
| NFR-05 Assistant | Time to a full answer on the server | a figure agreed with the firm | Timed runs on the labelled questions |
| NFR-06 AI review | Share of labelled questions where the right passage is sent to the model | a figure the team sets before measuring | Labelled test set |
| NFR-03 Ease of use | Share of scenario steps completed without help | a figure the team sets | Scenario walkthroughs |

#### Chapter 4: Methodology & Design

| # | Where | What to add or change | Why | Priority |
|---|---|---|---|---|
| 4.1 | 4.1 Proposed Methodology (new short part after 4.1.6) | Name the development method for next semester and justify it against alternatives. Section 4.1 explains well how the features were found, but the development method is one sentence ("developed in small increments"). | The template says to "discuss the proposed project methodology". Graders expect a named process model and a reason for choosing it. | Must |
| 4.2 | 4.1.6, after the scenario paragraph | Add an evaluation plan as one table: objective, what will be measured, how, and the target. Include a short usability check with a few people in each role, if the firm agrees. | The aim includes "evaluate". The report says "will be checked next semester" in several places (4.2.3, 4.3.4, 3.3.4) and never says against what. This table is the contract for Chapter 5. | Must |
| 4.3 | 4.2.7 Assistant Design, one short paragraph (or 3.3.3) | Say plainly how objective 5 is met in the design. Today objective 5 says "identifying potential deviations or concerns"; 3.3.3 says highlighting deviations "is planned for a later phase"; Table 4.1 says a consultant "reviews what it highlights". A reader cannot tell what will exist. | An examiner will hold the team to each objective. The answer exists in the design (rules find late, stuck and inactive work; the assistant summarizes); it only needs to be said in one place. This keeps the assistant in its supporting role. | Must |
| 4.4 | 4.2.1 Architecture | Add a small table of the main design choices with the alternative considered and the reason. Keep it to design decisions; the full tool comparison belongs to 5.1. | The architecture names eight products and gives no reason for any. The template's Chapter 5 asks for trade-offs later, but a design chapter should show the choices were choices. | Should |
| 4.5 | 4.2.6 Use Cases | Add written descriptions for three core use cases: send evidence, review evidence, ask the assistant. Each with actor, precondition, main steps, alternative steps and result. | Use-case diagrams alone show names. Graders usually expect at least a few specified use cases, and they become test cases in Chapter 5. | Should |
| 4.6 | 4.2.3 or 4.2.5 | Add one more sequence diagram: a request for another client's record, refused by the permission check or by the database, answered "Not found" and written to the audit log. | Isolation is the central promise of the design and has a structure figure but no behaviour figure. The template lists sequence diagrams by name; the report has one. | Should |
| 4.7 | 4.2.4 Data Model | Add a table for the 13 entities of Figure 4.4: the main attributes, the key, and which organization each row belongs to. | A simplified diagram with no attributes is thin for a data model. The "belongs to" column also explains how isolation works on the data. | Should |
| 4.8 | 4.2.8 Design Status | Two additions. First, a column or a sentence that says which features next semester's prototype will include. Second, a short table of the main open questions for the firm, who decides, and the assumption the design makes until then. The text mentions the open questions and lists only three examples. | "25 of 47 features To refine" can read as an unfinished design. Showing the prototype's scope and the assumptions turns it into a managed plan. The firm will also read this part to see its own decisions. | Should |

Outlines and examples:

**4.1 Method table.**

| Criterion | Waterfall | Iterative and incremental (proposed) | Full Scrum |
|---|---|---|---|
| Requirements still depend on the firm's answers | Poor fit | Good fit: each increment can absorb an answer | Good fit |
| Six students working part-time | Fits | Fits | Daily meetings and fixed roles are hard to keep |
| Early check of the riskiest part (isolation) | Late | First increment | Possible |
| Fixed academic deadlines | Fits | Fits with a scope freeze | Fits |

Then four or five sentences: the length of an increment, what "done" means for one (its scenarios pass, each permission rule has a test as the wrong user, a second team member has reviewed the change), and how the firm's feedback enters.

**4.2 Evaluation plan.**

| Objective | What will be measured | How | Target |
|---|---|---|---|
| 1 Firm workspace | The firm-side scenarios completed | Scenario walkthroughs, Arabic and English | Set by the team |
| 2 Client workspaces with controlled access | Requests by a wrong user that return data | Isolation sweep; denial tests | 0 |
| 3 Recommendation and action workflow | The core cycle from recommendation to verified action | Scenarios; automated end-to-end run | All steps pass |
| 4 Follow-up | Reminders, meetings and notices reach the right person only | Scenarios; tests | Set by the team |
| 5 AI-assisted progress monitoring | Whether the right source is found; whether answers are supported by their sources; whether a progress summary matches the records | Labelled question set; review of answers by two people | Set by the team before measuring |
| All | Ease of use | Short task session and a standard questionnaire with a few users per side | Set by the team |
| All | Page response time on the server | Timed runs | The NFR-05 target |

**4.3 Example paragraph.** "Objective 5 is addressed in two parts. Progress is monitored by rules, not by a model: late, stuck and inactive actions, a date moved twice and work sent back twice are found from the records and listed for the consultant (FR-10, FR-11). The assistant supports this by summarizing the records the consultant may see and by drafting a facts-only progress update (FR-12, FR-15). Whether a model can also point out concerns that the rules miss will be investigated next semester and reported in Chapter 5; until then it is marked as a later phase."

**4.4 Design choices.**

| Choice | Alternative considered | Reason |
|---|---|---|
| Access rules checked in the application and again in the database | Application checks only; one database per client | One missed check must not leak data; one database keeps operation simple for a small firm |
| A language model on the firm's server | A hosted model | Client documents must not leave the firm |
| Search by meaning and by keyword together | Either one alone | Arabic spelling variants and exact terms; to be compared next semester |
| Web application for desktop and tablet | Phone application | The work is document-heavy; one code base |
| The firm writes the plan; the client answers it | Shared editing | Matches how an engagement runs; keeps one accountable author |

**4.8 Open questions table (examples from the design work).**

| Question | Who decides | Assumption in the design until then |
|---|---|---|
| Must declining a request for more time carry a reason? | Firm | Optional |
| What happens after the last reminder step? | Firm and client | The action stays open and is listed for the lead |
| Who may sign a risk acceptance? | Firm and client | Client admin or sponsor |
| Where is real client data hosted, and who operates the server? | Firm | Sample data only; no hosting chosen |
| Is about a minute per assistant answer acceptable? | Firm | The interface keeps the request open and shows progress |

#### Chapter 6: Conclusion (next semester)

The chapter holds the template's text today. That is correct for this semester. All items below are for next semester, except 6.5.

| # | Where | What to add or change | Why | Priority |
|---|---|---|---|---|
| 6.1 | 6.2 Findings and Contributions | Answer the five objectives one by one in a table: objective, what was delivered, the evidence in Chapter 5 (table or figure number), and "met", "partly met" or "not met". | The template asks for findings "clearly stated". A table against the objectives is the clearest form and stops the chapter from drifting into description. | Later |
| 6.2 | 6.2 | State three or four contributions, in this order: the shared workflow from finding to verified action; the access model checked twice; the evaluation method (scenarios, isolation sweep, labelled questions); the assistant that reads only what the asker may open. Then one paragraph that returns to the gap in 2.4. | The template says the contribution "should be made very clear". The order keeps the follow-through first and the assistant in support. | Later |
| 6.3 | 6.3 Limitations | Write it, although it is optional. Sample data only; who the testers were; one server and its speed; the size of the answer sample; no outside security test; legal texts not reviewed; the features left for a later phase. | An honest limitations section protects every number in Chapter 5. Examiners trust results more when the limits are stated by the authors. | Later |
| 6.4 | 6.4 Lessons & Skills Learned | The template requires a table of new skills, including technical ones. Columns: skill, kind (technical, managerial, domain), where it was used, how it was learned. | It is a named requirement of the template. | Later |
| 6.5 | 6.4, preparation | Start a one-page lessons log now. Each member adds a line when something is learned: a tool, a mistake, a decision that changed. | A skills table written in the last week is generic. A log makes it specific and true. It costs five minutes a week. | Should (start now) |
| 6.6 | 6.5 Recommendations for Future Works | Three groups: the nine features of Table 4.6; the steps before real use (hosting, an outside security test, legal review, a pilot on one real engagement); and research questions (does verified work stay in place after 6 and 12 months; does the assistant save a consultant time). | The material exists already. Grouping it shows the team knows the difference between a prototype and a product. | Later |
| 6.7 | 6.1 and the closing paragraph | End with the benefit to the firm and its clients in plain terms, using only numbers measured in Chapter 5. Then update the tense of Chapters 1 to 4 and rewrite the abstract to include results. | The template says the conclusion "should recommend to the readers the benefits of pursuing the project". | Later |

---

### 2. What Chapter 5 should cover next semester

#### 2.1 Where the material stands today

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

#### 2.2 Section 5.1: methods, algorithms, tools and techniques

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

#### 2.3 Section 5.2: results achieved and benchmarking

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
| Reliability | Core workflow with the assistant switched off; time to restore from a backup | One drill each, written down | NFR-04 | `docs/operations.md` |

**On benchmarking.** No published system does the same job on the same data, so most comparisons are internal: one method against another on the same questions, and measured values against the targets set in Chapter 3. Figures from Chapter 2 (for example Arabic retrieval recall in other studies) can be quoted for context only, with a sentence that says the data differs.

#### 2.4 Section 5.3: test plan

Follow the IEEE test documentation structure, as the template suggests.

| Part | Content |
|---|---|
| Scope | What is tested (FR-01 to FR-22, NFR-01 to NFR-07) and what is not (features marked for a later phase; an outside security test) |
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

#### 2.5 Test report

| Part | Content | Feeds from |
|---|---|---|
| Summary by suite | Tests run, passed, failed, skipped, run time, date, commit | `docs/review/final-status.md` section 3 (as the format), new runs for the numbers |
| Test case results | The table from 5.3 with "actual result" and "status" filled in | New runs |
| Scenario results | One row per scenario: steps, passed, friction, failed, language, who ran it, date | `docs/review/scenarios/`, `docs/team/gaps-and-priorities.md` section 2 |
| Isolation results | Addresses checked, accounts, refusals, any finding | The sweep |
| Defects | Count by class and seriousness; found, fixed, open; two or three written up in full (what was found, how, the fix, the test that now guards it) | `docs/team/gaps-and-priorities.md` sections 3 and 4, `docs/testing/bug-tracker.md` |
| Known limits | Flaky or environment-dependent tests; what was not measured | `docs/team/testing-guide.md` section 6, `docs/review/final-status.md` section 6 |

A defect written up in full is strong evidence that testing worked. G05 is a good candidate once it is fixed: a new version of a file kept permission for the assistant to read it without a new consent.

#### 2.6 Before Chapter 5 can be written

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

#### 2.7 Suggested outline for Chapter 5

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

#### 2.8 Chapter 5 checklist

- [ ] Every number has a date, a machine, a commit and a named run behind it.
- [ ] Every requirement FR-01 to FR-22 and NFR-01 to NFR-07 appears in the traceability table.
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

### 3. Order of work

**This semester, before submission.**

| Order | Task | Items |
|---|---|---|
| 1 | Build the real reference list and renumber section 2.2 from it | A1, 2.1, 2.8 |
| 2 | Remove all template text: front pages, the paragraph under the Chapter 1 title, the first paragraph of 3.1, Budget Allocation | A2, 1.1, 3.1, 3.2 |
| 3 | Chapter 3 plan: risk table, tracking and close-out, work breakdown columns and the split of Task 5, NFR targets | 3.2, 3.3, 3.4 |
| 4 | Chapter 4: name and justify the development method; add the evaluation plan; state how objective 5 is met | 4.1, 4.2, 4.3 |
| 5 | Chapter 2 corrections: the three "software comparison" sentences, the tone of 2.3.4, the unfinished Shamel paragraph | 2.2, 2.3, 2.4 |
| 6 | Collect the appendix: status reports, plagiarism report, slides, responses to comments | A3 |
| 7 | Decide the four proposals already on the change list (goals, tense, title, the 2.4 sentence) | Change list |
| 8 | Proofread; update the contents and both lists; set the work breakdown status on the day | A4, 3.3 |

**If time allows this semester, otherwise first weeks of next semester.**

| Order | Task | Items |
|---|---|---|
| 9 | Chapter 1 additions: evidence sentence, exclusions, the data protection law, pointer to the evaluation plan | 1.2 to 1.6 |
| 10 | Chapter 3: requirement-to-objective columns, team roles, tools aligned with Chapter 4, redrawn Gantt chart | 3.5 to 3.8 |
| 11 | Chapter 4: design choices table, three written use cases, the refusal sequence diagram, entity table, prototype scope and open questions | 4.4 to 4.8 |
| 12 | Chapter 2: move and cite Table 2.1, closing sentences, access-control literature | 2.5 to 2.7 |
| 13 | Start the lessons log | 6.5 |
| 14 | Ask the firm for a design review session and for answers to the open questions | 4.2, 4.8 |

**Next semester.**

| Order | Task |
|---|---|
| 15 | Privacy fixes first (G05), then finish the isolation sweep |
| 16 | Set up the server; run the end-to-end suite and all timings there |
| 17 | Re-run the labelled set, the comparisons and the value test |
| 18 | Team members re-run all scenarios by hand on the production build; usability session |
| 19 | Freeze the version; write Chapter 5 from the frozen results |
| 20 | Write Chapter 6, update the tense of Chapters 1 to 4, rewrite the abstract with results |
