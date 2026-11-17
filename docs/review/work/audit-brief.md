# Page audit: the shared brief for helpers

You are one helper on a page-by-page audit of Selah. Read this whole file before starting. Your own task (which area, which accounts, which output file) is in the message that started you.

## What Selah is

Selah connects a consulting firm and its clients after the consulting report is written. The one mental model every screen should follow:

> A client has projects. A project has recommendations. Each recommendation has actions. Each action needs evidence that the firm reviews.

Everything else (contract, finding, assessment, request, indicator, meeting, report, file) should appear as part of one of those four, not as a page beside them.

Roles. Firm side: firm admin; consultant (per client: lead or deputy; per project: staffed or observer). Client side: client admin; client manager (may be the project's sponsor or coordinator); action owner.

## The standard a page is judged by

A user should open a page and know **in ten seconds what it is for and what to do next**. Every page must earn its place.

Hard rules of the product (a page that breaks one is a finding, whatever else is good about it):

1. **Selah never does the consulting.** It does not write recommendations, judge governance, rule on legal compliance, approve evidence or score a client on its own. Humans decide; Selah records, reminds, shows and helps find things. A neutral computed fact ("3 actions are late") is fine. A judgment made by the app ("this project is unhealthy", "risk: high" with no human behind it, an AI text shown as a decision) is not.
2. **Arabic, right to left, first; English on everything.** Nothing left in the wrong language, nothing mirrored wrongly.
3. **No mock or pretend content.** Every number must trace to real data. No "coming soon".
4. **Client screens use plain words** and never show the firm's machinery (triage, conflict check, staffing, internal notes, scores, review queue wording).
5. **The partner consulting firm is never named.** The demo firm is the fictional "Mizan Advisory / ميزان للاستشارات", which is fine.
6. **UI rules** (docs/ui-guidelines.md): monochrome with muted status colours; grey page with card surfaces; at most one solid (black) button per card or dialog; desktop and tablet only (768 px and wider); firm-only content on firm screens carries a lock or a "firm only" label; green only for human-verified work.

## What an earlier review found (30 Oct 2026)

Verdict then: the data model is sound; the screens show all of it at once. Numbers then: 93 buttons and menu items on one project page for the firm admin; 11 tabs, starting at 535 px of a 900 px screen; 6 screens listing the same late or waiting actions; 5 ways to send a file across two request systems; about 68 status words; 49 pages where about 30 would do.

The 18 findings:
- U01 six screens list the same late actions
- U02 project page with 11 tabs and ~93 controls
- U03 action page with three uploads, three text boxes and the wrong "next step"
- U04 client homes that don't show the client's job, with counters that contradict the list
- U05 five ways to send a file
- U06 "Add recommendation" in four places, findings shown as step one
- U07 the firm's client page is a dashboard plus ten settings cards
- U08 a client admin can invite a colleague but cannot give them work
- U09 long sidebars showing admin tools to everyone
- U10 about 68 status words and one Arabic word for several approvals
- U11 clients see the firm's machinery
- U12 firm vocabulary on client screens
- U13 people and roles in four places
- U14 meeting page shows everything before the meeting happens
- U15 dense rows where every rare action is a visible button
- U16 inquiry page with five cards each claiming to be the next step
- U17 Help page is a second home page
- U18 lists that hide what matters

Bugs noted on the way ("batch 0"): raw status keys on the meeting agenda; three different percentages for one project; a reminder ladder with past dates on finished actions; a departments switch drawn "off" while on; a hydration error on the meeting page.

Planned fix order then: batch 0 the bugs; batch 1 hide the firm's machinery from clients (U11, U12, U14, U15, U17); batch 2 one home and one sidebar per role (U01, U04, U09); batch 3 the project page rebuilt around the plan, 11 tabs to 5 (U02, U06, U13); batch 4 one way to send a file, one action page (U03, U05); batch 5 tidy the client page, inquiries and the vocabulary (U07, U10, U16, U18).

Some of this may already be fixed. Part of your job is to say, for the pages in your area, whether each finding is **still true, partly true or fixed today**, with the screenshot that shows it.

## The material you work from

A capture script already opened every page and tab each account can reach, in Arabic and in English, on a fresh copy of the walkthrough data. You do not need to run the app. Do not sign in anywhere, do not change any data, do not edit code.

For each account: `C:\Projects\selah-lead\docs\review\shots\phase1\<account with @ written as _at_>\<ar|en>\`

- `index.txt`: one line per captured screen: number, address, tab, status, title, counts, length in screens, where the tab row starts, number of console/network events, and the screenshot file name. **Start here.**
- `pages.json`: the full record per screen: `counts` (buttons, links, fields, tabs, menu triggers in the page body, not counting the sidebar or the top bar; `...Above` = on the first screen), `buttonLabels`, `tabLabels`, `menus` (the items behind each menu button) and `menuItems`, `headings`, `firstScreen` (the text on the first screen), `screens` (page length in 800 px screens), `tablistTop`, `sidebar` (the sidebar entries this role sees), `topbar`, `strayLanguage` (labels that look like the other language: check them, user-written data such as names is not a fault), `rawKeys` (text that looks like an untranslated key), `events` (console errors, failed requests), `tablet` (overflow and length at 768 px), `loadMs`.
- Screenshots: `NNN-name-1280.png` is the first screen at 1280x800; `NNN-name-1280-full.png` is the whole page; `NNN-name-768.png` (Arabic only) is the first screen at 768x1024. Open them with the Read tool. **Look at the Arabic first screen of every distinct page in your area**; open the full page and the tablet and English ones where the record suggests a problem or the page is long. You may skip repeats of the same page for a second account when the record shows the same counts and headings.

The same page looks different per role, so compare roles: what does this role see that it should not, and what is it missing?

Code is at `C:\Projects\selah-lead` (the web app is `apps/web`; pages under `apps/web/src/app`; texts in `apps/web/messages/ar.json` and `en.json`). You may read code to understand a screen. Read only.

## What you hand back

Write one Markdown file (path in your task message) with these parts:

### 1. One row per page (per distinct page, not per screenshot)

Treat each tab of a tabbed page as its own row. Columns:

| Column | Content |
|---|---|
| Route | e.g. `/projects/:id` tab "Progress" |
| Roles | which of the accounts in your area reach it (and any that hit "Not found") |
| Purpose | what the page is for, in one sentence. If you cannot say it in one sentence, that is a finding |
| Controls | visible buttons + menu items, for the busiest role (give the two numbers, e.g. "31 + 12 in menus") |
| First screen 1280x800 | what a person sees without scrolling, in a few words; say if the main thing is below the fold |
| First screen 768x1024 | same for tablet; note overflow or broken layout |
| Verdict | exactly one of **keep**, **trim** (say what goes), **merge** (into which page), **cut**, **replace** (with what) |
| Reason | one or two plain sentences |
| Evidence | screenshot path(s), relative to `docs/review/shots/phase1/` |

### 2. Marks (a list, each with route, role, screenshot)

- Decoration rather than information.
- Text that explains the screen instead of the screen explaining itself.
- Any number that cannot be traced to real data, or two numbers for the same thing that disagree (give both and where each appears).
- Any word a client would not understand (client-side areas), in Arabic and in English.
- Any place where Selah appears to do the consultant's job.
- Wrong language, raw keys, broken RTL, overflow, cut-off text, console errors.
- More than one solid button in one card; firm-only content with no lock or label.
- Links that lead to "Not found" for the role that sees them.

### 3. The 18 findings and the batch 0 bugs, for your area only

For each one that concerns your pages: still true / partly true / fixed, one sentence, and the screenshot.

### 4. Proposed target for your roles

- The sidebar each role should have (rows, in order), next to the sidebar it has today.
- The tabs each tabbed page should have, next to today's.
- Anything a role needs that is missing today (do not invent features: only gaps a role visibly runs into on these screens).

### 5. Open questions

Things only the product owner can decide. Keep it short.

Rules for your write-up: plain words, short sentences, no filler. Be specific: name the page, the role, the label, the number. Do not propose new features. A cut or a merge must say where each thing a role still needs will live. If you are not sure, say so instead of guessing.

Your final message back to the lead: at most 30 lines. The count of pages by verdict, the five most important things you found, and anything that surprised you.
