import type { EngagementMode, Role } from "./types";

/**
 * How far a role's grant reaches once the organization and project checks
 * have passed:
 *   any       - every record in the project (or org) the user can reach
 *   assigned  - only records assigned to the user
 *   own       - only records the user created
 *   shared    - only records explicitly shared with the user (or created by them)
 *   owner_org - only records whose controlling org is the user's org
 *   lead      - only clients (or internal projects) the user leads
 *   team      - the user's own records, records shared with them, and records
 *               filed under one of their departments
 */
export type Scope = "any" | "assigned" | "own" | "shared" | "owner_org" | "lead" | "team";

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
  // A pitch to a company the firm approached (N4): any consultant starts one and leads it.
  "organization.pitch": { firm_admin: "any", consultant: "any" },
  "organization.update": { firm_admin: "any", client_admin: "any" },
  // How a client takes part (full, restricted, consultant-managed). The firm admin's call.
  "organization.engagement": { firm_admin: "any" },
  // Optional departments: names for everyone at the client, managed by its
  // admin or the firm admin. The client admin switches them on or off.
  "department.read": { ...ALL_BUT_OWNER, action_owner: "any" },
  "department.manage": { firm_admin: "any", client_admin: "any" },
  "org_user.read": { ...ALL_BUT_OWNER },
  "org_user.manage": { firm_admin: "any", client_admin: "any" }, // invite, switch off, change addresses, review access
  // PDPL erasure: details removed, ids and history kept. Firm admin only.
  "org_user.erase": { firm_admin: "any" },
  // People at a client without a login (consultant-managed engagements). Firm-only.
  "client_contact.read": { ...STAFF },
  "client_contact.write": { ...STAFF },

  // Projects
  "project.read": { ...ALL_BUT_OWNER, action_owner: "any" },
  // Client projects (phases, follow-on scopes): the admin, and the client's lead consultant.
  "project.create": { firm_admin: "any", consultant: "lead" },
  "project.create_internal": { ...STAFF }, // the creator becomes its lead
  "project.update": { firm_admin: "any" },
  "project.manage_members": { firm_admin: "any", client_admin: "any", consultant: "lead" },
  // The signed engagement (what the client agreed): the client's consultants
  // and its admin read it; the firm admin records it. baseline: Engagements.
  "engagement.read": { ...STAFF, client_admin: "any" },
  "engagement.write": { firm_admin: "any" },
  // Oversight without being staffed: the admin follows a client or project.
  "project.watch": { firm_admin: "any" },

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

  // Assessment templates belong to the firm. Its staff read them; the firm
  // admin and the consultants the admin names build and publish them (the
  // database checks the names: template_authors). Clients never see one.
  "assessment_template.read": { ...STAFF },
  "assessment_template.manage": { ...STAFF },
  "template_author.manage": { firm_admin: "any" },
  // Assessments of a client project. The firm on the project runs them;
  // the client's admins and managers read one once it is final and shared.
  "assessment.read": { ...ALL_BUT_OWNER },
  "assessment.conduct": { ...STAFF },

  // Actions. Status moves map to these in workflow.ts.
  "action.read": { ...READ_WORK },
  "action.write": { ...STAFF },
  "action.assign_owner": { ...STAFF, client_manager: "any" },
  "action.release": { ...STAFF }, // draft -> assigned
  "action.work": { ...DO_WORK }, // start, block, unblock, submit, rework
  "action.review": { ...STAFF }, // accept or request revision
  // End without verification (partially implemented, risk accepted, not
  // applicable, superseded) or reopen. Risk acceptance also needs a named
  // client person's signed statement (risk.accept).
  "action.close": { ...STAFF },
  "action.reopen": { ...STAFF },
  "risk.accept": { client_admin: "any", client_manager: "any" },
  // The evidence list: what the firm needs to see to verify an action.
  "evidence_request.read": { ...READ_WORK },
  "evidence_request.manage": { ...STAFF },
  // The firm's private notes on an action.
  "action_note.read": { ...STAFF },
  "action_note.create": { ...STAFF },

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
  // An action owner sees their own files, files shared with them, and their
  // department teammates' files (decided 2026-10-22: the team sees each
  // other's uploads; the manager and client admin see everything below).
  "document.read": { ...ALL_BUT_OWNER, action_owner: "team" },
  "document.download": { ...ALL_BUT_OWNER, action_owner: "team" },
  "document.upload": { ...STAFF, client_admin: "any", client_manager: "any", action_owner: "assigned" },
  "document.manage": {
    firm_admin: "owner_org",
    consultant: "owner_org",
    client_admin: "owner_org",
    client_manager: "owner_org",
  }, // visibility label, AI flag, shares
  // Share a client-private file with the firm (one-way). The client admin only.
  "document.share": { client_admin: "owner_org" },

  // Meetings, follow-ups, reports, history
  "meeting_note.read": { ...ALL_BUT_OWNER, action_owner: "shared" },
  "meeting_note.write": { ...STAFF },
  // Meetings. The firm on the project books any; a client admin or manager
  // books shared ones and runs the ones they organise ("own"). Labels and
  // project membership are checked as for other records.
  "meeting.read": { ...ALL_BUT_OWNER, action_owner: "any" },
  "meeting.book": { ...STAFF, client_admin: "any", client_manager: "any" },
  "meeting.run": { ...STAFF, client_admin: "own", client_manager: "own" },
  // Meetings, action due dates and follow-ups in one calendar.
  "schedule.read": { ...ALL_BUT_OWNER, action_owner: "any" },
  "follow_up.read": { ...ALL_BUT_OWNER, action_owner: "assigned" },
  "follow_up.write": { ...STAFF },
  "report.read": { ...ALL_BUT_OWNER },
  "report.write": { ...STAFF },
  "report.share": { ...STAFF },
  "activity.read": { ...READ_WORK },
  // Implementation metrics of a project (computed, never typed in), and the
  // admin's view of the team's load. No per-person scores or rankings.
  "metrics.read": { ...ALL_BUT_OWNER },
  "team_metrics.read": { firm_admin: "any" },
  // The deviation rules (v_deviations) over a project: overdue, stale,
  // slipped, churn, orphaned, and the client KPI rules. For the firm.
  "deviation.read": { ...STAFF },
  // The firm's own settings: intake address, client KPIs, reminders, review
  // and retention periods. The database enforces the ranges.
  "firm_settings.manage": { firm_admin: "any" },

  // Intake. Firm admins see and decide every inquiry; the consultant it is
  // handed to qualifies it (moves it forward, adds notes, runs discovery).
  // Only the admin assigns the owner, records the conflict check, decides
  // the outcome and turns a won inquiry into a client.
  "inquiry.read": { firm_admin: "any", consultant: "assigned" },
  "inquiry.work": { firm_admin: "any", consultant: "assigned" },
  "inquiry.decide": { firm_admin: "any" },
  // Who can lead what. The admin records it; a consultant keeps their own
  // languages and availability. Suggestions match one inquiry; they are
  // not a ranking of people.
  "consultant_profile.read": { ...STAFF },
  "consultant_profile.manage": { firm_admin: "any" },
  "consultant_profile.update_own": { consultant: "own" },
  "lead_suggestion.read": { firm_admin: "any" },

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

/**
 * A consultant-managed client has no accounts in Selah, so the staff on its
 * projects record its progress and evidence and move its actions, on its
 * behalf. Someone else on the team still verifies (workflow.ts, and the
 * database counts recorded progress as submitting).
 */
const CONSULTANT_MANAGED_POLICY: Partial<Record<Permission, Grants>> = {
  "action.work": { ...STAFF },
  "evidence.submit": { ...STAFF },
  "progress_update.create": { ...STAFF },
};

export function grantFor(
  permission: Permission,
  role: Role,
  projectKind?: "internal" | "client",
  engagementMode?: EngagementMode | null,
): Scope | undefined {
  const special =
    projectKind === "internal"
      ? INTERNAL_POLICY[permission]
      : engagementMode === "consultant_managed"
        ? CONSULTANT_MANAGED_POLICY[permission]
        : undefined;
  const grants = special ?? (POLICY[permission] as Grants);
  return grants[role];
}
