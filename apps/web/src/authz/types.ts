export type Role = "firm_admin" | "consultant" | "client_admin" | "client_manager" | "action_owner";
export type OrgKind = "firm" | "client";
export type EngagementMode = "full" | "restricted" | "consultant_managed";
export type Visibility = "shared" | "firm_private" | "client_private" | "user_private";

export const FIRM_ROLES: readonly Role[] = ["firm_admin", "consultant"];
export const CLIENT_ROLES: readonly Role[] = ["client_admin", "client_manager", "action_owner"];

/**
 * Who is asking. Always built on the server from the session and the
 * database (services/principal.ts), never from anything the browser sends.
 */
export interface Principal {
  userId: string;
  orgId: string;
  orgKind: OrgKind;
  role: Role;
  /** Projects the user is an explicit member of. */
  projectIds: ReadonlySet<string>;
  /** Consultants only: client orgs they oversee. They see all of those clients' projects. */
  assignedClientIds: ReadonlySet<string>;
  /** Consultants only: client orgs where they are the lead consultant. */
  leadClientIds: ReadonlySet<string>;
  /** Projects (internal) the user leads. */
  leadProjectIds: ReadonlySet<string>;
}

export type ResourceType =
  | "organization"
  | "org_user"
  | "project"
  | "finding"
  | "recommendation"
  | "action"
  | "action_note"
  | "evidence_request"
  | "risk_acceptance"
  | "progress_update"
  | "deadline_request"
  | "evidence"
  | "review"
  | "document"
  | "meeting_note"
  | "follow_up"
  | "report"
  | "activity"
  | "ai_conversation"
  | "client_assignment"
  | "client_directory"
  | "join_request"
  | "inquiry"
  | "consultant_profile"
  | "client_contact"
  | "meeting"
  | "department";

/**
 * The attributes of a record that the check needs. Services load these from
 * the database before calling authorize(); ids from the request are only used
 * to find the row.
 */
export interface Resource {
  type: ResourceType;
  id?: string;
  /**
   * The org that owns the record: the client for client-project records, the
   * firm for internal-project records. For an organization, its own id.
   */
  orgId: string;
  /** The firm org running the project (project-scoped records). */
  firmOrgId?: string;
  /** Null only for organization-level records. */
  projectId: string | null;
  visibility?: Visibility;
  /** Creator of the record (user_private and "own" scope). */
  createdBy?: string | null;
  /** Users the record is assigned to (an action's owner, or a recommendation's action owners). */
  assignees?: readonly string[];
  /** Users a document or note was explicitly shared with. */
  sharedWith?: readonly string[];
  /** Which org controls the record (documents: who may change its labels and AI flag). */
  ownerOrgId?: string;
  /** Kind of the record's project. Internal projects have their own work rules. */
  projectKind?: "internal" | "client";
  /** How the record's client takes part. Consultant-managed clients have their own work rules. */
  engagementMode?: EngagementMode | null;
  /** Staffing records (assignments, join requests): the client they are about. */
  clientOrgId?: string;
}

export interface Decision {
  allowed: boolean;
  /** Short machine-readable reason. Logged; never shown to the user. */
  reason: string;
}
