// Decision D1 (product owner, 17 Nov 2026; batch 4): one open action may be
// given to a colleague in the same organisation, by the firm (staff on the
// project, not observers) and, on the client side, by the client's admin and
// the project's coordinator and sponsor only. The status does not change.
// Told: the new owner (on the action), the old owner (never an action notice:
// they no longer read it), the client's lead and deputy, and the consultants
// staffed on the project. Audited. On a minimal-records client the owner is
// a typed name (a job title), never an account.
//
// The rules are in the database (app_can_change_owner(), check_action_transition()
// and app_tell_owner_changed(), migration 0101) and in services/action-owner.ts.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { changeActionOwner, ownerControl } from "@/services/action-owner";
import { transitionAction } from "@/services/actions";
import { listNotifications } from "@/services/notifications";
import { updateAction } from "@/services/plan";
import { loadPrincipal } from "@/services/principal";
import { getActionDetail } from "@/services/queries";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-b2d1-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full engagement
const OTHER = id(3); // another client of the firm
const MIN = id(4); // consultant-managed, minimal records
const P = id(5);
const PO = id(6);
const PM = id(7);
const U = {
  fadmin: id(11),
  lead: id(12), // Acme's lead consultant, staffed on P
  deputy: id(13), // Acme's deputy, not staffed (sees its projects as the lead does)
  staff: id(14), // staffed on P
  observer: id(15), // observing P
  stranger: id(16), // a consultant on nothing of Acme's
  cadmin: id(21),
  coord: id(22), // client manager, P's coordinator
  sponsor: id(23), // client manager, P's sponsor
  mgr: id(24), // client manager on P, no role
  owner1: id(25),
  owner2: id(26),
  offProject: id(27), // Acme action owner, not on P
  otherOwner: id(28), // an owner at the other client
  minLead: id(29), // MIN's lead consultant, staffed on PM
};
const REC = { p: id(31), o: id(32), m: id(33) };
const A = { open: id(41), awaiting: id(42), verified: id(43), draft: id(44), other: id(45), min: id(46) };

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
async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = false): Promise<R> {
  return as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      const p = await loadPrincipal(tx, userId);
      return fn(tx, p!).catch((e: Error & { cause?: Error }) => {
        throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
      });
    },
    commit,
  );
}
const NOT_FOUND = /forbidden|not found|row-level security|insufficient/i;
const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
const ownerOf = async (aid: string) => (await q(`SELECT owner_user_id, owner_name, status::text FROM actions WHERE id = $1`, [aid])).rows[0];
const notices = async (aid: string) =>
  (
    await q(
      `SELECT user_id, kind, entity_type FROM notifications
       WHERE (entity_type = 'action' AND entity_id = $1) OR (entity_type = 'project' AND kind = 'action.owner_moved')
       ORDER BY kind, user_id`,
      [aid],
    )
  ).rows;

beforeAll(async () => {
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, minimal_records, display_alias) VALUES
      ($1,'firm','Mizan Advisory',NULL,false,NULL), ($2,'client','Acme',NULL,false,NULL), ($3,'client','Other',NULL,false,NULL),
      ($4,'client','Family office','consultant_managed',true,'Client F')`,
    [FIRM, ACME, OTHER, MIN],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$16,'firm_admin'), ($2,$16,'consultant'), ($3,$16,'consultant'), ($4,$16,'consultant'), ($5,$16,'consultant'), ($6,$16,'consultant'), ($15,$16,'consultant'),
      ($7,$17,'client_admin'), ($8,$17,'client_manager'), ($9,$17,'client_manager'), ($10,$17,'client_manager'),
      ($11,$17,'action_owner'), ($12,$17,'action_owner'), ($13,$17,'action_owner'),
      ($14,$18,'action_owner')`,
    [
      U.fadmin, U.lead, U.deputy, U.staff, U.observer, U.stranger,
      U.cadmin, U.coord, U.sponsor, U.mgr, U.owner1, U.owner2, U.offProject, U.otherOwner,
      U.minLead, FIRM, ACME, OTHER,
    ],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$7,'Acme governance','active',$8), ($3,'client',$4,$7,'Other governance','active',$8), ($5,'client',$6,$7,'Family office plan','active',$8)`,
    [P, ACME, PO, OTHER, PM, MIN, FIRM, U.fadmin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$6,false,false), ($4,$2,true,false), ($5,$7,true,false)`,
    [ACME, U.lead, U.deputy, OTHER, MIN, U.staff, U.minLead],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$3,false), ($1,$4,false), ($1,$5,true), ($1,$6,false), ($1,$7,false), ($1,$8,false), ($1,$9,false), ($1,$10,false),
      ($2,$11,false), ($2,$3,false), ($12,$13,false)`,
    [P, PO, U.lead, U.staff, U.observer, U.coord, U.sponsor, U.mgr, U.owner1, U.owner2, U.otherOwner, PM, U.minLead],
  );
  await q(
    `INSERT INTO project_client_roles (project_id, org_id, role, user_id) VALUES ($1,$2,'coordinator',$3), ($1,$2,'sponsor',$4)`,
    [P, ACME, U.coord, U.sponsor],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$4,$5,'Keep a contracts register','shared',$10), ($2,$6,$7,'Adopt a charter','shared',$10), ($3,$8,$9,'Write a family charter','shared',$11)`,
    [REC.p, REC.o, REC.m, P, ACME, PO, OTHER, PM, MIN, U.lead, U.minLead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, owner_name, status, due_date, created_by) VALUES
      ($1,$7,$8,$9,'Open one',$12,NULL,'in_progress',app_firm_today() + 30,$15),
      ($2,$7,$8,$9,'Awaiting one',$12,NULL,'awaiting_review',app_firm_today() + 30,$15),
      ($3,$7,$8,$9,'Verified one',$12,NULL,'verified_complete',app_firm_today() + 30,$15),
      ($4,$7,$8,$9,'Draft one',$12,NULL,'draft',app_firm_today() + 30,$15),
      ($5,$10,$16,$11,'Other client one',$13,NULL,'in_progress',app_firm_today() + 30,$15),
      ($6,$17,$18,$19,'Family one',NULL,'finance manager','in_progress',app_firm_today() + 30,$14)`,
    [A.open, A.awaiting, A.verified, A.draft, A.other, A.min, P, ACME, REC.p, PO, REC.o, U.owner1, U.otherOwner, U.minLead, U.lead, OTHER, PM, MIN, REC.m],
  );
});

beforeEach(async () => {
  await q(`UPDATE actions SET owner_user_id = $2, owner_name = NULL WHERE project_id = $1`, [P, U.owner1]);
  await q(`UPDATE actions SET owner_name = 'finance manager' WHERE id = $1`, [A.min]);
  await q(`DELETE FROM notifications`);
  await truncateAuditLog(owner);
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe("D1: who may give one action to a colleague", () => {
  it.each([
    ["the client admin", U.cadmin],
    ["the project's coordinator", U.coord],
    ["the project's sponsor", U.sponsor],
    ["a consultant staffed on the project", U.staff],
    ["the client's lead", U.lead],
    ["the client's deputy, who sees its projects as the lead does", U.deputy],
    ["the firm admin", U.fadmin],
  ])("%s may, and the status does not change", async (_who, uid) => {
    await svc(uid, (tx, p) => changeActionOwner(tx, p, A.open, { ownerUserId: U.owner2 }), true);
    expect(await ownerOf(A.open)).toEqual({ owner_user_id: U.owner2, owner_name: null, status: "in_progress" });
  });

  it.each([
    ["a client manager with no role on the project", U.mgr],
    ["the action's own owner", U.owner1],
    ["another action owner", U.owner2],
    ["an observer", U.observer],
    ["a consultant not on the project", U.stranger],
  ])("%s may not", async (_who, uid) => {
    await expect(svc(uid, (tx, p) => changeActionOwner(tx, p, A.open, { ownerUserId: U.owner2 }))).rejects.toThrow(NOT_FOUND);
    expect((await ownerOf(A.open)).owner_user_id).toBe(U.owner1);
  });

  it("the database refuses a plain manager too, not only the service", async () => {
    await expect(as(U.mgr, (c) => c.query(`UPDATE actions SET owner_user_id = $2 WHERE id = $1`, [A.open, U.owner2]))).rejects.toThrow(/only move/);
    // The coordinator may, straight in the database.
    await as(U.coord, (c) => c.query(`UPDATE actions SET owner_user_id = $2 WHERE id = $1`, [A.open, U.owner2]));
  });

  it("the client side never changes the status in the same step", async () => {
    await expect(
      as(U.cadmin, (c) => c.query(`UPDATE actions SET owner_user_id = $2, status = 'blocked', blocked_reason = 'x' WHERE id = $1`, [A.open, U.owner2])),
    ).rejects.toThrow(/only move/);
  });

  it("only within the action's own organisation, and only to someone on the project", async () => {
    for (const to of [U.otherOwner, U.offProject, U.lead]) {
      await expect(svc(U.cadmin, (tx, p) => changeActionOwner(tx, p, A.open, { ownerUserId: to })), to).rejects.toThrow(/project team|on the project/);
    }
    // The other client's action is out of reach altogether.
    await expect(svc(U.cadmin, (tx, p) => changeActionOwner(tx, p, A.other, { ownerUserId: U.owner2 }))).rejects.toThrow(NOT_FOUND);
  });

  it("only an open action: not a verified or closed one; a draft only by the firm", async () => {
    await expect(svc(U.cadmin, (tx, p) => changeActionOwner(tx, p, A.verified, { ownerUserId: U.owner2 }))).rejects.toThrow();
    await expect(svc(U.staff, (tx, p) => changeActionOwner(tx, p, A.verified, { ownerUserId: U.owner2 }))).rejects.toThrow();
    await expect(as(U.cadmin, (c) => c.query(`UPDATE actions SET owner_user_id = $2 WHERE id = $1`, [A.verified, U.owner2]))).rejects.toThrow(/only move/);
    await expect(svc(U.cadmin, (tx, p) => changeActionOwner(tx, p, A.draft, { ownerUserId: U.owner2 }))).rejects.toThrow(NOT_FOUND);
    await svc(U.staff, (tx, p) => changeActionOwner(tx, p, A.draft, { ownerUserId: U.owner2 }), true);
    expect(await ownerOf(A.draft)).toMatchObject({ owner_user_id: U.owner2, status: "draft" });
  });

  it("an action waiting for review keeps waiting", async () => {
    await svc(U.coord, (tx, p) => changeActionOwner(tx, p, A.awaiting, { ownerUserId: U.owner2 }), true);
    expect(await ownerOf(A.awaiting)).toEqual({ owner_user_id: U.owner2, owner_name: null, status: "awaiting_review" });
  });
});

describe("D1: who is told", () => {
  it("the new owner on the action; the old owner on the project, never on the action; the lead, deputy and staffed consultants", async () => {
    await svc(U.cadmin, (tx, p) => changeActionOwner(tx, p, A.open, { ownerUserId: U.owner2 }), true);
    const told = await notices(A.open);
    expect(told).toEqual(
      [
        { user_id: U.owner2, kind: "action.assigned", entity_type: "action" },
        { user_id: U.lead, kind: "action.owner_changed", entity_type: "action" },
        { user_id: U.deputy, kind: "action.owner_changed", entity_type: "action" },
        { user_id: U.staff, kind: "action.owner_changed", entity_type: "action" },
        { user_id: U.owner1, kind: "action.owner_moved", entity_type: "project" },
      ].sort((a, b) => a.kind.localeCompare(b.kind) || a.user_id.localeCompare(b.user_id)),
    );
    // Not the observer, not the person who made the change, not the client's other people.
    expect(told.map((t) => t.user_id)).not.toContain(U.observer);
    expect(told.map((t) => t.user_id)).not.toContain(U.cadmin);
    expect(told.map((t) => t.user_id)).not.toContain(U.mgr);
  });

  it("the old owner reads their notice, and it names the project, not the action", async () => {
    await svc(U.coord, (tx, p) => changeActionOwner(tx, p, A.open, { ownerUserId: U.owner2 }), true);
    const mine = await svc(U.owner1, (tx, p) => listNotifications(tx, p));
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ kind: "action.owner_moved", entityType: "project", title: "Acme governance", href: `/projects/${P}` });
    expect(JSON.stringify(mine)).not.toContain("Open one");
  });

  it("a draft changing hands tells no one at the client", async () => {
    await svc(U.staff, (tx, p) => changeActionOwner(tx, p, A.draft, { ownerUserId: U.owner2 }), true);
    const told = (await notices(A.draft)).map((t) => t.user_id);
    for (const u of [U.owner1, U.owner2, U.cadmin]) expect(told).not.toContain(u);
  });

  it("the notices cannot be sent by someone who may not reassign", async () => {
    await expect(as(U.mgr, (c) => c.query(`SELECT app_tell_owner_changed($1, $2)`, [A.open, U.owner1]))).rejects.toThrow(/insufficient|not allowed|privilege/i);
  });
});

describe("D1: the record", () => {
  it("writes one audit row with ids, and one history line", async () => {
    const since = (await q(`SELECT clock_timestamp() AS t`)).rows[0].t;
    await svc(U.sponsor, (tx, p) => changeActionOwner(tx, p, A.open, { ownerUserId: U.owner2 }), true);
    const { rows } = await q(`SELECT actor_id, action, resource_id, meta FROM audit_log WHERE action = 'action.owner_change'`);
    expect(rows).toEqual([{ actor_id: U.sponsor, action: "action.owner_change", resource_id: A.open, meta: { from: U.owner1, to: U.owner2 } }]);
    const { rows: ev } = await q(`SELECT event, actor_id, meta FROM activity_events WHERE entity_id = $1 AND created_at >= $2`, [A.open, since]);
    expect(ev).toEqual([{ event: "owner_changed", actor_id: U.sponsor, meta: { from: U.owner1, to: U.owner2 } }]);
  });

  it("the firm's edit dialog changing the owner goes through the same rule, notices and record", async () => {
    await svc(U.lead, (tx, p) => updateAction(tx, p, A.open, { ownerUserId: U.owner2 }), true);
    expect((await notices(A.open)).map((t) => t.kind)).toContain("action.owner_moved");
    expect((await q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'action.owner_change'`)).rows[0].n).toBe(1);
  });

  // Review S1 (the coordinator's decision): everyone who may open the action reads its owner changes,
  // through a reader for this action only; the activity record's own rules are not widened.
  it("everyone who may open the action reads who gave it to whom, and the new owner reads it was given to them", async () => {
    await svc(U.coord, (tx, p) => changeActionOwner(tx, p, A.open, { ownerUserId: U.owner2 }), true);
    for (const reader of [U.owner2, U.coord, U.mgr, U.sponsor, U.cadmin, U.staff]) {
      const detail = await svc(reader, (tx, p) => getActionDetail(tx, p, A.open));
      // The newest first; the activity record is append-only, so earlier tests in this file left theirs.
      expect(detail.timeline.find((e) => e.kind === "owner"), reader).toMatchObject({ kind: "owner", who: "coord", to: "owner2", toUserId: U.owner2 });
    }
    // The former owner no longer opens the action at all.
    await expect(svc(U.owner1, (tx, p) => getActionDetail(tx, p, A.open))).rejects.toThrow(NOT_FOUND);
    // The activity record itself is not widened: an owner still reads none of it.
    expect(await as(U.owner2, async (c) => (await c.query(`SELECT count(*)::int AS n FROM activity_events WHERE entity_id = $1`, [A.open])).rows[0].n)).toBe(0);
    // The reader answers nothing for an action the caller cannot open.
    expect(await as(U.owner1, async (c) => (await c.query(`SELECT count(*)::int AS n FROM app_action_owner_changes($1)`, [A.open])).rows[0].n)).toBe(0);
  });

  it("giving it to the person who already owns it is refused", async () => {
    await expect(svc(U.cadmin, (tx, p) => changeActionOwner(tx, p, A.open, { ownerUserId: U.owner1 }))).rejects.toThrow(/already/);
  });
});

describe("D1 on a minimal-records client: the owner is a typed name", () => {
  it("the firm types a job title; an account is refused; the audit row keeps no name", async () => {
    await svc(U.minLead, (tx, p) => changeActionOwner(tx, p, A.min, { ownerName: "head of operations" }), true);
    expect(await ownerOf(A.min)).toEqual({ owner_user_id: null, owner_name: "head of operations", status: "in_progress" });
    const { rows } = await q(`SELECT meta FROM audit_log WHERE action = 'action.owner_change'`);
    expect(rows).toEqual([{ meta: { from: "typed", to: "typed" } }]);
    expect(JSON.stringify(rows)).not.toContain("head of operations");
    await expect(svc(U.minLead, (tx, p) => changeActionOwner(tx, p, A.min, { ownerUserId: U.minLead }))).rejects.toThrow();
  });

  it("the control offers a typed name there, and people elsewhere", async () => {
    expect(await svc(U.minLead, (tx, p) => ownerControl(tx, p, A.min))).toMatchObject({ mode: "typed" });
    const control = await svc(U.coord, (tx, p) => ownerControl(tx, p, A.open));
    expect(control).toMatchObject({ mode: "person" });
    // Colleagues on the project, of the action's own organisation, never the current owner or the firm.
    expect(control!.people.map((x) => x.id).sort()).toEqual([U.coord, U.mgr, U.owner2, U.sponsor].sort());
    expect(await svc(U.mgr, (tx, p) => ownerControl(tx, p, A.open))).toBeNull();
    expect(await svc(U.owner1, (tx, p) => ownerControl(tx, p, A.open))).toBeNull();
    expect(await svc(U.cadmin, (tx, p) => ownerControl(tx, p, A.verified))).toBeNull();
  });

  it("a typed name is refused for a client with accounts, and from the client side", async () => {
    await expect(svc(U.lead, (tx, p) => changeActionOwner(tx, p, A.open, { ownerName: "someone" }))).rejects.toThrow(/firm manages/);
    await expect(svc(U.cadmin, (tx, p) => changeActionOwner(tx, p, A.open, { ownerName: "someone" }))).rejects.toThrow();
  });
});

// Review S2: a sent-back action whose revised file was saved without sending is sent for review in
// one step, through "in progress", as sending a file does; with nothing new sent, it is refused and
// stays where it was.
describe("sent back, then sent for review without a new file", () => {
  async function sentBack(withNewFile: boolean) {
    const aid = id(200 + (withNewFile ? 1 : 2));
    await q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Sent back one',$5,'revision_requested',app_firm_today() + 30,$6) ON CONFLICT (id) DO NOTHING`,
      [aid, P, ACME, REC.p, U.owner1, U.lead],
    );
    await q(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome, reason, created_at) VALUES ($1,$2,$3,$4,'revise','More',now() - interval '1 day')`, [P, ACME, aid, U.staff]);
    if (withNewFile) {
      const doc = id(210);
      await q(
        `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, title, storage_key, content_type, size_bytes, sha256, visibility, state, scan_status)
         VALUES ($1,$2,$3,$3,$4,'evidence','Revised.pdf','k-revised','application/pdf',1,'s','shared','submitted','clean') ON CONFLICT (id) DO NOTHING`,
        [doc, P, ACME, U.owner1],
      );
      await q(`INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [P, ACME, aid, doc, U.owner1]);
    }
    return aid;
  }

  it("with the revised file saved: sent for review in one step", async () => {
    const aid = await sentBack(true);
    await svc(U.owner1, (tx, p) => transitionAction(tx, p, aid, { to: "awaiting_review" }), true);
    expect((await ownerOf(aid)).status).toBe("awaiting_review");
  });

  it("with nothing new: refused, and the action stays sent back", async () => {
    const aid = await sentBack(false);
    await expect(svc(U.owner1, (tx, p) => transitionAction(tx, p, aid, { to: "awaiting_review" }), true)).rejects.toThrow(/submit evidence/);
    expect((await ownerOf(aid)).status).toBe("revision_requested");
  });
});

// October review, item 12: may accepting the last evidence item and verifying be one step?
// Yes, for the reviewer who may verify alone; never with two sign-offs or with an item still unsent.
describe("October item 12: verify accepts the files still to check", () => {
  let n = 100;
  async function waiting(items: ("open" | "submitted")[]) {
    const aid = id(++n);
    await q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Waiting one',$5,'awaiting_review',app_firm_today() + 30,$6)`,
      [aid, P, ACME, REC.p, U.owner1, U.lead],
    );
    for (const s of items) {
      const { rows } = await q(`INSERT INTO evidence_requests (project_id, org_id, action_id, title, created_by) VALUES ($1,$2,$3,'Item',$4) RETURNING id`, [P, ACME, aid, U.lead]);
      if (s === "submitted") await q(`UPDATE evidence_requests SET status = 'submitted' WHERE id = $1`, [rows[0].id]);
    }
    return aid;
  }
  const items = async (aid: string) => (await q(`SELECT status::text FROM evidence_requests WHERE action_id = $1`, [aid])).rows.map((r) => r.status);

  it("one step: the item is accepted and the action verified, by the same reviewer", async () => {
    const aid = await waiting(["submitted"]);
    await svc(U.staff, (tx, p) => transitionAction(tx, p, aid, { to: "verified_complete", acceptItems: true }), true);
    expect((await ownerOf(aid)).status).toBe("verified_complete");
    expect(await items(aid)).toEqual(["accepted"]);
    const { rows } = await q(`SELECT decided_by FROM evidence_requests WHERE action_id = $1`, [aid]);
    expect(rows[0].decided_by).toBe(U.staff);
  });

  it("without it, verifying still waits for the items, as before", async () => {
    const aid = await waiting(["submitted"]);
    await expect(svc(U.staff, (tx, p) => transitionAction(tx, p, aid, { to: "verified_complete" }))).rejects.toThrow(/every evidence request/);
  });

  it("not while an item has nothing sent", async () => {
    const aid = await waiting(["submitted", "open"]);
    await expect(svc(U.staff, (tx, p) => transitionAction(tx, p, aid, { to: "verified_complete", acceptItems: true }))).rejects.toThrow(
      /every evidence request/,
    );
    expect((await items(aid)).sort()).toEqual(["open", "submitted"]);
  });

  it("not by someone who may not verify: the owner's side", async () => {
    const aid = await waiting(["submitted"]);
    await expect(svc(U.coord, (tx, p) => transitionAction(tx, p, aid, { to: "verified_complete", acceptItems: true }))).rejects.toThrow(NOT_FOUND);
    expect(await items(aid)).toEqual(["submitted"]);
  });
});
