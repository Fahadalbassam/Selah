// Selah's business tables.
//
// Selah is used by one consulting firm (org kind "firm") that serves many
// client organizations (kind "client"). Work is organised in projects:
//   - internal projects: the firm's own work. org_id = the firm. Clients never see them.
//   - client projects:   work for one client. org_id = that client.
//
// Tenant rule: every project-scoped row carries both project_id and org_id
// (the project's owning org). A composite foreign key to projects(id, org_id)
// makes it impossible for the two to disagree, and the row-level security
// policies (drizzle/0001_security.sql) key on them.
//
// Visibility labels come from the Scope, Permissions and AI Access Spec:
//   shared          - everyone in the project who passes the other checks
//   firm_private    - firm staff only (the default for firm files: sharing
//                     with the client is an explicit choice)
//   client_private  - the client org only (not even the firm admin)
//   user_private    - only the user who created it
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  customType,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const orgKind = pgEnum("org_kind", ["firm", "client"]);
export const orgStatus = pgEnum("org_status", ["active", "archived"]);
export const role = pgEnum("role", [
  "firm_admin",
  "consultant",
  "client_admin",
  "client_manager",
  "action_owner",
]);
export const visibility = pgEnum("visibility", [
  "shared",
  "firm_private",
  "client_private",
  "user_private",
]);
export const projectKind = pgEnum("project_kind", ["internal", "client"]);
export const projectState = pgEnum("project_state", ["planned", "active", "closed"]);
export const priority = pgEnum("priority", ["low", "medium", "high", "critical"]);
export const actionStatus = pgEnum("action_status", [
  "draft",
  "assigned",
  "in_progress",
  "blocked",
  "awaiting_review",
  "revision_requested",
  "verified_complete",
  // Ended without full verification; closure_outcome says how.
  "closed",
]);
// How an action ended when it was not verified as implemented.
export const closureOutcome = pgEnum("closure_outcome", ["partially_implemented", "risk_accepted", "not_applicable", "superseded"]);
// Where a tracked item came from: the consultant's report, a board
// decision taken in a meeting, or a compliance obligation.
export const recommendationSource = pgEnum("recommendation_source", ["consultant", "board_decision", "compliance"]);
export const evidenceRequestStatus = pgEnum("evidence_request_status", ["open", "submitted", "accepted", "rejected", "waived"]);
export const followUpKind = pgEnum("follow_up_kind", ["due_soon", "overdue"]);
export const reviewOutcome = pgEnum("review_outcome", ["accept", "revise", "reject"]);
export const documentPurpose = pgEnum("document_purpose", ["deliverable", "client_document", "evidence"]);
export const documentState = pgEnum("document_state", ["draft", "submitted", "archived"]);
// Virus scan result. Only "clean" files can be downloaded (fail closed);
// "skipped" (stored without a scanner, local development only) can be
// downloaded only while SCAN_REQUIRED=false, which production refuses.
export const scanStatus = pgEnum("scan_status", ["pending", "clean", "infected", "error", "skipped"]);
export const requestStatus = pgEnum("request_status", ["pending", "approved", "rejected"]);
export const followUpStatus = pgEnum("follow_up_status", ["open", "done"]);
export const chunkSource = pgEnum("chunk_source", [
  "document",
  "recommendation",
  "action",
  "progress_update",
  "review",
  "meeting_note",
]);
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const auditOutcome = pgEnum("audit_outcome", ["allow", "deny", "error"]);

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ---------------------------------------------------------------- tenancy

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: orgKind("kind").notNull(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  status: orgStatus("status").notNull().default("active"),
  // Email domains its people must use. The firm must set them before it
  // invites anyone; for a client, null means any address (many family firms
  // have no company domain).
  allowedEmailDomains: text("allowed_email_domains").array(),
  createdAt: createdAt(),
});

// One active membership per user: a person belongs to exactly one tenant.
// A trigger checks that firm roles only sit in the firm org and client
// roles only in client orgs.
export const orgMemberships = pgTable(
  "org_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    role: role("role").notNull(),
    active: boolean("active").notNull().default(true),
    // Who switched the account off, when and why. Nothing is deleted.
    deactivatedAt: ts("deactivated_at"),
    deactivatedBy: uuid("deactivated_by").references(() => user.id),
    deactivationReason: text("deactivation_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("org_memberships_org_idx").on(t.orgId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: projectKind("kind").notNull(),
    // The client for client projects; the firm itself for internal projects.
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    firmOrgId: uuid("firm_org_id")
      .notNull()
      .references(() => organizations.id),
    title: text("title").notNull(),
    description: text("description"),
    state: projectState("state").notNull().default("planned"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    // Follow-up rules: remind the owner this many days before a due date, and
    // escalate an overdue action to the next level after these many days.
    remindDaysBefore: integer("remind_days_before").notNull().default(3),
    escalateLevel2Days: integer("escalate_level2_days").notNull().default(7),
    escalateLevel3Days: integer("escalate_level3_days").notNull().default(14),
    // Handover: the day the report was delivered (check-ins follow), and the
    // client's sponsor, who is told at the last escalation level. drizzle/0015.
    handoverOn: date("handover_on"),
    clientSponsorUserId: uuid("client_sponsor_user_id").references(() => user.id),
    createdBy: uuid("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("projects_id_org_uq").on(t.id, t.orgId),
    index("projects_org_idx").on(t.orgId),
  ],
);

// Which consultants oversee which client. An assigned consultant sees all of
// that client's projects; consultants not assigned never see the client.
export const clientAssignments = pgTable(
  "client_assignments",
  {
    clientOrgId: uuid("client_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // One lead consultant per client. The lead staffs the client's team and
    // decides join requests together with the firm admin.
    isLead: boolean("is_lead").notNull().default(false),
    assignedBy: uuid("assigned_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.clientOrgId, t.userId] }),
    index("client_assignments_user_idx").on(t.userId),
    uniqueIndex("client_assignments_one_lead").on(t.clientOrgId).where(sql`${t.isLead}`),
  ],
);

export const joinRequestStatus = pgEnum("join_request_status", ["pending", "approved", "declined", "withdrawn"]);

// A consultant asking to be assigned to a client. Decided by the firm admin
// or that client's lead; approving creates the assignment.
export const joinRequests = pgTable(
  "join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrgId: uuid("client_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: joinRequestStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => user.id),
    decisionNote: text("decision_note"),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("join_requests_client_idx").on(t.clientOrgId),
    uniqueIndex("join_requests_one_pending").on(t.clientOrgId, t.userId).where(sql`${t.status} = 'pending'`),
  ],
);

// Explicit project membership (firm staff on internal projects, consultants
// on a single client project, client users on their projects).
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The lead of an internal project manages its members.
    isLead: boolean("is_lead").notNull().default(false),
    addedBy: uuid("added_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("project_members_user_idx").on(t.userId)],
);

// A firm admin who oversees a client or one project without being staffed on
// it. Watchers get the same notifications as the team; other admins get none.
export const watches = pgTable(
  "watches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientOrgId: uuid("client_org_id").references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("watches_one_target", sql`(${t.clientOrgId} IS NULL) <> (${t.projectId} IS NULL)`),
    uniqueIndex("watches_client_uq").on(t.userId, t.clientOrgId).where(sql`${t.clientOrgId} IS NOT NULL`),
    uniqueIndex("watches_project_uq").on(t.userId, t.projectId).where(sql`${t.projectId} IS NOT NULL`),
  ],
);

// Columns every project-scoped table shares, plus the composite FK that
// pins org_id to the project's real client.
const scoped = () => ({
  projectId: uuid("project_id").notNull(),
  orgId: uuid("org_id").notNull(),
});
const scopedFk = (name: string, t: { projectId: AnyPgColumn; orgId: AnyPgColumn }) =>
  foreignKey({
    name: `${name}_project_fk`,
    columns: [t.projectId, t.orgId],
    foreignColumns: [projects.id, projects.orgId],
  }).onDelete("cascade");

// ------------------------------------------------- findings and actions

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    title: text("title").notNull(),
    description: text("description"),
    sourceDocumentId: uuid("source_document_id"),
    visibility: visibility("visibility").notNull().default("shared"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [scopedFk("findings", t), index("findings_project_idx").on(t.projectId)],
);

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    findingId: uuid("finding_id").references(() => findings.id),
    title: text("title").notNull(),
    rationale: text("rationale"),
    targetOutcome: text("target_outcome"),
    priority: priority("priority").notNull().default("medium"),
    dueDate: date("due_date"),
    requiredEvidence: text("required_evidence"),
    source: recommendationSource("source").notNull().default("consultant"),
    // For board decisions: the meeting where it was decided, and when.
    meetingNoteId: uuid("meeting_note_id").references((): AnyPgColumn => meetingNotes.id, { onDelete: "set null" }),
    decidedOn: date("decided_on"),
    visibility: visibility("visibility").notNull().default("shared"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [scopedFk("recommendations", t), index("recommendations_project_idx").on(t.projectId)],
);

// Status moves are checked twice: by authz/workflow.ts (who may move it) and
// by a database trigger (which moves exist at all).
export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    ownerUserId: uuid("owner_user_id").references(() => user.id),
    status: actionStatus("status").notNull().default("draft"),
    dueDate: date("due_date"),
    blockedReason: text("blocked_reason"),
    // Set by the database: when the action last entered Awaiting Review (a
    // verification needs a review after it) and when it was last reopened
    // (a risk acceptance must be signed after it). drizzle/0011.
    awaitingReviewAt: ts("awaiting_review_at"),
    // The due date agreed when the action was released. Frozen afterwards
    // (approved deadline changes move due_date only), so "on time" is
    // measured against what was agreed. drizzle/0013.
    baselineDueDate: date("baseline_due_date"),
    reopenedAt: ts("reopened_at"),
    // Set when status is "closed" (see drizzle/0011_follow_through_rules.sql).
    closureOutcome: closureOutcome("closure_outcome"),
    closureNote: text("closure_note"),
    closedBy: uuid("closed_by").references(() => user.id),
    closedAt: ts("closed_at"),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => actions.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    scopedFk("actions", t),
    index("actions_project_idx").on(t.projectId),
    index("actions_owner_idx").on(t.ownerUserId),
  ],
);

// Append-only.
export const progressUpdates = pgTable(
  "progress_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id),
    isBlocker: boolean("is_blocker").notNull().default(false),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("progress_updates", t), index("progress_updates_action_idx").on(t.actionId)],
);

export const deadlineChangeRequests = pgTable(
  "deadline_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => user.id),
    proposedDueDate: date("proposed_due_date").notNull(),
    reason: text("reason").notNull(),
    status: requestStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => user.id),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("deadline_change_requests", t)],
);

// ------------------------------------------------------------ documents

// owner_org_id is the side that controls the document (and its AI flag).
// storage_key is random and never derived from the file name.
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    ownerOrgId: uuid("owner_org_id")
      .notNull()
      .references(() => organizations.id),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => user.id),
    purpose: documentPurpose("purpose").notNull(),
    state: documentState("state").notNull().default("draft"),
    title: text("title").notNull(),
    visibility: visibility("visibility").notNull().default("firm_private"),
    aiIndexable: boolean("ai_indexable").notNull().default(false),
    version: integer("version").notNull().default(1),
    supersedesId: uuid("supersedes_id"),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    scanStatus: scanStatus("scan_status").notNull().default("pending"),
    scannedAt: ts("scanned_at"),
    createdAt: createdAt(),
  },
  (t) => [
    scopedFk("documents", t),
    foreignKey({ name: "documents_supersedes_fk", columns: [t.supersedesId], foreignColumns: [t.id] }),
    index("documents_project_idx").on(t.projectId),
  ],
);

// Explicit per-user sharing (the "Shared" cells in the visibility matrix).
export const documentShares = pgTable(
  "document_shares",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.userId] })],
);

export const evidenceSubmissions = pgTable(
  "evidence_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => user.id),
    note: text("note"),
    // The item on the action's evidence list this file answers, if any.
    evidenceRequestId: uuid("evidence_request_id").references((): AnyPgColumn => evidenceRequests.id),
    submittedAt: createdAt(),
  },
  (t) => [scopedFk("evidence_submissions", t), index("evidence_action_idx").on(t.actionId)],
);

// The evidence list for an action ("prepared by client" list): what the
// firm needs to see before it can verify the action.
export const evidenceRequests = pgTable(
  "evidence_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: date("due_date"),
    status: evidenceRequestStatus("status").notNull().default("open"),
    decisionNote: text("decision_note"),
    decidedBy: uuid("decided_by").references(() => user.id),
    decidedAt: ts("decided_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("evidence_requests", t), index("evidence_requests_action_idx").on(t.actionId)],
);

// A named client person accepting the risk of not implementing an action.
// Append-only; an action closes as "risk_accepted" only with one of these.
export const riskAcceptances = pgTable(
  "risk_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    acceptedBy: uuid("accepted_by")
      .notNull()
      .references(() => user.id),
    statement: text("statement").notNull(),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("risk_acceptances", t), index("risk_acceptances_action_idx").on(t.actionId)],
);

// The firm's own notes on an action. Never visible to the client. Append-only.
export const actionNotes = pgTable(
  "action_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("action_notes", t), index("action_notes_action_idx").on(t.actionId)],
);

// One row per reminder or escalation sent, so each is sent once. A new due
// date re-arms them (due_date is part of the key).
export const followUpLog = pgTable(
  "follow_up_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    kind: followUpKind("kind").notNull(),
    level: integer("level").notNull(),
    dueDate: date("due_date").notNull(),
    recipients: uuid("recipients").array().notNull(),
    sentAt: createdAt(),
  },
  (t) => [uniqueIndex("follow_up_log_once").on(t.actionId, t.kind, t.level, t.dueDate)],
);

// Append-only: a correction is a new review, never an edit.
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    evidenceSubmissionId: uuid("evidence_submission_id").references(() => evidenceSubmissions.id),
    // Exactly what the reviewer saw: every submission since the previous
    // review, and the SHA-256 of each file at review time.
    evidenceSubmissionIds: uuid("evidence_submission_ids").array().notNull().default(sql`'{}'::uuid[]`),
    evidenceSha256: text("evidence_sha256").array().notNull().default(sql`'{}'::text[]`),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => user.id),
    outcome: reviewOutcome("outcome").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("reviews", t), index("reviews_action_idx").on(t.actionId)],
);

// ------------------------------------------------ meetings and reports

export const meetingNotes = pgTable(
  "meeting_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id),
    heldOn: date("held_on").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    visibility: visibility("visibility").notNull().default("firm_private"),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("meeting_notes", t)],
);

export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    meetingNoteId: uuid("meeting_note_id").references(() => meetingNotes.id, { onDelete: "set null" }),
    actionId: uuid("action_id").references(() => actions.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    dueAt: ts("due_at"),
    assigneeUserId: uuid("assignee_user_id").references(() => user.id),
    visibility: visibility("visibility").notNull().default("shared"),
    status: followUpStatus("status").notNull().default("open"),
    // Set on the check-ins created after handover: days after handover_on.
    checkinDay: integer("checkin_day"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("follow_ups", t), uniqueIndex("follow_ups_checkin_once").on(t.projectId, t.checkinDay)],
);

// Reports start firm-private and become shared only when a consultant
// shares them.
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    visibility: visibility("visibility").notNull().default("firm_private"),
    generatedBy: uuid("generated_by")
      .notNull()
      .references(() => user.id),
    sharedAt: ts("shared_at"),
    // A periodic report freezes the numbers for its period.
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    metrics: jsonb("metrics"),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("reports", t)],
);

// ------------------------------------------------------------- metrics

// The firm's settings. Client KPIs (below) stay off until the firm turns
// them on.
export const firmSettings = pgTable("firm_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  clientKpisEnabled: boolean("client_kpis_enabled").notNull().default(false),
  // Days after a KPI period ends before a missing reading shows as not reported.
  kpiGraceDays: integer("kpi_grace_days").notNull().default(10),
  // An open action untouched this many days counts as stale.
  staleDays: integer("stale_days").notNull().default(14),
  // Check-ins after handover, in days.
  checkinDays: integer("checkin_days")
    .array()
    .notNull()
    .default(sql`'{30,60,90}'::integer[]`),
  // Where new inquiries are announced by email (a link only), besides the
  // in-app notice to every firm admin.
  intakeEmail: text("intake_email"),
  // Suggest a lead for an inquiry from consultants' declared expertise.
  suggestionsEnabled: boolean("suggestions_enabled").notNull().default(true),
  // Ask each organisation's admin this often whether its people still work there.
  accessReviewDays: integer("access_review_days").notNull().default(90),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// Monthly copies of the implementation metrics (v_project_metrics), written
// by a job, so trends survive later changes. Never typed in.
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    metric: text("metric").notNull(),
    value: numeric("value"),
    asOf: date("as_of").notNull(),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("metric_snapshots", t), uniqueIndex("metric_snapshots_once").on(t.projectId, t.metric, t.asOf)],
);

// Client KPIs (optional, behind firm_settings.client_kpis_enabled): the
// client's own strategic measures, entered by hand. Readings are the client's
// claims until the firm verifies them; nothing is computed or pulled in.
export const kpiPerspective = pgEnum("kpi_perspective", ["financial", "customer", "internal_process", "learning_growth"]);
export const kpiDirection = pgEnum("kpi_direction", ["higher_better", "lower_better"]);
export const kpiFrequency = pgEnum("kpi_frequency", ["monthly", "quarterly"]);
export const kpiReadingStatus = pgEnum("kpi_reading_status", ["reported", "verified", "rejected"]);

export const strategicObjectives = pgTable(
  "strategic_objectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    perspective: kpiPerspective("perspective").notNull(),
    titleAr: text("title_ar"),
    titleEn: text("title_en"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("strategic_objectives", t), check("objective_titled", sql`coalesce(${t.titleAr}, ${t.titleEn}) IS NOT NULL`)],
);

export const kpis = pgTable(
  "kpis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    objectiveId: uuid("objective_id")
      .notNull()
      .references(() => strategicObjectives.id, { onDelete: "cascade" }),
    nameAr: text("name_ar"),
    nameEn: text("name_en"),
    unit: text("unit").notNull(),
    direction: kpiDirection("direction").notNull(),
    baseline: numeric("baseline").notNull(),
    target: numeric("target").notNull(),
    // The first reporting period starts here; readings are due per period.
    startDate: date("start_date").notNull(),
    targetDate: date("target_date").notNull(),
    frequency: kpiFrequency("frequency").notNull(),
    // The client person who reports it.
    ownerUserId: uuid("owner_user_id").references(() => user.id),
    dataSource: text("data_source"),
    // Percent of the way from baseline to target.
    greenThreshold: integer("green_threshold").notNull().default(90),
    amberThreshold: integer("amber_threshold").notNull().default(60),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    scopedFk("kpis", t),
    index("kpis_objective_idx").on(t.objectiveId),
    check("kpi_named", sql`coalesce(${t.nameAr}, ${t.nameEn}) IS NOT NULL`),
    check("kpi_dates", sql`${t.targetDate} > ${t.startDate}`),
    check("kpi_thresholds", sql`0 <= ${t.amberThreshold} AND ${t.amberThreshold} <= ${t.greenThreshold} AND ${t.greenThreshold} <= 100`),
  ],
);

// Append-only, except that the firm verifies or rejects a reported value
// once. A correction is a new reading that supersedes the old one.
export const kpiReadings = pgTable(
  "kpi_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    kpiId: uuid("kpi_id")
      .notNull()
      .references(() => kpis.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    value: numeric("value").notNull(),
    reportedBy: uuid("reported_by")
      .notNull()
      .references(() => user.id),
    reportedAt: createdAt(),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => kpiReadings.id),
    status: kpiReadingStatus("status").notNull().default("reported"),
    verifiedBy: uuid("verified_by").references(() => user.id),
    verifiedAt: ts("verified_at"),
    note: text("note"),
  },
  (t) => [
    scopedFk("kpi_readings", t),
    index("kpi_readings_kpi_idx").on(t.kpiId, t.periodStart),
    uniqueIndex("kpi_readings_supersede_once").on(t.supersedesId),
  ],
);

// A recommendation is intended to move a KPI. A stated intent, never a claim
// of cause.
export const recommendationKpis = pgTable(
  "recommendation_kpis",
  {
    ...scoped(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    kpiId: uuid("kpi_id")
      .notNull()
      .references(() => kpis.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("recommendation_kpis", t), primaryKey({ columns: [t.recommendationId, t.kpiId] })],
);

// What happened to each AI draft a person saw, so the drafts can be
// evaluated before anyone relies on them. Filled once AI drafting is on.
export const aiDraftOutcome = pgEnum("ai_draft_outcome", ["accepted_unchanged", "edited", "discarded"]);
export const aiDrafts = pgTable(
  "ai_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    kind: text("kind").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    outcome: aiDraftOutcome("outcome").notNull(),
    // Characters changed between the draft and what was kept.
    editDistance: integer("edit_distance"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("ai_drafts", t), check("ai_draft_distance", sql`${t.editDistance} IS NULL OR ${t.editDistance} >= 0`)],
);

// -------------------------------------------------------------- intake

// How a new client reaches the firm: a public inquiry form. Submitted only
// through submit_inquiry() (drizzle/0017); read by firm admins and the
// consultant qualifying it. Lost, declined, spam and withdrawn inquiries are
// anonymised after a while (PDPL data minimisation).

// The firm's services and the sectors it serves. Tables, not enums, so the
// firm can edit the lists.
export const serviceAreas = pgTable("service_areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const sectors = pgTable("sectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const employeeBand = pgEnum("employee_band", ["1-9", "10-49", "50-249", "250+"]);
export const ownershipType = pgEnum("ownership_type", [
  "sole",
  "family_single_owner",
  "family_multi_partner",
  "llc",
  "joint_stock",
  "non_profit",
  "other",
]);
export const inquiryUrgency = pgEnum("inquiry_urgency", ["exploring", "within_3_months", "urgent"]);
export const heardFrom = pgEnum("heard_from", ["referral", "search", "social_media", "event", "existing_client", "other"]);
export const inquiryStatus = pgEnum("inquiry_status", [
  "new",
  "triaged",
  "discovery_scheduled",
  "discovery_done",
  "proposal_sent",
  "won",
  "lost",
  "declined",
  "spam",
  "withdrawn",
]);
export const conflictStatus = pgEnum("conflict_status", ["not_checked", "clear", "flagged", "waived"]);
export const discoveryMode = pgEnum("discovery_mode", ["in_person", "video", "phone"]);
export const discoveryOutcome = pgEnum("discovery_outcome", ["proceed", "not_a_fit", "needs_followup"]);

export const inquiries = pgTable(
  "inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmOrgId: uuid("firm_org_id")
      .notNull()
      .references(() => organizations.id),
    // Short code shown to the requester.
    publicRef: text("public_ref").notNull().unique(),
    // The requester's details. Nullable only so anonymisation can clear them.
    orgName: text("org_name"),
    orgNameAr: text("org_name_ar"),
    crNumber: text("cr_number"),
    sectorId: uuid("sector_id")
      .notNull()
      .references(() => sectors.id),
    employeeBand: employeeBand("employee_band").notNull(),
    ownershipType: ownershipType("ownership_type").notNull(),
    contactName: text("contact_name"),
    contactRole: text("contact_role"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    preferredLanguage: text("preferred_language").notNull(),
    message: text("message"),
    // Mirrors the sponsor's survey: a first maturity snapshot.
    selfCheck: jsonb("self_check").$type<Record<string, boolean>>().notNull(),
    urgency: inquiryUrgency("urgency"),
    heardFrom: heardFrom("heard_from"),
    privacyNoticeVersion: text("privacy_notice_version").notNull(),
    consentedAt: ts("consented_at").notNull(),
    // HMACs with a server secret; never the raw IP or user agent.
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
    status: inquiryStatus("status").notNull().default("new"),
    // The consultant qualifying it.
    ownerUserId: uuid("owner_user_id").references(() => user.id),
    conflictStatus: conflictStatus("conflict_status").notNull().default("not_checked"),
    conflictNote: text("conflict_note"),
    conflictCheckedBy: uuid("conflict_checked_by").references(() => user.id),
    conflictCheckedAt: ts("conflict_checked_at"),
    // Set once, when a won inquiry becomes a client.
    clientOrgId: uuid("client_org_id").references(() => organizations.id),
    convertedBy: uuid("converted_by").references(() => user.id),
    convertedAt: ts("converted_at"),
    closedAt: ts("closed_at"),
    purgeAfter: date("purge_after"),
    anonymisedAt: ts("anonymised_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("inquiries_status_idx").on(t.firmOrgId, t.status),
    index("inquiries_ip_idx").on(t.ipHash, t.createdAt),
    check("inquiry_language", sql`${t.preferredLanguage} IN ('ar', 'en')`),
    check("inquiry_contact_kept", sql`${t.anonymisedAt} IS NOT NULL OR (${t.contactEmail} IS NOT NULL AND ${t.contactName} IS NOT NULL AND ${t.orgName} IS NOT NULL)`),
  ],
);

export const inquiryServices = pgTable(
  "inquiry_services",
  {
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => inquiries.id, { onDelete: "cascade" }),
    serviceAreaId: uuid("service_area_id")
      .notNull()
      .references(() => serviceAreas.id),
  },
  (t) => [primaryKey({ columns: [t.inquiryId, t.serviceAreaId] })],
);

// The inquiry's history. Append-only.
export const inquiryEvents = pgTable(
  "inquiry_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => inquiries.id, { onDelete: "cascade" }),
    // Null for the public submit and for jobs.
    actorId: uuid("actor_id").references(() => user.id),
    event: text("event").notNull(),
    fromStatus: inquiryStatus("from_status"),
    toStatus: inquiryStatus("to_status"),
    note: text("note"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("inquiry_events_inquiry_idx").on(t.inquiryId, t.createdAt)],
);

export const discoverySessions = pgTable(
  "discovery_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => inquiries.id, { onDelete: "cascade" }),
    scheduledAt: ts("scheduled_at").notNull(),
    heldAt: ts("held_at"),
    mode: discoveryMode("mode").notNull(),
    attendees: text("attendees"),
    notes: text("notes"),
    outcome: discoveryOutcome("outcome"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("discovery_sessions_inquiry_idx").on(t.inquiryId)],
);

// ------------------------------------------------- consultant expertise

// What a consultant can lead, as the firm admin records it. Used only to
// suggest a lead for a new inquiry (app_suggest_leads); never to score or
// rank people.
export const consultantProfiles = pgTable("consultant_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  firmOrgId: uuid("firm_org_id")
    .notNull()
    .references(() => organizations.id),
  // Languages they can run an engagement in.
  languages: text("languages").array().notNull().default(sql`'{ar}'::text[]`),
  // The consultant says when they are too busy to take a new client.
  acceptingNewClients: boolean("accepting_new_clients").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const consultantServiceAreas = pgTable(
  "consultant_service_areas",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => consultantProfiles.userId, { onDelete: "cascade" }),
    serviceAreaId: uuid("service_area_id")
      .notNull()
      .references(() => serviceAreas.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.serviceAreaId] })],
);

export const consultantSectors = pgTable(
  "consultant_sectors",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => consultantProfiles.userId, { onDelete: "cascade" }),
    sectorId: uuid("sector_id")
      .notNull()
      .references(() => sectors.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sectorId] })],
);

// ------------------------------------------------- history and audit

// Workflow history people see in the app. Append-only.
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    actorId: uuid("actor_id").references(() => user.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    event: text("event").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    visibility: visibility("visibility").notNull().default("shared"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("activity_events", t), index("activity_events_entity_idx").on(t.entityType, t.entityId)],
);

// Security log (ASVS V16). The app role may only INSERT here; nobody reads it
// through the app. Never store document text in meta.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    orgId: uuid("org_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: uuid("resource_id"),
    outcome: auditOutcome("outcome").notNull(),
    reason: text("reason"),
    ip: text("ip"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_actor_idx").on(t.actorId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

// ------------------------------------------------------------------- AI

// One row per indexed passage. Each chunk copies its source's tenant,
// project, label and version so retrieval can filter inside the vector
// query (never after it). Chunks are deleted by trigger when a document's AI
// flag is turned off or its visibility changes.
export const aiChunks = pgTable(
  "ai_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    sourceType: chunkSource("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceVersion: integer("source_version").notNull().default(1),
    visibility: visibility("visibility").notNull(),
    ownerUserId: uuid("owner_user_id"),
    chunkIndex: integer("chunk_index").notNull(),
    lang: text("lang"),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    // Keyword search alongside vectors. 'simple' keeps Arabic tokens as-is.
    tsv: tsvector("tsv").generatedAlwaysAs((): SQL => sql`to_tsvector('simple', ${aiChunks.content})`),
    createdAt: createdAt(),
  },
  (t) => [
    scopedFk("ai_chunks", t),
    index("ai_chunks_source_idx").on(t.sourceType, t.sourceId),
    index("ai_chunks_project_idx").on(t.projectId),
    index("ai_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("ai_chunks_tsv_idx").using("gin", t.tsv),
  ],
);

export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<Array<{ chunkId: string; sourceType: string; sourceId: string; version: number }>>(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_messages_conversation_idx").on(t.conversationId)],
);

// ------------------------------------------------------------- accounts

// An invitation to join one organisation in one role, bound to one address.
// Only the token's hash is stored; the link goes to that address only.
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: role("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => user.id),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    acceptedUserId: uuid("accepted_user_id").references(() => user.id),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_one_open").on(t.email).where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    index("invitations_org_idx").on(t.orgId),
  ],
);

// An admin's change of someone's sign-in address, confirmed from the new address.
export const emailChanges = pgTable(
  "email_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    oldEmail: text("old_email").notNull(),
    newEmail: text("new_email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => user.id),
    expiresAt: ts("expires_at").notNull(),
    confirmedAt: ts("confirmed_at"),
    cancelledAt: ts("cancelled_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("email_changes_one_open").on(t.userId).where(sql`${t.confirmedAt} IS NULL AND ${t.cancelledAt} IS NULL`)],
);

// "Are these people still with you?" Without single sign-on, a client's own
// offboarding never reaches Selah, so each admin confirms their list.
export const accessReviews = pgTable(
  "access_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    reviewedBy: uuid("reviewed_by")
      .notNull()
      .references(() => user.id),
    kept: uuid("kept").array().notNull(),
    deactivated: uuid("deactivated").array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("access_reviews_org_idx").on(t.orgId, t.createdAt)],
);

// People at a client the firm deals with who have no login (consultant-managed
// engagements): action owners by name, meeting invitees. Firm-only.
export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    createdBy: uuid("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("client_contacts_org_idx").on(t.orgId)],
);

// Mail waiting to be sent. Links only, never content: the reader signs in
// to see anything. A sender job delivers and stamps sent_at.
export const outboundEmails = pgTable("outbound_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  toEmail: text("to_email").notNull(),
  kind: text("kind").notNull(),
  link: text("link"),
  locale: text("locale").notNull().default("ar"),
  createdAt: createdAt(),
  sentAt: ts("sent_at"),
});
