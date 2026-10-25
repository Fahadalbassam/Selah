import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientKpiLinks, clientKpis, clientKpiValues, departments, organizations, projects, recommendations, user } from "@/db/schema";
import { assertAllowed, authorize, type Permission, type Principal, type Resource } from "@/authz";
import { firmToday } from "@/lib/dates";
import {
  countIndicators,
  openPeriods,
  summarize,
  type IndicatorDirection,
  type IndicatorFrequency,
  type IndicatorSummary,
  type PeriodStatus,
  type SeriesPoint,
} from "@/lib/indicators";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// Business indicators (KPI layer B, migration: client indicators). The
// client's own numbers for the whole company or one department, entered by
// hand, linked to the recommendations meant to move them. The database holds
// every rule (who reads which, who enters, corrections, the firm's check);
// these calls check the same permissions first so the screens offer only
// what it will take, and read everything under the person's own row-level
// security, so a manager outside a department never learns its indicators.

export interface IndicatorInput {
  nameAr: string | null;
  nameEn: string | null;
  definition: string | null;
  unit: string;
  direction: IndicatorDirection;
  frequency: IndicatorFrequency;
  baseline: number;
  baselinePeriod: string;
  target: number | null;
  targetDate: string | null;
  source: string | null;
  departmentId: string | null;
}

const resource = (p: Principal, orgId: string, departmentId: string | null = null): Resource => ({
  type: "indicator",
  orgId,
  firmOrgId: p.orgKind === "firm" ? p.orgId : undefined,
  projectId: null,
  departmentId,
});

const can = (p: Principal, permission: Permission, orgId: string, departmentId: string | null = null) =>
  authorize(p, permission, resource(p, orgId, departmentId)).allowed;

const columns = {
  id: clientKpis.id,
  orgId: clientKpis.orgId,
  departmentId: clientKpis.departmentId,
  nameAr: clientKpis.nameAr,
  nameEn: clientKpis.nameEn,
  definition: clientKpis.definition,
  unit: clientKpis.unit,
  direction: clientKpis.direction,
  frequency: clientKpis.frequency,
  baseline: clientKpis.baseline,
  baselinePeriod: clientKpis.baselinePeriod,
  target: clientKpis.target,
  targetDate: clientKpis.targetDate,
  source: clientKpis.source,
  active: clientKpis.active,
  createdAt: clientKpis.createdAt,
};

type Row = Pick<typeof clientKpis.$inferSelect, keyof typeof columns>;

const num = (v: string | number | null) => (v === null ? null : Number(v));

type SeriesRow = {
  period: string;
  period_end: string;
  value_id: string | null;
  value: string | null;
  note: string | null;
  entered_by: string | null;
  entered_at: string | null;
  on_behalf: boolean | null;
  checked: boolean | null;
  corrected: boolean | null;
  status: PeriodStatus;
};

/** Each period after the baseline up to the day, with the value known that day (app_kpi_series, under RLS). */
async function seriesOf(tx: Tx, kpiId: string, asOf: string) {
  const { rows } = await tx.execute<SeriesRow>(sql`
    select period::text as period, period_end::text as period_end, value_id, value::text as value, note, entered_by, entered_at,
      on_behalf, checked, corrected, status
    from app_kpi_series(${kpiId}::uuid, ${asOf}::date)`);
  return rows;
}

const points = (rows: SeriesRow[]): SeriesPoint[] => rows.map((r) => ({ period: r.period, value: num(r.value), status: r.status }));

function shape(k: Row) {
  return {
    ...k,
    baseline: Number(k.baseline),
    target: num(k.target),
    direction: k.direction as IndicatorDirection,
    frequency: k.frequency as IndicatorFrequency,
  };
}

export type Indicator = ReturnType<typeof shape> & {
  department: { id: string; nameAr: string; nameEn: string | null } | null;
  summary: IndicatorSummary;
  /** Linked recommendations the reader can open. */
  links: number;
};

async function departmentNames(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; nameAr: string; nameEn: string | null }>();
  const rows = await tx
    .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
    .from(departments)
    .where(inArray(departments.id, ids));
  return new Map(rows.map((d) => [d.id, d]));
}

async function linkCounts(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await tx
    .select({ kpiId: clientKpiLinks.kpiId, n: sql<number>`count(*)::int` })
    .from(clientKpiLinks)
    .where(inArray(clientKpiLinks.kpiId, ids))
    .groupBy(clientKpiLinks.kpiId);
  return new Map(rows.map((r) => [r.kpiId, Number(r.n)]));
}

/** Indicators with their summaries as of a day. Rows the reader can't see never arrive. */
async function withSummaries(tx: Tx, rows: Row[], asOf: string): Promise<Indicator[]> {
  const depts = await departmentNames(tx, [...new Set(rows.map((r) => r.departmentId).filter((d): d is string => !!d))]);
  const links = await linkCounts(tx, rows.map((r) => r.id));
  const out: Indicator[] = [];
  for (const r of rows) {
    const k = shape(r);
    out.push({
      ...k,
      department: r.departmentId ? (depts.get(r.departmentId) ?? null) : null,
      summary: summarize(k, points(await seriesOf(tx, r.id, asOf))),
      links: links.get(r.id) ?? 0,
    });
  }
  return out;
}

async function clientOf(tx: Tx, clientOrgId: string) {
  const [org] = await tx
    .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr, kind: organizations.kind, departmentsEnabled: organizations.departmentsEnabled })
    .from(organizations)
    .where(eq(organizations.id, clientOrgId))
    .limit(1);
  if (!org || org.kind !== "client") throw new NotFoundError("client");
  return org;
}

/**
 * A client's indicators for its overview (or one department's page): active
 * ones first, the company's before the departments', with pooled counts.
 * departmentId undefined: all the reader may see; null: the company's only.
 */
export async function listIndicators(
  tx: Tx,
  principal: Principal,
  clientOrgId: string,
  opts: { departmentId?: string | null; includeInactive?: boolean; today?: string } = {},
) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "indicator.read", resource(principal, clientOrgId));
  const today = opts.today ?? firmToday();
  const rows = await tx
    .select(columns)
    .from(clientKpis)
    .where(
      and(
        eq(clientKpis.orgId, clientOrgId),
        opts.departmentId === undefined ? undefined : opts.departmentId === null ? isNull(clientKpis.departmentId) : eq(clientKpis.departmentId, opts.departmentId),
        opts.includeInactive ? undefined : eq(clientKpis.active, true),
      ),
    )
    .orderBy(desc(clientKpis.active), sql`${clientKpis.departmentId} nulls first`, asc(clientKpis.createdAt));
  const indicators = await withSummaries(tx, rows, today);
  const active = indicators.filter((i) => i.active);
  const departmentOptions = client.departmentsEnabled
    ? await tx
        .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
        .from(departments)
        .where(and(eq(departments.orgId, clientOrgId), eq(departments.active, true)))
        .orderBy(asc(departments.nameAr))
    : [];
  return {
    client: { id: client.id, name: client.name, nameAr: client.nameAr },
    today,
    indicators,
    counts: countIndicators(active.map((i) => i.summary)),
    canManage: can(principal, "indicator.manage", clientOrgId),
    canReport: can(principal, "indicator.report", clientOrgId),
    departments: departmentOptions,
  };
}

export type IndicatorList = Awaited<ReturnType<typeof listIndicators>>;
export type RecommendationIndicators = NonNullable<Awaited<ReturnType<typeof recommendationIndicators>>>;

async function loadIndicator(tx: Tx, id: string) {
  const [row] = await tx.select(columns).from(clientKpis).where(eq(clientKpis.id, id)).limit(1);
  if (!row) throw new NotFoundError("indicator");
  return row;
}

const enterer = alias(user, "enterer");
const checker = alias(user, "checker");

/** One indicator's page: every period with its value, every value ever entered, and its links. */
export async function getIndicator(tx: Tx, principal: Principal, id: string, today = firmToday()) {
  const row = await loadIndicator(tx, id);
  assertAllowed(principal, "indicator.read", resource(principal, row.orgId, row.departmentId));
  const client = await clientOf(tx, row.orgId);
  const [indicator] = await withSummaries(tx, [row], today);
  const series = await seriesOf(tx, id, today);
  // Every value, the replaced ones too: a correction never erases what was said before.
  const values = await tx
    .select({
      id: clientKpiValues.id,
      period: clientKpiValues.period,
      value: clientKpiValues.value,
      note: clientKpiValues.note,
      enteredBy: enterer.name,
      enteredById: clientKpiValues.enteredBy,
      enteredAt: clientKpiValues.enteredAt,
      onBehalf: clientKpiValues.onBehalf,
      supersedesId: clientKpiValues.supersedesId,
      checkedBy: checker.name,
      checkedAt: clientKpiValues.checkedAt,
    })
    .from(clientKpiValues)
    .leftJoin(enterer, eq(enterer.id, clientKpiValues.enteredBy))
    .leftJoin(checker, eq(checker.id, clientKpiValues.checkedBy))
    .where(eq(clientKpiValues.kpiId, id))
    .orderBy(desc(clientKpiValues.period), desc(clientKpiValues.enteredAt));
  const replaced = new Set(values.map((v) => v.supersedesId).filter(Boolean));
  const history = values.map((v) => ({ ...v, value: Number(v.value), current: !replaced.has(v.id) }));
  const links = await linkedRecommendations(tx, [id]);
  const canManage = can(principal, "indicator.manage", row.orgId, row.departmentId);
  const canReport = row.active && can(principal, "indicator.report", row.orgId, row.departmentId);
  const canCheck = can(principal, "indicator.check", row.orgId, row.departmentId);
  return {
    client: { id: client.id, name: client.name, nameAr: client.nameAr },
    indicator: indicator!,
    today,
    series: series.map((s) => ({
      period: s.period,
      periodEnd: s.period_end,
      value: num(s.value),
      valueId: s.value_id,
      status: s.status,
      onBehalf: s.on_behalf ?? false,
      checked: s.checked ?? false,
      corrected: s.corrected ?? false,
    })),
    history,
    links: links.get(id) ?? [],
    // Periods with no value yet that can take one now (a filled one is corrected from its row).
    openPeriods: canReport
      ? openPeriods(row.baselinePeriod, row.frequency as IndicatorFrequency, today).filter(
          (p) => !series.some((s) => s.period === p && s.status === "reported"),
        )
      : [],
    canManage,
    canReport,
    canCheck,
    viewerId: principal.userId,
    canDelete: canManage && history.length === 0,
    linkable: canManage ? await linkableRecommendations(tx, row.orgId, id) : [],
    departments: canManage && client.departmentsEnabled
      ? await tx
          .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
          .from(departments)
          .where(and(eq(departments.orgId, row.orgId), eq(departments.active, true)))
          .orderBy(asc(departments.nameAr))
      : [],
  };
}

export type IndicatorDetail = Awaited<ReturnType<typeof getIndicator>>;

/**
 * The recommendations linked to indicators, with where they stand: how many
 * of their released actions are verified, of those that still apply. Only
 * links and actions the reader can open are counted.
 */
async function linkedRecommendations(tx: Tx, kpiIds: string[]) {
  const out = new Map<string, { id: string; title: string; projectId: string; projectTitle: string; verified: number; applies: number; withdrawn: boolean; shared: boolean }[]>();
  if (!kpiIds.length) return out;
  const { rows } = await tx.execute<{
    kpi_id: string;
    id: string;
    title: string;
    project_id: string;
    project_title: string;
    verified: number;
    applies: number;
    withdrawn: boolean;
    shared: boolean;
  }>(sql`
    select l.kpi_id, r.id, r.title, p.id as project_id, p.title as project_title, r.withdrawn_at is not null as withdrawn,
      r.visibility = 'shared' as shared,
      (select count(*)::int from actions a where a.recommendation_id = r.id and a.status = 'verified_complete') as verified,
      (select count(*)::int from actions a where a.recommendation_id = r.id and a.status <> 'draft'
         and a.closure_outcome is distinct from 'not_applicable' and a.closure_outcome is distinct from 'superseded') as applies
    from client_kpi_links l
    join recommendations r on r.id = l.recommendation_id
    join projects p on p.id = r.project_id
    where l.kpi_id = any(${sql.param(kpiIds)}::uuid[])
    order by p.title, r.title`);
  for (const r of rows) {
    out.set(r.kpi_id, [
      ...(out.get(r.kpi_id) ?? []),
      { id: r.id, title: r.title, projectId: r.project_id, projectTitle: r.project_title, verified: Number(r.verified), applies: Number(r.applies), withdrawn: r.withdrawn, shared: r.shared },
    ]);
  }
  return out;
}

/** The client's recommendations the reader can open and could link (not withdrawn, not linked yet). */
async function linkableRecommendations(tx: Tx, orgId: string, kpiId: string) {
  return tx
    .select({ id: recommendations.id, title: recommendations.title, projectTitle: projects.title })
    .from(recommendations)
    .innerJoin(projects, eq(projects.id, recommendations.projectId))
    .where(
      and(
        eq(recommendations.orgId, orgId),
        isNull(recommendations.withdrawnAt),
        sql`not exists (select 1 from client_kpi_links l where l.kpi_id = ${kpiId}::uuid and l.recommendation_id = ${recommendations.id})`,
      ),
    )
    .orderBy(asc(projects.title), asc(recommendations.title))
    .limit(300);
}

function clean(input: Partial<IndicatorInput>) {
  const trim = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : s.trim() || null);
  return {
    ...input,
    nameAr: trim(input.nameAr),
    nameEn: trim(input.nameEn),
    definition: trim(input.definition),
    source: trim(input.source),
    unit: input.unit?.trim(),
    baseline: input.baseline === undefined ? undefined : String(input.baseline),
    target: input.target === undefined ? undefined : input.target === null ? null : String(input.target),
  };
}

export async function createIndicator(tx: Tx, principal: Principal, clientOrgId: string, input: IndicatorInput) {
  await clientOf(tx, clientOrgId);
  assertAllowed(principal, "indicator.manage", resource(principal, clientOrgId, input.departmentId));
  const v = clean(input);
  if (!v.nameAr && !v.nameEn) throw new BadRequestError("name the indicator");
  const [row] = await tx
    .insert(clientKpis)
    .values({
      orgId: clientOrgId,
      departmentId: input.departmentId,
      nameAr: v.nameAr ?? null,
      nameEn: v.nameEn ?? null,
      definition: v.definition ?? null,
      unit: v.unit!,
      direction: input.direction,
      frequency: input.frequency,
      baseline: v.baseline!,
      baselinePeriod: input.baselinePeriod,
      target: v.target ?? null,
      targetDate: input.targetDate,
      source: v.source ?? null,
      createdBy: principal.userId,
    })
    .returning({ id: clientKpis.id });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.create",
    resourceType: "indicator",
    resourceId: row!.id,
    outcome: "allow",
    meta: { client: clientOrgId, department: input.departmentId },
  });
  return { id: row!.id };
}

export async function updateIndicator(tx: Tx, principal: Principal, id: string, input: Partial<IndicatorInput> & { active?: boolean }) {
  const row = await loadIndicator(tx, id);
  assertAllowed(principal, "indicator.manage", resource(principal, row.orgId, row.departmentId));
  if (input.departmentId !== undefined && input.departmentId !== row.departmentId) {
    assertAllowed(principal, "indicator.manage", resource(principal, row.orgId, input.departmentId));
  }
  const v = clean(input);
  const set = Object.fromEntries(Object.entries({ ...v, active: input.active }).filter(([, x]) => x !== undefined));
  if ("nameAr" in set || "nameEn" in set) {
    const nameAr = "nameAr" in set ? set.nameAr : row.nameAr;
    const nameEn = "nameEn" in set ? set.nameEn : row.nameEn;
    if (!nameAr && !nameEn) throw new BadRequestError("name the indicator");
  }
  const updated = await tx.update(clientKpis).set(set).where(eq(clientKpis.id, id)).returning({ id: clientKpis.id });
  if (!updated.length) throw new NotFoundError("indicator");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: input.active === undefined ? "indicator.update" : input.active ? "indicator.restore" : "indicator.archive",
    resourceType: "indicator",
    resourceId: id,
    outcome: "allow",
    meta: { fields: Object.keys(set).join(",") },
  });
  return { ok: true };
}

/** Only while it has no values (the database refuses otherwise); after that it is switched off. */
export async function deleteIndicator(tx: Tx, principal: Principal, id: string) {
  const row = await loadIndicator(tx, id);
  assertAllowed(principal, "indicator.manage", resource(principal, row.orgId, row.departmentId));
  const gone = await tx.delete(clientKpis).where(eq(clientKpis.id, id)).returning({ id: clientKpis.id });
  if (!gone.length) throw new NotFoundError("indicator");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.delete",
    resourceType: "indicator",
    resourceId: id,
    outcome: "allow",
    meta: { client: row.orgId },
  });
  return { ok: true, clientOrgId: row.orgId };
}

/**
 * A value for a period, or a correction of the period's current value. The
 * database decides the period, the name it goes under and whether the firm
 * entered it for the client (which tells the client's admins).
 */
export async function addValue(
  tx: Tx,
  principal: Principal,
  id: string,
  input: { period: string; value: number; note: string | null; supersedesId?: string | null },
) {
  const row = await loadIndicator(tx, id);
  assertAllowed(principal, "indicator.report", resource(principal, row.orgId, row.departmentId));
  const [saved] = await tx
    .insert(clientKpiValues)
    .values({
      kpiId: id,
      orgId: row.orgId,
      period: input.period,
      value: String(input.value),
      note: input.note?.trim() || null,
      enteredBy: principal.userId,
      supersedesId: input.supersedesId ?? null,
    })
    .returning({ id: clientKpiValues.id, onBehalf: clientKpiValues.onBehalf });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: input.supersedesId ? "indicator.correct" : "indicator.value",
    resourceType: "indicator",
    resourceId: id,
    outcome: "allow",
    meta: { period: input.period, value: saved!.id, onBehalf: saved!.onBehalf },
  });
  return { id: saved!.id };
}

/** The firm compared a value with the client's source. Once, never by who entered it. */
export async function checkValue(tx: Tx, principal: Principal, valueId: string) {
  const [v] = await tx
    .select({ kpiId: clientKpiValues.kpiId, orgId: clientKpis.orgId, departmentId: clientKpis.departmentId })
    .from(clientKpiValues)
    .innerJoin(clientKpis, eq(clientKpis.id, clientKpiValues.kpiId))
    .where(eq(clientKpiValues.id, valueId))
    .limit(1);
  if (!v) throw new NotFoundError("value");
  assertAllowed(principal, "indicator.check", resource(principal, v.orgId, v.departmentId));
  const done = await tx
    .update(clientKpiValues)
    .set({ checkedBy: principal.userId, checkedAt: new Date() })
    .where(eq(clientKpiValues.id, valueId))
    .returning({ id: clientKpiValues.id });
  if (!done.length) throw new NotFoundError("value");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.check",
    resourceType: "indicator",
    resourceId: v.kpiId,
    outcome: "allow",
    meta: { value: valueId },
  });
  return { ok: true };
}

async function recommendationOrg(tx: Tx, recommendationId: string) {
  const [r] = await tx
    .select({ orgId: recommendations.orgId })
    .from(recommendations)
    .where(eq(recommendations.id, recommendationId))
    .limit(1);
  if (!r) throw new NotFoundError("recommendation");
  return r.orgId;
}

export async function linkRecommendation(tx: Tx, principal: Principal, id: string, recommendationId: string) {
  const row = await loadIndicator(tx, id);
  assertAllowed(principal, "indicator.manage", resource(principal, row.orgId, row.departmentId));
  if ((await recommendationOrg(tx, recommendationId)) !== row.orgId) throw new NotFoundError("recommendation");
  await tx
    .insert(clientKpiLinks)
    .values({ kpiId: id, recommendationId, orgId: row.orgId, createdBy: principal.userId })
    .onConflictDoNothing();
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.link",
    resourceType: "indicator",
    resourceId: id,
    outcome: "allow",
    meta: { recommendation: recommendationId },
  });
  return { ok: true };
}

export async function unlinkRecommendation(tx: Tx, principal: Principal, id: string, recommendationId: string) {
  const row = await loadIndicator(tx, id);
  assertAllowed(principal, "indicator.manage", resource(principal, row.orgId, row.departmentId));
  const gone = await tx
    .delete(clientKpiLinks)
    .where(and(eq(clientKpiLinks.kpiId, id), eq(clientKpiLinks.recommendationId, recommendationId)))
    .returning({ kpiId: clientKpiLinks.kpiId });
  if (!gone.length) throw new NotFoundError("link");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.unlink",
    resourceType: "indicator",
    resourceId: id,
    outcome: "allow",
    meta: { recommendation: recommendationId },
  });
  return { ok: true };
}

/**
 * The indicators linked to one recommendation (its page's "Linked
 * indicators"), and the client's other active indicators it could be linked
 * to. Nothing for a reader without indicator rights (an action owner).
 */
export async function recommendationIndicators(tx: Tx, principal: Principal, recommendationId: string, today = firmToday()) {
  const orgId = await recommendationOrg(tx, recommendationId);
  // Internal projects have no client, so nothing to link.
  if (!can(principal, "indicator.read", orgId) || !(await clientOf(tx, orgId).catch(() => null))) return null;
  const rows = await tx
    .select(columns)
    .from(clientKpis)
    .innerJoin(clientKpiLinks, eq(clientKpiLinks.kpiId, clientKpis.id))
    .where(eq(clientKpiLinks.recommendationId, recommendationId))
    .orderBy(asc(clientKpis.createdAt));
  const linked = await withSummaries(tx, rows, today);
  const canManage = can(principal, "indicator.manage", orgId);
  const others = canManage
    ? await tx
        .select({ id: clientKpis.id, nameAr: clientKpis.nameAr, nameEn: clientKpis.nameEn })
        .from(clientKpis)
        .where(
          and(
            eq(clientKpis.orgId, orgId),
            eq(clientKpis.active, true),
            sql`not exists (select 1 from client_kpi_links l where l.kpi_id = ${clientKpis.id} and l.recommendation_id = ${recommendationId}::uuid)`,
          ),
        )
        .orderBy(asc(clientKpis.createdAt))
    : [];
  return { clientOrgId: orgId, linked, canManage, others };
}

/**
 * A compact picture of indicators as of a day, for the reports (status pack,
 * closure, client report) and the assistant: values entered after the day
 * don't count, so a frozen report keeps what was known then.
 */
export interface IndicatorSnapshot {
  id: string;
  nameAr: string | null;
  nameEn: string | null;
  departmentId: string | null;
  departmentAr: string | null;
  departmentEn: string | null;
  unit: string;
  direction: IndicatorDirection;
  frequency: IndicatorFrequency;
  baseline: number;
  baselinePeriod: string;
  target: number | null;
  targetDate: string | null;
  latest: { period: string; value: number } | null;
  previous: { period: string; value: number } | null;
  movement: IndicatorSummary["movement"];
  towardTarget: number | null;
  missing: number;
  points: number[];
  /** Linked recommendations in this scope, by title. */
  recommendations: string[];
}

export async function indicatorSnapshot(
  tx: Tx,
  filter: { clientOrgId: string; projectId?: string; linkedOnly?: boolean },
  asOf: string,
): Promise<IndicatorSnapshot[]> {
  // linkedOnly: the indicators the project's shared recommendations are linked to. Otherwise all the
  // client's active ones, each naming the recommendations (of the project, when given) linked to it.
  const { rows } = await tx.execute<{ id: string }>(
    filter.projectId && filter.linkedOnly
      ? sql`select distinct k.id, k.created_at from client_kpis k join client_kpi_links l on l.kpi_id = k.id
              join recommendations r on r.id = l.recommendation_id
            where r.project_id = ${filter.projectId}::uuid and r.visibility = 'shared' and k.org_id = ${filter.clientOrgId}::uuid order by k.created_at`
      : sql`select k.id from client_kpis k where k.org_id = ${filter.clientOrgId}::uuid and k.active order by k.department_id nulls first, k.created_at`,
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const list = await tx.select(columns).from(clientKpis).where(inArray(clientKpis.id, ids));
  const byId = new Map(list.map((r) => [r.id, r]));
  const depts = await departmentNames(tx, [...new Set(list.map((r) => r.departmentId).filter((d): d is string => !!d))]);
  const links = await linkedRecommendations(tx, ids);
  const out: IndicatorSnapshot[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const k = shape(r);
    const s = summarize(k, points(await seriesOf(tx, id, asOf)));
    const dept = r.departmentId ? depts.get(r.departmentId) : undefined;
    out.push({
      id,
      nameAr: k.nameAr,
      nameEn: k.nameEn,
      departmentId: k.departmentId,
      departmentAr: dept?.nameAr ?? null,
      departmentEn: dept?.nameEn ?? null,
      unit: k.unit,
      direction: k.direction,
      frequency: k.frequency,
      baseline: k.baseline,
      baselinePeriod: k.baselinePeriod,
      target: k.target,
      targetDate: k.targetDate,
      latest: s.latest,
      previous: s.previous,
      movement: s.movement,
      towardTarget: s.towardTarget,
      missing: s.missing,
      points: s.points,
            // Reports reach the client, so only shared recommendations are named.
      recommendations: (links.get(id) ?? [])
        .filter((l) => l.shared && !l.withdrawn && (!filter.projectId || l.projectId === filter.projectId))
        .map((l) => l.title),
    });
  }
  return out;
}
