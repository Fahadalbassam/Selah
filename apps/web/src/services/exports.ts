import "server-only";
import { asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import type { Tx } from "@/db/client";
import { actions, departments, evidenceRequests, organizations } from "@/db/schema";
import type { Principal } from "@/authz";
import type { Locale } from "@/i18n/config";
import { firmToday } from "@/lib/dates";
import { localName } from "@/lib/names";
import { writeXlsx, type CellValue } from "@/lib/office/xlsx-write";
import { IMPORT_FIELDS, type ImportField } from "@/lib/plan-import";
import { renderReportHtml } from "@/lib/report-html";
import { audit } from "./audit";
import { getReport } from "./follow-through";
import { renderPdf } from "./pdf";
import { getProject, isOverdue, listActions } from "./queries";

// Exports: the project plan and the actions list as Excel, a report as PDF.
// Every export reads through the same services as the screens, under the
// person's row-level security and authorize() checks, so a file holds
// exactly what that person could already open. Each one is audited.

export interface ExportFile {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const WIDTH: Partial<Record<ImportField, number>> = {
  finding: 36,
  findingDetails: 40,
  recommendation: 40,
  rationale: 40,
  targetOutcome: 30,
  priority: 12,
  recDueDate: 14,
  requiredEvidence: 30,
  action: 40,
  actionDetails: 40,
  owner: 22,
  department: 20,
  dueDate: 14,
  evidence: 36,
};

/** A safe ASCII file name, plus the day. The full (Arabic) title goes in the RFC 6266 filename*. */
function fileName(base: string, ext: string): string {
  return `${base}-${firmToday()}.${ext}`;
}

/** The plan's columns, named in the reader's language: the same as the import template, so a file can go out and come back. */
async function planColumns(locale: Locale) {
  const t = await getTranslations({ locale, namespace: "importExport.fields" });
  return IMPORT_FIELDS.map((f) => ({ header: t(f), width: WIDTH[f] }));
}

/** An empty plan to fill in, with a sheet that explains each column. */
export async function importTemplate(locale: Locale): Promise<ExportFile> {
  const t = await getTranslations({ locale, namespace: "importExport" });
  const columns = await planColumns(locale);
  const bytes = writeXlsx([
    { name: t("sheets.plan"), rtl: locale === "ar", columns, rows: [] },
    {
      name: t("sheets.guide"),
      rtl: locale === "ar",
      columns: [
        { header: t("guide.column"), width: 28 },
        { header: t("guide.what"), width: 90 },
      ],
      rows: IMPORT_FIELDS.map((f) => [t(`fields.${f}`), t(`guide.fields.${f}`)]),
    },
  ]);
  return { bytes, fileName: fileName("selah-plan-template", "xlsx"), contentType: XLSX };
}

/** The project's plan as the person sees it: one row per action, or per recommendation or finding with none. */
export async function planWorkbook(tx: Tx, principal: Principal, projectId: string, locale: Locale): Promise<ExportFile> {
  const { project, findings: findingRows, recommendations: recRows } = await getProject(tx, principal, projectId);
  const firm = principal.orgKind === "firm";
  const actionIds = new Set(recRows.flatMap((r) => r.actions.map((a) => a.id)));
  // Details the list rows don't carry, read under the same row-level security and kept only for actions already allowed.
  const [details, items, depts] = await Promise.all([
    tx.select({ id: actions.id, description: actions.description }).from(actions).where(eq(actions.projectId, projectId)),
    tx
      .select({ actionId: evidenceRequests.actionId, title: evidenceRequests.title })
      .from(evidenceRequests)
      .where(eq(evidenceRequests.projectId, projectId))
      .orderBy(asc(evidenceRequests.createdAt)),
    tx.select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn }).from(departments).where(eq(departments.orgId, project.orgId)),
  ]);
  const description = new Map(details.filter((d) => actionIds.has(d.id)).map((d) => [d.id, d.description]));
  const evidence = new Map<string, string[]>();
  for (const i of items) if (actionIds.has(i.actionId)) evidence.set(i.actionId, [...(evidence.get(i.actionId) ?? []), i.title]);
  const deptName = new Map(depts.map((d) => [d.id, locale === "ar" ? d.nameAr : (d.nameEn ?? d.nameAr)]));

  const [tAll, columns] = await Promise.all([getTranslations({ locale }), planColumns(locale)]);
  const vis = (v: string) => tAll(`visibility.${v}` as "visibility.shared");
  const rows: CellValue[][] = [];
  const date = (d: string | null | undefined): CellValue => (d ? { date: d } : null);
  const push = (
    f: (typeof findingRows)[number] | null,
    r: (typeof recRows)[number] | null,
    a: (typeof recRows)[number]["actions"][number] | null,
  ) => {
    const values: Record<ImportField, CellValue> = {
      finding: f?.title,
      findingDetails: f?.description,
      recommendation: r?.title,
      rationale: r?.rationale,
      targetOutcome: r?.targetOutcome,
      priority: r ? tAll(`priority.${r.priority}` as "priority.low") : null,
      recDueDate: date(r?.dueDate),
      requiredEvidence: r?.requiredEvidence,
      action: a?.title,
      actionDetails: a ? description.get(a.id) : null,
      owner: a?.ownerName,
      department: a?.departmentId ? deptName.get(a.departmentId) : null,
      dueDate: date(a?.dueDate),
      evidence: a ? (evidence.get(a.id) ?? []).join("\n") : null,
    };
    const row: CellValue[] = IMPORT_FIELDS.map((k) => values[k]);
    row.push(a ? tAll(`status.${a.status}` as "status.draft") : null);
    // Which records the client can't see, for the firm's own copy.
    if (firm) row.push([f?.visibility, r?.visibility].includes("firm_private") ? vis("firm_private") : vis("shared"));
    rows.push(row);
  };
  const recsOf = (findingId: string | null) => recRows.filter((r) => r.findingId === findingId || (findingId === null && !findingRows.some((f) => f.id === r.findingId)));
  const recRowsFor = (f: (typeof findingRows)[number] | null) => {
    const recs = recsOf(f?.id ?? null);
    if (!recs.length && f) push(f, null, null);
    for (const r of recs) {
      if (!r.actions.length) push(f, r, null);
      for (const a of r.actions) push(f, r, a);
    }
  };
  for (const f of findingRows) recRowsFor(f);
  recRowsFor(null);

  const t = await getTranslations({ locale, namespace: "importExport" });
  const bytes = writeXlsx([
    {
      name: t("sheets.plan"),
      rtl: locale === "ar",
      columns: [...columns, { header: t("columns.status"), width: 18 }, ...(firm ? [{ header: t("columns.visibility"), width: 18 }] : [])],
      rows,
    },
  ]);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "plan.export",
    resourceType: "project",
    resourceId: projectId,
    outcome: "allow",
    meta: { format: "xlsx", rows: rows.length },
  });
  return { bytes, fileName: fileName("selah-plan", "xlsx"), contentType: XLSX };
}

/** The actions list as on the Actions page: an action owner gets their own, everyone else what they can read. */
export async function actionsWorkbook(tx: Tx, principal: Principal, locale: Locale): Promise<ExportFile> {
  const list = await listActions(tx, principal, { mineOnly: principal.role === "action_owner" });
  const t = await getTranslations({ locale });
  const tc = await getTranslations({ locale, namespace: "importExport.columns" });
  const today = firmToday();
  const bytes = writeXlsx([
    {
      name: t("actionsPage.title"),
      rtl: locale === "ar",
      columns: [
        { header: tc("action"), width: 44 },
        { header: tc("project"), width: 30 },
        { header: tc("recommendation"), width: 40 },
        { header: tc("owner"), width: 22 },
        { header: tc("dueDate"), width: 14 },
        { header: tc("status"), width: 18 },
        { header: tc("overdue"), width: 12 },
      ],
      rows: list.map((a) => [
        a.title,
        a.projectTitle,
        a.recommendationTitle,
        a.ownerName,
        a.dueDate ? { date: a.dueDate } : null,
        t(`status.${a.status}` as "status.draft"),
        isOverdue(a, today) ? tc("yes") : null,
      ]),
    },
  ]);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "actions.export",
    resourceType: "action",
    outcome: "allow",
    meta: { format: "xlsx", rows: list.length },
  });
  return { bytes, fileName: fileName("selah-actions", "xlsx"), contentType: XLSX };
}

/**
 * A report as PDF: its frozen numbers and notes, as on the report page, then
 * the project's actions as they stand on the day of the export (labelled so
 * nobody mistakes them for frozen). Rendered by the PDF service from HTML
 * that holds no script and no outside links.
 */
export async function reportPdf(tx: Tx, principal: Principal, reportId: string, locale: Locale): Promise<ExportFile> {
  const { report } = await getReport(tx, principal, reportId);
  const { project } = await getProject(tx, principal, report.projectId);
  const [firmOrg] = await tx.select({ name: organizations.name, nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, project.firmOrgId));
  const list = await listActions(tx, principal, { projectId: report.projectId, mineOnly: principal.role === "action_owner" });
  const today = firmToday();
  const t = await getTranslations({ locale });
  const ar = locale === "ar";
  const name = (n: { name: string; nameAr: string | null } | undefined) => (n ? (localName(n, ar)) : "");

  const html = renderReportHtml({
    locale,
    firmName: name(firmOrg),
    clientName: project.kind === "client" ? name({ name: project.orgName, nameAr: project.orgNameAr }) : null,
    projectTitle: project.title,
    report: {
      title: report.title,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      author: report.author,
      createdAt: new Date(report.createdAt).toISOString().slice(0, 10),
      bodyMd: report.bodyMd,
      metrics: report.metrics,
      // Only the firm needs telling that the client hasn't seen it.
      firmOnly: principal.orgKind === "firm" && report.visibility !== "shared",
    },
    actions: list.map((a) => ({
      title: a.title,
      recommendation: a.recommendationTitle,
      owner: a.ownerName,
      dueDate: a.dueDate,
      status: t(`status.${a.status}` as "status.draft"),
      overdue: isOverdue(a, today),
    })),
    exportedOn: today,
    t: (key, values) => t(`reportPdf.${key}` as "reportPdf.title", values as Record<string, string | number>),
    outcome: (key) => t(`metrics.outcome.${key}` as "metrics.outcome.verified"),
  });
  const bytes = await renderPdf(html, { locale, footer: t("reportPdf.footer", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`)) }) });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "report.export",
    resourceType: "report",
    resourceId: reportId,
    outcome: "allow",
    meta: { format: "pdf", actions: list.length },
  });
  return { bytes, fileName: fileName("selah-report", "pdf"), contentType: "application/pdf" };
}

/** An attachment response: no caching, and the browser must not guess the type. */
export function download(file: ExportFile, title?: string): Response {
  const star = title ? `; filename*=UTF-8''${encodeURIComponent(`${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 120)}.${file.fileName.split(".").pop()}`)}` : "";
  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.fileName}"${star}`,
      "content-length": String(file.bytes.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
