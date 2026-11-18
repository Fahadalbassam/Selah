import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actionReminders } from "@/db/schema";
import { assertAllowed, authorize, OPEN_STATUSES, type ActionStatus, type Principal, type Resource } from "@/authz";
import { planRulesFor, type PlanRule } from "@/lib/plan-rules";
import {
  actionsHref,
  DEVIATION_RULE,
  filtersFor,
  isRuleFilter,
  LATE_HREF,
  REVIEW_LONG_DAYS,
  REVIEWS_WAITING_LONG_HREF,
  type ActionFilterKey,
  type ActionsQuery,
} from "@/lib/action-filters";
import { firmToday } from "@/lib/dates";
import { NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";
import { listProjects, PAGE_SIZE } from "./queries";

// The Actions list with its filters (page audit 4.6, D2), the two counts the
// home shows (D5: counts, never a health word), and the Projects table for
// the firm. One reader feeds all three: every action the caller may open,
// read under row-level security (D6 drafts, D8 departments, 1b owners,
// firm-only labels) and checked again with authorize(), like listActions().
// Each filter and each count is then worked out from those same rows, so a
// count always equals the list it opens. Nothing here reads for anyone else.

type Rule = "late" | "blocked" | "stale" | "slipped" | "churn" | "orphaned";

interface Loaded {
  id: string;
  title: string;
  status: ActionStatus;
  dueDate: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  departmentId: string | null;
  departmentAr: string | null;
  departmentEn: string | null;
  createdBy: string;
  projectId: string;
  projectTitle: string;
  projectKind: "client" | "internal";
  projectState: string;
  firmOrgId: string;
  orgId: string;
  orgName: string | null;
  orgNameAr: string | null;
  recommendationTitle: string;
  awaitingReviewAt: Date | null;
  /** Open and on a project that is not closed: what the rules look at. */
  live: boolean;
  late: boolean;
  daysLate: number | null;
  waitingDays: number | null;
  /** The firm's deviation rules this action breaks, with their detail (days, count). */
  deviations: Map<"stale" | "slipped" | "churn" | "orphaned", number | null>;
}

const OPEN = OPEN_STATUSES as readonly string[];
const DAY = 86_400_000;

/**
 * Every action the caller may open, with what the filters need. The SQL
 * narrowing for an action owner is a second lock, as in listActions();
 * row-level security already gives them only their own. The firm's deviation
 * rules (v_deviations, read with the caller's rights) are read only for the
 * firm and only when asked.
 */
async function loadReadable(tx: Tx, principal: Principal, opts: { deviations: boolean; projectId?: string }): Promise<Loaded[]> {
  const today = firmToday();
  const ownerOnly = principal.role === "action_owner" ? sql`and a.owner_user_id = ${principal.userId}::uuid` : sql``;
  // One project only, when asked (the project page): filtered in SQL, not after reading the whole board.
  const onProject = opts.projectId ? sql`and a.project_id = ${opts.projectId}::uuid` : sql``;
  const { rows } = await tx.execute<{
    id: string;
    title: string;
    status: ActionStatus;
    due_date: string | null;
    owner_user_id: string | null;
    owner_name: string | null;
    department_id: string | null;
    department_ar: string | null;
    department_en: string | null;
    created_by: string;
    project_id: string;
    project_title: string;
    project_kind: "client" | "internal";
    project_state: string;
    firm_org_id: string;
    org_id: string;
    org_name: string | null;
    org_name_ar: string | null;
    recommendation_title: string;
    awaiting_review_at: string | Date | null;
    days_late: number | null;
  }>(sql`
    select a.id, a.title, a.status::text as status, a.due_date::text as due_date, a.owner_user_id,
           coalesce(u.name, a.owner_name) as owner_name,
           a.department_id, d.name_ar as department_ar, d.name_en as department_en,
           a.created_by, a.project_id, p.title as project_title, p.kind::text as project_kind, p.state::text as project_state,
           p.firm_org_id, a.org_id, o.name as org_name, o.name_ar as org_name_ar,
           rc.title as recommendation_title, a.awaiting_review_at,
           (${today}::date - a.due_date) as days_late
    from actions a
    join projects p on p.id = a.project_id
    join recommendations rc on rc.id = a.recommendation_id
    left join "user" u on u.id = a.owner_user_id
    left join departments d on d.id = a.department_id
    left join organizations o on o.id = a.org_id
    where true ${ownerOnly} ${onProject}
    order by a.due_date asc nulls last, a.id`);
  const deviations = new Map<string, Loaded["deviations"]>();
  if (opts.deviations && principal.orgKind === "firm" && rows.length) {
    const { rows: dev } = await tx.execute<{ entity_id: string; rule: "stale" | "slipped" | "churn" | "orphaned"; detail: Record<string, number | null> }>(sql`
      select d.entity_id, d.rule, d.detail from v_deviations d
      where d.entity_type = 'action' and d.rule in ('stale', 'slipped', 'churn', 'orphaned') ${opts.projectId ? sql`and d.project_id = ${opts.projectId}::uuid` : sql``}`);
    for (const d of dev) {
      const m = deviations.get(d.entity_id) ?? new Map();
      m.set(d.rule, d.detail.days ?? d.detail.count ?? null);
      deviations.set(d.entity_id, m);
    }
  }
  const now = Date.now();
  return rows
    .map((r): Loaded => {
      const live = OPEN.includes(r.status) && r.project_state !== "closed";
      const since = r.awaiting_review_at ? new Date(r.awaiting_review_at) : null;
      const late = live && r.due_date !== null && r.due_date < today;
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        dueDate: r.due_date,
        ownerUserId: r.owner_user_id,
        ownerName: r.owner_name,
        departmentId: r.department_id,
        departmentAr: r.department_ar,
        departmentEn: r.department_en,
        createdBy: r.created_by,
        projectId: r.project_id,
        projectTitle: r.project_title,
        projectKind: r.project_kind,
        projectState: r.project_state,
        firmOrgId: r.firm_org_id,
        orgId: r.org_id,
        orgName: r.org_name,
        orgNameAr: r.org_name_ar,
        recommendationTitle: r.recommendation_title,
        awaitingReviewAt: since,
        live,
        late,
        daysLate: late ? Number(r.days_late) : null,
        waitingDays: r.status === "awaiting_review" && since ? Math.max(0, Math.floor((now - since.getTime()) / DAY)) : null,
        deviations: live ? (deviations.get(r.id) ?? new Map()) : new Map(),
      };
    })
    .filter((r) => authorize(principal, "action.read", actionResource(r)).allowed);
}

const actionResource = (r: Pick<Loaded, "id" | "orgId" | "firmOrgId" | "projectId" | "createdBy" | "ownerUserId" | "status">): Resource => ({
  type: "action",
  id: r.id,
  orgId: r.orgId,
  firmOrgId: r.firmOrgId,
  projectId: r.projectId,
  createdBy: r.createdBy,
  assignees: r.ownerUserId ? [r.ownerUserId] : [],
  draft: r.status === "draft",
});

/** Does this action belong in this filter's list? The one place each rule is decided. */
function matches(r: Loaded, filter: ActionFilterKey, principal: Principal): boolean {
  switch (filter) {
    case "all":
      return true;
    case "mine":
      return r.ownerUserId === principal.userId;
    case "awaiting-review":
      return r.live && r.status === "awaiting_review";
    case "late":
      return r.late;
    case "blocked":
      return r.live && r.status === "blocked";
    default:
      return r.deviations.has(DEVIATION_RULE[filter]);
  }
}
const waitedLong = (r: Loaded) => r.waitingDays !== null && r.waitingDays > REVIEW_LONG_DAYS;

/** The rules an action breaks, as its row says them ("12 days late · blocked"). A client reader gets late and blocked only. */
function reasons(r: Loaded): { rule: Rule; n: number | null }[] {
  const out: { rule: Rule; n: number | null }[] = [];
  if (r.late) out.push({ rule: "late", n: r.daysLate });
  if (r.live && r.status === "blocked") out.push({ rule: "blocked", n: null });
  for (const rule of ["stale", "slipped", "churn", "orphaned"] as const) if (r.deviations.has(rule)) out.push({ rule, n: r.deviations.get(rule) ?? null });
  return out;
}

export interface FacetOption {
  value: string;
  label: string;
  /** The other language's name, where the record has one. */
  labelAr?: string | null;
}

export interface BoardRow {
  id: string;
  title: string;
  status: ActionStatus;
  dueDate: string | null;
  ownerName: string | null;
  projectId: string;
  projectTitle: string;
  recommendationTitle: string;
  late: boolean;
  reasons: { rule: Rule; n: number | null }[];
  /** On "awaiting review": how long it has waited and, for the firm only, how far its sign-off has got. */
  review: {
    waitingDays: number | null;
    since: Date | null;
    stage: { required: boolean; signedBy: string | null; signedByMe: boolean; canAct: boolean } | null;
  } | null;
  /** On the rule lists, for the firm: may this person remind the owner now, and when it was last done. */
  remind: { can: boolean; remindedToday: boolean; lastReminded: string | null } | null;
}

export interface ActionBoard {
  /** The query as applied: a filter or facet the reader is not offered is dropped. */
  query: ActionsQuery;
  filters: ActionFilterKey[];
  counts: Partial<Record<ActionFilterKey, number>>;
  /** Reviews that have waited longer than REVIEW_LONG_DAYS days, within the facets. */
  waitingLongCount: number;
  rows: BoardRow[];
  total: number;
  pageSize: number;
  facets: {
    clients: FacetOption[] | null;
    projects: FacetOption[] | null;
    owners: FacetOption[] | null;
    departments: FacetOption[] | null;
  };
}

/** The choices of a facet: each value once, by name. */
function distinct(options: (FacetOption | null)[]): FacetOption[] {
  const m = new Map<string, FacetOption>();
  for (const o of options) if (o && !m.has(o.value)) m.set(o.value, o);
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * One page of the Actions list for this reader and query, with the count of
 * every filter it is offered (within the chosen client, project, owner and
 * department), and the choices for those four from the rows it may open.
 */
export async function actionBoard(tx: Tx, principal: Principal, query: ActionsQuery): Promise<ActionBoard> {
  const firm = principal.orgKind === "firm";
  const actionOwner = principal.role === "action_owner";
  const filters = filtersFor({ firm, actionOwner });
  const filter: ActionFilterKey = filters.includes(query.filter) ? query.filter : "all";
  // Firm measures only for the firm (policy deviation.read).
  const wantsRules = firm && authorize(principal, "deviation.read", { type: "action", orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null }).allowed;
  const all = await loadReadable(tx, principal, { deviations: wantsRules });

  const q: ActionsQuery = {
    ...query,
    filter,
    waitingLong: filter === "awaiting-review" && query.waitingLong,
    client: firm ? query.client : undefined,
    owner: actionOwner ? undefined : query.owner,
    department: actionOwner ? undefined : query.department,
  };
  const inClient = (r: Loaded) => !q.client || (r.orgId === q.client && r.projectKind === "client");
  const inProject = (r: Loaded) => !q.project || r.projectId === q.project;
  const byClient = all.filter(inClient);
  const byProject = byClient.filter(inProject);
  const scoped = byProject.filter((r) => (!q.owner || r.ownerUserId === q.owner) && (!q.department || r.departmentId === q.department));

  const counts: Partial<Record<ActionFilterKey, number>> = {};
  for (const f of filters) counts[f] = scoped.filter((r) => matches(r, f, principal)).length;
  const waitingLongCount = scoped.filter((r) => matches(r, "awaiting-review", principal) && waitedLong(r)).length;

  let shown = scoped.filter((r) => matches(r, filter, principal) && (!q.waitingLong || waitedLong(r)));
  // Reviews: the longest wait first. Everything else keeps the due date order.
  if (filter === "awaiting-review")
    shown = [...shown].sort((a, b) => (a.awaitingReviewAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.awaitingReviewAt?.getTime() ?? Number.MAX_SAFE_INTEGER));
  const total = shown.length;
  const page = shown.slice((q.page - 1) * PAGE_SIZE, q.page * PAGE_SIZE);

  // The firm's extras for the rows on this page only.
  const stages = firm && filter === "awaiting-review" ? await reviewStages(tx, principal, page.map((r) => r.id)) : new Map();
  const reminders = firm && isRuleFilter(filter) ? await reminderState(tx, principal, page) : new Map();

  const rows = page.map(
    (r): BoardRow => ({
      id: r.id,
      title: r.title,
      status: r.status,
      dueDate: r.dueDate,
      ownerName: r.ownerName,
      projectId: r.projectId,
      projectTitle: r.projectTitle,
      recommendationTitle: r.recommendationTitle,
      late: r.late,
      reasons: reasons(r),
      review: filter === "awaiting-review" ? { waitingDays: r.waitingDays, since: r.awaitingReviewAt, stage: stages.get(r.id) ?? null } : null,
      remind: reminders.get(r.id) ?? null,
    }),
  );

  return {
    query: q,
    filters,
    counts,
    waitingLongCount,
    rows,
    total,
    pageSize: PAGE_SIZE,
    facets: {
      clients: firm ? distinct(all.map((r) => (r.projectKind === "client" ? { value: r.orgId, label: r.orgName ?? "—", labelAr: r.orgNameAr } : null))) : null,
      projects: distinct(byClient.map((r) => ({ value: r.projectId, label: r.projectTitle }))),
      owners: actionOwner ? null : distinct(byProject.map((r) => (r.ownerUserId ? { value: r.ownerUserId, label: r.ownerName ?? "—" } : null))),
      departments: actionOwner
        ? null
        : distinct(
            byProject.map((r) =>
              r.departmentId && (r.departmentEn || r.departmentAr) ? { value: r.departmentId, label: r.departmentEn ?? r.departmentAr!, labelAr: r.departmentAr } : null,
            ),
          ),
    },
  };
}

/** How far each review's sign-off has got, and whether the caller may act on it (as the review queue said). Firm only. */
async function reviewStages(tx: Tx, principal: Principal, ids: string[]) {
  const out = new Map<string, NonNullable<BoardRow["review"]>["stage"]>();
  if (!ids.length) return out;
  const { rows } = await tx.execute<{ id: string; owner_user_id: string | null; required: boolean; signed_by: string | null; signed_by_name: string | null; submitted: boolean }>(sql`
    select a.id, a.owner_user_id, s.required, s.signed_by, s.signed_by_name, app_submitted_this_round(a.id) as submitted
    from actions a cross join lateral app_second_review_state(a.id) s
    where a.id = any(${`{${ids.join(",")}}`}::uuid[])`);
  for (const s of rows) {
    const signedByMe = s.signed_by === principal.userId;
    const own = s.owner_user_id === principal.userId || s.submitted;
    out.set(s.id, {
      required: !!s.required,
      signedBy: s.signed_by_name ?? null,
      signedByMe,
      // Nobody reviews work they own or submitted, and the first reviewer does not give the second sign-off.
      canAct: !own && !signedByMe,
    });
  }
  return out;
}

/**
 * Who may be reminded from this page (F18; the database decides again in
 * check_action_reminder): an open action with another active owner, asked by
 * firm staff allowed to remind (not an observer), at most once a firm day.
 */
async function reminderState(tx: Tx, principal: Principal, rows: Loaded[]) {
  const out = new Map<string, NonNullable<BoardRow["remind"]>>();
  if (!rows.length) return out;
  const today = firmToday();
  const { rows: state } = await tx.execute<{ id: string; can_remind: boolean; reminded_today: boolean; last_reminded: string | null }>(sql`
    select a.id,
           (a.owner_user_id is not null and a.owner_user_id <> ${principal.userId}::uuid
             and a.status not in ('draft', 'verified_complete') and a.closure_outcome is null
             and app_member_active(a.owner_user_id, a.org_id)
             and not exists (select 1 from project_members pm where pm.project_id = a.project_id and pm.user_id = ${principal.userId}::uuid and pm.observer)
           ) as can_remind,
           exists (select 1 from action_reminders r where r.action_id = a.id and r.on_day = ${today}::date) as reminded_today,
           (select max(r.on_day)::text from action_reminders r where r.action_id = a.id) as last_reminded
    from actions a where a.id = any(${`{${rows.map((r) => r.id).join(",")}}`}::uuid[])`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const s of state) {
    const r = byId.get(s.id)!;
    const allowed = authorize(principal, "action.remind", actionResource(r)).allowed;
    out.set(s.id, { can: allowed && s.can_remind && !s.reminded_today, remindedToday: s.reminded_today, lastReminded: s.last_reminded });
  }
  return out;
}

/**
 * The two counts that were Oversight's neutral tiles, for the home (D5):
 * late actions and reviews that have waited longer than 7 days, each with
 * the address of the list it equals. For any reader; each sees their own.
 */
export async function attentionCounts(tx: Tx, principal: Principal) {
  const rows = await loadReadable(tx, principal, { deviations: false });
  return {
    late: { n: rows.filter((r) => r.late).length, href: LATE_HREF },
    reviewsWaitingLong: { n: rows.filter((r) => r.live && r.status === "awaiting_review" && waitedLong(r)).length, href: REVIEWS_WAITING_LONG_HREF },
  };
}

export interface ProjectAttention {
  /**
   * One status line under the project's title (October review, item 4; D5:
   * counts, never a health word): how much of the plan is verified, how much
   * is late and how much waits for review, each count with the address of the
   * Actions list it equals.
   */
  status: {
    verified: number;
    /** Released actions that count toward the share (not "not applicable" or "replaced"). */
    of: number;
    pct: number | null;
    late: { n: number; href: string };
    waiting: { n: number; href: string };
  };
  /** The rule chips on Plan: the actions (or, for "disputed", the recommendations) each rule holds. Only the reader's rules. */
  rules: Partial<Record<PlanRule, string[]>>;
  /** Why each action is on a chip ("12 days late"), as the Actions list says it. */
  reasons: Record<string, { rule: Rule; n: number | null }[]>;
}

/**
 * The status line and the rule chips of one project, for this reader, from
 * the rows the Actions list reads (loadReadable: row-level security, then
 * authorize()), so "3 late" here opens /actions?filter=late&project=… with
 * the same three. A recommendation in dispute is the firm's deviation rule
 * (v_deviations, read with the caller's rights). Nothing here reads for
 * anyone else.
 */
export async function projectAttention(tx: Tx, principal: Principal, projectId: string): Promise<ProjectAttention> {
  const firm = principal.orgKind === "firm";
  const project = { type: "action" as const, orgId: principal.orgId, firmOrgId: principal.orgId, projectId };
  const firmRules = firm && authorize(principal, "deviation.read", project).allowed;
  const mine = await loadReadable(tx, principal, { deviations: firmRules, projectId });
  const { rows: outcomes } = mine.length
    ? await tx.execute<{ id: string; outcome: string | null }>(
        sql`select id, closure_outcome::text as outcome from actions where id = any(${`{${mine.map((r) => r.id).join(",")}}`}::uuid[])`,
      )
    : { rows: [] };
  const outcome = new Map(outcomes.map((o) => [o.id, o.outcome]));
  // As app_project_progress(): released actions; "not applicable" and "replaced" do not count toward the share.
  const released = mine.filter((r) => r.status !== "draft");
  const counted = released.filter((r) => !["not_applicable", "superseded"].includes(outcome.get(r.id) ?? ""));
  const verified = released.filter((r) => r.status === "verified_complete").length;

  const rules: ProjectAttention["rules"] = {};
  const offered = planRulesFor(firmRules);
  const ids = (f: (r: Loaded) => boolean) => mine.filter(f).map((r) => r.id);
  for (const rule of offered) {
    if (rule === "disputed") continue;
    rules[rule] =
      rule === "waiting-long"
        ? ids((r) => matches(r, "awaiting-review", principal) && waitedLong(r))
        : ids((r) => matches(r, rule, principal));
  }
  if (offered.includes("disputed")) {
    const { rows } = await tx.execute<{ entity_id: string }>(
      sql`select d.entity_id from v_deviations d where d.project_id = ${projectId}::uuid and d.entity_type = 'recommendation' and d.rule = 'disputed'`,
    );
    rules.disputed = rows.map((r) => r.entity_id);
  }
  return {
    status: {
      verified,
      of: counted.length,
      pct: counted.length ? Math.round((1000 * verified) / counted.length) / 10 : null,
      late: { n: mine.filter((r) => matches(r, "late", principal)).length, href: actionsHref({ filter: "late", project: projectId }) },
      waiting: {
        n: mine.filter((r) => matches(r, "awaiting-review", principal)).length,
        href: actionsHref({ filter: "awaiting-review", project: projectId }),
      },
    },
    rules,
    reasons: Object.fromEntries(mine.map((r) => [r.id, reasons(r)]).filter(([, x]) => (x as unknown[]).length)),
  };
}

export interface ProjectTableRow {
  projectId: string;
  title: string;
  kind: "client" | "internal";
  pitch: boolean;
  state: string;
  clientName: string;
  clientNameAr: string | null;
  mode: "full" | "restricted" | "consultant_managed" | null;
  /** Null on a closed project: its open work was settled at closing. */
  open: number | null;
  late: number | null;
  blocked: number | null;
  /** Whole days the longest-waiting review has waited (as on the Actions list). */
  oldestReviewDays: number | null;
  lead: string | null;
  clientLastActive: Date | null;
}

/**
 * The Projects page's table for the firm (page audit 4.6): what Oversight
 * showed per project, as counts (D5): open, late, blocked, the oldest waiting
 * review, the lead and when the client last did something. The counts come
 * from the same rows as the Actions filters, so "late 3" opens a list of 3.
 * Null for anyone outside the firm.
 */
export async function projectsTable(tx: Tx, principal: Principal): Promise<ProjectTableRow[] | null> {
  if (principal.orgKind !== "firm") return null;
  const projects = await listProjects(tx, principal);
  if (!projects.length) return [];
  const actions = await loadReadable(tx, principal, { deviations: false });
  const ids = `{${projects.map((p) => p.id).join(",")}}`;
  // The lead and the client's last activity: the database's own readers, which answer only for a project the caller can see.
  const { rows: extra } = await tx.execute<{ id: string; lead: string | null; last_active: string | Date | null; mode: ProjectTableRow["mode"] }>(sql`
    select p.id, u.name as lead, app_client_last_active(p.id) as last_active, o.engagement_mode::text as mode
    from projects p
    left join "user" u on u.id = app_project_lead(p.id)
    left join organizations o on o.id = p.org_id
    where p.id = any(${ids}::uuid[])`);
  const byId = new Map(extra.map((e) => [e.id, e]));
  return projects.map((p): ProjectTableRow => {
    const closed = p.state === "closed";
    const mine = actions.filter((a) => a.projectId === p.id);
    const waits = mine.filter((a) => a.live && a.status === "awaiting_review" && a.waitingDays !== null).map((a) => a.waitingDays!);
    const e = byId.get(p.id);
    return {
      projectId: p.id,
      title: p.title,
      kind: p.kind,
      pitch: p.pitch,
      state: p.state,
      clientName: p.orgName,
      clientNameAr: p.orgNameAr,
      mode: p.kind === "client" ? (e?.mode ?? null) : null,
      open: closed ? null : mine.filter((a) => a.live).length,
      late: closed ? null : mine.filter((a) => a.late).length,
      blocked: closed ? null : mine.filter((a) => a.live && a.status === "blocked").length,
      oldestReviewDays: closed || !waits.length ? null : Math.max(...waits),
      lead: e?.lead ?? null,
      clientLastActive: e?.last_active ? new Date(e.last_active) : null,
    };
  });
}

/** Ask the action's owner for an update, once a firm day (F18). The database checks who and when (check_action_reminder). */
export async function remindOwner(tx: Tx, principal: Principal, actionId: string) {
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
