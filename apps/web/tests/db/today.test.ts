// The firm's "Today" page against a real Postgres: each person sees only
// work from the clients and projects they are staffed on, nobody is asked to
// review their own work, the decisions go to whoever may take them, and
// client users get no page at all.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPrincipal } from "@/services/principal";
import { today, type Today } from "@/services/today";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a3d0-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const OTHER = id(3);
const U = {
  admin: id(11),
  lead: id(12), // leads Acme: every Acme project; also on the internal project
  cons: id(13), // on Acme's team, staffed on Acme's first project; owns an internal action
  stranger: id(14), // a consultant not on Acme's team, staffed on the other client
  cadmin: id(15), // Acme's admin
  doer: id(16), // Acme action owner
};
const P = { one: id(21), two: id(22), other: id(23), internal: id(24) };
const A = {
  review: id(31), // Acme, awaiting review
  overdue: id(32), // Acme, overdue
  soon: id(33), // Acme phase 2, due in three days
  later: id(34), // Acme, due next month
  ownInternal: id(35), // internal, owned by cons, awaiting review
  otherReview: id(36), // the other client, awaiting review
};
const TODAY = "2026-10-20";
let n = 100;
const next = () => id(++n);

async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>): Promise<R> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return await fn(tx, (await loadPrincipal(tx, userId))!);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
const page = (userId: string) => svc(userId, (tx, p) => today(tx, p, TODAY));

/** Every project any row on the page points at. */
const projectsOn = (t: Today) =>
  new Set([...t.reviews, ...t.due, ...t.followUps, ...t.meetings, ...t.visits].map((r) => r.projectId).concat(t.decisions.flatMap((d) => (d.projectId ? [d.projectId] : []))));
const groupsOn = (t: Today) => new Set([...t.reviews, ...t.due, ...t.followUps, ...t.meetings, ...t.decisions, ...t.visits].map((r) => r.group.id));

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Other')`, [FIRM, ACME, OTHER]);
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$7,'consultant'), ($4,$7,'consultant'), ($5,$8,'client_admin'), ($6,$8,'action_owner')`,
    [U.admin, U.lead, U.cons, U.stranger, U.cadmin, U.doer, FIRM, ACME],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($4,$5,true)`, [
    ACME,
    U.lead,
    U.cons,
    OTHER,
    U.stranger,
  ]);
  for (const [pid, kind, org, title] of [
    [P.one, "client", ACME, "Acme phase 1"],
    [P.two, "client", ACME, "Acme phase 2"],
    [P.other, "client", OTHER, "Other"],
    [P.internal, "internal", FIRM, "Method refresh"],
  ] as const) {
    await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,$2,$3,$4,$5,'active',$6)`, [
      pid,
      kind,
      org,
      FIRM,
      title,
      U.admin,
    ]);
    await q(`INSERT INTO recommendations (project_id, org_id, title, created_by) VALUES ($1,$2,'Charter',$3)`, [pid, org, U.lead]);
  }
  await q(
    `INSERT INTO project_members (project_id, user_id, is_lead) VALUES
      ($1,$5,false), ($1,$6,false), ($1,$7,false), ($1,$8,false), ($2,$7,false), ($2,$8,false), ($3,$9,false), ($4,$5,false), ($4,$6,true)`,
    [P.one, P.two, P.other, P.internal, U.cons, U.lead, U.cadmin, U.doer, U.stranger],
  );

  const action = async (aid: string, project: string, org: string, status: string, ownerId: string | null, due: string | null) => {
    const rec = (await q(`SELECT id FROM recommendations WHERE project_id = $1`, [project])).rows[0].id;
    await q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [aid, project, org, rec, `Action ${aid.slice(-2)}`, ownerId, status, due, U.lead],
    );
  };
  await action(A.review, P.one, ACME, "awaiting_review", U.doer, null);
  await action(A.overdue, P.one, ACME, "in_progress", U.doer, "2026-10-10");
  await action(A.soon, P.two, ACME, "assigned", U.doer, "2026-10-23");
  await action(A.later, P.one, ACME, "in_progress", U.doer, "2026-11-30");
  await action(A.ownInternal, P.internal, FIRM, "awaiting_review", U.cons, null);
  await action(A.otherReview, P.other, OTHER, "awaiting_review", null, null);

  // A follow-up for cons, overdue; a meeting this week with cons attending.
  await q(`INSERT INTO follow_ups (project_id, org_id, title, due_at, assignee_user_id, created_by) VALUES ($1,$2,'Send the minutes','2026-10-19T09:00:00Z',$3,$4)`, [
    P.one,
    ACME,
    U.cons,
    U.lead,
  ]);
  const meeting = next();
  await q(
    `INSERT INTO meetings (id, project_id, org_id, kind, title, starts_at, ends_at, location, organizer_id, ics_uid)
     VALUES ($1,$2,$3,'status','Weekly status','2026-10-21T07:00:00Z','2026-10-21T08:00:00Z','in_person',$4,$5)`,
    [meeting, P.one, ACME, U.lead, meeting],
  );
  await q(`INSERT INTO meeting_attendees (meeting_id, user_id) VALUES ($1,$2)`, [meeting, U.cons]);
  // A meeting next month is not this week.
  const far = next();
  await q(
    `INSERT INTO meetings (id, project_id, org_id, kind, title, starts_at, ends_at, location, organizer_id, ics_uid)
     VALUES ($1,$2,$3,'status','Steering','2026-11-21T07:00:00Z','2026-11-21T08:00:00Z','in_person',$4,$5)`,
    [far, P.one, ACME, U.lead, far],
  );

  // Decisions: a join request to Acme, a deadline change, a closure request, an answered request-list item.
  await q(`INSERT INTO join_requests (client_org_id, user_id, reason) VALUES ($1,$2,'I know the sector')`, [ACME, U.stranger]);
  await q(
    `INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason) VALUES ($1,$2,$3,$4,'2026-12-01','Board')`,
    [P.one, ACME, A.overdue, U.doer],
  );
  await q(`INSERT INTO project_closure_requests (project_id, org_id, requested_by, note) VALUES ($1,$2,$3,'We are done')`, [P.two, ACME, U.cadmin]);
  // The client's file marks the item received (check_info_request).
  const item = next();
  const doc = next();
  await q(`INSERT INTO info_requests (id, project_id, org_id, area, title, created_by) VALUES ($1,$2,$3,'legal','Commercial register',$4)`, [
    item,
    P.one,
    ACME,
    U.lead,
  ]);
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$3,$4,'client_document','submitted','cr.pdf','shared','k-cr','application/pdf',1,'x','clean')`,
    [doc, P.one, ACME, U.cadmin],
  );
  await q(`INSERT INTO info_request_files (request_id, document_id, attached_by) VALUES ($1,$2,$3)`, [item, doc, U.cadmin]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the Today page", () => {
  it("shows a consultant only the clients and projects they are staffed on", async () => {
    const t = await page(U.cons);
    expect([...projectsOn(t)].every((p) => p === P.one || p === P.internal)).toBe(true);
    expect(t.reviews.map((r) => r.id)).toEqual([A.review]);
    expect(t.followUps.map((f) => [f.title, f.overdue, f.href])).toEqual([["Send the minutes", true, `/projects/${P.one}`]]);
    expect(t.meetings.map((m) => [m.title, m.organizer, m.href])).toEqual([["Weekly status", false, expect.stringMatching(/^\/meetings\//)]]);
    // Not Acme's lead: no due-date list for the client, no join or deadline decisions.
    expect(t.due).toEqual([]);
    expect(t.decisions.map((d) => d.kind)).toEqual(["info_request"]);
    expect(t.decisions[0]?.href).toBe(`/projects/${P.one}?tab=requests`);
  });

  it("gives an unassigned consultant nothing from that client", async () => {
    const t = await page(U.stranger);
    expect(groupsOn(t).has(ACME)).toBe(false);
    expect(t.reviews.map((r) => r.id)).toEqual([A.otherReview]);
  });

  it("never asks the owner to review their own internal action; a colleague on the project gets it", async () => {
    expect((await page(U.cons)).reviews.map((r) => r.id)).not.toContain(A.ownInternal);
    const lead = await page(U.lead);
    expect(new Set(lead.reviews.map((r) => r.id))).toEqual(new Set([A.review, A.ownInternal]));
    expect(lead.reviews.find((r) => r.id === A.ownInternal)?.group).toMatchObject({ id: FIRM, internal: true });
  });

  it("gives the client's lead what falls due across its projects and the decisions to take", async () => {
    const t = await page(U.lead);
    // Overdue first, then due within the week; next month's waits.
    expect(t.due.map((d) => [d.id, d.overdue])).toEqual([
      [A.overdue, true],
      [A.soon, false],
    ]);
    expect(new Set(t.decisions.map((d) => d.kind))).toEqual(new Set(["join_request", "deadline_request", "info_request"]));
    expect(t.decisions.find((d) => d.kind === "deadline_request")).toMatchObject({ href: `/actions/${A.overdue}`, proposed: "2026-12-01", who: "doer" });
    // Only the firm admin decides a client's closure request.
    expect(t.decisions.some((d) => d.kind === "closure_request")).toBe(false);
  });

  it("gives the firm admin the admin's decisions, and a watched client's work", async () => {
    const before = await page(U.admin);
    expect(before.reviews).toEqual([]);
    expect(before.due).toEqual([]);
    expect(new Set(before.decisions.map((d) => d.kind))).toEqual(new Set(["join_request", "closure_request"]));
    expect(before.decisions.find((d) => d.kind === "closure_request")?.href).toBe(`/projects/${P.two}?tab=closing`);
    await owner.query(`INSERT INTO watches (user_id, client_org_id) VALUES ($1,$2)`, [U.admin, ACME]);
    try {
      const after = await page(U.admin);
      expect(after.reviews.map((r) => r.id)).toEqual([A.review]);
      expect(after.due.map((d) => d.id)).toEqual([A.overdue, A.soon]);
      expect(groupsOn(after).has(OTHER)).toBe(false);
    } finally {
      await owner.query(`DELETE FROM watches WHERE user_id = $1`, [U.admin]);
    }
  });

  it("counts what moved since the last visit, per project", async () => {
    const first = await page(U.cons);
    expect(first.visits.find((v) => v.projectId === P.one)).toMatchObject({ firstVisit: true });
    await owner.query(`INSERT INTO project_visits (user_id, project_id, last_seen_at) VALUES ($1,$2, now())`, [U.cons, P.one]);
    try {
      expect((await page(U.cons)).visits.some((v) => v.projectId === P.one)).toBe(false);
    } finally {
      await owner.query(`DELETE FROM project_visits WHERE user_id = $1`, [U.cons]);
    }
  });

  it("refuses client users", async () => {
    for (const who of [U.cadmin, U.doer]) await expect(page(who), who).rejects.toThrow();
  });
});
