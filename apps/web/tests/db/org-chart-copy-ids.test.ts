// The organisation structure: the ids of the rows publishing copies into the
// next draft (migration 0115). Scenario 20 (20 Nov 2026) found that after a
// version was published the next draft could not be edited, and the people
// panel stopped loading from version 2 on: the copies' ids were
// md5(...)::uuid, not valid UUIDs, so every route's z.uuid() refused them.
// Here: every id publishing makes is a valid UUID; the draft after version 1
// and version 2 can be edited, a unit added, someone invited into a vacant
// position and the people panel read; and the repair turns ids made the old
// way into valid ones with every reference kept.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { invite } from "@/services/accounts";
import * as OC from "@/services/org-chart";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

vi.setConfig({ hookTimeout: 60_000, testTimeout: 30_000 });

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

// Valid UUIDs (version 4, variant 8), like the ones the database makes.
const id = (n: number) => `00000000-0000-4000-8c1d-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const P = id(3);
const U = { admin: id(21), lead: id(22), cadmin: id(23) };

/** What every org chart route checks an id with. */
const routeId = z.uuid();
const isRouteId = (x: string) => routeId.safeParse(x).success;

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>, commit = false) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!).catch((e: Error & { cause?: Error }) => {
        throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
      });
    },
    commit,
  );
const q = (text: string, params: unknown[] = []) => owner.query(text, params);

const draft = () => svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
const live = () => svc(U.lead, (tx, p) => OC.getPublishedChart(tx, p, ACME));
const publishDraft = async () => svc(U.lead, async (tx, p) => OC.publish(tx, p, ACME, { draftId: (await draft()).draft!.id, effectiveOn: firmToday() }), true);
/** Every unit and position id of the client's structure, all versions. */
const allIds = async () =>
  (
    await q(
      `SELECT id::text FROM org_units WHERE org_id = $1 UNION ALL SELECT id::text FROM positions WHERE org_id = $1
       UNION ALL SELECT parent_id::text FROM org_units WHERE org_id = $1 AND parent_id IS NOT NULL
       UNION ALL SELECT unit_id::text FROM positions WHERE org_id = $1
       UNION ALL SELECT reports_to_id::text FROM positions WHERE org_id = $1 AND reports_to_id IS NOT NULL`,
      [ACME],
    )
  ).rows.map((r) => r.id as string);

beforeAll(async () => {
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, engagement_mode, departments_enabled) VALUES
      ($1,'firm','Mizan Advisory','ميزان للاستشارات',NULL,false), ($2,'client','Acme Trading','شركة أكمي للتجارة','full',false)`,
    [FIRM, ACME],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [k, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, `Person ${k}`, `${k}@example.test`]);
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$4,'firm_admin'), ($2,$4,'consultant'), ($3,$5,'client_admin')`, [
    U.admin,
    U.lead,
    U.cadmin,
    FIRM,
    ACME,
  ]);
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`, [P, ACME, FIRM, U.admin]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES ($1,$2,true,false)`, [ACME, U.lead]);

  // Version 1's draft: the board with its chair, the chief executive's office with the CEO and a clerk reporting to the CEO.
  await svc(U.lead, (tx, p) => OC.startChart(tx, p, ACME), true);
  const board = (await svc(U.lead, (tx, p) => OC.addUnit(tx, p, ACME, { kind: "board", code: "1", nameEn: "Board" }), true)).id;
  const ceo = (await svc(U.lead, (tx, p) => OC.addUnit(tx, p, ACME, { kind: "executive", code: "2", nameEn: "Chief executive", parentId: board }), true)).id;
  const chair = (await svc(U.lead, (tx, p) => OC.addPosition(tx, p, board, { code: "1.1", titleEn: "Chair", isHead: true }), true)).id;
  const chief = (await svc(U.lead, (tx, p) => OC.addPosition(tx, p, ceo, { code: "2.1", titleEn: "CEO", isHead: true, reportsToId: chair }), true)).id;
  await svc(U.lead, (tx, p) => OC.addPosition(tx, p, ceo, { code: "2.2", titleEn: "Clerk", reportsToId: chief }), true);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the ids publishing makes", () => {
  it("the copy's id is a valid UUID, the same in the database and in publishPreview()'s pairing", async () => {
    const pairs = [
      [id(901), id(902)],
      ["a9810ef3-3d79-405a-b5e3-ca96a900dd6a", "8660cc23-a53e-cc43-6dd2-83b2b18553d1"],
    ] as const;
    for (const [dst, src] of pairs) {
      const { rows } = await q(`SELECT app_org_chart_copied_id($1, $2)::text AS x`, [dst, src]);
      expect(rows[0].x).toBe(OC.copiedId(dst, src));
      expect(isRouteId(rows[0].x)).toBe(true);
    }
  });

  it("after version 1: every id is one the routes accept, and the next draft can be edited and grown", async () => {
    expect((await publishDraft()).number).toBe(1);
    expect((await allIds()).filter((x) => !isRouteId(x))).toEqual([]);
    const d = await draft();
    const ceo = d.units.find((u) => u.code === "2")!;
    // Editing a unit of the draft (PATCH /api/org-chart/units/:unitId) and adding one under it (POST .../structure/units).
    await svc(U.lead, (tx, p) => OC.updateUnit(tx, p, ceo.id, { nameEn: "Chief executive's office" }), true);
    const added = await svc(U.lead, (tx, p) => OC.addUnit(tx, p, ACME, { kind: "department", code: "2.3", nameEn: "Finance", parentId: ceo.id }), true);
    expect(isRouteId(added.id)).toBe(true);
    await svc(U.lead, (tx, p) => OC.addPosition(tx, p, added.id, { code: "2.3.1", titleEn: "CFO", isHead: true, reportsToId: d.positions.find((x) => x.code === "2.1")!.id }), true);
    // The publishing screen pairs the draft's units with version 1's by the copy's id: only the new unit is new.
    const preview = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, ACME));
    expect(preview.changes.units.added.map((u) => u.code)).toEqual(["2.3"]);
    expect(preview.changes.units.removed).toEqual([]);
  });

  it("the people panel loads on version 1, and someone can be invited into its vacant position", async () => {
    const v1 = await live();
    const clerk = v1.positions.find((x) => x.code === "2.2")!;
    expect(isRouteId(clerk.id)).toBe(true);
    const listed = await svc(U.cadmin, (tx, p) => OC.listHoldings(tx, p, clerk.id));
    expect(listed.holdings).toEqual([]);
    const inv = await svc(U.cadmin, (tx, p) => invite(tx, p, { orgId: ACME, email: "clerk1@example.test", name: "New Clerk", role: "action_owner", positionId: clerk.id }));
    expect(inv).toBeTruthy();
  });

  it("after version 2 (made of copies): the same, on version 2 and on the draft after it", async () => {
    expect((await publishDraft()).number).toBe(2);
    expect((await allIds()).filter((x) => !isRouteId(x))).toEqual([]);
    const v2 = await live();
    // Version 2's positions are the rows copied into the draft at version 1's publishing.
    for (const p of v2.positions) {
      expect(isRouteId(p.id), p.code).toBe(true);
      const listed = await svc(U.cadmin, (tx, pr) => OC.listHoldings(tx, pr, p.id));
      expect(listed.holdings, p.code).toEqual([]);
    }
    const cfo = v2.positions.find((x) => x.code === "2.3.1")!;
    await svc(U.cadmin, (tx, p) => invite(tx, p, { orgId: ACME, email: "cfo@example.test", name: "New CFO", role: "client_manager", positionId: cfo.id }), true);
    const d = await draft();
    const fin = d.units.find((u) => u.code === "2.3")!;
    await svc(U.lead, (tx, p) => OC.updateUnit(tx, p, fin.id, { nameEn: "Finance and accounts" }), true);
    await svc(U.lead, (tx, p) => OC.addUnit(tx, p, ACME, { kind: "department", code: "2.3.9", nameEn: "Treasury", parentId: fin.id }));
  });
});

// The copy as migration 0091 wrote it: md5(...)::uuid, not a valid UUID.
const OLD_COPY = `CREATE OR REPLACE FUNCTION app_org_chart_copy(src uuid, dst uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO org_units (id, version_id, org_id, parent_id, kind, code, name_ar, name_en, level, sort_order, advisory, department_id)
    SELECT md5(dst::text || u.id::text)::uuid, dst, u.org_id, NULL, u.kind, u.code, u.name_ar, u.name_en, u.level, u.sort_order, u.advisory,
      CASE WHEN d.active THEN u.department_id END
    FROM org_units u LEFT JOIN departments d ON d.id = u.department_id WHERE u.version_id = src;
  UPDATE org_units n SET parent_id = md5(dst::text || u.parent_id::text)::uuid
    FROM org_units u WHERE u.version_id = src AND u.parent_id IS NOT NULL AND n.id = md5(dst::text || u.id::text)::uuid;
  INSERT INTO positions (id, version_id, org_id, unit_id, lineage_id, code, title_ar, title_en, reports_to_id, is_head, specialties, planned_count, sort_order)
    SELECT md5(dst::text || p.id::text)::uuid, dst, p.org_id, md5(dst::text || p.unit_id::text)::uuid, p.lineage_id, p.code, p.title_ar, p.title_en,
      NULL, p.is_head, p.specialties, p.planned_count, p.sort_order
    FROM positions p WHERE p.version_id = src;
  UPDATE positions n SET reports_to_id = md5(dst::text || p.reports_to_id::text)::uuid
    FROM positions p WHERE p.version_id = src AND p.reports_to_id IS NOT NULL AND n.id = md5(dst::text || p.id::text)::uuid;
END $$`;
// The copy as migration 0115 writes it, read from the migration itself.
const newCopy = () =>
  readFileSync(fileURLToPath(new URL("../../drizzle/0115_org_chart_copy_ids.sql", import.meta.url)), "utf8")
  .split("--> statement-breakpoint")
  .find((s) => s.includes("CREATE OR REPLACE FUNCTION app_org_chart_copy("))!
  .replace(/^[\s\S]*?(?=CREATE OR REPLACE FUNCTION app_org_chart_copy\()/, "");

/** The structure as codes only (what the repair must keep), per version number (null: the draft). */
const shape = async (c: PoolClient) =>
  (
    await c.query(
      `SELECT v.number, 'unit' AS kind, u.code, pu.code AS parent, NULL AS unit, NULL AS reports
         FROM org_units u JOIN org_chart_versions v ON v.id = u.version_id LEFT JOIN org_units pu ON pu.id = u.parent_id WHERE u.org_id = $1
       UNION ALL
       SELECT v.number, 'position', p.code, NULL, pu.code, rp.code
         FROM positions p JOIN org_chart_versions v ON v.id = p.version_id JOIN org_units pu ON pu.id = p.unit_id
         LEFT JOIN positions rp ON rp.id = p.reports_to_id WHERE p.org_id = $1
       ORDER BY 1 NULLS LAST, 2, 3`,
      [ACME],
    )
  ).rows;

describe("the repair of ids made the old way (migration 0115)", () => {
  it("gives every copied row a valid id, keeps every reference, the plans, the snapshots and the pairing, and a second run changes nothing", async () => {
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('selah.user_id', $1, true)", [U.lead]);
      // Two versions published with the old copy, so the draft holds copies of copies, and a plan on the draft.
      await c.query(OLD_COPY);
      const chart = (await c.query(`SELECT id FROM org_charts WHERE org_id = $1`, [ACME])).rows[0].id as string;
      const draftNow = async () => (await c.query(`SELECT id FROM org_chart_versions WHERE chart_id = $1 AND state = 'draft'`, [chart])).rows[0].id as string;
      for (let i = 0; i < 2; i++) await c.query(`SELECT app_publish_org_chart($1, $2, $3::date, NULL)`, [chart, await draftNow(), firmToday()]);
      const d = await draftNow();
      const clerk = (await c.query(`SELECT id FROM positions WHERE version_id = $1 AND code = '2.2'`, [d])).rows[0].id as string;
      await c.query(`INSERT INTO org_chart_planned_holders (org_id, position_id, name, sort_order, created_by) VALUES ($1,$2,'Typed Planned',0,$3)`, [ACME, clerk, U.lead]);
      const ids = async () =>
        (await c.query(`SELECT id::text FROM org_units WHERE org_id = $1 UNION ALL SELECT id::text FROM positions WHERE org_id = $1`, [ACME])).rows.map(
          (r) => r.id as string,
        );
      expect((await ids()).filter((x) => !isRouteId(x)).length).toBeGreaterThan(0);
      const before = await shape(c);
      const lineages = (await c.query(`SELECT code, lineage_id FROM positions WHERE org_id = $1 ORDER BY 1, 2`, [ACME])).rows;

      const changed = Number((await c.query(`SELECT app_org_chart_repair_copied_ids() AS n`)).rows[0].n);
      expect(changed).toBeGreaterThan(0);
      expect((await ids()).filter((x) => !isRouteId(x))).toEqual([]);
      expect(await shape(c)).toEqual(before);
      expect((await c.query(`SELECT code, lineage_id FROM positions WHERE org_id = $1 ORDER BY 1, 2`, [ACME])).rows).toEqual(lineages);
      // The plan moved with its position.
      const plans = (await c.query(`SELECT p.code, p.version_id FROM org_chart_planned_holders h JOIN positions p ON p.id = h.position_id WHERE h.org_id = $1`, [ACME])).rows;
      expect(plans).toEqual([{ code: "2.2", version_id: d }]);
      // Each published version's snapshot names exactly its own rows.
      const versions = (await c.query(`SELECT id, published_snapshot AS s FROM org_chart_versions WHERE chart_id = $1 AND state <> 'draft'`, [chart])).rows;
      expect(versions).toHaveLength(4);
      for (const v of versions) {
        const units = (await c.query(`SELECT id::text FROM org_units WHERE version_id = $1 ORDER BY 1`, [v.id])).rows.map((r) => r.id);
        const positions = (await c.query(`SELECT id::text, unit_id::text FROM positions WHERE version_id = $1 ORDER BY 1`, [v.id])).rows;
        expect((v.s.units as { id: string }[]).map((u) => u.id).sort()).toEqual(units);
        expect((v.s.positions as { id: string; unitId: string }[]).map((p) => ({ id: p.id, unit_id: p.unitId })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(positions);
      }
      // publishPreview() still finds each draft unit's source in the current version.
      const cur = (await c.query(`SELECT id FROM org_chart_versions WHERE chart_id = $1 AND state = 'published'`, [chart])).rows[0].id as string;
      const pairs = (
        await c.query(`SELECT s.id::text AS src, n.id::text AS copy FROM org_units s JOIN org_units n ON n.code = s.code AND n.version_id = $2 WHERE s.version_id = $1`, [cur, d])
      ).rows;
      expect(pairs.length).toBeGreaterThan(0);
      for (const p of pairs) expect(p.copy).toBe(OC.copiedId(d, p.src));
      // Safe to run again.
      expect(Number((await c.query(`SELECT app_org_chart_repair_copied_ids() AS n`)).rows[0].n)).toBe(0);
      // The rules are back on: a published version still never changes.
      await c.query("SAVEPOINT rules");
      await expect(c.query(`UPDATE org_units SET name_en = 'X' WHERE version_id = $1`, [cur])).rejects.toThrow(/a published structure never changes/);
      await c.query("ROLLBACK TO SAVEPOINT rules");
      await c.query(newCopy());
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    // The rules (triggers) are on again: the published version refuses an edit through the service.
    const cur = await live();
    await expect(svc(U.lead, (tx, p) => OC.updateUnit(tx, p, cur.units[0]!.id, { nameEn: "Changed" }))).rejects.toThrow(/published/);
    // And the repaired structure works through the services.
    const d = await draft();
    await svc(U.lead, (tx, p) => OC.updateUnit(tx, p, d.units.find((u) => u.code === "2")!.id, { nameEn: "Office" }), true);
    for (const p of cur.positions) await svc(U.cadmin, (tx, pr) => OC.listHoldings(tx, pr, p.id));
    const preview = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, ACME));
    expect(preview.changes.units.added).toEqual([]);
    expect(preview.changes.units.removed).toEqual([]);
  });
});
