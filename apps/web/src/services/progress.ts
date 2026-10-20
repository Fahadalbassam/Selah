import "server-only";
import type { Tx } from "@/db/client";
import { activityEvents, progressUpdates } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import { NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";

/** Add a progress note to an action. Notes are append-only. */
export async function addProgressUpdate(tx: Tx, principal: Principal, actionId: string, body: string) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  assertAllowed(principal, "action.read", loaded.resource);
  assertAllowed(principal, "progress_update.create", loaded.resource);
  const { action } = loaded;
  const [row] = await tx
    .insert(progressUpdates)
    .values({ projectId: action.projectId, orgId: action.orgId, actionId, authorId: principal.userId, body })
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
