# Review: report flow (PR #201, feature/report-draft-and-send)

Independent adversarial review, 19 Nov 2026 (saved by the lead from the reviewer's report; the reviewer could not write files). Database `selah_test_r`, migrated from empty through 0110.

**Verdict: not ready. 2 blocking, 3 should-fix, 7 notes.** The approval and send rules held against every attack through the app.

## Blocking
- **B1. The staff draft is not limited to client-visible work.** Only the progress records get the client-side filter (`assistant.ts:207`). File passages (firm-private included, `:221`), searched recommendation/action records (firm-private and drafts, `:224`), the chat's own record (`:254`) and earlier turns (`:276`) still reach the model. Proven: a lead's chat on a firm-only recommendation produced a draft whose first passage was the firm-only canary action, offered under "Use as draft". The `prompt.py:47` comment claiming the web sends only client-visible work is false; the test passes only because its fake search finds nothing.
- **B2. The draft names department-limited work** in a note every client reader sees: `progressRecords` with `clientSide` keeps every department's actions (`assistant.ts:991`); the note is not department-filtered. The handbook tells consultants not to do this.

## Should-fix
- **S1.** `0110_report_approval.sql:75` takes the writer from `generated_by` without checking it is the caller; the lead inserted a report as the deputy, approved and shared it. Also: insert without numbers, a colleague freezes and approves their own text. Not reachable through today's API. Fix: on INSERT require `generated_by = app_uid()` and set `drafted_by` from `app_uid()`.
- **S2.** Migration order: 0108, 0109, 0110 all at journal idx 108 with ascending `when`; deploying 0110 first silently skips 0108/0109. Merge #200, #199, #201 in order, re-chaining each.
- **S3.** `refusedDraft` now refuses all staff drafting (e-mails, minutes, replies) while `docs/handbook/firm/en.md:235` says consultants can draft a follow-up message.

## Notes
N1 the source-draft check tests only owner and flag, not that it is the assistant's answer in this project; N2 status packs issued before 0110 have no writer; N3 approved reports can be unshared and re-shared (content frozen; acceptable); N4 `{confirmed:true}` is a request flag, the real guards are approval and the database; N5 approval functions, client read rule, read paths and backfill are correct; N6 the approval trigger skips when no user is set, check the database role instead; N7 prompt injection via client action titles is low risk (a person edits and a colleague approves).

## Tests
Unit 1,081; AI 174; related DB files 123 passed; full DB suite 1,363 passed in 92 files (the existing tests do not cover B1 or B2). Diff grep: no partner-firm name, keys or secrets.

## Re-check (19 Nov night, commit 684bff3)
B1, B2, S1, S3, N1, N6 all fixed; no other route found for firm-only, department-limited or draft work into the staff draft or the model request. Edited 0110 applies from empty. Unit 1,081; AI 174; full DB 1,366/1,367 (the one failure, `ops-check` 39 vs 40 hours, is a timing flake in an untouched file; passes alone). Residual note: a consultant can insert their own assistant-role message flagged as a draft (provenance only; the note is free text anyway). S2 (merge order) handled at merge.
