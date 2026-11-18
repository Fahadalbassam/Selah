# Importing and exporting a plan

Consultants often already have their findings, recommendations and actions in a spreadsheet or a Word report. Selah reads those files into a project, and gives the plan, the actions list and reports back as Excel or PDF.

## Import (firm staff who can write the plan)

The project's Recommendations tab has **Import**, which opens `/projects/:id/import`. Three steps on one page, and nothing is created until the last one:

1. **File.** An Excel (`.xlsx`) or Word (`.docx`) file, up to 20 MB. It goes through the same checks as every upload (`lib/upload-rules.ts`: extension, declared type and magic bytes agree) and the ClamAV scan before anything reads it (`POST /api/projects/:id/import`). The file is read in memory and **not stored**.
2. **Columns.** Selah picks the source (a worksheet, a Word table, or the Word headings) that looks most like a plan, finds the heading row (a title row above it is skipped), and matches the headings to fields in Arabic or English (`suggestMapping`). The person can change the source, the heading row and any column, or choose "Don't import".
3. **Review.** Every row with what it will create and anything to look at. The person can edit a row or leave it out. Rows with an error block the import until fixed or left out.

Confirming (`POST /api/projects/:id/import/confirm`) sends the reviewed rows. The server builds its own context from the database, runs **the same checks** again (`lib/plan-import.ts`, shared by the screen and the server), and refuses the whole import if any row has an error. Otherwise it creates everything in one transaction through the plan services (`createFinding`, `createRecommendation`, `createAction`), so every rule of the plan dialogs and the database applies unchanged.

### What a file can hold

| Field | Notes |
|---|---|
| Finding, Finding details | Optional. |
| Recommendation | Needed on every row with an action. |
| Rationale, Target outcome, Priority, Recommendation due date, Required evidence | Taken from the recommendation's first row; a later row that says something different gets a warning. |
| Action, Action details | One action per row. |
| Owner | A person on the project team, by name or email (a unique partial name is matched with a warning). For clients the firm manages: the person's name, or job title with minimal records. |
| Department | Matched by Arabic or English name; ignored where departments are off. |
| Due date | ISO, day/month/year, month names (Arabic or English), an Excel date, Arabic-Indic digits, or Umm al-Qura Hijri (marked هـ, or a year before 1600). |
| Evidence list | One item per line, or separated by `;` / `؛`. At most 50 items. |

Status is never imported: an action starts as a draft, or as Assigned when the person ticks "send actions that have an owner and a due date" (and may release actions). Imported findings and recommendations get the visibility the person chose (shared, or firm only) and the source "consultant".

Word documents: each table is a source laid out like a sheet. The **headings** are a source too: Heading 1 is a finding and Heading 2 a recommendation (or, with one level or by choice, every heading is a recommendation); bullet or numbered items under a recommendation are its actions; other paragraphs are the details of what came before. Style names are read from `styles.xml`, so headings work in Arabic Word too. Tracked deletions are left out; content controls are read.

Merged or blank finding and recommendation cells take the value from the row above, and the review says so.

### Doing it twice

A finding or recommendation whose title (folded for Arabic spelling variants) is already in the project is reused, not duplicated. An action already under that recommendation starts **left out**, so importing the same file again adds nothing.

### Safety

- Office files are zip archives: `lib/office/zip.ts` refuses more than 2,000 entries, any entry over 40 MB inflated, 80 MB in total, or a compression ratio over 200 (zip bombs), before inflating.
- XML with a document type declaration is refused (entity expansion and external entities).
- Formulas are never evaluated; a cell gives its saved value.
- At most 2,000 rows and 60 columns are read per sheet or table, and 500 rows imported at once.
- The confirm carries a signed note of the scanned file (HMAC with the server secret, tied to the person and project, valid 24 hours), so the audit record names the file's hash and a review can't be replayed into another project.
- Audit: `plan.import.read` (hash, size, scan) and `plan.import` (counts, visibility). Each action's `created` activity event carries `{ "import": true }`.

## Export

| Where | What | Who |
|---|---|---|
| Recommendations tab, **Excel** | The plan, one row per action (or per recommendation or finding with none), in the same columns as the import, plus status. Firm staff also get a "who sees it" column. | Anyone who reads the project |
| Import page, **Excel template** | The empty plan, with a guide sheet that explains each column | Those who can import |
| Actions page, **Excel** | The actions list as on the page (an action owner gets their own) | Everyone |
| Report page, **PDF** | The frozen numbers and notes, then the actions as they stand on the export day (labelled as such) | Anyone who can read the report |

Exports read through the same services as the screens (`getProject`, `listActions`, `getReport`), under row-level security and `authorize()`, so a file holds exactly what the person could already open: firm-only findings and recommendations never reach a client's file, and an unshared report is not found for the client. For a manager with department limits, a finding answered only by another department's recommendation says "Answered in another department" in the recommendation column, as the plan page does, without naming it (D8); the firm reads every recommendation, so its own exports never carry that line. Files are in the reader's language (Arabic sheets are right to left). Every export is audited (`plan.export`, `actions.export`, `report.export`).

The Excel writer (`lib/office/xlsx-write.ts`) writes every text cell as an inline string, so text a person typed (`=HYPERLINK(...)`) can never become a formula when the file is opened. Dates are real Excel dates. A plan exported from Selah imports back as it is.

### PDF rendering

PDFs are drawn by Chromium in its own container ([Gotenberg](https://gotenberg.dev), `pdf` in `docker-compose.yml`), apart from the web app, as with the virus scanner:

- JavaScript off, downloads and webhooks off, private and public addresses denied.
- On an internal Docker network with no route out, and no published port; only the web app reaches it.
- It receives only HTML built by `lib/report-html.ts`, which escapes every value and contains no script, plus the IBM Plex Sans Arabic font files. The text in the PDF is real text (searchable and copyable in Arabic).
- If it is down, the PDF export answers 503 and the button says the service is unavailable. Without `PDF_SERVICE_URL` the PDF button is hidden.

Tests: `tests/office.test.ts`, `tests/plan-import.test.ts`, `tests/report-html.test.ts`, and `e2e/import-export.e2e.ts` in the Docker suite.

## Importing an organisation structure (org chart, part 4)

The firm's Structure tab (`/clients/:id/structure`) has **Import / استيراد** for the people who edit the client's draft (the firm admin, the client's lead and deputy, consultants staffed and not observing on one of its open projects: `org_chart.edit`, `app_org_chart_editor()`). It opens `/clients/:id/structure/import`; anyone else, and another client, gets Not found. Until part 3 gives the Structure tab an empty state for a client with nothing yet, the page is reached by its address. Two steps, one main action each, and nothing is saved until the second:

1. **Bring it in**, one of three ways:
   - **Excel.** **Download the template** (`GET /api/clients/:id/structure/import/template`): one sheet with a column per field (each heading in the reader's language, then the other, on two lines) and a guide sheet (what to write in each column, an example, and the rules). With a draft, **Download your draft in this template** (`GET /api/clients/:id/structure/workbook?version=draft`) gives the same template filled in, so the draft can be changed in Excel and uploaded again. Then **Upload and check** (`POST /api/clients/:id/structure/import`).
   - **Word.** An outline: Heading 1, 2 and 3 are units at levels 1, 2 and 3, each under the heading above it; bulleted or numbered lines under a heading are positions in that unit; other paragraphs are left out. A heading numbered like a code ("2.4 Finance") keeps the code. Same upload.
   - **Pasted text.** "Paste a list or description and let the assistant draft it" (`POST /api/clients/:id/structure/import/draft`), shown only while the AI service runs the local model and the assistant is on for the reader at this client. The screen asks for titles only: people's names are left out of the text and added later; the draft never handles people ([assistant.md](assistant.md), "Drafting a structure from pasted text").
2. **Check the rows.** Every row, checked as it is edited by the same code the server runs again (`lib/org-chart-import.ts`, `checkOrgImport`), with a pencil to fix it in place and "Skip this row". When the draft already holds something, the page asks plainly: **Replace the draft** (it will hold only these rows; a unit or position with the same code is updated in place and keeps its people, the rest of the draft is removed) or **Add to the draft** (everything stays; a row may use a unit or position of the draft by its code). Then **Save to draft** (`POST /api/clients/:id/structure/import/confirm`), after a confirmation that says what is added and removed and that nothing is published.

Uploads go through the same checks and ClamAV scan as every upload before anything reads them, and are read in memory and **not stored**. Saving rebuilds the context from the database, checks every row again, refuses the whole save if any row has an error, and writes in one transaction through the org chart's own services (`startChart`, `addUnit`, `updateUnit`, `moveUnit`, `addPosition`, `updatePosition`, `movePosition`, `setReportsTo`, `changeHolder`, `deletePosition`, `deleteUnit`), so every rule of the draft and the database applies unchanged. **Nothing is published here**: publishing is the firm's own step (part 5), and the client sees no change until then.

### The columns

| Column | Notes |
|---|---|
| Unit code, Parent unit code | A code such as 2.4 (Latin letters, digits, dots, dashes; Arabic-Indic digits are read as digits). Every row of a unit carries its code; a position row with no unit columns at all takes the unit of the row above. The parent must be a unit of these rows (adding: or of the draft). |
| Unit name (Arabic), Unit name (English) | At least one. The first row that describes a unit defines it; a later row that says something different about the same code is a duplicate code. |
| Unit kind | Board, committee, executive, sector, department, section, unit or office, in Arabic or English. Left empty, it is read from the unit's name ("الإدارة المالية" is a department), else "unit", and the row says so. |
| Level | 1 to 12; left empty, one below its parent (1 at the top). A unit is expected to sit lower than its parent; one that does not (the firm may set a level by hand on the Structure tab) is saved as written, with a warning to check it. |
| Advisory (dotted line) | Yes for a unit drawn beside its parent on a dotted line. |
| Position code | Unique in the rows (adding: also not already in the draft). |
| Position title (Arabic), Position title (English) | At least one. |
| Reports to (position code) | A position's code, never its title, because titles repeat. No loops, even through others (the draft's own lines count when adding). |
| Head of unit | Yes for the one position that heads its unit. |
| Holder (e-mail or name) | **Who is planned for the position, never a holding**: people are placed only on the live structure, so the column becomes the position's planned holders (`org_chart_planned_holders`, firm only), and publishing places them (part 5). The e-mail of someone at the client with a Selah account becomes that person; any other text is a typed name (2 to 200 characters), masked before a hosted model like a typed holder's. Several are separated by `;` or `؛`; more than the planned number is saved, with a warning. An e-mail that is nobody's at this client is an error. Never stored at a client with minimal records (the row says so). In a position kept by its code, the row's list replaces its plan, and who holds it today does not change. The draft's export writes its plans in this column. |
| Specialties | Separated by `;` or `؛`; at most 30, each up to 100 characters. |
| Vacant | Yes means no holder (naming one as well is an error). |
| Planned people | 1 to 999; empty is 1. |

Codes Selah gives (a row with a name but no code, a Word heading, the assistant's rows) are the next free code under the parent ("2" gives "2.1"), avoiding the draft's, and the row says so. The checks are about the data only: an unknown parent, unit or "reports to" code, a loop, a duplicate code, a missing title or name, a holder e-mail that is not a person of this client, a value that cannot be read, two heads in one unit. A level that is not below its parent's and more people than planned are warnings: the app allows both, so a file of the app's own data always comes back, and the row says to check it. **Selah never designs or judges a structure**: no suggestion of units, no comment on spans or layers, no "good" or "bad" (`tests/org-chart-import.test.ts` checks that a wide unit and a twelve-level chain get no note).

### The same template out and back

The filled template is the client's structure as the reader's Structure tab shows it (`orgChartWorkbook()`, through `getStructure()`): the draft for the firm, or a published version; names only where the database sends them; a person with an account written as their e-mail so they come back as the same person. For the draft, the holder column is its plan (vacant only where nobody is planned and nobody holds the position today). Exported and brought back with **Replace**, the draft is the same: the same units, positions (the same rows, so holdings and history follow them) and people (`tests/org-chart-import.test.ts` and `tests/db/org-chart-import.test.ts`, "round-trips"). Audit: `org_chart.import_read` (source, hash, size, scan, rows), `org_chart.import_draft`, `org_chart.import` (source, hash, mode and counts), `org_chart.workbook`, `org_chart.plan` (a position's plan replaced: how many accounts and typed names, never the names), and each service's own `org_chart.unit_*` and `org_chart.position_*` entries.
