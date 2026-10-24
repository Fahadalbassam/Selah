import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { pulseAnswers, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal } from "@/authz";
import { average } from "@/lib/pulse";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// The closing pulse (F36, migration: Closing pulse). The database decides who
// is asked, until when, and who reads the answers; these calls check the same
// permissions first and write the audit trail. Answers are never in the
// audit meta (AuditEntry: ids and counts only).

async function value<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T | null> {
  const { rows } = await tx.execute<{ v: T | null }>(query);
  return rows[0]?.v ?? null;
}

/** The pulse on a closed client project, for whoever is looking; null when there is none to show. */
export async function getPulse(tx: Tx, principal: Principal, projectId: string) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  if (project.kind !== "client") return null;

  const until = await value<Date | string>(tx, sql`select app_pulse_until(${projectId}) as v`);
  const canAnswer =
    authorize(principal, "pulse.answer", resource).allowed && (await value<boolean>(tx, sql`select app_can_answer_pulse(${projectId}) as v`)) === true;
  const canRead =
    authorize(principal, "pulse.read", resource).allowed && (await value<boolean>(tx, sql`select app_can_read_pulse(${projectId}) as v`)) === true;

  // RLS returns a client person's own row only, and every row to those who read them.
  const rows = await tx
    .select({
      userId: pulseAnswers.userId,
      name: user.name,
      metAgreement: pulseAnswers.metAgreement,
      responsive: pulseAnswers.responsive,
      selfReliant: pulseAnswers.selfReliant,
      comment: pulseAnswers.comment,
      updatedAt: pulseAnswers.updatedAt,
    })
    .from(pulseAnswers)
    .innerJoin(user, eq(user.id, pulseAnswers.userId))
    .where(eq(pulseAnswers.projectId, projectId))
    .orderBy(asc(pulseAnswers.createdAt));

  const mine = rows.find((r) => r.userId === principal.userId) ?? null;
  // The firm sees it once the project has closed (or answers remain after reopening), never while it is still closing.
  if (!canAnswer && !mine && !(canRead && (until !== null || rows.length > 0))) return null;

  const results = canRead
    ? {
        invited: (await value<number>(tx, sql`select app_pulse_invited(${projectId}) as v`)) ?? 0,
        averages: {
          metAgreement: average(rows.map((r) => r.metAgreement)),
          responsive: average(rows.map((r) => r.responsive)),
          selfReliant: average(rows.map((r) => r.selfReliant)),
        },
        answers: rows,
      }
    : null;

  return {
    /** Open until (null: the project is not closed, so nothing is asked now). */
    openUntil: until ? new Date(until) : null,
    /** Still taking answers (the window has not run out). */
    open: until ? new Date(until).getTime() > Date.now() : false,
    mine: mine
      ? { metAgreement: mine.metAgreement, responsive: mine.responsive, selfReliant: mine.selfReliant, comment: mine.comment, updatedAt: mine.updatedAt }
      : null,
    results,
    can: { answer: canAnswer, read: canRead },
  };
}

export type PulseView = NonNullable<Awaited<ReturnType<typeof getPulse>>>;

/** Answer the pulse, or change the answer while it is open. */
export async function answerPulse(
  tx: Tx,
  principal: Principal,
  projectId: string,
  input: { metAgreement: number; responsive: number; selfReliant: number; comment?: string | null },
) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "pulse.answer", resource);
  const [before] = await tx.select({ id: pulseAnswers.id }).from(pulseAnswers).where(sql`${pulseAnswers.projectId} = ${projectId} and ${pulseAnswers.userId} = ${principal.userId}`);
  await tx.execute(
    sql`select app_answer_pulse(${projectId}, ${input.metAgreement}::integer, ${input.responsive}::integer, ${input.selfReliant}::integer, ${input.comment ?? null})`,
  );
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "pulse.answer",
    resourceType: "project",
    resourceId: projectId,
    outcome: "allow",
    meta: { changed: !!before },
  });
  return getPulse(tx, principal, projectId);
}
