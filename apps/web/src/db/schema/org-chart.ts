// The client's organisation structure (org chart, migration 0091). Like its
// business indicators it belongs to the client, not to a project.
//
// It is a structure of positions, not of people: a position outlives whoever
// sits in it. The firm keeps a draft and publishes versions; each published
// version keeps its own rows (frozen by the database) and a frozen copy of
// its structure (published_snapshot) for the client view, the PDF and the
// history. People sit in positions through position_holders, dated, and a
// holding follows the position across versions (lineage_id), so publishing a
// new drawing never loses who holds what.
//
// The chart never grants or limits access to any work. A unit linked to one
// of the client's departments carries a label; departments stay the only rule
// for who sees work. Selah records the structure the firm decides and never
// designs, scores or judges one.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { departments, documents, organizations } from "./app";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const orgUnitKind = pgEnum("org_unit_kind", ["board", "committee", "executive", "sector", "department", "section", "unit", "office"]);
// draft: the firm's working copy (one per chart); published: the current
// structure (one per chart); superseded: history, never deleted.
export const orgChartState = pgEnum("org_chart_state", ["draft", "published", "superseded"]);
export const orgChartRequestStatus = pgEnum("org_chart_request_status", ["open", "done", "declined"]);

// One per client. Written only by app_start_org_chart().
export const orgCharts = pgTable(
  "org_charts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .unique()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [unique("org_charts_id_org_uq").on(t.id, t.orgId)],
);

// The draft and every published version. Written only by the database's own
// functions (start, publish, the client admin's names switch); the snapshot
// and what was published never change.
export const orgChartVersions = pgTable(
  "org_chart_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id").notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    state: orgChartState("state").notNull().default("draft"),
    // 1, 2, 3... given at publishing.
    number: integer("number"),
    // The day the structure takes effect (the board's resolution says when).
    effectiveOn: date("effective_on"),
    publishedBy: uuid("published_by").references(() => user.id),
    publishedAt: ts("published_at"),
    supersededAt: ts("superseded_at"),
    // The board resolution that approved it, an optional file of the client's.
    resolutionDocumentId: uuid("resolution_document_id").references(() => documents.id, { onDelete: "set null" }),
    // Whether the client's managers see holders' names at all (the client admin's switch).
    showNames: boolean("show_names").notNull().default(false),
    // The structure as published: units and positions, no names.
    publishedSnapshot: jsonb("published_snapshot"),
    // The published version a draft was copied from.
    basedOnId: uuid("based_on_id").references((): AnyPgColumn => orgChartVersions.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "org_chart_versions_chart_fk", columns: [t.chartId, t.orgId], foreignColumns: [orgCharts.id, orgCharts.orgId] }).onDelete("cascade"),
    unique("org_chart_versions_id_org_uq").on(t.id, t.orgId),
    uniqueIndex("org_chart_versions_one_draft").on(t.chartId).where(sql`${t.state} = 'draft'`),
    uniqueIndex("org_chart_versions_one_current").on(t.chartId).where(sql`${t.state} = 'published'`),
    uniqueIndex("org_chart_versions_number_uq").on(t.chartId, t.number),
    check(
      "org_chart_version_published",
      sql`(${t.state} = 'draft') = (${t.number} IS NULL) AND (${t.state} = 'draft') = (${t.effectiveOn} IS NULL)
        AND (${t.state} = 'draft') = (${t.publishedAt} IS NULL) AND (${t.state} = 'draft') = (${t.publishedSnapshot} IS NULL)`,
    ),
    check("org_chart_version_superseded", sql`(${t.state} = 'superseded') = (${t.supersededAt} IS NOT NULL)`),
  ],
);

// A unit of a version: board, committee, executive, sector, department,
// section, unit or office, in a tree. An advisory unit is drawn with a dotted
// line beside its parent (internal audit beside the chief executive). The
// department link is a label only.
export const orgUnits = pgTable(
  "org_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => orgUnits.id),
    kind: orgUnitKind("kind").notNull(),
    code: text("code").notNull(),
    nameAr: text("name_ar"),
    nameEn: text("name_en"),
    level: smallint("level").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    advisory: boolean("advisory").notNull().default(false),
    departmentId: uuid("department_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "org_units_version_fk", columns: [t.versionId, t.orgId], foreignColumns: [orgChartVersions.id, orgChartVersions.orgId] }).onDelete("cascade"),
    foreignKey({ name: "org_units_department_fk", columns: [t.departmentId, t.orgId], foreignColumns: [departments.id, departments.orgId] }),
    uniqueIndex("org_units_code_uq").on(t.versionId, t.code),
    index("org_units_parent_idx").on(t.parentId),
    index("org_units_department_idx").on(t.departmentId),
    check("org_unit_named", sql`coalesce(${t.nameAr}, ${t.nameEn}) IS NOT NULL`),
    check("org_unit_name_length", sql`char_length(coalesce(${t.nameAr}, '')) <= 200 AND char_length(coalesce(${t.nameEn}, '')) <= 200`),
    check("org_unit_code", sql`${t.code} ~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$'`),
    check("org_unit_level", sql`${t.level} BETWEEN 1 AND 12`),
    check("org_unit_not_own_parent", sql`${t.parentId} IS DISTINCT FROM ${t.id}`),
  ],
);

// A position of a version: its unit, code and titles, whom it reports to,
// whether it heads the unit, its specialties and how many people it is
// planned for. lineage_id is the same position across versions: the id of
// its first row (that row's own id), copied into each new draft.
export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => orgUnits.id, { onDelete: "cascade" }),
    lineageId: uuid("lineage_id")
      .notNull()
      .references((): AnyPgColumn => positions.id),
    code: text("code").notNull(),
    titleAr: text("title_ar"),
    titleEn: text("title_en"),
    reportsToId: uuid("reports_to_id").references((): AnyPgColumn => positions.id),
    isHead: boolean("is_head").notNull().default(false),
    specialties: text("specialties").array().notNull().default(sql`'{}'::text[]`),
    plannedCount: smallint("planned_count").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "positions_version_fk", columns: [t.versionId, t.orgId], foreignColumns: [orgChartVersions.id, orgChartVersions.orgId] }).onDelete("cascade"),
    uniqueIndex("positions_code_uq").on(t.versionId, t.code),
    uniqueIndex("positions_lineage_uq").on(t.versionId, t.lineageId),
    uniqueIndex("positions_one_head").on(t.unitId).where(sql`${t.isHead}`),
    index("positions_unit_idx").on(t.unitId),
    index("positions_reports_to_idx").on(t.reportsToId),
    index("positions_lineage_idx").on(t.lineageId),
    check("position_titled", sql`coalesce(${t.titleAr}, ${t.titleEn}) IS NOT NULL`),
    check("position_title_length", sql`char_length(coalesce(${t.titleAr}, '')) <= 200 AND char_length(coalesce(${t.titleEn}, '')) <= 200`),
    check("position_code", sql`${t.code} ~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$'`),
    check("position_planned", sql`${t.plannedCount} BETWEEN 1 AND 999`),
    check("position_specialties", sql`cardinality(${t.specialties}) <= 30`),
    check("position_not_own_manager", sql`${t.reportsToId} IS DISTINCT FROM ${t.id}`),
  ],
);

// Who sits in a position, from when to when: a Selah user of the client or a
// typed name. A position with no current holder is vacant. A holding belongs
// to the position's lineage, so it carries over to every version that keeps
// the position. Never deleted by the app: a holding ends (to_date).
export const positionHolders = pgTable(
  "position_holders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id").notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    positionLineageId: uuid("position_lineage_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id),
    name: text("name"),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    endedBy: uuid("ended_by").references(() => user.id),
    endedAt: ts("ended_at"),
  },
  (t) => [
    foreignKey({ name: "position_holders_chart_fk", columns: [t.chartId, t.orgId], foreignColumns: [orgCharts.id, orgCharts.orgId] }).onDelete("cascade"),
    index("position_holders_lineage_idx").on(t.positionLineageId, t.fromDate),
    index("position_holders_user_idx").on(t.userId),
    index("position_holders_chart_idx").on(t.chartId),
    check("position_holder_who", sql`num_nonnulls(${t.userId}, ${t.name}) = 1`),
    check("position_holder_name", sql`${t.name} IS NULL OR char_length(btrim(${t.name})) BETWEEN 2 AND 200`),
    check("position_holder_dates", sql`${t.toDate} IS NULL OR ${t.toDate} >= ${t.fromDate}`),
  ],
);

// A client admin's "suggest a change": what, where and why. It reaches the
// client's lead (and deputy); the firm makes the change in the draft and
// marks the request done or declined.
export const orgChartChangeRequests = pgTable(
  "org_chart_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id").notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    what: text("what").notNull(),
    whereText: text("where_text"),
    why: text("why"),
    status: orgChartRequestStatus("status").notNull().default("open"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    closedBy: uuid("closed_by").references(() => user.id),
    closedAt: ts("closed_at"),
  },
  (t) => [
    foreignKey({ name: "org_chart_change_requests_chart_fk", columns: [t.chartId, t.orgId], foreignColumns: [orgCharts.id, orgCharts.orgId] }).onDelete("cascade"),
    index("org_chart_change_requests_chart_idx").on(t.chartId, t.status),
    check("org_chart_request_what", sql`char_length(btrim(${t.what})) BETWEEN 3 AND 1000`),
    check("org_chart_request_texts", sql`char_length(coalesce(${t.whereText}, '')) <= 300 AND char_length(coalesce(${t.why}, '')) <= 1000`),
    check("org_chart_request_closed", sql`(${t.status} = 'open') = (${t.closedAt} IS NULL)`),
  ],
);
