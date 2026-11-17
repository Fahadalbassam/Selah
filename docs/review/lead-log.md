# Lead log

One running record of the review work: each phase, each helper, what it found, what was kept and why, what was thrown away and why. Newest entries at the bottom of each phase.

## Setup (16 Nov 2026)

**Starting point.** `main` at 4497cd3 (#137). Fahad's own checkout (`C:\Projects\selah-fresh`) was one commit behind and is left untouched. No Selah containers were running, so nobody's walkthrough was disturbed.

**My own copy.** A git worktree at `C:\Projects\selah-lead`, started with fresh walkthrough data on its own ports: app http://localhost:3010, mail http://localhost:8035.

**A problem found on the way, and its fix.** The work prompt (section 9.0) says to run scenarios on "your own copy in a separate clone or worktree" with `npm run walkthrough -- --fresh`. With the script as it was, that is not safe: every clone uses the same Docker project name (`selah`), the same data volumes and the same ports. So `--fresh` in a second clone deletes the first copy's data, and two copies cannot run at once. Another project on this machine also holds ports 5432 and 8000, which Selah wants.
- Kept: a small change to `scripts/local.mjs` plus `docker-compose.instance.yml`. Setting `SELAH_INSTANCE=<name>` gives a copy its own containers, volumes and ports (every port plus 10 by default). Without the setting nothing changes. Verified: the second copy came up on 3010/5442/9010/8010/8035/1035/3011/11444 and the walkthrough loaded; the first copy's containers and volumes were not touched.
- Reviewed with the code-review skill: 8 findings, 7 fixed (a settings file is now tied to its copy, so a command run with the wrong or no name stops instead of touching another copy's data; offsets in tens only; every port must be set; the end-to-end suite is skipped in a named copy), 1 left (the port list lives in three places).
- Pushed as branch `tooling/second-copy` with its paragraph in the walkthrough guide. No pull request yet: the `gh` tool on this PC is not signed in.

**Inputs.**
- Section 7 (local model, retrieval, redaction) is filled: Fahad supplied the research outcome as a PDF. Recorded in `docs/review/section-7-model-retrieval-redaction.md`. Nothing in it is built before gate B.
- The three team briefings (handbook, workflows, production path) are in `docs/review/inputs/` on this machine only (kept out of git: they are not product files).
- Not reachable: `plan/selah-simplification-review.html`, the notes under `plan/simplification-review/`, and `research/`. They are not on this PC or in Drive. The audit uses the summary in section 4.1 of the prompt. Asked for at gate A.
- The tracker review (16 Nov) is a Claude document; section 4.2 of the prompt is used as its summary.

**Disagreements between the prompt and the code (the code wins).**
- The prompt says about 49 to 51 pages; the code has 51 `page.tsx` files. Agrees.
- The prompt's section 9.0 setup would have wiped a first copy's data (see above).

## Phase 1: page audit

**Method.** A capture script (`apps/web/scripts/review/capture.mjs`) signs in once per account and follows every link and tab that account can reach, in Arabic and English. For each screen it saves the first screen at 1280x800 and (Arabic) 768x1024, the whole page, and a record: buttons, links, fields, tabs, menu items, what is on the first screen, console errors, and labels left in the other language. It only reads; it submits nothing (except accepting the first sign-in notices for the one account that has never signed in, after capturing that page). Output: `docs/review/shots/phase1/<account>/<language>/` (local, not in git).

Helpers then judge each page from the screenshots and records. A separate helper checks the 18 earlier findings against the code.

The first pass followed links only, so it missed pages behind collapsed sidebar groups, the user menu and the floating cards (`/team`, `/team/expertise`, `/settings`, `/assistant`, the Files and assistant cards). A second pass (`capture-extra.mjs`, output `docs/review/shots/phase1-extra/`) opened those by address for every role. Totals of the first pass: 778 Arabic screens and the same in English across 14 accounts, no capture failed.

| Helper | Task | What came back | Kept / thrown away |
|---|---|---|---|
| Code re-check | The 18 findings and the batch 0 bugs against today's code; sidebar per role, tabs per page, duplicate lists, upload paths, status words; code facts for D1 to D4 | `work/code-recheck.md`. All 18 findings still true in code (only indicator-data code changed since the October review). Today: 9 screens list late or waiting actions (was 6), 7 ways to send a file plus 3 imports (was 5), 120 status labels (was about 68), 11 project tabs. No screen can change an action's owner. An observer has full rights on business indicators. Today is the only cross-client view of follow-ups, meetings this week, decisions waiting and changes. | Kept in full. I checked three claims against the code myself: `policy.ts:159` (`action.assign_owner` has no `client_admin`), no `.tsx` file sends `ownerUserId` for an existing action, and the observer rule in `authorize.ts:53-60` needs a project id, which indicators do not have. All three hold. |
| Firm admin pages | Every page the firm admin reaches | `work/audit-firm-admin.md`. 41 screens judged: keep 20, trim 8, merge 12, replace 1. Project page: 11 tabs, 104 controls counted once, tab row at 517 px when something changed. Proposal: 5 project tabs, client page in 3 tabs, one home, one Actions page with filters. Eight number disagreements listed. Oversight labels projects "off track" by a fixed rule. | Kept. I opened the Oversight and Projects screenshots myself: the "متعثر" label and the "9 actions, 1 verified" bar are as described. Its view that Today should merge into Overview conflicts with the consultant helper (below); resolved in the audit as "one home", name to be chosen at gate A. |
| Consultant pages | Lead, deputy, staffed consultant, observer, second lead | `work/audit-consultants.md`. 39 pages: keep 14, trim 8, merge 13, cut 3, replace 1. The observer is not read-only: 16 working buttons on indicators, plus meeting and assessment buttons that the database refuses. Overview and Today contradict each other. The reviewer's decision is first on the action page only when evidence waits. Firm-run clients: the action page does not say the consultant records for the client. Arabic bell badge prints two-digit counts reversed. | Kept. Its "cut `/team` for consultants" and "merge expertise" verdicts were from code only; held until the second capture is read. |
| Public pages | Sign-in, links, inquiry form, legal, upload link, and the mails behind them | `work/audit-public.md`. 25 rows: keep 21, trim 2, merge 2. No page or mail says which firm it is from (only the upload page does). No language switch on any sign-in page. Dead links behave five different ways. Hydration error on the sign-in link page. No real firm name anywhere (0 hits). | Kept. It left on my copy: one test inquiry, one live upload link, one used sign-in link. Harmless on a review copy; a fresh load before phase 4 removes them. |
| Client admins and managers | Five accounts at two companies | `work/audit-client-admin-manager.md`. 32 rows: keep 14, trim 11, merge 4, cut 2, replace 1 (the home). No home shows the person's job; a department-limited coordinator sees other departments' work in four places; a draft action is visible to client roles; the client admin cannot give work to a colleague; the firm's machinery and wording are all still on client screens; a full replacement table in Arabic and English. | Kept. Its "audit log into a Company settings entry" was not taken: the audit log stays a sidebar row for the client admin, as for the firm admin (fewer moves, same place on both sides). |
| Action owners and first sign-in | Three accounts | `work/audit-action-owners.md`. 19 rows: keep 4, trim 5, merge 4, cut 6. An owner sees other people's actions on a recommendation page, including a firm draft; three send buttons with three effects; the home hides work; a late meeting follow-up is in none of the owner's lists. | Kept, with two changes. I opened the recommendation screenshot: the leak is as described. Its "cut the Files card for owners" was thrown away: `docs/authorization.md` says an owner reaches files shared with them one by one and their department teammates' files through that card, so cutting it would lose access. Its "no project page for owners" was softened to "no Projects row; the project stays behind the link on the action". |
| Independent check | The combined audit (`page-audit.md`) against the screens, the code and the docs: does each cut lose something, does each keep earn its place, do the facts and the decisions hold | `work/audit-review.md`. 39 findings: 8 blocking, 19 should fix, 12 notes. 34 facts checked: most confirmed, 2 wrong, 2 overstated. (It was stopped once by a usage limit and resumed from its saved work.) | Kept almost in full; see "What the independent check changed" below. |

**Found on the way: `main` is red.** `tests/db/assistant-chats.test.ts` seeded an action due on 2026-11-15. From 16 Nov it counts as overdue, so the test sees "2 overdue" instead of 1 and the database suite fails for everyone. Fixed on branch `fix/assistant-test-date` (date moved to 2031; the file's 35 tests pass). Pushed; the pull request is waiting on GitHub sign-in for the `gh` tool on this PC (asked at gate A). Many other database tests use fixed dates in December 2026 to March 2027; some may fail the same way as those dates pass. Listed as a batch 0 item.

**Test run on my copy** (for the second-copy tooling change): lint, typecheck, 473 unit tests, upload-scan tests and AI service tests pass. Database tests: the one above fails on `main` too; `sign-in-links` timed out once under load and passed when run alone.

### What the independent check changed

I checked its four heaviest claims in the code before acting (the hand-over dialog on Team, who may use it, the third-date-move rule in `docs/rules.md`, the "everyone accepts all three notices" rule in `docs/accounts.md`). All four hold. The first draft of the audit was wrong or incomplete in these places, and `page-audit.md` now says:

| # | First draft said | Wrong because | Now |
|---|---|---|---|
| 1 | No screen lets anyone change an action's owner; a client that loses a person is stuck (U08, D1). | Team already hands over all of a leaver's open actions to a colleague, for the firm admin and the client admin. | U08 is "partly true": what is missing is moving one action. D1 asks only about that. |
| 2 | "Everything Overview holds has a place." | The client home's indicators card, per-department table and report PDF had no new home. | They stay on the client home, below "waiting for you". |
| 3 | `/notifications`: the list alone. | That drops the firm admin's "Problems reported by clients", the only place to read and close a client's problem report. | It moves to the firm admin's home. |
| 4 | Action owner: no Projects row, a home with nothing but actions. | Document requests and meeting invitations addressed to an owner would be reachable only from the bell; it also contradicts the UI guidelines. | The owner keeps Projects; the owner home adds documents asked of me, meetings to answer, my follow-ups. |
| 5 | The Departments section is hidden while departments are off. | That hides the client admin's only switch to turn them on. | While off, the admin sees one line and the switch. |
| 6 | The Assistant row shows "only when on" and opens the card. | The client admin would have no route to give, read or withdraw consent. | The row shows as soon as the firm offers; "Assistant consent" in the user menu. |
| 7 | Needs attention becomes chips "late, awaiting review, blocked, disputed". | Four of the six rules (no activity, date moved twice, sent back twice, no active owner) had no home. | All six rules are named as chips on Plan and filters on Actions. |
| 8 | Managers lose Team and Departments and read "who is who" on the project's People tab. | That tab shows a manager only the named roles; nothing would show who heads a department. | Managers keep one read-only People row (people and departments), instead of two. |

Also taken from it: D9 (now D8) restated, because the first recommendation contradicted what the client's own Departments page promises; "a meeting opens only for its invitees" removed from the bug batch, because it was a new access rule (the real bug is that meetings skip the department check); D10 dropped as a decision, because the rule is right and only one screen text is wrong; the consequences of D5, D6 and D4 written out; D3 changed to keep "Verified" apart from "Closed"; "hide the AI notice from people with no assistant" dropped, because a recorded rule says everyone accepts all three notices; the batch order fixed so no batch removes something a later batch replaces; the capture counts corrected.

Not taken: nothing was rejected outright. Three of its notes are recorded but not acted on in phase 1: the low-confidence note that the Assistant row looks active in the second capture (likely the capture itself), the browser's own "Choose File" text on the Arabic upload page, and the recount of "ways to send a file" and "status labels" (the definitions are in `work/code-recheck.md`).

**Phase 1 ends here, at gate A.** Waiting for Fahad's answers to D1 to D8 in `page-audit.md` section 6.

## Gate A answers (17 Nov 2026)

| Decision | Fahad's answer | What it means for the work |
|---|---|---|
| D1 one action to a colleague | Yes | Client admin, and the project's coordinator and sponsor. Batch 4. |
| D2 Trace, Today, Oversight | Yes | Trace removed in batch 3; Today becomes the home and Oversight the Actions filters in batch 2. |
| D3 status words | Yes, six words | Verified and Closed stay apart. Batch 5. |
| D4 observer and indicators | Yes | A consultant changes indicators only when staffed (not as observer) on one of the client's projects, or as lead or deputy. Batch 0. |
| D5 "Off track" label | Yes: show counts in place of the label | Reverses feature F18; the weekly history keeps counts. Batch 2. |
| D6 drafts and clients | Yes: clients do not see draft actions until the firm releases them | This reverses the earlier behaviour. Every screen, e-mail, export and assistant answer that relied on it is found and fixed together, and listed here when done. Moved into batch 0, because it is a wrong-person fix. |
| D7 the firm's name on signed-out pages and mails | Yes, from the firm's own record, never from the code | Batch 1. |
| D8 department limits | Rule accepted: a department-limited person sees nothing by title from other departments. Fix the four leaks now, in batch 0. | The agenda rebuild waits: Fahad wants the two options side by side, with what each costs and leaves visible, and answers that part only. Until then the leak is closed without a rebuild (the stored agenda's lists are not shown to a reader with limits). |

Also from Fahad:
- **Order.** Batch 0 first and finished fully before batch 1. The wrong-person leaks are privacy bugs and come before any tidying. Every leak gets a test so it cannot come back.
- **Merging.** A pull request may be merged once CI is green and a code review finds nothing blocking. No production changes, no rewriting git history.
- **GitHub.** Permission to run `gh auth login --web` on this PC; he finishes the sign-in in the browser. Then pull requests for the three pushed branches.
- **Inputs.** He will copy the October review and the research folder into `docs/review/inputs/`. When they are there: check the audit against the full review and report only what changes.
- Then continue to the next gate.

Batch 0 is larger than "one or two pull requests": it is split by area so that each can be reviewed on its own (privacy leaks; drafts; on-screen bugs; signed-out pages; test dates).

## Batch 0 (started 17 Nov 2026)

**Pull requests.** GitHub sign-in done by Fahad. #150 (the broken test date) merged after green checks and a code review with no findings. #151 (second copy) and #152 (audit files) were red only in the database check, because `main` still had the broken test; `main` was merged into both branches (no history rewritten) and their checks are running again.

**A failure, explained.** The first full test run on my copy ended with "failed". Two database tests failed: one because of the fixed date (a real fault on `main`, fixed in #150), one because it timed out while the page captures were using the machine (it passes when run alone). The independent reviewer also stopped once at a usage limit and was resumed from its saved work. Neither left anything broken.

**Inputs arrived.** Fahad copied the October review (`plan/`) and the `research/` folder into `docs/review/inputs/` on 17 Nov. A helper is checking the audit against the full review; only what changes will be reported.

**Builders, wave 1** (each in its own working copy with its own test database; briefs follow `work/build-brief.md`):

| Builder | Branch | Task | Status |
|---|---|---|---|
| Privacy leaks | `batch0/privacy-leaks` | Recommendation page, department meetings, the activity record, the agenda (closed without a rebuild), the shared report, the Departments links, the observer on indicators (D4), raw status keys and the page error on meetings, the "6 gaps" line. A test per leak that fails without the fix. | running |
| Signed-out pages | `batch0/signed-out-pages` | Language switch, dead links, the waiting-time text, the page source size, the inquiry review step and focus, the upload page, right-to-left slips. | running |
| Test dates | `batch0/test-dates` | Every test whose result depends on a fixed date that will pass. | running |

Wave 2, after the privacy builder is merged (both change the database rules): drafts hidden from clients (D6), and the on-screen bugs.
