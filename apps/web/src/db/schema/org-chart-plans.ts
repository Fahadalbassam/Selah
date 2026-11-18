// Planned holders (org chart, part 4; the coordinator's decision, 18 Nov
// 2026): who the firm plans to place in a position of its draft, from the
// import's holder column. People are placed only on the live structure
// (part 3's rule), so the draft keeps a plan, never a holding; publishing
// (part 5) turns the plans into holdings and clears them.
//
// Kept apart from `positions` on purpose: clients read every column of a
// published version's positions, and a plan is the firm's alone. Only the
// draft's editors read and write it (row-level security, migration
// 0170_org_chart_planned_holders); no client person ever reads one. A planned
// typed name joins the masking list like a typed holder's.
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./app";
import { user } from "./auth";
import { positions } from "./org-chart";

export const orgChartPlannedHolders = pgTable(
  "org_chart_planned_holders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // A position of the draft; the plan goes with it.
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    // One of the client's people with an account, or a typed name (never both).
    userId: uuid("user_id").references(() => user.id),
    name: text("name"),
    // The order the row listed them in.
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("org_chart_planned_holders_position_idx").on(t.positionId),
    index("org_chart_planned_holders_org_idx").on(t.orgId),
    uniqueIndex("org_chart_planned_holders_user_uq").on(t.positionId, t.userId),
    check("org_chart_planned_holder_who", sql`num_nonnulls(${t.userId}, ${t.name}) = 1`),
    check("org_chart_planned_holder_name", sql`${t.name} IS NULL OR char_length(btrim(${t.name})) BETWEEN 2 AND 200`),
  ],
);
