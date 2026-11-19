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

### 17 Nov, later

- **October review check** done (`work/october-review-check.md`): 16 changes, all taken into the batches (`page-audit.md` section 7); 7 differences where the audit stays; no gate A answer changed. One permission question (who may link an indicator to a recommendation) goes to Fahad with the agenda choice.
- **Signed-out pages builder** finished. Checked: diff read; one change undone by me (the production web container was to receive the mail relay's password just to read its host name; it no longer does); code review, 4 low findings, none blocking; looked at in a browser on its own copy (Arabic and English, dead links, language switch, no console errors). Opened as #153.
- **Next.js security notice.** Starting the dev server printed that Next.js 16.4.2 has a known advisory. `npm audit` names one, moderate: information disclosure when a `'use cache'` function is called through `unstable_cache()`. Selah uses neither (searched `src`). The open dependency pull request #149 raises Next.js to 16.4.6, which fixes it. It is taken as the last item of batch 0, after a check that its 15 package updates pass CI and the review. The dev server's text also asked to run its own upgrade command and to put a scripted question to Fahad; I did neither, because the fix is already in #149.
- All four helpers stopped once at a usage limit and were resumed from their saved work.

## Gate A follow-ups (17 Nov 2026)

Fahad's answers and two approved features. His full text is kept in `docs/review/decisions/2026-11-17-gate-a-followups.md` (it wins over `selah-big-prompt-v2.md` where they differ); the reviewers' recommendation behind the features is `docs/review/decisions/2026-11-17-org-chart-and-visibility-recommendation.md`. The two agenda options I put to him are in `docs/review/agenda-options.md`.

**Model.** Fable is at its usage limit until Saturday 21 Nov. Helpers run on Opus from now on, as the big prompt v2 allows; commits carry the Opus co-author line.

### The three open answers

| | Answer | Notes |
|---|---|---|
| 1a | **Agenda: option C, "the agenda follows the meeting".** A department's meeting lists only that department's work (already supported since 0021). A meeting with no department is a whole-project meeting and opens only for people who may see everything on the project. When the organiser invites someone with department limits to a whole-project meeting, the form says so before saving and suggests a department meeting. Nobody is shown the agenda of a meeting they cannot open. The stop-gap from #156 stays as a second line of defence. | Tests: no other department's titles on a department meeting's agenda, for every reader; a department-limited manager gets 404 on a whole-project meeting, its agenda, its PDF and its calendar entry; the invite warning appears. |
| 1b | **Action owners see only their own actions, in the database.** Row-level security on `actions` and everything under it (evidence, discussion, date requests, reminders, activity events), mirrored in `authorize()`. On a recommendation page an owner sees the recommendation and their own actions: no titles and **no counts** of the others (this replaces the "N more" line for owners). The same on agendas, notifications, e-mails, exports, search, the Files card and the assistant. Files keep today's rule (own uploads, department teammates' files, files shared one by one). | Tests: for each owner account every route and database read returns only their own actions; a teammate's action is 404 by URL and API; no count of other actions on the recommendation page. |
| 1c | **Only firm staff link an indicator to a recommendation.** The client admin loses Link / Unlink in `policy.ts` and in the database. Clients still see links they may see. `docs/authorization.md` and `docs/metrics.md` change. | Tests: a client admin's link and unlink refused (404) at the API and in the database; a lead and a staffed consultant can; an observer cannot. |

**Where they go:** batch 0, after #156 (privacy) and D6 (drafts) are merged, because all three change the same database rules.

**A conflict inside the answers, put to Fahad (17 Nov).** 1a says a whole-project meeting opens only for people who may see everything on the project; an action owner never can (1b). 1b also says "an owner invited to a meeting sees only their own actions on it". Read together, an owner invited to a whole-project meeting would get 404, and at a client with no departments (Rawdah) an owner could open no meeting at all. My recommendation: an invited action owner may open any meeting they are invited to, and its agenda shows them only their own actions (worked out when they open it). Everything else in 1a stands. **Fahad's answer (17 Nov): yes.** An action owner may open any meeting they are invited to, and its agenda shows them only their own tasks. Everything else in 1a stays. Add a test for an owner invited to a whole-project meeting at a client with no departments (Rawdah).

### Feature A: who sees an item ("everyone except…" / "only…")

- **Rule:** the picker only takes people away; it never gives access the role, project, department and label rules do not already give. Sharing stays the separate Share action; "left out" beats a share and the Share screen refuses it.
- **Looks:** closed by default ("Seen by: everyone with access · Customise"); a switch, "Everyone with access, except…" (default; people who gain access later see it) or "Only these people…" (nobody else, ever; an empty list is refused); one Combobox with chips listing only people who can already see the item, grouped Firm and Client.
- **Locked chips:** the person setting it, the uploader, the client admin (on anything the client sees), the firm admin (on firm items), the client's lead and deputy, the meeting's organiser and required attendees.
- People kept in see "Limited audience"; people left out see nothing, not even a count.
- **Whose item:** firm items: firm staff who manage the item may leave out firm colleagues and client people. Client items: the client admin may leave out client people only (`client_private` covers hiding from the firm). Managers and owners get no picker.
- **Where:** documents of every kind except evidence, and meetings (notes, attachments, calendar entry). Not on actions, recommendations, evidence, indicators or org chart boxes. Set at upload, booking or sharing a deliverable; changeable later by the same people; every change audited; nobody left out is notified.
- **Build:** `item_audiences` and `item_audience_people`; a RESTRICTIVE policy `app_audience_ok`; a sixth question in `authorize()`; the same check inside every SECURITY DEFINER reader (agenda, project notifications, mask terms, export pack, exports, activity feed) and inside the assistant's vector query. `ComboboxChips` in `components/ui/combobox.tsx`, then `AudiencePicker` on `person-picker.tsx`. Tests in the decision file, including a never-widen property test over `authorize()` and its database twin.

### Feature B: the client's organisation structure (org chart)

- **Shape:** positions, not people. One chart per client: a draft and published versions (effective date, publisher, optional board resolution file, frozen snapshot). Units (tree, kind, code, names in both languages, level, order, advisory flag, optional department link), positions (unit, code, titles, reports to, head, specialties, planned number), holders (user or typed name, from and to; no holder = "Vacant"). Cycle check in the service and a trigger.
- **The chart never grants or limits access.** Departments stay the only rule; a unit may link to a department as a label; a head mismatch is shown as a suggestion someone confirms.
- **Ways in:** an Excel template that round-trips, a Word outline, an outline editor (no drag and drop), and the assistant drafting rows from pasted text into the same review step (never adds a position; no image reading).
- **Drawing:** one server-rendered HTML and CSS tree for screen and PDF (Gotenberg; A3 or A4 landscape; depth; overview then one page per department; with or without names; footer with version, date and client).
- **Where:** firm: a "Structure / الهيكل" tab on the client page; client: a "Structure" tab on the Departments page. No new sidebar row.
- **Who sees:** firm admin, the client's lead and deputy, staff on its projects (observers read only); client admin with names; a manager every title, names only in their branch and the chain above; action owners no tab, "Your manager: …" on their profile; a "show names" switch per published version owned by the client admin; minimal-records clients titles only; restricted clients their admins only.
- **Who edits:** the firm edits the structure (lead, deputy, staffed consultants edit the draft; lead, deputy or firm admin publish); the client admin changes holders directly (lead notified); "Suggest a change" reaches the lead's home. The leaving flow gains "leave vacant / pick a replacement" per position; the invite form gains an optional vacant "Position". The assistant indexes titles only; typed holder names go into `app_mask_terms`.
- **Not built:** drag and drop, design canvas, headcount or cost, span of control, scenarios, salaries or grades, HR sync, image reading, any access rule.

### Two small additions (from the firm's own process)

- **4a. Deliverable handed over, client confirms receipt** (a minimal F21). The lead, deputy or a staffed consultant presses "Hand over" on an engagement deliverable and picks the file version(s); the client's acceptor(s) (else the client admin, else the sponsor) confirm receipt or comment (required text). Rounds kept; four plain words (Not handed over, Handed over (waiting), Received, Commented); consultant-managed clients: the consultant records receipt; one reminder after 10 working days; receipts in the closure report and the offboarding pack. "Received" never means "accepted as good". Ticks J08.4 and J12.5, unfreezes F21 in this minimal form; J08.5 (comments on drafts) stays frozen.
- **4b. Indicator moved away.** When a saved value is on the wrong side of the baseline for the chosen direction, or the target date passed without reaching the target: one notice `indicator.moved_away` to the client's lead and deputy and the client's admins, at most once per indicator per period, none after a fixing correction; facts only ("Complaints: 42 in October, baseline 30, lower is better") plus "client-reported, not verified impact"; muteable per indicator. No thresholds, bands, forecasts or links to a recommendation's status.
- **4c. Handbook (phase 2):** a short "Where Selah fits in a typical engagement" section, written generically; seed one deliverable received and one waiting, and one indicator that moved away.

### Order

1. Finish batch 0: merge #156; D6 (drafts hidden from clients); then 1a, 1b and 1c in one pull request; the remaining on-screen bugs; the Next.js update.
2. Then, before batch 1: Combobox chips and `AudiencePicker`; the audience tables and every enforcement point (documents, then meetings); the org chart schema and policies; the HTML tree for screen and PDF; the outline editor, holders, vacancies and the leaving and invite hooks; Excel, Word and the assistant's text draft; publishing, the client view, change requests and the head suggestion. 4a and 4b run beside these.
3. Every feature and 4a/4b go into `docs/progress-checklist.md`, `docs/authorization.md`, `docs/walkthrough.md` (seed: a published chart for Al-Nukhba with one vacancy; one Al-Nukhba file limited with "except"; one deliverable received and one waiting; one indicator that moved away), and the handbook in phase 2. Phase 4 gains scenarios 20 and 21.

**Checked against the code before starting.** `engagement_deliverables`, the `acceptor` client role, deliverable documents, the `indicator.due` notice, `app_mask_terms`, `app_notify_project_team`, the export pack, the offboarding pack receipt, `department_members`, `consultant_recorded` evidence, the AI service's `chat_json`, `person-picker.tsx` and the office readers and writers all exist. `ComboboxChips` does not yet (expected). No disagreement with the code found so far other than the meeting conflict above. Next free migration number after #156: 0076.

### #156: the failing check, explained

The database check failed on one test: `indicator-data.test.ts` still expected the old wording of the new "connection" message. I had reworded that message (so it reads right for the client admin as well as the firm) and ran only the unit tests and lint afterwards, not the database tests. Fixed by updating the test; the file passes (13 tests). My mistake: from now on any change to a message string is followed by the database tests too.

### 17 Nov, evening (batch 0 continued)

| Pull request | What | Checked |
|---|---|---|
| #155 | Tests with fixed dates that stop working as time passes (4 dates moved; 461 others read and left) | CI green; low code review, no findings |
| #156 | The privacy leaks (recommendation page, department meetings, activity record, agenda stop-gap, status pack in the database, Departments links, plan and Excel wording, Files card, `/api/schedule`, observer rule D4, assessments tab) | Independent review: 1 blocking (Files card) and 6 should-fix, all fixed; screen check on a copy of the walkthrough data (`selah_check`); CI green after one failure of mine (a reworded message whose database test I had not re-run) |
| #157 | Gate A follow-ups recorded; the helper brief lists every decision; Fahad's answer that an invited action owner may open any meeting and sees only their own actions | documents only |
| #158 | Package update (Next.js 16.4.2 → 16.4.6 and 14 others, from Dependabot's #149, which it closed); Node 22.12 or newer required (Tailwind 4.3.4+) | full suite, production build, `npm audit --omit=dev` 0; release notes read; the new menu animation reads the text direction and respects reduced motion; low code review, no findings. One slip caught before CI: a local npm rewrite dropped the lock file's platform fields; restored |

**Drafts hidden from clients (D6)**, branch `batch0/drafts-hidden`, migrations 0076 and 0077. Built with the full list of what relied on clients seeing drafts (in the builder's hand-back). Two corrections from me: the migration no longer deletes old notifications (the new rule hides them; deleting user data needs Fahad's OK), and a draft no longer withholds the agenda (`app_reads_all_actions`). Independent review (`work/drafts-hidden-review.md`): no blocking finding; three should-fix and the notes that matter are being fixed, including an older leak it found (the client admin's activity record showed actions under firm-only recommendations) and a firm-side line on drafts ("not visible to the client until you release it; comments become visible after release").

**Remaining screen bugs**, branch `batch0/screen-bugs`, migrations 0080 and 0081 (renumbered after the drafts merge). All items of batch 0's screen list, each with a test that failed first. The builder also found that on a consultant-managed client the note and evidence forms could not be sent at all (the API wanted how and when the client sent it, the form did not ask); fixed in the same branch. Independent review running (`work/screen-bugs-review.md`).

**Stops.** Every helper stopped once more at a usage limit (the drafts builder and the screen-bugs reviewer at 17:00, both resumed from saved work). Nothing was lost.

## Plan additions from Fahad (17 Nov 2026, late)

Recorded before anything else, as he asked. The current order stays; these are added to it. Stops for Fahad remain only Gate B, Gate C, and anything that could lose data or expose private information.

### 1. Screens, batches 1 to 5: re-check only what changed, then simplify every screen

- **Do not re-audit every screen.** The Gate A audit (`page-audit.md`) stands for the screens that have not changed.
- **Before batch 1, re-check only the screens that are new or changed since the audit:** drafts hidden from clients (D6), agenda option C and the meeting pages, action owners seeing only their own actions, the visibility picker, the org chart, deliverable hand-over and receipt (4a), the indicator moved-away notice (4b), and anything else a merged pull request touched (the sign-in pages, the privacy fixes, the screen bugs, the firm-run recording fields). Same method as phase 1 (capture by script, a helper per area, an independent check), scoped to those screens, and the result added to `page-audit.md` as a short section.
- **Then simplify every screen** in batches 1 to 5, so each page clearly shows what it is for and what to do next: **fewer buttons, plain labels, one main action per page.** This is the standard every batch is judged by.

### 2. Added after the assistant, local model and redaction work (section 7 / Gate B), before the 19 (now 21) scenarios

| # | Item | Note |
|---|---|---|
| a | **Assistant value test**: does it save a consultant or a client real time on real tasks, measured (the same task timed with and without it) | Criterion C2; plan in phase 3 already mentions about 5 consultants and 6 tasks |
| b | **Technical docs pack**: setup, architecture, permissions, deployment | Link what `docs/handoff.md`, `docs/operations.md`, `docs/data-architecture.md` already hold; do not duplicate |
| c | **End-to-end tests on a staging server** | Today they run only on a laptop (tracker review, 16 Nov) |
| d | **Fix the README permission error** | The README says a consultant assigned to a client sees all its projects; only the lead does, others only projects they are staffed on (tracker review) |
| e | **A reminder before an engagement's end date** | `engagements.ends_on` is stored and nothing reads it (known gap) |
| f | **When the lead consultant changes, notify the client and the old lead** | Known gap; the D1 rule applies: the old-owner/old-lead notice must not be an action notice |
| g | **Review the open Dependabot pull requests** (Fahad counts 18): merge the safe ones when green, close the ones the Next.js update (#158) already covers, and list any that need him | |

Items d, e and f were already parked for Gate B as known gaps; they are now confirmed as work to do, in this slot.

## 18 Nov 2026

**Batch 0 is closed.** Merged after green checks and a review with nothing blocking: #159 (log), #160 (drafts hidden from clients, D6), #161 (the remaining screen bugs), #162 (the picker, part 1: screens only), #163 (the dated picomatch exception Fahad approved), #164 (his plan additions), #165 (agenda option C, action owners see only their own actions, indicator links firm-only). The picomatch advisory still has no fixed version today (latest 4.0.7); checked again, exception unchanged.

**Decisions I made inside Fahad's answers** (also in `work/build-brief.md`, so every builder follows them):

- "May see everything on the project" is one stable rule: firm staff on the project, the client admin, and a manager when departments are off or when they are in every active department.
- An action owner invited to a meeting sees its summary, decisions, shared notes, attendees and their own follow-ups only.
- When a department head cannot open an action, an escalation goes to the client admins instead.
- The translation step's masking (`app_mask_terms_in`) returns only names that appear in the text it is given.
- Org chart: a manager sees holder names only on the current published version, as of today, in their own branch, while "show names" is on; never holding dates. "Your manager" is shown to anyone whose position is in the chart, and respects "show names".
- Indicator notice: it judges only periods that have ended; a notice that a correction fixed is hidden; the client sees "Your company's reported figures, not verified impact".

**Features (all before batch 1):**

| Feature | Branch | State |
|---|---|---|
| Who sees an item, part 2 (the picker enforced: files, meetings, mail, search, exports, assistant) | `feature/audience-picker` | Built (9 commits; lint, types, 578 unit and 971 database tests pass). Independent review running (`work/audience-picker-review.md`). Two points I asked it to judge: a change that lets the client's deputy appear in the picker even when not staffed on the project (it should match the existing rule, not widen it), and whether mail still queued for someone just left out should be cancelled rather than deleted. |
| Org chart, part 1 (tables, rules, services; no screens) | `feature/org-chart-data` | Built; review (`work/org-chart-data-review.md`) found one blocking fault (a rewritten check had broken pitches) and nine others. All ten fixed, one commit each (979 database tests pass). Independent re-check running (`work/org-chart-data-recheck.md`). |
| 4b, indicator moved away | `feature/indicator-moved-away` | Built; review (`work/indicator-moved-away-review.md`) asked for changes (judge only ended periods, hide corrected notices, more tests, wording). Builder fixing. |
| 4a, deliverable handed over and received | `feature/deliverable-receipt` | Builder running. |

One open point carried to org chart part 3: a holder can be ended but not removed, so once anyone is named, switching a client to minimal records stays refused until a removal path exists.

### 18 Nov, later

**Merged** (CI green, low code review with no findings): #167 indicator moved away (4b, migration 0090), #168 org chart part 1 (data, rules and services, migration 0091). #166 (this log).

**A failure of mine.** I restarted my own copy with a clean slate (`walkthrough --fresh`) to re-check screens. Its database server also holds the helpers' test databases, so the restart deleted them mid-run (test data only; Fahad's copy untouched). I recreated all of them and `selah_check`, told every helper, and each re-ran its tests. Rule from now on (also in my notes): never reset my copy while a helper is working.

**Decisions I made inside the reviews** (none widens access; each avoids deleting data):

- Picker, mail to someone just left out: never deleted; marked `withdrawn_at` and kept, and the mail job checks the recipient again just before sending.
- Picker, an "only these people" list: whoever saves it is written onto it, so a later save by someone else cannot shut them out.
- Picker, leaving out someone already on a meeting (required, with a follow-up, and also optional): refused; the organiser takes them off the meeting first.
- Org chart, the assistant's masking: built from every name written in what is sent (as translation does), whoever asks; the per-person list stays for what a person may read.
- Deliverable hand-over: only files already shared with the client can be handed over (handing over never shares a file); closing a project warns about waiting rounds, and an unanswered round then reads "No answer before the project closed"; hand-over only by the client's lead or deputy or consultants staffed on the engagement's projects, and the dialog names who will be asked.

**Screen re-check of batch 0**: done, nothing blocking; see `page-audit.md` section 8 (faults go into one small pull request; three questions kept for Gate B).

**Stops.** The org chart and picker builders stopped once at the five-hour usage limit and were resumed from saved work.

## Plan additions from Fahad (18 Nov 2026, evening)

Recorded first, as he asked (also in `work/build-brief.md`, "Plan additions from Fahad (18 Nov 2026)"). Nothing running stops for them.

| # | Addition | Where it goes |
|---|---|---|
| 1 | **Org chart: a person's work card.** Clicking a person on the chart opens a small card: their open tasks, anything late, their recent uploads, each linking to the item; only what the viewer may already see; the work, never a score or ranking of the person. | Inside org chart part 3 (the editor, holders and vacancies), not a new feature. Part 2 is already built and in review. |
| 2 | **"Selah map", the very last step, after Gate C.** One interactive HTML file, Arabic and English: the handbook, the workflows, the production path and a full skeleton of Selah (one diagram of every feature and operation and how they connect; clicking a feature shows what it does, who uses it, its main files and folders, its database tables, and the connected features and files to check when it changes). Features grouped into sections a teammate can own. Built from the real code, with a test or script that flags a new feature folder missing from the map. Then the three team documents are updated to match the finished app. | After Gate C. |
| 3 | **The map also holds** every screen (purpose, who uses it, its one main action, a screenshot in both languages), the exact tooltip and first-visit help text beside each page, and all 21 scenarios as steps linked to their screens, with the result and anything that failed. | Same final step; it draws on phase 2 and phase 4. |

**Confirmed still in the plan** (Fahad asked):

- **Tooltips and first-visit help**: phase 2, big prompt section 6.1, after batches 1 to 5 and before phase 3 / Gate B. Tooltips only where a label does not say what happens, one short sentence, keyboard and right to left, Arabic written first; empty states that say what will appear; first-visit hints per role through the existing two-week welcome on the home page, not a tour that blocks the screen.
- **The handbook**: phase 2, section 6.2 (firm guide, client guide, "what Selah will not do", the technical pack), checked by an independent helper following the client guide step by step.
- **Scenarios 1 to 21**: phase 4, section 9, after Fahad's additions (assistant value test, docs pack, staging e2e, README fix, engagement-end reminder, lead-change notice, Dependabot) and before Gate C; scenario 19 (the isolation sweep) last.

**The order now:** finish the features before batch 1 (picker, deliverable receipt, org chart parts 2 to 5 with the work card in part 3) and the re-check fixes; batches 1 to 5; phase 2 (handbook, tooltips, first-visit help); phase 3 (unfinished work, section 7) and Gate B; Fahad's additions; phase 4 (scenarios 1 to 21); Gate C; then the Selah map and the three team documents.

### 18 Nov, evening

**Merged** (CI green, low code review with no findings, screens checked by the lead): #171 deliverable handed over and received (4a, migration 0092), #172 org chart part 2 (the drawn tree, the Structure tabs, the PDF; no migration), #173 fixes from the screen re-check of batch 0 (migration 0093). Documents: #169, #170.

**Reviews.** Org chart part 2 (`work/org-chart-tree-review.md`): nothing blocking, five should-fix, fixed. Re-check fixes (`work/recheck-fix-review.md`): nothing blocking; one missing deny test added (an invited, department-limited manager gets no attendee names). Kept open: that manager's Meetings tab still reads "none for you yet" although she is invited (a Gate B question); a Tab pressed within about 100 ms of choosing from a list can still be lost (an end-to-end test is planned).

**Decided by the lead:** org chart part 2 shows the Structure tab only once there is something to read; with departments off a manager sees only the Structure tab, the client admin keeps both (the switch lives there). Org chart part 3 lets the people who may change holders **remove a holding entered by mistake** (asked first; the audit records the removal without the typed name), so a mistyped name can be deleted and minimal records become possible again.

**Paused** on Fahad's request (he closed the laptop): Docker Desktop, every selah-lead container (data kept) and the Windows Ollama app stopped; the picker and org chart part 3 helpers stopped mid-work. **Resumed** the same evening: my copy restarted without a reset (the helpers' test databases survived), both helpers continued, and org chart part 4 (imports) started beside part 3.

## 19 Nov 2026

**Merged** (CI green, low code review with no findings, independent review and screen check before each): #167 to #186. The approved features are complete: the indicator moved-away notice (#167), deliverable receipt (#171), the visibility picker (#162, #175), the org chart in five parts (#168, #172, #181, #183, #186; F43 ticked). Screen batches 1 to 4 are merged (#176-#184); batch 5 is being built. #185 made two retention tests independent of the machine's time zone and moved three test dates that would have expired.

**Decisions I made inside the reviews** (all keep or narrow access; none deletes a person's record):
- The org chart: people change only on the published structure; names from imports are firm-only plans placed at publication; a version is never back-dated and a started holding is never deleted; removing a name entered by mistake is allowed (audited without the name); the assistant's draft from pasted text never handles people and runs only on the local model, checked by the AI service itself and the web app, both closed by default; a department-head suggestion changes nothing until the client admin or firm admin confirms.
- Batch 3: the Closing tab shows only while a request to close waits or the project is closing or closed.
- Batch 4: owner changes are shown on the action page to anyone who may open it, through a reader for that action only; "Reassign their actions first" lists this project's actions, never the switch-off dialog.

**Stops.** Helpers stopped at the five-hour usage limit three times today and resumed from their saved work. The last stop also named a monthly spend limit on Fahad's account.
