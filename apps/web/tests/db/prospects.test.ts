// Prospects and pitches (journey-map gaps N4, N7) against a real Postgres:
// any consultant starts a pitch, it stays firm-only and hidden from those
// not on it, signing makes it a client, and a lost pitch is deleted with
// everything in it while anything signed or used stays.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { recordEngagement } from "@/services/engagements";
import { loadPrincipal } from "@/services/principal";
import { discardBlock, discardClient, startPitch } from "@/services/prospects";
import { addConsultant, clientDirectory, requestToJoin } from "@/services/staffing";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a980-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const U = { admin: id(11), pitcher: id(12), colleague: id(13), outsider: id(14), cadmin: id(15) };

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
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = false) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    commit,
  );
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const pitch = (userId: string, name: string) => svc(userId, (tx, p) => startPitch(tx, p, { name, projectTitle: `${name} diagnostic` }), true);
const exists = async (table: string, where: string, params: unknown[]) =>
  (await owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0].n as number;

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE inquiries, storage_deletions CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$6,'firm_admin'), ($2,$6,'consultant'), ($3,$6,'consultant'), ($4,$6,'consultant'), ($5,$7,'client_admin')`,
    [U.admin, U.pitcher, U.colleague, U.outsider, U.cadmin, FIRM, ACME],
  );
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("starting a pitch", () => {
  it("any consultant starts one and leads it; the project is a firm-only draft", async () => {
    const { id: org, projectId } = await pitch(U.pitcher, "Oasis Trading");
    const row = (await owner.query(`SELECT prospect, engagement_mode FROM organizations WHERE id = $1`, [org])).rows[0];
    expect(row).toEqual({ prospect: true, engagement_mode: "full" });
    expect((await owner.query(`SELECT state FROM projects WHERE id = $1`, [projectId])).rows[0].state).toBe("draft");
    expect((await owner.query(`SELECT user_id, is_lead FROM client_assignments WHERE client_org_id = $1`, [org])).rows).toEqual([
      { user_id: U.pitcher, is_lead: true },
    ]);
    expect((await sqlAs(U.pitcher, `SELECT id FROM projects WHERE id = $1`, [projectId])).rowCount).toBe(1);
  });

  it("is hidden from consultants not on it, who cannot ask to join; its lead adds colleagues", async () => {
    const { id: org, projectId } = await pitch(U.pitcher, "Hidden Co");
    const names = async (uid: string) => (await svc(uid, (tx, p) => clientDirectory(tx, p))).map((c) => c.name);
    expect(await names(U.outsider)).toEqual(["Acme"]);
    expect(await names(U.pitcher)).toContain("Hidden Co");
    expect(await names(U.admin)).toContain("Hidden Co");
    expect((await sqlAs(U.outsider, `SELECT id FROM organizations WHERE id = $1`, [org])).rowCount).toBe(0);
    expect((await sqlAs(U.outsider, `SELECT id FROM projects WHERE id = $1`, [projectId])).rowCount).toBe(0);
    await expect(svc(U.outsider, (tx, p) => requestToJoin(tx, p, org, "I know them"))).rejects.toThrow();
    await svc(U.pitcher, (tx, p) => addConsultant(tx, p, org, U.colleague), true);
    expect(await names(U.colleague)).toContain("Hidden Co");
  });

  it("never has client accounts or invitations", async () => {
    const { id: org } = await pitch(U.pitcher, "No Accounts Co");
    await expect(
      owner.query(`INSERT INTO invitations (org_id, email, name, role, token_hash, expires_at, invited_by) VALUES ($1,'a@b.test','A','client_admin','x',now()+interval '1 day',$2)`, [
        org,
        U.admin,
      ]),
    ).rejects.toThrow(/no accounts until it signs/);
    await expect(owner.query(`UPDATE org_memberships SET org_id = $1 WHERE user_id = $2`, [org, U.cadmin])).rejects.toThrow(/no accounts until it signs/);
  });

  it("client people cannot start one; nobody turns a client back into a prospect", async () => {
    await expect(pitch(U.cadmin, "Nope")).rejects.toThrow();
    await expect(owner.query(`UPDATE organizations SET prospect = true WHERE id = $1`, [ACME])).rejects.toThrow(/never becomes a prospect again/);
    await expect(owner.query(`INSERT INTO organizations (kind, name, prospect) VALUES ('firm','x',true)`)).rejects.toThrow(/only a client/);
  });
});

describe("winning a pitch", () => {
  it("only recording a signed engagement makes it a client, and only the firm admin records one", async () => {
    const { id: org, projectId } = await pitch(U.pitcher, "Won Co");
    await expect(owner.query(`UPDATE organizations SET prospect = false WHERE id = $1`, [org])).rejects.toThrow(/first signed engagement/);
    await expect(
      svc(U.pitcher, (tx, p) => recordEngagement(tx, p, org, { title: "Diagnostic", signedOn: "2026-10-20", scope: "Diagnostic", projectIds: [projectId] })),
    ).rejects.toThrow();
    await svc(U.admin, (tx, p) => recordEngagement(tx, p, org, { title: "Diagnostic", signedOn: "2026-10-20", scope: "Diagnostic", projectIds: [projectId] }), true);
    expect((await owner.query(`SELECT prospect FROM organizations WHERE id = $1`, [org])).rows[0].prospect).toBe(false);
    expect((await owner.query(`SELECT state FROM projects WHERE id = $1`, [projectId])).rows[0].state).toBe("planned");
    // Signed: it stays on record.
    expect(await svc(U.admin, (tx) => discardBlock(tx, org))).toBe("signed");
    await expect(svc(U.admin, (tx, p) => discardClient(tx, p, org))).rejects.toThrow(/signed/);
  });
});

describe("deleting what never signed", () => {
  it("a lost pitch goes with its drafts, append-only history, contacts and files", async () => {
    const { id: org, projectId } = await pitch(U.pitcher, "Lost Co");
    const q = (text: string, params: unknown[]) => owner.query(text, params);
    await q(`INSERT INTO findings (project_id, org_id, title, created_by) VALUES ($1,$2,'Weak board',$3)`, [projectId, org, U.pitcher]);
    await q(`INSERT INTO activity_events (project_id, org_id, entity_type, entity_id, event) VALUES ($1,$2,'project',$1,'created')`, [projectId, org]);
    await q(`INSERT INTO client_contacts (org_id, name) VALUES ($1,'Their CEO')`, [org]);
    await q(
      `INSERT INTO documents (project_id, org_id, owner_org_id, uploaded_by, purpose, title, storage_key, content_type, size_bytes, sha256, visibility)
       VALUES ($1,$2,$3,$4,'deliverable','Proposal','pitch/lost-co/proposal.pdf','application/pdf',10,'00','firm_private')`,
      [projectId, org, FIRM, U.pitcher],
    );
    // Someone who is not its lead may not.
    expect(await svc(U.colleague, (tx) => discardBlock(tx, org))).toBe("hidden");
    await svc(U.pitcher, (tx, p) => addConsultant(tx, p, org, U.colleague), true);
    expect(await svc(U.colleague, (tx) => discardBlock(tx, org))).toBe("not_lead");
    await expect(svc(U.colleague, (tx, p) => discardClient(tx, p, org))).rejects.toThrow(/not_lead/);

    expect(await svc(U.pitcher, (tx) => discardBlock(tx, org))).toBeNull();
    await svc(U.pitcher, (tx, p) => discardClient(tx, p, org), true);
    expect(await exists("organizations", "id = $1", [org])).toBe(0);
    expect(await exists("projects", "org_id = $1", [org])).toBe(0);
    expect(await exists("activity_events", "org_id = $1", [org])).toBe(0);
    expect(await exists("client_contacts", "org_id = $1", [org])).toBe(0);
    expect(await exists("storage_deletions", "storage_key = $1", ["pitch/lost-co/proposal.pdf"])).toBe(1);
    expect(await exists("audit_log", "resource_id = $1 AND action = 'client.delete'", [org])).toBe(1);
  });

  it("append-only history stays append-only outside a delete", async () => {
    const { id: org, projectId } = await pitch(U.pitcher, "Kept Co");
    await owner.query(`INSERT INTO activity_events (project_id, org_id, entity_type, entity_id, event) VALUES ($1,$2,'project',$1,'created')`, [projectId, org]);
    await expect(owner.query(`DELETE FROM activity_events WHERE org_id = $1`, [org])).rejects.toThrow(/append-only/);
    // The flag alone does not help the app's own role.
    await as(
      U.admin,
      async (c) => {
        await c.query(`SELECT set_config('selah.discard', 'on', true)`);
        await c.query(`DELETE FROM projects WHERE id = $1`, [projectId]).catch(() => undefined);
      },
      true,
    ).catch(() => undefined);
    expect(await exists("projects", "id = $1", [projectId])).toBe(1);
    expect(await exists("activity_events", "org_id = $1", [org])).toBe(1);
  });

  it("a client added by mistake: only the firm admin, only while it has no files, accounts or inquiry", async () => {
    const MISTAKE = id(40);
    await owner.query(`INSERT INTO organizations (id, kind, name) VALUES ($1,'client','Typo Co')`, [MISTAKE]);
    await owner.query(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [MISTAKE, U.pitcher]);
    expect(await svc(U.pitcher, (tx) => discardBlock(tx, MISTAKE))).toBe("not_admin");
    // A client with accounts stays.
    expect(await svc(U.admin, (tx) => discardBlock(tx, ACME))).toBe("accounts");
    const DOC_PROJECT = id(41);
    await owner.query(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES ($1,'client',$2,$3,'P','draft')`, [DOC_PROJECT, MISTAKE, FIRM]);
    await owner.query(
      `INSERT INTO documents (project_id, org_id, owner_org_id, uploaded_by, purpose, title, storage_key, content_type, size_bytes, sha256, visibility)
       VALUES ($1,$2,$3,$4,'deliverable','Draft','typo/draft.pdf','application/pdf',10,'00','firm_private')`,
      [DOC_PROJECT, MISTAKE, FIRM, U.admin],
    );
    expect(await svc(U.admin, (tx) => discardBlock(tx, MISTAKE))).toBe("files");
    await owner.query(`DELETE FROM projects WHERE id = $1`, [DOC_PROJECT]);
    expect(await svc(U.admin, (tx) => discardBlock(tx, MISTAKE))).toBeNull();
    await svc(U.admin, (tx, p) => discardClient(tx, p, MISTAKE), true);
    expect(await exists("organizations", "id = $1", [MISTAKE])).toBe(0);
  });

  it("client people never delete a client, and cannot even probe one", async () => {
    expect(await svc(U.cadmin, (tx) => discardBlock(tx, ACME))).toBe("hidden");
    await expect(svc(U.cadmin, (tx, p) => discardClient(tx, p, ACME))).rejects.toThrow();
    await expect(sqlAs(U.cadmin, `SELECT app_discard_client($1)`, [ACME])).rejects.toThrow(/no such client/);
  });
});
