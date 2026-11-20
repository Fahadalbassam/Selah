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
// A function of migration 0115, read from the migration itself (the repair is dropped once it has run).
const fromMigration = (name: string) => {
  const chunk = readFileSync(fileURLToPath(new URL("../../drizzle/0115_org_chart_copy_ids.sql", import.meta.url)), "utf8")
    .split("--> statement-breakpoint")
    .find((s) => s.includes(name))!;
  return chunk.slice(chunk.indexOf(name));
};
const newCopy = () => fromMigration("CREATE OR REPLACE FUNCTION app_org_chart_copy(");
const repairFunction = () => fromMigration("CREATE FUNCTION app_org_chart_repair_copied_ids(");

/** The structure as codes only (what the repair must keep), per version number (null: the draft). */
const shape = async (c: PoolClient, org = ACME) =>
  (
    await c.query(
      `SELECT v.number, 'unit' AS kind, u.code, pu.code AS parent, NULL AS unit, NULL AS reports
         FROM org_units u JOIN org_chart_versions v ON v.id = u.version_id LEFT JOIN org_units pu ON pu.id = u.parent_id WHERE u.org_id = $1
       UNION ALL
       SELECT v.number, 'position', p.code, NULL, pu.code, rp.code
         FROM positions p JOIN org_chart_versions v ON v.id = p.version_id JOIN org_units pu ON pu.id = p.unit_id
         LEFT JOIN positions rp ON rp.id = p.reports_to_id WHERE p.org_id = $1
       ORDER BY 1 NULLS LAST, 2, 3`,
      [org],
    )
  ).rows;

const BETA = id(4); // a second client, with a structure of its own
const BETA_ADMIN = id(24);

describe("the repair of ids made the old way (migration 0115)", () => {
  beforeAll(async () => {
    await q(`INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES ($1,'client','Beta Holding','full',false)`, [BETA]);
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1,'Person beta','beta@example.test')`, [BETA_ADMIN]);
    await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'client_admin')`, [BETA_ADMIN, BETA]);
    await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES ($1,$2,true,false)`, [BETA, U.lead]);
    await svc(U.lead, (tx, p) => OC.startChart(tx, p, BETA), true);
    const top = (await svc(U.lead, (tx, p) => OC.addUnit(tx, p, BETA, { kind: "board", code: "1", nameEn: "Board" }), true)).id;
    const head = (await svc(U.lead, (tx, p) => OC.addPosition(tx, p, top, { code: "1.1", titleEn: "Chair", isHead: true }), true)).id;
    await svc(U.lead, (tx, p) => OC.addPosition(tx, p, top, { code: "1.2", titleEn: "Secretary", reportsToId: head }), true);
  });

  it("is dropped once it has run; the copy's id function stays", async () => {
    const { rows } = await q(`SELECT proname FROM pg_proc WHERE proname IN ('app_org_chart_repair_copied_ids', 'app_org_chart_copied_id') ORDER BY 1`);
    expect(rows.map((r) => r.proname)).toEqual(["app_org_chart_copied_id"]);
  });

  it("gives every copied row a valid id at every client, keeps references, plans, holdings, invitations, snapshots and the pairing, and audits old and new ids", async () => {
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('selah.user_id', $1, true)", [U.lead]);
      await c.query(repairFunction());
      // Versions published with the old copy at both clients (copies of copies at Acme), and Acme's draft started again.
      await c.query(OLD_COPY);
      const chartOf = async (org: string) => (await c.query(`SELECT id FROM org_charts WHERE org_id = $1`, [org])).rows[0].id as string;
      const draftNow = async (org: string) =>
        (await c.query(`SELECT id FROM org_chart_versions WHERE chart_id = $1 AND state = 'draft'`, [await chartOf(org)])).rows[0].id as string;
      const publishOld = async (org: string) => c.query(`SELECT app_publish_org_chart($1, $2, $3::date, NULL)`, [await chartOf(org), await draftNow(org), firmToday()]);
      for (let i = 0; i < 2; i++) await publishOld(ACME);
      await publishOld(BETA);
      await c.query(`SELECT app_reset_org_chart_draft($1, $2)`, [await chartOf(ACME), await draftNow(ACME)]);
      const d = await draftNow(ACME);
      const draftClerk = (await c.query(`SELECT id FROM positions WHERE version_id = $1 AND code = '2.2'`, [d])).rows[0].id as string;
      await c.query(`INSERT INTO org_chart_planned_holders (org_id, position_id, name, sort_order, created_by) VALUES ($1,$2,'Typed Planned',0,$3)`, [ACME, draftClerk, U.lead]);
      // A holding on a position of the current version, which is a copy (holdings follow the lineage).
      const liveClerk = (
        await c.query(
          `SELECT p.id, p.lineage_id FROM positions p JOIN org_chart_versions v ON v.id = p.version_id WHERE v.org_id = $1 AND v.state = 'published' AND p.code = '2.2'`,
          [ACME],
        )
      ).rows[0] as { id: string; lineage_id: string };
      expect(isRouteId(liveClerk.id)).toBe(false);
      await c.query(`INSERT INTO position_holders (chart_id, org_id, position_lineage_id, name, from_date, created_by) VALUES ($1,$2,$3,'Typed Clerk',$4::date,$5)`, [
        await chartOf(ACME),
        ACME,
        liveClerk.lineage_id,
        firmToday(),
        U.lead,
      ]);
      // The CFO's invitation, made on version 2 (a copy) above.
      const invitations = (await c.query(`SELECT id, position_lineage_id FROM invitations WHERE org_id = $1 AND position_lineage_id IS NOT NULL ORDER BY id`, [ACME])).rows;
      expect(invitations).toHaveLength(1);
      const ids = async (org: string) =>
        (await c.query(`SELECT id::text FROM org_units WHERE org_id = $1 UNION ALL SELECT id::text FROM positions WHERE org_id = $1`, [org])).rows.map((r) => r.id as string);
      for (const org of [ACME, BETA]) expect((await ids(org)).filter((x) => !isRouteId(x)).length, org).toBeGreaterThan(0);
      const before = { acme: await shape(c, ACME), beta: await shape(c, BETA) };
      const lineages = (await c.query(`SELECT org_id, code, lineage_id FROM positions ORDER BY 1, 2, 3`)).rows;
      const holdings = (await c.query(`SELECT * FROM position_holders ORDER BY id`)).rows;
      const oldIds = new Set([...(await ids(ACME)), ...(await ids(BETA))]);
      const timeout = (await c.query(`SELECT current_setting('lock_timeout') AS t`)).rows[0].t;

      const changed = Number((await c.query(`SELECT app_org_chart_repair_copied_ids() AS n`)).rows[0].n);
      expect(changed).toBeGreaterThan(0);
      expect((await c.query(`SELECT current_setting('lock_timeout') AS t`)).rows[0].t).toBe(timeout);
      for (const org of [ACME, BETA]) expect((await ids(org)).filter((x) => !isRouteId(x)), org).toEqual([]);
      expect({ acme: await shape(c, ACME), beta: await shape(c, BETA) }).toEqual(before);
      expect((await c.query(`SELECT org_id, code, lineage_id FROM positions ORDER BY 1, 2, 3`)).rows).toEqual(lineages);
      // Holdings and invitations point at lineages, which never change.
      expect((await c.query(`SELECT * FROM position_holders ORDER BY id`)).rows).toEqual(holdings);
      expect((await c.query(`SELECT id, position_lineage_id FROM invitations WHERE org_id = $1 AND position_lineage_id IS NOT NULL ORDER BY id`, [ACME])).rows).toEqual(
        invitations,
      );
      // The plan moved with its position.
      const plans = (await c.query(`SELECT p.code, p.version_id FROM org_chart_planned_holders h JOIN positions p ON p.id = h.position_id WHERE h.org_id = $1`, [ACME])).rows;
      expect(plans).toEqual([{ code: "2.2", version_id: d }]);
      // Each published version's snapshot names exactly its own rows.
      const versions = (await c.query(`SELECT id, published_snapshot AS s FROM org_chart_versions WHERE org_id = ANY($1) AND state <> 'draft'`, [[ACME, BETA]])).rows;
      expect(versions).toHaveLength(5);
      for (const v of versions) {
        const units = (await c.query(`SELECT id::text FROM org_units WHERE version_id = $1 ORDER BY 1`, [v.id])).rows.map((r) => r.id);
        const positions = (await c.query(`SELECT id::text, unit_id::text FROM positions WHERE version_id = $1 ORDER BY 1`, [v.id])).rows;
        expect((v.s.units as { id: string }[]).map((u) => u.id).sort()).toEqual(units);
        expect(
          (v.s.positions as { id: string; unitId: string }[]).map((p) => ({ id: p.id, unit_id: p.unitId })).sort((a, b) => a.id.localeCompare(b.id)),
        ).toEqual(positions);
      }
      // publishPreview() still finds each draft unit's source in the current version.
      const cur = (await c.query(`SELECT id FROM org_chart_versions WHERE org_id = $1 AND state = 'published'`, [ACME])).rows[0].id as string;
      const pairs = (
        await c.query(`SELECT s.id::text AS src, n.id::text AS copy FROM org_units s JOIN org_units n ON n.code = s.code AND n.version_id = $2 WHERE s.version_id = $1`, [
          cur,
          d,
        ])
      ).rows;
      expect(pairs.length).toBeGreaterThan(0);
      for (const p of pairs) expect(p.copy).toBe(OC.copiedId(d, p.src));
      // One system row per client: no actor, the counts, and every old -> new id, each new one a row of that client today.
      const audit = (await c.query(`SELECT org_id, actor_id, resource_id, meta FROM audit_log WHERE action = 'org_chart.id_repair' ORDER BY org_id`)).rows as {
        org_id: string;
        actor_id: string | null;
        resource_id: string;
        meta: { units: number; positions: number; ids: { kind: "unit" | "position"; old: string; new: string; version: string }[] };
      }[];
      expect(audit.map((r) => [r.org_id, r.actor_id, r.resource_id])).toEqual([
        [ACME, null, await chartOf(ACME)],
        [BETA, null, await chartOf(BETA)],
      ]);
      let total = 0;
      for (const r of audit) {
        expect(r.meta.ids.filter((m) => m.kind === "unit")).toHaveLength(r.meta.units);
        expect(r.meta.ids.filter((m) => m.kind === "position")).toHaveLength(r.meta.positions);
        total += r.meta.ids.length;
        for (const m of r.meta.ids) {
          expect(oldIds.has(m.old), m.old).toBe(true);
          const now = (await c.query(`SELECT org_id, version_id FROM ${m.kind === "unit" ? "org_units" : "positions"} WHERE id = $1`, [m.new])).rows;
          expect(now).toEqual([{ org_id: r.org_id, version_id: m.version }]);
        }
      }
      expect(total).toBe(changed);
      // A second run changes nothing and audits nothing more.
      expect(Number((await c.query(`SELECT app_org_chart_repair_copied_ids() AS n`)).rows[0].n)).toBe(0);
      expect(Number((await c.query(`SELECT count(*) AS n FROM audit_log WHERE action = 'org_chart.id_repair'`)).rows[0].n)).toBe(2);
      // The rules are back on: a published version still never changes.
      await c.query("SAVEPOINT rules");
      await expect(c.query(`UPDATE org_units SET name_en = 'X' WHERE version_id = $1`, [cur])).rejects.toThrow(/a published structure never changes/);
      await c.query("ROLLBACK TO SAVEPOINT rules");
      await c.query(newCopy());
      await c.query(`DROP FUNCTION app_org_chart_repair_copied_ids()`);
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
    // The repaired structure works through the services: the draft, the people panel (the clerk's holding), a vacancy invitation, the pairing.
    const d = await draft();
    await svc(U.lead, (tx, p) => OC.updateUnit(tx, p, d.units.find((u) => u.code === "2")!.id, { nameEn: "Office" }), true);
    for (const p of cur.positions) {
      const listed = await svc(U.cadmin, (tx, pr) => OC.listHoldings(tx, pr, p.id));
      expect(
        listed.holdings.map((h) => h.name),
        p.code,
      ).toEqual(p.code === "2.2" ? ["Typed Clerk"] : []);
    }
    const chair = cur.positions.find((x) => x.code === "1.1")!;
    await svc(U.cadmin, (tx, p) => invite(tx, p, { orgId: ACME, email: "chair@example.test", name: "New Chair", role: "client_manager", positionId: chair.id }));
    const preview = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, ACME));
    expect(preview.changes.units.added).toEqual([]);
    expect(preview.changes.units.removed).toEqual([]);
    const beta = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, BETA));
    await svc(U.lead, (tx, p) => OC.updateUnit(tx, p, beta.units[0]!.id, { nameEn: "Board of Beta" }));
  });
});
