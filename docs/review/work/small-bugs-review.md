# Review: fix/small-bugs (ee9e7cd vs origin/main)

Independent adversarial review. Worktree `C:\Projects\selah-fresh\.claude\worktrees\small-bugs`, diff `git diff origin/main...HEAD` (31 files). No edits, no pushes, no database used, no model calls.

## Checks run

- `TZ=UTC npx vitest run` (apps/web): 65 files, 1016 passed, 2 skipped.
- `npx tsc --noEmit` (apps/web): clean.
- `python -m pytest -q` (services/ai, scratch venv `smallbugs-venv`): 71 passed.
- Probed `unfinished()` / `check_answer()` directly with 25 edge inputs (results below).
- Grepped added lines and the repo for the partner-firm name (both scripts), university / student / graduation / GP, real-looking names and keys: nothing in the diff. Only hits repo-wide are "university scholarships" in sample seed text and the lucide `GraduationCap` icon, both unrelated and pre-existing.

## Blocking

None found.

## Should-fix

### S1. `unfinished()` throws away valid grounded short answers (`services/ai/app/prompt.py:137-148`)

The "a word or two with no end to the sentence" rule rejects answers that are complete but have no final punctuation. If the second reply has the same shape (likely: temperature 0, same prompt plus a note), `check_answer()` makes it ungrounded and the person reads "I can't confirm" in place of a correct, cited answer. Probed, each with `cited_ids=["P1"], grounded=True`:

| answer | result |
|---|---|
| `نعم.` / `Yes.` / `12.` / `15 مارس 2026` / `1 March 2026` | kept |
| `نعم` / `Yes` / `12` / `2026-03-01` / `75%` / `SAR 250,000` | **ungrounded** |
| `15 مارس` / `خالد` / `Khalid` / `الحالة: متأخرة` / `Owner: Reem` | **ungrounded** |
| `**Quarterly**` / `“Quarterly”` (curly quotes) / `Four…` / `Quarterly.` + U+200F (RLM) | **ungrounded** |
| `Quarterly [P1]` (marker, no period) | **ungrounded**: `strip_markers` leaves `Quarterly` |

The status questions the assistant answers from records ("how many actions are overdue?", "who owns X?", "when is it due?") are the ones most likely to get a bare number, name or date. Suggest: count a reply with a digit, or one that is the whole of a short answer, as finished; add `”`, `’`, `…`, `*`, `%` and the Arabic full stop `۔` to the end set and strip bidi marks (U+200E/U+200F/U+061C) before checking; and add a few of the rows above to `WHOLE` in `tests/test_service.py`. At minimum, bare digits and dates should never be rejected.

### S2. Under `auto`, "local" can still mean the text leaves the server (`services/ai/app/main.py:299-305`, `:167-173`)

`/v1/model` reports `local` from `draft_locally()`, which only checks that `LLM_PROVIDER=ollama` was set explicitly. The `ollama` provider sends to whatever `OLLAMA_URL` points at, and an Ollama daemon also serves `*-cloud` models (e.g. `gpt-oss:120b-cloud`) by forwarding to ollama.com. The project has used "GPT-OSS on Ollama's cloud" before (docs/assistant.md). With `LLM_PROVIDER=ollama` and `LLM_MODEL=gpt-oss:120b-cloud`, or `OLLAMA_URL` set to a remote host, the service answers `local: true` and the web app sends names unmasked to a hosted model. The change moved the masking decision onto this one check, so it should be tight: treat a model name ending in `-cloud`/`:cloud`, or an `OLLAMA_URL` host that is not the compose service name / loopback / private range, as not local. The same gap also lets the org chart draft go to a hosted model. This was already possible before the branch; the branch now makes the service's answer the thing that decides masking.

### S3. The screen still says "local" from the web app's own setting, the disagreement R1 is about

- `apps/web/src/app/(public)/legal/[doc]/page.tsx:64,70`: the security page's "where the model runs" fact is `local` whenever the web app's `LLM_PROVIDER` is `ollama`, whatever the service runs.
- `apps/web/src/services/assistant.ts:1198`: the assistant card's `model: "local" | "hosted"` uses the same web setting.

In the exact case this branch fixes (web says ollama, service runs hosted), masking is now right but the public security page still tells readers the model runs locally. Not a leak, but a wrong statement in a document about data handling. Either use `modelIsLocal()` there too, or describe the setting without saying where the model runs.

## Notes

### N1. Masking fail-closed path: checked, holds

- Every path that sends text to the chat model goes through `textMasker`/`projectMasker`, and both now `await maskingOn()`: ask and stream (`assistant.ts:237`, one `prepareAsk` for both and for client people), translations (`translations.ts:72`), file summaries (`document-summaries.ts:117`), org chart draft (`org-chart-import.ts:358`). No other caller of `answer`, `answerStream`, `translateText`, `summarizePages` or `draftOrgChart` exists in `src` or `scripts`; `scripts/index-documents.ts` only embeds, and embeddings always stay on local Ollama (`HostedChatLLM.embed`).
- No caller passes `on`, so the "Promise passed as boolean" risk from the signature change does not occur. No test passes `maskingOn()` either.
- Every exception path is masked: `modelIsLocal` catches fetch errors, the 5 s `AbortSignal.timeout`, non-2xx, bad JSON and the wrong shape (`z.boolean()`, `=== true`, so `"true"` and missing are false), and `env()` throwing in a job. `maskingOn` also catches if the injected check throws. A test file that mocks `@/services/ai-client` without `modelIsLocal` gets `undefined()` → TypeError → caught → masked (closed). All current mocks define it.
- `AI_MASKING=off` still forces unmasked even when the service is hosted. That is the documented override, not a leak, but it is the one switch that sends names to a hosted model, so it is worth a line in the deploy checklist.

### N2. `/v1/model` auth: checked, holds

`dependencies=[Depends(require_token)]`, the same `hmac.compare_digest` check as the other routes (`main.py:69-75`). The test confirms 401 without a token. The reply names the model (`settings.llm_model`), and only to token holders: fine.

### N3. Network call inside an open transaction

`textMasker`/`projectMasker` run inside the caller's transaction, so each ask, translation, summary and draft now holds its connection for one more HTTP round trip: up to 5 s when the service is slow. In `prepareAsk` this comes after `app_count_ai_question()`, so the per-person counter row stays locked that much longer and two parallel asks by one person queue behind it. No deadlock: the service never touches the database. Same pattern as the existing `embed()` / `translateText()` / `answer()` calls in those transactions, so nothing new in kind. Calling `maskingOn()` once, before the transaction, and passing `on` in would avoid it; the `on?` parameter is already there.

### N4. Retry cost and limits

The retry sends the same system prompt and the same masked passages with only `ASK_WHOLE_ANSWER` added. No new content, at most one extra `chat_json`, no loop (both tests check this). But `chat_json` has its own JSON retry, so a stream can now take up to five model runs (stream, ask again ×2, whole-answer ×2). The comment at `main.py:241-244` still says three. On the local CPU model that can pass the web's `STREAM_TOTAL_MS` (600 s) and end as `error`. The non-streamed `answer()` has a 60 s web timeout (`ai-client.ts:8`), and a second call doubles its time. S1's false positives would set off this extra cost on correct answers too.

### N5. Stream retry result is not passed through `json_object()`

`main.py:252-257`: `reply = again.result()` goes to `check_answer` as is, while the earlier fallback does `json_object(again.result())`. Harmless today, because `chat_json` (via `json_with_one_retry`) already returns the extracted object when there is one. Worth matching for symmetry.

### N6. `unfinished()` bracket rule

It counts `(` only. A heading cut at `[Action` is not caught, and an answer that quotes a clause reference like "Section 4(a" is rejected. Minor.

### N7. Removed message keys: no references left

`action.move.blocked` and `help.ask.button`: no static or template-built references in `src`, `tests`, `e2e` or `scripts`. `action-panel.tsx:286` uses its own label for the blocked transition, and the help page builds only `faq.${k}.*`. The client-key list and the help-page test were updated.

### N8. Handbook and docs

- `handbook-content.ts` matches `docs/handbook/` (the existing equality test passes), and the new test checks for no repeated ids and no bare `ar.md`/`en.md` in all four guides.
- `parseGuide` collects only anchors that match the strict regex. An anchor written in another form that the block parser still accepts would not be in `used`, but the real-guides test would catch a duplicate.
- A heading placed before an anchor of the same id now loses its id to that later anchor. No current guide has this.
- The `phases.newHint` People tab is real (`projectPage.tabs.people`). The walkthrough's «اسأل المستشار» matches the live button text (ar.json:1040). The handoff's "last is 0105_org_chart_publish" matches `drizzle/`. The `عربي` toggle label exists (`languageShort`).
- `docs/handoff.md` now names "the fictional Mizan Advisory" as the sample firm. Fine as long as that stays the seed's fictional name.
