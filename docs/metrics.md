# Metrics

Three layers, agreed with Fahad on 2026-10-20. Every number is computed from the workflow or reported by a named person; nothing is estimated. There are no per-consultant scores or rankings, and nothing is labelled "compliance".

Rules: `apps/web/drizzle/0013_metrics_rules.sql`. Tests: `apps/web/tests/db/metrics.test.ts`.

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

**History.** `npm run job:metrics` (monthly, as the schema owner) copies each active project's metrics into `metric_snapshots`, one row per metric per day. The table is append-only and read under the same project rules.

API: `GET /api/projects/:id/metrics` returns `{ live, history }`. Readers: the firm, and the client's admins and managers.

## 2. The team (firm admin only)

- `app_team_workload()`: for each active colleague, sorted by name, the number of clients they are assigned to, the open projects they are staffed on, and the actions waiting for review on their projects. It is for staffing decisions, and carries no score.
- `app_team_metrics(since)`: the team as a whole. Reviews done since the date, the median days from the first evidence of a round to its review, actions waiting for review, and overdue actions.

API: `GET /api/team/metrics` (last 90 days).

## 3. Client KPIs (optional, off by default)

The client's own strategic measures, entered by hand. They need the supervisor's approval before they are used, so they stay off until the firm admin sets `firm_settings.client_kpis_enabled`. While off, the tables read as empty and refuse writes. There is no API for them yet.

- `strategic_objectives`: grouped by balanced-scorecard perspective (financial, customer, internal process, learning and growth).
- `kpis`: unit, direction, baseline, target, start and target dates (periods start on the 1st), monthly or quarterly, owned by a client person staffed on the project, and green and amber thresholds.
- `kpi_readings`: the owner (or the firm) reports a value for one of the KPI's periods that has started, optionally with a scanned evidence file. The firm verifies or rejects it once, and never by the person who reported it. A correction is a new reading that replaces the old one. Readings are never deleted.
- `recommendation_kpis`: a recommendation is *intended to move* a KPI. It is a stated intent, never a claim of cause.
- `app_kpi_periods(kpi, as_of)`: every period up to the date, with its current reading and status (reported, verified, rejected, or, with no reading, **due** until the period end plus `kpi_grace_days`, then **not_reported**, never zero). Each period also shows progress (how far the value is from baseline to target) and expected progress (the share of the time from start to target date passed by the period's end). The band compares the two: green at `green_threshold` % of expected or better, amber at `amber_threshold` %, otherwise red. So a year-long KPI that is on its trajectory shows green from the first period.

Not built, by design: automatic KPI pulls from client systems, consultant rankings.
