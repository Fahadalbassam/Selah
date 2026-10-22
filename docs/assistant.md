# Assistant sources

How the assistant finds text, keeps it in each person's rights, and shows where every line came from. Migrations 0040 (tables) and 0041 (rules); `src/jobs/index-documents.ts`, `src/services/assistant.ts`, `src/services/document-summaries.ts`; the AI service's `POST /v1/embed`, `/v1/answer` and `/v1/summarize`.

No model has been run for any of this: the tests use fake vectors and a fake summariser, and nothing runs on the server yet.

## The search index

One index (`ai_chunks`), built from each file's original text in whatever language it is written. The embedding model is multilingual, so an Arabic question finds English text and the other way round; nothing is translated before indexing.

`npm run job:index-documents` runs as the schema owner. It takes files that have the AI flag on, are scanned clean (or skipped) and not archived, and are still `pending`:

- Text files are read; a form feed starts a page. Passages are at most about 1,200 characters, split at blank lines, then lines, and never across pages. Each passage keeps its page, and copies the file's project, label, department and (for a private file) its owner.
- A file with no readable text (an image, a scan without a text layer) is marked **not searchable**, so the screen can say so instead of the file quietly missing from answers.
- PDF and Office files wait, still pending, for a text extractor in the AI service.

Only the job sets a file's text status. Turning the AI flag on, a change of visibility and refiling to another department drop the file's passages and set it back to pending, so it is indexed again.

## Filtering

Rights are applied before retrieval, never by a model:

1. `retrievalScope()` (the same `authorize()` as the rest of the app) gives the project, client and labels. It goes inside the vector query's WHERE clause.
2. The query runs under row-level security. A file's passages are read only by people who can open the file, while it is open to the assistant and not archived, whatever the passage's own label says.
3. Only what survives goes to the model.

`tests/db/ai-sources.test.ts` checks this for every test user in every project, with their real scope and with a forged one asking for every label: every passage that comes back is from a file that person can open.

## Answers

Each chat message is stored once with its language (`ar` or `en`). An answer is shown in the other language through the translation cache (docs/translations.md), and only its owner can read either. An answer's citations name the file, its version and the page.

## File summaries

`POST /api/documents/:id/summary` with `lang`. Firm staff only, like the assistant.

- Made once per file version (its SHA-256) and language, from the file's indexed pages, then kept for everyone who can open the file.
- Every line cites the pages it rests on. Lines citing pages the file doesn't have are dropped; a summary with no line left is refused.
- Read with the file's own rights. Deleted when the AI flag goes off, the visibility or department changes, the file is archived, or a new version is uploaded.
- At most 30 new summaries per person an hour (translations allow 200).
- A file that isn't indexed yet, or has no readable text, is refused.

## Meeting summary sources

Each line of a meeting summary can point at where it came from (`meeting_summary_sources`):

- a passage of the meeting's transcript (character range), seen by the firm only, as the transcript is;
- or a page of a file in the same project, seen by whoever can open the file. The file's version is stamped.

Only the firm adds them. Rewriting the summary's text drops its pointers, since the lines have moved.

## Not done yet

- No screens: the assistant isn't in use, so summaries and source links have no UI.
- PDF and Office text extraction.
- Nothing writes meeting summary sources automatically yet; that comes with AI meeting summaries.
