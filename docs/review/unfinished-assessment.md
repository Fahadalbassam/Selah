# What is not finished: the Gate B list (19 Nov 2026)

**Gate B closed 19 Nov 2026.** Fahad accepted every recommendation below (including item 20), with the answers in section E. The build order is in `lead-log.md`, "Gate B answers from Fahad, part 2".

Phase 3 of the big prompt (section 8). Main at #191. Detail and proof for every line are in the four parts:
`work/phase3-classification.md` (area 2), `work/phase3-assistant-redaction.md` (areas 1 and 3), `work/phase3-kpi-gaps-leftovers.md` (areas 4 to 7), and the section 7 outcome `section-7-model-retrieval-redaction.md`. The client guide walk-through is in `work/client-guide-walk.md` (all 14 sections, both languages, every step clicked on a fresh copy).

## A. Already fixed, or being fixed, without your go-ahead (bugs only)

| What | Why it could not wait | State |
|---|---|---|
| Local model: context size, JSON fallback, honest GPU note (section 7 bugs 1 to 3) | Section 7 marks them as bugs | Merged, #191 |
| **Five proven leaks**: a firm-only action's title in the client admin's leaving report; a client-private file name in the firm's audit log on withdraw; withdrawn names kept as "shared" in activity rows; shared monthly report and PDF counting firm-only work; the Progress history chart counting firm-only and other-department work for client managers | Private information reaches the wrong person | Being fixed (`fix/classification-leaks`), then independent review |
| Confidential request bypassed by uploading a new version and switching the assistant on | Breaks a promise shown on screen | Same branch |
| The database lets a client manager rename or move another person's file | Second line of defence weaker than the screens | Same branch |
| A **restricted client** cannot record progress or evidence at all (the client admin owns actions but has no buttons; the API returns 404) | Restricted clients cannot use the product; the docs say the admin does this | Queued after the leak fixes (same permission code) |
| Masking fails open if the web app thinks the model is local but the AI service uses a hosted one (R1) | Unmasked text could leave the server | Queued (small) |
| Empty "grounded" answers (only a heading) accepted (R6) | Wrong answer that looks right | Queued (small) |
| Stale words and docs: "Team tab" (`phases.newHint`), walkthrough «اسأل مستشارك», two dead message keys, `handoff.md` (last migration 0067; the student-project line, also `data-architecture.md:149`); handbook duplicate ids and plain-text language links | The technical pack must not carry the origin line; wrong labels confuse | Queued (one text PR) |
| Client guide corrections from the walk-through: the second sign-in after creating the account; the three tick boxes on "Before you start"; the dialog is "Send for review"; how to send a saved file; a returned file shows under "Waiting for you"; date answers show on the action page; "Read and decide"; the "are you sure" windows; "EN" / "عربي" | The guide must match the screen | Queued after #192 (both touch the handbook) |

Not touched: the old audit and activity rows that already hold private file names. They are append-only; changing them needs you. On the walkthrough copy they are synthetic.

## B. Your decisions, sorted by what a user would notice most

| # | Item | Effort | My recommendation |
|---|---|---|---|
| 1 | **"I am stuck" tells nobody at the firm**, while its hint says the consultant will see it | Small | **Build now**: notify the project's lead and the consultants on the action |
| 2 | Department-limited manager sees 25% on her home and Progress tab, 13% for the same project in the shared report and PDF (both correct, nothing says why) | Small | **Build now**: one explaining line |
| 3 | Indicator card judges in words and colour ("Worse than baseline" red, "Better" green, "Toward target %") against the "no judging words, no colour" rule | Small | **Build now** (wording, neutral colour) |
| 4 | Lead consultant changes: client and old lead not told, no handover note | Medium | **Build before the scenarios**, after two questions to a consultant (in area 6) |
| 5 | No reminder before an engagement's end date | Small | **Build before the scenarios**, after the research check |
| 6 | Client assistant: "who is my consultant" not answered; "my deadlines" returns the whole project's | Small each | **Build now** |
| 7 | Client assistant: legal questions get a bare refusal | Small | **Build now**: keep refusing rulings, but show what the documents say |
| 8 | Client assistant: progress-update draft is forbidden by a written rule but expected by the spec | Small to medium | **Your call** (it changes a rule). I recommend a facts-only draft, marked draft, never sent by Selah, no judging words |
| 9 | Unhappy client route to the firm admin: exists, but shares one box with bug reports and the only reply is "Handled" | Small | After the research check (wording first) |
| 10 | Client sees assessment guidance written for the consultant ("which the firm can deliver") | Small | After the scenarios |
| 11 | Staff assistant: "what changed since my last visit", concern flags (facts only, no score) | Small to medium | After the scenarios (value test task 6 measures it) |
| 12 | Staff assistant: meeting brief and follow-up drafts | Medium | After the value test shows time lost there |
| 13 | Export asked in English while the screen is Arabic has Arabic labels | Small | After the scenarios |
| 14 | Batch 5 leftovers (date-request words, two words for "inquiry", whose move the red late date is, inquiry steps trusting `can.forward`) | Small | After the scenarios |
| 15 | Every tooltip on a badge adds a Tab stop in long tables | Small | After the scenarios |
| 16 | OCR for scanned pages | Medium | After the scenarios, with one scanned file in scenario data |
| 17 | Saving an assistant answer to the project as a note | Small to medium | After the scenarios (ask in the value test) |
| 18 | Loading the firm's own assessment as a template (no import today) | Medium | Leave out until the firm sends its assessment (the list of what to send is in area 5) |
| 19 | Name-spotting model for names only inside files | Large | Leave out, on condition that real client files go only to a local model (write it into the deployment guide) |
| 20 | Small app bugs from the guide walk: the accepted-files hint shows empty "()"; "Give to a colleague" finds no one by English name, and offers the client admin; the history says "sent a file" for a file only saved; the assistant card shows no error when the model gives no answer; the re-send button has two Arabic wordings; requested-document titles in English on the Arabic home (check whether this is only seed data) | Small each | **Build now** (bugs) |
| 21 | Client-facing words: the client admin has three Arabic names; "3 received" beside "Waiting for the firm"; a greyed-out button with no reason; "the assistant runs on this computer" reads as the client's own computer | Small | **Build now** (wording) |

## C. Section 7 (model, retrieval, redaction): needs your go-ahead

| # | Change | Effort (checked against the code) | Recommendation |
|---|---|---|---|
| 3 | Default local model `qwen3.5:4b` | Small | **Yes**, with item 7 to confirm |
| 7 | Labelled test set (50+ files, ~100 questions); score by marked passages, judge locally only | Medium to large | **First**, after Gate B, before the scenarios |
| 4 | Arabic spelling fold for word search (also closes the hamza/tatweel masking misses; «لل» + name needs its own rule) | Medium (drops and re-adds the search column; no re-embedding) | **After item 7** |
| 6 | Sensitive-number scanner, at indexing **and** at sending, for local and hosted | Medium to large | **Before any real client file** |
| 5 | Reranker | Medium to large (the AI service has no ML runtime today) | **Only if item 7 shows a gain** |

Note: the assistant re-run used a stand-in local model (`qwen2.5:7b-instruct`), because neither `qwen3:4b` nor `qwen3.5:4b` is installed and I did not download them. Access held on all 164 questions; answer quality numbers are not the server's. Downloading `qwen3.5:4b` (about 3.4 GB) is needed for item 3 and the value test.

## D. Questions only you can answer

1. A file's assistant switch: should only the uploader and the client admin control it (today any client manager can)? **Recommend yes.**
2. Meeting agenda headings and status words follow the meeting's language, not the reader's. **Recommend: follow the reader.**
3. A department-limited manager can be invited (after a warning) to a whole-project meeting she cannot open. **Recommend: refuse that invitation and offer a department meeting.**
4. The firm's free-text report note can name another department's work to a limited manager. **Recommend: a line in the consultants' handbook.**
5. Firm-run client with one consultant: who reviews? **Recommend: say on the action page that the firm admin must, when nobody else can.**
6. Should a client admin also record progress on a **full** client when they own the action? **Recommend: no change now; fix restricted clients only.**
7. ~~The value test~~ **Answered:** Fahad runs it alone on his laptop, each task with and without the assistant; reported as a single-tester trial. Task list and score sheet: `docs/value-test.md` (being written).
8. Old audit and activity rows holding private file names: leave them (synthetic today), or clean them with a one-off migration before real use?

## E. Answered so far

- Value test: single-tester trial by Fahad (D7).
- Later improvements (automatic KPI help, assessment draft scores against the reference library, workflow lane detection, a few others) and the reference library plan: **documented only**, in `docs/progress-checklist.md` and the handbook's new "Later improvements" part. Nothing built; only keep KPIs, assessment answers and action history structured and timestamped. Details in `lead-log.md`, "Gate B answers from Fahad, part 1".
- Rest of the list: all recommendations accepted, in the proposed order.
- Item 8, client progress-update draft: **yes**, facts-only, never sent by Selah; the written rule changes to match.
- Before the scenarios: lead-change notice, end-of-engagement reminder, "who is my consultant", "my deadlines" for the asker only.
- Section 7: download `qwen3.5:4b` and make it the default; test set first, then Arabic search, then the number scanner before any real client file; reranker only if the test set shows a gain.
- D1: only the uploader and the client admin control a file's assistant switch. D2: meeting headings follow the reader. D3: refuse the invitation. D4, D5, D6: as recommended. D8: clean old audit rows with a script run before go-live.
- Later improvements get two more rules: keep the app light (one shared local model and one index; plain rules and SQL before AI) and keep it fast (one AI queue, caching, index once, measure before and after).
- Working rule: at most 2 helpers at a time; independent review only for privacy, permission, AI or database changes.
- Progress report change (19 Nov evening): "Use as draft" into the report page, 2–3 report templates, @-attach a visible file in the assistant, send to the client only after a person confirms and the firm approves; user-made templates and a richer editor documented as later improvements. Queued before section 7 (`lead-log.md`).
