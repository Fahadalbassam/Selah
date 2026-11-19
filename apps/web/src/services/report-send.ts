import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { aiConversations, aiMessages, organizations, projects, reports } from "@/db/schema";
import { assertAllowed, authorize, type Principal } from "@/authz";
import { withoutDraftMark } from "@/lib/client-ai";
import { ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { getReport } from "./follow-through";
import { loadProject } from "./staffing";

// A client-facing report, from the assistant's facts-only draft to the
// client (migration 0110):
//   1. "Use as draft" opens the firm's report page with the draft as the
//      note (draftForReport). Nothing is saved until the person saves there.
//   2. A firm person other than the writer approves it (approveReport).
//   3. A person presses Send in the confirmation dialog (sendPreview, then
//      shareReport({ confirmed: true }) in follow-through.ts). The same dialog
//      opens from the assistant (reportFromMessage); it never sends by itself.
// Selah never sends on its own: no job and no model call shares a report.
//
// Extension point (report templates, a later builder): a template fills the
// same note field on the same page; draftForReport() is where a chosen
// template's text would be put together with the draft.

/** The project's report page says who approves, in these words. */
export type ApproverRule = "lead_or_deputy" | "internal_lead";

/**
 * What the Send dialog shows before anything happens: the report, whether
 * it is approved and by whom, whether it was sent, and whether this person
 * may send it now. Reads only; changes nothing.
 */
export async function sendPreview(tx: Tx, principal: Principal, reportId: string) {
  if (principal.orgKind !== "firm") throw new NotFoundError("report");
  const { report, can } = await getReport(tx, principal, reportId);
  const [p] = await tx
    .select({ kind: projects.kind, client: organizations.name, clientAr: organizations.nameAr })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(eq(projects.id, report.projectId))
    .limit(1);
  return {
    id: report.id,
    title: report.title,
    kind: report.kind,
    projectId: report.projectId,
    client: p ? { en: p.client, ar: p.clientAr ?? p.client } : null,
    issued: report.metrics !== null,
    approval: report.approval,
    sentAt: report.visibility === "shared" ? report.sharedAt : null,
    approver: (p?.kind === "client" ? "lead_or_deputy" : "internal_lead") as ApproverRule,
    can: { send: can.share, approve: can.approve },
  };
}

/**
 * Approve a report so it may be sent: the client's lead or deputy, an
 * internal project's lead or the firm admin, never its writer, once, on an
 * issued report. The database checks each of these (check_report_approval).
 */
export async function approveReport(tx: Tx, principal: Principal, reportId: string) {
  const { report, can } = await getReport(tx, principal, reportId);
  const { resource } = await loadProject(tx, principal, report.projectId);
  assertAllowed(principal, "report.approve", { ...resource, type: "report", id: reportId });
  if (report.metrics === null) throw new ConflictError("issue the report before approving it");
  if (report.approval?.at) throw new ConflictError("this report is already approved");
  if (!can.approve) throw new ConflictError("someone other than the writer approves a report");
  await tx.update(reports).set({ approvedBy: principal.userId }).where(eq(reports.id, reportId));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "report.approve",
    resourceType: "report",
    resourceId: reportId,
    outcome: "allow",
  });
  return { id: reportId, approved: true as const };
}

/**
 * One of the person's own facts-only progress drafts, for a report's note:
 * firm staff only, a chat on one client project they may still write
 * reports for. The draft mark comes off (the report page says what is not
 * sent yet). Null when the answer is not such a draft. Reads only.
 */
export async function draftForReport(tx: Tx, principal: Principal, messageId: string) {
  if (principal.orgKind !== "firm") return null;
  const [m] = await tx
    .select({ id: aiMessages.id, content: aiMessages.content, lang: aiMessages.lang, projectId: aiConversations.projectId })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiConversations.id, aiMessages.conversationId))
    .where(
      and(
        eq(aiMessages.id, messageId),
        eq(aiMessages.userId, principal.userId),
        eq(aiMessages.role, "assistant"),
        eq(aiMessages.progressDraft, true),
      ),
    )
    .limit(1);
  if (!m?.projectId) return null;
  const { project, resource } = await loadProject(tx, principal, m.projectId);
  if (project.kind !== "client" || !authorize(principal, "report.write", { ...resource, type: "report" }).allowed) return null;
  // This month's pack still waiting for its note, if there is one: the monthly report the draft is most often for.
  const [pack] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.projectId, m.projectId), eq(reports.kind, "status_pack"), sql`${reports.metrics} IS NULL`))
    .orderBy(desc(reports.periodStart))
    .limit(1);
  return { messageId: m.id, projectId: m.projectId, note: withoutDraftMark(m.content), lang: m.lang, packId: pack?.id ?? null };
}

/**
 * The Send dialog opened from the assistant: the report made from this
 * answer ("Use as draft", then saved), latest first, or null when there is
 * none yet. Reads only; the dialog then shows the same preview.
 */
export async function reportFromMessage(tx: Tx, principal: Principal, messageId: string) {
  const draft = await draftForReport(tx, principal, messageId);
  if (!draft) throw new NotFoundError("message");
  const [r] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.draftMessageId, messageId), eq(reports.projectId, draft.projectId)))
    .orderBy(desc(reports.createdAt))
    .limit(1);
  return { projectId: draft.projectId, report: r ? await sendPreview(tx, principal, r.id) : null };
}
