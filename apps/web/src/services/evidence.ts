import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "@/db/client";
import { activityEvents, documents, evidenceSubmissions } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import { checkUpload } from "@/lib/upload-rules";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { loadAction, transitionAction } from "./actions";
import { audit } from "./audit";
import { putObject } from "./storage";

export interface EvidenceInput {
  file: File;
  note?: string;
  /** Also move the action to Awaiting Review in the same transaction. */
  submitForReview: boolean;
}

const OPEN_FOR_EVIDENCE = new Set(["in_progress", "revision_requested"]);

/**
 * Attach evidence to an action. The file is checked (type, bytes, size),
 * stored under a random key, and recorded as a document visible to the
 * client and the firm ("shared"), so the reviewing consultant can open it.
 * The database rows are written first: if storing the file fails, the
 * transaction rolls back and nothing points at a missing file.
 */
export async function submitEvidence(tx: Tx, principal: Principal, actionId: string, input: EvidenceInput) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  const { action, resource } = loaded;
  assertAllowed(principal, "action.read", resource);
  assertAllowed(principal, "evidence.submit", resource);
  if (!OPEN_FOR_EVIDENCE.has(action.status)) throw new BadRequestError("this action is not open for evidence");

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const check = checkUpload(input.file.name, input.file.type, bytes.byteLength, bytes.subarray(0, 512));
  if (!check.ok) throw new BadRequestError(`file rejected: ${check.reason}`);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
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
      title: check.fileName,
      visibility: "shared",
      storageKey,
      contentType: check.contentType,
      sizeBytes: bytes.byteLength,
      sha256,
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
    meta: { documentId: doc!.id, sizeBytes: bytes.byteLength },
  });

  if (input.submitForReview) {
    if (action.status === "revision_requested") {
      await transitionAction(tx, principal, actionId, { to: "in_progress" });
    }
    await transitionAction(tx, principal, actionId, { to: "awaiting_review" });
  }

  await putObject(storageKey, bytes, check.contentType, sha256);
  return { id: submission!.id, documentId: doc!.id };
}
