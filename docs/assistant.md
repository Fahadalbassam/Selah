# Assistant sources

How the assistant finds text, keeps it in each person's rights, and shows where every line came from; how chats are labelled, shown in two languages and deleted; and how names are masked before a hosted model sees them. Rules in the AI sources, Assistant chats, Name variants and Record passages sections of `drizzle/0000_baseline.sql`; `src/jobs/index-documents.ts`, `src/services/assistant.ts`, `src/services/masking.ts`, `src/services/document-summaries.ts`; the AI service's `POST /v1/embed`, `/v1/answer` and `/v1/summarize`. The design and its reasons: https://claude.ai/artifact/FTRTXVTCLqgRjgwbCsCVDW.

No model has been run for any of this: the tests use fake vectors and a fake summariser, and nothing runs on the server yet.

## The search index

One index (`ai_chunks`), built from each file's original text in whatever language it is written. The embedding model is multilingual, so an Arabic question finds English text and the other way round; nothing is translated before indexing.

`npm run job:index-documents` runs as the schema owner. It takes files that have the AI flag on, are scanned clean (or skipped) and not archived, and are still `pending`:

- Files are read by page (`src/jobs/extract-text.ts`). Text files: a form feed starts a page. PDF: `pdftotext` (poppler, installed in the jobs image), fed on stdin with a time and size limit; Arabic set in presentation forms is folded back to ordinary letters, direction marks are dropped, and the lam-alef that poppler writes in reverse after the article ("اإلدارة") is put right. A plain reversed lam-alef ("خالل" for "خلال") can't be told from real text and stays; the multilingual embedding still finds the passage, and the cited page shows the real words. Word: the page marks Word saved when the file was last laid out, or explicit page breaks when there are none, with tables one row per line. PowerPoint: a slide is a page, in the order the presentation shows them (speaker notes are left out). Excel: a sheet is a page, starting with its name. Office files go through the same zip and XML readers as the plan import, with the same limits.
- Passages are at most about 1,200 characters, split at blank lines, then lines, and never across pages. Each passage keeps its page, and copies the file's project, label, department and (for a private file) its owner.
- A PDF page with fewer than 20 letters has no text layer: it is a scan. Its number goes in `ocr_pages` for text recognition later, and the rest of the file is indexed. A file with nothing but scans (and any image) is marked **needs text recognition** (`needs_ocr`), not "not searchable", so it can be picked up when recognition comes. The file panel lists the scanned pages.
- A file that can't be read (damaged, encrypted, a refused archive) is marked **not searchable**, so the screen can say so instead of the file quietly missing from answers. A file that can't be fetched from storage, or a PDF when `pdftotext` is missing, waits for the next run.

**Recommendations and actions** (baseline: Record passages) are indexed by the same job, one passage each: a recommendation's title, rationale, expected outcome and required evidence; an action's title, description and its recommendation's title. The passage takes its recommendation's label, and is read only by someone who can read the record itself (the `with_source` policy), so a client never finds a firm-only recommendation and a department's action stays in it. A change to that text, a change of label, or deleting the record drops the passage, and the next run writes it again; a save that changes nothing keeps it. One passage per record, even when two runs overlap.

Only the job sets a file's text status and its scanned pages. Turning the AI flag on, a change of visibility and refiling to another department drop the file's passages and set it back to pending, so it is indexed again.

## Searching

Hybrid search, in Postgres only. No graph database and no graph RAG: Selah's links (finding → recommendation → actions → evidence → review) are foreign keys, few and always the same, so a SQL join walks them under the same row-level security as everything else.

1. **By meaning:** the 20 nearest passages to the question's vector (`ai_chunks.embedding`, HNSW).
2. **By words:** the 20 best keyword matches (`ai_chunks.tsv`, GIN, the `simple` configuration so Arabic words are kept as written). The question becomes an OR of its distinctive words (`keywordQuery()`), letters and digits only, so nothing typed can change the query's syntax. This finds exact terms the vectors blur: an article number, a policy code, a name.
3. **Merged** by reciprocal rank fusion (`fuse()`), keeping 8. Passages of the chat's case come first.
4. **Records found by the search**: the same two searches over recommendation and action passages only, keeping 3, so a record never takes a file passage's place. What the model gets is the record as it stands now, not the indexed text.
5. **Linked records** (`linkedRecords()`): the chat's case, the records the search found, then the recommendations (through their findings' source file) and actions (through their evidence) behind the files found. At most 4, each a few lines: a recommendation's priority, due date, rationale, expected outcome, required evidence and actions; an action's status, due date, last review and last progress update. They go to the model as passages like the others and can be cited (a citation with no `chunkId`).

Both searches carry the full permission filter in their `WHERE`; the linked records are read under row-level security.

## Filtering

Rights are applied before retrieval, never by a model:

1. `retrievalScope()` (the same `authorize()` as the rest of the app) gives the project, client and labels. It goes inside the vector query's WHERE clause.
2. The query runs under row-level security. A file's passages are read only by people who can open the file, while it is open to the assistant and not archived, whatever the passage's own label says.
3. Only what survives goes to the model.

`tests/db/ai-sources.test.ts` checks this for every test user in every project, with their real scope and with a forged one asking for every label: every passage that comes back is from a file that person can open.

## Answers

Each chat message is stored once with its language (`ar` or `en`). Messages from before the column were labelled from their script when it was added. An answer is shown in the other language through the translation cache (docs/translations.md), and only its owner can read either. An answer's citations name the file, its version and the page, or the record.

When passages disagree (an approved version and a newer draft, say), the model gives each version with its citation and says which one the passages call approved, newer or a draft; it doesn't pick one silently or refuse. Passage ids such as `[P2]` are taken out of the answer's text, since the sources are listed under it. Under `language: "auto"`, "I can't confirm" is in the question's language, like answers.

Hosted APIs don't all honour `response_format` (Ollama's cloud accepts it and ignores it), so the prompt asks for JSON too, and the AI service takes the JSON object out of the reply (a code fence or words around it are fine) and asks once more if there is none.

**Status questions.** Search finds what files say, not which actions are late. A question about the state of the work ("what is overdue?", "what is blocked?", "awaiting review", "due this week", "what is still open", and the Arabic forms such as "المتأخرة", "المتعثرة", "بانتظار المراجعة", "هذا الأسبوع", "لم تنجز") is noticed by `statusIntent` (`src/lib/assistant-search.ts`), and `statusRecords` then reads the project's actions under the person's row-level security: a count as of today (open, overdue, blocked, awaiting review, sent back, due in 7 days), up to 8 matching actions with their due date, days overdue, owner and blocked reason, and up to 3 recommendations past their date with open work. These go to the model as records it can cite (the count cites the project), and only 4 file passages go beside them. Other questions are unchanged. Draft, verified and closed actions are not counted as open. Found in the GPT-OSS run, where "what is overdue?" was answered from a file's dates instead of the actions.

A follow-up gets the chat's last 8 messages as context (`history`). They are never sources: the model is told not to cite them, and every turn searches again under the person's rights as they are now. Messages can't be edited by anyone (`UPDATE` is revoked).

## Chats

Every chat belongs to one person and one project (`ai_conversations.project_id`), so one chat never mixes two clients. Picking another project starts another chat.

- **Title:** the first question on one line, cut at 60 characters, with no model call. The owner can rename it.
- **Case** (optional): the recommendation, action, finding, meeting or file the chat is about. The database checks it is a record of the same project that the person can see. "Ask the assistant" on an action, a meeting, a recommendation or a file starts a chat already linked to it (`/assistant?project=…&case=action:…`). Deleting the record unlinks the chat; the chat stays in its project.
- **Who reads it:** only its owner, and only while they can still see the project. A consultant taken off a client loses the chat and its messages at once (the messages are hidden with the chat, not only the chat itself). Staffed again, they get them back, until retention deletes them.
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

- **What is masked:** the project's client and the firm (name, Arabic name, alias, short names), their people and the client's contacts (full names, the optional name in the other language, and name parts of 4+ letters), client people named only as an action's owner, the client's departments, and, for firm staff, the names of the firm's other clients (`app_mask_terms`, for a project the caller can see), main Saudi cities, email addresses and phone numbers. Longest name first; Latin names as whole words; Arabic names also after a prefix such as و or ل, with short vowels ignored. All the names of one record share one placeholder (baseline: Assistant chats), so "Al-Nukhba Holding" and "شركة النخبة القابضة" are both `[ORG_1]`; before that the model took them for two companies.
- **Names in two languages (baseline: Name variants).** A person or client contact can have a name in the other language (`name_alt`, set by the admins who may change their address, logged, cleared on erasure), and a client up to 6 short names ("Al-Nukhba", "النخبة"), set by the firm admin on the client page. Latin names match however they are written: "Al Harbi", "Al-Harbi", "Alharbi" and "el-Harbi" are one name, and "Al-Harbi" also covers "Harbi" alone.
- **Other clients.** A consultant who types another client's name into a question has it masked too. Firm staff already see every client's name (they may ask to join a client), so the list shows them nothing new; other clients' people are not in it, and a client's own people never get other clients' names.
- **Where:** the question, every passage and record, the chat history, translations and file summaries. Embeddings are made locally and don't leave the server.
- **When:** at the moment of sending, from the current names, so a person or department added later is masked without re-indexing. The mapping lives only in that request.
- **Proven by** `tests/db/assistant-chats.test.ts`: no known name reaches the model's payload, and placeholders in the answer come back as the names.

Limits, to state plainly in the report:

- It reduces what leaves; it doesn't guarantee anonymity. A name that isn't in Selah (a person mentioned only inside a file) is not masked, and unusual details can still identify a client.
- A spelling Selah doesn't hold is not matched: someone registered as "ريم الحربي" with no English name is not masked where a file writes "Reem Al-Harbi". The admin adds the second name on the Team page.
- Another client's people, typed into a question, are sent as typed (nothing of that client is retrieved).
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

## The client assistant

Wave 3 (F39) gives a client's admins and managers the same assistant, read-only, behind four locks. Action owners never get it: their screens show only their own actions and the files shared with them, which is narrower than what row-level security lets them read, and the index has no per-person filter yet.

1. **The firm admin offers it** on the client page ("Client assistant" card): on or off, which roles (client admin, client manager), and how many questions a person may ask a day (1 to 200, default 20). `app_set_client_ai()` takes it only from the firm admin, only for an active client whose people sign in with full records (not a pitch, not consultant-managed, not minimal records). The client's admins are told.
2. **The client's admin agrees** on `/assistant`, after reading a notice (in their language) of what it reads, what it never reads, that it gives no rulings, how chats are kept, and who can use it. `app_consent_client_ai()` records who, when, the notice version (`CLIENT_AI_VERSION`, the same date as `app_client_ai_version()`) and the language. The firm admins and the lead are told. The admin can switch it off at any time (`app_withdraw_client_ai()`); the firm admin switching it off, or offering it to a role it didn't cover, ends the consent too, so the admin agrees to what is actually on. A new notice version needs a new consent.
3. **The database decides each request.** `app_client_ai_on()` is true only while all of the above holds for the caller's role and client. It sits in `Principal.clientAssistant`, which `authorize()` checks for `assistant.query`, and in two RESTRICTIVE policies: on `ai_chunks` (a client reads passages only while it is on, and only of files, recommendations and actions; never review notes, meetings or anything else) and on `ai_conversations` (the chats hide when it is switched off and come back when it is on again). Every other policy still applies, so a client reads only passages of records it can already open: no firm-only or other people's private files, assessment scores, firm notes, lessons, pitch material, closing-survey answers or audit data are indexed for them at all.
4. **Every answer is filtered before it is shown or stored.** The AI service gets `audience: "client"` and extra rules (`CLIENT_RULES` in `services/ai/app/prompt.py`): facts only, no legal or compliance rulings, no guesses about the firm's intentions or internal views, no other clients, refer decisions to the consultant. Then `clientAnswerProblem()` (`src/lib/client-ai.ts`, Arabic and English patterns) and `app_names_other_client()` check the answer; a hit replaces it with a fixed refusal in the asker's language, or with "can't confirm" when it named another client. The audit entry records which passages were sent and why an answer was filtered.

Each question counts toward the person's daily limit (`app_count_ai_question()`, firm day; staff are counted but not limited); over it the page says so. File summaries stay with firm staff (`document.summarize`). Chats follow the same retention as staff chats.

`tests/db/client-assistant.test.ts` covers the switch, consent, roles, withdrawal, ineligible clients, hidden chats, the limit, the filter, the other-client check, version parity, and leak probes per role: canary passages are planted in the firm's own file on the client's project, another person's private file, an archived file, a file not open to the assistant, another client's file, a firm-only meeting note and a review passage. Each client role searches for them through the real scope and a forged one, and none comes back; a department's file stays in its department, and the model's request is checked to carry none of them.

## Evaluating with a real model

`scripts/assistant-eval/` asks the real pipeline as each seeded user: 39 questions (English, Arabic, mixed, exact terms, follow-ups, case chats, other clients, leak probes), 11 access probes, the language switch, and 10 questions again with masking off. First run, 2026-10-22, GPT-OSS-120B on Ollama's cloud with local bge-m3 embeddings: 38 of 39 answers correct on review, every access probe refused, no passage from another project retrieved, every name Selah knows masked, median answer 1.2 s (the model about 1.0 s, search 23 ms). The full report is linked from pull request #32 and lives in the project files.

```sh
cd apps/web
npm run db:seed && npx tsx scripts/assistant-eval/seed.ts > /tmp/eval-ids.json && npm run job:index-documents
# The AI service with LLM_PROVIDER=openai_compat, pointed at a logging proxy that appends each request to $PAYLOAD_LOG.
CONTENT=/tmp/eval-ids.json PAYLOAD_LOG=… OUT=/tmp/eval.json TWO_FACTOR_REQUIRED=false npx tsx --conditions=react-server scripts/assistant-eval/run.ts
```

## Not done yet

- Text recognition (OCR) for scanned pages and images: they are listed in `ocr_pages` and marked `needs_ocr` until it exists.
- A name-spotting model for names that aren't in Selah's records.
- Saving an answer to the project as a note.
- Nothing writes meeting summary sources automatically yet; that comes with AI meeting summaries.
