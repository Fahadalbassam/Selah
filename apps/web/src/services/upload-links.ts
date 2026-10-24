import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { asAnonymous, type Tx } from "@/db/client";
import { infoRequestLinks } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import { requestTitle } from "@/lib/info-requests";
import type { UploadLinkInput } from "@/lib/upload-links";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { prepareUpload, type PreparedUpload } from "./evidence";
import { loadRequest } from "./info-requests";
import { putObject } from "./storage";

// No-login upload links for one information request item (wave 2, F14,
// decision D6). A consultant on the project sends a link to an address; the
// page it opens shows only that item and the firm's name and takes files for
// it. The database decides whether a link still works and files what comes
// in (check_info_request_link, app_open_upload_link, app_upload_by_link);
// only the token's hash is stored.

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** Make a link for an open item and mail it. */
export async function createUploadLink(tx: Tx, principal: Principal, requestId: string, input: UploadLinkInput) {
  const { request, resource } = await loadRequest(tx, principal, requestId);
  assertAllowed(principal, "info_request.manage", resource);
  if (request.status !== "requested" && request.status !== "received") throw new BadRequestError("this request is not open for files");
  const token = randomBytes(32).toString("base64url");
  const [row] = await tx
    .insert(infoRequestLinks)
    .values({
      requestId,
      projectId: request.projectId,
      orgId: request.orgId,
      tokenHash: hashOf(token),
      email: input.email,
      // From the database's clock, which also checks the range.
      expiresAt: sql`now() + make_interval(days => ${input.days}::int)`,
      createdBy: principal.userId,
    })
    .returning({ id: infoRequestLinks.id, email: infoRequestLinks.email, expiresAt: infoRequestLinks.expiresAt });
  await tx.execute(sql`select app_send_upload_link(${row!.id}::uuid, ${token})`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "info_request.link_create",
    resourceType: "info_request_link",
    resourceId: row!.id,
    outcome: "allow",
    meta: { requestId, days: input.days },
  });
  return row!;
}

/** Stop a link working at once. */
export async function revokeUploadLink(tx: Tx, principal: Principal, linkId: string) {
  const [link] = await tx.select().from(infoRequestLinks).where(eq(infoRequestLinks.id, linkId));
  if (!link) throw new NotFoundError("link");
  const { resource } = await loadRequest(tx, principal, link.requestId);
  assertAllowed(principal, "info_request.manage", resource);
  const done = await tx
    .update(infoRequestLinks)
    .set({ revokedAt: new Date(), revokedBy: principal.userId })
    .where(and(eq(infoRequestLinks.id, linkId), isNull(infoRequestLinks.revokedAt)))
    .returning({ id: infoRequestLinks.id });
  if (!done.length) return { ok: true };
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "info_request.link_revoke",
    resourceType: "info_request_link",
    resourceId: linkId,
    outcome: "allow",
    meta: { requestId: link.requestId },
  });
  return { ok: true };
}

/**
 * What the public page shows while the link works: the item in the
 * reader's language and the firm's name. Null otherwise. Each call is
 * logged by the database, working or not.
 */
export async function openUploadLink(tx: Tx, token: string, ar: boolean) {
  const { rows } = await tx.execute<{
    title: string;
    template_key: string | null;
    description: string | null;
    sensitivity: "standard" | "confidential";
    firm_name: string;
    firm_name_ar: string | null;
    expires_at: string | Date;
  }>(sql`select title, template_key, description, sensitivity, firm_name, firm_name_ar, expires_at from app_open_upload_link(${hashOf(token)})`);
  const r = rows[0];
  if (!r) return null;
  return {
    title: requestTitle({ templateKey: r.template_key, title: r.title }, ar),
    description: r.description,
    confidential: r.sensitivity === "confidential",
    firmName: ar && r.firm_name_ar ? r.firm_name_ar : r.firm_name,
    expiresAt: new Date(r.expires_at),
  };
}

/**
 * Check and scan a file sent through a link, before any transaction holds a
 * connection. A link that no longer works is refused before the scan.
 */
export async function prepareLinkUpload(token: string, file: File): Promise<PreparedUpload> {
  const target = await asAnonymous(async (tx) => {
    const { rows } = await tx.execute<{ link_id: string }>(sql`select link_id from app_upload_link_target(${hashOf(token)})`);
    return rows[0];
  });
  if (!target) throw new NotFoundError("link");
  return prepareUpload(null, { type: "info_request_link", id: target.link_id }, file);
}

/**
 * File what came through the link (the database checks the link again),
 * then store the bytes. A refusal comes back as a value, not an error, so
 * the transaction keeps its log entry.
 */
export async function uploadByLink(
  tx: Tx,
  token: string,
  file: PreparedUpload,
): Promise<{ ok: true } | { ok: false; error: "too_many_files" | "link_closed" }> {
  const storageKey = randomUUID();
  const { rows } = await tx.execute<{ document_id: string | null; refusal: string | null }>(
    sql`select document_id, refusal from app_upload_by_link(${hashOf(token)}, ${file.fileName}, ${file.contentType}, ${file.bytes.byteLength}::int, ${file.sha256}, ${file.scanned}, ${storageKey})`,
  );
  const refusal = rows[0]?.refusal;
  if (refusal || !rows[0]?.document_id) return { ok: false, error: refusal === "too many files" ? "too_many_files" : "link_closed" };
  await putObject(storageKey, file.bytes, file.contentType, file.sha256);
  return { ok: true };
}
