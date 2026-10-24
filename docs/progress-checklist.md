# Selah progress checklist

The single list of what Selah has, what is being built and what is still open. It follows the journey map (firm, together, client) and holds every item from the full-picture plan, the readiness track, the journey-map gaps, the open decisions and the standing rules. An HTML view of this file, grouped by stage and lane with counts per wave, is published at https://claude.ai/artifact/Sxcp5djbHZikzoKx8NAzLC and re-rendered from this file with `plan/progress-checklist/build.py` in the project files.

This file replaces the earlier "living plan" page, which stopped at PR #24.

## How to use it

- **Tick in the same PR.** The PR that delivers an item changes its box and adds `pr: #N` in the same commit. Nothing is ticked before its PR merges on main.
- **Boxes:** `[x]` done and merged on main · `[~]` in progress, with an open PR · `[ ]` open · `[-]` outside Selah by design.
- **Ids are stable.** `J` journey steps, `F` full-picture items, `R` readiness, `N` journey-map gaps, `D` decisions, `X` standing rules. Never renumber; add new ids at the end of a section.
- **Fields** after the dash: `lane` (firm, shared, client), `map` (what the journey map found on 24 Oct: exists, wave 1, missing, outside Selah), `covered by` (the item that builds the step), `journey` (steps an item covers), `wave` (1, 2, frozen, or later for readiness items needed only before real data), `pr`.
- **A journey step is done when every item covering it is done.** Tick the step in the same PR as its last item.
- Statuses were checked against main at 87099c7 (PR #58) on 24 Oct 2026. Sources: the journey map (`plan/selah-journey-map.html`) and the full picture (`plan/selah-full-picture.html`) in the project files.

## Standing rules for every item

- [x] **X1** Every new page follows `docs/ui-guidelines.md`: shadcn/ui and Animate UI first, monochrome, RTL with logical properties, the shared Selah components — applies to: every UI item · since: #26 · check: review checklist in section 13 of the guide · audited: wave 1 screens #59–#86 (UI pass), enrollment spine screens #93; full wave 1 pass (every screen and role, AR/EN, light/dark, 1440/1024/768, every dialog, e2e) #105, #107, report `selah-frontend/wave1-ui-pass/`
- [x] **X2** Everything ships in Arabic and English: every new message key in both locales, Arabic first, user text translatable — applies to: every item · since: `messages/ar.json` and `messages/en.json` have the same 1,800 keys on 87099c7 · check: both files keep the same keys · wave 1 pass: 3,232 keys in each, no raw keys on any screen (#107)
- [~] **X3** Every screen is built with its backend and tests, no mock screens and no "demo" labels; desktop and tablet only — applies to: every UI item · since: 2026-10-20
- [~] **X4** The partner firm is never named in the product, the docs or the UI — applies to: every item · since: 2026-10-20

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
- [ ] **J08.4** Deliverable sign-off (firm: Sends a version for review; client: Accepts or comments) — lane: shared · map: missing · covered by: F21 · wave: frozen
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
- [ ] **J12.5** Acknowledges deliverables — lane: client · map: missing · covered by: F21 · wave: frozen

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
- [ ] **F21** Deliverable versions and client acceptance — tier: 4 · size: M–L · wave: frozen · journey: J08.4, J08.5, J12.5
- [ ] **F22** Second reviewer when evidence rounds loop — tier: 4 · size: S · wave: frozen
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
- [ ] **F35** Company and department KPIs — tier: 6 · size: L · wave: frozen · waiting on: supervisor (D8) · decision: D8
- [x] **F36** Closing pulse survey: the client rates the engagement when a project closes — tier: 5 · size: S · wave: 2 (candidate) · related: F25 · evidence: for, the comparable-platforms study lists evaluation and NPS as a common practice; against, it is a firm-improvement tool rather than part of connecting consultant and client, and nobody has asked for it yet · pr: #111
- [x] **F37** Case-study consent: the client agrees, per project, that the firm may cite the work — tier: 5 · size: S · wave: 2 (candidate) · related: F25 · evidence: for, it keeps a record of a permission firms otherwise get by email; against, it is rare and is handled outside Selah today · pr: #112
- [x] **F38** Today page for firm staff: what waits on me across every client (my reviews, overdue work I lead, my follow-ups, this week's meetings, requests waiting on me) — tier: 4 · size: S–M · wave: 3 · evidence: research-team.md §7 recommends building it; time tracking stays out · decision: Wave 3 pick on 2026-10-24 (two-sided review) · pr: #119
- [ ] **F39** Client assistant: off by default, the firm admin switches it on per client and the client admin consents; read-only answers with sources, only from what that person can already see, with client rules and an output filter — tier: 3 · size: M · wave: 3 · evidence: intake-and-client-ai-db.md §3 · decision: Fahad said yes on 2026-10-24, on condition it is as secure as the staff side with extra rules for clients
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

## Decisions still waiting

- [ ] **D8** KPI layer B: may client KPIs live at company and department level with a simple weighted cascade? — waiting on: supervisor · blocks: F35
- [x] **D11** Rewrite the partner name out of the first commit (force-push, can't be undone for clones) — done: Fahad's go on 2026-10-24; history rewritten and every branch force-pushed, main 71e45d0 became 9d0c72c with identical files · related: X4
