// The export pack of a leaving client (baseline: Export pack, 0030; journey
// J14.2 and J14.4) against a real Postgres: only an archived client has one,
// only the firm admin or the client's own admin makes it, it holds only what
// the client may see (never a firm-only or personal file), every entry's
// checksum is in its manifest, the receipt is given once, and the purge
// deletes the stored file with its client. No other client sees any of it.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { strFromU8, unzipSync } from "fflate";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authorize, type Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";

// The bucket, in memory: the pack reads the client's files and stores the ZIP.
const bucket = new Map<string, Uint8Array>();
vi.mock("@/services/storage", () => ({
  DOWNLOAD_TTL_SECONDS: 60,
  getObject: async (key: string) => {
    const b = bucket.get(key);
    if (!b) throw new Error(`no object ${key}`);
    return b;
  },
  putObject: async (key: string, body: Uint8Array) => void bucket.set(key, body),
  signedDownloadUrl: async (key: string) => `https://storage.test/${key}`,
}));
// The pack's words come from the messages; here the keys stand in for them.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => Object.assign((key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key), { has: () => true }),
}));
// Many packs are made here by the same people; the per-person limit is not what is tested.
vi.mock("@/auth/attempts", () => ({ createAttemptLimiter: () => ({ take: () => null }) }));

const { exportPackLink, listExportPacks, makeExportPack, recordReceipt } = await import("@/services/export-pack");
const { archiveClient } = await import("@/services/offboarding");
const { loadPrincipal } = await import("@/services/principal");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c280-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = { admin: id(11), lead: id(12), cadmin: id(15), cmgr: id(16), betaAdmin: id(19) };
const DONE = id(21);
const REC = id(31);
const HIDDEN_REC = id(32); // firm-only
const ACT = id(41);
const HIDDEN_ACT = id(42);
const DOC = { shared: id(51), clientOnly: id(52), firmOnly: id(53), personal: id(54), infected: id(55) };

async function as<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
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
const run = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
/** The database's own words, from under the query wrapper. */
const why = <T>(p: Promise<T>) =>
  p.catch((e: Error & { cause?: Error }) => {
    throw new Error(e.cause?.message ?? e.message);
  });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const make = (who: string) => svc(who, (tx, p) => makeExportPack(tx, p, ACME, "en"));
const packOf = async (packId: string) => {
  const row = (await owner.query(`SELECT * FROM client_export_packs WHERE id = $1`, [packId])).rows[0];
  return { row, files: unzipSync(bucket.get(row.storage_key)!) };
};

async function reset() {
  await owner.query(`DELETE FROM client_export_packs`);
  await owner.query(`DELETE FROM client_offboardings`);
  await owner.query(`DELETE FROM notifications`);
  await owner.query(`DELETE FROM outbound_emails`);
  await owner.query(`DELETE FROM storage_deletions`);
  await owner.query(`UPDATE organizations SET status = 'active' WHERE id IN ($1, $2)`, [ACME, BETA]);
}
const archive = () => svc(U.admin, (tx, p) => archiveClient(tx, p, ACME, { graceDays: 30 }));

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`DELETE FROM client_deletions`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$6,'firm_admin'), ($2,$6,'consultant'), ($3,$7,'client_admin'), ($4,$7,'client_manager'), ($5,$8,'client_admin')`,
    [U.admin, U.lead, U.cadmin, U.cmgr, U.betaAdmin, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`, [DONE, ACME, FIRM, U.admin]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [DONE, U.lead, U.cmgr]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$3,$4,'Board charter','shared',$5), ($2,$3,$4,'Partner pricing','firm_private',$5)`, [
    REC,
    HIDDEN_REC,
    DONE,
    ACME,
    U.lead,
  ]);
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, status, due_date, created_by) VALUES
      ($1,$3,$4,$5,'=Adopt the charter','verified_complete','2026-09-01',$7), ($2,$3,$4,$6,'Price the renewal','in_progress','2026-09-01',$7)`,
    [ACT, HIDDEN_ACT, DONE, ACME, REC, HIDDEN_REC, U.lead],
  );
  const docs: [string, string, string, string, string][] = [
    [DOC.shared, "Board charter.pdf", "shared", U.lead, "clean"],
    [DOC.clientOnly, "Shareholder register", "client_private", U.cadmin, "clean"],
    [DOC.firmOnly, "Fee model", "firm_private", U.lead, "clean"],
    [DOC.personal, "My notes", "user_private", U.lead, "clean"],
    [DOC.infected, "Bad file", "shared", U.cmgr, "infected"],
  ];
  for (const [did, title, vis, by, scan] of docs) {
    const body = new TextEncoder().encode(`contents of ${title}`);
    const key = `documents/${did}`;
    bucket.set(key, body);
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$4,$5,'deliverable','submitted',$6,$7,$8,'application/pdf',$9,$10,$11)`,
      [did, DONE, ACME, vis === "client_private" ? ACME : FIRM, by, title, vis, key, body.byteLength, sha(body), scan],
    );
  }
  await q(`UPDATE projects SET state = 'closed' WHERE id = $1`, [DONE]);
});

beforeEach(reset);

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("making a pack", () => {
  it("only once the client is archived", async () => {
    await expect(make(U.admin)).rejects.toThrow(/archived/);
    await expect(run(U.admin, `SELECT app_record_export_pack($1, $2, repeat('a', 64), 1, 0, 'en')`, [ACME, `exports/${id(99)}.zip`])).rejects.toThrow(/archived/);
  });

  it("only the firm admin or the client's own admin; never a consultant, a manager or another client", async () => {
    await archive();
    expect(authorize((await svc(U.cmgr, async (_tx, p) => p))!, "organization.export", { type: "organization", orgId: ACME, projectId: null }).allowed).toBe(false);
    for (const who of [U.lead, U.cmgr, U.betaAdmin]) {
      await expect(make(who), who).rejects.toThrow();
      await expect(run(who, `SELECT app_record_export_pack($1, $2, repeat('a', 64), 1, 0, 'en')`, [ACME, `exports/${id(99)}.zip`]), who).rejects.toThrow(/firm admin|client's admin/);
    }
    expect((await owner.query(`SELECT 1 FROM client_export_packs`)).rowCount).toBe(0);
  });

  it("holds what the client may see, each entry under its checksum, and the stored ZIP matches the record", async () => {
    await archive();
    const { id: packId } = await make(U.admin);
    const { row, files } = await packOf(packId);
    expect(sha(bucket.get(row.storage_key)!)).toBe(row.sha256);
    expect(row.size_bytes).toBe(bucket.get(row.storage_key)!.byteLength);

    const names = Object.keys(files).sort();
    expect(names).toEqual(
      ["README.txt", "actions.csv", "files.csv", "files/Acme governance/Board charter.pdf", "manifest.json", "projects.csv", "recommendations.csv"].sort(),
    );
    // The client's private file is not the firm admin's to read, so the firm's pack leaves it out;
    // the firm-only, personal and infected files are in no pack.
    expect(row.file_count).toBe(1);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as { files: { path: string; sha256: string; bytes: number }[] };
    expect(manifest.files.map((f) => f.path).sort()).toEqual(names.filter((n) => n !== "manifest.json"));
    for (const f of manifest.files) expect(sha(files[f.path]!), f.path).toBe(f.sha256);

    const all = names.map((n) => strFromU8(files[n]!)).join("\n");
    expect(all).not.toMatch(/Partner pricing|Price the renewal|Fee model|My notes|Bad file/);
    // UTF-8 with a byte-order mark, so a spreadsheet reads Arabic.
    expect([...files["actions.csv"]!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const actionsCsv = strFromU8(files["actions.csv"]!);
    // A cell a spreadsheet would run as a formula is defused.
    expect(actionsCsv).toContain(`"'=Adopt the charter"`);
    expect(strFromU8(files["files/Acme governance/Board charter.pdf"]!)).toBe("contents of Board charter.pdf");
  });

  it("the client's admin, in the grace period, gets its private files too", async () => {
    await archive();
    const { id: packId } = await make(U.cadmin);
    const { row, files } = await packOf(packId);
    expect(row.file_count).toBe(2);
    expect(Object.keys(files)).toContain("files/Acme governance/Shareholder register.pdf");
    expect(Object.keys(files).join()).not.toMatch(/Fee model|My notes|Bad file/);
  });

  it("refuses a file that no longer matches its checksum", async () => {
    await archive();
    const key = `documents/${DOC.shared}`;
    const good = bucket.get(key)!;
    bucket.set(key, new TextEncoder().encode("tampered"));
    try {
      await expect(make(U.admin)).rejects.toThrow(/checksum/);
    } finally {
      bucket.set(key, good);
    }
  });
});

describe("who sees the packs", () => {
  it("the firm admin and the client's admin; not the lead, the manager or another client", async () => {
    await archive();
    await make(U.admin);
    expect((await as(U.admin, (c) => c.query(`SELECT 1 FROM client_export_packs`))).rowCount).toBe(1);
    expect((await as(U.cadmin, (c) => c.query(`SELECT 1 FROM client_export_packs`))).rowCount).toBe(1);
    for (const who of [U.lead, U.cmgr, U.betaAdmin]) {
      expect((await as(who, (c) => c.query(`SELECT 1 FROM client_export_packs`))).rowCount, who).toBe(0);
      expect(await svc(who, (tx, p) => listExportPacks(tx, p, ACME)), who).toEqual([]);
    }
    const [pack] = await svc(U.cadmin, (tx, p) => listExportPacks(tx, p, ACME));
    expect(await svc(U.cadmin, (tx, p) => exportPackLink(tx, p, ACME, pack!.id, null))).toMatchObject({ url: expect.stringContaining("exports/") });
    await expect(svc(U.betaAdmin, (tx, p) => exportPackLink(tx, p, ACME, pack!.id, null))).rejects.toThrow();
    // A pack is reached only through its own client.
    await expect(svc(U.admin, (tx, p) => exportPackLink(tx, p, BETA, pack!.id, null))).rejects.toThrow();
  });
});

describe("the receipt", () => {
  it("the client's admin confirms it once, and the firm admins hear", async () => {
    await archive();
    const { id: packId } = await make(U.cadmin);
    await expect(run(U.cmgr, `SELECT app_confirm_export_receipt($1, '')`, [packId])).rejects.toThrow(/client's admin/);
    await expect(run(U.admin, `SELECT app_confirm_export_receipt($1, '')`, [packId])).rejects.toThrow(/client's admin/);
    const packs = await svc(U.cadmin, (tx, p) => recordReceipt(tx, p, ACME, packId, { note: "Received by IT" }));
    expect(packs[0]).toMatchObject({ receiptBy: "cadmin", receivedByName: null, receiptNote: "Received by IT" });
    await expect(why(svc(U.cadmin, (tx, p) => recordReceipt(tx, p, ACME, packId, {})))).rejects.toThrow(/already/);
    await expect(why(svc(U.admin, (tx, p) => recordReceipt(tx, p, ACME, packId, { receivedBy: "Someone" })))).rejects.toThrow(/already/);
    const told = (await owner.query(`SELECT user_id FROM notifications WHERE kind = 'client.pack_received'`)).rows.map((r) => r.user_id);
    expect(told).toEqual([U.admin]);
  });

  it("the firm admin records a handover made outside Selah, naming who received it", async () => {
    await archive();
    const { id: packId } = await make(U.admin);
    await expect(why(svc(U.admin, (tx, p) => recordReceipt(tx, p, ACME, packId, { receivedBy: " " })))).rejects.toThrow(/received/);
    await expect(run(U.lead, `SELECT app_record_export_handover($1, 'Noura', '')`, [packId])).rejects.toThrow(/firm admin/);
    const packs = await svc(U.admin, (tx, p) => recordReceipt(tx, p, ACME, packId, { receivedBy: "Noura Al-Harbi, CFO" }));
    expect(packs[0]).toMatchObject({ receiptBy: "admin", receivedByName: "Noura Al-Harbi, CFO" });
  });

  it("a pack never changes and is deleted only with its client, its file with it", async () => {
    await archive();
    const { id: packId } = await make(U.admin);
    await expect(run(U.admin, `UPDATE client_export_packs SET sha256 = repeat('b', 64) WHERE id = $1`, [packId])).rejects.toThrow(/permission denied/);
    await expect(run(U.admin, `DELETE FROM client_export_packs WHERE id = $1`, [packId])).rejects.toThrow(/permission denied/);
    // Even the owner, acting as a person, can't change or remove one.
    const asPerson = async (sql: string) => {
      const c = await owner.connect();
      try {
        await c.query("BEGIN");
        await c.query(`SELECT set_config('selah.user_id', $1, true)`, [U.admin]);
        await c.query(sql);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    };
    await expect(asPerson(`UPDATE client_export_packs SET size_bytes = 1 WHERE id = '${packId}'`)).rejects.toThrow(/does not change/);
    await expect(asPerson(`DELETE FROM client_export_packs WHERE id = '${packId}'`)).rejects.toThrow(/kept until/);

    const key = (await packOf(packId)).row.storage_key;
    const retain = (await owner.query(`SELECT retain_until::text AS d FROM client_offboardings WHERE org_id = $1`, [ACME])).rows[0].d as string;
    // In a transaction rolled back after, so the other tests keep Acme.
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      expect((await c.query(`SELECT app_purge_clients($1::date) AS n`, [retain])).rows[0].n).toBe(1);
      expect((await c.query(`SELECT 1 FROM client_export_packs WHERE id = $1`, [packId])).rowCount).toBe(0);
      expect((await c.query(`SELECT 1 FROM storage_deletions WHERE storage_key = $1`, [key])).rowCount).toBe(1);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});
