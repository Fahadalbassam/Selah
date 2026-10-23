import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { followUps, orgMemberships, projects, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal } from "@/authz";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// Handover (baseline: Handover): the day the report was
// delivered and the client's sponsor. Setting the date creates the firm's
// check-ins (firm_settings.checkin_days); moving it moves the open ones.
// The firm admin sets both; the database checks the sponsor. The firm admin
// also closes the project when the engagement is over.

export async function getHandover(tx: Tx, principal: Principal, projectId: string) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  const [row] = await tx
    .select({
      handoverOn: projects.handoverOn,
      sponsorId: projects.clientSponsorUserId,
      sponsorName: user.name,
      state: projects.state,
      closedAt: projects.closedAt,
    })
    .from(projects)
    .leftJoin(user, eq(user.id, projects.clientSponsorUserId))
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
  // Who can be the sponsor: the client's active admins and managers.
  const sponsors =
    edit && project.kind === "client"
      ? await tx
          .select({ id: user.id, name: user.name })
          .from(orgMemberships)
          .innerJoin(user, eq(user.id, orgMemberships.userId))
          .where(
            and(
              eq(orgMemberships.orgId, project.orgId),
              eq(orgMemberships.active, true),
              inArray(orgMemberships.role, ["client_admin", "client_manager"]),
            ),
          )
          .orderBy(asc(user.name))
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
    sponsor: row?.sponsorId ? { id: row.sponsorId, name: row.sponsorName } : null,
    checkins: checkins.map(({ assigneeUserId, ...c }) => ({
      ...c,
      canComplete: writeCheckins || assigneeUserId === principal.userId,
    })),
    sponsors,
    can: { edit },
  };
}

export async function setHandover(
  tx: Tx,
  principal: Principal,
  projectId: string,
  input: { handoverOn?: string; sponsorUserId?: string | null },
) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "project.update", resource);
  const change: Partial<typeof projects.$inferInsert> = {};
  if (input.handoverOn !== undefined) change.handoverOn = input.handoverOn;
  if (input.sponsorUserId !== undefined) change.clientSponsorUserId = input.sponsorUserId;
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
