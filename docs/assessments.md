# Governance assessments

Reusable assessment templates, assessments of client projects, and the path from a gap to verified work. Migrations 0028 (tables) and 0029 (rules). Every rule below is enforced in Postgres; `src/services/assessments.ts` gives clear errors. The scope is the controlled MVP agreed on 2026-10-21 (Option B, template builder): no branching logic beyond one simple condition, no certification, no weighted engine beyond a visible 1–3 weight, and no drag-and-drop designer.

**What Selah does not claim.** An assessment measures a client against the template's criteria. It is not a certification of legal compliance, and Selah never says "compliant" or "non-compliant". A gap is "a gap against good practice", "against the firm's method" or, only where the criterion binds this client, "against a legal requirement".

## The lifecycle

Assessment → gaps → findings → recommendations → actions → progress and evidence → verification → reports.

1. **Template.** The firm builds a template (or installs the starter one), then publishes it.
2. **Assessment.** A consultant on a client project starts an assessment against the template's latest published version. Every question gets its row, with its basis worked out for this client (below).
3. **Answers.** Consultants answer, comment and attach files while it is a draft. Finalising needs every question that applies answered (or marked not applicable). After that nothing changes; a reassessment is a new assessment, so the two can be compared.
4. **Gaps.** An answer at or below the question's threshold is a gap. Selah only suggests it: a consultant confirms each gap as a finding (`POST /api/assessment-answers/:id/finding`), at most once per answer.
5. **From here, the existing system.** The finding is an ordinary finding. Recommendations answer it (`POST /api/projects/:id/recommendations` with `findingId`), actions carry them out, and progress, evidence, reviews, reminders and metrics work exactly as they do for a recommendation made directly. There is one recommendation system, and direct recommendations need no assessment.
6. **Follow-up.** `GET /api/assessments/:id/follow-up` lists each confirmed gap with its recommendations and released actions: reported (awaiting review), evidenced (evidence submitted) and verified (accepted by a consultant's review), counted apart and never added together. The review records who verified, the decision and when.
7. **Reports.** `POST /api/assessments/:id/report` freezes the section scores and the follow-up table into a report (firm-private until shared, like any report), with the line that the percentages are indicative and not a certification.
8. **Trace.** `GET /api/projects/:id/trace` now starts at the assessment: assessment → finding → recommendation → action → evidence or review.

## Templates

Templates belong to the firm. Firm staff read them; clients never see a template, only the questions of an assessment the firm finalised and shared with them.

- **Authors.** The firm admin always can, and names which consultants may build and publish templates (`PUT/DELETE /api/template-authors/:userId`, audited). An author is an active consultant of the firm.
- **Versions.** A template has numbered versions. A draft is edited freely; a published version is never changed or deleted, by anyone, even directly in the database. To change a published template, `POST /api/assessment-templates/:id/draft` copies its latest version into a new draft (one draft at a time). Publishing needs every section to have a question. Assessments point at the version they were made with, so later edits never change them.
- **Duplicate.** `POST /api/assessment-templates/:id/duplicate` copies the template into a new template's first draft.
- **Archive.** `PATCH /api/assessment-templates/:id` with `archived: true` keeps it off new assessments; old assessments stay readable.
- **Questions.** Types: yes/no (with partly and not applicable), multiple choice (each option has its points), rating 1–4, and text (not scored). Each has a weight of 1–3 and an optional gap threshold. A question can apply only when an earlier scored question of the same version has one of given answers (one simple condition, no branching trees).

### Where a criterion comes from

Each question records its basis for most clients, the legal forms for which it is binding or regulator guidance instead, and its source with a locator (page, section, chapter or article). Bases:

| Basis | Meaning |
|---|---|
| `legal_requirement` | Binding on this client under a law or regulation that applies to its legal form |
| `regulator_guidance` | Issued by a regulator, not binding on this client |
| `good_practice` | A voluntary reference (IFC, OECD, or CMA rules used as a reference) |
| `firm_method` | The consulting firm's own criteria |
| `team_proposed` | The team's wording, with no outside source |

The basis is worked out **per assessment** from the client's legal form (`PUT /api/orgs/:id/legal-form`, firm admin only) and kept on each answer. An assessment cannot start until the legal form is recorded. For example, the CMA Corporate Governance Regulations bind listed companies, so a board-independence question is a legal requirement for a listed company and good practice for a family LLC. Changing a client's legal form later does not change assessments already made. Selah refuses a good-practice, guidance or legal basis without a named source and a locator.

## The starter template

`POST /api/assessment-templates/starter` installs "Family business governance: starter assessment" as a draft the firm can edit, in Arabic and English (`src/services/assessment-starter.ts`). It has 28 questions in eight areas: governance structure and accountability; family ownership and decision-making; board or management responsibilities; delegation of authority; succession planning; policies and operating procedures; documentation and transparency; monitoring and implementation of recommendations.

These are **the team's proposed questions**, from the research thread's source map (2026-10-21). They are not an official assessment of CMA, IFC, OECD or any firm. Each question names the source it is informed by:

- **Deep Dive methodology session (2026)**, by page: the firm's method (structure, delegation matrix, policies and procedures, strategy and KPIs, follow-up after delivery).
- **IFC Family Business Governance Handbook (2nd ed., 2008)**, by section.
- **G20/OECD Principles of Corporate Governance (2023)**, by chapter.
- **CMA Corporate Governance Regulations** (listed companies, as amended 2023). Only Art. 16, 41 and 43 are confirmed in the current numbering; everything else is cited by chapter until checked against the official text.
- **Ministry of Commerce governance regulations for non-listed joint stock companies (2018)**: guidance, to verify.
- **Companies Law (2022)**: a family charter binds once adopted but is not required. The article (reported as Art. 11) is to verify.

For a non-listed family company nothing in the starter template is a legal requirement. Three questions (board independence, conflict-of-interest policy, related-party dealings) become legal requirements for a listed company, and the board-meetings question is regulator guidance for a non-listed joint stock company.

## Scoring

Fixed and visible (`app_assessment_results`, `app_assessment_scores`):

- Yes/no: yes 2, partly 1, no 0. Rating 1–4: 0–3. Multiple choice: the option's points. All times the weight.
- Left out: text questions, "not applicable", unanswered questions, and questions whose condition is not met.
- Section % = points earned ÷ points possible. The total is the same over all sections. No hidden weights.
- A gap is an applicable scored answer at or below the threshold (default: half the maximum, rounded down, so "partly" and "no", or a rating of 1–2).

Percentages are indicative. They are shown to firm staff, and to the client only when the firm shares the assessment.

## Who sees what

| | Firm admin | Consultant on the project | Other consultants | Client admin, manager on the project | Action owner |
|---|---|---|---|---|---|
| Templates | read, author | read; author if named | read; author if named | no | no |
| Draft assessment | conduct | conduct | no | no | no |
| Final assessment | conduct, share | conduct, share | no | read once shared | no |

The answer's comment is shown to the client when the assessment is shared; write firm-only notes on the actions instead. Evidence on an answer is a file of the same project that the firm can see (not client-private), uploaded and scanned the usual way.

Minimal-records clients: written answers and comments are blanked with the rest after handover (docs/engagement.md).

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
| `PATCH /api/assessment-answers/:id` | answer, comment |
| `PUT/DELETE /api/assessment-answers/:id/evidence/:documentId` | attach or remove a file |
| `POST /api/assessment-answers/:id/finding` | confirm a gap as a finding |

## Open questions for the sponsor

- Whether their Deep Dive baseline items should be the first section, as their own method.
- Which client legal forms they serve most (this decides the legal labels).
- Whether a family charter is something they deliver or only recommend.
- Whether a score may be shown to clients, or kept firm-only at first and labelled indicative.
