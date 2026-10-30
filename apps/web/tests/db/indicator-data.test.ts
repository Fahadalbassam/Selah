// How indicator figures reach Selah (migration: indicator data) against a
// real Postgres: the client's choice (typed, files, connected) and who makes
// it, the firm's suggestion, file batches (one notice, corrections kept),
// values tied to their batch, connections (only when connected, only for the
// indicators the client lets them fill, disconnected when the client steps
// back), the key lookup, a sheet read, and who sees what.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { planValues } from "@/lib/indicator-import";
import { runIndicatorFeeds } from "@/jobs/indicator-feeds";
import { loadPrincipal } from "@/services/principal";
import * as D from "@/services/indicator-data";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f970-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const QUIET = id(4); // consultant-managed: no accounts of its own
const U = {
  admin: id(11),
  lead: id(12),
  cons: id(13),
  cadmin: id(15),
  cmgr: id(16),
  owner1: id(18),
  bAdmin: id(19),
};
const K = { complaints: id(51), turnover: id(52), quiet: id(53) };

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!).catch((e: Error & { cause?: Error }) => {
      throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
    });
  });
const asUser = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => as(userId, (c) => fn(drizzle(c, { schema }) as unknown as Tx));

/** A file batch as the import's confirm step sends it. */
const fileBatch = (by: string, values: { kpiId: string; period: string; value: number }[], corrections = true) =>
  svc(by, async (tx, p) => {
    const refs = await D.indicatorRefs(tx, ACME);
    const ctx = await D.importContext(tx, p, ACME);
    const map: Record<string, string> = {};
    const plan = planValues(
      values.map((v, i) => {
        map[v.kpiId] = v.kpiId;
        return { line: i + 2, label: v.kpiId, period: v.period, value: v.value, note: null };
      }),
      map,
      refs,
      new Map(ctx.current.map((c) => [c.key, { id: c.id, value: c.value }])),
      { today: firmToday(), corrections },
    );
    return D.saveBatch(tx, p, ACME, plan, { channel: "file", fileName: "export.xlsx", sha256: "a".repeat(64) });
  });
const mode = (by: string, m: D.DataMode, org = ACME) => svc(by, (tx, p) => D.chooseDataMode(tx, p, org, m));
const notes = async (kind: string) => (await owner.query(`SELECT user_id FROM notifications WHERE kind = $1 ORDER BY user_id`, [kind])).rows.map((r) => r.user_id);

async function reset() {
  await truncateAuditLog(owner);
  await owner.query(`DELETE FROM client_kpi_values`);
  await owner.query(`DELETE FROM indicator_imports`);
  await owner.query(`DELETE FROM indicator_feeds`);
  await owner.query(`DELETE FROM client_indicator_settings`);
  await owner.query(`DELETE FROM client_kpis`);
  await owner.query(`DELETE FROM notifications`);
  await owner.query(
    `INSERT INTO client_kpis (id, org_id, name_en, name_ar, code, unit, direction, frequency, baseline, baseline_period, created_by) VALUES
      ($1,$4,'Customer complaints','شكاوى العملاء','complaints','complaints','lower_better','monthly',40,'2026-01-01',$6),
      ($2,$4,'Staff turnover','معدل دوران الموظفين',NULL,'%','lower_better','quarterly',18,'2026-01-01',$6),
      ($3,$5,'Orders on time','الطلبات في موعدها',NULL,'%','higher_better','monthly',80,'2026-01-01',$6)`,
    [K.complaints, K.turnover, K.quiet, ACME, QUIET, U.admin],
  );
}

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES ($1,'firm','Mizan Advisory',NULL), ($2,'client','Acme Holding','full'),
      ($3,'client','Beta Trading','full'), ($4,'client','Quiet Co','consultant_managed')`,
    [FIRM, ACME, BETA, QUIET],
  );
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'), ($4,$9,'client_admin'), ($5,$9,'client_manager'), ($6,$9,'action_owner'), ($7,$10,'client_admin')`,
    [U.admin, U.lead, U.cons, U.cadmin, U.cmgr, U.owner1, U.bAdmin, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($4,$2,true)`, [ACME, U.lead, U.cons, QUIET]);
});

beforeEach(reset);

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("the client's choice", () => {
  it("starts as typed; the client's admin chooses; the firm can't for a client with its own accounts", async () => {
    const s = await svc(U.cmgr, (tx, p) => D.dataSettings(tx, p, ACME));
    expect([s.mode, s.chosen, s.canChoose, s.canImport]).toEqual(["typed", false, false, false]);
    await expect(mode(U.lead, "files")).rejects.toThrow(/not found|client/);
    await expect(sqlAs(U.lead, `INSERT INTO client_indicator_settings (org_id, data_mode) VALUES ($1,'files')`, [ACME])).rejects.toThrow(/row-level security/);
    await expect(mode(U.cmgr, "files")).rejects.toThrow();
    await expect(mode(U.bAdmin, "files")).rejects.toThrow();
    await mode(U.cadmin, "files");
    const after = await svc(U.cadmin, (tx, p) => D.dataSettings(tx, p, ACME));
    expect([after.mode, after.chosen, after.decidedBy, after.canImport]).toEqual(["files", true, "cadmin", true]);
    // The lead hears what the client chose.
    expect(await notes("indicator.data_mode")).toEqual([U.lead]);
    expect((await owner.query(`SELECT 1 FROM audit_log WHERE action = 'indicator.data_mode'`)).rowCount).toBe(1);
  });

  it("the firm decides for a client with no accounts", async () => {
    await mode(U.lead, "files", QUIET);
    expect((await owner.query(`SELECT data_mode, decided_by FROM client_indicator_settings WHERE org_id = $1`, [QUIET])).rows[0]).toEqual({
      data_mode: "files",
      decided_by: U.lead,
    });
  });

  it("the firm suggests; the suggestion changes nothing until the client's admin chooses", async () => {
    await svc(U.lead, (tx, p) => D.proposeDataMode(tx, p, ACME, "connected"));
    let s = await svc(U.cadmin, (tx, p) => D.dataSettings(tx, p, ACME));
    expect([s.mode, s.chosen, s.proposal?.mode, s.proposal?.by]).toEqual(["typed", false, "connected", "lead"]);
    expect(await notes("indicator.data_proposed")).toEqual([U.cadmin]);
    // A client can't suggest, and a suggestion can't sneak a choice in.
    await expect(svc(U.cadmin, (tx, p) => D.proposeDataMode(tx, p, ACME, "files"))).rejects.toThrow();
    await mode(U.cadmin, "files");
    await svc(U.cons, (tx, p) => D.proposeDataMode(tx, p, ACME, "typed"));
    s = await svc(U.cadmin, (tx, p) => D.dataSettings(tx, p, ACME));
    expect([s.mode, s.decidedBy, s.proposal?.mode]).toEqual(["files", "cadmin", "typed"]);
  });
});

describe("files", () => {
  it("are refused while the client shares none", async () => {
    await expect(fileBatch(U.cmgr, [{ kpiId: K.complaints, period: "2026-02-01", value: 38 }])).rejects.toThrow(/shares no files/);
    await expect(
      sqlAs(U.cmgr, `INSERT INTO indicator_imports (org_id, channel, by_user) VALUES ($1,'file',$2)`, [ACME, U.cmgr]),
    ).rejects.toThrow(/shares no files/);
  });

  it("a batch saves new values and corrections, says how they came, and tells the client's admins once when the firm brings it", async () => {
    await mode(U.cadmin, "files");
    const first = await fileBatch(U.cons, [
      { kpiId: K.complaints, period: "2026-02-01", value: 38 },
      { kpiId: K.complaints, period: "2026-03-01", value: 36 },
      { kpiId: K.turnover, period: "2026-04-01", value: 17 },
    ]);
    expect([first.add, first.correct]).toEqual([3, 0]);
    const rows = (await owner.query(`SELECT channel, on_behalf, import_id, entered_by FROM client_kpi_values`)).rows;
    expect(rows.every((r) => r.channel === "file" && r.on_behalf && r.import_id === first.importId && r.entered_by === U.cons)).toBe(true);
    expect(await notes("indicator.imported_for_you")).toEqual([U.cadmin]);
    expect(await notes("indicator.entered_for_you")).toEqual([]);
    // The next export restates March: a correction that keeps the old value.
    const second = await fileBatch(U.cmgr, [
      { kpiId: K.complaints, period: "2026-02-01", value: 38 },
      { kpiId: K.complaints, period: "2026-03-01", value: 35 },
    ]);
    expect([second.add, second.correct, second.same]).toEqual([0, 1, 1]);
    expect((await owner.query(`SELECT count(*)::int n FROM client_kpi_values WHERE period = '2026-03-01'`)).rows[0].n).toBe(2);
    // With corrections off, a different figure is left alone.
    const third = await fileBatch(U.cmgr, [{ kpiId: K.complaints, period: "2026-03-01", value: 30 }], false);
    expect([third.importId, third.add, third.correct]).toEqual([null, 0, 0]);
    const imports = await svc(U.cadmin, (tx, p) => D.dataSettings(tx, p, ACME));
    expect(imports.imports.map((i) => [i.added, i.corrected, i.onBehalf])).toEqual([
      [0, 1, false],
      [3, 0, true],
    ]);
  });

  it("a value joins only its own person's batch, in the same transaction; a typed value has none", async () => {
    await mode(U.cadmin, "files");
    const b = await fileBatch(U.cons, [{ kpiId: K.complaints, period: "2026-02-01", value: 38 }]);
    const add = (by: string, extra: string, params: unknown[]) =>
      sqlAs(by, `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by ${extra}) VALUES ($1,$2,'2026-03-01',1,$3 ${params.length ? ",$4" : ""})`, [
        K.complaints,
        ACME,
        by,
        ...params,
      ]);
    await expect(add(U.cmgr, ", import_id", [b.importId])).rejects.toThrow(/only as it is brought in/);
    await expect(add(U.cons, ", import_id", [b.importId])).rejects.toThrow(/only as it is brought in/);
    await expect(add(U.cmgr, ", channel", ["file"])).rejects.toThrow(/comes in a batch/);
    const typed = await sqlAs(U.cmgr, `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by) VALUES ($1,$2,'2026-03-01',1,$3) RETURNING channel`, [
      K.complaints,
      ACME,
      U.cmgr,
    ]);
    expect(typed.rows[0].channel).toBe("typed");
  });

  it("batches are seen by the firm, the client's admin and whoever made them; action owners can't make one", async () => {
    await mode(U.cadmin, "files");
    await fileBatch(U.cons, [{ kpiId: K.complaints, period: "2026-02-01", value: 38 }]);
    expect((await sqlAs(U.cmgr, `SELECT id FROM indicator_imports`)).rowCount).toBe(0);
    expect((await sqlAs(U.cadmin, `SELECT id FROM indicator_imports`)).rowCount).toBe(1);
    expect((await sqlAs(U.bAdmin, `SELECT id FROM indicator_imports`)).rowCount).toBe(0);
    await expect(fileBatch(U.owner1, [{ kpiId: K.complaints, period: "2026-03-01", value: 38 }])).rejects.toThrow();
  });
});

describe("connections", () => {
  it("only once the client chose to connect, by its admin, at most five", async () => {
    await mode(U.cadmin, "files");
    await expect(svc(U.cadmin, (tx, p) => D.createFeedKey(tx, p, ACME, { label: "ERP" }))).rejects.toThrow(/not chosen to connect/);
    await mode(U.cadmin, "connected");
    await expect(svc(U.lead, (tx, p) => D.createFeedKey(tx, p, ACME, { label: "ERP" }))).rejects.toThrow();
    for (let i = 0; i < 5; i++) await svc(U.cadmin, (tx, p) => D.createFeedKey(tx, p, ACME, { label: `ERP ${i}` }));
    await expect(svc(U.cadmin, (tx, p) => D.createFeedKey(tx, p, ACME, { label: "one more" }))).rejects.toThrow(/at most five/);
    // Only the hash is kept; the firm sees the connection, a manager doesn't.
    expect((await owner.query(`SELECT token_hash ~ '^[0-9a-f]{64}$' AS hashed FROM indicator_feeds LIMIT 1`)).rows[0].hashed).toBe(true);
    expect((await sqlAs(U.lead, `SELECT id FROM indicator_feeds`)).rowCount).toBe(5);
    expect((await sqlAs(U.cmgr, `SELECT id FROM indicator_feeds`)).rowCount).toBe(0);
    // People only disconnect; how it ran is not theirs to write.
    await expect(sqlAs(U.cadmin, `UPDATE indicator_feeds SET failures = 0`)).rejects.toThrow(/permission denied/);
  });

  it("a key sends figures only for indicators the client lets connections fill, in its person's name", async () => {
    await mode(U.cadmin, "connected");
    const { token } = await svc(U.cadmin, (tx, p) => D.createFeedKey(tx, p, ACME, { label: "ERP" }));
    const feed = (await asUser(U.cadmin, (tx) => D.feedByKey(tx, token)))!;
    expect(feed.runAs).toBe(U.cadmin);
    expect(await asUser(U.cadmin, (tx) => D.feedByKey(tx, `${token.slice(0, -1)}x`))).toBeNull();
    const push = () =>
      svc(feed.runAs, (tx, p) =>
        D.pushValues(tx, p, feed, [
          { indicator: "complaints", period: "2026-02", value: "38" },
          { indicator: K.turnover, period: "Q2 2026", value: 17 },
          { indicator: "nothing-like-it", period: "2026-02", value: 1 },
        ]),
      );
    let out = await push();
    expect(out.results.map((r) => r.reason)).toEqual(["not_connected", "not_connected", "unmatched"]);
    // Which indicators flow is the client's call, not the firm's.
    await expect(svc(U.lead, (tx, p) => D.setIndicatorSource(tx, p, K.complaints, { feedOn: true }))).rejects.toThrow(/chooses which indicators/);
    await svc(U.cadmin, (tx, p) => D.setIndicatorSource(tx, p, K.complaints, { feedOn: true }));
    await svc(U.cadmin, (tx, p) => D.setIndicatorSource(tx, p, K.turnover, { feedOn: true }));
    out = await push();
    expect([out.added, out.results.map((r) => r.status)]).toEqual([2, ["add", "add", "refused"]]);
    const v = (await owner.query(`SELECT channel, entered_by, on_behalf FROM client_kpi_values ORDER BY period`)).rows;
    expect(v).toEqual([
      { channel: "api", entered_by: U.cadmin, on_behalf: false },
      { channel: "api", entered_by: U.cadmin, on_behalf: false },
    ]);
    expect((await owner.query(`SELECT last_added, failures FROM indicator_feeds`)).rows[0]).toEqual({ last_added: 2, failures: 0 });
  });

  it("stepping back from connected disconnects every connection at once", async () => {
    await mode(U.cadmin, "connected");
    const { token } = await svc(U.cadmin, (tx, p) => D.createFeedKey(tx, p, ACME, { label: "ERP" }));
    await mode(U.cadmin, "files");
    expect((await owner.query(`SELECT revoked_by FROM indicator_feeds`)).rows[0].revoked_by).toBe(U.cadmin);
    expect(await asUser(U.cadmin, (tx) => D.feedByKey(tx, token))).toBeNull();
  });

  it("the daily read takes a sheet in either layout, by code or name, and records failures", async () => {
    await mode(U.cadmin, "connected");
    await svc(U.cadmin, (tx, p) => D.setIndicatorSource(tx, p, K.complaints, { feedOn: true }));
    await svc(U.cadmin, (tx, p) =>
      D.connectSheet(tx, p, ACME, { label: "Monthly KPIs", url: "https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml?gid=0&single=true" }),
    );
    const url = (await owner.query(`SELECT url FROM indicator_feeds`)).rows[0].url;
    expect(url).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv&gid=0");
    const csv = "Month,شكاوى العملاء,Staff turnover\n2026-02,38,\nMarch 2026,\"36\",17\n";
    let out = await runIndicatorFeeds(owner, asUser, async () => csv);
    expect(out).toEqual({ read: 1, failed: 0, added: 2 });
    // Not due again today.
    out = await runIndicatorFeeds(owner, asUser, async () => csv);
    expect(out.read).toBe(0);
    await owner.query(`UPDATE indicator_feeds SET last_run_at = now() - interval '1 day'`);
    for (let i = 0; i < 3; i++) {
      await owner.query(`UPDATE indicator_feeds SET last_run_at = now() - interval '1 day'`);
      out = await runIndicatorFeeds(owner, asUser, async () => {
        throw new D.SheetError("not_shared");
      });
      expect(out.failed).toBe(1);
    }
    expect((await owner.query(`SELECT failures, last_error FROM indicator_feeds`)).rows[0]).toEqual({ failures: 3, last_error: "not_shared" });
    expect(await notes("indicator.feed_failing")).toEqual([U.cadmin]);
  });
});
