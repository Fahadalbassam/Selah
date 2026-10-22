import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  assessmentAnswers,
  assessmentEvidence,
  assessmentNotes,
  assessments,
  assessmentTemplates,
  documents,
  findings,
  organizations,
  orgMemberships,
  templateAuthors,
  templateQuestions,
  templateSections,
  templateVersions,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { BASIS_LABELS, type OwnBasis, type ChoiceOption, type LegalForm, type QuestionType } from "@/lib/assessments";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { snapshotReport } from "./follow-through";
import { loadProject } from "./staffing";
import { STARTER_TEMPLATE, UNVERIFIED_CITATIONS } from "./assessment-starter";

// Assessment templates and assessments (drizzle/0029_assessments_rules.sql,
// docs/assessments.md). The database holds the rules: who authors, that a
// published version never changes, the scoring, and that a finding comes
// from a gap of a final assessment. Gaps become findings in the existing
// table, so recommendations, actions, evidence and reviews work as they do
// for a recommendation made directly.

function omit<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const out = { ...o };
  for (const k of keys) delete out[k];
  return out;
}

// ------------------------------------------------------------- templates

function firmRecord(principal: Principal): Resource {
  return { type: "assessment_template", orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null };
}

async function assertAuthor(tx: Tx, principal: Principal) {
  assertAllowed(principal, "assessment_template.manage", firmRecord(principal));
  if (principal.role === "firm_admin") return;
  const [row] = await tx
    .select({ userId: templateAuthors.userId })
    .from(templateAuthors)
    .where(and(eq(templateAuthors.firmOrgId, principal.orgId), eq(templateAuthors.userId, principal.userId)));
  if (!row) throw new NotFoundError("template");
}

async function loadVersion(tx: Tx, principal: Principal, versionId: string) {
  assertAllowed(principal, "assessment_template.read", firmRecord(principal));
  const [v] = await tx
    .select({
      id: templateVersions.id,
      templateId: templateVersions.templateId,
      status: templateVersions.status,
      version: templateVersions.version,
    })
    .from(templateVersions)
    .where(and(eq(templateVersions.id, versionId), eq(templateVersions.firmOrgId, principal.orgId)));
  if (!v) throw new NotFoundError("template");
  return v;
}

async function loadDraft(tx: Tx, principal: Principal, versionId: string) {
  await assertAuthor(tx, principal);
  const v = await loadVersion(tx, principal, versionId);
  if (v.status !== "draft") throw new ConflictError("a published version cannot be changed: start a new draft");
  return v;
}

/** The firm's templates, each with its latest published version and its draft, if any. */
export async function listTemplates(tx: Tx, principal: Principal, opts: { includeArchived?: boolean } = {}) {
  assertAllowed(principal, "assessment_template.read", firmRecord(principal));
  const rows = await tx
    .select({
      id: assessmentTemplates.id,
      name: assessmentTemplates.name,
      nameAr: assessmentTemplates.nameAr,
      description: assessmentTemplates.description,
      descriptionAr: assessmentTemplates.descriptionAr,
      archivedAt: assessmentTemplates.archivedAt,
    })
    .from(assessmentTemplates)
    .where(
      and(
        eq(assessmentTemplates.firmOrgId, principal.orgId),
        opts.includeArchived ? undefined : isNull(assessmentTemplates.archivedAt),
      ),
    )
    .orderBy(asc(assessmentTemplates.name));
  if (rows.length === 0) return { canAuthor: false, templates: [] };
  const versions = await tx
    .select({
      id: templateVersions.id,
      templateId: templateVersions.templateId,
      version: templateVersions.version,
      status: templateVersions.status,
      publishedAt: templateVersions.publishedAt,
    })
    .from(templateVersions)
    .where(
      inArray(
        templateVersions.templateId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(desc(templateVersions.version));
  const canAuthor = await isAuthor(tx, principal);
  return {
    canAuthor,
    templates: rows.map((t) => ({
      ...t,
      published: versions.find((v) => v.templateId === t.id && v.status === "published") ?? null,
      draft: versions.find((v) => v.templateId === t.id && v.status === "draft") ?? null,
    })),
  };
}

async function isAuthor(tx: Tx, principal: Principal) {
  try {
    await assertAuthor(tx, principal);
    return true;
  } catch {
    return false;
  }
}

/** A template with all its versions, newest first, for the template screen. */
export async function templateOverview(tx: Tx, principal: Principal, templateId: string) {
  assertAllowed(principal, "assessment_template.read", firmRecord(principal));
  const [t] = await tx
    .select({
      id: assessmentTemplates.id,
      name: assessmentTemplates.name,
      nameAr: assessmentTemplates.nameAr,
      description: assessmentTemplates.description,
      descriptionAr: assessmentTemplates.descriptionAr,
      archivedAt: assessmentTemplates.archivedAt,
    })
    .from(assessmentTemplates)
    .where(and(eq(assessmentTemplates.id, templateId), eq(assessmentTemplates.firmOrgId, principal.orgId)));
  if (!t) throw new NotFoundError("template");
  const versions = await tx
    .select({
      id: templateVersions.id,
      version: templateVersions.version,
      status: templateVersions.status,
      publishedAt: templateVersions.publishedAt,
    })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.version));
  return { ...t, versions, canAuthor: await isAuthor(tx, principal) };
}

/** One version with its sections and questions, in order. */
export async function getTemplateVersion(tx: Tx, principal: Principal, versionId: string) {
  const v = await loadVersion(tx, principal, versionId);
  const [t] = await tx
    .select({ id: assessmentTemplates.id, name: assessmentTemplates.name, nameAr: assessmentTemplates.nameAr })
    .from(assessmentTemplates)
    .where(eq(assessmentTemplates.id, v.templateId));
  const content = await versionContent(tx, versionId);
  return { ...v, template: t!, ...content };
}

async function versionContent(tx: Tx, versionId: string) {
  const sections = await tx
    .select()
    .from(templateSections)
    .where(eq(templateSections.versionId, versionId))
    .orderBy(asc(templateSections.position));
  const questions = await tx
    .select()
    .from(templateQuestions)
    .where(eq(templateQuestions.versionId, versionId))
    .orderBy(asc(templateQuestions.position));
  return {
    sections: sections.map((s) => ({
      id: s.id,
      position: s.position,
      title: s.title,
      titleAr: s.titleAr,
      description: s.description,
      descriptionAr: s.descriptionAr,
      questions: questions.filter((q) => q.sectionId === s.id).map((q) => omit(q, "versionId", "firmOrgId", "sectionId")),
    })),
  };
}

export interface TemplateInput {
  name: string;
  nameAr?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
}

/** A new template with an empty first draft. */
export async function createTemplate(tx: Tx, principal: Principal, input: TemplateInput) {
  await assertAuthor(tx, principal);
  const [t] = await tx
    .insert(assessmentTemplates)
    .values({ firmOrgId: principal.orgId, ...input, createdBy: principal.userId })
    .returning({ id: assessmentTemplates.id });
  const [v] = await tx
    .insert(templateVersions)
    .values({ templateId: t!.id, firmOrgId: principal.orgId, version: 0, createdBy: principal.userId })
    .returning({ id: templateVersions.id });
  return { id: t!.id, draftVersionId: v!.id };
}

/** Rename, describe, archive or bring back a template. Versions are not touched. */
export async function updateTemplate(
  tx: Tx,
  principal: Principal,
  templateId: string,
  input: Partial<TemplateInput> & { archived?: boolean },
) {
  await assertAuthor(tx, principal);
  const { archived, ...names } = input;
  const [row] = await tx
    .update(assessmentTemplates)
    .set({ ...names, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) })
    .where(and(eq(assessmentTemplates.id, templateId), eq(assessmentTemplates.firmOrgId, principal.orgId)))
    .returning({ id: assessmentTemplates.id });
  if (!row) throw new NotFoundError("template");
  if (archived !== undefined)
    await audit(tx, {
      actorId: principal.userId,
      orgId: principal.orgId,
      action: archived ? "template.archive" : "template.restore",
      resourceType: "assessment_template",
      resourceId: templateId,
      outcome: "allow",
    });
  return { ok: true };
}

async function latestVersion(tx: Tx, templateId: string, status?: "published") {
  const [v] = await tx
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), status ? eq(templateVersions.status, status) : undefined))
    .orderBy(desc(templateVersions.version))
    .limit(1);
  return v?.id ?? null;
}

/** Start editing: a new draft copied from the latest published version (or the open draft, if there is one). */
export async function startDraft(tx: Tx, principal: Principal, templateId: string) {
  await assertAuthor(tx, principal);
  const [open] = await tx
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.templateId, templateId),
        eq(templateVersions.firmOrgId, principal.orgId),
        eq(templateVersions.status, "draft"),
      ),
    );
  if (open) return { draftVersionId: open.id, existing: true };
  const src = await latestVersion(tx, templateId, "published");
  if (!src) throw new NotFoundError("template");
  const { rows } = await tx.execute<{ id: string }>(
    sql`select app_copy_template_version(${src}::uuid, ${templateId}::uuid) as id`,
  );
  return { draftVersionId: rows[0]!.id, existing: false };
}

/** A copy of a template (its latest published version, else its draft) as a new template's first draft. */
export async function duplicateTemplate(tx: Tx, principal: Principal, templateId: string, input: TemplateInput) {
  await assertAuthor(tx, principal);
  const src = (await latestVersion(tx, templateId, "published")) ?? (await latestVersion(tx, templateId));
  if (!src) throw new NotFoundError("template");
  await loadVersion(tx, principal, src);
  const [t] = await tx
    .insert(assessmentTemplates)
    .values({ firmOrgId: principal.orgId, ...input, createdBy: principal.userId })
    .returning({ id: assessmentTemplates.id });
  const { rows } = await tx.execute<{ id: string }>(sql`select app_copy_template_version(${src}::uuid, ${t!.id}::uuid) as id`);
  return { id: t!.id, draftVersionId: rows[0]!.id };
}

export async function publishVersion(tx: Tx, principal: Principal, versionId: string) {
  await loadDraft(tx, principal, versionId);
  await tx.update(templateVersions).set({ status: "published" }).where(eq(templateVersions.id, versionId));
  return { ok: true };
}

/** Throw a draft away. A template's only version cannot go: archive the template instead. */
export async function discardDraft(tx: Tx, principal: Principal, versionId: string) {
  const v = await loadDraft(tx, principal, versionId);
  const [other] = await tx
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, v.templateId), eq(templateVersions.status, "published")))
    .limit(1);
  if (!other) throw new ConflictError("this is the template's only version: archive the template instead");
  await tx.delete(templateVersions).where(eq(templateVersions.id, versionId));
  return { ok: true };
}

export interface SectionInput {
  position: number;
  title: string;
  titleAr?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
}

export async function addSection(tx: Tx, principal: Principal, versionId: string, input: SectionInput) {
  await loadDraft(tx, principal, versionId);
  const [row] = await tx
    .insert(templateSections)
    .values({ versionId, firmOrgId: principal.orgId, ...input })
    .returning({ id: templateSections.id });
  return row!;
}

async function sectionVersion(tx: Tx, principal: Principal, sectionId: string) {
  const [s] = await tx
    .select({ versionId: templateSections.versionId })
    .from(templateSections)
    .where(and(eq(templateSections.id, sectionId), eq(templateSections.firmOrgId, principal.orgId)));
  if (!s) throw new NotFoundError("section");
  return s.versionId;
}

export async function updateSection(tx: Tx, principal: Principal, sectionId: string, input: Partial<SectionInput>) {
  await loadDraft(tx, principal, await sectionVersion(tx, principal, sectionId));
  await tx.update(templateSections).set(input).where(eq(templateSections.id, sectionId));
  return { ok: true };
}

export async function deleteSection(tx: Tx, principal: Principal, sectionId: string) {
  await loadDraft(tx, principal, await sectionVersion(tx, principal, sectionId));
  await tx.delete(templateSections).where(eq(templateSections.id, sectionId));
  return { ok: true };
}

export interface QuestionInput {
  sectionId: string;
  position: number;
  ref?: string | null;
  prompt: string;
  promptAr?: string | null;
  guidance?: string | null;
  guidanceAr?: string | null;
  type: QuestionType;
  options?: ChoiceOption[] | null;
  weight: number;
  gapMaxPoints?: number | null;
  /** A question's own basis. Legal requirement and regulator guidance come only from legalFor and guidanceFor. */
  basis: OwnBasis;
  legalFor?: LegalForm[] | null;
  guidanceFor?: LegalForm[] | null;
  citation?: string | null;
  locator?: string | null;
  /** False until someone checks the citation against the source's current text. */
  citationVerified?: boolean;
  appliesIfQuestionId?: string | null;
  appliesIfValues?: string[] | null;
}

/** An outside source is named with where in it the criterion comes from. */
function checkProvenance(input: Partial<QuestionInput>) {
  if (
    (input.basis === "good_practice" || input.legalFor?.length || input.guidanceFor?.length) &&
    !(input.citation && input.locator)
  )
    throw new BadRequestError("name the source and where in it (a page, section, chapter or article)");
  if (input.citation && !input.locator) throw new BadRequestError("say where in the source: a page, section, chapter or article");
}

export async function addQuestion(tx: Tx, principal: Principal, versionId: string, input: QuestionInput) {
  await loadDraft(tx, principal, versionId);
  checkProvenance(input);
  const [row] = await tx
    .insert(templateQuestions)
    .values({ versionId, firmOrgId: principal.orgId, ...input })
    .returning({ id: templateQuestions.id });
  return row!;
}

async function questionRow(tx: Tx, principal: Principal, questionId: string) {
  const [q] = await tx
    .select()
    .from(templateQuestions)
    .where(and(eq(templateQuestions.id, questionId), eq(templateQuestions.firmOrgId, principal.orgId)));
  if (!q) throw new NotFoundError("question");
  return q;
}

export async function updateQuestion(tx: Tx, principal: Principal, questionId: string, input: Partial<QuestionInput>) {
  const q = await questionRow(tx, principal, questionId);
  await loadDraft(tx, principal, q.versionId);
  checkProvenance({ ...q, basis: q.basis as OwnBasis, ...input });
  await tx.update(templateQuestions).set(input).where(eq(templateQuestions.id, questionId));
  return { ok: true };
}

export async function deleteQuestion(tx: Tx, principal: Principal, questionId: string) {
  const q = await questionRow(tx, principal, questionId);
  await loadDraft(tx, principal, q.versionId);
  await tx.delete(templateQuestions).where(eq(templateQuestions.id, questionId));
  return { ok: true };
}

/**
 * The starter family-governance template (services/assessment-starter.ts),
 * as a new template of this firm. It starts as a draft so the firm can edit
 * it before publishing; `publish` publishes it straight away.
 */
export async function installStarterTemplate(tx: Tx, principal: Principal, opts: { publish?: boolean } = {}) {
  const t = STARTER_TEMPLATE;
  const { id, draftVersionId } = await createTemplate(tx, principal, {
    name: t.name,
    nameAr: t.nameAr,
    description: t.description,
    descriptionAr: t.descriptionAr,
  });
  const byRef = new Map<string, string>();
  for (const [i, s] of t.sections.entries()) {
    const { id: sectionId } = await addSection(tx, principal, draftVersionId, {
      position: i + 1,
      title: s.title,
      titleAr: s.titleAr,
    });
    for (const [j, q] of s.questions.entries()) {
      const { appliesIf, ...rest } = q;
      const row = await addQuestion(tx, principal, draftVersionId, {
        ...rest,
        sectionId,
        position: j + 1,
        weight: 1,
        citationVerified: q.citation !== null && !UNVERIFIED_CITATIONS.has(q.ref),
        appliesIfQuestionId: appliesIf ? byRef.get(appliesIf.ref)! : null,
        appliesIfValues: appliesIf ? appliesIf.values : null,
      });
      byRef.set(q.ref, row.id);
    }
  }
  if (opts.publish) await publishVersion(tx, principal, draftVersionId);
  return { id, versionId: draftVersionId, published: !!opts.publish };
}

// --------------------------------------------------------------- authors

export async function listTemplateAuthors(tx: Tx, principal: Principal) {
  assertAllowed(principal, "assessment_template.read", firmRecord(principal));
  return tx
    .select({ userId: templateAuthors.userId, name: user.name, grantedAt: templateAuthors.grantedAt })
    .from(templateAuthors)
    .innerJoin(user, eq(user.id, templateAuthors.userId))
    .where(eq(templateAuthors.firmOrgId, principal.orgId))
    .orderBy(asc(user.name));
}

/** Active consultants of the firm who are not authors yet (the firm admin picks from them). */
export async function authorCandidates(tx: Tx, principal: Principal) {
  if (!authorize(principal, "template_author.manage", firmRecord(principal)).allowed) return [];
  const authors = new Set((await listTemplateAuthors(tx, principal)).map((a) => a.userId));
  const rows = await tx
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(orgMemberships)
    .innerJoin(user, eq(user.id, orgMemberships.userId))
    .where(and(eq(orgMemberships.orgId, principal.orgId), eq(orgMemberships.role, "consultant"), eq(orgMemberships.active, true)))
    .orderBy(asc(user.name));
  return rows.filter((r) => !authors.has(r.userId));
}

export async function addTemplateAuthor(tx: Tx, principal: Principal, userId: string) {
  assertAllowed(principal, "template_author.manage", firmRecord(principal));
  await tx
    .insert(templateAuthors)
    .values({ firmOrgId: principal.orgId, userId, grantedBy: principal.userId })
    .onConflictDoNothing();
  return { ok: true };
}

export async function removeTemplateAuthor(tx: Tx, principal: Principal, userId: string) {
  assertAllowed(principal, "template_author.manage", firmRecord(principal));
  await tx.delete(templateAuthors).where(and(eq(templateAuthors.firmOrgId, principal.orgId), eq(templateAuthors.userId, userId)));
  return { ok: true };
}

// ---------------------------------------------------------- legal form

/** The firm admin records a client's legal form; it decides which criteria are legal requirements for it. */
export async function setLegalForm(tx: Tx, principal: Principal, orgId: string, legalForm: LegalForm | null) {
  assertAllowed(principal, "organization.engagement", {
    type: "organization",
    orgId,
    firmOrgId: principal.orgKind === "firm" ? principal.orgId : undefined,
    projectId: null,
  });
  const [row] = await tx
    .update(organizations)
    .set({ legalForm })
    .where(and(eq(organizations.id, orgId), eq(organizations.kind, "client")))
    .returning({ id: organizations.id });
  if (!row) throw new NotFoundError("client");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "organization.legal_form",
    resourceType: "organization",
    resourceId: orgId,
    outcome: "allow",
    meta: { legalForm },
  });
  return { ok: true };
}

// ------------------------------------------------------------ assessments

async function loadAssessment(
  tx: Tx,
  principal: Principal,
  assessmentId: string,
  permission: "assessment.read" | "assessment.conduct",
) {
  // Row-level security hides drafts and unshared assessments from clients.
  const [a] = await tx.select().from(assessments).where(eq(assessments.id, assessmentId));
  if (!a) throw new NotFoundError("assessment");
  const resource: Resource = {
    type: "assessment",
    id: a.id,
    orgId: a.orgId,
    firmOrgId: a.firmOrgId,
    projectId: a.projectId,
    projectKind: "client",
    clientOrgId: a.orgId,
  };
  assertAllowed(principal, permission, resource);
  return { assessment: a, resource };
}

/** Assess a client project against a template's latest published version. */
export async function createAssessment(
  tx: Tx,
  principal: Principal,
  projectId: string,
  input: { templateId: string; title: string },
) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "assessment.conduct", { ...resource, type: "assessment" });
  if (project.kind !== "client") throw new BadRequestError("assessments are of client projects");
  const [t] = await tx
    .select({ id: assessmentTemplates.id, archivedAt: assessmentTemplates.archivedAt })
    .from(assessmentTemplates)
    .where(and(eq(assessmentTemplates.id, input.templateId), eq(assessmentTemplates.firmOrgId, project.firmOrgId)));
  if (!t) throw new NotFoundError("template");
  if (t.archivedAt) throw new ConflictError("the template is archived");
  const versionId = await latestVersion(tx, t.id, "published");
  if (!versionId) throw new ConflictError("publish the template before using it");
  const [row] = await tx
    .insert(assessments)
    .values({
      projectId,
      orgId: project.orgId,
      firmOrgId: project.firmOrgId,
      templateVersionId: versionId,
      title: input.title,
      legalForm: "other", // replaced by the client's own by the database
      createdBy: principal.userId,
    })
    .returning({ id: assessments.id, legalForm: assessments.legalForm });
  return row!;
}

export interface SectionScore {
  sectionId: string;
  position: number;
  title: string;
  titleAr: string | null;
  earned: number;
  possible: number;
  /** earned / possible; null while nothing in the section is scored. */
  pct: number | null;
  toAnswer: number;
  gaps: number;
  confirmed: number;
}

async function scores(tx: Tx, assessmentId: string) {
  const { rows } = await tx.execute<{
    section_id: string;
    section_position: number;
    title: string;
    title_ar: string | null;
    earned: number;
    possible: number;
    to_answer: number;
    gaps: number;
    confirmed: number;
  }>(sql`select * from app_assessment_scores(${assessmentId}::uuid)`);
  const sections: SectionScore[] = rows.map((r) => ({
    sectionId: r.section_id,
    position: r.section_position,
    title: r.title,
    titleAr: r.title_ar,
    earned: r.earned,
    possible: r.possible,
    pct: r.possible > 0 ? Math.round((1000 * r.earned) / r.possible) / 10 : null,
    toAnswer: r.to_answer,
    gaps: r.gaps,
    confirmed: r.confirmed,
  }));
  const earned = sections.reduce((n, s) => n + s.earned, 0);
  const possible = sections.reduce((n, s) => n + s.possible, 0);
  return {
    sections,
    total: {
      earned,
      possible,
      pct: possible > 0 ? Math.round((1000 * earned) / possible) / 10 : null,
      toAnswer: sections.reduce((n, s) => n + s.toAnswer, 0),
      gaps: sections.reduce((n, s) => n + s.gaps, 0),
      confirmed: sections.reduce((n, s) => n + s.confirmed, 0),
    },
  };
}

/**
 * Assess the project again on the same template (its latest published
 * version), to compare with this one once it is answered. Only a final
 * assessment is retaken.
 */
export async function retakeAssessment(tx: Tx, principal: Principal, assessmentId: string, input: { title?: string } = {}) {
  const { assessment: a } = await loadAssessment(tx, principal, assessmentId, "assessment.conduct");
  if (a.status !== "final") throw new ConflictError("finalise the assessment before retaking it");
  const [v] = await tx
    .select({ templateId: templateVersions.templateId })
    .from(templateVersions)
    .where(eq(templateVersions.id, a.templateVersionId));
  return createAssessment(tx, principal, a.projectId, { templateId: v!.templateId, title: input.title ?? a.title });
}

interface Side {
  value: string | null;
  points: number | null;
  maxPoints: number | null;
  gap: boolean;
}

/**
 * Two assessments of the same client on the same template, earlier first:
 * points per section and every question whose answer changed, was added or
 * was dropped. Points are earned and possible points, as on the assessment.
 */
export async function compareAssessments(tx: Tx, principal: Principal, firstId: string, secondId: string) {
  const one = await loadAssessment(tx, principal, firstId, "assessment.read");
  const two = await loadAssessment(tx, principal, secondId, "assessment.read");
  const [earlier, later] = one.assessment.createdAt <= two.assessment.createdAt ? [one, two] : [two, one];
  const { rows: all } = await tx.execute<{
    match_key: string;
    ref: string | null;
    section_position: number;
    section_title: string;
    section_title_ar: string | null;
    prompt: string;
    prompt_ar: string | null;
    type: QuestionType;
    before_value: string | null;
    after_value: string | null;
    before_points: number | null;
    after_points: number | null;
    before_max: number | null;
    after_max: number | null;
    before_gap: boolean;
    after_gap: boolean;
    in_earlier: boolean;
    in_later: boolean;
    wording_changed: boolean;
  }>(sql`select * from app_assessment_compare(${earlier.assessment.id}::uuid, ${later.assessment.id}::uuid)`);
  // Clients compare answers only: points, totals and gaps are the firm's.
  const firm = principal.orgKind === "firm";
  const rows = firm
    ? all
    : all.map((r) => ({
        ...r,
        before_points: null,
        after_points: null,
        before_max: null,
        after_max: null,
        before_gap: false,
        after_gap: false,
      }));

  const sum = (xs: (number | null)[]) => xs.reduce<number>((n, x) => n + (x ?? 0), 0);
  const sections = new Map<string, { title: string; titleAr: string | null; position: number; rows: typeof rows }>();
  for (const r of rows) {
    const key = `${r.section_position}:${r.section_title}`;
    const s = sections.get(key) ?? {
      title: r.section_title,
      titleAr: r.section_title_ar,
      position: r.section_position,
      rows: [],
    };
    s.rows.push(r);
    sections.set(key, s);
  }
  const side = (r: (typeof rows)[number], when: "before" | "after"): Side | null =>
    (when === "before" ? r.in_earlier : r.in_later)
      ? {
          value: when === "before" ? r.before_value : r.after_value,
          points: when === "before" ? r.before_points : r.after_points,
          maxPoints: when === "before" ? r.before_max : r.after_max,
          gap: when === "before" ? r.before_gap : r.after_gap,
        }
      : null;
  const head = (x: typeof earlier.assessment) => ({
    id: x.id,
    title: x.title,
    status: x.status,
    createdAt: x.createdAt,
    finalisedAt: x.finalisedAt,
  });
  const totals = (when: "before" | "after") =>
    firm
      ? {
          earned: sum(rows.map((r) => (when === "before" ? r.before_points : r.after_points))),
          possible: sum(rows.map((r) => (when === "before" ? r.before_max : r.after_max))),
          gaps: rows.filter((r) => (when === "before" ? r.before_gap : r.after_gap)).length,
        }
      : { earned: null, possible: null, gaps: null };
  return {
    earlier: { ...head(earlier.assessment), ...totals("before") },
    later: { ...head(later.assessment), ...totals("after") },
    sections: [...sections.values()]
      .sort((x, y) => x.position - y.position)
      .map((s) => ({
        title: s.title,
        titleAr: s.titleAr,
        before: firm ? { earned: sum(s.rows.map((r) => r.before_points)), possible: sum(s.rows.map((r) => r.before_max)) } : null,
        after: firm ? { earned: sum(s.rows.map((r) => r.after_points)), possible: sum(s.rows.map((r) => r.after_max)) } : null,
        // Questions the later one has not answered yet are counted, not listed.
        unanswered: s.rows.filter((r) => r.in_later && r.after_value === null).length,
        // Only what changed: a different answer, a question added or dropped, or
        // reworded under the same reference (its answers are not like for like).
        changes: s.rows
          .filter(
            (r) =>
              !r.in_earlier || !r.in_later || r.wording_changed || (r.after_value !== null && r.before_value !== r.after_value),
          )
          .map((r) => ({
            ref: r.ref,
            prompt: r.prompt,
            promptAr: r.prompt_ar,
            type: r.type,
            change: !r.in_earlier ? ("added" as const) : !r.in_later ? ("dropped" as const) : ("answer" as const),
            wordingChanged: r.wording_changed,
            before: side(r, "before"),
            after: side(r, "after"),
          })),
      })),
  };
}

/** A project's assessments, newest first, with their totals: a reassessment shows the change. */
export async function listAssessments(tx: Tx, principal: Principal, projectId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "assessment.read", { ...resource, type: "assessment" });
  const rows = await tx
    .select({
      id: assessments.id,
      title: assessments.title,
      status: assessments.status,
      legalForm: assessments.legalForm,
      sharedWithClient: assessments.sharedWithClient,
      finalisedAt: assessments.finalisedAt,
      createdAt: assessments.createdAt,
      templateId: assessmentTemplates.id,
      templateName: assessmentTemplates.name,
      templateNameAr: assessmentTemplates.nameAr,
      version: templateVersions.version,
    })
    .from(assessments)
    .innerJoin(templateVersions, eq(templateVersions.id, assessments.templateVersionId))
    .innerJoin(assessmentTemplates, eq(assessmentTemplates.id, templateVersions.templateId))
    .where(eq(assessments.projectId, projectId))
    .orderBy(desc(assessments.createdAt));
  // Scores are the firm's working view: clients see the answers, never the points (Fahad, 2026-10-22).
  if (principal.orgKind !== "firm") return rows.map((r) => ({ ...r, total: null }));
  return Promise.all(rows.map(async (r) => ({ ...r, total: (await scores(tx, r.id)).total })));
}

/** The assessment with its questions, answers, evidence, scores and gaps. */
export async function getAssessment(tx: Tx, principal: Principal, assessmentId: string) {
  const { assessment: a, resource } = await loadAssessment(tx, principal, assessmentId, "assessment.read");
  const content = await versionContent(tx, a.templateVersionId);
  const answers = await tx.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, assessmentId));
  const { rows: results } = await tx.execute<{
    answer_id: string;
    section_id: string;
    type: QuestionType;
    value: string | null;
    applicable: boolean;
    points: number | null;
    max_points: number | null;
    is_gap: boolean;
    finding_id: string | null;
  }>(
    sql`select answer_id, section_id, type, value, applicable, points, max_points, is_gap, finding_id from app_assessment_results(${assessmentId}::uuid)`,
  );
  // Row-level security on documents leaves out files the caller cannot see.
  const evidence = await tx
    .select({
      answerId: assessmentEvidence.answerId,
      documentId: documents.id,
      title: documents.title,
      scanStatus: documents.scanStatus,
    })
    .from(assessmentEvidence)
    .innerJoin(documents, eq(documents.id, assessmentEvidence.documentId))
    .where(inArray(assessmentEvidence.answerId, answers.length ? answers.map((x) => x.id) : [a.id]));
  // Firm staff only; row-level security returns none to the client.
  const notes =
    principal.orgKind === "firm"
      ? await tx
          .select({ answerId: assessmentNotes.answerId, body: assessmentNotes.body })
          .from(assessmentNotes)
          .where(eq(assessmentNotes.projectId, a.projectId))
      : [];
  const noteOf = new Map(notes.map((n) => [n.answerId, n.body]));
  const byQuestion = new Map(answers.map((x) => [x.questionId, x]));
  const resultOf = new Map(results.map((r) => [r.answer_id, r]));
  const firm = principal.orgKind === "firm";
  // Clients see the questions, answers, comments and evidence, but no points, percentages or gaps.
  // The database refuses them the scores (drizzle/0043_assessment_scores_firm_only.sql).
  const score = firm ? await scores(tx, assessmentId) : null;
  const hidden = { earned: null, possible: null, pct: null, gaps: null, confirmed: null };
  const toAnswer = (sectionId?: string) =>
    results.filter((r) => r.applicable && r.type !== "text" && r.value === null && (!sectionId || r.section_id === sectionId))
      .length;
  return {
    id: a.id,
    projectId: a.projectId,
    title: a.title,
    status: a.status,
    legalForm: a.legalForm,
    sharedWithClient: a.sharedWithClient,
    finalisedAt: a.finalisedAt,
    canConduct: authorize(principal, "assessment.conduct", resource).allowed,
    total: score ? score.total : { ...hidden, toAnswer: toAnswer() },
    sections: content.sections.map((s) => ({
      ...s,
      ...(score
        ? omit(score.sections.find((x) => x.sectionId === s.id)!, "sectionId", "position", "title", "titleAr")
        : { ...hidden, toAnswer: toAnswer(s.id) }),
      questions: s.questions.map((q) => {
        const x = byQuestion.get(q.id)!;
        const r = resultOf.get(x.id);
        return {
          ...q,
          // The basis worked out for this client when the assessment was made.
          basis: x.basis,
          basisLabel: BASIS_LABELS[x.basis],
          answer: {
            id: x.id,
            value: x.value,
            textAnswer: x.textAnswer,
            comment: x.comment,
            answeredAt: x.answeredAt,
            ...(firm ? { answeredBy: x.answeredBy, firmNote: noteOf.get(x.id) ?? null } : {}),
          },
          applicable: r?.applicable ?? true,
          points: firm ? (r?.points ?? null) : null,
          maxPoints: firm ? (r?.max_points ?? null) : null,
          isGap: firm ? (r?.is_gap ?? false) : false,
          findingId: firm ? (r?.finding_id ?? null) : null,
          evidence: evidence.filter((e) => e.answerId === x.id).map((e) => omit(e, "answerId")),
        };
      }),
    })),
  };
}

async function loadAnswer(tx: Tx, principal: Principal, answerId: string) {
  const [x] = await tx
    .select({ id: assessmentAnswers.id, assessmentId: assessmentAnswers.assessmentId, projectId: assessmentAnswers.projectId })
    .from(assessmentAnswers)
    .where(eq(assessmentAnswers.id, answerId));
  if (!x) throw new NotFoundError("answer");
  const loaded = await loadAssessment(tx, principal, x.assessmentId, "assessment.conduct");
  return { answer: x, ...loaded };
}

export async function answerQuestion(
  tx: Tx,
  principal: Principal,
  answerId: string,
  input: { value?: string | null; textAnswer?: string | null; comment?: string | null },
) {
  const { assessment } = await loadAnswer(tx, principal, answerId);
  if (assessment.status !== "draft") throw new ConflictError("a final assessment is kept as it was: start a new one to reassess");
  await tx.update(assessmentAnswers).set(input).where(eq(assessmentAnswers.id, answerId));
  return { ok: true };
}

/** The firm's own note on an answer, never shown to the client. Empty removes it. */
export async function setFirmNote(tx: Tx, principal: Principal, answerId: string, body: string) {
  const { answer, assessment } = await loadAnswer(tx, principal, answerId);
  if (!body) {
    await tx.delete(assessmentNotes).where(eq(assessmentNotes.answerId, answerId));
    return { ok: true };
  }
  await tx
    .insert(assessmentNotes)
    .values({ answerId, projectId: answer.projectId, orgId: assessment.orgId, body, updatedBy: principal.userId })
    .onConflictDoUpdate({ target: assessmentNotes.answerId, set: { body, updatedBy: principal.userId } });
  return { ok: true };
}

export async function updateAssessment(tx: Tx, principal: Principal, assessmentId: string, input: { title?: string }) {
  await loadAssessment(tx, principal, assessmentId, "assessment.conduct");
  await tx.update(assessments).set(input).where(eq(assessments.id, assessmentId));
  return { ok: true };
}

/** Final: the answers are kept as they are, and gaps can be confirmed as findings. */
export async function finaliseAssessment(tx: Tx, principal: Principal, assessmentId: string) {
  await loadAssessment(tx, principal, assessmentId, "assessment.conduct");
  await tx.update(assessments).set({ status: "final" }).where(eq(assessments.id, assessmentId));
  return scores(tx, assessmentId);
}

/** Show a final assessment's answers and scores to the client's admins and managers on the project (or stop). */
export async function shareAssessment(tx: Tx, principal: Principal, assessmentId: string, shared: boolean) {
  await loadAssessment(tx, principal, assessmentId, "assessment.conduct");
  await tx.update(assessments).set({ sharedWithClient: shared }).where(eq(assessments.id, assessmentId));
  return { ok: true };
}

export async function addAnswerEvidence(tx: Tx, principal: Principal, answerId: string, documentId: string) {
  const { answer, assessment } = await loadAnswer(tx, principal, answerId);
  const [d] = await tx
    .select({ id: documents.id, projectId: documents.projectId })
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!d || d.projectId !== answer.projectId) throw new BadRequestError("attach a file of this project");
  await tx
    .insert(assessmentEvidence)
    .values({ answerId, documentId, projectId: answer.projectId, orgId: assessment.orgId, addedBy: principal.userId })
    .onConflictDoNothing();
  return { ok: true };
}

export async function removeAnswerEvidence(tx: Tx, principal: Principal, answerId: string, documentId: string) {
  await loadAnswer(tx, principal, answerId);
  await tx
    .delete(assessmentEvidence)
    .where(and(eq(assessmentEvidence.answerId, answerId), eq(assessmentEvidence.documentId, documentId)));
  return { ok: true };
}

/**
 * Confirm a gap as a finding. From here it is an ordinary finding: answer it
 * with recommendations (POST /api/projects/:id/recommendations with
 * findingId) and carry those out with actions.
 */
export async function confirmGap(
  tx: Tx,
  principal: Principal,
  answerId: string,
  input: { title: string; description?: string; visibility: "shared" | "firm_private" },
) {
  const { answer, assessment, resource } = await loadAnswer(tx, principal, answerId);
  assertAllowed(principal, "finding.write", { ...resource, type: "finding" });
  if (assessment.status !== "final") throw new ConflictError("finalise the assessment before confirming its gaps");
  const [existing] = await tx.select({ id: findings.id }).from(findings).where(eq(findings.assessmentAnswerId, answerId));
  if (existing) throw new ConflictError("this gap is already a finding");
  const [row] = await tx
    .insert(findings)
    .values({
      projectId: answer.projectId,
      orgId: assessment.orgId,
      assessmentAnswerId: answerId,
      ...input,
      createdBy: principal.userId,
    })
    .returning({ id: findings.id });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "assessment.confirm_gap",
    resourceType: "finding",
    resourceId: row!.id,
    outcome: "allow",
    meta: { assessmentId: assessment.id },
  });
  return row!;
}

export interface GapFollowUp {
  answerId: string;
  ref: string | null;
  findingId: string;
  findingTitle: string;
  recommendations: number;
  actions: number;
  /** Awaiting review: reported done, not yet checked. */
  reported: number;
  /** Released actions with evidence submitted. */
  evidenced: number;
  /** Accepted by a consultant's review. Counted again below by whose evidence it rested on. */
  verified: number;
  verifiedClientEvidence: number;
  verifiedConsultantRecorded: number;
  closed: number;
  overdue: number;
}

/** Each confirmed gap and how far the work on it has come. Reported, evidenced and verified are never added together. */
export async function assessmentFollowUp(tx: Tx, principal: Principal, assessmentId: string): Promise<GapFollowUp[]> {
  await loadAssessment(tx, principal, assessmentId, "assessment.read");
  const { rows } = await tx.execute<{
    answer_id: string;
    ref: string | null;
    finding_id: string;
    finding_title: string;
    recommendations: number;
    actions: number;
    reported: number;
    evidenced: number;
    verified: number;
    verified_client_evidence: number;
    verified_consultant_recorded: number;
    closed: number;
    overdue: number;
  }>(sql`select * from app_assessment_followup(${assessmentId}::uuid)`);
  return rows.map((r) => ({
    answerId: r.answer_id,
    ref: r.ref,
    findingId: r.finding_id,
    findingTitle: r.finding_title,
    recommendations: r.recommendations,
    actions: r.actions,
    reported: r.reported,
    evidenced: r.evidenced,
    verified: r.verified,
    verifiedClientEvidence: r.verified_client_evidence,
    verifiedConsultantRecorded: r.verified_consultant_recorded,
    closed: r.closed,
    overdue: r.overdue,
  }));
}

/**
 * A periodic report from a final assessment: section scores, confirmed gaps
 * and the work on them, frozen with the project's numbers as a report
 * (firm-private until shared, like any report).
 */
export async function assessmentReport(
  tx: Tx,
  principal: Principal,
  assessmentId: string,
  input: { title: string; periodStart: string; periodEnd: string; lang: "ar" | "en" },
) {
  const { assessment } = await loadAssessment(tx, principal, assessmentId, "assessment.conduct");
  if (assessment.status !== "final") throw new ConflictError("finalise the assessment before reporting on it");
  const s = await scores(tx, assessmentId);
  const gaps = await assessmentFollowUp(tx, principal, assessmentId);
  const ar = input.lang === "ar";
  const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
  const lines = [
    `## ${ar ? "نتيجة التقييم" : "Assessment result"}: ${assessment.title}`,
    "",
    ar
      ? "النسب مؤشرات للمقارنة بمعايير القالب، وليست شهادة امتثال نظامي."
      : "Percentages are indicative, against the template's criteria. They are not a certification of legal compliance.",
    "",
    `| ${ar ? "المحور" : "Section"} | ${ar ? "النقاط" : "Points"} | % | ${ar ? "الفجوات" : "Gaps"} |`,
    "|---|---|---|---|",
    ...s.sections.map((x) => `| ${(ar && x.titleAr) || x.title} | ${x.earned}/${x.possible} | ${pct(x.pct)} | ${x.gaps} |`),
    `| **${ar ? "الإجمالي" : "Total"}** | ${s.total.earned}/${s.total.possible} | ${pct(s.total.pct)} | ${s.total.gaps} |`,
    "",
    `## ${ar ? "متابعة الفجوات المؤكدة" : "Follow-up on confirmed gaps"}`,
    "",
    `| ${ar ? "الفجوة" : "Gap"} | ${ar ? "الإجراءات" : "Actions"} | ${ar ? "مُبلّغ عنها" : "Reported"} | ${ar ? "بأدلة" : "With evidence"} | ${ar ? "تم التحقق" : "Verified"} |`,
    "|---|---|---|---|---|",
    ...gaps.map(
      (g) => `| ${g.ref ? `${g.ref} ` : ""}${g.findingTitle} | ${g.actions} | ${g.reported} | ${g.evidenced} | ${g.verified} |`,
    ),
  ];
  return snapshotReport(tx, principal, assessment.projectId, {
    title: input.title,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    bodyMd: lines.join("\n"),
  });
}
