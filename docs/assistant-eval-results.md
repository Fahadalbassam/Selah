# Assistant evaluation: the labelled test set, first run (19 Nov 2026)

The set is section 7 item 7: `apps/web/scripts/assistant-eval/testset/` (how to run it: `docs/assistant.md`, "The labelled test set"). Synthetic data only. Nothing left this machine: the only model was the local `qwen3.5:4b`; no hosted model saw any file text, and no model judged any answer.

## The machine and the setup

- Laptop: Intel Core i7-13700H, 32 GB RAM, Windows 11. It has an RTX 4060 (8 GB), but the Ollama used here is the lead copy's container (`selah-lead-ollama-1`, Ollama 0.40.6, port 11444), which has **no graphics card attached**: the model ran on the processor (20 threads in Docker Desktop, 16 GB given to Docker). That is closer to today's GTX 1050 server (which also runs the 4B on the processor) than to a 12 GB card, but this processor is faster than the server's.
- Chat model `qwen3.5:4b` (3.3 GB), `think: false`, `num_ctx` 16384 sent on every call (seen in the request log). Search model `bge-m3`, same Ollama. Masking off (local model).
- Our own AI service from this branch (port 8951) behind a logging proxy; database `selah_test_s` (`db:seed`, then `testset-seed.ts`, then `job:index-documents` twice); files in a bucket of their own, `selah-eval-s7`.
- 164 files (Al-Nukhba 58, Al-Waha 53, Rawdah 53; 71 Arabic, 69 English, 24 both), 243 marked passages, 18 records from the base seed plus 5 actions with due dates around today. The scanned PDF was indexed with page 1 searchable and page 2 listed for text recognition (`ocr_pages = [2]`). On this machine `pdftotext` (Git for Windows' xpdf 4.00) cannot read from standard input as the jobs image's poppler does, so the job marked the PDF "not searchable"; I indexed that one file with the same code (`pdfPages`, `indexDocument`) from a temporary file. The other 163 went through the job unchanged.

## Retrieval: all 118 questions, no model

What `prepareAsk()` would send to the model, scored by the marked passage ids. 89 questions have marked passages; the 29 others are "can't confirm" questions, leak probes, the reference group and one follow-up whose answer is in the chat itself.

| | Result |
|---|---|
| Right passage among what is sent (hit rate) | **81 of 89 (91%)** |
| Mean share of the marked passages sent (recall) | 0.89 |
| Right passage sent first | 59 of 89 (66%) |
| Arabic questions / English questions | 40 of 43 (93%) / 41 of 46 (89%) |
| A passage of another project sent | **0** (in 118 questions) |
| A leak word of another client in what is sent | **0** |
| Median search time (embedding the question and both searches) | 0.74 s |

By group: facts in English 10/10, facts in Arabic 12/12, similar files (12 monthly reports, 10 contracts, 8 committee minutes and the like, told apart by month or name) 15/15, status 3/3, due this week 3/3, across clients 4/4, exact terms 2/2, scanned 1/1, versions 7/8, cross-language 9/11, long files 13/17, follow-ups across clients 0/1 (plus one more scored only in the full run).

The 8 misses, and why:

- **Long files crowd each other** (N14, N19, R05, R07, W04). The four long files have 9 to 12 passages of about 1,100 characters each, written in the same register; when one of them matches, several of its passages take most of the 8 places. N14 and N19 (English questions, the answer in the Arabic board charter) got 7 passages of the English audit committee charter; W04 got 8 passages of the succession plan instead of the two-paragraph employment policy. Part of this is how the set's long files are written (neutral filler clauses make their passages alike), so it overstates the effect a little; it is still what a reranker (section 7 item 5) or a limit on passages per file would address.
- **Arabic question, English file** (N04: "what did the external auditor ask for" against the English minutes): the Arabic board charter's passages took the places.
- **Follow-ups** (W06, AC08): the search reads only the follow-up ("which of the two is in force today?"), so it finds nothing about the earlier subject. The earlier answer still reaches the model as history, which is why some follow-ups work anyway (N44, N45).

**The two versions are found one at a time, by language.** Where both versions are marked, the English question N11 got only the English 2024 matrix (SAR 1,000,000) and the Arabic question N12 got only the Arabic 2026 draft (750,000): recall 0.5 each, though both count as hits. The remuneration policy (both versions in Arabic) and the Al-Waha dividend policy (both in Arabic) came back whole. A model cannot report a conflict it is not shown; this is a search fault before it is a model fault.

## Full answers: a sample of 20

A full answer took about two minutes on this processor (below), so 100 questions would have taken over three hours. As the task allowed, I scored retrieval for every question (above) and answered 20 in full: every weak case of the 19 Nov run and a spread of the rest (`FULL_SAMPLE` in `questions.ts`).

Two runs were lost to things outside the set, and the final run was built around them:

- **The card's stream gives up on a slow processor.** The first full run used the streamed path the assistant card uses. 4 of the first 9 answers (N11, N12, N17, N20) failed with "the streamed answer failed: AbortError" after exactly 120 s (the run then broke on the database, below): `answerStream()` (`apps/web/src/services/ai-client.ts`, `STREAM_IDLE_MS = 120_000`) gives up when no line arrives for 120 s, and the AI service sends nothing while the model is still reading the prompt (its "wait" lines only come during the second try). Here the model read prompts at about 30 tokens a second, so a 2,400-token prompt passed 120 s before the first word. **On a processor-only server, a person would see an error instead of a slow answer on most longer questions.** Not fixed here (not in this task); it needs a "wait" line during the first stream, or a longer limit.
- **`selah_test_s` is shared.** The `feature/assistant-attach` builder runs its database tests on `selah_test_s` too; they empty the database (they truncate it) at the start. That wiped my seed twice during runs (15:47 and 15:53 UTC). The final run therefore reads everything it needs from the database first (search, passages, record titles: about one minute for the 20) and then asks the model with no database access, calling the AI service's `/v1/answer` (the same prompt and answer check as the card), with the earlier turn passed as history for a follow-up, as `recentTurns()` would give it.

Final run, 16:12 to 16:55 UTC:

| | Result |
|---|---|
| Answered as expected (an answer where there is one, "can't confirm" where there is none) | 14 of 20 automatic, **10 of 19 right, 3 partly right, 6 wrong** on my review (one not finished, below) |
| Answers that cite a marked passage, of the grounded answers with marked passages | **13 of 13** |
| Share of each answer's citations that hold a marked passage | 0.87 |
| Faithful (no claim beyond the cited passages), my review | **16 of 19** |
| Answer in the question's language | 19 of 20 |
| Another client's word in an answer | 0 |
| Median time for one answer | **117 s** (fastest 12 s, slowest 350 s) |
| Largest prompt | **2,738 tokens**; none above 4,096 |

AC08 (a follow-up across clients) is not scored: the model took 350 s (the request log shows its reply), and the script's request gave up at 300 s, Node's default wait for a reply's first line. That limit is in the script, not the product; next time the script should set a longer one.

### The hand review (faithfulness)

Scored by me, the builder, against the marked passages and the cited ones: correct 2 = right and complete, 1 = partly, 0 = wrong or "can't confirm" where the answer was there. Faithful = no claim that the cited passages do not support. The sheet the script writes for this (`SHEET`) has the same columns, for a second reviewer.

| Id | What it tests | Correct | Faithful | Note |
|---|---|---|---|---|
| N01 | fact, English | 2 | yes | |
| N08 | two versions, Arabic | 2 | yes | Gave both figures, said version 2.0 replaces 1.0 and 500,000 applies; ends with a stray hedge taken from the filler text. |
| N11 | two versions, English | 1 | yes | Only SAR 1,000,000; the 2026 draft was never sent (search, above). |
| N12 | two versions, Arabic | **0** | **no** | "The limit is 750,000, per the draft not yet approved": a draft figure given as the limit. Only the draft was sent. The 19 Nov fault again. |
| N17 | long file | 0 | yes | "Can't confirm"; the right passage was sent (8th). The model read the audit committee charter instead. |
| N20 | long file | 0 | yes | "Can't confirm" in 12 s; the right passage was sent first. |
| N27 | scanned PDF, its text page | 2 | yes | |
| N28 | scanned PDF, the image page | **0** | **no** | The register is only on the scanned page, so the answer is "can't confirm". The model listed six vendor contracts from other files as "the register's" entries, and said all are above SAR 500,000 (four are not). A confident, cited, invented answer. |
| N33 | similar files (11 monthly reports) | 2 | yes | 18%, November's figure. |
| N44 | follow-up | 2 | yes | |
| N45 | follow-up, versions, Arabic | 2 | yes | |
| N46 | due this week, Arabic | 1 | no | Named the three actions due, but opened with "nothing is due this week" and called one of them overdue. |
| W05 | two versions, Arabic (approved and draft) | 2 | yes | 30% in force, 40% a draft not yet approved. |
| W06 | follow-up, versions, Arabic | 0 | yes | "Can't confirm": the search read only the follow-up and sent nothing about the dividend policy. |
| W08 | long file | 2 | yes | |
| AC01 | overdue across clients | 2 | yes | All three, each under its client. |
| AC03 | follow-up across clients | 0 | yes | "Which client is the first one for?" after AC01: "can't confirm", although AC01's answer (in the history) names the client. The 19 Nov fault again. |
| AC07 | due this week across clients | 1 | yes | Three of the four; left out the one awaiting review; opened with "no actions explicitly marked as due". |
| AC08 | follow-up across clients | n/a | n/a | Not finished (script limit, above). |
| REF04 | reference library | 2 | yes | "Can't confirm" (no reference source yet), no client file passed off as the OECD principles. |

### What this says about the weak cases of 19 Nov

- **Conflicting versions in Arabic**: better than the 7B on 19 Nov when both versions are sent (N08, N45, W05 right), wrong when the search sends only one (N12), and lost in a follow-up (W06). The search fix matters as much as the model.
- **Follow-ups across clients**: still failing (AC03; AC08 unfinished). Follow-ups in one project worked (N44, N45).
- **"Due this week"**: no longer answered from indicators (the 19 Nov fault); the right actions reach the model and are named, but the 4B mislabels them (N46, AC07).
- **New**: the scanned-page question (N28) gave an invented answer instead of "can't confirm", and two long-file questions were refused although the passage was sent (N17, N20).

### The context bug (section 7 bug 1)

The fix is in (`num_ctx` 16384 is sent, seen in every logged request), but this set cannot show the cut: the assistant sends at most 8 file passages plus a few records, and with qwen3.5's tokenizer the largest prompt was 2,738 tokens. The four long files are 3,000 to 5,000 tokens each, but no single question sends a whole file. To show the cut, a question would need about 12 full passages (the AI service's `max_passages`), which only happens with status rows plus file passages across clients.

## What I would do next (not built)

1. Make the card's stream send a "wait" line while the model reads the prompt, or raise its 120 s limit for a local model, before anyone uses the local model on the processor-only server.
2. Search: keep at most two or three passages per file before the 8 are picked, or try the reranker (section 7 item 5) on this set; and look for the other version of a file (same title family) when one version is found. Measure both on this set's `versions` and `long-file` groups.
3. Follow-ups: search with the follow-up and the previous question together.
4. Run the same sample on `qwen3.5:9b` and Gemma 4 12B on the laptop's 8 GB card (a separate Ollama with the card attached) to compare on the same 20, and give the script a longer reply wait.
5. Give the set its own database, not one shared with another builder's tests.

Files of this run (scratch, not committed): `C:\Users\fbass\AppData\Local\Temp\claude\6bb85cd5cd69e2b5\37295649-c1c7-442b-b445-0b309152e6bb\scratchpad\s7\` — `retrieval.json` and `retrieval.log` (all 118), `full-b.json`, `full-b.log` and `review-b.md` (the 20), `full.log` (the stream run that hit the 120 s limit), `payload.jsonl` (every request to the model with its prompt size).
