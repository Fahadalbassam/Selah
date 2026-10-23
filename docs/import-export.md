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

Exports read through the same services as the screens (`getProject`, `listActions`, `getReport`), under row-level security and `authorize()`, so a file holds exactly what the person could already open: firm-only findings and recommendations never reach a client's file, and an unshared report is not found for the client. Files are in the reader's language (Arabic sheets are right to left). Every export is audited (`plan.export`, `actions.export`, `report.export`).

The Excel writer (`lib/office/xlsx-write.ts`) writes every text cell as an inline string, so text a person typed (`=HYPERLINK(...)`) can never become a formula when the file is opened. Dates are real Excel dates. A plan exported from Selah imports back as it is.

### PDF rendering

PDFs are drawn by Chromium in its own container ([Gotenberg](https://gotenberg.dev), `pdf` in `docker-compose.yml`), apart from the web app, as with the virus scanner:

- JavaScript off, downloads and webhooks off, private and public addresses denied.
- On an internal Docker network with no route out, and no published port; only the web app reaches it.
- It receives only HTML built by `lib/report-html.ts`, which escapes every value and contains no script, plus the IBM Plex Sans Arabic font files. The text in the PDF is real text (searchable and copyable in Arabic).
- If it is down, the PDF export answers 503 and the button says the service is unavailable. Without `PDF_SERVICE_URL` the PDF button is hidden.

Tests: `tests/office.test.ts`, `tests/plan-import.test.ts`, `tests/report-html.test.ts`, and `e2e/import-export.e2e.ts` in the Docker suite.
