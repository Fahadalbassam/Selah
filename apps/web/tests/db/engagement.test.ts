// Engagement modes and departments (baseline: Engagement) against a real
// Postgres: which accounts each mode allows, recording on the client's
// behalf, client-private files in a restricted engagement, departments,
// and mode changes that keep the data.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { engagementError } from "@/lib/engagement";
import { firmToday } from "@/lib/dates";
import { statusRecords } from "@/services/assistant";
import { departmentChoices, getEngagement, setEngagement } from "@/services/engagement";
import { planOptions } from "@/services/plan";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a200-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full, with departments
const RESTR = id(3); // restricted
const MANAGED = id(4); // consultant-managed
const U = {
  admin: id(11),
  lead: id(12), // leads every client, staffed everywhere
  cons: id(13), // staffed on the managed project
  cadmin: id(14), // Acme admin
  cmgr: id(15), // Acme manager
  hr: id(16), // Acme action owner in HR
  fin: id(17), // Acme action owner in Finance
  radmin: id(18), // Restricted client's admin
};
const P = { acme: id(21), restr: id(22), managed: id(23) };
const REC = { acme: id(31), restr: id(32), managed: id(33) };
const DEPT = { hr: id(41), fin: id(42) };
let n = 100;
const next = () => id(++n);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

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
const run = (userId: string | null, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const attempt = (userId: string | null, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const sees = async (userId: string, table: string, rowId: string) =>
  (await attempt(userId, `SELECT 1 FROM ${table} WHERE id = $1`, [rowId])).rowCount === 1;

const projectOf = { [ACME]: P.acme, [RESTR]: P.restr, [MANAGED]: P.managed };
const recOf = { [ACME]: REC.acme, [RESTR]: REC.restr, [MANAGED]: REC.managed };

async function action(
  org: string,
  fields: { owner?: string | null; ownerName?: string; dept?: string; status?: string; due?: string } = {},
) {
  const aid = next();
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, owner_name, department_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Write the policy',$5,$6,$7,$8,$9,$10)`,
    [
      aid,
      projectOf[org],
      org,
      recOf[org],
      fields.owner ?? null,
      fields.ownerName ?? null,
      fields.dept ?? null,
      fields.status ?? "in_progress",
      fields.due ?? null,
      U.lead,
    ],
  );
  return aid;
}

async function upload(by: string, org: string, fields: { purpose?: string; visibility?: string; dept?: string } = {}) {
  const doc = next();
  const ownerOrg = by === U.lead || by === U.cons || by === U.admin ? FIRM : org;
  await run(
    by,
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, department_id, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$4,$5,$6,'submitted','f.pdf',$7,$8,$9,'application/pdf',1,'x','clean')`,
    [
      doc,
      projectOf[org],
      org,
      ownerOrg,
      by,
      fields.purpose ?? "client_document",
      fields.visibility ?? "shared",
      fields.dept ?? null,
      `k-${doc}`,
    ],
  );
  return doc;
}

const record = (by: string, org: string, aid: string, via: string | null = "email", on: string | null = "2026-10-01") =>
  run(
    by,
    `INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body, source, received_via, received_on)
     VALUES ($1,$2,$3,$4,'Board approved the draft','client_portal',$5,$6) RETURNING source`,
    [projectOf[org], org, aid, by, via, on],
  );

const invite = (by: string, org: string, email: string, role: string) =>
  run(
    by,
    `INSERT INTO invitations (org_id, email, name, role, token_hash, invited_by, expires_at) VALUES ($1,$2,'New',$3,$4,$5,now())`,
    [org, email, role, hash(email), by],
  );

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE audit_log`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES
      ($1,'firm','firm',NULL,false), ($2,'client','Acme',NULL,true), ($3,'client','Quiet','restricted',false), ($4,'client','Family','consultant_managed',false)`,
    [FIRM, ACME, RESTR, MANAGED],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$9,'firm_admin'), ($2,$9,'consultant'), ($3,$9,'consultant'),
      ($4,$10,'client_admin'), ($5,$10,'client_manager'), ($6,$10,'action_owner'), ($7,$10,'action_owner'),
      ($8,$11,'client_admin')`,
    [U.admin, U.lead, U.cons, U.cadmin, U.cmgr, U.hr, U.fin, U.radmin, FIRM, ACME, RESTR],
  );
  for (const org of [ACME, RESTR, MANAGED]) {
    await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [org, U.lead]);
    await q(
      `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Work','active',$4)`,
      [projectOf[org], org, FIRM, U.admin],
    );
    await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4)`, [
      recOf[org],
      projectOf[org],
      org,
      U.lead,
    ]);
    await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [projectOf[org], U.lead]);
  }
  await q(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$2)`, [MANAGED, U.cons]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($3,$4), ($3,$5), ($3,$6)`, [
    P.managed,
    U.cons,
    P.acme,
    U.cmgr,
    U.hr,
    U.fin,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P.restr, U.radmin]);
  await q(
    `INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'الموارد البشرية','HR'), ($2,$3,'المالية','Finance')`,
    [DEPT.hr, DEPT.fin, ACME],
  );
  await q(`INSERT INTO department_members (department_id, user_id, is_head) VALUES ($1,$2,false), ($3,$4,false), ($1,$5,true)`, [
    DEPT.hr,
    U.hr,
    DEPT.fin,
    U.fin,
    U.cmgr,
  ]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("engagement mode", () => {
  it("is set for every client, never for the firm, and only the firm admin changes it", async () => {
    const modes = (await owner.query(`SELECT id, engagement_mode FROM organizations ORDER BY id`)).rows.map(
      (r) => r.engagement_mode,
    );
    expect(modes).toEqual([null, "full", "restricted", "consultant_managed"]);
    await expect(owner.query(`UPDATE organizations SET engagement_mode = 'full' WHERE id = $1`, [FIRM])).rejects.toThrow(
      /engagement_mode_clients/,
    );
    await expect(run(U.cadmin, `UPDATE organizations SET engagement_mode = 'restricted' WHERE id = $1`, [ACME])).rejects.toThrow(
      /the firm manages/,
    );
    await expect(run(U.cadmin, `UPDATE organizations SET kind = 'firm' WHERE id = $1`, [ACME])).rejects.toThrow(
      /kind never changes/,
    );
    await expect(run(U.cadmin, `UPDATE organizations SET status = 'archived' WHERE id = $1`, [ACME])).rejects.toThrow(
      /the firm manages/,
    );
    // A client admin keeps its own settings.
    await run(U.cadmin, `UPDATE organizations SET name_ar = 'أكمي' WHERE id = $1`, [ACME]);
  });

  it("is entered only when the client's accounts already fit it", async () => {
    await expect(
      run(U.admin, `UPDATE organizations SET engagement_mode = 'consultant_managed' WHERE id = $1`, [ACME]),
    ).rejects.toThrow(/switch off the client's accounts/);
    await expect(run(U.admin, `UPDATE organizations SET engagement_mode = 'restricted' WHERE id = $1`, [ACME])).rejects.toThrow(
      /admin accounts only/,
    );
  });
});

describe("consultant-managed", () => {
  it("has no client accounts: invites and memberships fail", async () => {
    await expect(invite(U.admin, MANAGED, "owner@family.example", "client_admin")).rejects.toThrow(/managed by the firm/);
    const uid = next();
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1,'x',$2)`, [uid, `${uid}@example.test`]);
    await expect(
      owner.query(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'action_owner')`, [uid, MANAGED]),
    ).rejects.toThrow(/managed by the firm/);
  });

  it("the firm records progress on the client's behalf, and the source is forced", async () => {
    const aid = await action(MANAGED, { ownerName: "Majed (finance manager)" });
    const { rows } = await record(U.lead, MANAGED, aid);
    expect(rows[0].source).toBe("consultant_recorded");
    // Saying how and when the client told the firm is required.
    await expect(record(U.lead, MANAGED, aid, null, null)).rejects.toThrow(/progress_updates_received/);
    await expect(record(U.lead, MANAGED, aid, "phone", "2999-01-01")).rejects.toThrow(/future/);
    // "Today" is the firm's (Riyadh) day, not the database session's: where the
    // session's date is still yesterday, the firm's today is not "in the future".
    const late = await as(
      U.lead,
      async (c) => {
        await c.query(`SET LOCAL TIME ZONE 'Pacific/Pago_Pago'`);
        return c.query(
          `INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body, source, received_via, received_on)
           VALUES ($1,$2,$3,$4,'Told us on the phone','client_portal','phone',(now() AT TIME ZONE 'Asia/Riyadh')::date) RETURNING source`,
          [projectOf[MANAGED], MANAGED, aid, U.lead],
        );
      },
      true,
    );
    expect(late.rows[0].source).toBe("consultant_recorded");
    // In a full engagement the client records its own work.
    const full = await action(ACME, { owner: U.hr });
    await expect(record(U.lead, ACME, full)).rejects.toThrow(/client records its own/);
    expect((await record(U.hr, ACME, full, null, null)).rows[0].source).toBe("client_portal");
  });

  it("the firm submits evidence for it, and whoever recorded the round does not review it", async () => {
    const aid = await action(MANAGED, { ownerName: "Majed" });
    const doc = await upload(U.lead, MANAGED, { purpose: "evidence" });
    const sub = await run(
      U.lead,
      `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by, received_via, received_on)
       VALUES ($1,$2,$3,$4,$5,'email','2026-10-02') RETURNING source`,
      [P.managed, MANAGED, aid, doc, U.lead],
    );
    expect(sub.rows[0].source).toBe("consultant_recorded");
    await owner.query(`UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [aid]);
    const review = (by: string) =>
      attempt(by, `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [
        P.managed,
        MANAGED,
        aid,
        by,
      ]);
    await expect(review(U.lead)).rejects.toThrow(/row-level security/);
    await review(U.cons);

    // Recording progress alone also counts.
    const other = await action(MANAGED, { ownerName: "Majed" });
    await record(U.cons, MANAGED, other);
    await owner.query(`UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [other]);
    await expect(
      attempt(U.cons, `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [
        P.managed,
        MANAGED,
        other,
        U.cons,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("reminders for an action with no account owner go to the lead consultant", async () => {
    const aid = await action(MANAGED, { ownerName: "Majed", due: "2026-10-10" });
    const due = (await owner.query(`SELECT * FROM app_follow_ups_due('2026-10-12') WHERE action_id = $1`, [aid])).rows;
    expect(due).toHaveLength(1);
    expect(due[0].level).toBe(1);
    expect(due[0].recipients).toEqual([U.lead]);
  });
});

describe("restricted", () => {
  it("has client admins only, up to the firm's limit", async () => {
    await expect(invite(U.radmin, RESTR, "mgr@quiet.example", "client_manager")).rejects.toThrow(/admin accounts only/);
    await expect(invite(U.radmin, RESTR, "own@quiet.example", "action_owner")).rejects.toThrow(/admin accounts only/);
    await invite(U.radmin, RESTR, "second@quiet.example", "client_admin");
    const second = next();
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1,'x',$2)`, [second, `${second}@example.test`]);
    await owner.query(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'client_admin')`, [second, RESTR]);
    // Two admins is the default limit.
    await expect(invite(U.radmin, RESTR, "third@quiet.example", "client_admin")).rejects.toThrow(/at most 2/);
    await owner.query(`UPDATE org_memberships SET active = false, deactivation_reason = 'test' WHERE user_id = $1`, [second]);
  });

  it("a client upload is private to the client until its admin shares it, one way", async () => {
    const doc = await upload(U.radmin, RESTR, { visibility: "shared" });
    expect((await owner.query(`SELECT visibility FROM documents WHERE id = $1`, [doc])).rows[0].visibility).toBe(
      "client_private",
    );
    expect(await sees(U.lead, "documents", doc)).toBe(false);
    expect(await sees(U.admin, "documents", doc)).toBe(false);
    // Nobody but the client admin can share it.
    await expect(owner.query(`UPDATE documents SET visibility = 'shared' WHERE id = $1`, [doc])).rejects.toThrow(
      /only the client's admin/,
    );
    await expect(run(U.radmin, `UPDATE documents SET visibility = 'firm_private' WHERE id = $1`, [doc])).rejects.toThrow(
      /can only be shared/,
    );
    await run(U.radmin, `UPDATE documents SET visibility = 'shared' WHERE id = $1`, [doc]);
    expect(await sees(U.lead, "documents", doc)).toBe(true);
    const logged = await owner.query(`SELECT actor_id FROM activity_events WHERE entity_id = $1 AND event = 'document_shared'`, [
      doc,
    ]);
    expect(logged.rows).toEqual([{ actor_id: U.radmin }]);
    await expect(run(U.radmin, `UPDATE documents SET visibility = 'client_private' WHERE id = $1`, [doc])).rejects.toThrow(
      /cannot be made private/,
    );
  });

  it("evidence cannot point at a file the firm cannot open", async () => {
    const aid = await action(RESTR, { owner: U.radmin });
    const doc = await upload(U.radmin, RESTR);
    await expect(
      run(
        U.radmin,
        `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`,
        [P.restr, RESTR, aid, doc, U.radmin],
      ),
    ).rejects.toThrow(/share the file/);
    // Evidence uploads are shared by submitting them.
    const ev = await upload(U.radmin, RESTR, { purpose: "evidence" });
    expect(await sees(U.lead, "documents", ev)).toBe(true);
  });
});

describe("departments", () => {
  it("hide a department's work from the rest of the client, not from its admin or the firm", async () => {
    const hrAction = await action(ACME, { dept: DEPT.hr, owner: U.cmgr });
    const finAction = await action(ACME, { dept: DEPT.fin, owner: U.cmgr });
    await record(U.cmgr, ACME, hrAction, null, null);
    expect(await sees(U.hr, "actions", hrAction)).toBe(true);
    expect(await sees(U.fin, "actions", hrAction)).toBe(false);
    expect(await sees(U.fin, "actions", finAction)).toBe(true);
    for (const who of [U.cadmin, U.lead]) {
      expect(await sees(who, "actions", hrAction)).toBe(true);
      expect(await sees(who, "actions", finAction)).toBe(true);
    }
    const updates = (uid: string) => attempt(uid, `SELECT 1 FROM progress_updates WHERE action_id = $1`, [hrAction]);
    expect((await updates(U.fin)).rowCount).toBe(0);
    expect((await updates(U.hr)).rowCount).toBe(1);
    // An action's owner sees it whatever its department.
    const owned = await action(ACME, { dept: DEPT.hr, owner: U.fin });
    expect(await sees(U.fin, "actions", owned)).toBe(true);

    // Switched off, everyone on the project sees everything again.
    await run(U.cadmin, `UPDATE organizations SET departments_enabled = false WHERE id = $1`, [ACME]);
    expect(await sees(U.fin, "actions", hrAction)).toBe(true);
    expect((await updates(U.fin)).rowCount).toBe(1);
    await run(U.cadmin, `UPDATE organizations SET departments_enabled = true WHERE id = $1`, [ACME]);
    const audited = await owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'organization.departments' AND org_id = $1`,
      [ACME],
    );
    expect(audited.rows[0].n).toBe(2);
  });

  it("keep a department's files and their assistant chunks inside it", async () => {
    const doc = await upload(U.lead, ACME, { dept: DEPT.hr });
    expect(await sees(U.hr, "documents", doc)).toBe(true);
    expect(await sees(U.fin, "documents", doc)).toBe(false);
    // Passages are read only while their file is open to the assistant (baseline: AI sources).
    await owner.query(`UPDATE documents SET ai_indexable = true WHERE id = $1`, [doc]);
    await owner.query(
      `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, content, embedding)
       VALUES ($1,$2,'document',$3,'shared',0,'canary: HR salary bands', array_fill(0.1, ARRAY[1024])::vector)`,
      [P.acme, ACME, doc],
    );
    const chunks = (uid: string) => attempt(uid, `SELECT department_id FROM ai_chunks WHERE content LIKE 'canary:%'`);
    expect((await chunks(U.hr)).rows).toEqual([{ department_id: DEPT.hr }]);
    expect((await chunks(U.fin)).rowCount).toBe(0);
    expect((await chunks(U.lead)).rowCount).toBe(1);
    // Refiling the document takes its chunks out until it is indexed again.
    await owner.query(`UPDATE documents SET department_id = $1 WHERE id = $2`, [DEPT.fin, doc]);
    expect((await chunks(U.lead)).rowCount).toBe(0);
  });

  it("evidence and its file follow the action's department", async () => {
    const aid = await action(ACME, { dept: DEPT.hr, owner: U.hr });
    const doc = await upload(U.hr, ACME, { purpose: "evidence" });
    await run(
      U.hr,
      `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`,
      [P.acme, ACME, aid, doc, U.hr],
    );
    expect((await owner.query(`SELECT department_id FROM documents WHERE id = $1`, [doc])).rows[0].department_id).toBe(DEPT.hr);
    expect(await sees(U.fin, "documents", doc)).toBe(false);
    expect((await attempt(U.fin, `SELECT 1 FROM evidence_submissions WHERE action_id = $1`, [aid])).rowCount).toBe(0);
  });

  it("have the client's own active people as members, managed by its admins", async () => {
    await expect(
      run(U.cadmin, `INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [DEPT.hr, U.lead]),
    ).rejects.toThrow(/active people of the client/);
    await expect(
      run(U.cmgr, `INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [DEPT.fin, U.hr]),
    ).rejects.toThrow(/row-level security/);
    await expect(run(U.admin, `INSERT INTO departments (org_id, name_ar) VALUES ($1,'x')`, [FIRM])).rejects.toThrow(
      /belong to a client/,
    );
    // A department's head is reminded at level 2, besides the client's managers.
    await run(U.cadmin, `INSERT INTO department_members (department_id, user_id, is_head) VALUES ($1,$2,true)`, [DEPT.fin, U.hr]);
    const aid = await action(ACME, { dept: DEPT.fin, owner: U.fin, due: "2026-09-01" });
    const recipients = async (a: string) =>
      (await owner.query(`SELECT * FROM app_follow_ups_due('2026-10-12') WHERE action_id = $1`, [a])).rows[0].recipients;
    expect(await recipients(aid)).toEqual(expect.arrayContaining([U.fin, U.hr, U.cmgr, U.lead]));
    const noDept = await action(ACME, { owner: U.fin, due: "2026-09-01" });
    expect(await recipients(noDept)).not.toContain(U.hr);
  });
});

describe("departments across the work", () => {
  const rec = async (fields: { dept?: string | null; accountable?: string | null } = {}) => {
    const rid = next();
    await run(
      U.lead,
      `INSERT INTO recommendations (id, project_id, org_id, title, department_id, accountable_user_id, created_by) VALUES ($1,$2,$3,'Payroll controls',$4,$5,$6)`,
      [rid, P.acme, ACME, fields.dept ?? null, fields.accountable ?? null, U.lead],
    );
    return rid;
  };
  const deptOf = async (aid: string) => (await owner.query(`SELECT department_id FROM actions WHERE id = $1`, [aid])).rows[0].department_id;

  it("keep a department's recommendation inside it, except for whoever owns one of its actions", async () => {
    const rid = await rec({ dept: DEPT.hr });
    expect(await sees(U.hr, "recommendations", rid)).toBe(true);
    expect(await sees(U.fin, "recommendations", rid)).toBe(false);
    for (const who of [U.cadmin, U.lead]) expect(await sees(who, "recommendations", rid)).toBe(true);
    const company = await rec();
    expect(await sees(U.fin, "recommendations", company)).toBe(true);
    // Finance owns an action under it: they read what they implement.
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, department_id, status, created_by)
       VALUES ($1,$2,$3,$4,'Reconcile payroll',$5,$6,'in_progress',$7)`,
      [next(), P.acme, ACME, rid, U.fin, DEPT.hr, U.lead],
    );
    expect(await sees(U.fin, "recommendations", rid)).toBe(true);
    // So does the person accountable for it, from any department.
    const named = await rec({ dept: DEPT.hr, accountable: U.fin });
    expect(await sees(U.fin, "recommendations", named)).toBe(true);
  });

  it("file an action under its recommendation's department, and refile it with the recommendation", async () => {
    const rid = await rec({ dept: DEPT.hr });
    const aid = next();
    await run(
      U.lead,
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by) VALUES ($1,$2,$3,$4,'Write the policy',$5,'assigned',$6)`,
      [aid, P.acme, ACME, rid, U.hr, U.lead],
    );
    expect(await deptOf(aid)).toBe(DEPT.hr);
    await expect(run(U.lead, `UPDATE actions SET department_id = $1 WHERE id = $2`, [DEPT.fin, aid])).rejects.toThrow(
      /follows its recommendation's department/,
    );
    await run(U.lead, `UPDATE recommendations SET department_id = $1 WHERE id = $2`, [DEPT.fin, rid]);
    expect(await deptOf(aid)).toBe(DEPT.fin);
    // A company-wide recommendation's actions may each be a different department's.
    const company = await rec();
    const hr = await action(ACME, { dept: DEPT.hr });
    await owner.query(`UPDATE actions SET recommendation_id = $1 WHERE id = $2`, [company, hr]);
    expect(await deptOf(hr)).toBe(DEPT.hr);
  });

  it("name as accountable only someone at the client who is on the project", async () => {
    for (const who of [U.cadmin, U.cmgr]) await rec({ accountable: who });
    for (const who of [U.lead, U.radmin]) {
      await expect(rec({ accountable: who })).rejects.toThrow(/someone at the client on this project/);
    }
    const outsider = next();
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1,'x',$2)`, [outsider, `${outsider}@example.test`]);
    await owner.query(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'client_manager')`, [outsider, ACME]);
    await expect(rec({ accountable: outsider })).rejects.toThrow(/someone at the client on this project/);
  });

  it("give a department's meeting that department's agenda, and keep its department", async () => {
    await action(ACME, { dept: DEPT.hr, status: "blocked" });
    await owner.query(`UPDATE actions SET title = 'HR canary', blocked_reason = 'waiting' WHERE status = 'blocked' AND department_id = $1`, [DEPT.hr]);
    const fin = await action(ACME, { dept: DEPT.fin, status: "blocked" });
    await owner.query(`UPDATE actions SET title = 'Finance canary', blocked_reason = 'waiting' WHERE id = $1`, [fin]);
    const book = async (dept: string | null) =>
      (
        await run(
          U.lead,
          `INSERT INTO meetings (project_id, org_id, kind, title, starts_at, ends_at, location, organizer_id, ics_uid, department_id)
           VALUES ($1,$2,'status','Check-in', now() + interval '1 day', now() + interval '1 day 1 hour', 'in_person', $3, 'x', $4)
           RETURNING id, agenda_md`,
          [P.acme, ACME, U.lead, dept],
        )
      ).rows[0];
    const hr = await book(DEPT.hr);
    expect(hr.agenda_md).toContain("HR canary");
    expect(hr.agenda_md).not.toContain("Finance canary");
    const whole = await book(null);
    expect(whole.agenda_md).toContain("Finance canary");
    await expect(run(U.lead, `UPDATE meetings SET department_id = $1 WHERE id = $2`, [DEPT.fin, hr.id])).rejects.toThrow(
      /keeps its department/,
    );
  });

  it("offer as accountable the client's admins and its people on the project", async () => {
    const opts = await svc(U.lead, (tx, p) => planOptions(tx, p, P.acme));
    expect(opts?.accountables.map((a) => a.userId).sort()).toEqual(
      expect.arrayContaining([U.cadmin, U.cmgr, U.hr, U.fin]),
    );
    expect(opts?.accountables.map((a) => a.userId)).not.toContain(U.lead);
    expect((await svc(U.cons, (tx, p) => planOptions(tx, p, P.managed)))?.accountables).toEqual([]);
  });
});

describe("changing mode", () => {
  it("keeps the data: restricted to full keeps client-private files private", async () => {
    const doc = await upload(U.radmin, RESTR);
    await run(U.admin, `UPDATE organizations SET engagement_mode = 'full' WHERE id = $1`, [RESTR]);
    expect((await owner.query(`SELECT visibility FROM documents WHERE id = $1`, [doc])).rows[0].visibility).toBe(
      "client_private",
    );
    expect(await sees(U.lead, "documents", doc)).toBe(false);
    expect(await sees(U.radmin, "documents", doc)).toBe(true);
    // Back to restricted is fine: its only account is an admin.
    await run(U.admin, `UPDATE organizations SET engagement_mode = 'restricted' WHERE id = $1`, [RESTR]);
    const log = await owner.query(
      `SELECT actor_id, meta FROM audit_log WHERE action = 'organization.engagement_mode' AND org_id = $1 ORDER BY created_at`,
      [RESTR],
    );
    expect(log.rows.map((r) => r.meta)).toEqual([
      { from: "restricted", to: "full" },
      { from: "full", to: "restricted" },
    ]);
    expect(log.rows[0].actor_id).toBe(U.admin);
  });
});

describe("the engagement screens", () => {
  it("tell the firm admin what stands in the way of each mode, and nobody else", async () => {
    const acme = await svc(U.admin, (tx, p) => getEngagement(tx, p, ACME));
    const active = (await owner.query(`SELECT role FROM org_memberships WHERE org_id = $1 AND active`, [ACME])).rows;
    expect(acme.canChangeMode).toBe(true);
    expect(acme.fit).toEqual({
      activeAccounts: active.length,
      nonAdminAccounts: active.filter((r) => r.role !== "client_admin").length,
      restrictedMaxAdmins: 2,
      hasContactsOrFiles: true,
    });
    expect(acme.fit!.nonAdminAccounts).toBeGreaterThan(0);
    const managed = await svc(U.admin, (tx, p) => getEngagement(tx, p, MANAGED));
    expect(managed.fit).toMatchObject({ activeAccounts: 0, nonAdminAccounts: 0 });
    // The client's admin manages its departments but not its mode.
    const own = await svc(U.cadmin, (tx, p) => getEngagement(tx, p, ACME));
    expect(own).toMatchObject({ canChangeMode: false, canManageDepartments: true, fit: null });
    expect(own.departments.map((d) => d.nameEn)).toEqual(expect.arrayContaining(["HR", "Finance"]));
    await expect(svc(U.cadmin, (tx, p) => setEngagement(tx, p, ACME, { engagementMode: "restricted" }))).rejects.toThrow();
  });

  it("give the database's refusal a message the screen knows", async () => {
    // The route passes on the database's own words (src/server/http.ts).
    const words = (e: Error & { cause?: Error }) => e.cause?.message ?? e.message;
    const refusal = await svc(U.admin, (tx, p) => setEngagement(tx, p, ACME, { engagementMode: "consultant_managed" })).catch(
      words,
    );
    expect(engagementError(String(refusal))).toBe("accounts");
    const alias = await svc(U.admin, (tx, p) => setEngagement(tx, p, MANAGED, { minimalRecords: true, displayAlias: " " })).catch(
      words,
    );
    expect(engagementError(String(alias))).toBe("alias");
  });

  it("offer an action the client's departments only while it uses them", async () => {
    const on = await svc(U.lead, (tx, p) => departmentChoices(tx, p, ACME));
    expect(on?.enabled).toBe(true);
    expect(on?.departments.map((d) => d.id)).toEqual(expect.arrayContaining([DEPT.hr, DEPT.fin]));
    // Someone who may not read them gets no choices (the page hides the picker), not an error.
    expect(await svc(U.cadmin, (tx, p) => departmentChoices(tx, p, RESTR))).toBeNull();
    expect((await svc(U.lead, (tx, p) => departmentChoices(tx, p, MANAGED)))?.enabled).toBe(false);
  });

  it("offer the add-an-action form only owners the server accepts, and the client's way of naming them", async () => {
    const acme = await svc(U.lead, (tx, p) => planOptions(tx, p, P.acme));
    expect(acme?.can).toEqual({ finding: true, recommendation: true, action: true, release: true });
    // The client's people on the team, each still an active member: not the firm's consultants.
    expect(acme?.owners.map((o) => o.userId).sort()).toEqual([U.cmgr, U.hr, U.fin].sort());
    expect(acme?.ownerByName).toBe(false);
    expect(acme?.departments.map((d) => d.id).sort()).toEqual([DEPT.hr, DEPT.fin].sort());
    // A consultant-managed client has no accounts, so its owners are named, not picked.
    const managed = await svc(U.cons, (tx, p) => planOptions(tx, p, P.managed));
    expect(managed?.ownerByName).toBe(true);
    expect(managed?.owners).toEqual([]);
    expect(managed?.departments).toEqual([]);
    // The client's own people can't add to the firm's plan, so they get no form at all.
    expect(await svc(U.cmgr, (tx, p) => planOptions(tx, p, P.acme))).toBeNull();
    // Someone who left the client drops off the list.
    await owner.query(`UPDATE org_memberships SET active = false WHERE user_id = $1 AND org_id = $2`, [U.fin, ACME]);
    try {
      const after = await svc(U.lead, (tx, p) => planOptions(tx, p, P.acme));
      expect(after?.owners.map((o) => o.userId)).not.toContain(U.fin);
    } finally {
      await owner.query(`UPDATE org_memberships SET active = true WHERE user_id = $1 AND org_id = $2`, [U.fin, ACME]);
    }
  });
  it("the assistant's status answer counts late work by the firm's day, as the action screens do", async () => {
    const today = firmToday();
    const dueToday = await action(MANAGED, { ownerName: "Majed (finance manager)", due: today });
    // A session whose date is already tomorrow: due today is not overdue yet.
    const passages = await as(U.lead, async (c) => {
      await c.query(`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`);
      return statusRecords(drizzle(c, { schema }) as unknown as Tx, P.managed, new Set(["overdue"]));
    });
    expect(passages.some((p) => p.type === "action" && p.id === dueToday)).toBe(false);
    expect(passages.find((p) => p.type === "project")?.text).toContain(today);
  });
});
