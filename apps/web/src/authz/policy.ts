import type { Role } from "./types";

/**
 * How far a role's grant reaches once the organization and project checks
 * have passed:
 *   any       - every record in the project (or org) the user can reach
 *   assigned  - only records assigned to the user
 *   own       - only records the user created
 *   shared    - only records explicitly shared with the user (or created by them)
 *   owner_org - only records whose controlling org is the user's org
 *   lead      - only clients (or internal projects) the user leads
 */
export type Scope = "any" | "assigned" | "own" | "shared" | "owner_org" | "lead";

type Grants = Partial<Record<Role, Scope>>;

const STAFF: Grants = { firm_admin: "any", consultant: "any" };
const ALL_BUT_OWNER: Grants = { ...STAFF, client_admin: "any", client_manager: "any" };
const READ_WORK: Grants = { ...ALL_BUT_OWNER, action_owner: "assigned" };
const DO_WORK: Grants = { client_manager: "any", action_owner: "assigned" };

/**
 * The permission table. It encodes the visibility matrix in the Scope,
 * Permissions and AI Access Spec. Anything not listed is denied: adding a
 * permission name without adding grants gives nobody access.
 *
 * Labels (firm_private, client_private, user_private) are checked
 * separately in authorize(), so "any" never reaches a record the label hides.
 */
export const POLICY = {
  // Tenancy
  "organization.read": { ...ALL_BUT_OWNER },
  "organization.create": { firm_admin: "any" },
  "organization.update": { firm_admin: "any", client_admin: "any" },
  "org_user.read": { ...ALL_BUT_OWNER },
  "org_user.manage": { firm_admin: "any", client_admin: "any" },

  // Projects
  "project.read": { ...ALL_BUT_OWNER, action_owner: "any" },
  "project.create": { firm_admin: "any" }, // client projects
  "project.create_internal": { ...STAFF }, // the creator becomes its lead
  "project.update": { firm_admin: "any" },
  "project.manage_members": { firm_admin: "any", client_admin: "any", consultant: "lead" },

  // Staffing. Only the firm admin adds clients and names a client's lead.
  // The lead consultant adds or removes consultants on that client and,
  // with the admin, decides join requests. Consultants see a directory of
  // client names (no data) and may ask to join.
  "client_directory.read": { ...STAFF },
  "client_assignment.read": { ...STAFF },
  "client_assignment.manage": { firm_admin: "any", consultant: "lead" },
  "client_assignment.set_lead": { firm_admin: "any" },
  "join_request.create": { consultant: "any" },
  "join_request.decide": { firm_admin: "any", consultant: "lead" },

  // Findings and recommendations
  "finding.read": { ...ALL_BUT_OWNER },
  "finding.write": { ...STAFF },
  "recommendation.read": { ...READ_WORK },
  "recommendation.write": { ...STAFF },

  // Actions. Status moves map to these in workflow.ts.
  "action.read": { ...READ_WORK },
  "action.write": { ...STAFF },
  "action.assign_owner": { ...STAFF, client_manager: "any" },
  "action.release": { ...STAFF }, // draft -> assigned
  "action.work": { ...DO_WORK }, // start, block, unblock, submit, rework
  "action.review": { ...STAFF }, // accept or request revision

  "progress_update.read": { ...READ_WORK },
  "progress_update.create": { ...DO_WORK },
  "deadline_request.read": { ...READ_WORK },
  "deadline_request.create": { ...DO_WORK },
  "deadline_request.decide": { ...STAFF },

  // Evidence and reviews. Only staff can review; clients can never verify.
  "evidence.read": { ...READ_WORK },
  "evidence.submit": { ...DO_WORK },
  "review.read": { ...READ_WORK },
  "review.create": { ...STAFF },

  // Documents
  "document.read": { ...ALL_BUT_OWNER, action_owner: "shared" },
  "document.download": { ...ALL_BUT_OWNER, action_owner: "shared" },
  "document.upload": { ...STAFF, client_admin: "any", client_manager: "any", action_owner: "assigned" },
  "document.manage": {
    firm_admin: "owner_org",
    consultant: "owner_org",
    client_admin: "owner_org",
    client_manager: "owner_org",
  }, // visibility label, AI flag, shares

  // Meetings, follow-ups, reports, history
  "meeting_note.read": { ...ALL_BUT_OWNER, action_owner: "shared" },
  "meeting_note.write": { ...STAFF },
  "follow_up.read": { ...ALL_BUT_OWNER, action_owner: "assigned" },
  "follow_up.write": { ...STAFF },
  "report.read": { ...ALL_BUT_OWNER },
  "report.write": { ...STAFF },
  "report.share": { ...STAFF },
  "activity.read": { ...READ_WORK },

  // AI assistant. Whether client users get it is an open decision in the
  // spec; until it is made, only firm staff do. To enable client managers,
  // add `client_manager: "any"` here; retrieval rules stay the same.
  "assistant.query": { ...STAFF },
  "ai_conversation.read": {
    firm_admin: "own",
    consultant: "own",
    client_admin: "own",
    client_manager: "own",
    action_owner: "own",
  },
} as const satisfies Record<string, Grants>;

export type Permission = keyof typeof POLICY;

/**
 * Internal projects have no client, so firm staff do the work themselves:
 * the action's owner works it and another staff member reviews it (see the
 * self-review rule in workflow.ts). These grants replace POLICY's for
 * records of internal projects.
 */
const INTERNAL_POLICY: Partial<Record<Permission, Grants>> = {
  "action.work": { firm_admin: "assigned", consultant: "assigned" },
  "evidence.submit": { firm_admin: "assigned", consultant: "assigned" },
  "progress_update.create": { ...STAFF },
  "deadline_request.create": { firm_admin: "assigned", consultant: "assigned" },
};

export function grantFor(permission: Permission, role: Role, projectKind?: "internal" | "client"): Scope | undefined {
  const grants = (projectKind === "internal" ? INTERNAL_POLICY[permission] : undefined) ?? (POLICY[permission] as Grants);
  return grants[role];
}
