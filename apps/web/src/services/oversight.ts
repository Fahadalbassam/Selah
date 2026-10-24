import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actionReminders } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import type { HealthSignal } from "@/lib/health";
import { firmToday } from "@/lib/dates";
import { NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";
import type { DeviationRule } from "./insight";

// The firm's view across projects (F18): every project the caller can see,
// with a health signal, and the exceptions across them. The database holds
// the rules (migration oversight: app_portfolio, app_health_signal,
// check_action_reminder); these calls only shape the rows.

export interface PortfolioRow {
  projectId: string;
  title: string;
  kind: "client" | "internal";
  state: string;
  clientName: string;
  clientNameAr: string | null;
  mode: "full" | "restricted" | "consultant_managed" | null;
  lead: string | null;
  total: number;
  open: number;
  overdue: number;
  late: { d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  lateLong: number;
  extendedTwice: number;
  blocked: number;
  awaitingReview: number;
  reviewWaiting: number;
  oldestReviewDays: number | null;
  stale: number;
  orphaned: number;
  disputed: number;
  riskAccepted: number;
  clientLastActive: Date | null;
  signal: HealthSignal;
}

const SIGNAL_ORDER: HealthSignal[] = [
  "off_track",
  "watch",
  "on_track",
  "no_data",
];

/** Every open project the caller can see, most at risk first. */
export async function portfolio(
  tx: Tx,
  principal: Principal,
): Promise<PortfolioRow[]> {
  if (principal.orgKind !== "firm") throw new NotFoundError("page");
  assertAllowed(principal, "deviation.read", {
    type: "action",
    orgId: principal.orgId,
    firmOrgId: principal.orgId,
    projectId: null,
  });
  const { rows } = await tx.execute<{
    project_id: string;
    title: string;
    kind: "client" | "internal";
    state: string;
    client_name: string;
    client_name_ar: string | null;
    mode: PortfolioRow["mode"];
    lead: string | null;
    total: number;
    open: number;
    overdue: number;
    late_d1_30: number;
    late_d31_60: number;
    late_d61_90: number;
    late_d90_plus: number;
    late_long: number;
    extended_twice: number;
    blocked: number;
    awaiting_review: number;
    review_waiting: number;
    oldest_review_days: number | null;
    stale: number;
    orphaned: number;
    disputed: number;
    risk_accepted: number;
    client_last_active: string | null;
    signal: HealthSignal;
  }>(sql`
    select f.*, p.title, o.name as client_name, o.name_ar as client_name_ar, o.engagement_mode::text as mode, u.name as lead
    from app_portfolio(${firmToday()}::date) f
    join projects p on p.id = f.project_id
    join organizations o on o.id = f.org_id
    left join "user" u on u.id = f.lead_id`);
  return rows
    .map(
      (r): PortfolioRow => ({
        projectId: r.project_id,
        title: r.title,
        kind: r.kind,
        state: r.state,
        clientName: r.client_name,
        clientNameAr: r.client_name_ar,
        mode: r.kind === "client" ? r.mode : null,
        lead: r.lead,
        total: r.total,
        open: r.open,
        overdue: r.overdue,
        late: {
          d1_30: r.late_d1_30,
          d31_60: r.late_d31_60,
          d61_90: r.late_d61_90,
          d90_plus: r.late_d90_plus,
        },
        lateLong: r.late_long,
        extendedTwice: r.extended_twice,
        blocked: r.blocked,
        awaitingReview: r.awaiting_review,
        reviewWaiting: r.review_waiting,
        oldestReviewDays: r.oldest_review_days,
        stale: r.stale,
        orphaned: r.orphaned,
        disputed: r.disputed,
        riskAccepted: r.risk_accepted,
        clientLastActive: r.client_last_active
          ? new Date(r.client_last_active)
          : null,
        signal: r.signal,
      }),
    )
    .sort(
      (a, b) =>
        SIGNAL_ORDER.indexOf(a.signal) - SIGNAL_ORDER.indexOf(b.signal) ||
        b.overdue - a.overdue ||
        a.title.localeCompare(b.title),
    );
}

export type ExceptionRule = DeviationRule | "blocked" | "review_waiting";

export const EXCEPTION_RULES: ExceptionRule[] = [
  "overdue",
  "review_waiting",
  "blocked",
  "orphaned",
  "disputed",
  "slipped",
  "churn",
  "stale",
  "kpi_off_target",
  "kpi_not_reported",
];

export interface ExceptionRow {
  projectId: string;
  projectTitle: string;
  entityType: "action" | "kpi" | "recommendation";
  entityId: string;
  rule: ExceptionRule;
  detail: Record<string, string | number | null>;
  title: string | null;
  titleAr: string | null;
  owner: string | null;
  can: { remind: boolean };
  remindedToday: boolean;
  lastReminded: string | null;
}

/**
 * The deviations of every open project the caller can see, plus blocked
 * actions and reviews waiting longer than REVIEW_WAIT_DAYS, most pressing first.
 */
export async function exceptions(
  tx: Tx,
  principal: Principal,
): Promise<ExceptionRow[]> {
  if (principal.orgKind !== "firm") throw new NotFoundError("page");
  assertAllowed(principal, "deviation.read", {
    type: "action",
    orgId: principal.orgId,
    firmOrgId: principal.orgId,
    projectId: null,
  });
  const today = firmToday();
  const { rows } = await tx.execute<{
    project_id: string;
    project_title: string;
    entity_type: ExceptionRow["entityType"];
    entity_id: string;
    rule: ExceptionRule;
    detail: Record<string, string | number | null>;
    title: string | null;
    title_ar: string | null;
    owner: string | null;
    can_remind: boolean;
    reminded_today: boolean;
    last_reminded: string | null;
  }>(sql`
    with p as (
      select id, title from projects
      where state::text in ('planned', 'active', 'closing')
    ),
    e as (
      select d.project_id, d.entity_type, d.entity_id, d.rule, d.detail from v_deviations d where d.project_id in (select id from p)
      union all
      select a.project_id, 'action', a.id, 'blocked', '{}'::jsonb from actions a
        where a.project_id in (select id from p) and a.status = 'blocked' and a.closure_outcome is null
      union all
      select a.project_id, 'action', a.id, 'review_waiting', jsonb_build_object('days', ${today}::date - app_firm_date(a.updated_at)) from actions a
        where a.project_id in (select id from p) and a.status = 'awaiting_review'
          and ${today}::date - app_firm_date(a.updated_at) > app_review_wait_days()
    )
    select e.project_id, p.title as project_title, e.entity_type, e.entity_id, e.rule, e.detail,
           coalesce(a.title, rc.title, k.name_en, k.name_ar) as title, k.name_ar as title_ar,
           coalesce(u.name, a.owner_name) as owner,
           -- Who can be chased: an open action with another active owner, by someone not observing.
           (e.entity_type = 'action' and a.owner_user_id is not null and a.owner_user_id <> ${principal.userId}::uuid
             and a.status not in ('draft', 'verified_complete') and a.closure_outcome is null
             and app_member_active(a.owner_user_id, a.org_id)
             and not exists (select 1 from project_members pm where pm.project_id = e.project_id and pm.user_id = ${principal.userId}::uuid and pm.observer)
           ) as can_remind,
           exists (select 1 from action_reminders r where r.action_id = e.entity_id and r.on_day = ${today}::date) as reminded_today,
           (select max(r.on_day)::text from action_reminders r where r.action_id = e.entity_id) as last_reminded
    from e
    join p on p.id = e.project_id
    left join actions a on e.entity_type = 'action' and a.id = e.entity_id
    left join kpis k on e.entity_type = 'kpi' and k.id = e.entity_id
    left join recommendations rc on e.entity_type = 'recommendation' and rc.id = e.entity_id
    left join "user" u on u.id = a.owner_user_id`);
  const order = (r: ExceptionRule) => EXCEPTION_RULES.indexOf(r);
  const days = (d: ExceptionRow["detail"]) => Number(d.days ?? d.count ?? 0);
  return rows
    .map(
      (r): ExceptionRow => ({
        projectId: r.project_id,
        projectTitle: r.project_title,
        entityType: r.entity_type,
        entityId: r.entity_id,
        rule: r.rule,
        detail: r.detail,
        title: r.title,
        titleAr: r.title_ar,
        owner: r.owner,
        can: { remind: r.can_remind && !r.reminded_today },
        remindedToday: r.reminded_today,
        lastReminded: r.last_reminded,
      }),
    )
    .sort(
      (a, b) =>
        order(a.rule) - order(b.rule) ||
        days(b.detail) - days(a.detail) ||
        (a.title ?? "").localeCompare(b.title ?? ""),
    );
}

/** Ask the action's owner for an update, once a day. The database checks who and when. */
export async function remindOwner(
  tx: Tx,
  principal: Principal,
  actionId: string,
) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  assertAllowed(principal, "action.remind", loaded.resource);
  const { action } = loaded;
  const [row] = await tx
    .insert(actionReminders)
    // owner_id and on_day are set by the database (check_action_reminder).
    .values({
      projectId: action.projectId,
      orgId: action.orgId,
      actionId,
      ownerId: principal.userId,
      sentBy: principal.userId,
      onDay: firmToday(),
    })
    .returning({ id: actionReminders.id, onDay: actionReminders.onDay });
  return row!;
}
