// The signed engagement (wave 1, item 5) and draft projects (journey-map
// gap N3) against a real Postgres: what the client signed, who sees it, and
// that a project nobody signed for stays hidden from the client.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { addDeliverable, coverProjects, getEngagement, listEngagements, recordEngagement } from "@/services/engagements";
import { convertInquiry } from "@/services/inquiries";
import { loadPrincipal } from "@/services/principal";
import { addProjectPerson, createClientProject } from "@/services/staffing";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a970-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = { admin: id(11), lead: id(12), bench: id(13), cadmin: id(14), cmgr: id(15), betaAdmin: id(16) };
const P = { live: id(21), beta: id(22) };

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
const dbError = (re: RegExp) => ({ cause: { message: expect.stringMatching(re) } });
const signed = { title: "Governance programme", signedOn: "2026-10-01", scope: "Board charter and committees", retainerFollows: true };
const visibleProjects = async (userId: string) => (await sqlAs(userId, `SELECT id FROM projects ORDER BY id`)).rows.map((r) => r.id);

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE inquiries CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$7,'consultant'), ($4,$8,'client_admin'), ($5,$8,'client_manager'), ($6,$9,'client_admin')`,
    [U.admin, U.lead, U.bench, U.cadmin, U.cmgr, U.betaAdmin, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme phase 1','active',$6), ($2,'client',$4,$5,'Beta phase 1','active',$6)`,
    [P.live, P.beta, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [P.live, U.lead, U.cmgr]);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("draft projects", () => {
  it("a new project no engagement covers is a draft the client never sees", async () => {
    const [draftId, seen] = await svc(U.lead, async (tx, p) => {
      const { id: made } = await createClientProject(tx, p, ACME, { title: "Phase 2 pitch" });
      const state = (await tx.execute<{ state: string }>(sql`SELECT state FROM projects WHERE id = ${made}`)).rows[0]!.state;
      return [made, state];
    }, true);
    expect(seen).toBe("draft");
    expect(await visibleProjects(U.cadmin)).toEqual([P.live]);
    expect(await visibleProjects(U.cmgr)).toEqual([P.live]);
    expect(await visibleProjects(U.lead)).toEqual([P.live, draftId].sort());
    expect(await visibleProjects(U.admin)).toEqual([P.live, P.beta, draftId].sort());
    // The client's people join once it is signed.
    await expect(svc(U.admin, (tx, p) => addProjectPerson(tx, p, draftId, U.cmgr))).rejects.toMatchObject(dbError(/join once a signed engagement/));
    await owner.query(`DELETE FROM projects WHERE id = $1`, [draftId]);
  });

  it("only leaves draft under a signed engagement, and never goes back", async () => {
    const draftId = id(30);
    await owner.query(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Draft','draft',$4)`, [
      draftId,
      ACME,
      FIRM,
      U.admin,
    ]);
    await expect(sqlAs(U.admin, `UPDATE projects SET state = 'active' WHERE id = $1`, [draftId])).rejects.toThrow(/signed engagement covers it/);
    await expect(sqlAs(U.admin, `UPDATE projects SET state = 'draft' WHERE id = $1`, [P.live])).rejects.toThrow(/never a draft again/);
    await expect(
      owner.query(`INSERT INTO projects (kind, org_id, firm_org_id, title, state) VALUES ('internal',$1,$1,'x','draft')`, [FIRM]),
    ).rejects.toThrow(/for client projects/);
    await owner.query(`DELETE FROM projects WHERE id = $1`, [draftId]);
  });
});

describe("recording what the client signed", () => {
  it("the firm admin records it; the drafts it covers become planned and reach the client", async () => {
    const draftId = id(31);
    await owner.query(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Phase 2','draft',$4)`, [
      draftId,
      ACME,
      FIRM,
      U.admin,
    ]);
    const { id: engagementId } = await svc(U.admin, (tx, p) => recordEngagement(tx, p, ACME, { ...signed, projectIds: [draftId] }), true);
    expect((await owner.query(`SELECT state, engagement_id FROM projects WHERE id = $1`, [draftId])).rows[0]).toEqual({
      state: "planned",
      engagement_id: engagementId,
    });
    expect(await visibleProjects(U.cadmin)).toEqual([P.live, draftId].sort());
    // A covered project keeps an engagement.
    await expect(sqlAs(U.admin, `UPDATE projects SET engagement_id = NULL WHERE id = $1`, [draftId])).rejects.toThrow(/keeps the engagement/);
  });

  it("a planned project starts when its first action is released, not for a draft action", async () => {
    const pid = id(32);
    await owner.query(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Phase 3','draft',$4)`, [
      pid,
      ACME,
      FIRM,
      U.admin,
    ]);
    const { id: engagementId } = await svc(U.admin, (tx, p) => recordEngagement(tx, p, ACME, { ...signed, title: "Phase 3", projectIds: [pid] }), true);
    const state = async () => (await owner.query(`SELECT state FROM projects WHERE id = $1`, [pid])).rows[0].state;
    const rec = (await owner.query(`INSERT INTO recommendations (project_id, org_id, title, priority, created_by) VALUES ($1,$2,'Adopt a charter','high',$3) RETURNING id`, [pid, ACME, U.admin])).rows[0].id;
    const action = (
      await owner.query(`INSERT INTO actions (project_id, org_id, recommendation_id, title, status, created_by) VALUES ($1,$2,$3,'Draft it','draft',$4) RETURNING id`, [pid, ACME, rec, U.admin])
    ).rows[0].id;
    expect(await state()).toBe("planned");
    await owner.query(`UPDATE actions SET status = 'assigned', owner_user_id = $2, due_date = '2026-12-01' WHERE id = $1`, [action, U.cmgr]);
    expect(await state()).toBe("active");
    // Leave the counts below as they were.
    await owner.query(`DELETE FROM projects WHERE id = $1`, [pid]);
    await owner.query(`DELETE FROM engagements WHERE id = $1`, [engagementId]);
  });

  it("a draft project with released work starts when an engagement covers it", async () => {
    const pid = id(33);
    await owner.query(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Phase 4','draft',$4)`, [
      pid,
      ACME,
      FIRM,
      U.admin,
    ]);
    const rec = (await owner.query(`INSERT INTO recommendations (project_id, org_id, title, priority, created_by) VALUES ($1,$2,'Adopt a policy','high',$3) RETURNING id`, [pid, ACME, U.admin])).rows[0].id;
    await owner.query(
      `INSERT INTO actions (project_id, org_id, recommendation_id, title, status, owner_user_id, due_date, created_by) VALUES ($1,$2,$3,'Write it','assigned',$4,'2026-12-01',$5)`,
      [pid, ACME, rec, U.cmgr, U.admin],
    );
    const state = async () => (await owner.query(`SELECT state FROM projects WHERE id = $1`, [pid])).rows[0].state;
    expect(await state()).toBe("draft");
    const { id: engagementId } = await svc(U.admin, (tx, p) => recordEngagement(tx, p, ACME, { ...signed, title: "Phase 4", projectIds: [pid] }), true);
    expect(await state()).toBe("active");
    await owner.query(`DELETE FROM projects WHERE id = $1`, [pid]);
    await owner.query(`DELETE FROM engagements WHERE id = $1`, [engagementId]);
  });

  it("the client's admin and consultants read it; managers, other consultants and other clients don't", async () => {
    const count = async (u: string) => (await sqlAs(u, `SELECT count(*)::int AS n FROM engagements`)).rows[0].n;
    expect(await count(U.admin)).toBe(1);
    expect(await count(U.lead)).toBe(1);
    expect(await count(U.cadmin)).toBe(1);
    expect(await count(U.cmgr)).toBe(0);
    expect(await count(U.bench)).toBe(0);
    expect(await count(U.betaAdmin)).toBe(0);
    expect((await svc(U.cadmin, (tx, p) => listEngagements(tx, p, ACME))).can.record).toBe(false);
    await expect(svc(U.betaAdmin, (tx, p) => listEngagements(tx, p, ACME))).resolves.toEqual({ engagements: [], can: { record: false } });
  });

  it("only the firm admin records one or covers a project", async () => {
    await expect(svc(U.lead, (tx, p) => recordEngagement(tx, p, ACME, signed))).rejects.toThrow(/forbidden/);
    await expect(
      sqlAs(U.lead, `INSERT INTO engagements (firm_org_id, client_org_id, title, signed_on, scope) VALUES ($1,$2,'x','2026-10-01','y')`, [FIRM, ACME]),
    ).rejects.toThrow(/row-level security/);
    const [g] = (await owner.query(`SELECT id FROM engagements LIMIT 1`)).rows;
    await expect(svc(U.lead, (tx, p) => createClientProject(tx, p, ACME, { title: "Covered", engagementId: g.id }))).rejects.toThrow(/forbidden/);
    await expect(
      sqlAs(U.lead, `INSERT INTO projects (kind, org_id, firm_org_id, title, state, engagement_id, created_by) VALUES ('client',$1,$2,'x','planned',$3,$4)`, [
        ACME,
        FIRM,
        g.id,
        U.lead,
      ]),
    ).rejects.toThrow(/only the firm admin puts a project under an engagement/);
  });

  it("refuses a signature in the future, another client's project, and a deliverable outside the engagement", async () => {
    await expect(svc(U.admin, (tx, p) => recordEngagement(tx, p, ACME, { ...signed, signedOn: "2999-01-01" }))).rejects.toMatchObject(
      dbError(/on or after the day/),
    );
    await expect(svc(U.admin, (tx, p) => recordEngagement(tx, p, ACME, { ...signed, projectIds: [P.beta] }))).rejects.toThrow(/covers this client's projects/);
    const [g] = (await owner.query(`SELECT id FROM engagements LIMIT 1`)).rows;
    await expect(svc(U.admin, (tx, p) => coverProjects(tx, p, g.id, [P.beta]))).rejects.toThrow(/covers this client's projects/);
    await expect(svc(U.admin, (tx, p) => addDeliverable(tx, p, g.id, { title: "Charter", projectId: P.live }))).rejects.toMatchObject(
      dbError(/a project the engagement covers/),
    );
    const d = await svc(U.admin, (tx, p) => addDeliverable(tx, p, g.id, { title: "Board charter", acceptanceCriteria: "Approved by the board", dueOn: "2027-01-31" }));
    expect(d.id).toBeTruthy();
  });

  it("shows the client's admin what was agreed, without the firm's sales history", async () => {
    const [g] = (await owner.query(`SELECT id FROM engagements LIMIT 1`)).rows;
    const seen = await svc(U.cadmin, (tx, p) => getEngagement(tx, p, g.id));
    expect(seen.engagement.scope).toBe("Board charter and committees");
    expect(seen.inquiry).toBeNull();
    expect(seen.drafts).toEqual([]);
    expect(seen.can).toEqual({ edit: false, delete: false });
    await expect(svc(U.betaAdmin, (tx, p) => getEngagement(tx, p, g.id))).rejects.toThrow(/not found/);
    await expect(svc(U.bench, (tx, p) => getEngagement(tx, p, g.id))).rejects.toThrow(/not found/);
  });
});

describe("winning an inquiry", () => {
  it("records the engagement, carries the contact over, and starts the first project under it", async () => {
    const form = {
      org_name: "Al-Waha Trading",
      org_name_ar: "الواحة للتجارة",
      sector: "trade_distribution",
      employee_band: "50-249",
      ownership_type: "family_multi_partner",
      contact_name: "Sami",
      contact_role: "CEO",
      email: "Sami@Example.test",
      phone: "+966 55 000 0000",
      preferred_language: "ar",
      services: ["family_business_governance"],
      self_check: { has_strategy: false },
      consent: true,
      privacy_notice_version: "2026-10-20",
      requester_role: "ceo",
      why_now: "A new board wants it settled this year.",
    };
    const ref = (await as(null, (c) => c.query(`SELECT submit_inquiry($1::jsonb) AS ref`, [JSON.stringify(form)]), true)).rows[0].ref as string;
    const inquiryId = (await owner.query(`SELECT id FROM inquiries WHERE public_ref = $1`, [ref])).rows[0].id as string;
    for (const s of ["triaged", "discovery_scheduled", "discovery_done"]) {
      await as(U.admin, (c) => c.query(`UPDATE inquiries SET status = $2 WHERE id = $1`, [inquiryId, s]), true);
    }
    await as(U.admin, (c) => c.query(`SELECT app_record_conflict_search($1, NULL)`, [inquiryId]), true);
    await as(U.admin, (c) => c.query(`UPDATE inquiries SET conflict_status = 'clear' WHERE id = $1`, [inquiryId]), true);

    const out = await svc(
      U.admin,
      (tx, p) =>
        convertInquiry(tx, p, inquiryId, {
          client: { name: "Al-Waha Trading", nameAr: "الواحة للتجارة" },
          leadUserId: U.lead,
          engagement: { title: "Family charter", signedOn: "2026-10-20", scope: "A family charter and council", dataAgreementOn: "2026-10-20" },
          projectTitle: "Family charter",
        }),
      true,
    );
    const g = (await owner.query(`SELECT inquiry_id, client_org_id, title FROM engagements WHERE id = $1`, [out.engagementId])).rows[0];
    expect(g).toEqual({ inquiry_id: inquiryId, client_org_id: out.clientOrgId, title: "Family charter" });
    expect((await owner.query(`SELECT state, engagement_id FROM projects WHERE id = $1`, [out.projectId])).rows[0]).toEqual({
      state: "planned",
      engagement_id: out.engagementId,
    });
    expect((await owner.query(`SELECT name, title, email FROM client_contacts WHERE org_id = $1`, [out.clientOrgId])).rows).toEqual([
      { name: "Sami", title: "CEO", email: "sami@example.test" },
    ]);
    const detail = await svc(U.admin, (tx, p) => getEngagement(tx, p, out.engagementId));
    expect(detail.inquiry?.publicRef).toBe(ref);
  });
});
