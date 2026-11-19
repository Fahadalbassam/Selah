# Phase 3: KPIs, the governance assessment, the everyday gaps, and what is left half-done (areas 4 to 7)

Assessor's report, 19 Nov 2026. Assess only: nothing in the app was changed, nothing pushed.

**Where I checked.** My own worktree from `origin/main` at 4ffb703 (#190): `C:\Projects\selah-fresh\.claude\worktrees\phase3-kpi-u` (detached, no commits). Database `selah_test_u`, rebuilt from empty and loaded with the walkthrough data; app on port 3943 (stopped afterwards, port free). PDFs rendered by the local PDF container on this machine; nothing left the machine. Synthetic data only.

**What I changed in my own copy to test** (my database only): ran the monthly status-pack job for October (3 draft packs); switched *Al-Waha* to "restricted" and added one synthetic client admin `radmin@waha.test` who owns one action; finalised, shared, retook and compared the seeded baseline assessment; made one assessment report. Afterwards the database tests below were run on the same database.

**Proof files** (local only, not in git): `docs/review/shots/phase3-kpi/` holds the PDFs and the page texts I quote (`*.pdf`, `t_*.txt`).

**Tests run** (`TZ=UTC`, `selah_test_u`): `assessments`, `metrics`, `status-pack`, `indicators`, `indicator-data`, `engagement` database tests: 6 files, 86 passed, 0 failed.

---

## The list for Gate B, sorted by what a user would notice most

| # | Item | Area | Effort | Recommendation |
|---|---|---|---|---|
| 1 | A restricted client's admin cannot record progress or evidence, and nobody else can either | 7 | small | **Build now** |
| 2 | A department-limited manager reads 25% for a project on her home and Progress tab, and 13% for the same project in the shared report and its PDF | 4 | small | **Build now** (one explaining line) |
| 3 | "I am stuck" tells nobody at the firm, while its hint says "The consultant will see it" | 7 | small | **Build now** |
| 4 | When the lead consultant changes, the client and the old lead are not told and no handover note is kept | 6 | medium | **Build after the research check** (before the scenarios, as planned) |
| 5 | No reminder before an engagement's end date | 6 | small | **Build after the research check** (before the scenarios, as planned) |
| 6 | The indicator card judges in words and colour: "Worse than baseline" in red, "Better" in green; "Toward target %" | 4 | small | **Build now** (wording) |
| 7 | An invited, department-limited manager's Meetings tab reads "No meetings for you yet" | 7 | small | Gate B question (below) |
| 8 | The client sees question guidance written for the consultant, such as "which the firm can deliver" | 5 | small | Build after the scenarios |
| 9 | An unhappy client's route to the firm admin: it now exists, but as one box shared with bug reports and with no reply | 6 | small | Build after the research check (wording first) |
| 10 | Stale or wrong words: "Team tab", walkthrough «اسأل مستشارك», "another consultant", two dead message keys, `handoff.md` and `data-architecture.md` | 7 | small | **Build now** (one text pull request) |
| 11 | Handbook: no paragraph on how indicator figures reach Selah, none on the second sign-off rule; duplicate HTML ids; links between languages print as plain text | 7 | small | **Build now** (with #10) |
| 12 | An export asked for in English through `?lang=en` has Arabic labels when the screen is Arabic | 4 | small | Build after the scenarios |
| 13 | Batch 5 leftovers: date-request words not wired, two words for "inquiry", the red late date that does not say whose move it is, inquiry steps that trust `can.forward` | 7 | small | Build after the scenarios |
| 14 | No way to load a firm's own assessment except typing it into the builder | 5 | medium | Leave out until the firm sends its assessment (list below) |
| 15 | Each tooltip on a status badge adds a Tab stop | 7 | small | Build after the scenarios |

Gate B questions carried here (from `page-audit.md` section 8 and the reviews; none was answered yet):

1. A meeting's agenda headings and status words follow the meeting's language, not the reader's (`src/app/(app)/meetings/[id]/page.tsx:73` builds them with the meeting's `lang`). Recommendation: follow the reader.
2. A department-limited manager can be invited (after a warning) to a whole-project meeting she cannot open; her Meetings tab then reads "No meetings for you yet" (seen on my copy as manager@nukhba.test, `shots/phase3-kpi/t_meet_cm.txt`). Recommendation: refuse that invitation and offer a department meeting, so an invitation always opens.
3. The firm's free-text report note can name another department's work to a limited manager (the shared report's note names «مصفوفة الصلاحيات», Finance's work, to the board-secretariat manager: `t_rep_cm.txt`). Recommendation: a line in the consultants' handbook.
4. Who reviews on a firm-run client with only one consultant? Whoever recorded for the client cannot review that round (`docs/engagement.md`, "Separation of duties"), so the firm admin must. Recommendation: say so on the action page when nobody else on the team can review.
5. New from this report: should a client admin also record progress on a **full** client when they own the action? Recommendation: no change for full clients now; fix restricted clients only (item 1).

---

## Area 4: KPIs

### 4.1 The three layers are there

**Works today.**
- Layer A, implementation metrics per project: `v_project_metrics`, `app_project_progress()`, shown on the Progress tab, in reports and PDFs (`docs/metrics.md` section 1; `tests/db/metrics.test.ts` passes).
- Layer C, the team (firm admin only): `app_team_workload()` and `app_team_metrics()` on the Team page, counts only, no score (`docs/metrics.md` section 2; `src/services/team-load.ts`, `src/app/api/team/metrics/route.ts`).
- Layer B, client-reported business indicators: company or department, baseline, target, values over time with corrections, links to recommendations made by the firm only (`docs/metrics.md` section 3; `tests/db/indicators.test.ts` passes). On my copy the client page shows three indicators with six months of values, and the moved-away notice works (seed comment and `docs/metrics.md`).
- Still left out on purpose, and still absent in code: weighting formulas, automatic impact claims, consultant rankings (`docs/metrics.md`, "Not built, by design"; I found no weighting or ranking in `src/lib/indicators.ts`, which counts indicators and never averages values: lines 87-88).

### 4.2 The three data modes

**Works today.** `/indicators/data` as the client admin shows the three cards, "No data / Figures typed in", "Some data / Exports you upload", "All data / A live connection", with "Not chosen yet" and the claim line (`t_data_ca.txt`). Behind them: the import wizard (`/indicators/import`), the sheet and key connections (`src/app/api/indicator-feed/route.ts`, `src/app/api/indicator-feeds/[id]/…`, `scripts/indicator-feeds.ts`), and `tests/db/indicator-data.test.ts` passes.

**Not checked live.** I did not pull a Google Sheet (that would leave the machine) or push with a key. The import and feed rules are covered by the database tests only.

**Half-done.** The client guide has no paragraph on how figures reach Selah. `docs/handbook/client/en.md` mentions indicators once (line 59) and never "Data sharing". A client admin meets the choice card on first visit with nothing in the guide to read. See item 11.

### 4.3 Does any screen imply Selah proved an impact?

**Works today.** The claim line is on every surface the agreement names: the indicators card (client page and homes), the indicator page, a recommendation's linked indicators, `/indicators/data`, the import, the status pack page and its PDF, the client report PDF, the closure PDF and the project report PDF (`claimNote` used in `indicators-card.tsx`, `indicators/[id]/page.tsx`, `linked-indicators-card.tsx`, `indicators/data/page.tsx`, `import-wizard.tsx`, `status-pack.tsx`, `client-report-html.ts`, `closure-html.ts`, `report-html.ts`, `services/exports.ts`). The client reads "Your company's reported figures, not verified impact" on screen (`t_data_ca.txt`). The assistant's indicator text ends with the same line (`src/services/assistant.ts:868`). The report PDF ends "…that still does not prove business impact" (`rep2_fa.pdf`). Nothing claims a cause.

**Half-done: words and colour that judge (item 6).**
- The indicators card counts "Better than baseline 2 / Worse than baseline 1" and each row carries a badge "Worse than baseline" in the red "problem" tone, "Better than baseline" in the green "active" tone (`src/components/indicators/indicators-card.tsx:23-28, 150-151`; `messages/en.json:5652-5663`; seen on the client page, `t_client_fa.txt`).
- The client report PDF and the status pack PDF print "+12 · worse", "-7 · better" (`client2_fa.pdf`, `pack2_fa.pdf`).
- The indicator page shows "Toward target" as a percentage (`src/app/(app)/indicators/[id]/page.tsx:135-136`; `src/lib/indicators.ts:62`).
- **What the user would notice:** a red "Worse" beside a recommendation's indicator reads as Selah's verdict on the work. The lead's own rule for the moved-away notice says never "worse", never a colour (`docs/metrics.md`, "When an indicator moves away"), so the card and the notice disagree.
- **Risk:** low for privacy; it bends rule 2 (Selah does not judge). The page audit parked this for batch 5 wording (`page-audit.md` section 8, "Kept for later batches"); batch 5 did not change it.
- **Proposal (small):** say what happened in the client's own terms, without a verdict: "Above baseline (lower is better)", "Below baseline (higher is better)", neutral tone; keep the counts as "moved in the chosen direction / moved the other way"; replace "Toward target 60%" with the plain gap ("4 of 20 to go"). Both languages, card, page, PDFs and assistant text. **Build now.**

### 4.4 Do the numbers agree across the client page, the Progress tab, the monthly report and its PDF?

**Works today, for the firm and anyone who sees the whole project.** On my copy, for *حوكمة مجلس الإدارة*, on the same day:

| Where | Reader | Implemented | Verified of applies | Overdue |
|---|---|---|---|---|
| Client page, Overview (`/clients/:id`) | firm admin | 13% | 1 of 8 | 3 |
| Project, Progress tab, and its status line | firm admin, client admin, sponsor | 13% | 1 of 8 | 3 |
| Client admin and sponsor homes | client admin, sponsor | 13% | 1 of 8 | (not on home) |
| Shared monthly report page (`/reports/:id`, numbers as of 19 Nov) | firm admin, client admin, sponsor, manager | 13% | 1 of 8 | 3 |
| That report as PDF | firm admin, manager | 13% | 1 of 8 | 3 |
| Client report PDF | firm admin | 13% | 1 of 8 | 3 |
| Draft October status pack PDF (frozen at 31 Oct) | firm admin | 13% | 1 of 8 | 0 (as of 31 Oct) |

All read the same two database functions (`app_client_progress()` in `src/services/client-overview.ts:83`, `app_project_progress()` for reports), round the same way (`Math.round`, `client-progress.tsx:36`, `client-report-html.ts:44`, `report-html.ts:129`), and the database agrees with the screens (query on `selah_test_u`). The report PDF says honestly that its numbers are frozen at the period's end while its action list is as of the day it was made (`reportPdf.actionsNote`).

**Half-done: the department-limited manager (item 2).**
- manager@nukhba.test (board secretariat only) reads **25%, 1 of 4** for the same project on her home (`t_home_cm.txt`), on the Progress tab (`t_prog_cm.txt`) and in the client report PDF (`client2_cm.pdf`). The shared monthly report and its PDF show her **13%, 1 of 8** (`t_rep_cm.txt`, `rep_cm_en.pdf`, the Arabic one too).
- Both are correct for what each counts: the live views count what she may open (row-level security), the report is frozen for the whole project. Nothing on either screen says so.
- **What the user would notice:** two different "implemented" figures for one project on one day, and she cannot tell which is true.
- **Risk:** trust in the numbers. Not a leak: decision D8 allows counts (the status pack already says how many items it leaves out, never which: `services/exports.ts:294-296`).
- **Proposal (small):** one line under her figures, in both languages: "Your figures count your departments' work and the company-wide work. Reports the firm shares count the whole project." Shown only to readers with department limits. **Build now.** Per-reader reports would be a new feature; not proposed.

### 4.5 An export in the other language (item 12)

`?lang=en` on `/api/reports/:id/pdf` and `/api/clients/:id/report` gives English dates and names but **Arabic labels** when the browser's language cookie is Arabic (`rep_cm_en.pdf`, `client_fa_en.pdf`: "تقرير التنفيذ" with "Nov 19, 2026" and English indicator names). Cause: `src/i18n/request.ts` always takes the locale from the cookie and ignores the one asked for, so `getTranslations({ locale })` in `exportLocale()` callers gets the cookie's messages. With the cookie set to English the same files are fully English (`rep2_*.pdf`, `client2_*.pdf`). The buttons send the screen's own language (`src/components/export-button.tsx:46`), so a user meets this only through a direct link or a future "download in the other language" button. **Proposal (small):** let the request config honour a requested locale. **Build after the scenarios.**

---

## Area 5: The governance assessment

### What works today (end to end on my copy)

Scripted as lead@mizan.test and admin@nukhba.test against the seeded baseline assessment (`58ab60d9…`):
1. **Take:** the seeded draft had 19 questions left; I answered them all; the totals moved from 6 of 16 points to 40 of 59 (67.8%), 14 suggested gaps.
2. **Finalise:** 200, status final.
3. **Gaps to findings:** confirming gap 1.2 as a finding: 200; confirming it twice: 409 "this gap is already a finding"; confirming a non-gap: 409 "that answer is not a gap". The follow-up lists the finding with its (zero) recommendations and actions.
4. **Share and scores firm-only:** the client admin's read of the shared assessment has `earned`, `possible`, `pct`, `gaps` as null, no `isGap`, no points, no weights, no option points, no thresholds. The client's assessment page has no percentage (`t_as_ca.txt`); the lead's has 67.8%, 50%, 54.5%… (`t_as_ld.txt`).
5. **Retake and compare:** retake 200 on the same template; after answering and finalising, compare for the firm shows 40/59 → 48/55, gaps 14 → 3, per section; the client's compare has the changed answers and null points.
6. **Report from an assessment:** 200.
- `tests/db/assessments.test.ts` passes (authors, starter template, published versions, isolation, scoring, finalising, sharing, gaps to findings, minimal records, retake and compare).
- The cycle does not depend on it: direct recommendations work without an assessment (same test file, "direct recommendations still work without any assessment").

### Half-done

- **The client reads the consultant's guidance (item 8).** The shared assessment shows the client "Not scored. The family ownership questions … apply only when the answer is yes." and "A gap here can be answered with a recommendation to draft a family charter, which the firm can deliver." (`t_as_ca.txt` lines 59 and 88). The second is the firm's own sales note; the first talks about scoring the client cannot see. **Proposal (small):** a question's guidance is firm-only by default, with an optional "note for the client" field; hide guidance from client readers until then. **Build after the scenarios.**
- **Two citations are still "source to verify"** in the starter template: 2.3 (the family-charter chapter of a reported draft) and 3.4 (no confirmed board-meeting count) (`docs/assessments.md`, "The starter template").
- **The database still lets a client's admins and managers read the scoring fields of the template questions** of an assessment shared with them; nothing in the app reads them that way, and the doc says a column-level split is left for later (`docs/assessments.md`, "Scoring"). Low risk; note only.
- **No way to bring a real template in** except typing it into the builder, or writing it as code like `src/services/assessment-starter.ts` (418 lines). There is no template import (`src/app/api/assessment-templates/` has only create, starter, draft, duplicate). Per the brief, no engine work: **leave out** until the firm sends its assessment; then decide between typing it in (an author's afternoon for ~30 questions) and a one-off seed file.
- **Open sponsor question** in `docs/assessments.md`: should the firm's Deep Dive baseline items be the first section, as their own method?

### What the firm must give us to load its real assessment as a template

For each **section**: its title in Arabic and English, its order, an optional description.

For each **question**:
1. A reference ("2.1"), unique in the template; it is how a retake is compared with the earlier one.
2. The wording in Arabic and English, and the guidance for the consultant (and, if wanted, a separate line the client may read).
3. The type: yes / partly / no; rating 1 to 4; multiple choice (each option's label in both languages and its points, 0 for "describes the client only"); or free text (not scored).
4. Its weight: 1, 2 or 3.
5. When it counts as a gap: the default is half the maximum or less; say if a question needs another threshold.
6. Any condition: "ask only when question X was answered Y" (one simple condition; no trees).
7. Its basis for most clients: good practice, the firm's own method, or the team's proposal.
8. The legal forms for which it is binding, or regulator guidance (sole proprietorship, LLC, closed JSC, listed JSC, bank or finance company, capital market institution, non-profit, other).
9. Its source and the place in it (page, section, article), and whether someone has checked that citation against the current text.

For the **template as a whole**: its name, who at the firm may author and publish it, whether the starter template should stay beside it or be archived, and whether results should stay firm-only (decided 21 Oct: yes).

Format: one spreadsheet, one row per question with the columns above, is enough. Any sample client answers must be synthetic.

---

## Area 6: The everyday gaps

### 6.1 A reminder before an engagement ends (item 5)

**What exists.**
- `engagements.ends_on` is stored (migration `0008_engagement_record.sql:25`), entered in the engagement form (`src/components/engagement-form.tsx:68-69`) and shown on the engagement page (`src/app/(app)/engagements/[id]/page.tsx:42-43`). Nothing else reads it: the only other `endsOn` hits are org chart holdings (search of `src/` and every migration after 0008).
- The pieces a reminder would reuse already run: the daily follow-ups job already sends a deliverable reminder once after N working days (`src/jobs/follow-ups.ts:12`, `app_deliverable_reminder_days()` in `0092_deliverable_receipts.sql:178, 447-451`), and firm settings hold day counts.
- There is no renewal step; renewal is a new engagement plus a follow-on project (`docs/review/inputs/selah-big-prompt-v2.md` 4.2).

**What the user would notice.** A retainer or a phase runs out and nobody at the firm is told; work continues past the signed period, or the renewal talk starts late.

**Evidence of need.** Known gap in the tracker review (big prompt 4.2) and confirmed by Fahad as work to do (lead log, "Plan additions… 17 Nov", item e). Research: "Follow-on tracking: a closed engagement can link to a successor (retainer, phase 2) so renewal rates are measurable" (`inputs/research/client-journey/notes/research-lifecycle.md:144`).

**Research check (two questions for a consultant at the firm).**
1. How many days before a contract or retainer ends do you want to hear, and who should hear it: the lead, the deputy, the firm admin, or all three?
2. At that point, what do you actually do: renew, extend the dates, or close the work? Should open actions on its projects be listed in the reminder?

**Proposal (small).** The daily job tells the client's lead and deputy and the firm admins once, N days before `ends_on` (a firm setting, default 30), with the engagement's name, end date and its open projects' open actions count; one line on the firm admin's home under "Waiting on your decision" until the date passes or the engagement is edited. No new screen, no auto-renewal. Audited mail kind, both languages, a database test with `app_firm_today()` dates. **Build after the research check.**

### 6.2 Handover when the lead changes (item 4)

**What exists.**
- `setLead()` swaps the lead and notifies only the new lead (`src/services/staffing.ts:235-249`: one `notifications` insert for `userId`, kind `client.lead`). The client, the old lead and the deputy are not told.
- When a person leaves, `app_hand_over()` can move their `client_lead` holdings to a colleague, also without telling the client (`drizzle/0034_observers.sql`, the `client_lead` block). The departure dialog links to the client's People tab (`src/app/(app)/team/departure-dialog.tsx:64`).
- No handover note exists anywhere (no table, column or text for one; search for "handover note").
- The client does see the new lead's name on Help ("Your consultants", `src/app/(app)/help/page.tsx`) and on its project pages, once they look.

**What the user would notice.** The client finds a new name on Help with no word from the firm; the old lead learns from a colleague; open promises and context live only in the old lead's head.

**Evidence of need.** Known gap (big prompt 4.2), confirmed by Fahad (lead log, item f, "the old-owner/old-lead notice must not be an action notice"). Research: "changing the lead consultant requires a handover note (open threads, relationship notes, pending promises)" (`research-lifecycle.md:165`); the October review check names the lead handover among three parked gaps the research supports (`page-audit.md` section 7).

**Research check.**
1. When your firm changes a client's lead, who tells the client today, and how (a call, a letter, a meeting)? Should Selah send that notice, or only remind the firm to?
2. What does an outgoing lead hand over in practice: open promises, people to know at the client, sensitive context? Should the client ever read any of it?

**Proposal (medium).** When the lead changes (either path): (a) the old lead and the deputy get an in-app notice "X is now the lead for <client>" (not an action notice, per Fahad's rule); (b) the client's admins get a plain notice "Your lead consultant is now X" with the new lead's work address, worded by the firm; (c) a firm-only handover note on the client's People tab, written by the old lead or the firm admin, read by the firm staff on the client, kept with its author and date, audited. Allow and deny tests (client never reads the note; another client never gets the notice). **Build after the research check.**

### 6.3 A way for an unhappy client to reach the firm admin (item 9)

**What exists (more than the tracker review knew).**
- Since batch 1, Help has a card "Write to the firm's management": "If something in Selah isn't working, or something about the work worries you and you'd rather not raise it with your consultant, write here. The firm's management reads it, not your consultants." (`help.problem.lead`/`leadNamed`; `src/app/(app)/help/page.tsx`).
- It reaches every active firm admin in Selah and by mail (`app_report_problem()`, `drizzle/0060_help.sql:55-85`); only the firm admin reads and handles it (`support_request.read`/`handle`, `src/authz/policy.ts:367-369`); it sits on the firm admin's home as "Messages from clients to the firm's management" (`docs/metrics.md`, home page section). Every client role may send one (up to a daily limit).

**What is still half-done.**
- One box for two different things: the placeholder speaks only of bugs ("For a problem in Selah: what you were doing, what you expected…", `help.problem.placeholder`), and the firm admin sees no difference between a bug and a complaint.
- "Mark handled" is the only answer; the client sees "Handled" and nothing else (`help.problem.handled`; `app_handle_support_request()`).
- No word on what happens next or how soon.

**Evidence of need.** The page audit parked "a named contact at the firm for a concern that is not about the software" for Gate B (`page-audit.md` rows 27 and 6, "Left for gate B"); the October review check found research support for "a complaint route to the firm admin" (`page-audit.md` section 7).

**Research check.**
1. When a client is unhappy with a consultant today, whom do they contact at your firm, and does that person answer in writing, by phone or in a meeting?
2. Should a concern about a consultant be kept apart from technical problems, and should the consultant ever be told who raised it?

**Proposal (small).** Keep the one card; add a choice "About Selah / About the work" so the firm admin's home lists them apart, change the placeholder to fit both, and say what happens next ("Someone from the firm's management will contact you"). An optional short reply from the firm admin that the sender reads on Help is the only new behaviour; leave it out unless the answers ask for it. **Build after the research check** (wording first; it needs no research).

---

## Area 7: Anything else half-done (checked on origin/main at 4ffb703)

### Still true

1. **A restricted client's admin cannot record progress or evidence (item 1).**
   - Docs promise it: "Who records progress and evidence … restricted: the client admin" (`docs/engagement.md:12`).
   - Code refuses it: `action.work` and `evidence.submit` grant only `client_manager` and `action_owner` (`DO_WORK`, `src/authz/policy.ts:30, 185, 225`); the special policies cover internal projects and consultant-managed clients only (`policy.ts:400-424`, `grantFor()` at 465-479). A restricted client has admins only (`tests/db/engagement.test.ts:322-325`), and firm staff may record only for consultant-managed clients. So **nobody** can move a restricted client's actions.
   - Confirmed on my copy: the restricted admin who owns *تشكيل مجلس العائلة* sees "Next step: With the person it is given to." and no button (`t_act_ra.txt`); `POST /api/actions/:id/transition {"to":"in_progress"}` → 404; `POST /api/actions/:id/updates` → 404. The database itself would accept the evidence row (`engagement.test.ts:358-366` inserts one as the admin), so only the permission table is missing.
   - No seeded client is restricted, which is why no screen check caught it.
   - **Proposal (small):** a restricted-mode policy that adds `client_admin` (as `assigned`, the action's owner) to `action.work`, `evidence.submit` and `progress_update.create`; allow and deny tests; a restricted client in the walkthrough. **Build now.**
2. **"I am stuck" notifies nobody at the firm (item 3).** `transitionAction()` notifies only the owner, and only when someone else moved it; the firm's team is told only for `awaiting_review` (`src/services/actions.ts:282-296`). The hint still says "Explain what is blocking this action. The consultant will see it." (`messages/en.json:684`). The client guide is honest ("No separate notification is sent to the consultant", `docs/handbook/client/en.md:155`), so the app and the guide disagree. **Proposal (small):** send `action.blocked` to the project's firm-side team with `app_notify_project_team()`, as `awaiting_review` does (the kind and its labels already exist: `notifications.kinds.action_blocked`). Then fix the guide line. **Build now.**
3. **Stale words (item 10).**
   - `phases.newHint` (shown on the firm's client page, `clients/[id]/page.tsx:273`): "staff it from its Team tab" / «تبويب الفريق»; the project tab is now People (`messages/en.json:3644`, `ar.json:3644`). The lead log called this key `engagements.newHint`; its real name is `phases.newHint`.
   - `action.move.blocked` "Mark as blocked" (`en.json:675`) and `help.ask.button` "Ask your consultant" (`en.json:5417`): no code uses either any more (searched `src/` and `tests/`). Dead keys; delete.
   - `docs/walkthrough.md:180` says «اسأل مستشارك»; the button is «اسأل المستشار» (the client guide has it right, `client/ar.md:165`).
   - `tips.secondReview.signOff` says "until another consultant signs"; the second signer can be any eligible firm staff (`en.json:6864`; phase 2 review N8).
   - `docs/handoff.md:278` says the last migration is 0067 (it is 0105); `docs/handoff.md:13` names the six-student graduation-project origin; `docs/data-architecture.md:149` also says "For the graduation project". The lead log says that line must go before the technical pack is handed to anyone.
4. **Handbook (item 11).**
   - No client paragraph on the data-sharing choice (see 4.2); no paragraph explaining the second sign-off rule (the firm guide only names it, `firm/en.md:98, 157`).
   - Duplicate HTML ids in the English firm guide: `firm-admin`, `deputy`, `consultant`, `observer` each appear twice (probe of `parseGuide()` on the real `HANDBOOK.firm.en`; Arabic and the client guide have none).
   - "[ar.md](ar.md)" and "[en.md](en.md)" become plain text in the app (`SAFE_HREF`, `src/lib/handbook.ts:94`, refuses them).
   - Unrecognised HTML lines are dropped without warning (`handbook.ts`, phase 2 review N6); none in today's guides.
5. **An invited limited manager's Meetings tab reads "No meetings for you yet"** (Gate B question 2; `t_meet_cm.txt`).
6. **Batch 5 notes left open (item 13).**
   - N1: `dateRequestPlacement` and `closeRequestPlacement` have no caller (`src/lib/status-words.ts:157, 160`); the action page still draws raw "Pending / Approved / Rejected" (`follow-through-panels.tsx:184`). Firm side only.
   - N4: «الطلب» on the inquiry pages, «استفسار» in the audit sentences.
   - N5: the red late date on a client's Projects card also counts actions waiting for the firm.
   - N8: People and Setup tabs have no solid button.
   - (B1, S1-S5 of that review are fixed on main: `meetings.ts:98`, `meetings/[id]/page.tsx:37`, `status-words.ts:123`, `inquiry-steps.ts:70`, `today.ts:467`, `notifications.ts:233-237`, `departure-dialog.tsx:64`.)
7. **Each tooltip on a status badge adds a Tab stop (item 15):** `tabIndex={0}` on the hint wrapper (`src/components/hint.tsx:47`); a 50-row list means 50 extra Tab presses (phase 2 review N2). Tips on disabled buttons never open (N3).
8. **Notices that clear themselves when they stop being true** (`page-audit.md` section 6, "Left for gate B"): only the indicator notice does this today (`app_kpi_notice_fixed()`). Leave out unless a scenario fails on it.

### Fixed since it was logged (not listed above)

- Phase 2 review S1 (`/\host` links), S2 (shared tooltip), S3 (archive tooltip), S4 (client manager tooltip), N1 (Actions empty state), N7 (test file names): fixed (`handbook.ts:94`, `en.json` tips, `actionsPage.empty`).
- `deliverables.noFiles`, `deliverables.firmOnlyFiles`, `plan.action.noOwners`, `handover.sponsorHint`: now name the right tabs.
- The Help FAQ's old wording: none left (search of every English string for "Mark as blocked", "Ask your consultant", old tab names: only the two dead keys above).
- README's four errors: fixed in #189 (README now describes the migrations correctly, line 34).

---

## What I did not do

- No code changed in the app; no branch pushed.
- No live Google Sheet pull or system-key push (it would leave the machine).
- The end-to-end suite was not run.
- The worktree `C:\Projects\selah-fresh\.claude\worktrees\phase3-kpi-u` is left in place (with its `node_modules` and a git-ignored `.env.local`); remove it with `git worktree remove` when no longer needed. The database `selah_test_u` holds the walkthrough data plus my test changes and the database tests' leftovers.
