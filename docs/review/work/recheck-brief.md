# Screen re-check before batch 1: the shared brief

Fahad, 17 Nov 2026: "Do not re-audit them all. Before batch 1, re-check only screens that are new or that changed since the audit." This brief is for the helpers doing that re-check. Your own area, accounts and output file are in the message that started you.

Read first: `docs/review/work/audit-brief.md` (what Selah is, the standard a page is judged by, the hard rules, how the capture records work). Everything there applies, except the scope and the hand-back below.

## Scope: only what changed

The Gate A audit (`docs/review/page-audit.md`, captures in `docs/review/shots/phase1/`) stands for every screen that has not changed. Look only at the screens below, in the accounts of your area. If a screen below looks the same as in phase 1 for your accounts, say so in one line and move on.

Changed by batch 0 (all merged on `main`):

| Pull request | What changed on screen | Where to look |
|---|---|---|
| #153 | The signed-out pages: language switch, dead links, waiting-time text, the inquiry review step and focus, the upload page, right-to-left slips | sign-in, sign-in link, invite, confirm e-mail, reset password, inquiry, legal, privacy, upload by link |
| #156 | Privacy fixes: the recommendation page, department meetings, the activity record, the agenda stop-gap, the Departments links, the Files card, the observer on indicators, raw status keys and the page error on meetings, the "6 gaps" line, the assessments tab | `/projects/:id` (Files, Assessments, Meetings tabs, Departments), `/recommendations/:id`, `/meetings/:id`, `/indicators/data` |
| #160 | D6: clients do not see draft actions until the firm releases them. Firm side: a line on a draft "not visible to the client until you release it; comments become visible after release" | `/actions/:id`, `/recommendations/:id`, client homes, notifications, agendas, exports |
| #161 | The remaining screen bugs: one percentage per project, the reminder ladder on finished actions, the departments switch, the meeting hydration error, the note and evidence forms on a consultant-managed client, the inquiry pages, the Team page | `/projects`, `/projects/:id`, `/actions/:id`, `/inquiries`, `/inquiries/:id`, `/team`, notifications |
| #165 | Agenda option C: a department's meeting lists only that department's work; a whole-project meeting opens only for people who may see everything on the project (else "Not found"); the meeting form warns before inviting someone with department limits to a whole-project meeting. Action owners see only their own actions (no titles, no counts of others), and an invited owner may open the meeting and sees only their own tasks on its agenda. Only firm staff link an indicator to a recommendation (client admins lose Link / Unlink) | `/meetings/:id`, the meeting form, `/recommendations/:id` as an action owner, `/indicators/:id` (linked recommendations card) |

Screens of the features still being built (the visibility picker, the org chart, deliverable receipt, the indicator notice) are **not** in this round; each gets its own screen check before it merges and is added to the same section later.

## The material

- New captures, same script and same walkthrough data as phase 1, on `main` after #165: `docs/review/shots/recheck1/<account>/<ar|en>/` (`index.txt`, `pages.json`, screenshots, exactly as described in the audit brief).
- Old captures for comparison: `docs/review/shots/phase1/<account>/<ar|en>/`.
- Code: `C:\Projects\selah-lead` (read only). What each pull request changed: `git -C C:\Projects\selah-lead show --stat <merge commit>` or `gh pr view <n> --json files`.
- The decisions every screen must follow: `docs/review/work/build-brief.md`, section "Decisions already made".

Do not run or sign in to the app, change data or edit code. Read only. You may write exactly one file: your output file.

## What to judge, for each changed screen

1. **Is the change right?** Does the screen now do what the decision says, for every account in your area? A department-limited manager must get "Not found" on a whole-project meeting; an action owner must see no title and no count of other people's actions; a client must see no draft action anywhere; a client admin must have no Link / Unlink on an indicator. Name the screenshot that proves it, or the one that shows it is not so.
2. **Did it break anything?** Wrong language, raw keys, broken right-to-left, overflow at 768 px, console errors, dead links, empty cards left behind where content was hidden, a heading with nothing under it, a count that no longer matches its list.
3. **The screen standard** (batches 1 to 5 will apply it to every screen, so note it here for these): does the page clearly show what it is for and what to do next? One main action per page (one solid button on the first card), fewer visible buttons (rare actions in a menu), plain labels a client understands, Arabic first, speaking to the reader ("your company"), never about "the client". Give the counts from `pages.json` next to phase 1's.
4. **The phase 1 marks for these screens:** for each mark in `page-audit.md` (sections 1 to 3 and 7) that concerns a changed screen, say still true / partly true / fixed, with the screenshot.

## What you hand back

One Markdown file (path in your task message):

1. **One row per changed screen** (route and tab): accounts; what changed since phase 1 in one sentence; right? (yes / no / partly, with the screenshot); new faults; screen standard (main action, controls today vs phase 1, labels); evidence paths relative to `docs/review/shots/`.
2. **Faults found**, most serious first, each with route, account, screenshot and, where you can, the code line. Mark privacy faults (someone sees what they may not) as **blocking**.
3. **Phase 1 marks** on these screens: still true / partly / fixed.
4. **Open questions** for Fahad, if any. Keep it short.

Plain words, short sentences. Be specific: page, account, label, number. If you are not sure, say so. Final message to the lead: at most 20 lines, with the blocking faults first.
