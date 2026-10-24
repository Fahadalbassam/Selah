import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { documentShares, documents, organizations, projects } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import type { PreparedUpload } from "./evidence";
import { downloadable } from "./scan";
import { DOWNLOAD_TTL_SECONDS, putObject, signedDownloadUrl } from "./storage";

export async function loadDocument(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      doc: documents,
      firmOrgId: projects.firmOrgId,
      projectKind: projects.kind,
      projectState: projects.state,
      minimal: organizations.minimalRecords,
    })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .innerJoin(organizations, eq(organizations.id, documents.orgId))
    .where(eq(documents.id, id))
    .limit(1);
  if (!row) return null;
  const shares = await tx
    .select({ userId: documentShares.userId })
    .from(documentShares)
    .where(eq(documentShares.documentId, id));
  const resource: Resource & { type: "document" } = {
    type: "document",
    id,
    orgId: row.doc.orgId,
    firmOrgId: row.firmOrgId,
    projectId: row.doc.projectId,
    visibility: row.doc.visibility,
    createdBy: row.doc.uploadedBy,
    sharedWith: shares.map((s) => s.userId),
    ownerOrgId: row.doc.ownerOrgId,
    departmentId: row.doc.departmentId,
  };
  const latest = !(await tx.select({ id: documents.id }).from(documents).where(eq(documents.supersedesId, id)).limit(1)).length;
  return {
    doc: row.doc,
    resource,
    context: { projectKind: row.projectKind, projectClosed: row.projectState === "closed", minimal: row.minimal, latest },
  };
}

/** What fileControls() needs about a file: loadDocument() gives it, and so does the file list. */
export interface ControlledFile {
  doc: { purpose: string; state: string; visibility: string };
  resource: Resource;
  context: { projectKind: "internal" | "client"; projectClosed: boolean; minimal: boolean; latest: boolean };
}

/**
 * What this person may do to a file besides opening it. One answer for every
 * screen that shows file controls (the file explorer, the project's
 * Documents tab); the database checks the same rules (baseline: File
 * controls, 0005).
 *   shareWithClient - firm staff share a firm-only file of a client project (one-way)
 *   shareWithFirm   - a client's admin shares its private file (one-way)
 *   assistant       - the owning side switches "available to the assistant"
 *   newVersion      - the owning side uploads the next version
 * Evidence has none of these: it is shared by submitting it, and never changes.
 */
export function fileControls(principal: Principal, loaded: ControlledFile) {
  const { doc, resource, context } = loaded;
  const manage = authorize(principal, "document.manage", resource).allowed;
  const evidence = doc.purpose === "evidence";
  const live = doc.state !== "archived" && context.latest;
  return {
    shareWithClient:
      manage && live && !evidence && principal.orgKind === "firm" && context.projectKind === "client" && doc.visibility === "firm_private",
    shareWithFirm: live && doc.visibility === "client_private" && authorize(principal, "document.share", resource).allowed,
    assistant: manage && live && !evidence && !context.minimal && doc.visibility !== "user_private",
    newVersion: manage && live && !evidence && !context.projectClosed,
  };
}

export type FileControls = ReturnType<typeof fileControls>;

/**
 * Issue a one-minute download link. Checked per request: the link is only
 * created after authorize() passes, and every download is audited.
 */
export async function createDownloadLink(tx: Tx, principal: Principal, id: string, ip: string | null) {
  const loaded = await loadDocument(tx, id);
  if (!loaded) throw new NotFoundError("document");
  assertAllowed(principal, "document.download", loaded.resource);
  // Fail closed: only files the scanner cleared can leave the bucket.
  if (!downloadable(loaded.doc.scanStatus)) throw new ConflictError("this file has not been cleared for download");

  const url = await signedDownloadUrl(loaded.doc.storageKey, loaded.doc.title);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "document.download",
    resourceType: "document",
    resourceId: id,
    outcome: "allow",
    ip,
    meta: { version: loaded.doc.version },
  });
  return { url, expiresIn: DOWNLOAD_TTL_SECONDS };
}

/**
 * Share a file with the other side. One-way, both ways round: a client's
 * admin shares a client-private file with the firm, and firm staff share a
 * firm-only file with the client. Neither is ever made private again (the
 * database refuses it). The share is recorded in the project's history.
 */
export async function shareDocument(tx: Tx, principal: Principal, id: string) {
  const loaded = await loadDocument(tx, id);
  if (!loaded) throw new NotFoundError("document");
  assertAllowed(principal, "document.read", loaded.resource);
  const can = fileControls(principal, loaded);
  if (loaded.doc.visibility === "client_private") assertAllowed(principal, "document.share", loaded.resource);
  else if (!can.shareWithClient) {
    assertAllowed(principal, "document.manage", loaded.resource);
    throw new BadRequestError("this file cannot be shared from here");
  }
  await tx.update(documents).set({ visibility: "shared" }).where(eq(documents.id, id));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "document.share",
    resourceType: "document",
    resourceId: id,
    outcome: "allow",
    meta: { from: loaded.doc.visibility },
  });
  return { id, visibility: "shared" as const };
}

/** The owning side decides whether the assistant may read a file. */
export async function setAssistantFlag(tx: Tx, principal: Principal, id: string, on: boolean) {
  const loaded = await loadDocument(tx, id);
  if (!loaded) throw new NotFoundError("document");
  assertAllowed(principal, "document.manage", loaded.resource);
  if (!fileControls(principal, loaded).assistant) throw new BadRequestError("this file's assistant flag cannot be changed");
  await tx.update(documents).set({ aiIndexable: on }).where(eq(documents.id, id));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: on ? "document.ai_on" : "document.ai_off",
    resourceType: "document",
    resourceId: id,
    outcome: "allow",
  });
  return { id, aiIndexable: on };
}

/**
 * Upload the next version of a file. It keeps the file's project, label,
 * department and assistant flag; the old version stays on record but leaves
 * the assistant (the database retires it).
 */
export async function uploadNewVersion(tx: Tx, principal: Principal, id: string, file: PreparedUpload) {
  const loaded = await loadDocument(tx, id);
  if (!loaded) throw new NotFoundError("document");
  assertAllowed(principal, "document.manage", loaded.resource);
  if (!fileControls(principal, loaded).newVersion) throw new BadRequestError("a new version cannot be added to this file");
  const old = loaded.doc;
  const storageKey = randomUUID();
  const [doc] = await tx
    .insert(documents)
    .values({
      projectId: old.projectId,
      orgId: old.orgId,
      ownerOrgId: old.ownerOrgId,
      uploadedBy: principal.userId,
      purpose: old.purpose,
      state: "submitted",
      title: file.fileName,
      visibility: old.visibility,
      departmentId: old.departmentId,
      aiIndexable: old.aiIndexable,
      version: old.version + 1,
      supersedesId: old.id,
      storageKey,
      contentType: file.contentType,
      sizeBytes: file.bytes.byteLength,
      sha256: file.sha256,
      scanStatus: file.scanned ? "clean" : "skipped",
      scannedAt: file.scanned ? new Date() : null,
    })
    .returning({ id: documents.id });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "document.new_version",
    resourceType: "document",
    resourceId: doc!.id,
    outcome: "allow",
    meta: { supersedes: old.id, version: old.version + 1, scanned: file.scanned, scanMs: file.scanMs },
  });
  await putObject(storageKey, file.bytes, file.contentType, file.sha256);
  return { id: doc!.id, version: old.version + 1 };
}
