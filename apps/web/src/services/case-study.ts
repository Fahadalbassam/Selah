import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { caseStudyConsents, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal } from "@/authz";
import type { CaseStudyLevel } from "@/lib/case-study";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// Case-study consent (F37, migration: Case-study consent). The database
// decides who gives, records and withdraws it and keeps every record; these
// calls check the same permissions first and write the audit trail.

async function bool(tx: Tx, query: ReturnType<typeof sql>): Promise<boolean> {
  const { rows } = await tx.execute<{ ok: boolean }>(query);
  return rows[0]?.ok === true;
}

const revoker = alias(user, "revoker");

/** The consent on a client project and its history; null when there is nothing to show. */
export async function getCaseStudyConsent(tx: Tx, principal: Principal, projectId: string) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  if (project.kind !== "client" || !authorize(principal, "case_study.read", resource).allowed) return null;

  const records = await tx
    .select({
      id: caseStudyConsents.id,
      level: caseStudyConsents.level,
      testimonial: caseStudyConsents.testimonial,
      conditions: caseStudyConsents.conditions,
      recordedByFirm: caseStudyConsents.recordedByFirm,
      sourceNote: caseStudyConsents.sourceNote,
      givenBy: user.name,
      givenAt: caseStudyConsents.givenAt,
      revokedBy: revoker.name,
      revokedAt: caseStudyConsents.revokedAt,
    })
    .from(caseStudyConsents)
    .leftJoin(user, eq(user.id, caseStudyConsents.givenBy))
    .leftJoin(revoker, eq(revoker.id, caseStudyConsents.revokedBy))
    .where(eq(caseStudyConsents.projectId, projectId))
    .orderBy(desc(caseStudyConsents.givenAt), desc(caseStudyConsents.id));

  const closingOrClosed = project.state === "closing" || project.state === "closed";
  if (!closingOrClosed && records.length === 0) return null;

  const firm = principal.orgKind === "firm";
  const canRecord =
    authorize(principal, "case_study.consent", resource).allowed && (await bool(tx, sql`select app_can_record_case_study(${projectId}) as ok`));
  const canRevoke =
    authorize(principal, "case_study.revoke", resource).allowed && (await bool(tx, sql`select app_can_revoke_case_study(${projectId}) as ok`));

  const latest = records[0] ?? null;
  return {
    /** The record in force; null means "none" (never asked, or withdrawn). */
    current: latest && !latest.revokedAt ? latest : null,
    /** The latest record, withdrawn or not, so the screen can say "withdrawn on". */
    latest,
    history: records,
    can: {
      // The client gives or changes it; the firm admin records one given outside Selah.
      give: canRecord && !firm,
      record: canRecord && firm,
      revoke: canRevoke,
    },
  };
}

export type CaseStudyView = NonNullable<Awaited<ReturnType<typeof getCaseStudyConsent>>>;

/** Give (client sponsor or admin) or record (firm admin, with where it came from) a consent. */
export async function recordCaseStudyConsent(
  tx: Tx,
  principal: Principal,
  projectId: string,
  input: { level: CaseStudyLevel; testimonial: boolean; conditions?: string | null; sourceNote?: string | null },
) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "case_study.consent", resource);
  const firm = principal.orgKind === "firm";
  await tx.execute(
    sql`select app_record_case_study(${projectId}, ${input.level}::case_study_level, ${input.testimonial}, ${input.conditions ?? null}, ${firm ? (input.sourceNote ?? null) : null})`,
  );
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "case_study.consent",
    resourceType: "project",
    resourceId: projectId,
    outcome: "allow",
    meta: { level: input.level, testimonial: input.testimonial, recordedByFirm: firm },
  });
  return getCaseStudyConsent(tx, principal, projectId);
}

/** The client's sponsor or admin withdraws the consent in force. */
export async function revokeCaseStudyConsent(tx: Tx, principal: Principal, projectId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "case_study.revoke", resource);
  await tx.execute(sql`select app_revoke_case_study(${projectId})`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "case_study.revoke",
    resourceType: "project",
    resourceId: projectId,
    outcome: "allow",
  });
  return getCaseStudyConsent(tx, principal, projectId);
}
