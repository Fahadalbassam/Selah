import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actionComments, activityEvents, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";
import { audit } from "./audit";

// The two-way thread on each action (F11). Whoever can see the action reads
// and writes it; mentions reach people who can see it too. The database
// holds the rules (migration action_comments: app_user_sees_action,
// app_action_people, check_action_comment, check_action_comment_change,
// app_notify_action_comment); these calls give clear errors, keep the
// history and tell the people in the thread.

async function actionFor(tx: Tx, principal: Principal, actionId: string) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  assertAllowed(principal, "action.read", loaded.resource);
  return { action: loaded.action, resource: { ...loaded.resource, type: "action_comment", id: undefined } as Resource };
}

/** People the caller can mention on an action: everyone else who can see it. */
export async function actionPeople(tx: Tx, actionId: string) {
  const { rows } = await tx.execute<{ user_id: string; name: string; side: "firm" | "client" }>(
    sql`select user_id, name, side from app_action_people(${actionId}::uuid)`,
  );
  return rows.map((r) => ({ id: r.user_id, name: r.name, side: r.side }));
}

/** The thread, oldest first, with who may write and the people they may mention. */
export async function actionThread(tx: Tx, principal: Principal, actionId: string) {
  const { resource } = await actionFor(tx, principal, actionId);
  assertAllowed(principal, "action_comment.read", resource);
  const author = alias(user, "author");
  const rows = await tx
    .select({
      id: actionComments.id,
      body: actionComments.body,
      mentions: actionComments.mentions,
      authorId: actionComments.authorId,
      authorName: author.name,
      removedAt: actionComments.removedAt,
      createdAt: actionComments.createdAt,
    })
    .from(actionComments)
    .innerJoin(author, eq(author.id, actionComments.authorId))
    .where(eq(actionComments.actionId, actionId))
    .orderBy(asc(actionComments.createdAt));
  const canWrite = authorize(principal, "action_comment.create", resource).allowed;
  const people = await actionPeople(tx, actionId);
  // Names of people mentioned, as far as the caller can see them.
  const ids = [...new Set(rows.flatMap((r) => r.mentions))];
  const names = new Map(people.map((p) => [p.id, p.name]));
  const unknown = ids.filter((id) => !names.has(id) && id !== principal.userId);
  if (unknown.length) {
    const found = await tx
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(sql`${user.id} = any(${sql.param(unknown)}::uuid[])`);
    for (const f of found) names.set(f.id, f.name);
  }
  const removeAllowed = authorize(principal, "action_comment.remove", resource).allowed;
  return {
    comments: rows.map((r) => ({
      ...r,
      mine: r.authorId === principal.userId,
      mentioned: r.mentions.map((id) => (id === principal.userId ? { id, name: null, you: true } : { id, name: names.get(id) ?? null, you: false })),
      can: { remove: removeAllowed && r.authorId === principal.userId && !r.removedAt },
    })),
    people: canWrite ? people : [],
    can: { write: canWrite },
  };
}

/** Write on the action's thread, and tell the people in it. */
export async function postComment(tx: Tx, principal: Principal, actionId: string, input: { body: string; mentions?: string[] }) {
  const { action, resource } = await actionFor(tx, principal, actionId);
  assertAllowed(principal, "action_comment.create", resource);
  const body = input.body.trim();
  if (!body) throw new BadRequestError("a comment needs text");
  const mentions = [...new Set(input.mentions ?? [])];
  if (mentions.length) {
    const people = new Set((await actionPeople(tx, actionId)).map((p) => p.id));
    if (mentions.some((m) => !people.has(m))) throw new BadRequestError("a comment mentions only other people who can see the action");
  }
  const [row] = await tx
    .insert(actionComments)
    .values({ projectId: action.projectId, orgId: action.orgId, actionId, authorId: principal.userId, body, mentions })
    .returning({ id: actionComments.id });
  await tx.insert(activityEvents).values({
    projectId: action.projectId,
    orgId: action.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: actionId,
    event: "commented",
    meta: { commentId: row!.id },
  });
  await tx.execute(sql`select app_notify_action_comment(${row!.id}::uuid)`);
  return { id: row!.id };
}

/** The author takes back their own comment. The row stays, marked removed; the text goes. */
export async function removeComment(tx: Tx, principal: Principal, commentId: string) {
  const [c] = await tx
    .select({ id: actionComments.id, actionId: actionComments.actionId, authorId: actionComments.authorId, removedAt: actionComments.removedAt })
    .from(actionComments)
    .where(eq(actionComments.id, commentId))
    .limit(1);
  if (!c) throw new NotFoundError("comment");
  const { action, resource } = await actionFor(tx, principal, c.actionId);
  assertAllowed(principal, "action_comment.remove", resource);
  if (c.authorId !== principal.userId) throw new NotFoundError("comment");
  if (c.removedAt) throw new BadRequestError("this comment was already removed");
  await tx.update(actionComments).set({ removedAt: new Date() }).where(eq(actionComments.id, commentId));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "action_comment.remove",
    resourceType: "action_comment",
    resourceId: commentId,
    outcome: "allow",
    meta: { actionId: action.id },
  });
  return { id: commentId };
}
