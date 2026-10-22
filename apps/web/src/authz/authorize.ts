import { grantFor, type Permission, type Scope } from "./policy";
import type { Decision, Principal, Resource } from "./types";

/**
 * THE authorization check. Every API route, download, export, search,
 * notification and AI retrieval goes through this function (via services).
 *
 * It asks the five questions from the spec in order; the first "no" denies:
 *   1. Organization - is the record in the user's tenant (or, for firm
 *      staff, in a project their firm runs)?
 *   2. Role         - does the role hold this permission at all?
 *   3. Membership   - is the user a member of the record's project, or (for
 *                     consultants) assigned to its client?
 *   4. Assignment   - does the grant's scope (assigned / own / shared /
 *                     owner_org / lead / team) cover this record?
 *   5. Label        - does the visibility label allow this user?
 *
 * Pure function: no I/O, so it is cheap to call and easy to test exhaustively.
 */
export function authorize(principal: Principal, permission: Permission, resource: Resource): Decision {
  const org = checkOrganization(principal, resource);
  if (!org.allowed) return org;

  const scope = grantFor(permission, principal.role, resource.projectKind, resource.engagementMode);
  if (!scope) return deny(`role:${principal.role} lacks ${permission}`);

  const membership = checkMembership(principal, resource);
  if (!membership.allowed) return membership;

  if (!scopeCovers(scope, principal, resource)) return deny(`scope:${scope}`);

  const label = checkLabel(principal, resource);
  if (!label.allowed) return label;

  return { allowed: true, reason: "ok" };
}

export class ForbiddenError extends Error {
  constructor(
    readonly permission: Permission,
    readonly resource: Resource,
    readonly reason: string,
  ) {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}

/** authorize() that throws. The HTTP layer turns the error into a 404. */
export function assertAllowed(principal: Principal, permission: Permission, resource: Resource): void {
  const decision = authorize(principal, permission, resource);
  if (!decision.allowed) throw new ForbiddenError(permission, resource, decision.reason);
}

// ------------------------------------------------------------------ steps

function checkOrganization(p: Principal, r: Resource): Decision {
  if (p.orgKind === "client") {
    return r.orgId === p.orgId ? ok : deny("org:other-tenant");
  }
  // firm staff reach client records only through an project their org
  // runs. Org-level records (the firm org itself, or a client org) must
  // also carry the firm org id that links them.
  if (r.firmOrgId === undefined) return deny("org:no-firm-link");
  return r.firmOrgId === p.orgId ? ok : deny("org:other-firm-org");
}

function checkMembership(p: Principal, r: Resource): Decision {
  // A consultant is on a client's team only when assigned to it.
  const onClientTeam = p.role === "consultant" && r.orgId !== p.orgId && p.assignedClientIds.has(r.orgId);

  if (r.projectId === null) {
    if (p.role === "consultant" && r.orgId !== p.orgId && !onClientTeam) return deny("assignment:client-not-assigned");
    return ok;
  }
  // The firm admin sees every project the firm runs; a client admin every
  // project of their org. A consultant sees the projects they are staffed
  // on, and the lead of a client every project of that client. Being on a
  // client's team alone does not open its projects. Everyone else must be a
  // member.
  if (p.role === "firm_admin" || p.role === "client_admin") return ok;
  if (p.projectIds.has(r.projectId)) return ok;
  if (p.role === "consultant" && r.orgId !== p.orgId && p.leadClientIds.has(r.orgId)) return ok;
  return deny("membership:not-member");
}

function scopeCovers(scope: Scope, p: Principal, r: Resource): boolean {
  switch (scope) {
    case "any":
      return true;
    case "assigned":
      return r.assignees?.includes(p.userId) ?? false;
    case "own":
      return r.createdBy === p.userId;
    case "shared":
      return r.createdBy === p.userId || (r.sharedWith?.includes(p.userId) ?? false);
    case "owner_org":
      return r.ownerOrgId === p.orgId;
    case "team":
      return (
        r.createdBy === p.userId ||
        (r.sharedWith?.includes(p.userId) ?? false) ||
        (r.departmentId != null && p.departmentIds.has(r.departmentId))
      );
    case "lead":
      return p.leadClientIds.has(r.clientOrgId ?? r.orgId) || (r.projectId !== null && p.leadProjectIds.has(r.projectId));
  }
}

function checkLabel(p: Principal, r: Resource): Decision {
  switch (r.visibility) {
    case undefined:
    case "shared":
      return ok;
    case "firm_private":
      return p.orgKind === "firm" ? ok : deny("label:firm_private");
    case "client_private":
      return p.orgKind === "client" && r.orgId === p.orgId ? ok : deny("label:client_private");
    case "user_private":
      return r.createdBy === p.userId ? ok : deny("label:user_private");
  }
}

const ok: Decision = { allowed: true, reason: "ok" };

function deny(reason: string): Decision {
  return { allowed: false, reason };
}
