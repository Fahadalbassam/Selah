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
