import { grantFor, type Permission, type Scope } from "./policy";
import type { Decision, Principal, Resource } from "./types";

/**
 * THE authorization check. Every API route, download, export, search,
 * notification and AI retrieval goes through this function (via services).
 *
 * It asks the five questions from the spec in order; the first "no" denies:
 *   1. Organization - is the record in the user's tenant (or, for Maayish
 *      staff, in an engagement their org runs)?
 *   2. Role         - does the role hold this permission at all?
 *   3. Membership   - is the user a member of the record's engagement?
 *   4. Assignment   - does the grant's scope (assigned / own / shared /
 *                     owner_org) cover this record?
 *   5. Label        - does the visibility label allow this user?
 *
 * Pure function: no I/O, so it is cheap to call and easy to test exhaustively.
 */
export function authorize(principal: Principal, permission: Permission, resource: Resource): Decision {
  const org = checkOrganization(principal, resource);
  if (!org.allowed) return org;

  const scope = grantFor(permission, principal.role);
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
    return r.clientOrgId === p.orgId ? ok : deny("org:other-tenant");
  }
  // Maayish staff reach client records only through an engagement their org
  // runs. Org-level records (the Maayish org itself, or a client org) must
  // also carry the Maayish org id that links them.
  if (r.maayishOrgId === undefined) return deny("org:no-maayish-link");
  return r.maayishOrgId === p.orgId ? ok : deny("org:other-maayish-org");
}

function checkMembership(p: Principal, r: Resource): Decision {
  if (r.engagementId === null) return ok;
  // The lead sees every engagement Maayish runs; a client admin every
  // engagement of their org. Everyone else must be a member.
  if (p.role === "maayish_lead" || p.role === "client_admin") return ok;
  return p.engagementIds.has(r.engagementId) ? ok : deny("membership:not-member");
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
  }
}

function checkLabel(p: Principal, r: Resource): Decision {
  switch (r.visibility) {
    case undefined:
    case "shared":
      return ok;
    case "maayish_private":
      return p.orgKind === "maayish" ? ok : deny("label:maayish_private");
    case "client_private":
      return p.orgKind === "client" && r.clientOrgId === p.orgId ? ok : deny("label:client_private");
    case "user_private":
      return r.createdBy === p.userId ? ok : deny("label:user_private");
  }
}

const ok: Decision = { allowed: true, reason: "ok" };

function deny(reason: string): Decision {
  return { allowed: false, reason };
}
