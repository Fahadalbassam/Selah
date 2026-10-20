// Row-level security tests against a real Postgres with the migrations
// applied. They connect as selah_app (the runtime role) and prove the
// database blocks cross-tenant, cross-project and label leaks even when
// app code asks for the wrong rows directly.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { retrieve } from "@/services/assistant";
import type { Tx } from "@/db/client";
import { ACME, ACME_PROJ_1, ACME_PROJ_2, BETA, BETA_PROJ, FIRM } from "../fixtures";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const U = {
  lead: id(1),
  consultant: id(2),
  acmeAdmin: id(3),
  acmeManager: id(4),
  acmeOwner: id(5),
  betaManager: id(6),
  overseer: id(7), // lead consultant of Beta, member of no project
};
const INTERNAL = id(501);
const REC_INTERNAL = id(104);
const REC_ACME_1 = id(101);
const REC_ACME_2 = id(102);
const REC_BETA = id(103);
const ACTION_ACME = id(201);
const DOC_SHARED = id(301);
const DOC_CLIENT_PRIVATE = id(302);
const DOC_DRAFT_EVIDENCE = id(303);
const DOC_BETA = id(304);
const NOTE_PRIVATE = id(401);

const vec = (hot: number) => `[${Array.from({ length: 1024 }, (_, i) => (i === hot ? 1 : 0)).join(",")}]`;

/** Run fn as `userId` inside a rolled-back transaction on the app role. */
async function as<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

async function count(userId: string | null, table: string, where = "true", params: unknown[] = []) {
  return as(userId, async (c) => Number((await c.query(`SELECT count(*) FROM ${table} WHERE ${where}`, params)).rows[0].count));
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(`INSERT INTO account (account_id, provider_id, user_id, password) VALUES ($1, 'credential', $2, 'scrypt-hash')`, [U.acmeManager, U.acmeManager]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$8,'client_admin'),
      ($4,$8,'client_manager'), ($5,$8,'action_owner'), ($6,$9,'client_manager'), ($10,$7,'consultant')`,
    [U.lead, U.consultant, U.acmeAdmin, U.acmeManager, U.acmeOwner, U.betaManager, FIRM, ACME, BETA, U.overseer],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES
      ($1,'client',$4,$6,'Acme governance','active'), ($2,'client',$4,$6,'Acme HR policy','active'),
      ($3,'client',$5,$6,'Beta strategy','active'), ($7,'internal',$6,$6,'Firm methodology','active')`,
    [ACME_PROJ_1, ACME_PROJ_2, BETA_PROJ, ACME, BETA, FIRM, INTERNAL],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1, $2, true)`, [BETA, U.overseer]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)`, [INTERNAL, U.consultant]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Internal method',$4)`, [
    REC_INTERNAL,
    INTERNAL,
    FIRM,
    U.lead,
  ]);
  await q(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1,$3), ($1,$4), ($1,$5), ($2,$3), ($6,$7)`,
    [ACME_PROJ_1, ACME_PROJ_2, U.consultant, U.acmeManager, U.acmeOwner, BETA_PROJ, U.betaManager],
  );
  // Make the consultant a member of ACME_PROJ_1 only.
  await q(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [ACME_PROJ_2, U.consultant]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES
      ($1,$4,$6,'Board charter',$8), ($2,$5,$6,'HR policy',$8), ($3,$7,$9,'Beta rec',$8)`,
    [REC_ACME_1, REC_ACME_2, REC_BETA, ACME_PROJ_1, ACME_PROJ_2, ACME, BETA_PROJ, U.consultant, BETA],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by)
     VALUES ($1,$2,$3,$4,'Draft the charter',$5,'assigned',$6)`,
    [ACTION_ACME, ACME_PROJ_1, ACME, REC_ACME_1, U.acmeOwner, U.consultant],
  );
  const doc = (docId: string, eng: string, org: string, ownerOrg: string, by: string, purpose: string, state: string, vis: string) =>
    q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
         ai_indexable, storage_key, content_type, size_bytes, sha256)
       VALUES ($1,$2,$3,$4,$5,$6::document_purpose,$7,'doc',$8,$6::document_purpose <> 'evidence',$9,'application/pdf',1,'x')`,
      [docId, eng, org, ownerOrg, by, purpose, state, vis, `key-${docId}`],
    );
  await doc(DOC_SHARED, ACME_PROJ_1, ACME, FIRM, U.consultant, "deliverable", "submitted", "shared");
  await doc(DOC_CLIENT_PRIVATE, ACME_PROJ_1, ACME, ACME, U.acmeManager, "client_document", "submitted", "client_private");
  await doc(DOC_DRAFT_EVIDENCE, ACME_PROJ_1, ACME, ACME, U.acmeOwner, "evidence", "draft", "shared");
  await doc(DOC_BETA, BETA_PROJ, BETA, FIRM, U.consultant, "deliverable", "submitted", "shared");
  await q(
    `INSERT INTO meeting_notes (id, project_id, org_id, author_id, held_on, title, body, visibility)
     VALUES ($1,$2,$3,$4,'2026-10-01','Internal','Our private view','firm_private')`,
    [NOTE_PRIVATE, ACME_PROJ_1, ACME, U.consultant],
  );
  const chunk = (docId: string, eng: string, org: string, vis: string, hot: number) =>
    q(
      `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, content, embedding)
       VALUES ($1,$2,'document',$3,$4,0,$5,$6)`,
      [eng, org, docId, vis, `chunk of ${docId}`, vec(hot)],
    );
  await chunk(DOC_SHARED, ACME_PROJ_1, ACME, "shared", 1);
  await chunk(DOC_CLIENT_PRIVATE, ACME_PROJ_1, ACME, "client_private", 0);
  await chunk(DOC_BETA, BETA_PROJ, BETA, "shared", 0);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("RLS is on everywhere", () => {
  it("every table in public has row-level security enabled", async () => {
    const { rows } = await owner.query(
      `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("the app role cannot bypass RLS", async () => {
    const { rows } = await owner.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'selah_app'`);
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("with no user set, nothing is visible", async () => {
    for (const t of ["organizations", "projects", "recommendations", "actions", "documents", "ai_chunks", "meeting_notes"]) {
      expect(await count(null, t), t).toBe(0);
    }
  });

  it("the app role cannot read passwords or sessions", async () => {
    await expect(as(U.acmeManager, (c) => c.query("SELECT password FROM account"))).rejects.toThrow(/permission denied/);
    await expect(as(U.acmeManager, (c) => c.query("SELECT token FROM session"))).rejects.toThrow(/permission denied/);
  });

  it("the app role cannot read the audit log", async () => {
    await expect(as(U.lead, (c) => c.query("SELECT * FROM audit_log"))).rejects.toThrow(/permission denied/);
  });
});

describe("scenario 5: tenant isolation", () => {
  it("Beta's manager sees none of Acme's rows, even by id", async () => {
    expect(await count(U.betaManager, "recommendations", "id = $1", [REC_ACME_1])).toBe(0);
    expect(await count(U.betaManager, "documents", "org_id = $1", [ACME])).toBe(0);
    expect(await count(U.betaManager, "ai_chunks", "org_id = $1", [ACME])).toBe(0);
    expect(await count(U.betaManager, "organizations", "id = $1", [ACME])).toBe(0);
    expect(await count(U.betaManager, `"user"`, "id = $1", [U.acmeManager])).toBe(0);
  });

  it("Beta's manager cannot write into Acme's project", async () => {
    await expect(
      as(U.betaManager, (c) =>
        c.query(`INSERT INTO recommendations (project_id, org_id, title, created_by) VALUES ($1,$2,'x',$3)`, [
          ACME_PROJ_1,
          ACME,
          U.betaManager,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a mismatched project and tenant pair is rejected by the foreign key", async () => {
    await expect(
      owner.query(`INSERT INTO recommendations (project_id, org_id, title, created_by) VALUES ($1,$2,'x',$3)`, [
        ACME_PROJ_1,
        BETA,
        U.consultant,
      ]),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("scenario 6: project membership", () => {
  it("Acme's manager sees project 1 but not project 2", async () => {
    expect(await count(U.acmeManager, "recommendations", "id = $1", [REC_ACME_1])).toBe(1);
    expect(await count(U.acmeManager, "recommendations", "id = $1", [REC_ACME_2])).toBe(0);
  });

  it("the consultant sees only their project; the lead and client admin see more", async () => {
    expect(await count(U.consultant, "recommendations", "org_id = $1", [ACME])).toBe(1);
    expect(await count(U.lead, "recommendations")).toBe(4);
    expect(await count(U.acmeAdmin, "recommendations")).toBe(2);
  });
});

describe("hierarchy: client assignments", () => {
  it("a consultant assigned to Beta sees Beta's projects and nothing of Acme", async () => {
    expect(await count(U.overseer, "recommendations", "id = $1", [REC_BETA])).toBe(1);
    expect(await count(U.overseer, "recommendations", "org_id = $1", [ACME])).toBe(0);
    expect(await count(U.overseer, "organizations", "id = $1", [BETA])).toBe(1);
    expect(await count(U.overseer, "organizations", "id = $1", [ACME])).toBe(0);
  });

  it("client users see the consultants assigned to their organization, and no others", async () => {
    expect(await count(U.betaManager, "\"user\"", "id = $1", [U.overseer])).toBe(1);
    expect(await count(U.acmeOwner, "\"user\"", "id = $1", [U.overseer])).toBe(0);
  });

  it("a consultant not assigned to Beta never sees it", async () => {
    expect(await count(U.consultant, "organizations", "id = $1", [BETA])).toBe(0);
    expect(await count(U.consultant, "projects", "id = $1", [BETA_PROJ])).toBe(0);
  });

  it("only the firm admin can assign consultants to clients", async () => {
    await expect(
      as(U.consultant, (c) => c.query(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$2)`, [BETA, U.consultant])),
    ).rejects.toThrow(/row-level security/);
    await as(U.lead, (c) =>
      c.query(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$2)`, [ACME, U.overseer]),
    );
  });
});

describe("internal projects", () => {
  it("are visible to the firm admin and members, never to clients or non-member consultants", async () => {
    expect(await count(U.lead, "recommendations", "id = $1", [REC_INTERNAL])).toBe(1);
    expect(await count(U.consultant, "recommendations", "id = $1", [REC_INTERNAL])).toBe(1);
    expect(await count(U.overseer, "recommendations", "id = $1", [REC_INTERNAL])).toBe(0);
    for (const u of [U.acmeAdmin, U.acmeManager, U.acmeOwner, U.betaManager]) {
      expect(await count(u, "projects", "id = $1", [INTERNAL])).toBe(0);
      expect(await count(u, "recommendations", "id = $1", [REC_INTERNAL])).toBe(0);
    }
  });

  it("must belong to the firm itself", async () => {
    await expect(
      owner.query(`INSERT INTO projects (kind, org_id, firm_org_id, title) VALUES ('internal', $1, $2, 'x')`, [ACME, FIRM]),
    ).rejects.toThrow(/internal project belongs to the firm/);
  });
});

describe("scenario 7: labels", () => {
  it("Firm-private notes are invisible to every Acme user", async () => {
    for (const u of [U.acmeAdmin, U.acmeManager, U.acmeOwner]) {
      expect(await count(u, "meeting_notes", "id = $1", [NOTE_PRIVATE])).toBe(0);
    }
    expect(await count(U.consultant, "meeting_notes", "id = $1", [NOTE_PRIVATE])).toBe(1);
  });

  it("client-private documents and their chunks are invisible to firm, including the lead", async () => {
    for (const u of [U.lead, U.consultant]) {
      expect(await count(u, "documents", "id = $1", [DOC_CLIENT_PRIVATE])).toBe(0);
      expect(await count(u, "ai_chunks", "source_id = $1", [DOC_CLIENT_PRIVATE])).toBe(0);
    }
    expect(await count(U.acmeManager, "documents", "id = $1", [DOC_CLIENT_PRIVATE])).toBe(1);
  });

  it("draft evidence is visible only to its uploader", async () => {
    expect(await count(U.acmeOwner, "documents", "id = $1", [DOC_DRAFT_EVIDENCE])).toBe(1);
    expect(await count(U.acmeManager, "documents", "id = $1", [DOC_DRAFT_EVIDENCE])).toBe(0);
    expect(await count(U.consultant, "documents", "id = $1", [DOC_DRAFT_EVIDENCE])).toBe(0);
  });
});

describe("scenario 3 and 10: workflow and history", () => {
  it("a client cannot record a review", async () => {
    await expect(
      as(U.acmeManager, (c) =>
        c.query(
          `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`,
          [ACME_PROJ_1, ACME, ACTION_ACME, U.acmeManager],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("nobody can record a review in someone else's name", async () => {
    await expect(
      as(U.consultant, (c) =>
        c.query(
          `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`,
          [ACME_PROJ_1, ACME, ACTION_ACME, U.lead],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("moves outside the diagram are rejected by the database", async () => {
    await expect(
      as(U.consultant, (c) => c.query(`UPDATE actions SET status = 'verified_complete' WHERE id = $1`, [ACTION_ACME])),
    ).rejects.toThrow(/invalid action status change/);
  });

  it("Verified Complete needs an accept review, and then succeeds", async () => {
    await as(U.consultant, async (c) => {
      await c.query(`UPDATE actions SET status = 'in_progress' WHERE id = $1`, [ACTION_ACME]);
      await c.query(`UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [ACTION_ACME]);
      await c.query("SAVEPOINT s");
      await expect(c.query(`UPDATE actions SET status = 'verified_complete' WHERE id = $1`, [ACTION_ACME])).rejects.toThrow(
        /needs an accept review/,
      );
      await c.query("ROLLBACK TO SAVEPOINT s");
      await c.query(
        `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`,
        [ACME_PROJ_1, ACME, ACTION_ACME, U.consultant],
      );
      const res = await c.query(`UPDATE actions SET status = 'verified_complete' WHERE id = $1 RETURNING status`, [ACTION_ACME]);
      expect(res.rows[0].status).toBe("verified_complete");
    });
  });

  it("reviews are append-only, even for the schema owner", async () => {
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      const { rows } = await c.query(
        `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'revise') RETURNING id`,
        [ACME_PROJ_1, ACME, ACTION_ACME, U.consultant],
      );
      await expect(c.query(`UPDATE reviews SET outcome = 'accept' WHERE id = $1`, [rows[0].id])).rejects.toThrow(/append-only/);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});

describe("scenario 8: AI index", () => {
  it("turning the AI flag off removes the document's chunks at once", async () => {
    await as(U.consultant, async (c) => {
      expect((await c.query(`SELECT count(*) FROM ai_chunks WHERE source_id = $1`, [DOC_SHARED])).rows[0].count).toBe("1");
      await c.query(`UPDATE documents SET ai_indexable = false WHERE id = $1`, [DOC_SHARED]);
      expect((await c.query(`SELECT count(*) FROM ai_chunks WHERE source_id = $1`, [DOC_SHARED])).rows[0].count).toBe("0");
    });
  });

  it("retrieval returns only in-scope chunks, even when another tenant's chunk is the closest match", async () => {
    await as(U.consultant, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      const query = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)); // nearest: Beta and client-private chunks
      const rows = await retrieve(
        tx,
        { projectId: ACME_PROJ_1, orgId: ACME, labels: ["shared", "firm_private", "user_private"], userId: U.consultant },
        query,
      );
      expect(rows.map((r) => r.sourceId)).toEqual([DOC_SHARED]);
    });
  });

  it("a forged scope pointing at another tenant still returns nothing (RLS backstop)", async () => {
    await as(U.consultant, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      const rows = await retrieve(
        tx,
        { projectId: BETA_PROJ, orgId: BETA, labels: ["shared", "client_private"], userId: U.consultant },
        Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
      );
      expect(rows).toEqual([]);
    });
  });
});

describe("staffing: leads, join requests and the client directory", () => {
  const assign = (c: PoolClient, client: string, user: string, lead = false) =>
    c.query(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,$3)`, [client, user, lead]);

  it("a client's lead adds consultants to that client only, and cannot make a new lead", async () => {
    await as(U.overseer, async (c) => {
      await assign(c, BETA, U.consultant);
      await c.query("SAVEPOINT s");
      await expect(assign(c, ACME, U.consultant)).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await expect(c.query(`UPDATE client_assignments SET is_lead = true WHERE user_id = $1 RETURNING 1`, [U.consultant])).resolves.toMatchObject({
        rowCount: 0,
      });
    });
  });

  it("only consultants can be assigned to a client", async () => {
    await expect(as(U.lead, (c) => assign(c, BETA, U.lead))).rejects.toThrow(/only consultants/);
  });

  it("a consultant asks to join; only the admin or that client's lead decides, once", async () => {
    await as(U.consultant, async (c) => {
      await c.query(`INSERT INTO join_requests (client_org_id, user_id, reason) VALUES ($1,$2,'I know the sector')`, [BETA, U.consultant]);
      await expect(c.query(`UPDATE join_requests SET status = 'approved', decided_by = $1`, [U.consultant])).rejects.toThrow(
        /row-level security/,
      );
    });
    await as(U.consultant, (c) =>
      c.query(`INSERT INTO join_requests (client_org_id, user_id, reason) VALUES ($1,$2,'x')`, [BETA, U.consultant]),
    );
    const c = await owner.connect();
    try {
      await c.query(`INSERT INTO join_requests (client_org_id, user_id, reason) VALUES ($1,$2,'please')`, [BETA, U.consultant]);
    } finally {
      c.release();
    }
    await as(U.overseer, async (c) => {
      const r = await c.query(`UPDATE join_requests SET status = 'approved', decided_by = $1 WHERE user_id = $2 RETURNING decided_at`, [
        U.overseer,
        U.consultant,
      ]);
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].decided_at).not.toBeNull();
    });
    await expect(
      owner.query(`UPDATE join_requests SET status = 'declined' WHERE user_id = $1 AND status = 'pending'`, [U.consultant]),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(owner.query(`UPDATE join_requests SET status = 'approved' WHERE user_id = $1`, [U.consultant])).rejects.toThrow(
      /already decided/,
    );
    await owner.query(`DELETE FROM join_requests`);
  });

  it("a consultant cannot ask to join a client they are already on", async () => {
    await expect(
      as(U.overseer, (c) => c.query(`INSERT INTO join_requests (client_org_id, user_id, reason) VALUES ($1,$2,'x')`, [BETA, U.overseer])),
    ).rejects.toThrow(/row-level security/);
  });

  it("the directory lists client names to firm staff and to nobody else", async () => {
    const names = await as(U.consultant, async (c) => (await c.query(`SELECT name FROM app_client_directory()`)).rows.map((r) => r.name));
    expect(names).toEqual(["Acme", "Beta"]);
    expect(await as(U.acmeAdmin, async (c) => (await c.query(`SELECT * FROM app_client_directory()`)).rowCount)).toBe(0);
  });
});

describe("internal projects: creation and work", () => {
  const NEW_PROJ = id(601);
  const REC_NEW = id(602);
  const ACTION_NEW = id(603);

  it("a consultant creates an internal project and becomes its lead; clients cannot", async () => {
    await as(U.consultant, async (c) => {
      await c.query(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, created_by) VALUES ($1,'internal',$2,$2,'New method',$3)`, [
        NEW_PROJ,
        FIRM,
        U.consultant,
      ]);
      await c.query(`INSERT INTO project_members (project_id, user_id, is_lead) VALUES ($1,$2,true)`, [NEW_PROJ, U.consultant]);
      await c.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [NEW_PROJ, U.overseer]);
      await c.query("SAVEPOINT s");
      await expect(
        c.query(`INSERT INTO projects (kind, org_id, firm_org_id, title, created_by) VALUES ('client',$1,$2,'x',$3)`, [ACME, FIRM, U.consultant]),
      ).rejects.toThrow(/row-level security/);
    });
    await expect(
      as(U.acmeAdmin, (c) =>
        c.query(`INSERT INTO projects (kind, org_id, firm_org_id, title, created_by) VALUES ('internal',$1,$1,'x',$2)`, [FIRM, U.acmeAdmin]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("nobody else can claim another person's new project", async () => {
    await as(U.consultant, async (c) => {
      await c.query(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, created_by) VALUES ($1,'internal',$2,$2,'Mine',$3)`, [
        NEW_PROJ,
        FIRM,
        U.consultant,
      ]);
      await c.query("SELECT set_config('selah.user_id', $1, true)", [U.overseer]);
      await expect(
        c.query(`INSERT INTO project_members (project_id, user_id, is_lead) VALUES ($1,$2,true)`, [NEW_PROJ, U.overseer]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("the owner submits evidence on an internal action but cannot review it; a colleague can", async () => {
    await owner.query(
      `INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Templates',$4)`,
      [REC_NEW, INTERNAL, FIRM, U.lead],
    );
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by)
       VALUES ($1,$2,$3,$4,'Draft template',$5,'in_progress',$6)`,
      [ACTION_NEW, INTERNAL, FIRM, REC_NEW, U.consultant, U.lead],
    );
    try {
      await as(U.consultant, async (c) => {
        await c.query(
          `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256)
           VALUES ($1,$2,$3,$3,$4,'evidence','submitted','t.pdf','shared','k-internal','application/pdf',1,'x')`,
          [id(604), INTERNAL, FIRM, U.consultant],
        );
        await c.query(
          `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`,
          [INTERNAL, FIRM, ACTION_NEW, id(604), U.consultant],
        );
        await expect(
          c.query(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [
            INTERNAL,
            FIRM,
            ACTION_NEW,
            U.consultant,
          ]),
        ).rejects.toThrow(/row-level security/);
      });
      await as(U.lead, (c) =>
        c.query(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [
          INTERNAL,
          FIRM,
          ACTION_NEW,
          U.lead,
        ]),
      );
    } finally {
      await owner.query(`DELETE FROM actions WHERE id = $1`, [ACTION_NEW]);
      await owner.query(`DELETE FROM recommendations WHERE id = $1`, [REC_NEW]);
    }
  });
});

describe("evidence integrity", () => {
  it("a stored file cannot be swapped, and evidence cannot be deleted, even by the schema owner", async () => {
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      await expect(c.query(`UPDATE documents SET sha256 = 'other' WHERE id = $1`, [DOC_DRAFT_EVIDENCE])).rejects.toThrow(/cannot change/);
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await expect(c.query(`DELETE FROM documents WHERE id = $1`, [DOC_DRAFT_EVIDENCE])).rejects.toThrow(/cannot be deleted/);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("a scan result is written once", async () => {
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      await c.query(`UPDATE documents SET scan_status = 'infected' WHERE id = $1`, [DOC_DRAFT_EVIDENCE]);
      await expect(c.query(`UPDATE documents SET scan_status = 'clean' WHERE id = $1`, [DOC_DRAFT_EVIDENCE])).rejects.toThrow(/final/);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("unverified evidence never enters the AI index, whoever asks", async () => {
    await expect(
      as(U.acmeOwner, (c) => c.query(`UPDATE documents SET ai_indexable = true WHERE id = $1`, [DOC_DRAFT_EVIDENCE])),
    ).rejects.toThrow(/only after the firm verified/);
    await expect(
      as(U.lead, (c) =>
        c.query(
          `INSERT INTO documents (project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, ai_indexable, storage_key, content_type, size_bytes, sha256)
           VALUES ($1,$2,$2,$3,'evidence','submitted','x',true,'k-ai','application/pdf',1,'x')`,
          [ACME_PROJ_1, ACME, U.lead],
        ),
      ),
    ).rejects.toThrow(/only after the firm verified/);
  });
});

describe("review integrity", () => {
  const REC = id(701);
  const ACT = id(702);
  const DOC_ROUND_1 = id(703);
  const DOC_ROUND_2 = id(704);
  const SUB_1 = id(705);
  const SUB_2 = id(706);

  // Rows written as the schema owner (no RLS), so each step is one statement.
  const submit = async (doc: string, sub: string, by: string) => {
    await owner.query(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256)
       VALUES ($1,$2,$3,$3,$4,'evidence','submitted','e.pdf','shared',$5,'application/pdf',1,'x')`,
      [doc, INTERNAL, FIRM, by, `k-${doc}`],
    );
    await owner.query(
      `INSERT INTO evidence_submissions (id, project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [sub, INTERNAL, FIRM, ACT, doc, by],
    );
  };
  const review = (by: string, outcome: string, subs: string[]) =>
    as(by, (c) =>
      c.query(
        `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome, evidence_submission_ids) VALUES ($1,$2,$3,$4,$5,$6::uuid[])`,
        [INTERNAL, FIRM, ACT, by, outcome, subs],
      ),
    );
  // `as` rolls back, so an allowed review is then recorded for real by the owner.
  const reviewAndKeep = async (by: string, outcome: string, subs: string[]) => {
    await review(by, outcome, subs);
    await owner.query(
      `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome, evidence_submission_ids) VALUES ($1,$2,$3,$4,$5,$6::uuid[])`,
      [INTERNAL, FIRM, ACT, by, outcome, subs],
    );
  };
  const index = (doc: string) => as(U.lead, (c) => c.query(`UPDATE documents SET ai_indexable = true WHERE id = $1`, [doc]));

  it("submitters of the current round cannot review it, and only files a review accepted reach the index", async () => {
    await owner.query(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Review',$4)`, [
      REC,
      INTERNAL,
      FIRM,
      U.lead,
    ]);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by)
       VALUES ($1,$2,$3,$4,'Write guide',$5,'awaiting_review',$6)`,
      [ACT, INTERNAL, FIRM, REC, U.overseer, U.lead],
    );
    // Evidence and reviews are append-only, so these rows stay behind.
    // Round 1: the admin attached a file, so the admin may not review it.
    await submit(DOC_ROUND_1, SUB_1, U.lead);
    await expect(review(U.lead, "revise", [SUB_1])).rejects.toThrow(/row-level security/);
    await reviewAndKeep(U.consultant, "revise", [SUB_1]);
    // Once that round is reviewed, the admin's earlier file no longer counts.
    await review(U.lead, "revise", []);

    // Round 2: the admin submits again and is blocked again; the consultant
    // accepts only the new file, so the round-1 file stays out of the index.
    await submit(DOC_ROUND_2, SUB_2, U.lead);
    await expect(review(U.lead, "accept", [SUB_2])).rejects.toThrow(/row-level security/);
    await reviewAndKeep(U.consultant, "accept", [SUB_2]);

    await expect(index(DOC_ROUND_1)).rejects.toThrow(/only after the firm verified/);
    await index(DOC_ROUND_2);
  });
});

describe("staffed-only visibility, co-consulting and watching", () => {
  const ACT = id(801);
  const ACT0 = id(802);
  const asUser = (c: { query: (s: string, p?: unknown[]) => Promise<unknown> }, uid: string) =>
    c.query("SELECT set_config('selah.user_id', $1, true)", [uid]);

  it("a consultant on a client's team sees its projects only once the lead staffs them", async () => {
    await as(U.lead, async (c) => {
      await c.query(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$2)`, [BETA, U.consultant]);
      await asUser(c, U.consultant);
      expect((await c.query(`SELECT 1 FROM organizations WHERE id = $1`, [BETA])).rowCount).toBe(1);
      expect((await c.query(`SELECT 1 FROM projects WHERE id = $1`, [BETA_PROJ])).rowCount).toBe(0);
      expect((await c.query(`SELECT 1 FROM recommendations WHERE id = $1`, [REC_BETA])).rowCount).toBe(0);

      // The lead staffs from the client team only.
      await asUser(c, U.overseer);
      await c.query("SAVEPOINT s");
      await expect(c.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [BETA_PROJ, U.lead])).rejects.toThrow(
        /row-level security/,
      );
      await c.query("ROLLBACK TO SAVEPOINT s");
      await c.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [BETA_PROJ, U.consultant]);

      await asUser(c, U.consultant);
      expect((await c.query(`SELECT 1 FROM projects WHERE id = $1`, [BETA_PROJ])).rowCount).toBe(1);
      expect((await c.query(`SELECT 1 FROM recommendations WHERE id = $1`, [REC_BETA])).rowCount).toBe(1);
      // A staffed member cannot staff others.
      await expect(c.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [BETA_PROJ, U.overseer])).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it("only firm admins watch, and only for themselves", async () => {
    await as(U.lead, (c) => c.query(`INSERT INTO watches (user_id, client_org_id) VALUES ($1,$2)`, [U.lead, BETA]));
    await expect(
      as(U.lead, (c) => c.query(`INSERT INTO watches (user_id, project_id) VALUES ($1,$2)`, [U.overseer, BETA_PROJ])),
    ).rejects.toThrow(/row-level security/);
    for (const u of [U.overseer, U.betaManager]) {
      await expect(as(u, (c) => c.query(`INSERT INTO watches (user_id, project_id) VALUES ($1,$2)`, [u, BETA_PROJ]))).rejects.toThrow(
        /row-level security/,
      );
    }
  });

  it("work for review reaches the client's lead and watching admins, and nobody else", async () => {
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by)
       VALUES ($1,$2,$3,$4,'Beta plan',$5,'awaiting_review',$6)`,
      [ACT, BETA_PROJ, BETA, REC_BETA, U.betaManager, U.overseer],
    );
    await as(U.lead, async (c) => {
      await c.query(`INSERT INTO watches (user_id, client_org_id) VALUES ($1,$2)`, [U.lead, BETA]);
      // A client user triggers it, though they cannot see the watching admin.
      await asUser(c, U.betaManager);
      const sent = await c.query(`SELECT app_notify_project_team($1, 'action.awaiting_review', $2::uuid[]) AS n`, [ACT, [U.betaManager]]);
      expect(sent.rows[0].n).toBe(2);
      const got = async (uid: string) => {
        await asUser(c, uid);
        return (await c.query(`SELECT 1 FROM notifications WHERE entity_id = $1`, [ACT])).rowCount;
      };
      expect(await got(U.lead)).toBe(1);
      expect(await got(U.overseer)).toBe(1);
      expect(await got(U.consultant)).toBe(0);
    });
    await expect(
      as(U.acmeOwner, (c) => c.query(`SELECT app_notify_project_team($1, 'action.awaiting_review', '{}')`, [ACT])),
    ).rejects.toThrow(/not visible/);
    // Nobody can forge another kind, or "awaiting review" for an action that is not.
    await expect(
      as(U.betaManager, (c) => c.query(`SELECT app_notify_project_team($1, 'action.verified_complete', '{}')`, [ACT])),
    ).rejects.toThrow(/does not match/);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by)
       VALUES ($1,$2,$3,$4,'Beta follow-up',$5,'in_progress',$6)`,
      [ACT0, BETA_PROJ, BETA, REC_BETA, U.betaManager, U.overseer],
    );
    await expect(
      as(U.betaManager, (c) => c.query(`SELECT app_notify_project_team($1, 'action.awaiting_review', '{}')`, [ACT0])),
    ).rejects.toThrow(/does not match/);
  });

  it("on a client project the admin staffs only the client's team, its users, or themselves", async () => {
    await as(U.lead, async (c) => {
      await c.query("SAVEPOINT s");
      await expect(c.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [BETA_PROJ, U.consultant])).rejects.toThrow(
        /row-level security/,
      );
      await c.query("ROLLBACK TO SAVEPOINT s");
      await c.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [BETA_PROJ, U.lead]);
    });
  });
});
