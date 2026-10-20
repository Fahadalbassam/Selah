import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "@/db/client";
import { activityEvents, documents, evidenceSubmissions } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import { checkUpload } from "@/lib/upload-rules";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { loadAction, transitionAction } from "./actions";
import { audit, auditDetached } from "./audit";
import { scanUpload } from "./scan";
import { putObject } from "./storage";

/** A checked, scanned file, ready to store. Built before any transaction opens. */
export interface PreparedUpload {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
  sha256: string;
  scanned: boolean;
  /** How long the virus scan took, for the audit record. */
  scanMs: number;
}

/**
 * Check and scan an upload. Runs outside the database transaction (see
 * route()'s `prepare`), so a slow scan never holds a pooled connection.
 * Infected files are audited here because no transaction exists yet.
 */
export async function prepareUpload(userId: string, actionId: string, file: File): Promise<PreparedUpload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(file.name, file.type, bytes.byteLength, bytes.subarray(0, 512));
  if (!check.ok) throw new BadRequestError(`file rejected: ${check.reason}`);

  // Scan before anything is stored: an infected file never reaches the bucket.
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const scan = await scanUpload(bytes).catch(async (err: unknown) => {
    if (err instanceof BadRequestError) {
      await auditDetached({
        actorId: userId,
        action: "evidence.submit",
        resourceType: "action",
        resourceId: actionId,
        outcome: "deny",
        reason: "infected",
        meta: { sizeBytes: bytes.byteLength, scanMs: elapsed() },
      });
    }
    throw err;
  });
  const scanMs = elapsed();

  return {
    bytes,
    fileName: check.fileName,
    contentType: check.contentType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    scanned: scan.scanned,
    scanMs,
  };
}

export interface EvidenceInput {
  file: PreparedUpload;
  note?: string;
  /** The item on the action's evidence list this file answers. */
  evidenceRequestId?: string;
  /** Also move the action to Awaiting Review in the same transaction. */
  submitForReview: boolean;
}

const OPEN_FOR_EVIDENCE = new Set(["in_progress", "revision_requested"]);

/**
 * Attach evidence to an action. The file was already checked (type, bytes,
 * size) and scanned for malware; here it is authorized, stored under a random
 * key, and recorded as a document visible to the client and the firm
 * ("shared"), so the reviewing consultant can open it. The database rows are
 * written first: if storing the file fails, the transaction rolls back and
 * nothing points at a missing file.
 */
export async function submitEvidence(tx: Tx, principal: Principal, actionId: string, input: EvidenceInput) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  const { action, resource } = loaded;
  assertAllowed(principal, "action.read", resource);
  assertAllowed(principal, "evidence.submit", resource);
  if (!OPEN_FOR_EVIDENCE.has(action.status)) throw new BadRequestError("this action is not open for evidence");

  const { bytes, sha256 } = input.file;
  const storageKey = randomUUID();
  const [doc] = await tx
    .insert(documents)
    .values({
      projectId: action.projectId,
      orgId: action.orgId,
      ownerOrgId: principal.orgId,
      uploadedBy: principal.userId,
      purpose: "evidence",
      state: "submitted",
      title: input.file.fileName,
      visibility: "shared",
      storageKey,
      contentType: input.file.contentType,
      sizeBytes: bytes.byteLength,
      sha256,
      scanStatus: input.file.scanned ? "clean" : "skipped",
      scannedAt: input.file.scanned ? new Date() : null,
    })
    .returning({ id: documents.id });
  const [submission] = await tx
    .insert(evidenceSubmissions)
    .values({
      projectId: action.projectId,
      orgId: action.orgId,
      actionId,
      documentId: doc!.id,
      submittedBy: principal.userId,
      note: input.note,
      // The database checks the item is open on this action and marks it submitted.
      evidenceRequestId: input.evidenceRequestId,
    })
    .returning({ id: evidenceSubmissions.id });
  await tx.insert(activityEvents).values({
    projectId: action.projectId,
    orgId: action.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: actionId,
    event: "evidence_submitted",
    meta: { documentId: doc!.id },
  });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "evidence.submit",
    resourceType: "action",
    resourceId: actionId,
    outcome: "allow",
    meta: { documentId: doc!.id, sizeBytes: bytes.byteLength, scanned: input.file.scanned, scanMs: input.file.scanMs },
  });

  if (input.submitForReview) {
    if (action.status === "revision_requested") {
      await transitionAction(tx, principal, actionId, { to: "in_progress" });
    }
    await transitionAction(tx, principal, actionId, { to: "awaiting_review" });
  }

  await putObject(storageKey, bytes, input.file.contentType, sha256);
  return { id: submission!.id, documentId: doc!.id };
}
