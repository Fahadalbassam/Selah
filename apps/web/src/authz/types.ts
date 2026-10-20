export type Role = "firm_lead" | "consultant" | "client_admin" | "client_manager" | "action_owner";
export type OrgKind = "firm" | "client";
export type Visibility = "shared" | "firm_private" | "client_private" | "user_private";

export const FIRM_ROLES: readonly Role[] = ["firm_lead", "consultant"];
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
  /** Engagements the user is an explicit member of. */
  engagementIds: ReadonlySet<string>;
}

export type ResourceType =
  | "organization"
  | "org_user"
  | "engagement"
  | "finding"
  | "recommendation"
  | "action"
  | "progress_update"
  | "deadline_request"
  | "evidence"
  | "review"
  | "document"
  | "meeting_note"
  | "follow_up"
  | "report"
  | "activity"
  | "ai_conversation";

/**
 * The attributes of a record that the check needs. Services load these from
 * the database before calling authorize(); ids from the request are only used
 * to find the row.
 */
export interface Resource {
  type: ResourceType;
  id?: string;
  /** The client tenant the record belongs to. For an organization, its own id. */
  clientOrgId: string;
  /** The firm org running the engagement (engagement-scoped records). */
  firmOrgId?: string;
  /** Null only for organization-level records. */
  engagementId: string | null;
  visibility?: Visibility;
  /** Creator of the record (user_private and "own" scope). */
  createdBy?: string | null;
  /** Users the record is assigned to (an action's owner, or a recommendation's action owners). */
  assignees?: readonly string[];
  /** Users a document or note was explicitly shared with. */
  sharedWith?: readonly string[];
  /** Which org controls the record (documents: who may change its labels and AI flag). */
  ownerOrgId?: string;
}

export interface Decision {
  allowed: boolean;
  /** Short machine-readable reason. Logged; never shown to the user. */
  reason: string;
}
