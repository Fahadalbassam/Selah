# Selah progress checklist

The single list of what Selah has, what is being built and what is still open. It follows the journey map (firm, together, client) and holds every item from the full-picture plan, the readiness track, the journey-map gaps, the open decisions and the standing rules. An HTML view of this file, grouped by stage and lane with counts per wave, is published at https://claude.ai/artifact/Sxcp5djbHZikzoKx8NAzLC and re-rendered from this file with `plan/progress-checklist/build.py` in the project files.

This file replaces the earlier "living plan" page, which stopped at PR #24.

## How to use it

- **Tick in the same PR.** The PR that delivers an item changes its box and adds `pr: #N` in the same commit. Nothing is ticked before its PR merges on main.
- **Boxes:** `[x]` done and merged on main · `[~]` in progress, with an open PR · `[ ]` open · `[-]` outside Selah by design.
- **Ids are stable.** `J` journey steps, `F` full-picture items, `R` readiness, `N` journey-map gaps, `D` decisions, `X` standing rules, `LI` later improvements, `RL` the reference library. Never renumber; add new ids at the end of a section.
- **Fields** after the dash: `lane` (firm, shared, client), `map` (what the journey map found on 24 Oct: exists, wave 1, missing, outside Selah), `covered by` (the item that builds the step), `journey` (steps an item covers), `wave` (1, 2, frozen, or later for readiness items needed only before real data), `pr`.
- **A journey step is done when every item covering it is done.** Tick the step in the same PR as its last item.
- Statuses were checked against main at 87099c7 (PR #58) on 24 Oct 2026. Sources: the journey map (`plan/selah-journey-map.html`) and the full picture (`plan/selah-full-picture.html`) in the project files.

## Standing rules for every item

- [x] **X1** Every new page follows `docs/ui-guidelines.md`: shadcn/ui and Animate UI first, monochrome, RTL with logical properties, the shared Selah components — applies to: every UI item · since: #26 · check: review checklist in section 13 of the guide · audited: wave 1 screens #59–#86 (UI pass), enrollment spine screens #93; full wave 1 pass (every screen and role, AR/EN, light/dark, 1440/1024/768, every dialog, e2e) #105, #107, report `selah-frontend/wave1-ui-pass/`
- [x] **X2** Everything ships in Arabic and English: every new message key in both locales, Arabic first, user text translatable — applies to: every item · since: `messages/ar.json` and `messages/en.json` have the same 1,800 keys on 87099c7 · check: both files keep the same keys · wave 1 pass: 3,232 keys in each, no raw keys on any screen (#107)
- [~] **X3** Every screen is built with its backend and tests, no mock screens and no "demo" labels; desktop and tablet only — applies to: every UI item · since: 2026-10-20
- [~] **X4** The partner firm is never named in the product, the docs or the UI — applies to: every item · since: 2026-10-20
- [x] **X5** UI polish on Animate UI (Fahad, 2026-10-24): page transitions with title morphs, theme toggler in the top bar, every shadcn component on its Animate UI version (toast on Base UI), grey card surfaces in both themes, a first-weeks welcome, and one documented place per Animate UI component (`docs/ui-guidelines.md` sections 5.1 and 8) — applies to: every UI item · pr: #124, #126, #127, #128 · report: `selah-frontend/ui-polish/`

## Journey steps

Fourteen stages. In each stage the firm's steps come first, then the step both sides share, then the client's steps.

### J01 · Lead · العميل المحتمل

- [x] **J01.1** Enter a referral or tender by hand — lane: firm · map: wave 1 · covered by: F08 · wave: 1 · pr: #69
- [x] **J01.2** Approach a prospect ourselves — lane: firm · map: missing · covered by: N4 · wave: 1
- [x] **J01.3** Inquiry arrives (firm: Admins notified; client: Gets acknowledgement mail) — lane: shared · map: wave 1 · covered by: F08 · wave: 1 · pr: #68
- [x] **J01.4** Fills the /inquiry form — lane: client · map: exists · wave: — · pr: #4

### J02 · Qualify and check conflicts · التأهيل وفحص التعارض

- [x] **J02.1** Hand inquiry to a consultant — lane: firm · map: exists · wave: — · pr: #18
- [x] **J02.2** Record conflict status — lane: firm · map: exists · wave: — · pr: #18
- [x] **J02.3** Search for conflicts — lane: firm · map: wave 1 · covered by: F08 · wave: 1 · pr: #70
- [x] **J02.4** Gets a courteous decline — lane: client · map: missing · covered by: N10 · wave: 1 · pr: #68

### J03 · NDA and discovery · السرية والاستكشاف

- [x] **J03.1** Book discovery — lane: firm · map: exists · wave: — · pr: #18
- [x] **J03.2** Record the outcome — lane: firm · map: exists · wave: — · pr: #18
- [x] **J03.3** Mark the NDA — lane: firm · map: wave 1 · covered by: F08 · wave: 1 · pr: #70
- [x] **J03.4** Discovery session (firm: Runs it, records outcome; client: Sponsor attends (no login)) — lane: shared · map: exists · wave: — · pr: #18

### J04 · Proposal and contract · العرض والعقد

- [-] **J04.1** Proposal and fees — lane: firm · map: outside Selah · wave: —
- [x] **J04.2** Mark the inquiry won — lane: firm · map: exists · wave: — · pr: #18
- [x] **J04.3** Signing (firm: Records what was signed; client: Signs the engagement letter) — lane: shared · map: wave 1 · covered by: F05 · wave: 1
- [-] **J04.4** Signs — lane: client · map: outside Selah · wave: —

### J05 · Enrol the client · تسجيل العميل

- [x] **J05.1** Convert inquiry to client — lane: firm · map: exists · wave: — · pr: #18
- [x] **J05.2** Add a client directly — lane: firm · map: exists · wave: — · pr: #20
- [x] **J05.3** Legal profile — lane: firm · map: wave 1 · covered by: F07 · wave: 1
- [x] **J05.4** A project per phase — lane: firm · map: wave 1 · covered by: F02 · wave: 1 · pr: #59
- [x] **J05.5** First sign-in (firm: Invites the client admin; client: Accepts terms and AI notice) — lane: shared · map: wave 1 · covered by: R1 · wave: 1 · pr: #84
- [x] **J05.6** Accepts invite, sets 2FA — lane: client · map: exists · wave: — · pr: #7, #8

### J06 · People and roles · الأشخاص والأدوار

- [x] **J06.1** Add contacts (managed mode) — lane: firm · map: exists · wave: — · pr: #35
- [x] **J06.2** Put client people on a project — lane: firm · map: wave 1 · covered by: F01 · wave: 1 · pr: #59
- [x] **J06.3** Name the roles (firm: Records sponsor, acceptors; client: Confirms who signs off) — lane: shared · map: wave 1 · covered by: F06 · wave: 1
- [x] **J06.4** Invites managers and owners — lane: client · map: exists · wave: — · pr: #20
- [x] **J06.5** Adds them to a project — lane: client · map: wave 1 · covered by: F01 · wave: 1 · pr: #59

### J07 · Kickoff (first 14 days) · الانطلاق

- [x] **J07.1** Book kickoff with Meet link — lane: firm · map: exists · wave: — · pr: #11
- [x] **J07.2** Send a request list — lane: firm · map: wave 1 · covered by: F09 · wave: 1 · pr: #72
- [x] **J07.3** Kickoff meeting (firm: Runs it, sends .ics; client: Attends, answers the invite) — lane: shared · map: exists · wave: — · pr: #11
- [x] **J07.4** Sends requested documents — lane: client · map: wave 1 · covered by: F09 · wave: 1 · pr: #72

### J08 · Delivery and sign-off · التسليم والاعتماد

- [x] **J08.1** Run assessments — lane: firm · map: exists · wave: — · pr: #6, #13
- [x] **J08.2** Upload a deliverable — lane: firm · map: exists · wave: — · pr: #28, #29
- [x] **J08.3** Share or version a file — lane: firm · map: wave 1 · covered by: F03 · wave: 1 · pr: #61
- [x] **J08.4** Deliverable sign-off (firm: Sends a version for review; client: Accepts or comments) — lane: shared · map: missing · covered by: F21 · wave: 1 (minimal F21, decision 4a of 17 Nov 2026: the firm hands over the exact versions; the client confirms receipt, never acceptance, or comments) · pr: (#PR)
- [ ] **J08.5** Comments on drafts — lane: client · map: missing · covered by: F21 · wave: frozen

### J09 · Follow-through · المتابعة

- [x] **J09.1** Write recommendation — lane: firm · map: exists · wave: — · pr: #35
- [x] **J09.2** Edit or withdraw it — lane: firm · map: missing · covered by: N1 · wave: 1 · pr: #76
- [x] **J09.3** Release an action — lane: firm · map: exists · wave: — · pr: #35
- [x] **J09.4** Evidence review (firm: Verifies or asks revision; client: Submits progress, evidence) — lane: shared · map: exists · wave: — · pr: #1, #22
- [x] **J09.5** Responds to recommendation — lane: client · map: wave 1 · covered by: F10 · wave: 1 · pr: #96
- [x] **J09.6** Comment thread on action — lane: client · map: wave 1 · covered by: F11 · wave: 1 · pr: #99
- [x] **J09.7** Update, block, submit — lane: client · map: exists · wave: — · pr: #16

### J10 · Change, slips and disputes · التغيير والتأخير والخلاف

- [x] **J10.1** Approve a new date — lane: firm · map: exists · wave: — · pr: #16
- [x] **J10.2** Slip history and aging — lane: firm · map: wave 1 · covered by: F17 · wave: 1 · pr: #100
- [ ] **J10.3** Scope change log — lane: firm · map: missing · covered by: F20 · wave: frozen
- [x] **J10.4** Deadline request (firm: Approves or rejects; client: Asks for a new date) — lane: shared · map: exists · wave: — · pr: #16
- [x] **J10.5** Signs a risk acceptance — lane: client · map: exists · wave: — · pr: #22
- [x] **J10.6** Disagrees on record — lane: client · map: wave 1 · covered by: F10 · wave: 1 · pr: #96

### J11 · Oversight and reporting · الإشراف والتقارير

- [x] **J11.1** Needs attention per project — lane: firm · map: exists · wave: — · pr: #23
- [x] **J11.2** Firm-wide exceptions — lane: firm · map: wave 1 · covered by: F18 · wave: 1 · pr: #101, #102, #104
- [x] **J11.3** Monthly status pack — lane: firm · map: wave 1 · covered by: F19 · wave: 1 · pr: #103
- [x] **J11.4** Audit-log screen — lane: firm · map: wave 1 · covered by: R2 · wave: 1 · pr: #77
- [x] **J11.5** Shared report (firm: Freezes and shares it; client: Reads it, downloads PDF) — lane: shared · map: exists · wave: — · pr: #17, #41
- [x] **J11.6** Daily digest mail — lane: client · map: exists · wave: — · pr: #44
- [x] **J11.7** Picks mail frequency — lane: client · map: wave 1 · covered by: F12 · wave: 1 · pr: #78

### J12 · Close and hand over · الإغلاق والتسليم

- [x] **J12.1** Close an action with outcome — lane: firm · map: exists · wave: — · pr: #22
- [x] **J12.2** Close project (no gate) — lane: firm · map: exists · wave: — · pr: main
- [x] **J12.3** Closing gate, read-only — lane: firm · map: wave 1 · covered by: F25 · wave: 1 · pr: #79
- [x] **J12.4** Handover (firm: Disposes every open item; client: Names who sustains each) — lane: shared · map: wave 1 · covered by: F25 · wave: 1 · pr: #79
- [x] **J12.5** Acknowledges deliverables — lane: client · map: missing · covered by: F21 · wave: 1 (minimal F21: the receipt is in the closure report and the export pack) · pr: (#PR)

### J13 · After-care and renewal · ما بعد الإغلاق

- [x] **J13.1** 30/60/90-day check-ins — lane: firm · map: exists · wave: — · pr: #24
- [ ] **J13.2** Re-verify at 6, 12 months — lane: firm · map: missing · covered by: F29 · wave: frozen
- [ ] **J13.3** Open a follow-on project — lane: firm · map: missing · covered by: F28 · wave: frozen
- [ ] **J13.4** Check-in (firm: Asks what moved; client: Reports KPIs, signs next) — lane: shared · map: missing · covered by: F29 · wave: frozen

### J14 · Offboarding · إنهاء العلاقة

- [x] **J14.1** Archive the client — lane: firm · map: wave 1 · covered by: F27 · wave: 1 · pr: #83
- [x] **J14.2** Export pack, legal hold — lane: firm · map: wave 1 · covered by: F27 · wave: 1 · pr: #83, #89
- [x] **J14.3** Reassign leavers' work — lane: firm · map: wave 1 · covered by: F26 · wave: 1 · pr: #81
- [x] **J14.4** Exit handover (firm: Hands over export; client: Receives it, signs receipt) — lane: shared · map: wave 1 · covered by: F27 · wave: 1 · pr: #89
- [x] **J14.5** Read-only grace period — lane: client · map: wave 1 · covered by: F27 · wave: 1 · pr: #83

## Full-picture items

The 35 ranked items. Wave 1 is lifted from the freeze, wave 2 comes straight after, frozen items wait to be picked.

### Tier 1 · Day-one blockers

- [x] **F01** Put client people on a project — tier: 1 · size: S · wave: 1 · journey: J06.2, J06.5 · pr: #59
- [x] **F02** More than one project per client — tier: 1 · size: S · wave: 1 · journey: J05.4 · decision: D2 · pr: #59
- [x] **F03** File controls: share, AI flag, new version — tier: 1 · size: S–M · wave: 1 · journey: J08.3 · pr: #61
- [x] **F04** Assistant reads PDF and Word files — tier: 1 · size: M · wave: 1 · pr: #63

### Tier 2 · The enrolment spine

- [x] **F05** Record the signed engagement, carry the inquiry over — tier: 2 · size: M · wave: 1 · journey: J04.3 · pr: #64
- [x] **F06** Client roles that work in every mode — tier: 2 · size: M · wave: 1 · journey: J06.3 · pr: #66
- [x] **F07** Client legal profile — tier: 2 · size: S–M · wave: 1 · journey: J05.3 · pr: #67
- [x] **F08** Intake fixes — tier: 2 · size: S–M · wave: 1 · journey: J01.1, J01.3, J02.3, J03.3 · pr: #68 (acknowledgement mail), #69 (staff entry), #70 (conflict search, qualification, NDA, returning client), #71 (public form changes and marketing consent)
- [x] **F09** Information request list per project — tier: 2 · size: M · wave: 1 · journey: J07.2, J07.4 · pr: #72 (list, templates, answering, review), #73 (reminders)

### Tier 3 · The client takes part

- [x] **F10** Management response on each recommendation — tier: 3 · size: S · wave: 1 · journey: J09.5, J10.6 · pr: #96
- [x] **F11** Comment thread on each action — tier: 3 · size: S–M · wave: 1 · journey: J09.6 · pr: #99
- [x] **F12** Mail choices that respect the Saudi week — tier: 3 · size: S–M · wave: 1 · journey: J11.7 · pr: #78
- [x] **F13** Help and “ask your consultant” — tier: 3 · size: S · wave: 3 · decision: Wave 3 pick on 2026-10-24 (two-sided review) · pr: #121
- [x] **F14** Magic-link sign-in and no-login upload links — tier: 3 · size: M · wave: 2 · decision: D6 D7 · pr: #113 (sign-in links), #114 (upload links)

### Tier 4 · Following through well

- [ ] **F15** Saudi working calendar — tier: 4 · size: S–M · wave: frozen
- [ ] **F16** Say what proves each recommendation — tier: 4 · size: M · wave: frozen
- [x] **F17** Slip history and aging — tier: 4 · size: S · wave: 1 · journey: J10.2 · pr: #100
- [x] **F18** Firm-wide exceptions and engagement health — tier: 4 · size: M · wave: 1 · journey: J11.2 · pr: #101, #102, #104
- [x] **F19** Scheduled status pack — tier: 4 · size: S–M · wave: 1 · journey: J11.3 · pr: #103
- [ ] **F20** Change request log — tier: 4 · size: S · wave: frozen · journey: J10.3
- [x] **F21** Deliverable versions and client acceptance — tier: 4 · size: M–L · wave: 1, built in its minimal form (decision 4a of 17 Nov 2026: hand-over rounds with exact versions, receipt or comment by the acceptor, else the admin, else the sponsor, consultant-recorded receipt for clients the firm runs, one reminder after ten working days, receipts in the closure report and export pack; receipt is never acceptance); the rest stays frozen (comments pinned to pages of a draft, side-by-side versions, e-signature, approval workflows on drafts, any link to invoicing) · journey: J08.4, J08.5, J12.5 · pr: (#PR)
- [x] **F22** Second reviewer when evidence rounds loop: a client rule (off, after two revisions, high priority work, every action) and a per-action switch for the lead, deputy or firm admin; the first consultant signs off, a different one verifies; never the owner, a submitter or the first reviewer — tier: 4 · size: S · wave: 4 · decision: Fahad said "go ahead do all" on 2026-10-25 · pr: #130
- [ ] **F23** Schedule screen — tier: 4 · size: S · wave: frozen
- [ ] **F24** Decision register — tier: 4 · size: S · wave: frozen

### Tier 5 · Closing and leaving

- [x] **F25** Closing is a gate — tier: 5 · size: M · wave: 1 · journey: J12.3, J12.4 · pr: #79 (dispositions, sustainers, lessons, read-only, reopen with reason, closure report PDF; the closing survey and case-study consent moved to F36 and F37)
- [x] **F26** When people leave or change — tier: 5 · size: M · wave: 1 · journey: J14.3 · pr: #81
- [x] **F27** A client can leave cleanly — tier: 5 · size: M · wave: 1 · journey: J14.1, J14.2, J14.4, J14.5 · pr: #83 (archive, grace period, retention, legal hold, purge), #89 (export pack and receipt)
- [ ] **F28** Pause and follow-on projects — tier: 5 · size: M · wave: frozen · journey: J13.3 · decision: D2
- [ ] **F29** After-care and re-verification — tier: 5 · size: M · wave: frozen · journey: J13.2, J13.4

### Tier 6 · Departments and phases (option B)

- [x] **F30** Client overview page and client-wide report — tier: 6 · size: M · wave: 1 · decision: D2 · pr: #82
- [x] **F31** Departments across the work — tier: 6 · size: M · wave: 1 · decision: D2 · pr: #80 (part 1), #85 (part 2), #88 (part 3), #97 (editing a recommendation's department and accountable person)
- [ ] **F32** Workstreams with a lead consultant — tier: 6 · size: M · wave: frozen · decision: D2
- [ ] **F33** Client steering meeting across projects — tier: 6 · size: M · wave: frozen · decision: D2
- [x] **F34** Client groups with flexible member companies — tier: 6 · size: L · wave: 2 · decision: D4 · pr: #109 (groups, linked clients, companies inside a client), #110 (the holding's named people see the roll-up)
- [x] **F35** Company and department business indicators (KPI layer B): client-entered values over time with notes, corrections kept, firm entries marked and logged, the firm's one-time check, links to recommendations, trend lines on the client overview, department, indicator and recommendation pages, the status pack, closure and client report PDFs, and the assistant under the asker's rights; client-reported, never verified impact; no weighting, integrations or impact claims — tier: 6 · size: L · wave: 4 · decision: Fahad on 2026-10-25 ("go with the recommended amount and the useful amount") · pr: #132
- [x] **F36** Closing pulse survey: the client rates the engagement when a project closes — tier: 5 · size: S · wave: 2 (candidate) · related: F25 · evidence: for, the comparable-platforms study lists evaluation and NPS as a common practice; against, it is a firm-improvement tool rather than part of connecting consultant and client, and nobody has asked for it yet · pr: #111
- [x] **F37** Case-study consent: the client agrees, per project, that the firm may cite the work — tier: 5 · size: S · wave: 2 (candidate) · related: F25 · evidence: for, it keeps a record of a permission firms otherwise get by email; against, it is rare and is handled outside Selah today · pr: #112
- [x] **F38** Today page for firm staff: what waits on me across every client (my reviews, overdue work I lead, my follow-ups, this week's meetings, requests waiting on me) — tier: 4 · size: S–M · wave: 3 · evidence: research-team.md §7 recommends building it; time tracking stays out · decision: Wave 3 pick on 2026-10-24 (two-sided review) · pr: #119
- [x] **F39** Client assistant: off by default, the firm admin switches it on per client and the client admin consents; read-only answers with sources, only from what that person can already see, with client rules and an output filter — tier: 3 · size: M · wave: 3 · evidence: intake-and-client-ai-db.md §3 · decision: Fahad said yes on 2026-10-24, on condition it is as secure as the staff side with extra rules for clients · pr: #122
- [x] **F40** Team load for the firm admin: per consultant, the reviews they could do and the oldest one's wait, second sign-offs waiting on them, overdue work and work due in 7 and 30 days, and who is not taking new clients — tier: 4 · size: S · wave: 4 · evidence: research-team.md §2, selah-two-sided-review.html · decision: Fahad said "go ahead do all" on 2026-10-25 · pr: #131
- [x] **F41** People pickers you can type into (Animate UI Combobox): adding consultants to a client, staffing a project, client people on a project, template authors, an action's owner, the accountable person, handover on departure, a follow-up's assignee and meeting attendees; search by name or email, Arabic or English — tier: 4 · size: S · wave: 4 · evidence: UI polish report (Combobox left for long people pickers) · decision: Fahad said "go ahead do all" on 2026-10-25 · pr: #133
- [x] **F42** How indicator figures reach Selah, chosen by the client in three modes: no data (typed in), some data (Excel/CSV exports uploaded, matched by code or name and reviewed before saving) or all data (a shared Google Sheet read daily, or a key the client's own system pushes figures with); a skippable setup step for the client admin, the firm may only suggest, Data sharing in the profile menu, each value shows how it arrived, a starter library of 24 common indicators; still client-reported, never verified impact — tier: 6 · size: L · related: F35 · evidence: Saudi clients keep figures in Qoyod, Zoho Books, Odoo, Daftra, SAP or Excel management reports, all of which export xlsx/csv · decision: Fahad on 2026-10-30 ("realistic, up to our 3 options, all data, some data, no data") · pr: #138
- [x] **F35b** An indicator that moved away: each period is judged once it has ended, on its latest value (typed, file, sheet or system; a running period by the monthly job when it ends); when that value is on the other side of the baseline from the chosen direction, or short of the target after the target date, one `indicator.moved_away` notice to the client's lead, deputy and admins, once per indicator and period; facts only, no judging word, "client-reported, not verified impact"; through the summary mail, muted per indicator by each person told; no thresholds, bands, forecasts or link to a recommendation's status — tier: 6 · size: S · related: F35, F42 · decision: Fahad on 2026-11-17 (gate A follow-ups, 4b) · pr: (this branch, feature/indicator-moved-away)
- [x] **F43** The client's organisation structure (org chart): positions, not people; the firm's draft and published versions, each with an effective date, who published it and an optional board resolution, frozen for the client view, the PDF and the history; the client admin keeps the people in positions current (the lead is told) and suggests structure changes; a manager sees every title and names only in her branch and the chain above it, and only while the client admin shows names; an action owner sees "your manager" only; the chart never grants or limits access to any work, and Selah never designs, scores or judges a structure — tier: 6 · size: L · wave: 4 · decision: gate A follow-ups, 17 Nov 2026 (section 3, feature B) · parts: 1 data, rules and services (migration 0091, `docs/data-model.md` "The client's organisation structure") · 2 the HTML tree for screen and PDF (done on branch `feature/org-chart-tree`: one server-built HTML and CSS drawing, the read-only Structure tabs on the client page and the Departments page, the PDF in A3 or A4 landscape with or without names, the walkthrough's published structure for Al-Nukhba; `tests/org-chart-tree.test.ts`, `tests/db/org-chart-tree.test.ts`) · 3 the outline editor, holders and vacancies, the leaving and invite hooks (done on branch `feature/org-chart-editor`, migration 0097: the firm's editors edit the draft as an indented list with a ⋯ menu per row and a side panel for the details, no drag and drop, and start a structure from the tab; "People in positions" for the client's admin and the firm's editors, with the vacant positions; a holding entered by mistake is removed, audited without the name, so minimal records can be switched on again; leaving ends a person's holdings on the day, with "leave vacant" or "pick a replacement"; the invite form offers vacant positions; and Fahad's addition of 18 Nov, a person's work card on the drawing, read as the viewer; `tests/db/org-chart-editor.test.ts`, `tests/org-chart-outline.test.ts`) · 4 Excel template and import, Word outline, the assistant's text draft (done on branch `feature/org-chart-import`: the import page `/clients/:id/structure/import` for the draft's editors, the template with its guide sheet and the draft in the same template so it round-trips, the Word outline, the assistant's draft from pasted text with the local model only, which handles no people and keeps only what the text names, one review step for all three with every row checked before anything is saved, replace or add (what leaves the draft named, with who holds it today), people planned for the draft (`org_chart_planned_holders`, firm only) and never placed, nothing published; the review of 18 Nov fixed on the branch (B1, B2, S1 to S5, S7); `docs/import-export.md` "Importing an organisation structure", `tests/org-chart-import.test.ts`, `tests/db/org-chart-import.test.ts`) · 5 publishing screens, the client view, change requests on the lead's home, the department-head suggestion, and on the drawing: collapse and expand per unit, zoom and pan, and focus on one department (done on branch `feature/org-chart-publish`, migration 0105: `/clients/:id/structure/publish` for the firm admin, the lead and the deputy, listing what changes against the version in effect, the people on removed positions and the planned people, who are placed from the effective day after a second check and then cleared, the day on or after the current version's, the board resolution from the client's shared files; the client admin's "show names" switch and the board resolution's link on the version; "Suggest a change" and its answer on the Structure tabs, the suggestion on the lead's home, a plain notice back; the department-head suggestion for the client admin and the firm admin, which changes nothing until confirmed; "Your manager" in the person's own menu; folding, zoom, pan and focus on the drawing, none of it in the PDF; `tests/db/org-chart-publish.test.ts`, `tests/org-chart-reading.test.ts`)
- [x] **F44** Who sees an item: "everyone with access, except…" or "only these people…" on files (never evidence) and meetings, set at upload, when booking or editing a meeting, when the firm shares a deliverable, and on the item afterwards; it only takes people away (a restrictive database rule and authorize()'s sixth question), locked people worked out live, people left out see nothing and are never told, everyone else sees "Limited audience"; firm staff on the firm's items, the client's admin on the client's own, no picker for managers or owners — tier: 6 · size: L · decision: Gate A follow-ups, 17 Nov 2026, feature A · pr: #162 (the picker and marker), (#PR) (tables, rules, enforcement and wiring)
## Readiness before real client data

- [x] **R1** Terms, consent records, AI notice, data agreement — size: S · wave: 1 · journey: J05.5 · pr: #84
- [x] **R2** Audit-log screen and tamper evidence — size: M · wave: 1 · journey: J11.4 · pr: #77
- [x] **R3** Backups, restore drill, incident runbook — size: M · wave: 1 · pr: #86
- [x] **R4** Readiness checks, alerts, upgrades — size: S · wave: later (before real data) · pr: #87
- [x] **R5** Security pack for client IT — size: S · wave: later (before real data) · pr: #91
- [ ] **R6** AI operations and consent — size: S · wave: later (before real data)
- [ ] **R7** Accessibility checks — size: S · wave: later (before real data)

## Gaps found by the journey map

Added to Wave 1 after the map was drawn. N2 needs a database test before anyone calls it a leak.

- [x] **N1** Edit, withdraw and release recommendations and findings — wave: 1 · journey: J09.2 · pr: #76
- [x] **N2** Actions under a firm-only recommendation stay firm-only (test first) — wave: 1 · pr: #62
- [x] **N3** A draft project state the client never sees — wave: 1 · pr: #64
- [x] **N4** A prospect record and a firm-outreach source — wave: 1 · journey: J01.2 · pr: #65
- [x] **N5** The lead of an internal project can close it — wave: 1 · pr: #79
- [x] **N6** A read-only observer role for colleagues — wave: 1 · related: F26 · pr: #92
- [x] **N7** Delete a never-signed prospect or a client added by mistake — wave: 1 · related: F27 · pr: #65
- [x] **N8** The uploader can withdraw a wrong, unreviewed file — wave: 1 · related: F03 · pr: #74
- [x] **N9** The client sponsor can ask the firm to close — wave: 1 · related: F25 · pr: #79
- [x] **N10** An optional bilingual decline mail — wave: 1 · journey: J02.4 · related: F08 · pr: #68
- [x] **N11** The client's lead consultant or deputy can start (and stop) closing; only the firm admin closes — wave: 3 · related: F25 · decision: Fahad said yes on 2026-10-24 · pr: #118

## Bugs found by the two-sided review

From the review of 2026-10-24 (report `plan/selah-two-sided-review.html`), section A: bug fixes allowed under the freeze. Its improvements (B) and new features (C) wait for Fahad.

- [x] **R01** Closing settles what the gate decided: withdrawn and waived actions close as not applicable, so roll-ups stop counting them open — pr: #117
- [x] **R02** The closing project state has Arabic and English text — pr: #116
- [x] **R03** The activity tab names every event, never a raw key — pr: #116
- [x] **R04** Required fields speak the page's language in every form; an empty date is marked — pr: #116
- [x] **R05** A response's target date can't be in the past — pr: #116
- [x] **M01** Asking for a revision answers the evidence items still waiting, so the lead decides once — pr: #117
- [x] **M04** Overview cards: "In progress" counts claims only; the firm's list includes blocked and revision work — pr: #117
- [x] **M05** A consultant who only observes a client's projects doesn't add, edit or remove its contacts (notes on actions stay open to observers by design) — pr: #120
- [x] **M06** An archived client's team card offers no staffing buttons — pr: #120
- [x] **M10** No PDF button where the PDF service isn't set up — pr: #120
- [x] **M13** The sample data has no impossible states: evidence behind awaiting review, revision and verified — pr: #120
- [x] **L01** The sidebar toggle's screen-reader text is translated — pr: #116
- [x] **L02** The project's Meetings tab shows a new meeting on the way back — pr: #120
- [x] **L03** Remind owner confirms with a toast — checked: the toast shows once the request returns; not reproduced, no change
- [x] **L04** A booked discovery session replaces "Book a discovery session" as the next step — pr: #120
- [x] **L06** The clients list says "Only the lead consultant" instead of "none" — pr: #120
- [x] **L09** An action owner opening /team gets not-found like other blocked pages — pr: #120
- [x] **L12** The actions export refuses an unknown parameter instead of an unfiltered sheet that looks filtered — pr: #120
- [x] **L13** The public upload page sends only the strings its form uses — pr: #116
- [x] **L14** Local start without a scanner keeps uploads (CLAMD_HOST left empty; the app stays fail-closed) — pr: #115

## Team walkthrough (2026-10-25)

Fahad asked for everything his team needs to walk through the whole product locally: accounts for every role on both sides, realistic cases and a working assistant. The guide is `docs/walkthrough.md`; its HTML view is `plan/selah-walkthrough.html` in the project files.

- [x] **W01** One command loads a walkthrough: a firm with every staff role, two clients with every client role, three cases with every action state, the assistant reading them, and a scripted tour (`npm run walkthrough -- --fresh`) — pr: #134
- [x] **W02** A client project starts (planned to active) when its first action is released, so reminders, escalation, health history and status packs run for it — pr: #134
- [x] **W03** Buttons that are links on server-rendered pages render on the server too (no hydration error on the client page, help, inquiry, privacy and not-found pages) — pr: #134
- [x] **W04** The sidebar fits a laptop screen with no second scrollbar (Settings in the user menu, Actions / review queue / oversight as tabs, Overview and Today in one row), with a language button beside the theme toggle — pr: #135
- [x] **W05** Floating cards (Files, assistant) stay above page transitions instead of the page animating over them — pr: #135
- [x] **W06** Faster pages: the walkthrough opens every page once before it says ready, and the oversight health query reads the deviations once per project — pr: #135
- [x] **W07** Ask the assistant without picking a project: "All my clients" for firm staff, "All your projects" for a client person, under the same permissions, each source naming its client and project, and an answer hidden once the person loses any project it drew on — pr: #136
- [x] **W08** Assistant answers in seconds: the local model's hidden thinking turned off and the model kept loaded, answers shown as they are written, a notice when the slower local model is in use, and the hosted-model settings printed by the walkthrough — pr: #136

## Decisions still waiting

- [x] **D8** KPI layer B: may client KPIs live at company and department level with a simple weighted cascade? — done: Fahad decided on 2026-10-25 to build company and department indicators without a weighted cascade (F35, #132)
- [x] **D11** Rewrite the partner name out of the first commit (force-push, can't be undone for clones) — done: Fahad's go on 2026-10-24; history rewritten and every branch force-pushed, main 71e45d0 became 9d0c72c with identical files · related: X4

## Later improvements (not built)

The owner's Gate B answer (19 Nov 2026, `docs/review/lead-log.md`, Gate B answers, part 1): document these, build nothing now, no dates. The handbook part `docs/handbook/later/` (Arabic and English) says what each does and how the team can split them.

Rules for every item here:
- Automation suggests, a person decides: nothing changes until a consultant or the client accepts it, and the record says who decided.
- It runs well on our server (GTX 1050, 16 GB RAM, the local model); no client file goes to a hosted model.
- Keep the app light: one shared local model and one search index serve every AI feature; no new model, agent or service just for one feature; plain rules and SQL (thresholds, counts, dates) wherever they do the job, AI only where it clearly helps.
- Keep it fast: AI jobs in one shared queue (one at a time on the server), cache answers and embeddings that have not changed, index a file once and again only when it changes, and measure page and AI response times before and after each feature.
- Each item names the data it needs; for now only keep that data structured and timestamped.

- [ ] **LI01** Automatic KPI help: read indicator values from a client's spreadsheet or file and propose the rows, flag a value that moved away from its target (a plain rule), suggest a likely link to a recommendation (the firm confirms) — size: M · model: only for messy files · needs: baseline, target, direction, values by period · keep now: each value's period, who entered it and when, how it came in, corrections beside the original; each link's author and time
- [ ] **LI02** Governance assessment help: draft answers and scores from the client's evidence against the reference library, a citation each (client file and reference), the consultant accepts or changes each; scores stay firm-only — size: M–L · model: the shared one, background job · depends on: RL01, the labelled test set · keep now: each answer's author and time, its template version, its linked evidence; keep an earlier answer when it changes (to check: today only the latest time is kept)
- [ ] **LI03** Workflow lane detection: spot stuck or overloaded consultant or client lanes from action history (reviews waiting long, one person owning most late work, a project with no movement); facts and counts for the firm admin or lead, never a score or ranking — size: S–M · model: none (SQL) · keep now: each state change with who and when, never rewritten; review decisions and date requests with their times
- [ ] **LI04** "What changed since my last visit" and a meeting brief in the staff assistant: cited, marked draft, from the readers the screens already use — size: S–M · after: the value test (tasks 3 and 6)
- [ ] **LI05** Text recognition for scanned pages, on the pages marked scanned only, in the shared queue, indexed once — size: M · model: none (text recognition on the processor)
- [ ] **LI06** Save an assistant answer with its citations as a firm-only project note, by the asker; never shared with the client automatically — size: S

Decided, not an idea: the client's progress-update draft is approved as facts only, marked draft, never sent by Selah (Gate B).

## Reference library (plan, not built)

- [ ] **RL01** A reference library of six sources: the IFC family business governance handbook; the OECD Principles of Corporate Governance; the CMA Corporate Governance Regulations; the Balanced Scorecard; Good Strategy Bad Strategy; the Ministry of Economy and Planning strategy framework — kept as a separate "reference" source, never mixed with client evidence; labelled "Reference" with source, edition and place in every citation; each source stored with its edition or date; each licence checked before loading; the two copyrighted books quoted only briefly, with the firm's own short notes instead of their text · handbook: `docs/handbook/later/`, section "reference-library"
- [ ] **RL02** Arabic and English questions about each reference source in the labelled test set (section 7 item 7), with the right passages marked · depends on: RL01
