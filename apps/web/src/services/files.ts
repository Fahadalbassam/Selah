import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  actions,
  activityEvents,
  assessmentAnswers,
  assessmentEvidence,
  assessments,
  departments,
  documentShares,
  documents,
  evidenceSubmissions,
  meetingSummarySources,
  meetings,
  organizations,
  projects,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import type { Received } from "@/lib/engagement";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { loadAction, transitionAction } from "./actions";
import { audit } from "./audit";
import { loadDocument } from "./documents";
import { receivedFor } from "./progress";
import { downloadable } from "./scan";
import type { PreparedUpload } from "./evidence";
import { copyObject, putObject } from "./storage";

// The file explorer. It lists documents from the database, never the bucket:
// rows come back filtered by RLS (project, label, department, unsubmitted
// evidence), and each one is then checked with authorize("document.download")
// including its per-user shares, so the list holds exactly the files the
// person could already open from an action, meeting or project page.

/** Where a file came from, for grouping. */
export type FileSource =
  | { kind: "evidence"; id: string | null; title: string | null }
  | { kind: "assessment"; id: string; title: string }
  | { kind: "meeting"; id: string; title: string }
  | { kind: "deliverable" | "client_document" };

export interface FileEntry {
  id: string;
  title: string;
  version: number;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploaderName: string | null;
  uploadedByMe: boolean;
  visibility: "shared" | "firm_private" | "client_private" | "user_private";
  departmentName: string | null;
  departmentNameEn: string | null;
  /** Names of the people it was shared with one by one (besides its label). */
  sharedWith: string[];
  /** Cleared by the virus scan, so it can be downloaded. */
  available: boolean;
  org: { id: string; kind: "firm" | "client"; name: string; nameAr: string | null };
  project: { id: string; title: string; kind: "internal" | "client" };
  source: FileSource;
}

/** Most files a list returns; the newest come first. */
const LIMIT = 1000;

export async function listFiles(tx: Tx, principal: Principal, filter: { actionId?: string } = {}): Promise<FileEntry[]> {
  // Picking evidence: only files of the same client as the action.
  let orgId: string | undefined;
  if (filter.actionId) {
    const loaded = await loadAction(tx, filter.actionId);
    if (!loaded) throw new NotFoundError("action");
    assertAllowed(principal, "action.read", loaded.resource);
    orgId = loaded.action.orgId;
  }

  const rows = await tx
    .select({
      doc: {
        id: documents.id,
        title: documents.title,
        version: documents.version,
        contentType: documents.contentType,
        sizeBytes: documents.sizeBytes,
        createdAt: documents.createdAt,
        uploadedBy: documents.uploadedBy,
        visibility: documents.visibility,
        purpose: documents.purpose,
        scanStatus: documents.scanStatus,
        ownerOrgId: documents.ownerOrgId,
        departmentId: documents.departmentId,
        orgId: documents.orgId,
        projectId: documents.projectId,
      },
      project: { title: projects.title, kind: projects.kind, firmOrgId: projects.firmOrgId },
      org: { kind: organizations.kind, name: organizations.name, nameAr: organizations.nameAr, mode: organizations.engagementMode },
      uploaderName: user.name,
      departmentName: departments.nameAr,
      departmentNameEn: departments.nameEn,
    })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .innerJoin(organizations, eq(organizations.id, documents.orgId))
    .leftJoin(user, eq(user.id, documents.uploadedBy))
    .leftJoin(departments, eq(departments.id, documents.departmentId))
    .where(
      and(
        ne(documents.state, "archived"),
        // Only the latest version of a file; older ones stay on its history.
        sql`not exists (select 1 from documents n where n.supersedes_id = ${documents.id})`,
        orgId ? eq(documents.orgId, orgId) : undefined,
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(LIMIT);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.doc.id);
  const shares = await tx
    .select({ documentId: documentShares.documentId, userId: documentShares.userId, name: user.name })
    .from(documentShares)
    .leftJoin(user, eq(user.id, documentShares.userId))
    .where(inArray(documentShares.documentId, ids));
  const sharesOf = new Map<string, { userId: string; name: string | null }[]>();
  for (const s of shares) sharesOf.set(s.documentId, [...(sharesOf.get(s.documentId) ?? []), s]);

  const visibleRows = rows.filter((r) => {
    const resource: Resource = {
      type: "document",
      id: r.doc.id,
      orgId: r.doc.orgId,
      firmOrgId: r.project.firmOrgId,
      projectId: r.doc.projectId,
      projectKind: r.project.kind,
      engagementMode: r.org.mode,
      visibility: r.doc.visibility,
      createdBy: r.doc.uploadedBy,
      sharedWith: (sharesOf.get(r.doc.id) ?? []).map((s) => s.userId),
      ownerOrgId: r.doc.ownerOrgId,
      departmentId: r.doc.departmentId,
    };
    return authorize(principal, "document.download", resource).allowed;
  });
  if (visibleRows.length === 0) return [];
  const visibleIds = visibleRows.map((r) => r.doc.id);

  // Sources. Each lookup runs under RLS too: an action or meeting the person
  // cannot open leaves the file under a plain "Evidence" folder, unnamed.
  const [evidence, assessed, cited] = await Promise.all([
    tx
      .select({ documentId: evidenceSubmissions.documentId, actionId: actions.id, title: actions.title })
      .from(evidenceSubmissions)
      .leftJoin(actions, eq(actions.id, evidenceSubmissions.actionId))
      .where(inArray(evidenceSubmissions.documentId, visibleIds)),
    tx
      .select({ documentId: assessmentEvidence.documentId, id: assessments.id, title: assessments.title })
      .from(assessmentEvidence)
      .innerJoin(assessmentAnswers, eq(assessmentAnswers.id, assessmentEvidence.answerId))
      .innerJoin(assessments, eq(assessments.id, assessmentAnswers.assessmentId))
      .where(inArray(assessmentEvidence.documentId, visibleIds)),
    tx
      .selectDistinct({ documentId: meetingSummarySources.documentId, id: meetings.id, title: meetings.title })
      .from(meetingSummarySources)
      .innerJoin(meetings, eq(meetings.id, meetingSummarySources.meetingId))
      .where(inArray(meetingSummarySources.documentId, visibleIds)),
  ]);
  const first = <T extends { documentId: string | null }>(list: T[]) => {
    const m = new Map<string, T>();
    for (const x of list) if (x.documentId && !m.has(x.documentId)) m.set(x.documentId, x);
    return m;
  };
  const byEvidence = first(evidence);
  const byAssessment = first(assessed);
  const byMeeting = first(cited);

  return visibleRows.map((r): FileEntry => {
    const ev = byEvidence.get(r.doc.id);
    const as = byAssessment.get(r.doc.id);
    const mt = byMeeting.get(r.doc.id);
    const source: FileSource = ev
      ? { kind: "evidence", id: ev.actionId, title: ev.title }
      : r.doc.purpose === "evidence" && !as
        ? { kind: "evidence", id: null, title: null }
        : as
          ? { kind: "assessment", id: as.id, title: as.title }
          : mt
            ? { kind: "meeting", id: mt.id, title: mt.title }
            : { kind: r.doc.purpose === "deliverable" ? "deliverable" : "client_document" };
    return {
      id: r.doc.id,
      title: r.doc.title,
      version: r.doc.version,
      contentType: r.doc.contentType,
      sizeBytes: r.doc.sizeBytes,
      createdAt: r.doc.createdAt.toISOString(),
      uploaderName: r.uploaderName,
      uploadedByMe: r.doc.uploadedBy === principal.userId,
      visibility: r.doc.visibility,
      departmentName: r.departmentName,
      departmentNameEn: r.departmentNameEn,
      sharedWith: (sharesOf.get(r.doc.id) ?? []).flatMap((s) => (s.name ? [s.name] : [])),
      available: downloadable(r.doc.scanStatus),
      org: { id: r.doc.orgId, kind: r.org.kind, name: r.org.name, nameAr: r.org.nameAr },
      project: { id: r.doc.projectId, title: r.project.title, kind: r.project.kind },
      source,
    };
  });
}

export interface AttachInput {
  documentId: string;
  note?: string;
  evidenceRequestId?: string;
  submitForReview: boolean;
  received?: Partial<Received>;
}

const OPEN_FOR_EVIDENCE = new Set(["in_progress", "revision_requested"]);

/**
 * Use a file already in Selah as evidence, instead of uploading it again.
 * The stored object is copied under a new random key and recorded as a new
 * evidence document, so the original keeps its own label, department and
 * history, and the evidence follows the evidence rules (never changed or
 * deleted, reviewed by hash). The person must be able to download the
 * original, it must belong to the action's client, and it must already be
 * shared between the client and the firm: a firm-only or private file never
 * becomes visible to the other side this way.
 */
export async function attachExistingEvidence(tx: Tx, principal: Principal, actionId: string, input: AttachInput) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  const { action, resource } = loaded;
  assertAllowed(principal, "action.read", resource);
  assertAllowed(principal, "evidence.submit", resource);
  if (!OPEN_FOR_EVIDENCE.has(action.status)) throw new BadRequestError("this action is not open for evidence");

  const source = await loadDocument(tx, input.documentId);
  if (!source) throw new NotFoundError("document");
  assertAllowed(principal, "document.download", source.resource);
  if (source.doc.orgId !== action.orgId) throw new BadRequestError("pick a file of the same client");
  if (source.doc.visibility !== "shared") throw new BadRequestError("only files shared with the firm can be evidence");
  if (source.doc.state === "archived") throw new BadRequestError("this file is archived");
  if (!downloadable(source.doc.scanStatus)) throw new ConflictError("this file has not been cleared for download");
  const received = receivedFor(principal, resource.projectKind, input.received);

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
      title: source.doc.title,
      visibility: "shared",
      storageKey,
      contentType: source.doc.contentType,
      sizeBytes: source.doc.sizeBytes,
      sha256: source.doc.sha256,
      // The bytes are the ones already scanned.
      scanStatus: source.doc.scanStatus,
      scannedAt: source.doc.scannedAt,
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
      evidenceRequestId: input.evidenceRequestId,
      ...received,
    })
    .returning({ id: evidenceSubmissions.id });
  await tx.insert(activityEvents).values({
    projectId: action.projectId,
    orgId: action.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: actionId,
    event: "evidence_submitted",
    meta: { documentId: doc!.id, copiedFrom: source.doc.id },
  });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "evidence.submit",
    resourceType: "action",
    resourceId: actionId,
    outcome: "allow",
    meta: { documentId: doc!.id, copiedFrom: source.doc.id, sizeBytes: source.doc.sizeBytes },
  });

  if (input.submitForReview) {
    if (action.status === "revision_requested") {
      await transitionAction(tx, principal, actionId, { to: "in_progress" });
    }
    await transitionAction(tx, principal, actionId, { to: "awaiting_review" });
  }

  await copyObject(source.doc.storageKey, storageKey);
  return { id: submission!.id, documentId: doc!.id };
}

// ------------------------------------------------------------ uploading

export type UploadVisibility = "shared" | "firm_private" | "client_private";

/** Where the person can add a file from the Files card, and the labels they can choose. */
export async function uploadTargets(tx: Tx, principal: Principal) {
  const rows = await tx
    .select({
      id: projects.id,
      title: projects.title,
      kind: projects.kind,
      orgId: projects.orgId,
      firmOrgId: projects.firmOrgId,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
      mode: organizations.engagementMode,
      minimal: organizations.minimalRecords,
      departmentsEnabled: organizations.departmentsEnabled,
    })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(ne(projects.state, "closed"))
    .orderBy(projects.title);
  const allowed = rows.filter(
    (r) =>
      !r.minimal &&
      authorize(principal, "document.upload", {
        type: "document",
        orgId: r.orgId,
        firmOrgId: r.firmOrgId,
        projectId: r.id,
        projectKind: r.kind,
        engagementMode: r.mode,
      }).allowed,
  );

  // A client admin files under any of the company's departments; a manager under their own.
  let departmentChoices: { id: string; nameAr: string; nameEn: string | null }[] = [];
  if (principal.orgKind === "client" && allowed.some((r) => r.departmentsEnabled)) {
    const all = await tx
      .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
      .from(departments)
      .where(and(eq(departments.orgId, principal.orgId), eq(departments.active, true)))
      .orderBy(departments.nameAr);
    departmentChoices = principal.role === "client_admin" ? all : all.filter((d) => principal.departmentIds.has(d.id));
  }

  return {
    projects: allowed.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      org: { id: r.orgId, name: r.orgName, nameAr: r.orgNameAr },
      // Internal work never leaves the firm; a restricted client's own files start private.
      visibilities: (r.kind === "internal"
        ? ["firm_private"]
        : principal.orgKind === "firm"
          ? ["firm_private", "shared"]
          : r.mode === "restricted"
            ? ["client_private"]
            : ["shared", "client_private"]) as UploadVisibility[],
      departments: r.departmentsEnabled ? departmentChoices : [],
    })),
  };
}

export interface ProjectUploadInput {
  file: PreparedUpload;
  visibility: UploadVisibility;
  departmentId?: string;
}

/**
 * Add a file to a project from the Files card: a firm deliverable or working
 * file, or a client's own document. It is checked and scanned like evidence,
 * stored under a random key, and labelled by the uploader within what their
 * side may choose (uploadTargets). The database applies the same label,
 * department and minimal-records rules as for any other file.
 */
export async function uploadProjectDocument(tx: Tx, principal: Principal, projectId: string, input: ProjectUploadInput) {
  const target = (await uploadTargets(tx, principal)).projects.find((p) => p.id === projectId);
  if (!target) throw new NotFoundError("project");
  if (!target.visibilities.includes(input.visibility)) throw new BadRequestError("that label is not available here");
  if (input.departmentId && !target.departments.some((d) => d.id === input.departmentId)) {
    throw new BadRequestError("file it under one of your departments");
  }

  const { bytes, sha256 } = input.file;
  const storageKey = randomUUID();
  const [doc] = await tx
    .insert(documents)
    .values({
      projectId,
      orgId: target.org.id,
      ownerOrgId: principal.orgId,
      uploadedBy: principal.userId,
      purpose: principal.orgKind === "firm" ? "deliverable" : "client_document",
      state: "submitted",
      title: input.file.fileName,
      visibility: input.visibility,
      departmentId: input.departmentId ?? null,
      storageKey,
      contentType: input.file.contentType,
      sizeBytes: bytes.byteLength,
      sha256,
      scanStatus: input.file.scanned ? "clean" : "skipped",
      scannedAt: input.file.scanned ? new Date() : null,
    })
    .returning({ id: documents.id });
  // Audited, but kept off the project's activity feed: the feed is seen by
  // both sides, and a firm-only or client-private file must not show there.
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "document.upload",
    resourceType: "document",
    resourceId: doc!.id,
    outcome: "allow",
    meta: { projectId, sizeBytes: bytes.byteLength, scanned: input.file.scanned, scanMs: input.file.scanMs },
  });
  await putObject(storageKey, bytes, input.file.contentType, sha256);
  return { id: doc!.id };
}
