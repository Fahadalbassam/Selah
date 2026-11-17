# Building a change in Selah: the shared brief for helpers

You are one helper building one pull request. Read this whole file first. Your own task (what to change, your branch, your test database) is in the message that started you.

Selah is a production web app (Next.js App Router, TypeScript, Postgres with row-level security, Drizzle migrations, next-intl). It connects a consulting firm and its clients: a client has projects; a project has recommendations; each recommendation has actions; each action needs evidence that the firm reviews. The web app is in `apps/web`.

## Rules that win over everything

1. **The product never names the partner consulting firm.** No real firm name in code, seed data, translations, e-mails or PDFs. The walkthrough firm is the fictional "Mizan Advisory / ميزان للاستشارات" and stays.
2. **Selah never does the consulting.** It does not judge, score, approve or recommend on its own. Humans decide.
3. **No new features.** You fix what your task names. If you think something else is needed, write it in your hand-back instead of building it.
4. **Arabic right-to-left first, English on everything.** Every label, tooltip, e-mail, export and error exists in both `apps/web/messages/ar.json` and `apps/web/messages/en.json`. Write the Arabic first, in natural Arabic, not translated English. Speak to the reader on client screens ("your company"), never about "the client".
5. **Production app.** No mock screens, no fake data, no "coming soon".
6. **Access is decided on the server.** Firm-only or other people's data is filtered in the service and the database rule (row-level security), never only hidden in the page. A denial answers 404, the same as a missing record.
7. **UI rules: `docs/ui-guidelines.md`.** shadcn/ui and the existing Selah components; tokens only, no palette colours; logical (RTL-safe) classes only; at most one solid button per card; 768 px and wider; `useConfirm`, never `window.confirm`.
8. **Synthetic data only.** Never put a key, a password or a real name into a committed file.

## Decisions already made (do not reopen them)

The product owner's answers stand. The full texts: `docs/review/page-audit.md` section 6 (gate A), `docs/review/lead-log.md` ("Gate A answers" and "Gate A follow-ups"), and `docs/review/decisions/2026-11-17-gate-a-followups.md` (wins where texts differ).

- **D1** A client admin, the project's coordinator and its sponsor may give one open action to a colleague in their own organisation; the status does not change; the new and old owner, the client's lead and deputy and the staffed consultants are told; audited.
- **D2** Trace goes; Today becomes the home; Oversight becomes filters on Actions.
- **D3** Six visible status words: Not started, In progress, Waiting for the firm / the client, Needs attention, Verified, Closed.
- **D4** A consultant changes a client's indicators only when staffed (not as observer) on an open project of that client, or as its lead or deputy. Observers change nothing.
- **D5** No "Off track / Watch / On track" label: counts instead.
- **D6** Clients do not see draft actions until the firm releases them, enforced in the database.
- **D7** Signed-out pages and mails name the firm from its own record, never from code.
- **D8** A department-limited person sees nothing by title from other departments, anywhere.
- **Agenda** "follows the meeting": a department's meeting lists that department's work; a whole-project meeting opens only for people who may see everything on the project (an action owner may open any meeting they are invited to, whole-project or not, and its agenda shows them only their own actions; decided 17 Nov, with a test for an owner invited to a whole-project meeting at a client with no departments); the organiser is warned when inviting someone with limits.
- **Action owners** read only actions they own, in the database (and everything under them); no titles and no counts of others' actions. Files keep their rule.
- **Indicator links** to recommendations: firm staff only.
- **Visibility picker** (documents except evidence, and meetings): only takes people away, never widens; locked chips; people left out see nothing.
- **Org chart**: positions, not people; never grants or limits access; Selah never designs or judges a structure.

Decided by the lead inside those answers (17 and 18 Nov; logged in `lead-log.md`, "18 Nov 2026"):

- **"May see everything on the project"** is one stable rule: firm staff on the project, the client admin, and a manager when departments are off or when they are in every active department.
- **An action owner invited to a meeting** sees its summary, decisions, shared notes, attendees and their own follow-ups only.
- **A department head who cannot open an action**: the escalation goes to the client admins instead.
- **Translation masking** (`app_mask_terms_in`) returns only the names that appear in the text it is given.
- **Org chart names for a manager**: only on the current published version, as of today, in their own branch, while "show names" is on; never holding dates. "Your manager" is shown to anyone whose position is in the chart and respects "show names".
- **Indicator moved-away notice**: judges only periods that have ended; a notice a correction fixed is hidden; the client reads "Your company's reported figures, not verified impact" / «أرقام شركتكم كما أُبلغ عنها، وليست أثرًا موثّقًا».

## The screen standard (batches 1 to 5)

Fahad, 17 Nov 2026: every screen must clearly show **what it is for and what to do next**. When you change a screen:

- **One main action per page** (one solid button on the page's first card; the rest outline, ghost or in a menu).
- **Fewer buttons:** a rare action goes into a row or page menu, not a visible button.
- **Plain labels** a client would understand, in Arabic first; speak to the reader ("your company"), never about "the client".
- Do not re-audit screens that have not changed: the Gate A audit (`docs/review/page-audit.md`) is the reference. Only screens that are new or changed since then are re-checked before batch 1.

## Read before you write

- `apps/web/AGENTS.md`: this Next.js version differs from what you know. Check `apps/web/node_modules/next/dist/docs/` before writing framework code.
- `docs/authorization.md` (who may see and do what, and how a request flows), `docs/rules.md` (every rule, its database object, its service and its test), `docs/data-model.md`, and the doc for your area (`docs/meetings.md`, `docs/metrics.md`, `docs/assistant.md`, `docs/accounts.md`, `docs/intake.md`, `docs/engagement.md`, `docs/import-export.md`).
- `apps/web/src/authz/policy.ts` and `authorize.ts` (the permission table and its five questions), `apps/web/src/authz/workflow.ts`.
- The audit that explains why this change exists: `docs/review/page-audit.md`, and the area reports in `docs/review/work/` it points to. The screenshots it cites are on this machine under `C:\Projects\selah-lead\docs\review\shots\` (open them with the Read tool).

## Your working copy

You work in your own git worktree. Do these first, from the worktree's root:

1. `git fetch origin` then `git switch -c <your branch> origin/fix/assistant-test-date` (that is `main` plus the one-line test fix that makes the database suite pass; it is being merged).
2. In `apps/web`: `npm ci --no-audit --no-fund` (a few minutes).
3. Copy `C:\Projects\selah-lead\apps\web\.env.local` to your `apps/web/.env.local`. In your copy, change the database name in the three `TEST_DATABASE_*` lines from `selah_test` to your own test database (named in your task). Do not change anything else in it, never print it, never commit it (it is git-ignored). The database server is already running on this machine (port 5442); do not start, stop or reset any Docker container, and never run `npm run walkthrough`, `dev:local`, `test:all`, `stop:local` or `reset:local`.
4. Never touch the other databases on that server (`selah`, `selah_test`, other helpers' `selah_test_*`), and never touch `C:\Projects\selah-fresh` or `C:\Projects\selah-lead` (read the latter, write nothing there).

## Running the checks (PowerShell, from `apps/web`)

```powershell
$env:TZ = 'UTC'
npm run lint
npm run typecheck
npm test                                   # unit tests
# database tests: migrate your test database, then run
Get-Content .env.local | ForEach-Object { if ($_ -match '^(TEST_DATABASE_(OWNER|APP|AUTH)_URL)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[3].Trim('"') } }
$env:DATABASE_OWNER_URL = $env:TEST_DATABASE_OWNER_URL
npm run db:migrate
npm run test:db                            # or: npx vitest run --config vitest.db.config.ts tests/db/<file>
```

All of lint, typecheck, unit tests and database tests must pass before you hand back. If a test that you did not touch fails, find out whether it fails on `origin/fix/assistant-test-date` too and say so; do not "fix" it by weakening it.

## Database changes (Drizzle)

- Schema is in `apps/web/src/db/schema/`. Migrations are SQL files in `apps/web/drizzle/` with snapshots in `apps/web/drizzle/meta/`. The latest on `main` is `0067_indicator_data.sql`. Yours start at `0068`.
- A change to tables or columns: edit the schema, run `npx drizzle-kit generate --name <name>`. A change to functions, policies, triggers or grants only: `npx drizzle-kit generate --custom --name <name>` and write the SQL by hand. Never edit an existing migration file.
- `drizzle-kit generate` diffs against the snapshot whose file name sorts last, not the journal order, and it overwrites `meta/00NN_snapshot.json` for the journal index. Every migration in the pull request includes its snapshot. After generating, run `npx drizzle-kit check`, then `npx drizzle-kit generate --name probe` and confirm it says "No schema changes" (delete nothing it did not create; if it created a probe file, your schema and snapshot disagree: fix that).
- Functions and policies are redefined with `CREATE OR REPLACE FUNCTION` / `DROP POLICY … ; CREATE POLICY …` in the new migration. Find the latest definition of the thing you change by searching every file in `apps/web/drizzle/` for its name (later files redefine earlier ones), and start from that latest text.
- Every rule you add or change gets its row in `docs/rules.md`, and `docs/authorization.md` when it changes who may see or do something.

## Tests

- Every access change gets allow **and** deny tests in `apps/web/tests/db/` (other tenant, other project, wrong role, wrong department, wrong label), written like the files beside them. A leak fix gets a test that fails without the fix: say in your hand-back that you saw it fail first.
- Tests that touch the audit log use `truncateAuditLog(owner)`. Every new audit action needs an Arabic and English label and an area (`tests/audit-labels.test.ts` checks it).
- Never use a fixed calendar date that will be in the past soon. Use `app_firm_today()` plus or minus days in SQL, or a date far in the future.
- End-to-end tests (`apps/web/e2e/`) cannot be run by you (they need the whole stack). If your change moves or renames something they click, update the test file and say you could not run it.

## The pull request

- Commit on your branch with clear messages that say what changed and why. End every commit message with this line, after a blank line:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (helpers run on Opus while Fable is at its limit)
- Do not push, do not open a pull request, do not merge. The lead does that after checking your work.
- Do not rewrite history on any branch that exists on origin. Never run `git push --force`, `git reset --hard origin/...` on someone else's branch, or `git stash` (the stash is shared between worktrees; use a WIP commit instead).
- Update the docs your change makes untrue: `docs/rules.md`, `docs/authorization.md`, the area doc, and `docs/walkthrough.md` when a screen or a "who sees what" row changes.

## Your hand-back (your last message, at most 60 lines)

1. The branch name and the list of commits.
2. What you changed, file by file, in one line each.
3. For each item of your task: done, partly done (what is left) or not done (why).
4. The exact result of each check (lint, typecheck, unit, database tests): numbers passed and failed. For each new test: what it proves, and whether you saw it fail before the fix.
5. Anything you decided that the task did not spell out, and anything you noticed but did not change.
6. Screens that now look different, with the address and the role that sees it, so the lead can look.

Report faithfully. If something does not work, say so; do not describe it as done.
