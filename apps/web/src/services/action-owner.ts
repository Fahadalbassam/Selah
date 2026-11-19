import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, activityEvents, orgMemberships, organizations, projectMembers, user } from "@/db/schema";
import { assertAllowed, authorize, ForbiddenError, type Principal } from "@/authz";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";
import { audit } from "./audit";

// Giving one open action to a colleague (decision D1, batch 4). The firm's
// staff on the project (not observers) may; on the client's side the
// company's admin and the project's coordinator and sponsor. The status does
// not change. One rule in the database decides who may
// (app_can_change_owner(), migration 0101), the update trigger enforces it,
// and app_tell_owner_changed() tells the new owner, the old owner (on the
// project: they no longer read the action), the client's lead and deputy and
// the consultants staffed on the project. One audit row, with ids only (a
// minimal-records client's owner is a typed job title, never stored there).

/** What the owner control offers this reader, or null when they may not change the owner. */
export interface OwnerControl {
  /** A person on the project, or (a client the firm runs) a typed name or job title. */
  mode: "person" | "typed";
  /** Colleagues on the project, of the action's own organisation, active, not observing; never the current owner. */
  people: { id: string; name: string }[];
  /** A minimal-records client: the name is a job title, never a person's name. */
  minimal: boolean;
  /** The client's admin may first add a colleague to the project on its People tab. */
  canAddToProject: boolean;
  current: { userId: string | null; name: string | null };
}

/** The database's one rule (app_can_change_owner): may this caller change who owns the action now? */
export async function canChangeOwner(tx: Tx, actionId: string) {
  const { rows } = await tx.execute<{ ok: boolean }>(sql`select app_can_change_owner(${actionId}::uuid) as ok`);
  return rows[0]?.ok === true;
}

async function load(tx: Tx, principal: Principal, actionId: string) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  assertAllowed(principal, "action.read", loaded.resource);
  const [org] = await tx
    .select({ mode: organizations.engagementMode, minimal: organizations.minimalRecords })
    .from(organizations)
    .where(eq(organizations.id, loaded.action.orgId));
  return { ...loaded, typed: org?.mode === "consultant_managed", minimal: org?.minimal ?? false };
}

/** The control on the action page, built only for someone the database lets change the owner. */
export async function ownerControl(tx: Tx, principal: Principal, actionId: string): Promise<OwnerControl | null> {
  const { action, resource, typed, minimal } = await load(tx, principal, actionId);
  if (!authorize(principal, "action.assign_owner", resource).allowed) return null;
  if (!(await canChangeOwner(tx, actionId))) return null;
  // A typed name is the firm's to write (it edits the plan); the client has accounts.
  if (typed && principal.orgKind !== "firm") return null;
  const people = minimal
    ? []
    : await tx
        .select({ id: user.id, name: user.name })
        .from(projectMembers)
        .innerJoin(user, eq(user.id, projectMembers.userId))
        .innerJoin(
          orgMemberships,
          and(eq(orgMemberships.userId, projectMembers.userId), eq(orgMemberships.orgId, action.orgId), eq(orgMemberships.active, true)),
        )
        .where(
          and(
            eq(projectMembers.projectId, action.projectId),
            eq(projectMembers.observer, false),
            action.ownerUserId ? ne(projectMembers.userId, action.ownerUserId) : undefined,
          ),
        )
        .orderBy(asc(user.name));
  return {
    mode: typed ? "typed" : "person",
    people,
    minimal,
    canAddToProject: principal.role === "client_admin" || principal.role === "firm_admin",
    current: { userId: action.ownerUserId, name: action.ownerName },
  };
}

export interface OwnerInput {
  ownerUserId?: string;
  /** A client the firm runs: the owner's name, or on a minimal-records client their job title. */
  ownerName?: string;
}

/**
 * Give the action to someone else. Refused (404) to anyone who may not; a
 * person must be an active colleague on the project (the database checks it:
 * check_action_owner), a typed name only on a client the firm runs.
 */
export async function changeActionOwner(tx: Tx, principal: Principal, actionId: string, input: OwnerInput) {
  const { action, resource, typed } = await load(tx, principal, actionId);
  assertAllowed(principal, "action.assign_owner", resource);
  if (!(await canChangeOwner(tx, actionId))) throw new ForbiddenError("action.assign_owner", resource, "owner:not-allowed");
  const ownerUserId = input.ownerUserId ?? null;
  const ownerName = input.ownerName?.trim() || null;
  if (!ownerUserId === !ownerName) throw new BadRequestError("give an owner or an owner's name, not both");
  if (ownerName) {
    if (!typed) throw new BadRequestError("an owner's name is for clients the firm manages; pick a person on the project");
    // Writing a typed name edits the plan: the firm's (the database refuses it from a client too).
    assertAllowed(principal, "action.write", resource);
  }
  if (ownerUserId && ownerUserId === action.ownerUserId) throw new BadRequestError("this person already owns the action");
  if (ownerName && !action.ownerUserId && ownerName === action.ownerName) throw new BadRequestError("this is already the action's owner");
  if (ownerUserId) {
    const [m] = await tx
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .innerJoin(orgMemberships, and(eq(orgMemberships.userId, projectMembers.userId), eq(orgMemberships.orgId, action.orgId), eq(orgMemberships.active, true)))
      .where(and(eq(projectMembers.projectId, action.projectId), eq(projectMembers.userId, ownerUserId), eq(projectMembers.observer, false)))
      .limit(1);
    if (!m) throw new BadRequestError("the owner must be on the project team");
  }
  // The status is the one read above: the owner changes, nothing else does.
  const updated = await tx
    .update(actions)
    .set({ ownerUserId, ownerName })
    .where(and(eq(actions.id, actionId), eq(actions.status, action.status)))
    .returning({ id: actions.id });
  if (!updated.length) throw new ConflictError("the action changed; reload and try again");
  await recordOwnerChange(tx, principal, action, { ownerUserId, ownerName });
  return { id: actionId };
}

/**
 * After the owner changed (here or in the firm's edit dialog): the history
 * line, the notices and the audit row. Ids only in the audit row; a typed
 * name is "typed", never the name.
 */
export async function recordOwnerChange(
  tx: Tx,
  principal: Principal,
  before: { id: string; projectId: string; orgId: string; ownerUserId: string | null; ownerName: string | null },
  after: { ownerUserId: string | null; ownerName: string | null },
) {
  const side = (o: { ownerUserId: string | null; ownerName: string | null }) => o.ownerUserId ?? (o.ownerName ? "typed" : null);
  const meta = { from: side(before), to: side(after) };
  await tx.insert(activityEvents).values({
    projectId: before.projectId,
    orgId: before.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: before.id,
    event: "owner_changed",
    // The history line names the new owner; a typed one by its title, which the record keeps anyway.
    meta: after.ownerName ? { ...meta, toName: after.ownerName } : meta,
  });
  await tx.execute(sql`select app_tell_owner_changed(${before.id}::uuid, ${before.ownerUserId}::uuid)`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "action.owner_change",
    resourceType: "action",
    resourceId: before.id,
    outcome: "allow",
    meta,
  });
}

/**
 * "Reassign their actions first" on a project's People tab (review S3): the
 * person's open actions on this project, each with the owner control, for
 * whoever may give each one to a colleague. Read under the reader's own rules,
 * so an action they cannot open is not there; empty for anyone who may not
 * reassign. It never opens the switch-off dialog's hand-over of everything.
 */
export async function reassignList(tx: Tx, principal: Principal, projectId: string, ownerUserId: string) {
  const rows = await tx
    .select({ id: actions.id, title: actions.title })
    .from(actions)
    .where(
      and(
        eq(actions.projectId, projectId),
        eq(actions.ownerUserId, ownerUserId),
        sql`${actions.status} in ('draft', 'assigned', 'in_progress', 'blocked', 'awaiting_review', 'revision_requested')`,
      ),
    )
    .orderBy(asc(actions.title));
  const out: { id: string; title: string; control: OwnerControl }[] = [];
  for (const r of rows) {
    const control = await ownerControl(tx, principal, r.id).catch(() => null);
    if (control) out.push({ ...r, control });
  }
  return out;
}
