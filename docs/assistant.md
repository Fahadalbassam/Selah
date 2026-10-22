# Assistant sources

How the assistant finds text, keeps it in each person's rights, and shows where every line came from; how chats are labelled, shown in two languages and deleted; and how names are masked before a hosted model sees them. Migrations 0040 (tables), 0041 (rules), 0046 and 0047 (chats, retention, masking); `src/jobs/index-documents.ts`, `src/services/assistant.ts`, `src/services/masking.ts`, `src/services/document-summaries.ts`; the AI service's `POST /v1/embed`, `/v1/answer` and `/v1/summarize`. The design and its reasons: https://claude.ai/artifact/FTRTXVTCLqgRjgwbCsCVDW.

No model has been run for any of this: the tests use fake vectors and a fake summariser, and nothing runs on the server yet.

## The search index

One index (`ai_chunks`), built from each file's original text in whatever language it is written. The embedding model is multilingual, so an Arabic question finds English text and the other way round; nothing is translated before indexing.

`npm run job:index-documents` runs as the schema owner. It takes files that have the AI flag on, are scanned clean (or skipped) and not archived, and are still `pending`:

- Text files are read; a form feed starts a page. Passages are at most about 1,200 characters, split at blank lines, then lines, and never across pages. Each passage keeps its page, and copies the file's project, label, department and (for a private file) its owner.
- A file with no readable text (an image, a scan without a text layer) is marked **not searchable**, so the screen can say so instead of the file quietly missing from answers.
- PDF and Office files wait, still pending, for a text extractor in the AI service.

Only the job sets a file's text status. Turning the AI flag on, a change of visibility and refiling to another department drop the file's passages and set it back to pending, so it is indexed again.

## Searching

Hybrid search, in Postgres only. No graph database and no graph RAG: Selah's links (finding → recommendation → actions → evidence → review) are foreign keys, few and always the same, so a SQL join walks them under the same row-level security as everything else.

1. **By meaning:** the 20 nearest passages to the question's vector (`ai_chunks.embedding`, HNSW).
2. **By words:** the 20 best keyword matches (`ai_chunks.tsv`, GIN, the `simple` configuration so Arabic words are kept as written). The question becomes an OR of its distinctive words (`keywordQuery()`), letters and digits only, so nothing typed can change the query's syntax. This finds exact terms the vectors blur: an article number, a policy code, a name.
3. **Merged** by reciprocal rank fusion (`fuse()`), keeping 8. Passages of the chat's case come first.
4. **Linked records** (`linkedRecords()`): the chat's case, then the recommendations (through their findings' source file) and actions (through their evidence) behind the files found. At most 3, each a few lines: status, due date, last review, last progress update. They go to the model as passages like the others and can be cited (a citation with no `chunkId`).

Both searches carry the full permission filter in their `WHERE`; the linked records are read under row-level security.

## Filtering

Rights are applied before retrieval, never by a model:

1. `retrievalScope()` (the same `authorize()` as the rest of the app) gives the project, client and labels. It goes inside the vector query's WHERE clause.
2. The query runs under row-level security. A file's passages are read only by people who can open the file, while it is open to the assistant and not archived, whatever the passage's own label says.
3. Only what survives goes to the model.

`tests/db/ai-sources.test.ts` checks this for every test user in every project, with their real scope and with a forged one asking for every label: every passage that comes back is from a file that person can open.

## Answers

Each chat message is stored once with its language (`ar` or `en`). Messages from before the column were labelled from their script when it was added. An answer is shown in the other language through the translation cache (docs/translations.md), and only its owner can read either. An answer's citations name the file, its version and the page, or the record.

A follow-up gets the chat's last 8 messages as context (`history`). They are never sources: the model is told not to cite them, and every turn searches again under the person's rights as they are now. Messages can't be edited by anyone (`UPDATE` is revoked).

## Chats

Every chat belongs to one person and one project (`ai_conversations.project_id`), so one chat never mixes two clients. Picking another project starts another chat.

- **Title:** the first question on one line, cut at 60 characters, with no model call. The owner can rename it.
- **Case** (optional): the recommendation, action, finding, meeting or file the chat is about. The database checks it is a record of the same project that the person can see. "Ask the assistant" on an action, a meeting, a recommendation or a file starts a chat already linked to it (`/assistant?project=…&case=action:…`). Deleting the record unlinks the chat; the chat stays in its project.
- **Who reads it:** only its owner, and only while they can still see the project. A consultant taken off a client loses the chat and its messages at once (migration 0047 closed a gap: the messages used to stay readable by id). Staffed again, they get them back, until retention deletes them.
- **Sources shown again:** opening an old chat checks each citation again. A source the person can no longer open shows as "Source no longer available to you", without its title; a file with a newer version says so.
- **API:** `GET /api/assistant/conversations[?archived=1]`, `GET /api/assistant/conversations/:id?lang=`, `PATCH` (title, keep, archived), `DELETE`. `POST /api/assistant/query` takes `caseType` and `caseId` when it starts a chat.

## Two languages in one chat

The screen's own words change language at once, with no model call. A new answer is written straight in the screen's language. Only answers written before a switch need translating:

- An answer in the screen's language is shown as it is.
- One with a kept translation (`content_translations`, keyed by the answer's hash) is shown translated at once; `GET …/conversations/:id?lang=` returns it with no model call.
- The latest answer translates by itself (one call).
- Older ones fold into a one-line stub ("Answer in Arabic · translate") and translate when clicked. Then they are kept.
- Translations are labelled "Machine translated", with "Show original". The person's own questions stay as they wrote them.

So a switch costs one model call, not one per message.

## Retention

Chats quote client files, so they are kept only while needed (PDPL: keep personal data only as long as its purpose needs it). Text is small, so this is about privacy, not disk space. `npm run job:purge-chats` runs nightly as the schema owner (`app_purge_chats`):

- **Archive** after `chat_archive_days` (30) without a message, unless the owner keeps the chat. An archived chat is hidden from the list, opens read-only and comes back with a new message.
- **Delete** at the earlier of `chat_after_close_days` (90) after the project closes and `chat_idle_delete_days` (180) after the last message. "Keep" never stops this. Messages and their translations go with the chat; the audit log records the deletion (`assistant.chat_deleted`, reason `retention`), never what the chat said.
- The chat header shows the deletion date (`app_chat_delete_on`), and warns in the last 7 days. The owner can delete a chat at any time.
- Selah has no contract dates, so "the end of the engagement" is the project closing: the firm admin closes or reopens it from the project's handover card (`PATCH /api/projects/:id/state`), and the database sets `projects.closed_at`.

The firm should confirm the numbers with its own legal adviser before real client data is used.

## Masking names before a hosted model

When the model runs outside our server (`LLM_PROVIDER=openai_compat`, for example GPT-OSS on Ollama's cloud), the web app replaces known names with placeholders before anything leaves, and puts the names back in what comes back (`AI_MASKING=auto`, the default; `on` and `off` force it). People always see real names; only the model sees placeholders.

- **What is masked:** the project's client and the firm (name, Arabic name, alias), their people and the client's contacts (full names, and name parts of 4+ letters), the client's departments (`app_mask_terms`, for a project the caller can see), main Saudi cities, email addresses and phone numbers. Longest name first; Latin names as whole words; Arabic names also after a prefix such as و or ل, with short vowels ignored.
- **Where:** the question, every passage and record, the chat history, translations and file summaries. Embeddings are made locally and don't leave the server.
- **When:** at the moment of sending, from the current names, so a person or department added later is masked without re-indexing. The mapping lives only in that request.
- **Proven by** `tests/db/assistant-chats.test.ts`: no known name reaches the model's payload, and placeholders in the answer come back as the names.

Limits, to state plainly in the report:

- It reduces what leaves; it doesn't guarantee anonymity. A name that isn't in Selah (a person mentioned only inside a file) is not masked, and unusual details can still identify a client.
- Under PDPL, pseudonymised data can still be personal data. Sending it abroad still needs the firm's approval.
- The real fix is a model that runs on our server or is hosted in Saudi Arabia. The service already supports a local Ollama model; masking turns off by itself when it is used.

## File summaries

`POST /api/documents/:id/summary` with `lang`. Firm staff only, like the assistant. `GET /api/documents/:id/summary?lang=` returns the kept summary, if any, and the file's text status, without calling the model.

Screen: the project's Documents tab has a Summary button on each file available to the assistant (firm staff). It shows the kept summary in either language, each line with page links that open the file at that page; when there is none, a Summarise button makes it. A file whose text can't be read is marked "Text not readable".

- Made once per file version (its SHA-256) and language, from the file's indexed pages, then kept for everyone who can open the file.
- Every line cites the pages it rests on. Lines citing pages the file doesn't have are dropped; a summary with no line left is refused.
- Read with the file's own rights. Deleted when the AI flag goes off, the visibility or department changes, the file is archived, or a new version is uploaded.
- At most 30 new summaries per person an hour (translations allow 200).
- When the model fails on a file, or gives no line that cites it, that file and language aren't sent again for 10 minutes (per server process), since failed calls don't count towards the hourly limit.
- A file that isn't indexed yet, or has no readable text, is refused.

## Meeting summary sources

Each line of a meeting summary can point at where it came from (`meeting_summary_sources`):

- a passage of the meeting's transcript (character range), seen by the firm only, as the transcript is;
- or a page of a file in the same project, seen by whoever can open the file. The file's version is stamped.

Only the firm adds them. Rewriting the summary's text drops its pointers, since the lines have moved.

- `POST /api/meetings/:id/summary/sources` with `line` and either `kind: "transcript"` and `quote` (the passage copied from the transcript; the server finds its place) or `kind: "document"`, `documentId` and `page`.
- `DELETE /api/meeting-summary-sources/:id`.
- The meeting page lists each line's sources under the summary: a transcript passage opens its text (firm only), a file page opens the file at that page, marked when a newer version of the file has been uploaded since. Firm staff who run a held meeting link and remove them there.

## Not done yet

- PDF and Office text extraction.
- A name-spotting model for names that aren't in Selah's records.
- Saving an answer to the project as a note.
- Nothing writes meeting summary sources automatically yet; that comes with AI meeting summaries.
