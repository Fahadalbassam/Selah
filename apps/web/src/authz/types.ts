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
  /** Projects the user only observes: they read and comment, and change nothing else. */
  observedProjectIds?: ReadonlySet<string>;
  /**
   * Consultants only: the clients they do the work for, as lead or deputy, or staffed (not as an
   * observer) on at least one of the client's projects that is not closed. Records that belong to the client rather
   * than to a project (its business indicators) are changed only by these; every other consultant
   * on the client's team reads (decision D4).
   */
  workingClientIds?: ReadonlySet<string>;
  /**
   * Consultants only: the clients they lead or deputise for, or are staffed on any project of
   * (observing or not, open or closed), while still on the client's team. They read the client's
   * organisation structure (org chart, migration 0091; the database: app_org_chart_firm_reader()).
   */
  staffedClientIds?: ReadonlySet<string>;
  /** Client users only: the departments they belong to (their team). */
  departmentIds: ReadonlySet<string>;
  /** Client users only: their client is archived and in its grace period, so they can only read. */
  readOnly?: boolean;
  /**
   * Client users only: the firm switched the assistant on for their role and
   * their admin consented (app_client_ai_on). Without it a client person is
   * refused the assistant whatever the policy grants.
   */
  clientAssistant?: boolean;
}

export type ResourceType =
  | "organization"
  | "org_user"
  | "project"
  | "finding"
  | "recommendation"
  | "action"
  | "action_note"
  | "action_comment"
  | "evidence_request"
  | "info_request"
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
  | "client_group"
  | "client_directory"
  | "join_request"
  | "inquiry"
  | "consultant_profile"
  | "client_contact"
  | "meeting"
  | "department"
  | "indicator"
  | "org_chart"
  | "org_chart_request"
  | "assessment_template"
  | "assessment"
  | "engagement"
  | "deliverable"
  | "support_request";

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
  /** The client department the record is filed under (documents: the team that sees it). */
  departmentId?: string | null;
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
  /** State of the record's project. A closed project is read-only (policy.ts OPEN_WHEN_CLOSED). */
  projectState?: "draft" | "planned" | "active" | "closing" | "closed";
  /**
   * An action (or a record under one) that is still the firm's draft. Nobody at
   * the client reads it until the firm releases it (decision D6; migration 0076).
   * Also the firm's draft of a client's organisation structure, which nobody at
   * the client reads until it is published (migration 0091).
   */
  draft?: boolean;
}

export interface Decision {
  allowed: boolean;
  /** Short machine-readable reason. Logged; never shown to the user. */
  reason: string;
}
