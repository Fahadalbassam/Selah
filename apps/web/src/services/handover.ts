import "server-only";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { followUps, projects, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal } from "@/authz";
import { audit } from "./audit";
import { sponsorOf } from "./client-roles";
import { loadProject } from "./staffing";

// Handover (baseline: Handover): the day the report was delivered. Setting
// the date creates the firm's check-ins (firm_settings.checkin_days); moving
// it moves the open ones. The firm admin sets it, and closes the project when
// the engagement is over. The client's sponsor is shown here and named with
// the other client roles (services/client-roles.ts).

export async function getHandover(tx: Tx, principal: Principal, projectId: string) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  const [row] = await tx
    .select({
      handoverOn: projects.handoverOn,
      state: projects.state,
      closedAt: projects.closedAt,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  const edit = authorize(principal, "project.update", resource).allowed;
  // Check-ins are firm tasks (firm-private); row-level security hides them from clients.
  const checkins = authorize(principal, "follow_up.read", { ...resource, type: "follow_up", visibility: "firm_private" }).allowed
    ? await tx
        .select({
          id: followUps.id,
          day: followUps.checkinDay,
          dueAt: followUps.dueAt,
          status: followUps.status,
          assigneeUserId: followUps.assigneeUserId,
          assignee: user.name,
        })
        .from(followUps)
        .leftJoin(user, eq(user.id, followUps.assigneeUserId))
        .where(and(eq(followUps.projectId, projectId), isNotNull(followUps.checkinDay)))
        .orderBy(asc(followUps.checkinDay))
    : [];
  const writeCheckins = authorize(principal, "follow_up.write", {
    ...resource,
    type: "follow_up",
    visibility: "firm_private",
  }).allowed;
  return {
    kind: project.kind,
    handoverOn: row?.handoverOn ?? null,
    state: row?.state ?? "planned",
    closedAt: row?.closedAt ?? null,
    sponsor: project.kind === "client" ? await sponsorOf(tx, projectId) : null,
    checkins: checkins.map(({ assigneeUserId, ...c }) => ({
      ...c,
      canComplete: writeCheckins || assigneeUserId === principal.userId,
    })),
    can: { edit },
  };
}

export async function setHandover(
  tx: Tx,
  principal: Principal,
  projectId: string,
  input: { handoverOn?: string },
) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "project.update", resource);
  const change: Partial<typeof projects.$inferInsert> = {};
  if (input.handoverOn !== undefined) change.handoverOn = input.handoverOn;
  if (Object.keys(change).length) {
    await tx.update(projects).set(change).where(eq(projects.id, projectId));
    await audit(tx, {
      actorId: principal.userId,
      orgId: principal.orgId,
      action: "project.handover",
      resourceType: "project",
      resourceId: projectId,
      outcome: "allow",
      meta: { fields: Object.keys(input).join(",") },
    });
  }
  return getHandover(tx, principal, projectId);
}

/**
 * Firm admin: close a project when the engagement is over, or reopen it.
 * The database stamps closed_at; assistant chats about the project are
 * deleted a while after it (firm_settings.chat_after_close_days).
 */
export async function setProjectState(tx: Tx, principal: Principal, projectId: string, state: "active" | "closed") {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "project.update", resource);
  await tx.update(projects).set({ state }).where(eq(projects.id, projectId));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: state === "closed" ? "project.close" : "project.reopen",
    resourceType: "project",
    resourceId: projectId,
    outcome: "allow",
  });
  return getHandover(tx, principal, projectId);
}
