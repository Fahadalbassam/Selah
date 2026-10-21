import "server-only";
import type { Tx } from "@/db/client";
import { activityEvents, progressUpdates } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import type { Received } from "@/lib/engagement";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";

/**
 * For a consultant-managed client, firm staff record what the client told
 * them, and say how and when; the database marks it consultant_recorded.
 * Anyone else records their own work and passes nothing.
 */
export function receivedFor(principal: Principal, projectKind: string | undefined, received: Partial<Received> | undefined) {
  const onBehalf = principal.orgKind === "firm" && projectKind === "client";
  if (onBehalf && (!received?.receivedVia || !received.receivedOn)) {
    throw new BadRequestError("say how and when the client told you (receivedVia, receivedOn)");
  }
  return onBehalf ? { receivedVia: received!.receivedVia, receivedOn: received!.receivedOn } : {};
}

/** Add a progress note to an action. Notes are append-only. */
export async function addProgressUpdate(
  tx: Tx,
  principal: Principal,
  actionId: string,
  body: string,
  received?: Partial<Received>,
) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  assertAllowed(principal, "action.read", loaded.resource);
  assertAllowed(principal, "progress_update.create", loaded.resource);
  const { action } = loaded;
  const [row] = await tx
    .insert(progressUpdates)
    .values({
      projectId: action.projectId,
      orgId: action.orgId,
      actionId,
      authorId: principal.userId,
      body,
      ...receivedFor(principal, loaded.resource.projectKind, received),
    })
    .returning({ id: progressUpdates.id });
  await tx.insert(activityEvents).values({
    projectId: action.projectId,
    orgId: action.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: actionId,
    event: "progress_update",
  });
  return { id: row!.id };
}
