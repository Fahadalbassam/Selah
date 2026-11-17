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
  /** For a reader with department limits: how many items each list leaves out. Worked out when the pack is read (app_report_pack_for), never stored. */
  leftOut?: Record<(typeof PACK_LISTS)[number], number>;
}

export const PACK_LISTS = ["decisions", "overdue", "slipped", "riskAccepted", "verified"] as const;

async function packFor(tx: Tx, projectId: string, orgId: string, from: string, to: string): Promise<StatusPack> {
  const { rows } = await tx.execute<{ pack: StatusPack }>(sql`select app_status_pack(${projectId}::uuid, ${from}::date, ${to}::date) as pack`);
  return { ...rows[0]!.pack, indicators: await indicatorSnapshot(tx, { clientOrgId: orgId, projectId }, firmToday()) };
}

/**
 * The pack on a report: frozen once issued, worked out live while a draft (only the firm sees a draft).
 *
 * An issued pack is read only through app_report_pack_for() (migration
 * 0074): the app role cannot read reports.pack. The function hands a client
 * reader only the items of departments they can see, and says how many were
 * left out of each list, never which (decision D8). The numbers stay whole:
 * a person at the firm chose to share the report.
 */
export async function reportPack(tx: Tx, principal: Principal, reportId: string) {
  const [row] = await tx
    .select({
      kind: reports.kind,
      pack: sql<StatusPack | null>`app_report_pack_for(${reports.id})`,
      metrics: reports.metrics,
      projectId: reports.projectId,
      orgId: reports.orgId,
      periodStart: reports.periodStart,
      periodEnd: reports.periodEnd,
    })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!row || row.kind !== "status_pack" || !row.periodStart || !row.periodEnd) return null;
  if (row.metrics) return row.pack ? { draft: false, pack: row.pack, live: null } : null;
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
