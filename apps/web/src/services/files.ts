import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
  recommendations,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import type { Received } from "@/lib/engagement";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { loadAction, transitionAction } from "./actions";
import { audit } from "./audit";
import { audiencesForMe, writeAudience, type AudienceInput } from "./audience";
import { fileControls, loadDocument, type FileControls } from "./documents";
import { receivedFor } from "./progress";
import { downloadable } from "./scan";
import { itemAnswered, type PreparedUpload } from "./evidence";
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
  /** The owning side lets the assistant read it, and how far indexing got. */
  aiIndexable: boolean;
  textStatus: "pending" | "searchable" | "not_searchable" | "needs_ocr";
  /** Scanned pages the assistant can't read yet (no text layer). */
  ocrPages: number[];
  /** What this person may change (share, assistant flag, new version, who sees it). */
  can: FileControls;
  /**
   * Narrowed with the picker ("Limited audience"): shown to the people who
   * still see it. Someone left out never gets the file at all.
   */
  limited: boolean;
  org: { id: string; kind: "firm" | "client"; name: string; nameAr: string | null };
  project: { id: string; title: string; kind: "internal" | "client" };
  source: FileSource;
}

/** Most files a list returns; the newest come first. */
const LIMIT = 1000;

export async function listFiles(
  tx: Tx,
  principal: Principal,
  filter: {
    actionId?: string;
    /** Only files this person uploaded (still only the ones the reader may open). */
    uploadedBy?: string;
    /** Only this organisation's files. */
    orgId?: string;
    /** At most this many rows read (the newest first); the default is the explorer's limit. */
    limit?: number;
    /** Only files of these projects (the assistant's "@" picker: the chat's projects). */
    projectIds?: string[];
    /** Only these files (a file attached to a question, checked again when it is asked). */
    ids?: string[];
  } = {},
): Promise<FileEntry[]> {
  if (filter.projectIds?.length === 0 || filter.ids?.length === 0) return [];
  // Picking evidence: only files of the same client as the action.
  let orgId: string | undefined = filter.orgId;
  if (filter.actionId) {
    const loaded = await loadAction(tx, filter.actionId);
    if (!loaded) throw new NotFoundError("action");
    assertAllowed(principal, "action.read", loaded.resource);
    if (orgId && orgId !== loaded.action.orgId) return [];
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
        state: documents.state,
        aiIndexable: documents.aiIndexable,
        textStatus: documents.textStatus,
        ocrPages: documents.ocrPages,
        firstVersion: sql<boolean>`${documents.supersedesId} is null`,
        settled: sql<boolean>`app_document_settled(${documents.id})`,
      },
      project: { title: projects.title, kind: projects.kind, firmOrgId: projects.firmOrgId, state: projects.state },
      org: {
        kind: organizations.kind,
        name: organizations.name,
        nameAr: organizations.nameAr,
        mode: organizations.engagementMode,
        minimal: organizations.minimalRecords,
      },
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
        filter.uploadedBy ? eq(documents.uploadedBy, filter.uploadedBy) : undefined,
        filter.projectIds ? inArray(documents.projectId, filter.projectIds) : undefined,
        filter.ids ? inArray(documents.id, filter.ids) : undefined,
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(Math.min(filter.limit ?? LIMIT, LIMIT));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.doc.id);
  const shares = await tx
    .select({ documentId: documentShares.documentId, userId: documentShares.userId, name: user.name })
    .from(documentShares)
    .leftJoin(user, eq(user.id, documentShares.userId))
    .where(inArray(documentShares.documentId, ids));
  const sharesOf = new Map<string, { userId: string; name: string | null }[]>();
  for (const s of shares) sharesOf.set(s.documentId, [...(sharesOf.get(s.documentId) ?? []), s]);
  // Who sees each file, when narrowed: the database already left out the
  // files this person is left out of; authorize() asks again (its sixth question).
  const audiences = await audiencesForMe(tx, principal, "document", ids);

  const resourceOf = (r: (typeof rows)[number]): Resource => ({
      type: "document",
      id: r.doc.id,
      orgId: r.doc.orgId,
      firmOrgId: r.project.firmOrgId,
      projectId: r.doc.projectId,
      projectKind: r.project.kind,
      projectState: r.project.state,
      engagementMode: r.org.mode,
      visibility: r.doc.visibility,
      createdBy: r.doc.uploadedBy,
      sharedWith: (sharesOf.get(r.doc.id) ?? []).map((s) => s.userId),
      ownerOrgId: r.doc.ownerOrgId,
      departmentId: r.doc.departmentId,
      audience: audiences.get(r.doc.id),
  });
  const visibleRows = rows.filter((r) => authorize(principal, "document.download", resourceOf(r)).allowed);
  if (visibleRows.length === 0) return [];
  const visibleIds = visibleRows.map((r) => r.doc.id);

  // Sources. Each lookup runs under RLS too: an action or meeting the person
  // cannot open leaves the file under a plain "Evidence" folder, unnamed.
  // An action owner reads only their own actions (row-level security since
  // migration 0081); the action is also checked the way the action page checks
  // it, as a second lock. A teammate's file stays; its action is not named.
  const actionProject = alias(projects, "action_project");
  const actionOrg = alias(organizations, "action_org");
  const [evidenceRows, assessed, cited] = await Promise.all([
    tx
      .select({
        documentId: evidenceSubmissions.documentId,
        actionId: actions.id,
        title: actions.title,
        status: actions.status,
        orgId: actions.orgId,
        projectId: actions.projectId,
        createdBy: actions.createdBy,
        ownerUserId: actions.ownerUserId,
        label: recommendations.visibility,
        firmOrgId: actionProject.firmOrgId,
        projectKind: actionProject.kind,
        projectState: actionProject.state,
        engagementMode: actionOrg.engagementMode,
      })
      .from(evidenceSubmissions)
      .leftJoin(actions, eq(actions.id, evidenceSubmissions.actionId))
      .leftJoin(recommendations, eq(recommendations.id, actions.recommendationId))
      .leftJoin(actionProject, eq(actionProject.id, actions.projectId))
      .leftJoin(actionOrg, eq(actionOrg.id, actions.orgId))
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
  const evidence = evidenceRows.map((e) => {
    const opens =
      e.actionId !== null &&
      e.orgId !== null &&
      authorize(principal, "action.read", {
        type: "action",
        id: e.actionId,
        orgId: e.orgId,
        firmOrgId: e.firmOrgId ?? undefined,
        projectId: e.projectId,
        projectKind: e.projectKind ?? undefined,
        projectState: e.projectState ?? undefined,
        engagementMode: e.engagementMode,
        createdBy: e.createdBy,
        assignees: e.ownerUserId ? [e.ownerUserId] : [],
        visibility: e.label ?? undefined,
        draft: e.status === "draft",
      }).allowed;
    // The file stays (it is the reader's to open); the action it belongs to is not named.
    return { documentId: e.documentId, actionId: opens ? e.actionId : null, title: opens ? e.title : null };
  });
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
      aiIndexable: r.doc.aiIndexable,
      textStatus: r.doc.textStatus,
      ocrPages: r.doc.ocrPages,
      // Listed files are the latest version and not archived (the query's filter).
      can: fileControls(principal, {
        doc: r.doc,
        resource: resourceOf(r),
        context: {
          projectKind: r.project.kind,
          projectClosed: r.project.state === "closed",
          minimal: r.org.minimal,
          latest: true,
          firstVersion: r.doc.firstVersion,
          settled: r.doc.settled,
        },
      }),
      limited: audiences.has(r.doc.id),
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

  const source = await loadDocument(tx, input.documentId, principal);
  if (!source) throw new NotFoundError("document");
  assertAllowed(principal, "document.download", source.resource);
  if (source.doc.orgId !== action.orgId) throw new BadRequestError("pick a file of the same client");
  if (source.doc.visibility !== "shared") throw new BadRequestError("only files shared with the firm can be evidence");
  // A narrowed file (feature A) would reach the people it was kept from: evidence has no audience.
  // Asked of the file itself, not only of the caller (the database refuses the copy too).
  const { rows: narrowed } = await tx.execute<{ yes: boolean }>(sql`select app_document_narrowed(${source.doc.id}::uuid) as yes`);
  if (narrowed[0]?.yes) throw new BadRequestError("a file with a limited audience can't be used as evidence");
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
      evidenceRequestId: await itemAnswered(tx, actionId, input),
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
      // Who may choose who sees the file (feature A): firm staff, and the client's admin. Not managers or owners.
      audience: authorize(principal, "document.audience", {
        type: "document",
        orgId: r.orgId,
        firmOrgId: r.firmOrgId,
        projectId: r.id,
        projectKind: r.kind,
        engagementMode: r.mode,
        ownerOrgId: principal.orgId,
      }).allowed,
    })),
  };
}

export interface ProjectUploadInput {
  file: PreparedUpload;
  visibility: UploadVisibility;
  departmentId?: string;
  /** Who sees it, chosen at upload (feature A); none: everyone with access. */
  audience?: AudienceInput | null;
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
  // Who sees it, when the uploader narrowed it: checked on the file itself, in
  // the same transaction, so a refused audience stores no file either.
  if (input.audience && input.audience.mode !== "everyone") {
    const loaded = await loadDocument(tx, doc!.id, principal);
    if (!loaded) throw new NotFoundError("document");
    await writeAudience(tx, principal, "document", doc!.id, loaded.resource, input.audience, { on: "upload" });
  }
  await putObject(storageKey, bytes, input.file.contentType, sha256);
  return { id: doc!.id };
}
