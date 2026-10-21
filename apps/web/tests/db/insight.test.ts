// Research section 11 (migrations 0026-0027) against a real Postgres:
// verified counts by the source of their evidence, minimal records for
// consultant-managed clients, the trace, and "since your last visit".
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a300-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full
const FAM = id(3); // consultant-managed
const MIN = id(4); // consultant-managed, minimal records
const U = { admin: id(11), lead: id(12), cons: id(13), cmgr: id(14), cowner: id(15) };
const P = { acme: id(21), fam: id(22), min: id(23) };
const REC = { acme: id(31), fam: id(32), min: id(33) };
const DEPT = id(41);
let n = 100;
const next = () => id(++n);

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
const run = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const attempt = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));

const projectOf: Record<string, string> = { [ACME]: P.acme, [FAM]: P.fam, [MIN]: P.min };
const recOf: Record<string, string> = { [ACME]: REC.acme, [FAM]: REC.fam, [MIN]: REC.min };

async function action(org: string, fields: { owner?: string | null; ownerName?: string; dept?: string; rec?: string } = {}) {
  const aid = next();
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, owner_name, department_id, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_progress',$9)`,
    [
      aid,
      projectOf[org],
      org,
      fields.rec ?? recOf[org],
      `Action ${aid.slice(-3)}`,
      fields.owner ?? null,
      fields.ownerName ?? null,
      fields.dept ?? null,
      U.lead,
    ],
  );
  return aid;
}

async function evidence(by: string, org: string, aid: string, received = false) {
  const doc = next();
  await owner.query(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$4,$5,'evidence','submitted','e.pdf','shared',$6,'application/pdf',1,'x','clean')`,
    [doc, projectOf[org], org, by === U.cowner ? org : FIRM, by, `k-${doc}`],
  );
  await run(
    by,
    `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by, received_via, received_on) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [projectOf[org], org, aid, doc, by, received ? "email" : null, received ? "2026-10-01" : null],
  );
}

async function verify(org: string, aid: string, reviewer: string) {
  await owner.query(`UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [aid]);
  await run(reviewer, `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [
    projectOf[org],
    org,
    aid,
    reviewer,
  ]);
  await run(reviewer, `UPDATE actions SET status = 'verified_complete' WHERE id = $1`, [aid]);
}

const basis = async (uid: string, aid: string) => (await attempt(uid, `SELECT app_verified_basis($1) AS b`, [aid])).rows[0].b;

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES
      ($1,'firm','firm',NULL), ($2,'client','Acme','full'), ($3,'client','Family','consultant_managed'), ($4,'client','Quiet family','consultant_managed')`,
    [FIRM, ACME, FAM, MIN],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$6,'firm_admin'), ($2,$6,'consultant'), ($3,$6,'consultant'), ($4,$7,'client_manager'), ($5,$7,'action_owner')`,
    [U.admin, U.lead, U.cons, U.cmgr, U.cowner, FIRM, ACME],
  );
  for (const org of [ACME, FAM, MIN]) {
    await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false)`, [
      org,
      U.lead,
      U.cons,
    ]);
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
    await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [projectOf[org], U.lead, U.cons]);
  }
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [P.acme, U.cmgr, U.cowner]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("verified on whose evidence", () => {
  it("counts a consultant-managed action verified on recorded evidence as consultant_recorded only", async () => {
    const aid = await action(FAM, { ownerName: "Office manager" });
    await evidence(U.lead, FAM, aid, true);
    await verify(FAM, aid, U.cons);
    expect(await basis(U.lead, aid)).toBe("consultant_recorded");
    const m = (await attempt(U.lead, `SELECT * FROM v_project_metrics WHERE project_id = $1`, [P.fam])).rows[0];
    expect([m.verified, m.verified_consultant_recorded, m.verified_client_evidence, m.verified_mixed]).toEqual([1, 1, 0, 0]);
  });

  it("counts the client's own evidence apart, and only verified actions have a basis", async () => {
    const aid = await action(ACME, { owner: U.cowner });
    await evidence(U.cowner, ACME, aid);
    expect(await basis(U.lead, aid)).toBeNull();
    await verify(ACME, aid, U.lead);
    expect(await basis(U.cmgr, aid)).toBe("client_evidence");
    const m = (await attempt(U.cmgr, `SELECT * FROM v_project_metrics WHERE project_id = $1`, [P.acme])).rows[0];
    expect([m.verified_client_evidence, m.verified_consultant_recorded]).toEqual([1, 0]);
  });

  it("falls back to the round's recorded progress when there was no evidence", async () => {
    const aid = await action(FAM, { ownerName: "Office manager" });
    await run(
      U.lead,
      `INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body, received_via, received_on) VALUES ($1,$2,$3,$4,'done','phone','2026-10-02')`,
      [P.fam, FAM, aid, U.lead],
    );
    await verify(FAM, aid, U.cons);
    expect(await basis(U.lead, aid)).toBe("consultant_recorded");
  });
});

describe("minimal records", () => {
  it("are switched on by the firm admin, for a consultant-managed client, before anything is filed", async () => {
    const on = `UPDATE organizations SET minimal_records = true, display_alias = $2 WHERE id = $1`;
    await expect(run(U.admin, on, [ACME, "Client A"])).rejects.toThrow(/clients the firm manages/);
    await expect(run(U.admin, `UPDATE organizations SET minimal_records = true WHERE id = $1`, [MIN])).rejects.toThrow(/alias/);
    await owner.query(`INSERT INTO client_contacts (org_id, name) VALUES ($1,'Majed')`, [MIN]);
    await expect(run(U.admin, on, [MIN, "Client M"])).rejects.toThrow(/remove the client's contacts and files/);
    await owner.query(`DELETE FROM client_contacts WHERE org_id = $1`, [MIN]);
    // The inquiries they came from, with the requester's details.
    const inq = async (client: string, name: string) => {
      const iid = next();
      await owner.query(
        `INSERT INTO inquiries (id, firm_org_id, public_ref, org_name, org_name_ar, cr_number, contact_name, contact_role, contact_email,
           contact_phone, message, sector_id, employee_band, ownership_type, self_check, privacy_notice_version, consented_at,
           preferred_language, status, conflict_status, client_org_id)
         VALUES ($1,$2,$3,$4,$4,'1010999999','Majed','CEO','majed@example.test','+966 55 111 1111',$4 || ' wants a charter',
           (SELECT id FROM sectors LIMIT 1),'50-249','family_multi_partner','{}','2026-10-20',now(),'ar','won','clear',$5)`,
        [iid, FIRM, `INQ-${iid.slice(-8)}`, name, client],
      );
      await owner.query(
        `INSERT INTO discovery_sessions (inquiry_id, scheduled_at, mode, created_by, attendees, notes) VALUES ($1, now(), 'video', $2, 'Majed', $3)`,
        [iid, U.lead, `${name} family tensions`],
      );
      await owner.query(`INSERT INTO inquiry_events (inquiry_id, event, note) VALUES ($1, 'conflict_checked', $2)`, [
        iid,
        `${name} is clear`,
      ]);
      return iid;
    };
    const mine = await inq(MIN, "Quiet family");
    const theirs = await inq(FAM, "Family");
    await run(U.admin, on, [MIN, " Client M "]);
    // Nothing the firm holds still names the client, and another client's inquiry is untouched.
    const named = await owner.query(
      `SELECT t FROM (
         SELECT 'inquiries' AS t, to_jsonb(i)::text AS v FROM inquiries i
         UNION ALL SELECT 'discovery_sessions', to_jsonb(d)::text FROM discovery_sessions d
         UNION ALL SELECT 'inquiry_events', to_jsonb(e)::text FROM inquiry_events e
         UNION ALL SELECT 'organizations', to_jsonb(o)::text FROM organizations o
         UNION ALL SELECT 'audit_log', to_jsonb(a)::text FROM audit_log a
         UNION ALL SELECT 'activity_events', to_jsonb(a)::text FROM activity_events a) x
       WHERE v ILIKE '%Quiet family%' OR v ILIKE '%majed%' AND v ILIKE '%' || $1 || '%'`,
      [mine],
    );
    expect(named.rows).toEqual([]);
    const gone = (await owner.query(`SELECT anonymised_at, client_org_id, status FROM inquiries WHERE id = $1`, [mine])).rows[0];
    expect([gone.anonymised_at !== null, gone.client_org_id, gone.status]).toEqual([true, MIN, "won"]);
    const kept = (await owner.query(`SELECT org_name, anonymised_at FROM inquiries WHERE id = $1`, [theirs])).rows[0];
    expect(kept).toEqual({ org_name: "Family", anonymised_at: null });
    const notes = await owner.query(`SELECT count(*)::int AS n FROM discovery_sessions WHERE notes IS NOT NULL`);
    expect(notes.rows[0].n).toBe(1);
    // Firm staff cannot use that path to rewrite an inquiry.
    await expect(
      run(U.admin, `UPDATE inquiries SET org_name = 'Someone else', anonymised_at = now() WHERE id = $1`, [theirs]),
    ).rejects.toThrow(/not allowed/);
    const org = (await owner.query(`SELECT name, name_ar, display_alias FROM organizations WHERE id = $1`, [MIN])).rows[0];
    expect(org).toEqual({ name: "Client M", name_ar: "Client M", display_alias: "Client M" });
    // The alias stays the name; leaving consultant-managed is refused while it is on.
    await expect(run(U.admin, `UPDATE organizations SET name = 'Real name' WHERE id = $1`, [MIN])).resolves.toBeDefined();
    expect((await owner.query(`SELECT name FROM organizations WHERE id = $1`, [MIN])).rows[0].name).toBe("Client M");
    await expect(run(U.admin, `UPDATE organizations SET engagement_mode = 'full' WHERE id = $1`, [MIN])).rejects.toThrow(
      /clients the firm manages/,
    );
  });

  it("refuse files, contacts, the assistant index and account owners", async () => {
    await expect(evidence(U.lead, MIN, await action(MIN, { ownerName: "Finance manager" }), true)).rejects.toThrow(/no files/);
    await expect(run(U.lead, `INSERT INTO client_contacts (org_id, name) VALUES ($1,'Majed')`, [MIN])).rejects.toThrow(
      /no contacts/,
    );
    await expect(
      owner.query(
        `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, content, embedding)
         VALUES ($1,$2,'action',$3,'shared',0,'x', array_fill(0.1, ARRAY[1024])::vector)`,
        [P.min, MIN, REC.min],
      ),
    ).rejects.toThrow(/no assistant index/);
    await expect(action(MIN, { owner: U.cowner })).rejects.toThrow(/job title/);
  });

  it("purge free text once, after handover plus the firm's days, keeping statuses and dates", async () => {
    const aid = await action(MIN, { ownerName: "Finance manager" });
    await run(
      U.lead,
      `INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body, received_via, received_on) VALUES ($1,$2,$3,$4,'family dispute details','meeting','2026-01-10')`,
      [P.min, MIN, aid, U.lead],
    );
    await owner.query(
      `INSERT INTO action_notes (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'private note')`,
      [P.min, MIN, aid, U.lead],
    );
    await owner.query(
      `INSERT INTO meeting_notes (project_id, org_id, author_id, held_on, title, body) VALUES ($1,$2,$3,'2026-01-05','Kickoff','who said what')`,
      [P.min, MIN, U.lead],
    );
    await owner.query(`UPDATE recommendations SET rationale = 'the eldest son decides alone' WHERE id = $1`, [REC.min]);
    await owner.query(`UPDATE actions SET description = 'ask the uncles' WHERE id = $1`, [aid]);
    await owner.query(`UPDATE projects SET handover_on = '2026-06-01' WHERE id = $1`, [P.min]);
    const purge = async (day: string) => (await owner.query(`SELECT app_purge_minimal_records($1::date) AS n`, [day])).rows[0].n;
    expect(await purge("2026-08-29")).toBe(0); // 89 days
    expect(await purge("2026-08-30")).toBe(1);
    expect(await purge("2026-12-01")).toBe(0);
    const texts = await owner.query(
      `SELECT (SELECT array_agg(body) FROM progress_updates WHERE project_id = $1) AS updates,
              (SELECT array_agg(body) FROM action_notes WHERE project_id = $1) AS notes,
              (SELECT array_agg(body) FROM meeting_notes WHERE project_id = $1) AS meetings`,
      [P.min],
    );
    expect(texts.rows[0]).toEqual({ updates: ["—"], notes: ["—"], meetings: ["—"] });
    const plan = await owner.query(
      `SELECT r.title, r.rationale, a.description, a.status FROM actions a JOIN recommendations r ON r.id = a.recommendation_id WHERE a.id = $1`,
      [aid],
    );
    expect(plan.rows[0]).toEqual({ title: "Charter", rationale: "—", description: "—", status: "in_progress" });
    const pu = (await owner.query(`SELECT source, received_on FROM progress_updates WHERE action_id = $1`, [aid])).rows[0];
    expect(pu.source).toBe("consultant_recorded");
    expect(pu.received_on).not.toBeNull();
    // The app still cannot change append-only rows, even if it sets the flag.
    await expect(
      as(U.lead, async (c) => {
        await c.query(`SELECT set_config('selah.purge', 'on', true)`);
        return c.query(`UPDATE progress_updates SET body = 'x' WHERE action_id = $1`, [aid]);
      }),
    ).rejects.toThrow(/append-only|permission denied/);
  });
});

describe("the trace", () => {
  it("leaves out what the caller cannot see, and every link to it", async () => {
    const hidden = next();
    const open = next();
    const hiddenRec = next();
    const openRec = next();
    await owner.query(
      `INSERT INTO findings (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$3,$4,'Internal view','firm_private',$5), ($2,$3,$4,'No charter','shared',$5)`,
      [hidden, open, P.acme, ACME, U.lead],
    );
    await owner.query(
      `INSERT INTO recommendations (id, project_id, org_id, finding_id, title, created_by) VALUES ($1,$3,$4,$5,'Rec on hidden',$7), ($2,$3,$4,$6,'Rec on open',$7)`,
      [hiddenRec, openRec, P.acme, ACME, hidden, open, U.lead],
    );
    await owner.query(`UPDATE organizations SET departments_enabled = true WHERE id = $1`, [ACME]);
    await owner.query(`INSERT INTO departments (id, org_id, name_ar) VALUES ($1,$2,'المالية')`, [DEPT, ACME]);
    const plain = await action(ACME, { owner: U.cmgr, rec: openRec });
    const scoped = await action(ACME, { owner: U.cmgr, rec: hiddenRec, dept: DEPT });

    const trace = async (uid: string) => (await attempt(uid, `SELECT * FROM app_trace($1)`, [P.acme])).rows;
    const client = await trace(U.cowner);
    const ids = client.map((r) => r.node_id);
    expect(ids).not.toContain(hidden);
    expect(client.map((r) => r.parent_id)).not.toContain(hidden);
    expect(ids).not.toContain(scoped);
    expect(client.find((r) => r.node_id === hiddenRec)).toMatchObject({ parent_type: null, parent_id: null });
    expect(client.find((r) => r.node_id === plain)).toMatchObject({ parent_type: "recommendation", parent_id: openRec });

    const firm = await trace(U.lead);
    expect(firm.find((r) => r.node_id === hiddenRec)).toMatchObject({ parent_type: "finding", parent_id: hidden });
    expect(firm.map((r) => r.node_id)).toContain(scoped);
    // Verified actions carry their evidence and reviews.
    const kinds = new Set(firm.map((r) => r.node_type));
    expect([...kinds].sort()).toEqual(expect.arrayContaining(["action", "evidence", "finding", "recommendation", "review"]));
    await owner.query(`UPDATE organizations SET departments_enabled = false WHERE id = $1`, [ACME]);
  });
});

describe("since your last visit", () => {
  it("lists what moved since then, and visits are each person's own", async () => {
    const aid = await action(ACME, { owner: U.cowner });
    await owner.query(`UPDATE actions SET updated_at = now() - interval '2 days' WHERE project_id = $1`, [P.acme]);
    const since = new Date(Date.now() - 86_400_000).toISOString();
    await run(
      U.cowner,
      `INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'drafted')`,
      [P.acme, ACME, aid, U.cowner],
    );
    const changed = (await attempt(U.cmgr, `SELECT * FROM app_changed_actions($1, $2)`, [P.acme, since])).rows;
    expect(changed.map((c) => c.action_id)).toContain(aid);
    expect(changed.every((c) => new Date(c.changed_at) > new Date(since))).toBe(true);

    await run(U.cmgr, `INSERT INTO project_visits (user_id, project_id) VALUES ($1,$2)`, [U.cmgr, P.acme]);
    await expect(
      run(U.cmgr, `INSERT INTO project_visits (user_id, project_id) VALUES ($1,$2)`, [U.cowner, P.acme]),
    ).rejects.toThrow(/row-level security/);
    await expect(run(U.cmgr, `INSERT INTO project_visits (user_id, project_id) VALUES ($1,$2)`, [U.cmgr, P.fam])).rejects.toThrow(
      /row-level security/,
    );
    expect((await attempt(U.cowner, `SELECT * FROM project_visits`)).rowCount).toBe(0);
  });
});
