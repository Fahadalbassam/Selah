# End-to-end suite on the production-like Docker stack

Run on `origin/main` at `9498e12` (after PRs #189-#206), 19 Nov 2026. Fresh worktree `C:\Projects\selah-fresh\.claude\worktrees\e2e-stack`, branch `test/e2e-refresh`. Compose project `selah-e2e` (ports: web 3000, mailpit 8025/1025, storage 9000, clamd 3310, pdf-local 3001; db, ai and ollama moved to 5452, 8050, 11454 by an uncommitted override file). Images built from this commit. Local model only (qwen3:4b and bge-m3 copied from an existing local volume). Nothing left the machine. No other project's container was touched.

## Summary

| | Result |
|---|---|
| Suite as found (original images) | 56 passed, 5 failed, 10 not run (27.6 min). All 5 failures were test drift or environment; the 10 not run were follow-on skips in serial files. |
| Test fixes (branch `test/e2e-refresh`, commit `d902e0c`, not pushed) | 6 files, 31 lines. No app code changed. |
| Final full run, all four image bumps together, fresh database | 67 passed, 1 failed, 3 not run (35.3 min, including 8.4 min of sign-in setup). The failure and the 3 skipped are the assistant file (environment, see below). |
| Real app bugs (b) | None confirmed. One observation on the assistant (below). |
| Image bumps | All four are fine on what can be tested. Details below. |
| Stack torn down | Yes, `down -v` on `selah-e2e` only; built images removed. |

## Per spec file (final full run, all four bumps)

| Spec | Tests | Result | Time |
|---|---|---|---|
| auth.setup | 7 | pass | 8.4 min (one sign-in a minute, rate limit) |
| accounts | 2 | pass | 26 s |
| api-probes | 13 | pass | 13 s |
| assessments | 2 | pass | 35 s |
| assistant | 4 | 1 fail (c), 3 skipped after it; see below. Run on their own afterwards: tests 2 and 4 pass, test 3 fails (c) | 2.2 min |
| core-flow | 7 | pass | 1.7 min |
| crawl (7 roles x ar light / en dark, axe) | 14 | pass | 19.8 min |
| files | 4 | pass | 6 s |
| import-export | 6 | pass | 39 s |
| intake-staffing | 3 | pass | 70 s |
| meetings | 4 | pass | 17 s |
| plan | 3 | pass | 51 s |
| reports | 2 | pass | 18 s |

## Failures and what each was

| # | Test | Class | What happened | Fix |
|---|---|---|---|---|
| 1 | core-flow "owner ... refused an infected file" and "resubmits" | (a) drift | The send-for-review dialog now asks "Which item on the evidence list does the file answer?" and the button stays disabled until one is chosen. | Both tests pick the first option in `#send-item`. |
| 2 | core-flow "owner gets a mail ..." | (a) drift, time of day | Work mail is held for the person's mail hours (quiet hours 20:00-07:00, never Friday, wave 1 item 12). At 20:30 Riyadh time the three mails were queued for Sunday 07:00 (`outbound_emails.next_attempt_at`). The test only passes in hours. | The test releases the hold on its own action's mail before it reads the inbox. The hold itself is intended behaviour. |
| 3 | intake-staffing "makes it a client" | (a) drift | The conflict buttons are on the page at once, so the test clicked "Record the check" before the search finished; the dialog then defaulted to "Flagged" and "Make it a client" never appeared. | Wait for the "Searched ..." line, then choose "Clear". |
| 4 | intake-staffing "the lead approves" | (a) drift | The "Staff on project" dialog now has a required consultant search with no default. | Pick the consultant in the combobox. |
| 5 | plan "client's contacts" | (a) drift | Contacts moved to the client page's People tab; Edit and Remove moved into a "More for <name>" menu. | Open `?tab=people`, use the menu items. |
| 6 | assistant "Arabic answer then English" | (a) drift in part | The answer streams; the test read the card 1.5 s after the headers. | Wait for the whole streamed body. After that, the failure that remains is (c). |
| 7 | import-export "report downloads as PDF in Arabic" | (c) environment | `pdftotext` on Windows lost the Arabic characters. | `-enc UTF-8` (harmless on other systems). |
| 8 | every test using the database helper | (c) environment | The helper runs `docker exec selah-db-1`; the compose project here is `selah-e2e`. | `E2E_DB_CONTAINER` variable, default unchanged. |

## What still fails, and why it is environment (c)

The test file says it was written against the hosted model (gpt-oss through Ollama cloud). This run used only the local qwen3:4b on the processor, because nothing may leave the machine.

- **assistant 1, Arabic question about related-party deals.** Three runs, three outcomes: the answer streamed with no wait (fixed), then "I can't confirm that from your sources" (run 2), then, on a warm model, a grounded answer with the right citation (Board minutes, page 2) whose text was only the question repeated, so no "500". The model is weak in Arabic; retrieval was right.
- **assistant 3, "across all my clients".** The answer was grounded and correctly listed the overdue actions, but no citation was of type `status`, so the check failed (once it timed out at 3 minutes on a cold model). Model choice decides which citations it writes.
- The English recommendation test (assistant 2) and the staffing and role limits test (assistant 4) pass.
- Observation for the lead, not proven as a bug: when the model's whole answer is the question text, the app shows it as a grounded answer. The "heading-only answers refused" guard (#192) does not catch an exact echo of the question. Worth a small look when the assistant is next touched. Screenshot: `docs/review/shots/e2e/assistant-arabic-ungrounded.png`.

## Image check (Dependabot bumps), one at a time, then together

| PR | Bump | In the test stack? | Result |
|---|---|---|---|
| #144 | gotenberg 8.38.1 to 8.39.0-chromium (`pdf` and `pdf-local`) | Yes | `pdf` healthy, `/health` shows chromium up. import-export (includes the Arabic report PDF with text check) and reports: 15 of 15 pass. |
| #142 | rustfs 1.0.3 to 1.0.4 | Yes | Started on the existing 1.0.3 data volume (an upgrade, not a clean start), health 200. files and core-flow (uploads, signed links, downloads, EICAR refusal): 18 of 18 pass. |
| #143 | caddy 2.10.2 to 2.11.7-alpine | Only in the `direct` and `tunnel` profiles, not in the test stack | `caddy validate` on `ops/edge/Caddyfile` passes for both versions, both site-address modes (HTTPS and the tunnel's HTTP with trusted proxies). The `edge-tunnel` service was started on the internal Docker network only (no published port, no tunnel) and fetched through from the web container: `/api/ready`, `/sign-in` and the files host `/health` all return 200, identical on 2.10.2 and 2.11.7. The `direct` profile was not started (it binds ports 80 and 443). |
| #139 | cloudflared 2025.10.0 to 2026.10.4 | No (tunnel profile, needs a token) | Image pulled; `--version` runs; `tunnel run` with no token, no network, fails with the same message on both versions. No tunnel started. A real token and a live tunnel would be the only full test; do that by hand when it is merged. |
| all four | together | gotenberg and rustfs run; caddy `edge-tunnel` ran beside the suite; cloudflared not started | Fresh database, full suite: 67 passed, only the assistant model failure above (identical to the baseline). |

Recommendation: #144 and #142 are safe to merge on this evidence. #143 is safe on config and proxy behaviour. #139 is untested beyond starting; merge only if you accept testing the tunnel by hand.

## Files

- Test fixes: branch `test/e2e-refresh`, commit `d902e0c` in `C:\Projects\selah-fresh\.claude\worktrees\e2e-stack` (not pushed).
- Uncommitted in the worktree, on purpose: `.env` (ignored), `docker-compose.e2e-override.yml`, `docker-compose.e2e-all4.yml`.
- Logs: `docs/review/shots/e2e/` (`run1.log` as found; `run2`-`run4` after fixes; `img-gotenberg.log`, `img-rustfs.log`; `run5-all4.log` final; `run6*.log` assistant reruns).
- Practical notes for next time: the suite takes about 35 minutes; two reruns on the same data trip the inquiry conflict search (the new "Qimma" inquiry matches the earlier one and the convert dialog picks the existing client), so use a fresh database for a full rerun. The host disk was at 98 percent full.
