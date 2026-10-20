// Selah's business tables.
//
// Tenant rule: every row that belongs to a client engagement carries both
// engagement_id and client_org_id. A composite foreign key to
// engagements(id, client_org_id) makes it impossible for the two to disagree,
// and the row-level security policies (drizzle/0001_security.sql) key on them.
//
// Visibility labels come from the Scope, Permissions and AI Access Spec:
//   shared          - everyone in the engagement who passes the other checks
//   maayish_private - Maayish staff only
//   client_private  - the client org only (not even the Maayish lead)
//   user_private    - only the user who created it
import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  customType,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const orgKind = pgEnum("org_kind", ["maayish", "client"]);
export const orgStatus = pgEnum("org_status", ["active", "archived"]);
export const role = pgEnum("role", [
  "maayish_lead",
  "consultant",
  "client_admin",
  "client_manager",
  "action_owner",
]);
export const visibility = pgEnum("visibility", [
  "shared",
  "maayish_private",
  "client_private",
  "user_private",
]);
export const engagementState = pgEnum("engagement_state", ["planned", "active", "closed"]);
export const priority = pgEnum("priority", ["low", "medium", "high", "critical"]);
export const actionStatus = pgEnum("action_status", [
  "draft",
  "assigned",
  "in_progress",
  "blocked",
  "awaiting_review",
  "revision_requested",
  "verified_complete",
]);
export const reviewOutcome = pgEnum("review_outcome", ["accept", "revise", "reject"]);
export const documentPurpose = pgEnum("document_purpose", ["deliverable", "client_document", "evidence"]);
export const documentState = pgEnum("document_state", ["draft", "submitted", "archived"]);
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
  createdAt: createdAt(),
});

// One active membership per user: a person belongs to exactly one tenant.
// A trigger checks that Maayish roles only sit in the Maayish org and client
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
    createdAt: createdAt(),
  },
  (t) => [index("org_memberships_org_idx").on(t.orgId)],
);

export const engagements = pgTable(
  "engagements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrgId: uuid("client_org_id")
      .notNull()
      .references(() => organizations.id),
    maayishOrgId: uuid("maayish_org_id")
      .notNull()
      .references(() => organizations.id),
    title: text("title").notNull(),
    description: text("description"),
    state: engagementState("state").notNull().default("planned"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdBy: uuid("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("engagements_id_client_org_uq").on(t.id, t.clientOrgId),
    index("engagements_client_org_idx").on(t.clientOrgId),
  ],
);

export const engagementMembers = pgTable(
  "engagement_members",
  {
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.engagementId, t.userId] }), index("engagement_members_user_idx").on(t.userId)],
);

// Columns every engagement-scoped table shares, plus the composite FK that
// pins client_org_id to the engagement's real client.
const scoped = () => ({
  engagementId: uuid("engagement_id").notNull(),
  clientOrgId: uuid("client_org_id").notNull(),
});
const scopedFk = (name: string, t: { engagementId: AnyPgColumn; clientOrgId: AnyPgColumn }) =>
  foreignKey({
    name: `${name}_engagement_fk`,
    columns: [t.engagementId, t.clientOrgId],
    foreignColumns: [engagements.id, engagements.clientOrgId],
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
  (t) => [scopedFk("findings", t), index("findings_engagement_idx").on(t.engagementId)],
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
    visibility: visibility("visibility").notNull().default("shared"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [scopedFk("recommendations", t), index("recommendations_engagement_idx").on(t.engagementId)],
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
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    scopedFk("actions", t),
    index("actions_engagement_idx").on(t.engagementId),
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
    visibility: visibility("visibility").notNull().default("shared"),
    aiIndexable: boolean("ai_indexable").notNull().default(false),
    version: integer("version").notNull().default(1),
    supersedesId: uuid("supersedes_id"),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    scopedFk("documents", t),
    foreignKey({ name: "documents_supersedes_fk", columns: [t.supersedesId], foreignColumns: [t.id] }),
    index("documents_engagement_idx").on(t.engagementId),
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
    submittedAt: createdAt(),
  },
  (t) => [scopedFk("evidence_submissions", t), index("evidence_action_idx").on(t.actionId)],
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
    visibility: visibility("visibility").notNull().default("maayish_private"),
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
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("follow_ups", t)],
);

// Reports start Maayish-private and become shared only when a consultant
// shares them.
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scoped(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    visibility: visibility("visibility").notNull().default("maayish_private"),
    generatedBy: uuid("generated_by")
      .notNull()
      .references(() => user.id),
    sharedAt: ts("shared_at"),
    createdAt: createdAt(),
  },
  (t) => [scopedFk("reports", t)],
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
// engagement, label and version so retrieval can filter inside the vector
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
    index("ai_chunks_engagement_idx").on(t.engagementId),
    index("ai_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("ai_chunks_tsv_idx").using("gin", t.tsv),
  ],
);

export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  engagementId: uuid("engagement_id")
    .notNull()
    .references(() => engagements.id, { onDelete: "cascade" }),
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
