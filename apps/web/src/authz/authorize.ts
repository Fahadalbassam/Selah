import { grantFor, isReadPermission, OPEN_TO_OBSERVERS, OPEN_WHEN_ARCHIVED, OPEN_WHEN_CLOSED, type Permission, type Scope } from "./policy";
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
 *                     owner_org / lead / team / working) cover this record?
 *   5. Label        - does the visibility label allow this user? (An action
 *                     that is still the firm's draft is firm-only, like a
 *                     firm_private label, until it is released: D6.)
 *
 * Then three rules of state: nothing in a closed project is written, except
 * what OPEN_WHEN_CLOSED lists; the people of an archived client only read,
 * except what OPEN_WHEN_ARCHIVED lists; and an observer writes nothing in
 * the project they observe, except what OPEN_TO_OBSERVERS lists. (Records
 * that belong to a client and not to a project, its business indicators,
 * have no project to observe: there the "working" scope keeps an observer
 * to reading. See policy.ts, "indicator.*".)
 *
 * Last, a sixth question:
 *   6. Audience   - was the item (a document, a meeting) narrowed with the
 *                   picker, and is this person left out? It only ever says
 *                   no: whoever always sees the item passes, and nobody gets
 *                   in who the five questions kept out. It repeats what
 *                   row-level security decides, and is a guard only: the
 *                   restrictive policies (migrations 0111, 0118) hide the item
 *                   from someone left out before any service builds a
 *                   resource, and the database tells the services nothing
 *                   about who is left out (app_audience_mine() answers only
 *                   about the caller, and nothing to someone left out), so with
 *                   the database's data this question never denies (re-check
 *                   N13). It denies a resource that names the caller as left
 *                   out, which only a test or a future caller can build.
 *
 * Pure function: no I/O, so it is cheap to call and easy to test exhaustively.
 */
export function authorize(principal: Principal, permission: Permission, resource: Resource): Decision {
  const org = checkOrganization(principal, resource);
  if (!org.allowed) return org;

  const scope = grantFor(permission, principal.role, resource.projectKind, resource.engagementMode);
  if (!scope) return deny(`role:${principal.role} lacks ${permission}`);

  // The client assistant is off unless the firm switched it on for this role and the client consented.
  if (permission === "assistant.query" && principal.orgKind === "client" && !principal.clientAssistant) {
    return deny("assistant:client-off");
  }

  const membership = checkMembership(principal, resource);
  if (!membership.allowed) return membership;

  if (!scopeCovers(scope, principal, resource)) return deny(`scope:${scope}`);

  const label = checkLabel(principal, resource);
  if (!label.allowed) return label;

  // A draft action, and everything under it, is the firm's until released (D6).
  if (resource.draft && principal.orgKind !== "firm") return deny("action:draft");

  if (resource.projectState === "closed" && !isReadPermission(permission) && !OPEN_WHEN_CLOSED.has(permission)) {
    return deny("project:closed");
  }

  if (principal.readOnly && !isReadPermission(permission) && !OPEN_WHEN_ARCHIVED.has(permission)) {
    return deny("org:archived");
  }

  if (
    resource.projectId &&
    principal.observedProjectIds?.has(resource.projectId) &&
    !isReadPermission(permission) &&
    !OPEN_TO_OBSERVERS.has(permission)
  ) {
    return deny("project:observer");
  }

  const audience = checkAudience(principal, resource);
  if (!audience.allowed) return audience;

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
    case "working":
      return p.workingClientIds?.has(r.clientOrgId ?? r.orgId) ?? false;
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

/**
 * Left out ("except" and named, or "only" and not named) is a no, unless the
 * person always sees the item. Never a yes the other questions did not give.
 */
function checkAudience(p: Principal, r: Resource): Decision {
  const a = r.audience;
  if (!a || a.locked.includes(p.userId)) return ok;
  const named = a.people.includes(p.userId);
  if (a.mode === "except" && named) return deny("audience:left-out");
  if (a.mode === "only" && !named) return deny("audience:not-listed");
  return ok;
}

const ok: Decision = { allowed: true, reason: "ok" };

function deny(reason: string): Decision {
  return { allowed: false, reason };
}
