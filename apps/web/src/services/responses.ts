import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, activityEvents, findings, organizations, projects, recommendationResponses, recommendations, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { firmToday } from "@/lib/dates";
import type { Received } from "@/lib/engagement";
import { STANCE_NEEDS, type Stance, type StanceState } from "@/lib/responses";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { receivedFor } from "./progress";

// The client's formal response to each recommendation (F10, IIA 14.4): it
// agrees, partly agrees or disagrees, with the reason, and (agreeing) says
// what it will do and by when. A response is a record of what the client
// said, never a judgement Selah makes. The database holds the rules
// (migration recommendation_responses: app_can_respond, check_recommendation_response,
// check_recommendation_response_change, app_recommendation_stances); these
// calls give clear errors, keep the history and tell the other side.

async function loadRecommendation(tx: Tx, principal: Principal, id: string) {
  const [r] = await tx
    .select({
      rec: recommendations,
      projectTitle: projects.title,
      projectKind: projects.kind,
      projectState: projects.state,
      firmOrgId: projects.firmOrgId,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
      mode: organizations.engagementMode,
    })
    .from(recommendations)
    .innerJoin(projects, eq(projects.id, recommendations.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(eq(recommendations.id, id))
    .limit(1);
  // Row-level security hides a firm-only recommendation from the client: unknown and hidden look the same.
  if (!r) throw new NotFoundError("recommendation");
  const owners = await tx
    .select({ ownerUserId: actions.ownerUserId })
    .from(actions)
    .where(eq(actions.recommendationId, id));
  const resource: Resource = {
    type: "recommendation",
    id: r.rec.id,
    orgId: r.rec.orgId,
    firmOrgId: r.firmOrgId,
    projectId: r.rec.projectId,
    projectKind: r.projectKind,
    clientOrgId: r.projectKind === "client" ? r.rec.orgId : undefined,
    visibility: r.rec.visibility,
    createdBy: r.rec.createdBy,
    assignees: owners.flatMap((o) => (o.ownerUserId ? [o.ownerUserId] : [])),
  };
  if (!authorize(principal, "recommendation.read", resource).allowed) throw new NotFoundError("recommendation");
  return { ...r, resource };
}

async function canRespond(tx: Tx, id: string) {
  const { rows } = await tx.execute<{ ok: boolean }>(sql`select app_can_respond(${id}::uuid) as ok`);
  return rows[0]?.ok === true;
}

/** Where each of a project's released recommendations stands with the client. */
export async function recommendationStances(tx: Tx, projectId: string) {
  const { rows } = await tx.execute<{ recommendation_id: string; stance: StanceState; response_id: string | null; responded_at: string | null }>(
    sql`select recommendation_id, stance, response_id, responded_at from app_recommendation_stances(${projectId}::uuid)`,
  );
  return new Map(
    rows.map((r) => [r.recommendation_id, { stance: r.stance, responseId: r.response_id, at: r.responded_at ? new Date(r.responded_at) : null }]),
  );
}

/** A recommendation with what answers it, its actions, and the client's responses. */
export async function getRecommendation(tx: Tx, principal: Principal, id: string) {
  const loaded = await loadRecommendation(tx, principal, id);
  const { rec, resource } = loaded;
  const recorder = alias(user, "recorder");
  const confirmer = alias(user, "confirmer");
  const replier = alias(user, "replier");
  const responses = await tx
    .select({
      id: recommendationResponses.id,
      stance: recommendationResponses.stance,
      reason: recommendationResponses.reason,
      plannedAction: recommendationResponses.plannedAction,
      actionOwner: recommendationResponses.actionOwner,
      targetDate: recommendationResponses.targetDate,
      source: recommendationResponses.source,
      receivedVia: recommendationResponses.receivedVia,
      receivedOn: recommendationResponses.receivedOn,
      recordedBy: recommendationResponses.recordedBy,
      recordedByName: recorder.name,
      confirmedByName: confirmer.name,
      confirmedAt: recommendationResponses.confirmedAt,
      firmReply: recommendationResponses.firmReply,
      repliedByName: replier.name,
      repliedAt: recommendationResponses.repliedAt,
      createdAt: recommendationResponses.createdAt,
    })
    .from(recommendationResponses)
    .leftJoin(recorder, eq(recorder.id, recommendationResponses.recordedBy))
    .leftJoin(confirmer, eq(confirmer.id, recommendationResponses.confirmedBy))
    .leftJoin(replier, eq(replier.id, recommendationResponses.repliedBy))
    .where(eq(recommendationResponses.recommendationId, id))
    .orderBy(desc(recommendationResponses.createdAt));
  const finding = rec.findingId
    ? (await tx.select({ id: findings.id, title: findings.title }).from(findings).where(eq(findings.id, rec.findingId)).limit(1))[0] ?? null
    : null;
  const owner = alias(user, "owner");
  const recActions = await tx
    .select({
      id: actions.id,
      title: actions.title,
      status: actions.status,
      dueDate: actions.dueDate,
      ownerName: sql<string | null>`coalesce(${owner.name}, ${actions.ownerName})`,
    })
    .from(actions)
    .leftJoin(owner, eq(owner.id, actions.ownerUserId))
    .where(eq(actions.recommendationId, id))
    .orderBy(asc(actions.createdAt));
  const stance = rec.visibility === "shared" ? (await recommendationStances(tx, rec.projectId)).get(id) ?? null : null;
  const review = authorize(principal, "recommendation_response.review", resource).allowed;
  return {
    recommendation: rec,
    context: {
      projectTitle: loaded.projectTitle,
      projectKind: loaded.projectKind,
      projectState: loaded.projectState,
      orgName: loaded.orgName,
      orgNameAr: loaded.orgNameAr,
      mode: loaded.mode,
    },
    finding,
    actions: recActions,
    stance,
    responses: responses.map((r) => ({
      ...r,
      can: {
        // A colleague other than the one who recorded it (the database checks the same).
        confirm: review && r.source === "consultant_recorded" && !r.confirmedAt && r.recordedBy !== principal.userId,
        reply: review && !r.firmReply,
      },
    })),
    can: {
      respond: authorize(principal, "recommendation.respond", resource).allowed && (await canRespond(tx, id)),
      // The firm records what a consultant-managed client said, and how it heard it.
      onBehalf: principal.orgKind === "firm",
    },
    firmStaff: principal.orgKind === "firm",
  };
}

export interface ResponseInput {
  stance: Stance;
  reason?: string | null;
  plannedAction?: string | null;
  actionOwner?: string | null;
  targetDate?: string | null;
  receivedVia?: Received["receivedVia"];
  receivedOn?: string;
}

/** Record the client's response. A new one replaces the last as where the recommendation stands; earlier ones stay on record. */
export async function recordResponse(tx: Tx, principal: Principal, id: string, input: ResponseInput) {
  const { rec, resource, projectKind } = await loadRecommendation(tx, principal, id);
  assertAllowed(principal, "recommendation.respond", resource);
  const needs = STANCE_NEEDS[input.stance];
  const plannedAction = needs.plan ? input.plannedAction?.trim() || null : null;
  const targetDate = needs.plan ? input.targetDate || null : null;
  const reason = needs.reason ? input.reason?.trim() || null : input.reason?.trim() || null;
  if (needs.plan && (!plannedAction || !targetDate)) throw new BadRequestError("agreeing needs the planned action and its date");
  if (needs.reason && !reason) throw new BadRequestError("partly agreeing or disagreeing needs the reason");
  if (targetDate && targetDate < firmToday()) throw new BadRequestError("the target date is in the past");
  if (!(await canRespond(tx, id))) throw new ConflictError("this recommendation can't take a response from you now");
  const [row] = await tx
    .insert(recommendationResponses)
    .values({
      projectId: rec.projectId,
      orgId: rec.orgId,
      recommendationId: id,
      stance: input.stance,
      reason,
      plannedAction,
      actionOwner: needs.plan ? input.actionOwner?.trim() || null : null,
      targetDate,
      recordedBy: principal.userId,
      ...receivedFor(principal, projectKind, input),
    })
    .returning({ id: recommendationResponses.id });
  await history(tx, principal, rec, "responded", row!.id, { stance: input.stance });
  await tx.execute(sql`select app_notify_recommendation(${id}::uuid, 'recommendation.responded')`);
  return { id: row!.id };
}

async function loadResponse(tx: Tx, principal: Principal, responseId: string) {
  const [r] = await tx
    .select({ id: recommendationResponses.id, recommendationId: recommendationResponses.recommendationId })
    .from(recommendationResponses)
    .where(eq(recommendationResponses.id, responseId))
    .limit(1);
  if (!r) throw new NotFoundError("response");
  const loaded = await loadRecommendation(tx, principal, r.recommendationId);
  assertAllowed(principal, "recommendation_response.review", loaded.resource);
  return loaded;
}

/** A colleague confirms a response the firm recorded for a consultant-managed client. Until then it doesn't count. */
export async function confirmResponse(tx: Tx, principal: Principal, responseId: string) {
  const { rec } = await loadResponse(tx, principal, responseId);
  const done = await tx
    .update(recommendationResponses)
    .set({ confirmedBy: principal.userId, confirmedAt: new Date() })
    .where(eq(recommendationResponses.id, responseId))
    .returning({ id: recommendationResponses.id });
  if (!done.length) throw new NotFoundError("response");
  await history(tx, principal, rec, "response_confirmed", responseId);
  return { id: responseId };
}

/** The firm's answer to a response, once: for a disagreement, what the firm makes of the reason. */
export async function replyToResponse(tx: Tx, principal: Principal, responseId: string, input: { reply: string }) {
  const { rec } = await loadResponse(tx, principal, responseId);
  const done = await tx
    .update(recommendationResponses)
    .set({ firmReply: input.reply, repliedBy: principal.userId, repliedAt: new Date() })
    .where(eq(recommendationResponses.id, responseId))
    .returning({ id: recommendationResponses.id });
  if (!done.length) throw new NotFoundError("response");
  await history(tx, principal, rec, "response_answered", responseId);
  await tx.execute(sql`select app_notify_recommendation(${rec.id}::uuid, 'recommendation.answered')`);
  return { id: responseId };
}

async function history(
  tx: Tx,
  principal: Principal,
  rec: { id: string; projectId: string; orgId: string },
  event: string,
  responseId: string,
  meta: Record<string, string> = {},
) {
  await tx.insert(activityEvents).values({
    projectId: rec.projectId,
    orgId: rec.orgId,
    actorId: principal.userId,
    entityType: "recommendation",
    entityId: rec.id,
    event,
    meta: { responseId, ...meta },
  });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: `recommendation.${event}`,
    resourceType: "recommendation_response",
    resourceId: responseId,
    outcome: "allow",
    meta: { recommendationId: rec.id, ...meta },
  });
}
