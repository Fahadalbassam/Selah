import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { documentShares, documents, projects } from "@/db/schema";
import { assertAllowed, type Principal, type Resource } from "@/authz";
import { ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { downloadable } from "./scan";
import { DOWNLOAD_TTL_SECONDS, signedDownloadUrl } from "./storage";

async function loadDocument(tx: Tx, id: string) {
  const [row] = await tx
    .select({ doc: documents, firmOrgId: projects.firmOrgId })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
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
  };
  return { doc: row.doc, resource };
}

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
