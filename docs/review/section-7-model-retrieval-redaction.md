# Section 7: local model, retrieval and redaction (outcome)

Source: "Selah assistant: local model, retrieval and redaction", 16 Nov 2026, written against `main` at 4497cd3. This file is the outcome Fahad supplied for the slot in section 7 of the work prompt. It is a decision record, not built work: **nothing here is implemented until gate B.**

## The three choices

| Question | Choice |
|---|---|
| Chat model | **Qwen3.5** through Ollama, official tags only. `qwen3.5:4b` (about 3.4 GB) on today's server; `qwen3.5:9b` (about 6.6 GB) once there is a 12 GB graphics card. Test **Gemma 4 12B** (about 8 GB) beside it as the challenger. With a 24 GB card, `qwen3.5:27b` or `qwen3.6:27b`. All Apache 2.0. |
| Embedding model | **Keep bge-m3.** Try Qwen3-Embedding-0.6B against it on our own files (same 1,024 numbers per passage, so a re-index but no database change). |
| Retrieval | **Keep RAG**, with the permission filter inside the search query as it is. Rejected: whole files in the prompt, fine-tuning on client files, graph RAG / Neo4j, letting the model write SQL. |
| Redaction ("censoring") | Add a **local scanner with no AI**: at indexing time it finds personal numbers, replaces them with tags in what the assistant reads, warns the person who switches a file on, and checks every answer the same way. |

## Hardware, honestly

- Today's server (GTX 1050, 2 GB on the card, 16 GB RAM) can only run the 4B model on the processor: a short answer in about 7 s, a full answer over many passages 1 to 3 minutes, one person at a time.
- One 12 GB card (RTX 3060 class) with 32 GB RAM: `qwen3.5:9b` with a 16k context, most answers in a few seconds (estimate, not measured).
- For the demo and the report: keep the hosted model for the walkthrough; present the local 4B as the private mode that works today and the 9B on a 12 GB card as the target.

## Problems found in today's code (bugs, no go-ahead needed)

1. **Context size is never set.** `OllamaLLM._chat` sends no `num_ctx`. Under 24 GB of graphics memory Ollama keeps about 4,000 tokens, so the local model silently drops passages or the rules. Fix: send `num_ctx` (16384 default, setting `LLM_NUM_CTX`) and log a warning when `prompt_eval_count` reaches it.
2. **No JSON fallback on the local path.** The hosted class pulls the JSON out of a messy reply and asks once more; the Ollama class trusts `format`. Qwen3.5 has an open report of ignoring `format` when thinking is off, which is how Selah calls it. Fix: give the Ollama path the same pull-out and one retry.
3. **The README overstates the card.** It says qwen3:4b "fits a 4 GB GPU such as a GTX 1050". A GTX 1050 has 2 GB (3 GB on one variant). Pascal cards also need Ollama's CUDA 12 build.

## New work that needs Fahad's go-ahead (gate B)

| # | Change | Where | Size |
|---|---|---|---|
| 3 | Default local model `qwen3.5:4b`; fix the README claim; note the CUDA 12 build | `config.py`, `docker-compose.yml`, `scripts/local.mjs`, `README.md`, `docs/walkthrough.md` | Small |
| 4 | Arabic spelling fold for word search (أ إ آ to ا, ى to ي, ة to ه, ؤ and ئ to ء, drop tatweel, also index each word without a leading و ف ب ل ك or ال), one SQL function used by the stored `tsv` column and by `keywordQuery` | new migration, `src/lib/assistant-search.ts` | Medium (re-index) |
| 5 | Reranker: `POST /v1/rerank` with bge-reranker-v2-m3 inside the Python AI service, after the fusion step; 6 passages for local models, 8 for hosted. It only reorders passages that already passed the permission filter. | `services/ai/app/`, `src/services/assistant.ts` | Medium |
| 6 | Sensitive-number scanner: Saudi national ID and Iqama (10 digits starting 1 or 2, check digit), IBAN (SA + 22, mod-97), card numbers (Luhn), phones, e-mails, passport numbers only next to the word. Normalise Arabic-Indic digits first. Tag, don't delete: the file is untouched. Counts per file, a warning on the AI switch, the same check on every answer. | `services/ai/app/`, `src/jobs/index-documents.ts`, file panel, `src/services/assistant.ts`, new migration | Medium to large |
| 7 | Labelled test set: 50+ files per project (Arabic, English, mixed, a scanned page, two versions of one policy), about 100 questions with the right passages marked; score retrieval hit rate, citation support and faithfulness (RAGAs). Run it for Qwen3.5 4B, 9B, Gemma 4 12B, and bge-m3 against Qwen3-Embedding-0.6B. | `scripts/assistant-eval/` | Medium |

## What not to do

- No AI model as the censor: the database filters, never a model.
- No name-finding model for now. With a local model names do not leave the server. If the hosted model stays in use with real client files, add a Gulf-Arabic name model then.
- No new four-level classification yet. Selah's labels, AI switch and confidential flag already do that job; add a level field only if a government client asks.
- Presidio is optional; a small module of our own with tests is simpler for these six kinds.

## How to tell it worked

- Item 1: `prompt_eval_count` above 4,096 in the AI service log on a long question.
- Items 4 and 5: a higher retrieval hit rate on the item 7 set.
- Item 6: plant ID numbers and IBANs in a seeded file; no passage, model request or answer may contain one.

## Note on the evidence

The source marks which pages it opened directly. Several leaderboard and hardware figures come from search summaries: treat them as reported, not checked. The final model pick must come from Selah's own test set (item 7), not from Arabic exam scores.
