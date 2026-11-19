# Phase 3 brief (shared by every phase 3 helper)

Read first: `docs/review/inputs/selah-big-prompt-v2.md` sections 1, 4, 7 and 8; `docs/review/section-7-model-retrieval-redaction.md` (the filled section 7 slot); `docs/review/work/build-brief.md` (standing decisions); `docs/review/lead-log.md` (the running story, including findings logged under "Phase 2, part B").

## Rules
- **Assess, do not build** (section 8), except the helper told to fix the three section 7 bugs.
- Synthetic data only. No real names, files or client data anywhere. Never paste a key into a file, log or message.
- Never name the partner consulting firm (`[partner firm]`, `[partner firm]`, any spelling). The fictional firm "Mizan Advisory" stays.
- Do not touch Fahad's checkout `C:\Projects\selah-fresh` working tree, the app on port 3010, the database `selah_check` or port 3930 (another helper uses them now). Nothing leaves this machine: no hosted model calls with any file content, no e-mail outside the local mail catcher.
- Work in your own git worktree from `origin/main` (`git fetch` first) under `C:\Projects\selah-fresh\.claude\worktrees\`.
- If you need a running app: use only your assigned database and port. Copy `<scratchpad>` and `lead-check-env.sh` to your own scratch folder, change `selah_check` to your database and 3930 to your port, then use them. Postgres is at localhost:5442 (container `selah-lead-db-1`). Walkthrough accounts use the test password `123456789@Pass` (localhost only). Stop your server and kill the node process on your port when done.
- Every claim needs proof: a file and line, a test you ran, a query result, or a screenshot path.

## What each area hands back (section 8)
For each item: what works today (with proof); what is missing or half-done; what the user would notice; the risk; a proposal with effort (small/medium/large) and the evidence it is needed; and a recommendation: build now, build after the scenarios, or leave out.

Write your part to the file named in your task under `docs/review/work/` in `C:\Projects\selah-lead`. The lead merges the parts into `docs/review/unfinished-assessment.md`. Plain words, short sentences.
