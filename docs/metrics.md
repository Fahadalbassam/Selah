# Metrics

Three layers, agreed with Fahad on 2026-10-20. Every number is computed from the workflow or reported by a named person; nothing is estimated. There are no per-consultant scores or rankings, and nothing is labelled "compliance".

Rules: the Metrics section of `apps/web/drizzle/0000_baseline.sql`. Tests: `apps/web/tests/db/metrics.test.ts`.

## 1. Implementation metrics (per project)

`v_project_metrics` is a view with `security_invoker`, so every viewer sees only the projects and rows their row-level security allows. Draft actions are left out. "Today" is the firm's local date (Asia/Riyadh).

| Metric | Definition |
|---|---|
| `actions_total` | Released actions (not draft). |
| `verified` | Actions in Verified Complete. |
| `awaiting_review` | Actions waiting for the firm's review. |
| `blocked` | Actions the owner marked blocked. |
| `overdue` | Open actions (not verified, not closed) whose current due date has passed. |
| `on_time_rate` | % of verified actions verified (date of the last accept review) on or before their **baseline** due date, out of verified actions that have one. |
| `median_days_awaiting_review` | Median days the actions now waiting for review have been waiting. |
| `deadline_slips` | Approved deadline change requests. |
| `revision_rate` | % of reviews that asked for a revision. |
| `stale_actions` | Open actions with no change, progress update or evidence in 14 days. Any change to the action counts, including reassigning its owner. |

`implemented_pct` (see [data-model.md](data-model.md)) completes the set: verified ÷ released actions that still apply.

**Baseline due date.** `actions.baseline_due_date` is set from the due date when the action is released, and a trigger keeps it from changing afterwards. An approved deadline change moves `due_date` (what reminders use) but not the baseline, so on-time is measured against what was agreed, and each move counts as a slip.

**Slip history and aging (F17).** Every move of a released action's due date is kept in `action_due_changes`, whether a request or a plan edit moved it. `app_action_slips()` gives each action's extensions (moves later), the days slipped past the baseline, and, while it is open, how long it is past the baseline, in the buckets 1–30, 31–60, 61–90 and over 90 days. `app_project_progress()` adds the counts (`extended`, `extended_twice`, `slip_days`, `late_d1_30`…`late_d90_plus`), so a frozen report keeps them; reports frozen before F17 don't have them and the report page leaves them out. The third move later needs the client's lead consultant or a firm admin.

**Engagement health (F18).** The oversight page gives each planned, active or closing project one signal from counts, never a weighted score (`app_health_signal()`, `src/lib/health.ts`). Off track: a quarter or more of the open actions are overdue, or an open action is more than 60 days past its original date. Watch: anything overdue, or a caution (blocked, moved twice or more, no active owner, stale, a review waiting more than 7 days, a disputed recommendation). On track otherwise; no work yet when nothing is released. The counts come from `app_project_progress()` and the deviations view, so they match the project's own tabs. The daily job (`npm run job:health`, as the schema owner) keeps each project's signal for the current week in `project_health_weeks`; the oversight page shows the last eight weeks beside the signal. The job counts as the owner, so a move of a date is counted even though no user is set (`app_action_extensions()`).

**Monthly status pack (F19).** On the 1st the job (`npm run job:status-packs`, as the schema owner) drafts last month's pack on every active client project and tells the client's lead. The numbers are the report's usual progress numbers at the period's end (`app_project_progress()`); the lists come from `app_status_pack()`: overdue (open, due by the period's end), moved twice or more (open, two or more later moves, `app_action_extensions()`), risk accepted in the period, verified in the period (the day the action reached verified), how many actions reached each status in the period, and what needs a decision (recommendations awaiting the client's answer, pending deadline changes). Only work the client can be shown is listed. The firm adds a note and issues it, which freezes both; then it can be shared.

**History.** `npm run job:metrics` (monthly, as the schema owner) copies each active project's metrics into `metric_snapshots`, one row per metric per day. The table is append-only and read under the same project rules.

API: `GET /api/projects/:id/metrics` returns `{ live, history }`. Readers: the firm, and the client's admins and managers.

Screen: the project's **Progress** tab shows these numbers, the verified share at each monthly snapshot (with a table view), and the project's reports. Action owners get no tab.

**Reports.** A report freezes `app_project_progress` as of its period's last day, with optional notes. It starts firm-only and the firm shares it with the client in one step that can't be undone; a correction is a new report.

- API: `GET`/`POST /api/projects/:id/reports`, `GET /api/reports/:id`, `POST /api/reports/:id/share`.
- Clients see only shared reports, and an unshared one reads as not found.
- The report page is `/reports/:id`.

## 2. The team (firm admin only)

- `app_team_workload()`: for each active colleague, sorted by name, the number of clients they are assigned to, the open projects they are staffed on, and the actions waiting for review on their projects. It is for staffing decisions, and carries no score.
- `app_team_metrics(since)`: the team as a whole. Reviews done since the date, the median days from the first evidence of a round to its review, actions waiting for review, and overdue actions.

API: `GET /api/team/metrics` (last 90 days).

Screen: the Team page shows both to the firm admin, under the team list. The workload table is sorted by name.

## 3. Client business indicators (KPI layer B)

The client's own measures of its business (monthly sales, complaints, days to close the books), entered over time beside the work. They are **client-reported, not verified impact**, and every screen and report says so in both languages. Migration `0062_client_indicators` replaced the earlier project-level KPI model (objectives, KPIs with green and amber bands, readings), which never had screens.

- `client_kpis`: one indicator of a client, company-wide or for one of its departments (departments stay optional). Name in Arabic and/or English, how it is measured, unit, direction (higher or lower is better), monthly or quarterly, a baseline value and month, an optional target with its date, the source. Once it has a value its baseline, frequency and direction are fixed (start a new indicator to change them), and it is switched off rather than deleted.
- `client_kpi_values`: one value per period on the indicator's grid after the baseline, for a period that has started, with a note. The database records who entered it and when. A change is a correction: a new value that replaces the current one (with a note saying why), and the old value stays in the history. Firm staff may enter values for the client; those are marked "entered by the firm" and the client's admins are told (`indicator.entered_for_you`). Firm staff may also mark a value checked against the client's own source, once, never their own value. That mark is about the figure, not about impact.
- `client_kpi_links`: an indicator and a recommendation of the same client that is expected to move it. It is a stated intent, never a claim of cause. A link to a firm-private recommendation is seen by the firm only.
- `app_kpi_series(kpi, as_of)`: every period from the baseline to the date, with its current value and status: **reported**, **due** (no value yet, within `kpi_grace_days` after the period ends), or **missing** (never zero). Values entered after `as_of` don't count, so a report frozen on a day keeps what was known then.
- `app_remind_kpis(today)`: run by the monthly status-pack job. A client whose last ended period has no value on an active indicator gets one `indicator.due` notice to its admins, at most once in 20 days.

Who: firm staff on the client and the client's admins set indicators up and link them; the client's admins and managers, and firm staff, enter values; managers see the company's indicators and their own departments'; action owners and other clients see none (`indicator.*` in `src/authz/policy.ts`, RLS on the three tables).

Where they show: the client's overview (firm client page and the client admin's or manager's home) beside implementation progress, each department's page, the indicator's own page (`/indicators/:id`: trend line with the target, values with who entered them, corrections, linked recommendations), a recommendation's "Linked indicators" card, the monthly status pack (frozen when issued), the closure report (as of the closing day) and the client report PDF. The assistant answers questions about indicators from these records, under the asker's own rights.

Roll-ups count indicators (how many are up to date, better or worse than their baseline); they never average values or percentages across indicators.

API: `GET/POST /api/clients/:id/indicators`, `GET/PATCH/DELETE /api/indicators/:id`, `POST /api/indicators/:id/values`, `POST /api/indicators/:id/links`, `DELETE /api/indicators/:id/links/:recommendationId`, `POST /api/indicator-values/:id/check`.

Not built, by design: pulls from client systems, weighting formulas, enterprise-wide dashboards, automatic impact claims, consultant rankings.

## Verified on whose evidence

A verification is only as strong as what it rests on, so verified actions are counted by basis, never mixed silently (baseline: Insight):

- `app_verified_basis(action)`: `client_evidence` (everything the accepting review covered came from the client in Selah), `consultant_recorded` (all of it was recorded by a consultant for a consultant-managed client), `mixed`, or `internal`. The review covers the submissions it names, or else those of its round; with no evidence at all, the round's progress updates. Null until verified.
- `v_project_metrics` adds `verified_client_evidence`, `verified_consultant_recorded` and `verified_mixed`, and monthly snapshots keep them.
- The action detail returns `verifiedBasis` for the badge.

## The trace and "since your last visit"

- `GET /api/projects/:id/trace` returns the project as edges (`nodeType`, `nodeId`, `parentType`, `parentId`, `label`, `state`): assessment ← finding (a confirmed gap, docs/assessments.md), finding ← recommendation ← action ← evidence or review, indicator ← recommendation (linked as meant to move it), and action ← action (the node supersedes its parent). It runs with the caller's rights, so a firm-private finding or another department's action, and every link to it, are simply absent. Plain Postgres, no graph database.
- `GET /api/projects/:id/since-last-visit` lists the actions that moved (status or plan, progress, evidence, review) since the person last opened the project, using the same function as a meeting agenda's "changed since the last meeting". The first visit looks back 7 days. `PUT` on the same path marks the project as seen. No AI.

## Today (firm staff)

`/today` answers "what needs me today" across every client a firm person works on (Wave 3). It stores nothing: `today()` in `src/services/today.ts` reads under the person's rights and checks every row with `authorize()`, so it never shows more than the person could already open. Client users get a 404.

Whose work counts: a consultant's projects are the ones they are staffed on, plus every project of a client they lead or deputise on (as `authorize()` already allows). The firm admin may see everything, so for them it is the projects they are staffed on or lead, and the clients and projects they watch. Sections, each with its count, rows grouped by client and the internal projects last:

1. **Waiting for your review**: actions in Awaiting Review on those projects that the person may verify. Work they own or submitted in the current round is left out (the self-review rule, `canTransition()`), so an internal action's owner never sees their own.
2. **Due this week**: open actions overdue or due within 7 days on the clients and internal projects the person leads (lead or deputy), and their own actions; not on closed projects, and not the ones already in the review list.
3. **Your follow-ups**: open follow-ups assigned to them, overdue first. Each links to its meeting, else its action, else the project.
4. **Meetings this week**: not cancelled, starting from today to 7 days ahead (firm days, Asia/Riyadh), that they organise or attend, with whether the agenda is written.
5. **Waiting on your decision**: pending join requests they may decide (the admin, or the client's lead or deputy); pending deadline changes on the projects they lead, not their own; clients' closure requests (the firm admin); and request-list items the client answered (`received`) on their projects.
6. **Since your last visit**: per open project, how many actions moved since they last opened it, with the same function and 7-day first-visit rule as the project page.

Not on the page, by design: time tracking, and team load or backlog columns (a later wave).
