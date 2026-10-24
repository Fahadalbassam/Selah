import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { activityEvents, documents, infoRequestFiles, infoRequests, notifications, orgMemberships, projectMembers, projects, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import type { z } from "zod";
import { INFO_REQUEST_TEMPLATES, templateByKey, type InfoRequestInput, type infoRequestEdit } from "@/lib/info-requests";
import { firmToday } from "@/lib/dates";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import type { PreparedUpload } from "./evidence";
import { loadProject } from "./staffing";
import { putObject } from "./storage";

// The project's information request list (wave 1, item 9). The database
// holds the rules (check_info_request, check_info_request_file): who edits,
// which status moves are allowed, and which files may answer an item. This
// module shapes the list, stores answering files, and tells people.

type Edit = z.infer<typeof infoRequestEdit>;

async function clientProject(tx: Tx, principal: Principal, projectId: string) {
  const loaded = await loadProject(tx, principal, projectId);
  if (loaded.project.kind !== "client") throw new NotFoundError("project");
  return { ...loaded, resource: { ...loaded.resource, type: "info_request" as const } };
}

/** One item, read under the caller's rights (an action owner sees only their own). */
async function loadRequest(tx: Tx, principal: Principal, id: string) {
  const [row] = await tx
    .select({ r: infoRequests, firmOrgId: projects.firmOrgId })
    .from(infoRequests)
    .innerJoin(projects, eq(projects.id, infoRequests.projectId))
    .where(eq(infoRequests.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("request");
  const resource: Resource = {
    type: "info_request",
    id,
    orgId: row.r.orgId,
    firmOrgId: row.firmOrgId,
    projectId: row.r.projectId,
    projectKind: "client",
    assignees: row.r.ownerUserId ? [row.r.ownerUserId] : [],
  };
  if (!authorize(principal, "info_request.read", resource).allowed) throw new NotFoundError("request");
  return { request: row.r, resource };
}

async function tell(tx: Tx, principal: Principal, userIds: (string | null)[], kind: string, projectId: string) {
  const to = [...new Set(userIds.filter((u): u is string => !!u && u !== principal.userId))];
  if (to.length) await tx.insert(notifications).values(to.map((userId) => ({ userId, kind, entityType: "project", entityId: projectId })));
}

async function logActivity(tx: Tx, principal: Principal, r: { projectId: string; orgId: string; id: string }, event: string, meta = {}) {
  await tx.insert(activityEvents).values({
    projectId: r.projectId,
    orgId: r.orgId,
    actorId: principal.userId,
    entityType: "info_request",
    entityId: r.id,
    event,
    meta,
  });
}

/** The firm-side team, told by the database, which checks the caller caused it. */
async function tellFirm(tx: Tx, requestId: string, kind: "info_request.received" | "info_request.not_applicable") {
  await tx.execute(sql`select app_notify_info_request(${requestId}::uuid, ${kind})`);
}

/**
 * The project's list with each item's files, what this user may do, and, for
 * the firm, the client people who can own an item. Null for internal projects.
 */
export async function listInfoRequests(tx: Tx, principal: Principal, projectId: string) {
  const loaded = await loadProject(tx, principal, projectId);
  if (loaded.project.kind !== "client") return null;
  const resource = { ...loaded.resource, type: "info_request" as const };
  assertAllowed(principal, "info_request.read", resource);
  const owner = { id: user.id, name: user.name };
  const rows = await tx
    .select({ r: infoRequests, ownerName: owner.name })
    .from(infoRequests)
    .leftJoin(user, eq(user.id, infoRequests.ownerUserId))
    .where(eq(infoRequests.projectId, projectId))
    .orderBy(asc(infoRequests.area), asc(infoRequests.createdAt));
  const ids = rows.map((x) => x.r.id);
  // Files the reader can see (the link and the file are both read under RLS).
  const files = ids.length
    ? await tx
        .select({ requestId: infoRequestFiles.requestId, documentId: documents.id, title: documents.title, attachedBy: infoRequestFiles.attachedBy })
        .from(infoRequestFiles)
        .innerJoin(documents, eq(documents.id, infoRequestFiles.documentId))
        .where(inArray(infoRequestFiles.requestId, ids))
        .orderBy(asc(infoRequestFiles.attachedAt))
    : [];
  const manage = authorize(principal, "info_request.manage", resource).allowed;
  const answerAny = authorize(principal, "info_request.answer", resource).allowed;
  const today = firmToday();
  const items = rows.map(({ r, ownerName }) => {
    const mine = r.ownerUserId === principal.userId;
    const open = r.status === "requested" || r.status === "received";
    const answer = (answerAny || (principal.role === "action_owner" && mine)) && open;
    return {
      id: r.id,
      area: r.area,
      templateKey: r.templateKey,
      title: r.title,
      description: r.description,
      sensitivity: r.sensitivity,
      ownerUserId: r.ownerUserId,
      ownerName,
      dueDate: r.dueDate,
      overdue: r.status === "requested" && r.dueDate !== null && r.dueDate < today,
      status: r.status,
      statusNote: r.statusNote,
      statusAt: r.statusAt,
      files: files
        .filter((f) => f.requestId === r.id)
        .map((f) => ({
          documentId: f.documentId,
          title: f.title,
          canRemove: r.status !== "reviewed" && (manage || f.attachedBy === principal.userId),
        })),
      can: {
        answer,
        notApplicable: manage ? r.status === "requested" || r.status === "received" : answer && r.status === "requested",
        review: manage && r.status === "received",
        // Back to the client, with a reason.
        returnIt: manage && (r.status === "received" || r.status === "reviewed"),
        reopen: manage && r.status === "not_applicable",
        edit: manage,
        remove: manage && r.status === "requested",
      },
    };
  });
  // Who can own an item: active people at the client who can see the project
  // (its admins, and those staffed on it).
  const owners = manage
    ? (
        await tx
          .select({ id: user.id, name: user.name, role: orgMemberships.role, staffed: projectMembers.userId })
          .from(orgMemberships)
          .innerJoin(user, eq(user.id, orgMemberships.userId))
          .leftJoin(projectMembers, and(eq(projectMembers.userId, orgMemberships.userId), eq(projectMembers.projectId, projectId)))
          .where(and(eq(orgMemberships.orgId, loaded.project.orgId), eq(orgMemberships.active, true)))
          .orderBy(asc(user.name))
      )
        .filter((o) => o.role === "client_admin" || o.staffed)
        .map(({ id, name }) => ({ id, name }))
    : [];
  // Files already on the project that both sides see, to answer without uploading again.
  const shared = answerAny || items.some((i) => i.can.answer)
    ? await tx
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(and(eq(documents.projectId, projectId), eq(documents.visibility, "shared"), ne(documents.state, "archived")))
        .orderBy(asc(documents.title))
    : [];
  return {
    items,
    can: { manage },
    owners,
    files: shared,
    used: INFO_REQUEST_TEMPLATES.filter((t) => rows.some((x) => x.r.templateKey === t.key)).map((t) => t.key),
  };
}

export async function createInfoRequest(tx: Tx, principal: Principal, projectId: string, input: InfoRequestInput) {
  const { project, resource } = await clientProject(tx, principal, projectId);
  assertAllowed(principal, "info_request.manage", resource);
  const [row] = await tx
    .insert(infoRequests)
    .values({ projectId, orgId: project.orgId, ...input, createdBy: principal.userId })
    .returning({ id: infoRequests.id });
  await logActivity(tx, principal, { projectId, orgId: project.orgId, id: row!.id }, "info_request_added", { title: input.title });
  await tell(tx, principal, [input.ownerUserId ?? null], "info_request.requested", projectId);
  return { id: row!.id };
}

/** Add template items at once; an item already on the list is not added twice. */
export async function addTemplateItems(
  tx: Tx,
  principal: Principal,
  projectId: string,
  input: { keys: string[]; ownerUserId?: string | null; dueDate?: string | null },
) {
  const { project, resource } = await clientProject(tx, principal, projectId);
  assertAllowed(principal, "info_request.manage", resource);
  const existing = new Set(
    (await tx.select({ key: infoRequests.templateKey }).from(infoRequests).where(eq(infoRequests.projectId, projectId))).map((r) => r.key),
  );
  const add = [...new Set(input.keys)].filter((k) => !existing.has(k)).map((k) => templateByKey(k)!);
  if (!add.length) return { added: 0 };
  await tx.insert(infoRequests).values(
    add.map((t) => ({
      projectId,
      orgId: project.orgId,
      area: t.area,
      templateKey: t.key,
      // Stored in English; the page shows the template in the reader's language.
      title: t.en,
      sensitivity: t.confidential ? ("confidential" as const) : ("standard" as const),
      ownerUserId: input.ownerUserId ?? null,
      dueDate: input.dueDate ?? null,
      createdBy: principal.userId,
    })),
  );
  await logActivity(tx, principal, { projectId, orgId: project.orgId, id: projectId }, "info_requests_added", { count: add.length });
  await tell(tx, principal, [input.ownerUserId ?? null], "info_request.requested", projectId);
  return { added: add.length };
}

export async function updateInfoRequest(tx: Tx, principal: Principal, id: string, edit: Edit) {
  const { request, resource } = await loadRequest(tx, principal, id);
  assertAllowed(principal, "info_request.manage", resource);
  const set: Partial<typeof infoRequests.$inferInsert> = Object.fromEntries(Object.entries(edit).filter(([, v]) => v !== undefined));
  // Reworded, it is the firm's own item and no longer follows the template's languages.
  if (edit.title !== undefined && edit.title !== request.title) set.templateKey = null;
  if (!Object.keys(set).length) return { ok: true };
  await tx.update(infoRequests).set(set).where(eq(infoRequests.id, id));
  if (edit.ownerUserId && edit.ownerUserId !== request.ownerUserId) {
    await tell(tx, principal, [edit.ownerUserId], "info_request.requested", request.projectId);
  }
  return { ok: true };
}

export async function deleteInfoRequest(tx: Tx, principal: Principal, id: string) {
  const { request, resource } = await loadRequest(tx, principal, id);
  assertAllowed(principal, "info_request.manage", resource);
  const gone = await tx.delete(infoRequests).where(eq(infoRequests.id, id)).returning({ id: infoRequests.id });
  // The database keeps an item someone already answered.
  if (!gone.length) throw new BadRequestError("an answered item stays on the list; mark it not applicable instead");
  await logActivity(tx, principal, request, "info_request_removed", { title: request.title });
  return { ok: true };
}

/**
 * Move an item: the firm reviews what came in, returns it with a reason, or
 * marks it not applicable (and back); the client may say an item does not
 * apply, with a reason. The database allows exactly these moves.
 */
export async function moveInfoRequest(tx: Tx, principal: Principal, id: string, input: { status: "reviewed" | "requested" | "not_applicable"; note?: string | null }) {
  const { request, resource } = await loadRequest(tx, principal, id);
  const firm = principal.orgKind === "firm";
  assertAllowed(principal, firm ? "info_request.manage" : "info_request.answer", resource);
  await tx
    .update(infoRequests)
    .set({ status: input.status, statusNote: input.status === "reviewed" ? null : (input.note ?? null) })
    .where(eq(infoRequests.id, id));
  const event = input.status === "requested" ? (request.status === "not_applicable" ? "reopened" : "returned") : input.status;
  await logActivity(tx, principal, request, `info_request_${event}`, { title: request.title });
  if (firm && event === "returned") await tell(tx, principal, [request.ownerUserId], "info_request.returned", request.projectId);
  if (!firm) await tellFirm(tx, id, "info_request.not_applicable");
  return { ok: true };
}

async function answered(tx: Tx, principal: Principal, request: typeof infoRequests.$inferSelect, documentId: string) {
  await tx.insert(infoRequestFiles).values({ requestId: request.id, documentId, attachedBy: principal.userId });
  await logActivity(tx, principal, request, "info_request_answered", { documentId });
  if (principal.orgKind === "client") await tellFirm(tx, request.id, "info_request.received");
}

/**
 * Answer an item with a new file. The file is checked and scanned before the
 * transaction, stored under a random key, and shared with both sides; the
 * database marks the item received.
 */
export async function answerWithUpload(tx: Tx, principal: Principal, id: string, file: PreparedUpload) {
  const { request, resource } = await loadRequest(tx, principal, id);
  assertAllowed(principal, "info_request.answer", resource);
  const storageKey = randomUUID();
  const [doc] = await tx
    .insert(documents)
    .values({
      projectId: request.projectId,
      orgId: request.orgId,
      ownerOrgId: principal.orgId,
      uploadedBy: principal.userId,
      purpose: "client_document",
      state: "submitted",
      title: file.fileName,
      visibility: "shared",
      storageKey,
      contentType: file.contentType,
      sizeBytes: file.bytes.byteLength,
      sha256: file.sha256,
      scanStatus: file.scanned ? "clean" : "skipped",
      scannedAt: file.scanned ? new Date() : null,
    })
    .returning({ id: documents.id });
  await answered(tx, principal, request, doc!.id);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "info_request.answer",
    resourceType: "document",
    resourceId: doc!.id,
    outcome: "allow",
    meta: { requestId: id, sizeBytes: file.bytes.byteLength, scanned: file.scanned, scanMs: file.scanMs },
  });
  await putObject(storageKey, file.bytes, file.contentType, file.sha256);
  return { id: doc!.id };
}

/** Answer with a file already on the project; one file may answer several items. */
export async function answerWithExisting(tx: Tx, principal: Principal, id: string, documentId: string) {
  const { request, resource } = await loadRequest(tx, principal, id);
  assertAllowed(principal, "info_request.answer", resource);
  await answered(tx, principal, request, documentId);
  return { ok: true };
}

/** Take a file off an item (the file itself stays on the project). */
export async function removeAnswer(tx: Tx, principal: Principal, id: string, documentId: string) {
  const { request, resource } = await loadRequest(tx, principal, id);
  assertAllowed(principal, "info_request.answer", resource);
  const gone = await tx
    .delete(infoRequestFiles)
    .where(and(eq(infoRequestFiles.requestId, id), eq(infoRequestFiles.documentId, documentId)))
    .returning({ id: infoRequestFiles.documentId });
  if (!gone.length) throw new NotFoundError("file");
  await logActivity(tx, principal, request, "info_request_file_removed", { documentId });
  return { ok: true };
}

export type InfoRequestList = NonNullable<Awaited<ReturnType<typeof listInfoRequests>>>;
