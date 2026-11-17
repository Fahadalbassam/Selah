import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { reports } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import { ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { getReport, projectProgress } from "./follow-through";
import { loadProject } from "./staffing";
import { firmToday } from "@/lib/dates";
import { indicatorSnapshot, type IndicatorSnapshot } from "./indicators";

// The monthly status pack (F19). The job drafts it for last month, firm-only
// (migration status_packs: app_draft_status_packs); the firm reviews it,
// adds a note and issues it, which freezes the numbers and the lists
// (check_status_pack). Sharing stays the report's own step.

interface Item {
  id: string;
  title: string;
  departmentId: string | null;
}
export interface StatusPack {
  overdue: (Item & { owner: string | null; dueDate: string; days: number })[];
  slipped: (Item & { owner: string | null; moves: number; baselineDueDate: string | null; dueDate: string | null })[];
  riskAccepted: (Item & { acceptedBy: string | null; on: string })[];
  verified: (Item & { owner: string | null; on: string })[];
  moved: Record<string, number>;
  decisions: (Item & { kind: "response" | "deadline"; since: string; proposedDueDate?: string })[];
  /** The client's business indicators as known on the day it was issued (KPI layer B); absent on packs issued before them. */
  indicators?: IndicatorSnapshot[];
  /** For a reader with department limits: how many items each list leaves out. Worked out when the pack is read, never stored. */
  leftOut?: Record<(typeof PACK_LISTS)[number], number>;
}

export const PACK_LISTS = ["decisions", "overdue", "slipped", "riskAccepted", "verified"] as const;

async function packFor(tx: Tx, projectId: string, orgId: string, from: string, to: string): Promise<StatusPack> {
  const { rows } = await tx.execute<{ pack: StatusPack }>(sql`select app_status_pack(${projectId}::uuid, ${from}::date, ${to}::date) as pack`);
  return { ...rows[0]!.pack, indicators: await indicatorSnapshot(tx, { clientOrgId: orgId, projectId }, firmToday()) };
}

/**
 * A client reader sees only the items of departments they can see, and is
 * told how many were left out of each list, never which (decision D8). The
 * numbers stay whole: a person at the firm chose to share the report.
 */
async function forReader(tx: Tx, principal: Principal, orgId: string, pack: StatusPack): Promise<StatusPack> {
  // The firm and the client's admin read every department.
  if (principal.orgKind === "firm" || principal.role === "client_admin") return pack;
  const { rows } = await tx.execute<{ id: string }>(
    sql`select d.id from departments d where d.org_id = ${orgId}::uuid and not app_dept_ok(d.id, d.org_id)`,
  );
  // No department is closed to this reader: departments are off, or they are in all of them.
  if (!rows.length) return pack;
  const hidden = new Set(rows.map((r) => r.id));
  const shown = (i: { departmentId: string | null }) => !i.departmentId || !hidden.has(i.departmentId);
  const keep = <T extends Item>(xs: T[]) => xs.filter(shown);
  const indicators = (pack.indicators ?? []).filter(shown);
  // An indicator's linked recommendations were frozen by title. Only the ones
  // this reader can open today are named; a title that cannot be matched
  // (another department's, or one renamed since) is counted, not shown.
  const links = indicators.length
    ? (
        await tx.execute<{ kpi_id: string; title: string }>(sql`
          select l.kpi_id, r.title from client_kpi_links l join recommendations r on r.id = l.recommendation_id
          where l.kpi_id = any(${sql.param(indicators.map((k) => k.id))}::uuid[])`)
      ).rows
    : [];
  const readable = new Set(links.map((l) => `${l.kpi_id}\n${l.title}`));
  const lists = { overdue: keep(pack.overdue), slipped: keep(pack.slipped), riskAccepted: keep(pack.riskAccepted), verified: keep(pack.verified), decisions: keep(pack.decisions) };
  return {
    ...pack,
    ...lists,
    leftOut: {
      decisions: pack.decisions.length - lists.decisions.length,
      overdue: pack.overdue.length - lists.overdue.length,
      slipped: pack.slipped.length - lists.slipped.length,
      riskAccepted: pack.riskAccepted.length - lists.riskAccepted.length,
      verified: pack.verified.length - lists.verified.length,
    },
    indicators: pack.indicators
      ? indicators.map((k) => {
          const recommendations = k.recommendations.filter((title) => readable.has(`${k.id}\n${title}`));
          return { ...k, recommendations, recommendationsLeftOut: k.recommendations.length - recommendations.length };
        })
      : undefined,
  };
}

/** The pack on a report: frozen once issued, worked out live while a draft (only the firm sees a draft). */
export async function reportPack(tx: Tx, principal: Principal, reportId: string) {
  const [row] = await tx
    .select({ kind: reports.kind, pack: reports.pack, metrics: reports.metrics, projectId: reports.projectId, orgId: reports.orgId, periodStart: reports.periodStart, periodEnd: reports.periodEnd })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!row || row.kind !== "status_pack" || !row.periodStart || !row.periodEnd) return null;
  if (row.metrics) return { draft: false, pack: await forReader(tx, principal, row.orgId, row.pack as StatusPack), live: null };
  return {
    draft: true,
    pack: await packFor(tx, row.projectId, row.orgId, row.periodStart, row.periodEnd),
    live: await projectProgress(tx, principal, row.projectId, row.periodEnd),
  };
}

/** Issue a draft pack: the note goes on it and the numbers and lists freeze. It stays firm-only until shared. */
export async function issueStatusPack(tx: Tx, principal: Principal, reportId: string, input: { bodyMd: string }) {
  const { report } = await getReport(tx, principal, reportId);
  const { resource } = await loadProject(tx, principal, report.projectId);
  assertAllowed(principal, "report.write", { ...resource, type: "report" });
  const [row] = await tx.select({ kind: reports.kind, metrics: reports.metrics, orgId: reports.orgId }).from(reports).where(eq(reports.id, reportId)).limit(1);
  if (row?.kind !== "status_pack") throw new NotFoundError("report");
  if (row.metrics) throw new ConflictError("this status pack was already issued");
  const metrics = await projectProgress(tx, principal, report.projectId, report.periodEnd!);
  const pack = await packFor(tx, report.projectId, row.orgId, report.periodStart!, report.periodEnd!);
  await tx.update(reports).set({ bodyMd: input.bodyMd.trim(), metrics, pack }).where(eq(reports.id, reportId));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "report.issue_pack",
    resourceType: "report",
    resourceId: reportId,
    outcome: "allow",
  });
  return { id: reportId };
}
