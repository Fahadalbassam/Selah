# Governance assessments

Reusable assessment templates, assessments of client projects, and the path from a gap to verified work. Tables in `src/db/schema`, rules in the Assessments section of `drizzle/0000_baseline.sql`. Every rule below is enforced in Postgres; `src/services/assessments.ts` gives clear errors. The scope is the controlled MVP agreed on 2026-10-21 (Option B, template builder): no branching logic beyond one simple condition, no certification, no weighted engine beyond a visible 1–3 weight, and no drag-and-drop designer.

**What Selah does not claim.** An assessment measures a client against the template's criteria. It is not a certification of legal compliance, and Selah never says "compliant" or "non-compliant". A gap is "a gap against good practice", "against the firm's method" or, only where the criterion binds this client, "against a legal requirement".

## The lifecycle

Assessment → gaps → findings → recommendations → actions → progress and evidence → verification → reports.

1. **Template.** The firm builds a template (or installs the starter one), then publishes it.
2. **Assessment.** A consultant on a client project starts an assessment against the template's latest published version. Every question gets its row, with its basis worked out for this client (below).
3. **Answers.** Consultants answer, comment and attach files while it is a draft. Finalising needs every question that applies answered (or marked not applicable). After that nothing changes; a reassessment is a new assessment, so the two can be compared.
4. **Gaps.** An answer at or below the question's threshold is a gap. Selah only suggests it: a consultant confirms each gap as a finding (`POST /api/assessment-answers/:id/finding`), at most once per answer.
5. **From here, the existing system.** The finding is an ordinary finding. Recommendations answer it (`POST /api/projects/:id/recommendations` with `findingId`), actions carry them out, and progress, evidence, reviews, reminders and metrics work exactly as they do for a recommendation made directly. There is one recommendation system, and direct recommendations need no assessment.
6. **Follow-up.** `GET /api/assessments/:id/follow-up` lists each confirmed gap with its recommendations and released actions: reported (awaiting review), evidenced (evidence submitted) and verified (accepted by a consultant's review), counted apart and never added together. "Evidenced" overlaps the other two. Verified is also split by whose evidence it rested on: the client's, or recorded by a consultant. The review records who verified, the decision and when.
7. **Reports.** `POST /api/assessments/:id/report` freezes the section scores and the follow-up table into a report (firm-private until shared, like any report), with the line that the percentages are indicative and not a certification.
8. **Trace.** `GET /api/projects/:id/trace` now starts at the assessment: assessment → finding → recommendation → action → evidence or review.

## Templates

Templates belong to the firm. Firm staff read them; clients never see a template, only the questions of an assessment the firm finalised and shared with them.

- **Authors.** The firm admin always can, and names which consultants may build and publish templates (`PUT/DELETE /api/template-authors/:userId`, audited). An author is an active consultant of the firm.
- **Versions.** A template has numbered versions. A draft is edited freely; a published version is never changed or deleted, by anyone, even directly in the database. To change a published template, `POST /api/assessment-templates/:id/draft` copies its latest version into a new draft (one draft at a time). Publishing needs every section to have a question. Assessments point at the version they were made with, so later edits never change them.
- **Duplicate.** `POST /api/assessment-templates/:id/duplicate` copies the template into a new template's first draft.
- **Archive.** `PATCH /api/assessment-templates/:id` with `archived: true` keeps it off new assessments; old assessments stay readable.
- **Questions.** Types: yes/no (with partly and not applicable), multiple choice (each option has its points), rating 1–4, and text (not scored). Each has a weight of 1–3 and an optional gap threshold. A question can apply only when an earlier scored question of the same version has one of given answers (one simple condition, no branching trees). A multiple-choice question whose options all score 0 only describes the client: it must be answered and can be a condition, but is never scored or a gap.

### Where a criterion comes from

Each question records its basis for most clients, the legal forms for which it is binding or regulator guidance instead, and its source with a locator (page, section, chapter or article). Bases:

| Basis | Meaning |
|---|---|
| `legal_requirement` | Binding on this client under a law or regulation that applies to its legal form |
| `regulator_guidance` | Issued by a regulator, not binding on this client |
| `good_practice` | A voluntary reference (IFC, OECD, or CMA rules used as a reference) |
| `firm_method` | The consulting firm's own criteria |
| `team_proposed` | The team's wording, with no outside source |

The basis is worked out **per assessment** from the client's legal form (`PUT /api/orgs/:id/legal-form`, firm admin only) and kept on each answer. An assessment cannot start until the legal form is recorded. Legal forms: sole proprietorship, LLC, closed and listed joint stock company, bank or finance company, capital market institution, non-profit, other. For example, the CMA Corporate Governance Regulations bind listed companies and SAMA's Key Principles of Governance bind banks and finance companies, so a board-independence question is a legal requirement for a listed company and good practice for a family LLC. Changing a client's legal form later does not change assessments already made.

A question's own basis can only be good practice, the firm's method or the team's proposal. Legal requirement and regulator guidance come only from its legal forms, so no question can be made "legal" for every client. A good-practice question, or one with legal forms, needs a named source and a locator, enforced by the database. `citation_verified` stays false until someone checks the citation against the source's current text, so screens and reports can show "source to verify".

## The starter template

`POST /api/assessment-templates/starter` installs "Family business governance: starter assessment" as a draft the firm can edit, in Arabic and English (`src/services/assessment-starter.ts`). It opens with an unscored company profile question, "Is the company family-owned or family-controlled?" (0.1); the family questions (2.1 to 2.5 and 5.2) apply only when the answer is yes, so non-family clients skip them. Then 28 questions in eight areas: governance structure and accountability; family ownership and decision-making; board or management responsibilities; delegation of authority; succession planning; policies and operating procedures; documentation and transparency; monitoring and implementation of recommendations.

These are **the team's proposed questions**, from the research thread's source map (2026-10-21). They are not an official assessment of CMA, IFC, OECD or any firm. Each question names the source it is informed by:

- **Deep Dive methodology session (2026)**, by page: the firm's method (structure, delegation matrix, policies and procedures, strategy and KPIs, follow-up after delivery).
- **IFC Family Business Governance Handbook (2nd ed., 2008)**, by section.
- **G20/OECD Principles of Corporate Governance (2023)**, by principle (V.D.7, IV.A.7, II.A.3, IV.A.1, II.F.1, V.D.4, V.E).
- **CMA Corporate Governance Regulations** (listed companies, as amended 2023), by article: 16, 23(b), 28(14), 30(b), 35, 40, 41, 41(6).
- **SAMA Key Principles of Governance in Financial Institutions (2021)**, by article: 7, 22, 39, 43, 43(f), 87(a). Binding for banks and finance companies; cited as good practice for others.
- **Ministry of Commerce governance regulations for non-listed joint stock companies (2018)**: guidance. Chapter 6 on conflicts of interest; on board meetings only "periodic meetings", with no count.
- **Companies Law (2022), Art. 11(2)**: a family charter binds once adopted, provided it does not contradict the Law or the articles; it is not required.
- **MoC Guiding Charter for Saudi Family Businesses (الميثاق الاسترشادي للشركات العائلية, May 2018)**: regulator guidance, non-binding unless the family adopts a charter under the Companies Law. Cited by chapter on 2.1 to 2.4. Press coverage calls it "the proposed draft", so the final text may differ. These questions stay good practice.

For a non-listed company nothing in the starter template is a legal requirement. For a listed company, board independence (3.2, CMA Art. 16), board meetings and minutes (3.4, Art. 30(b) and 35), the conflict-of-interest policy (6.4, Art. 41) and related-party dealings (7.4, Arts. 40, 41(6), 28(14)) are legal requirements. For a bank or finance company, the same four plus succession (5.1, SAMA Arts. 39 and 87(a)) are, under SAMA's principles. For a closed joint stock company, 3.4 and 6.4 are regulator guidance (MoC 2018). Capital market institutions get no legal labels until it is checked which rules bind them. On 3.2 the guidance says that "yes" does not confirm the Art. 16 thresholds. On 2.1 the guidance says a gap can be answered with a recommendation to draft a family charter, which the firm can deliver.

Citations were checked against full copies of the texts on 2026-10-22 (research source map, section 6). Two stay marked "source to verify": 2.3 (the MoC family charter chapter; the charter is known only as a reported draft) and 3.4 (the MoC 2018 rules give no confirmed meeting count).

## Scoring

Fixed and visible (`app_assessment_results`, `app_assessment_scores`):

- Yes/no: yes 2, partly 1, no 0. Rating 1–4: 0–3. Multiple choice: the option's points. All times the weight.
- Left out: text questions, "not applicable", unanswered questions, and questions whose condition is not met.
- Section % = points earned ÷ points possible. The total is the same over all sections. No hidden weights.
- A gap is an applicable scored answer at or below the threshold (default: half the maximum, rounded down, so "partly" and "no", or a rating of 1–2).

Percentages are indicative and firm-only. A client reading a shared assessment, the project's assessment list or a comparison sees the answers, comments and confirmed findings, but no points, percentages or totals (the service blanks them for any non-firm caller, and the database refuses `app_assessment_scores` to a client and returns no points or suggested gaps from `app_assessment_results` or `app_assessment_compare`). The API also leaves out each question's weight, gap threshold and option points for a client, so the scores can't be rebuilt from the answers. The database itself still lets a client's admins and managers read the template questions of an assessment shared with them, scoring fields included; nothing in the app reads them that way, and a column-level split is left for later.

## Retake and compare

A client is assessed again by retaking a final assessment (`POST /api/assessments/:id/retake`). The new assessment is on the same template's latest published version.

`GET /api/assessments/compare?a=&b=` compares two assessments of the same client on the same template (`app_assessment_compare`). It runs with the caller's rights, so a client can compare only assessments shared with it.

- Questions are matched by their reference ("2.1"), or by their wording when they have none, because a template can change between versions. A question only in the later assessment is shown as added, and one only in the earlier assessment as dropped.
- A reference names one question in a version (enforced). Questions without one that share the same wording are matched in order. A question reworded under the same reference is flagged (`wordingChanged`), so the two answers aren't read as like for like.
- Each section shows points earned and possible in both assessments, from the same per-question points as the assessment itself, plus the questions whose answer changed.
- Questions the later assessment hasn't answered yet are counted, not listed as changes.

## Screens

- **Assessment templates** (sidebar): the template list; install the starter template. A template page shows one version at a time (`?v=`), the open draft by default. Authors add and edit sections and questions, set each question's legal form labels, source, locator and verified flag, and publish.
- **Project, Assessments tab**: the project's assessments with totals (firm only); start one from a published template.
- **Assessment page**: each question with its source labels per legal form and its basis. Answers save as they are given, with a client-visible comment and a firm-only note. After finalising, each gap is shown as a suggested gap and a consultant confirms it as a finding. The page also shares the assessment, retakes it and opens the comparison.
- **Compare**: per-section points before and after (firm only) and each changed answer, with reworded questions flagged.
- The client's legal form is set on the client page.

## Who sees what

| | Firm admin | Consultant on the project | Other consultants | Client admin, manager on the project | Action owner |
|---|---|---|---|---|---|
| Templates | read, author | read; author if named | read; author if named | no | no |
| Draft assessment | conduct | conduct | no | no | no |
| Final assessment | conduct, share | conduct, share | no | read once shared | no |

The answer's comment is shown to the client when the assessment is shared. The firm's own notes go in `PUT /api/assessment-answers/:id/note` (table `assessment_notes`), which only firm staff on the project can read. Evidence on an answer is a file of the same project that the firm can see (not client-private), uploaded and scanned the usual way. The client sees evidence rows only for files shared with it.

Minimal-records clients: written answers, comments and firm notes are blanked with the rest after handover (docs/engagement.md).

## Endpoints

| Method and path | What |
|---|---|
| `GET/POST /api/assessment-templates` | list (`?archived=1`), create |
| `POST /api/assessment-templates/starter` | install the starter template (`publish: true` to publish) |
| `PATCH /api/assessment-templates/:id` | rename, describe, archive |
| `POST /api/assessment-templates/:id/draft` | new draft from the latest published version |
| `POST /api/assessment-templates/:id/duplicate` | copy as a new template |
| `GET/DELETE /api/template-versions/:id` | read a version; discard a draft |
| `POST /api/template-versions/:id/publish` | publish |
| `POST /api/template-versions/:id/sections`, `/questions` | add content to a draft |
| `PATCH/DELETE /api/template-sections/:id`, `/api/template-questions/:id` | edit a draft |
| `GET /api/template-authors`, `PUT/DELETE /api/template-authors/:userId` | authors |
| `PUT /api/orgs/:id/legal-form` | a client's legal form |
| `GET/POST /api/projects/:id/assessments` | a project's assessments with totals; start one |
| `GET/PATCH /api/assessments/:id` | questions, bases, answers, evidence, scores, gaps; rename |
| `POST /api/assessments/:id/finalise` | finalise |
| `PUT /api/assessments/:id/share` | share with the client, or stop |
| `GET /api/assessments/:id/follow-up` | each confirmed gap and the work on it |
| `POST /api/assessments/:id/report` | a report from a final assessment |
| `POST /api/assessments/:id/retake` | assess again on the same template |
| `GET /api/assessments/compare?a=&b=` | per-section points and changed answers between two assessments |
| `PATCH /api/assessment-answers/:id` | answer, comment (shown to the client when shared) |
| `PUT /api/assessment-answers/:id/note` | the firm's own note, never shown to the client |
| `PUT/DELETE /api/assessment-answers/:id/evidence/:documentId` | attach or remove a file |
| `POST /api/assessment-answers/:id/finding` | confirm a gap as a finding |

## Open questions for the sponsor

- Whether their Deep Dive baseline items should be the first section, as their own method.

Answered 2026-10-21: legal forms are not limited (family and financial companies are served); family charters may be delivered; scores stay firm-only.
