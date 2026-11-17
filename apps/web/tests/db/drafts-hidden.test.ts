// Decision D6 (product owner, 17 Nov 2026): a client never sees a draft action
// until the firm releases it. A rule of the database (one restrictive policy on
// actions and on every table under an action, migration 0076_drafts_hidden),
// mirrored in authorize(), and every definer function that reads actions.
// Firm roles keep seeing drafts. Every test here that concerns a client failed
// before the migration and the service changes; the firm cases guard what must
// not change.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { readXlsx } from "@/lib/office/xlsx-read";

// The exports translate on the server; outside a request, the real messages through next-intl's own translator.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = { ar: (await import("../../messages/ar.json")).default, en: (await import("../../messages/en.json")).default };
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ar" | "en"; namespace?: string }) =>
      createTranslator({ locale, messages: messages[locale], namespace: namespace as never }),
  };
});
import { getAction, transitionAction } from "@/services/actions";
import { handOver, personHoldings, setActive } from "@/services/accounts";
import { getClosure } from "@/services/closure";
import { actionPeople, actionThread, postComment } from "@/services/comments";
import { actionsWorkbook, planWorkbook } from "@/services/exports";
import { listFiles } from "@/services/files";
import {
  actionClosure,
  actionFollowThrough,
  actionLadder,
  listEvidenceRequests,
  listRiskAcceptances,
  requestDeadlineChange,
  signRiskAcceptance,
} from "@/services/follow-through";
import { isActionMuted, listNotifications, setActionMuted } from "@/services/notifications";
import { updateAction } from "@/services/plan";
import { loadPrincipal } from "@/services/principal";
import { addProgressUpdate } from "@/services/progress";
import { actionSecondReview } from "@/services/second-review";
import { translate } from "@/services/translations";
import { actionCounts, dashboard, getActionDetail, getProject, listActions, listProjects } from "@/services/queries";
import { getRecommendation } from "@/services/responses";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-d6d6-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const P = id(3);
const REC = id(4);
const DOC = id(5);
const DEPT = id(6); // a department the owner is not in
const REC2 = id(7); // a recommendation filed under it
const U = {
  admin: id(11), // firm admin
  lead: id(12), // Acme's lead consultant
  cons: id(13), // staffed on the project
  cadmin: id(14), // Acme's admin: named owner of a draft, like the walkthrough's
  mgr: id(15), // client manager on the project
  owner: id(16), // action owner: owns a released action and is named on a draft
  owner2: id(17), // action owner: receives the work released or handed over
  leaver: id(18), // action owner who leaves: owns a released action and a draft
};
const A = {
  open: id(21), // released, the owner's
  mgrs: id(22), // released, the manager's
  draft: id(23), // the firm's draft naming the owner, with something under it in every table
  adminDraft: id(24), // the firm's draft naming the client admin
  toRelease: id(25), // a draft the tests release
  leaverOpen: id(26),
  leaverDraft: id(27),
  deptDraft: id(28), // a draft under the department's recommendation, naming the owner
};
const CLIENT_ROLES = { cadmin: U.cadmin, mgr: U.mgr, owner: U.owner } as const;
const FIRM_ROLES = { admin: U.admin, lead: U.lead, cons: U.cons } as const;
const DRAFTS = ["Draft canary", "Admin draft canary", "Release canary", "Leaver draft canary", "Department draft canary"];
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const vector = `[${Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;

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
const rowsAs = async (userId: string, sql: string, params: unknown[] = []) => (await as(userId, (c) => c.query(sql, params))).rows;
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
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

// Every table that hangs off an action, with the column that names the action.
const UNDER = [
  "progress_updates",
  "evidence_submissions",
  "evidence_requests",
  "reviews",
  "review_signoffs",
  "risk_acceptances",
  "deadline_change_requests",
  "action_notes",
  "action_comments",
  "action_due_changes",
  "follow_ups",
  "mail_mutes",
] as const;

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE content_translations`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$9,'firm_admin'), ($2,$9,'consultant'), ($3,$9,'consultant'),
      ($4,$10,'client_admin'), ($5,$10,'client_manager'), ($6,$10,'action_owner'), ($7,$10,'action_owner'), ($8,$10,'action_owner')`,
    [U.admin, U.lead, U.cons, U.cadmin, U.mgr, U.owner, U.owner2, U.leaver, FIRM, ACME],
  );
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`, [
    P,
    ACME,
    FIRM,
    U.admin,
  ]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false)`, [ACME, U.lead, U.cons]);
  await q(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($1,$5), ($1,$6), ($1,$7)`,
    [P, U.cons, U.mgr, U.owner, U.owner2, U.leaver, U.cadmin],
  );
  await q(`INSERT INTO client_ai_settings (client_org_id, enabled, roles) VALUES ($1, true, '{client_admin,client_manager}')`, [ACME]);
  await q(`INSERT INTO client_ai_consents (client_org_id, version, locale, given_by) VALUES ($1, app_client_ai_version(), 'en', $2)`, [ACME, U.cadmin]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$2,$3,'Form the audit committee','shared',$4)`, [
    REC,
    P,
    ACME,
    U.lead,
  ]);
  // A notification about the draft, written before the rule existed (so before the action, which no trigger then sees).
  await q(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'action.commented','action',$2)`, [U.owner, A.draft]);
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, description, owner_user_id, status, due_date, created_by) VALUES
      ($1,$8,$9,$10,'Open canary',NULL,$11,'in_progress',app_firm_today() + 30,$14),
      ($2,$8,$9,$10,'Manager canary',NULL,$12,'assigned',app_firm_today() + 30,$14),
      ($3,$8,$9,$10,'Draft canary','Draft description canary',$11,'draft',app_firm_today() + 20,$14),
      ($4,$8,$9,$10,'Admin draft canary',NULL,$13,'draft',app_firm_today() + 25,$14),
      ($5,$8,$9,$10,'Release canary',NULL,$15,'draft',app_firm_today() + 25,$14),
      ($6,$8,$9,$10,'Leaver canary',NULL,$16,'assigned',app_firm_today() + 30,$14),
      ($7,$8,$9,$10,'Leaver draft canary',NULL,$16,'draft',app_firm_today() + 30,$14)`,
    [A.open, A.mgrs, A.draft, A.adminDraft, A.toRelease, A.leaverOpen, A.leaverDraft, P, ACME, REC, U.owner, U.mgr, U.cadmin, U.lead, U.owner2, U.leaver],
  );
  // Departments on; a recommendation filed under one nobody but the admin and the firm opens, with a draft naming the owner.
  await q(`UPDATE organizations SET departments_enabled = true WHERE id = $1`, [ACME]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'المالية','Finance')`, [DEPT, ACME]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, department_id, created_by) VALUES ($1,$2,$3,'Finance recommendation canary','shared',$4,$5)`,
    [REC2, P, ACME, DEPT, U.lead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Department draft canary',$5,'draft',app_firm_today() + 30,$6)`,
    [A.deptDraft, P, ACME, REC2, U.owner, U.lead],
  );
  // Something under the draft in every table (unrealistic together, but each one is a road to it).
  const at = [P, ACME, A.draft];
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, title, storage_key, content_type, size_bytes, sha256, visibility, state)
     VALUES ($1,$2,$3,$4,$5,'evidence','Evidence canary','k-1','text/plain',1,'s-1','shared','submitted')`,
    [DOC, P, ACME, ACME, U.owner],
  );
  await q(`INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'Progress canary')`, [...at, U.owner]);
  await q(`INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [...at, DOC, U.owner]);
  await q(`INSERT INTO evidence_requests (project_id, org_id, action_id, title, created_by) VALUES ($1,$2,$3,'Evidence item canary',$4)`, [...at, U.lead]);
  await q(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome, reason) VALUES ($1,$2,$3,$4,'revise','Review canary')`, [...at, U.lead]);
  await q(`INSERT INTO review_signoffs (project_id, org_id, action_id, reviewer_id) VALUES ($1,$2,$3,$4)`, [...at, U.cons]);
  await q(`INSERT INTO risk_acceptances (project_id, org_id, action_id, accepted_by, statement) VALUES ($1,$2,$3,$4,'Risk canary')`, [...at, U.cadmin]);
  await q(
    `INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason) VALUES ($1,$2,$3,$4,app_firm_today() + 60,'Deadline canary')`,
    [...at, U.owner],
  );
  await q(`INSERT INTO action_notes (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'Note canary')`, [...at, U.lead]);
  await q(`INSERT INTO action_comments (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'Comment canary')`, [...at, U.lead]);
  await q(`INSERT INTO action_due_changes (project_id, org_id, action_id, from_date, to_date, changed_by) VALUES ($1,$2,$3,app_firm_today() + 10,app_firm_today() + 20,$4)`, [
    ...at,
    U.lead,
  ]);
  await q(
    `INSERT INTO follow_ups (project_id, org_id, action_id, title, visibility, assignee_user_id, due_at, created_by) VALUES ($1,$2,$3,'Follow-up canary','shared',$4, now() + interval '2 days', $5)`,
    [...at, U.owner, U.lead],
  );
  await q(`INSERT INTO mail_mutes (user_id, action_id) VALUES ($1,$2)`, [U.owner, A.draft]);
  await q(`INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, to_state) VALUES ($1,$2,$4,'action',$3,'created','draft')`, [
    ...at,
    U.lead,
  ]);
  await q(
    `INSERT INTO content_translations (project_id, org_id, entity_type, entity_id, field, source_lang, target_lang, source_sha256, text, model, created_by)
     VALUES ($1,$2,'action',$3,'title','en','ar',$4,'ترجمة المسودة','m',$5)`,
    [...at, sha("Draft canary"), U.lead],
  );
  await q(
    `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, lang, content, embedding)
     VALUES ($1,$2,'action',$3,'shared',0,'en','Draft canary passage',$4), ($1,$2,'action',$5,'shared',0,'en','Open canary passage',$4)`,
    [...at, vector, A.open],
  );
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

// ------------------------------------------------------------ the database
describe("the database hides a draft and everything under it from every client role", () => {
  it("each client role reads neither the draft nor any row under it; firm roles read all of them", async () => {
    for (const [role, uid] of Object.entries(CLIENT_ROLES)) {
      expect(await rowsAs(uid, `SELECT id FROM actions WHERE status = 'draft'`), role).toEqual([]);
      expect(titles(await rowsAs(uid, `SELECT title FROM actions`)), role).not.toEqual(expect.arrayContaining(["Draft canary"]));
      for (const t of UNDER) {
        expect(await rowsAs(uid, `SELECT 1 FROM ${t} WHERE action_id = $1`, [A.draft]), `${role} reads ${t}`).toEqual([]);
      }
      for (const t of ["activity_events", "notifications", "content_translations"]) {
        expect(await rowsAs(uid, `SELECT 1 FROM ${t} WHERE entity_id = $1`, [A.draft]), `${role} reads ${t}`).toEqual([]);
      }
      expect(await rowsAs(uid, `SELECT 1 FROM ai_chunks WHERE source_id = $1`, [A.draft]), `${role} reads ai_chunks`).toEqual([]);
    }
    for (const [role, uid] of Object.entries(FIRM_ROLES)) {
      expect(titles(await rowsAs(uid, `SELECT title FROM actions WHERE status = 'draft'`)), role).toEqual([...DRAFTS].sort());
      for (const t of UNDER.filter((x) => x !== "mail_mutes")) {
        expect((await rowsAs(uid, `SELECT 1 FROM ${t} WHERE action_id = $1`, [A.draft])).length, `${role} reads ${t}`).toBe(1);
      }
      expect((await rowsAs(uid, `SELECT 1 FROM activity_events WHERE entity_id = $1`, [A.draft])).length, role).toBe(1);
      expect((await rowsAs(uid, `SELECT 1 FROM content_translations WHERE entity_id = $1`, [A.draft])).length, role).toBe(1);
      expect((await rowsAs(uid, `SELECT 1 FROM ai_chunks WHERE source_id = $1`, [A.draft])).length, role).toBe(1);
    }
  });

  it("the client still reads released work and what is under it", async () => {
    for (const [role, uid] of Object.entries({ cadmin: U.cadmin, mgr: U.mgr })) {
      expect(titles(await rowsAs(uid, `SELECT title FROM actions`)), role).toEqual(["Leaver canary", "Manager canary", "Open canary"]);
      expect((await rowsAs(uid, `SELECT 1 FROM ai_chunks WHERE source_id = $1`, [A.open])).length, role).toBe(1);
    }
  });

  it("a client cannot write under a draft or change it", async () => {
    const refused = (p: Promise<unknown>) =>
      p.then(
        () => "",
        (e: Error) => e.message,
      );
    expect(
      await refused(
        as(U.mgr, (c) => c.query(`INSERT INTO action_comments (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'hi')`, [P, ACME, A.draft, U.mgr])),
      ),
    ).toMatch(/row-level security/);
    const changed = await as(U.cadmin, (c) => c.query(`UPDATE actions SET owner_user_id = $2 WHERE id = $1`, [A.draft, U.owner2]));
    expect(changed.rowCount).toBe(0);
  });

  it("every table under an action carries the draft rule, and so do actions, the activity record, notifications and translations", async () => {
    const { rows } = await owner.query<{ table_name: string }>(
      `SELECT c.relname AS table_name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'action_id' AND NOT a.attisdropped
       WHERE c.relkind = 'r' AND has_table_privilege('selah_app', c.oid, 'SELECT')`,
    );
    expect(rows.length).toBeGreaterThan(10);
    const tables = [...rows.map((r) => r.table_name), "actions", "activity_events", "notifications", "content_translations"];
    const { rows: ruled } = await owner.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE policyname = 'draft' AND permissive = 'RESTRICTIVE' AND 'selah_app' = ANY (roles)`,
    );
    for (const t of tables) expect(ruled.map((r) => r.tablename), t).toContain(t);
  });

  it("the definer functions answer nothing about a draft to a client: reminder ladder, people, due-date moves", async () => {
    for (const [role, uid] of Object.entries(CLIENT_ROLES)) {
      expect(await rowsAs(uid, `SELECT * FROM app_action_ladder($1)`, [A.draft]), role).toEqual([]);
      expect(await rowsAs(uid, `SELECT * FROM app_action_people($1)`, [A.draft]), role).toEqual([]);
      expect((await rowsAs(uid, `SELECT app_action_extensions($1) AS n`, [A.draft]))[0].n, role).toBe(0);
      expect((await rowsAs(uid, `SELECT app_can_see_action($1) AS ok`, [A.draft]))[0].ok, role).toBe(false);
      expect(await rowsAs(uid, `SELECT * FROM app_second_review_state($1)`, [A.draft]), role).toEqual([]);
    }
    expect(await rowsAs(U.lead, `SELECT * FROM app_second_review_state($1)`, [A.draft])).toHaveLength(1);
    expect((await rowsAs(U.lead, `SELECT * FROM app_action_ladder($1)`, [A.draft])).length).toBeGreaterThan(0);
    expect((await rowsAs(U.lead, `SELECT app_action_extensions($1) AS n`, [A.draft]))[0].n).toBe(1);
    // Nobody at the client is offered to the firm as someone who can see the draft.
    const people = await rowsAs(U.lead, `SELECT user_id, side FROM app_action_people($1)`, [A.draft]);
    expect(people.filter((p) => p.side === "client")).toEqual([]);
  });

  it("a draft does not open its recommendation, past the department rule, to the person it names; its release does", async () => {
    const reads = async (uid: string) => (await rowsAs(uid, `SELECT id FROM recommendations WHERE id = $1`, [REC2])).length;
    expect(await reads(U.owner)).toBe(0);
    expect((await rowsAs(U.owner, `SELECT app_owns_action_under($1) AS o`, [REC2]))[0].o).toBe(false);
    expect(await reads(U.mgr)).toBe(0);
    expect(await reads(U.cadmin)).toBe(1);
    expect(await reads(U.lead)).toBe(1);
    // Released, it is his action, and the recommendation it answers opens for him (rolled back after).
    await as(U.lead, async (c) => {
      await c.query(`UPDATE actions SET status = 'assigned' WHERE id = $1`, [A.deptDraft]);
      await c.query(`SELECT set_config('selah.user_id', $1, true)`, [U.owner]);
      expect((await c.query(`SELECT id FROM recommendations WHERE id = $1`, [REC2])).rowCount).toBe(1);
    });
  });
});

// ------------------------------------------------------------ the services
describe("every screen, list and count leaves drafts out for a client", () => {
  it("the action page, its thread, its follow-through, its evidence list and its ladder answer Not found", async () => {
    const calls: [string, (tx: Tx, p: Principal) => Promise<unknown>][] = [
      ["detail", (tx, p) => getActionDetail(tx, p, A.draft)],
      ["action API", (tx, p) => getAction(tx, p, A.draft)],
      ["thread", (tx, p) => actionThread(tx, p, A.draft)],
      ["follow-through", (tx, p) => actionFollowThrough(tx, p, A.draft)],
      ["evidence list", (tx, p) => listEvidenceRequests(tx, p, A.draft)],
      ["ladder", (tx, p) => actionLadder(tx, p, A.draft)],
    ];
    for (const [role, uid] of Object.entries(CLIENT_ROLES)) {
      for (const [what, call] of calls) {
        await expect(svc(uid, call), `${role} ${what}`).rejects.toThrow(/not found/i);
      }
      // The client admin is named as its owner: still Not found.
      await expect(svc(uid, (tx, p) => getActionDetail(tx, p, A.adminDraft)), role).rejects.toThrow(/not found/i);
    }
  });

  it("the firm still opens the draft, with its thread and evidence list", async () => {
    for (const uid of Object.values(FIRM_ROLES)) {
      expect((await svc(uid, (tx, p) => getActionDetail(tx, p, A.draft))).action.title).toBe("Draft canary");
      expect((await svc(uid, (tx, p) => listEvidenceRequests(tx, p, A.draft))).map((i) => i.title)).toEqual(["Evidence item canary"]);
    }
  });

  it("the Actions list, its counts and the home counters count released work only", async () => {
    const list = async (uid: string) => titles(await svc(uid, (tx, p) => listActions(tx, p)));
    expect(await list(U.cadmin)).toEqual(["Leaver canary", "Manager canary", "Open canary"]);
    expect(await list(U.mgr)).toEqual(["Leaver canary", "Manager canary", "Open canary"]);
    expect(await list(U.owner)).toEqual(["Open canary"]);
    for (const uid of Object.values(CLIENT_ROLES)) {
      const counts = await svc(uid, (tx, p) => actionCounts(tx, p));
      expect(counts.filter((c) => c.status === "draft")).toEqual([]);
      const home = await svc(uid, (tx, p) => dashboard(tx, p));
      expect(home.total).toBe(uid === U.owner ? 1 : 3);
    }
    // The firm keeps every draft on its list.
    expect(await list(U.lead)).toEqual([...DRAFTS, "Leaver canary", "Manager canary", "Open canary"].sort());
  });

  it("the Projects card counts released actions for every role, firm included (page audit B2)", async () => {
    const card = async (uid: string) => (await svc(uid, (tx, p) => listProjects(tx, p))).find((x) => x.id === P)!.actionCount;
    for (const uid of [U.admin, U.lead, U.cons, U.cadmin, U.mgr]) expect(await card(uid), uid).toBe(3);
    expect(await card(U.owner)).toBe(1);
  });

  it("the project plan and the recommendation page leave drafts out, and 'N more' does not count them", async () => {
    for (const uid of [U.cadmin, U.mgr]) {
      const plan = await svc(uid, (tx, p) => getProject(tx, p, P));
      expect(titles(plan.recommendations.find((r) => r.id === REC)!.actions)).toEqual(["Leaver canary", "Manager canary", "Open canary"]);
      expect(plan.recommendations.flatMap((r) => r.actions).map((a) => a.title)).not.toContain("Department draft canary");
      const page = await svc(uid, (tx, p) => getRecommendation(tx, p, REC));
      expect(titles(page.actions)).toEqual(["Leaver canary", "Manager canary", "Open canary"]);
      expect(page.actionsLeftOut).toBe(0);
    }
    const mine = await svc(U.owner, (tx, p) => getRecommendation(tx, p, REC));
    expect(titles(mine.actions)).toEqual(["Open canary"]);
    expect(mine.actionsLeftOut).toBe(2); // the manager's and the leaver's; no draft
    const firm = await svc(U.lead, (tx, p) => getRecommendation(tx, p, REC));
    expect(firm.actions).toHaveLength(7);
  });

  it("the Excel exports of the actions and of the plan carry no draft", async () => {
    const actionsFile = (tx: Tx, p: Principal) => actionsWorkbook(tx, p, "en");
    const planFile = (tx: Tx, p: Principal) => planWorkbook(tx, p, P, "en");
    for (const [uid, make] of [
      [U.cadmin, actionsFile],
      [U.mgr, actionsFile],
      [U.owner, actionsFile],
      [U.cadmin, planFile],
      [U.mgr, planFile],
    ] as const) {
      const { bytes } = await svc(uid, make);
      const text = JSON.stringify(readXlsx(bytes)[0]!.rows);
      expect(text, uid).toContain("Open canary");
      for (const d of DRAFTS) expect(text, uid).not.toContain(d);
    }
    const { bytes } = await svc(U.lead, (tx, p) => actionsWorkbook(tx, p, "en"));
    expect(JSON.stringify(readXlsx(bytes)[0]!.rows)).toContain("Draft canary");
  });

  it("notifications about a draft are not shown to the person they were written for, though they are kept", async () => {
    const mine = await svc(U.owner, (tx, p) => listNotifications(tx, p));
    expect(JSON.stringify(mine)).not.toContain(A.draft);
    expect(await rowsAs(U.owner, `SELECT 1 FROM notifications WHERE entity_id = $1`, [A.draft])).toEqual([]);
    // Hidden by the rule, not deleted.
    expect((await owner.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND entity_id = $2`, [U.owner, A.draft])).rowCount).toBe(1);
  });
});

// ------------------------------------------------------------ release
describe("release", () => {
  it("nobody at the client is told about a draft before its release", async () => {
    // A firm comment on the draft: the named owner is not told, and the firm can't mention them.
    await svc(U.lead, (tx, p) => postComment(tx, p, A.toRelease, { body: "Still shaping this one." }), true);
    await expect(svc(U.lead, (tx, p) => postComment(tx, p, A.toRelease, { body: "For you", mentions: [U.owner2] }), true)).rejects.toThrow(
      /mentions only other people who can see the action/,
    );
    expect((await svc(U.lead, (tx) => actionPeople(tx, A.toRelease))).map((x) => x.id)).not.toContain(U.owner2);
    // Whatever writes a notice about a draft for a client person, it is dropped before it is stored or mailed.
    await as(U.lead, (c) => c.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'action.assigned','action',$2)`, [U.owner2, A.toRelease]), true);
    expect((await owner.query(`SELECT 1 FROM notifications WHERE entity_id = $1`, [A.toRelease])).rowCount).toBe(0);
    expect((await owner.query(`SELECT 1 FROM outbound_emails WHERE link = $1`, [`/actions/${A.toRelease}`])).rowCount).toBe(0);
  });

  it("release makes it visible to the client and tells its owner, then and only then", async () => {
    await svc(U.lead, (tx, p) => transitionAction(tx, p, A.toRelease, { to: "assigned" }), true);
    const told = await owner.query(`SELECT user_id, kind FROM notifications WHERE entity_id = $1`, [A.toRelease]);
    expect(told.rows).toEqual([{ user_id: U.owner2, kind: "action.assigned" }]);
    expect((await svc(U.owner2, (tx, p) => getActionDetail(tx, p, A.toRelease))).action.title).toBe("Release canary");
    expect(titles(await svc(U.mgr, (tx, p) => listActions(tx, p)))).toContain("Release canary");
    // Its thread, written while it was a draft, is now the client's to read like any other.
    expect((await svc(U.owner2, (tx, p) => actionThread(tx, p, A.toRelease))).comments.map((c) => c.body)).toEqual(["Still shaping this one."]);
  });
});

// ------------------------------------------------------------ people leaving
describe("the departure report (a client admin switches a person off)", () => {
  const report = async (who: string, person: string) =>
    (await svc(who, (tx, p) => personHoldings(tx, p, person))).items.map((i) => `${i.kind}:${i.title}${i.blocking ? "!" : ""}`).sort();

  it("lists a draft the person owns to the firm only, and never by title to the client admin", async () => {
    expect(await report(U.cadmin, U.leaver)).toEqual(["action:Leaver canary!"]);
    expect(await report(U.admin, U.leaver)).toEqual(["action:Leaver canary!", "action:Leaver draft canary!"]);
  });

  it("the client admin's hand-over moves released work only; the draft stays the firm's to settle", async () => {
    await svc(U.cadmin, (tx, p) => handOver(tx, p, U.leaver, { to: U.owner2, kinds: ["action"] }), true);
    const owners = await owner.query(`SELECT id, owner_user_id FROM actions WHERE id = ANY($1) ORDER BY title`, [[A.leaverOpen, A.leaverDraft]]);
    expect(owners.rows).toEqual([
      { id: A.leaverOpen, owner_user_id: U.owner2 },
      { id: A.leaverDraft, owner_user_id: U.leaver },
    ]);
    expect(await report(U.cadmin, U.leaver)).toEqual([]);
  });

  it("a hidden draft does not block the client admin's switch-off; it still blocks the firm admin's, as before", async () => {
    await expect(svc(U.admin, (tx, p) => setActive(tx, p, U.leaver, { active: false, reason: "left" }), true)).rejects.toThrow(/hand over/);
    expect((await svc(U.cadmin, (tx, p) => setActive(tx, p, U.leaver, { active: false, reason: "left" }), true)).changed).toBe(true);
  });

  it("the firm cannot release work to someone who has left; it is told before the click, and names another owner first", async () => {
    const page = () => svc(U.lead, (tx, p) => getActionDetail(tx, p, A.leaverDraft));
    // The draft page says so before Release is pressed (action-panel shows action.errors.ownerGone).
    expect((await page()).ownerGone).toBe(true);
    expect((await svc(U.lead, (tx, p) => getActionDetail(tx, p, A.draft))).ownerGone).toBe(false);
    await expect(svc(U.lead, (tx, p) => transitionAction(tx, p, A.leaverDraft, { to: "assigned" }), true)).rejects.toThrow(
      /owner must be an active member of the project team/,
    );
    await svc(U.lead, (tx, p) => updateAction(tx, p, A.leaverDraft, { ownerUserId: U.owner2 }), true);
    expect((await page()).ownerGone).toBe(false);
    await svc(U.lead, (tx, p) => transitionAction(tx, p, A.leaverDraft, { to: "assigned" }), true);
    expect((await svc(U.owner2, (tx, p) => getActionDetail(tx, p, A.leaverDraft))).action.title).toBe("Leaver draft canary");
  });
});

// ------------------------------------------------------------ review of the branch (drafts-hidden-review.md)
describe("a deleted draft leaves nothing behind for the client", () => {
  it("its activity and notices stay hidden from client people once the firm deletes it", async () => {
    const gone = id(41);
    // A notice written before the rule existed (before the action, so no trigger sees it), then the draft and its event.
    await owner.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'action.commented','action',$2)`, [U.owner, gone]);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by) VALUES ($1,$2,$3,$4,'Deleted draft canary',$5,'draft',$6)`,
      [gone, P, ACME, REC, U.owner, U.lead],
    );
    await owner.query(
      `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, to_state) VALUES ($1,$2,$3,'action',$4,'created','draft')`,
      [P, ACME, U.lead, gone],
    );
    expect((await as(U.lead, (c) => c.query(`DELETE FROM actions WHERE id = $1`, [gone]), true)).rowCount).toBe(1);
    for (const [role, uid] of Object.entries(CLIENT_ROLES)) {
      expect(await rowsAs(uid, `SELECT event FROM activity_events WHERE entity_id = $1`, [gone]), role).toEqual([]);
      expect(await rowsAs(uid, `SELECT 1 FROM notifications WHERE entity_id = $1`, [gone]), role).toEqual([]);
      expect((await rowsAs(uid, `SELECT app_action_visible_to_client($1) AS v`, [gone]))[0].v, role).toBe(false);
    }
    // The firm keeps its record, and nothing was deleted with the draft.
    expect(await rowsAs(U.lead, `SELECT event FROM activity_events WHERE entity_id = $1`, [gone])).toEqual([{ event: "created" }]);
    expect((await owner.query(`SELECT 1 FROM notifications WHERE entity_id = $1`, [gone])).rowCount).toBe(1);
    // A row that names no action at all keeps its own rules.
    expect((await rowsAs(U.cadmin, `SELECT app_action_visible_to_client(NULL) AS v`))[0].v).toBe(true);
  });
});

describe("releasing a draft whose named owner came off the project team", () => {
  it("is refused, and the draft page says so before the click", async () => {
    const [who, draft] = [id(19), id(42)];
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1,'moved','moved@example.test')`, [who]);
    await owner.query(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'action_owner')`, [who, ACME]);
    await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P, who]);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Moved owner draft canary',$5,'draft',app_firm_today() + 30,$6)`,
      [draft, P, ACME, REC, who, U.lead],
    );
    // Taking someone off the project never waited for drafts.
    await owner.query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [P, who]);
    expect((await svc(U.lead, (tx, p) => getActionDetail(tx, p, draft))).ownerGone).toBe(true);
    await expect(svc(U.lead, (tx, p) => transitionAction(tx, p, draft, { to: "assigned" }), true)).rejects.toThrow(
      /owner must be an active member of the project team/,
    );
  });
});

describe("a client cannot tell a draft from an action that does not exist", () => {
  const nowhere = "00000000-0000-4000-d6d6-0000000009ff";
  // What a call answers: its value, or the words of its refusal.
  const outcome = (p: Promise<unknown>) =>
    p.then(
      (v) => ({ ok: JSON.stringify(v ?? null) }),
      (e: Error) => ({ err: e.message }),
    );
  const services: [string, (tx: Tx, p: Principal, id: string) => Promise<unknown>][] = [
    ["action page", (tx, p, x) => getActionDetail(tx, p, x)],
    ["action API", (tx, p, x) => getAction(tx, p, x)],
    ["thread", (tx, p, x) => actionThread(tx, p, x)],
    ["comment", (tx, p, x) => postComment(tx, p, x, { body: "hello" })],
    ["follow-through", (tx, p, x) => actionFollowThrough(tx, p, x)],
    ["evidence list", (tx, p, x) => listEvidenceRequests(tx, p, x)],
    ["ladder", (tx, p, x) => actionLadder(tx, p, x)],
    ["closure", (tx, p, x) => actionClosure(tx, p, x)],
    ["risk acceptances", (tx, p, x) => listRiskAcceptances(tx, p, x)],
    ["sign a risk acceptance", (tx, p, x) => signRiskAcceptance(tx, p, x, { statement: "We accept the risk of not doing this." })],
    ["ask for a new date", (tx, p, x) => requestDeadlineChange(tx, p, x, { proposedDueDate: "2099-01-01", reason: "busy" })],
    ["progress", (tx, p, x) => addProgressUpdate(tx, p, x, "Done half")],
    ["move", (tx, p, x) => transitionAction(tx, p, x, { to: "in_progress" })],
    ["give to a colleague", (tx, p, x) => updateAction(tx, p, x, { ownerUserId: U.owner2 })],
    ["mute", (tx, p, x) => setActionMuted(tx, p, x, true)],
    ["muted?", (tx, p, x) => isActionMuted(tx, p, x)],
    ["second sign-off", (tx, p, x) => actionSecondReview(tx, p, x)],
    ["translate", (tx, p, x) => translate(tx, p, { entityType: "action", entityId: x, field: "title", to: "ar" })],
    ["files of the action", (tx, p, x) => listFiles(tx, p, { actionId: x })],
  ];
  const functions = [
    `SELECT app_action_visible_to_client($1) AS r`,
    `SELECT app_can_see_action($1) AS r`,
    `SELECT count(*)::int AS r FROM app_action_ladder($1)`,
    `SELECT count(*)::int AS r FROM app_action_people($1)`,
    `SELECT app_action_extensions($1) AS r`,
    `SELECT count(*)::int AS r FROM app_action_refilings($1)`,
    `SELECT count(*)::int AS r FROM app_second_review_state($1)`,
    `SELECT app_can_extend($1) AS r`,
    `SELECT app_submitted_this_round($1) AS r`,
    `SELECT app_verified_basis($1) AS r`,
    `SELECT count(*)::int AS r FROM app_translation_source('action', $1, 'title')`,
  ];

  it("every service a client reaches answers the same, word for word", async () => {
    for (const [role, uid] of Object.entries(CLIENT_ROLES)) {
      for (const [what, call] of services) {
        const draft = await outcome(svc(uid, (tx, p) => call(tx, p, A.draft)));
        const missing = await outcome(svc(uid, (tx, p) => call(tx, p, nowhere)));
        expect(JSON.stringify(draft).replaceAll(A.draft, "<id>"), `${role}: ${what}`).toBe(JSON.stringify(missing).replaceAll(nowhere, "<id>"));
      }
    }
  });

  it("every function the app may call answers the same", async () => {
    for (const [role, uid] of Object.entries(CLIENT_ROLES)) {
      for (const q of functions) {
        const draft = await outcome(rowsAs(uid, q, [A.draft]));
        const missing = await outcome(rowsAs(uid, q, [nowhere]));
        expect(draft, `${role}: ${q}`).toEqual(missing);
      }
    }
  });
});

describe("notices written while an action was a draft", () => {
  it("never bring a client person a summary mail about something they cannot see", async () => {
    // An old notice for the manager about a draft (written before the action, so no trigger saw it), unread and
    // unmailed; the manager takes a daily summary.
    const early = id(46);
    await owner.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'action.commented','action',$2)`, [U.mgr, early]);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, status, created_by) VALUES ($1,$2,$3,$4,'Early notice canary','draft',$5)`,
      [early, P, ACME, REC, U.lead],
    );
    await owner.query(`INSERT INTO mail_preferences (user_id, updates) VALUES ($1,'daily') ON CONFLICT (user_id) DO UPDATE SET updates = 'daily'`, [U.mgr]);
    await owner.query(`SELECT app_queue_digests(app_firm_today())`);
    // Not taken into a summary (the job marks what it mails), and no summary for it.
    expect((await owner.query(`SELECT mailed_at FROM notifications WHERE user_id = $1 AND entity_id = $2`, [U.mgr, early])).rows).toEqual([{ mailed_at: null }]);
    expect((await owner.query(`SELECT 1 FROM outbound_emails WHERE kind = 'follow_up.digest' AND to_email = 'mgr@example.test'`)).rowCount).toBe(0);
  });

  it("stay hidden after release: the owner sees the release notice only, not the old ones with old dates", async () => {
    const later = id(45);
    await owner.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'action.commented','action',$2)`, [U.owner2, later]);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Later release canary',$5,'draft',app_firm_today() + 30,$6)`,
      [later, P, ACME, REC, U.owner2, U.lead],
    );
    await svc(U.lead, (tx, p) => transitionAction(tx, p, later, { to: "assigned" }), true);
    const mine = await rowsAs(U.owner2, `SELECT kind FROM notifications WHERE entity_id = $1`, [later]);
    expect(mine).toEqual([{ kind: "action.assigned" }]);
    // The firm's own notices are not touched by this rule.
    expect((await owner.query(`SELECT 1 FROM notifications WHERE entity_id = $1`, [later])).rowCount).toBe(2);
  });
});

describe("the firm admin's hand-over of someone named on a draft", () => {
  it("moves the draft with the rest, as before, and tells the new owner only of released work", async () => {
    const [who, draft, open] = [id(20), id(48), id(49)];
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1,'handed','handed@example.test')`, [who]);
    await owner.query(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'action_owner')`, [who, ACME]);
    await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P, who]);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by) VALUES
        ($1,$3,$4,$5,'Handed draft canary',$6,'draft',app_firm_today() + 30,$7),
        ($2,$3,$4,$5,'Handed open canary',$6,'assigned',app_firm_today() + 30,$7)`,
      [draft, open, P, ACME, REC, who, U.lead],
    );
    const report = async (by: string) => (await svc(by, (tx, p) => personHoldings(tx, p, who))).items.map((i) => i.title).sort();
    expect(await report(U.admin)).toEqual(["Handed draft canary", "Handed open canary"]);
    expect(await report(U.cadmin)).toEqual(["Handed open canary"]);
    await svc(U.admin, (tx, p) => handOver(tx, p, who, { to: U.owner2, kinds: ["action"] }), true);
    const owners = await owner.query(`SELECT id, owner_user_id FROM actions WHERE id = ANY($1) ORDER BY id`, [[draft, open]]);
    expect(owners.rows).toEqual([
      { id: draft, owner_user_id: U.owner2 },
      { id: open, owner_user_id: U.owner2 },
    ]);
    const told = await owner.query(`SELECT entity_id FROM notifications WHERE user_id = $1 AND entity_id = ANY($2)`, [U.owner2, [draft, open]]);
    expect(told.rows).toEqual([{ entity_id: open }]);
  });
});

describe("moving a department's work when all it holds is a draft", () => {
  it("records the move for the firm only: the client admin's activity record does not show it", async () => {
    const [from, moved] = [id(10), id(47)];
    await owner.query(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'الموارد البشرية','HR')`, [from, ACME]);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, department_id, created_by)
       VALUES ($1,$2,$3,$4,'Moved draft canary',$5,'draft',$6,$7)`,
      [moved, P, ACME, REC, U.owner, from, U.lead],
    );
    await as(U.admin, (c) => c.query(`SELECT * FROM app_move_department_work($1, $2, false, false)`, [from, DEPT]), true);
    const event = `SELECT event FROM activity_events WHERE event = 'department_moved' AND meta -> 'actions' ? $1`;
    expect(await rowsAs(U.cadmin, event, [moved])).toEqual([]);
    expect(await rowsAs(U.lead, event, [moved])).toEqual([{ event: "department_moved" }]);
    // The firm's draft page still says it was refiled; a client learns nothing of it.
    expect(await rowsAs(U.lead, `SELECT to_department FROM app_action_refilings($1)`, [moved])).toEqual([{ to_department: DEPT }]);
    for (const uid of Object.values(CLIENT_ROLES)) expect(await rowsAs(uid, `SELECT 1 FROM app_action_refilings($1)`, [moved]), uid).toEqual([]);
  });
});

describe("closing a project, and replacing an action, with a draft on it", () => {
  // A second project of the same client, so closing it leaves the first alone.
  const P2 = id(8);
  const REC3 = id(9);
  const X = { open: id(43), draft: id(44) };
  beforeAll(async () => {
    const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
    await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme phase two','active',$4)`, [
      P2,
      ACME,
      FIRM,
      U.admin,
    ]);
    await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [P2, U.owner, U.mgr]);
    await q(`INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$2,$3,'Phase two canary','shared',$4)`, [
      REC3,
      P2,
      ACME,
      U.lead,
    ]);
    await q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by) VALUES
        ($1,$3,$4,$5,'Phase two open canary',$6,'assigned',app_firm_today() + 30,$7),
        ($2,$3,$4,$5,'Phase two draft canary',$6,'draft',app_firm_today() + 30,$7)`,
      [X.open, X.draft, P2, ACME, REC3, U.owner, U.lead],
    );
  });

  it("an action is never replaced by a draft: the list leaves drafts out and the database refuses", async () => {
    const offered = (await svc(U.lead, (tx, p) => actionClosure(tx, p, X.open))).replacements.map((r) => r.id);
    expect(offered).not.toContain(X.draft);
    await expect(
      svc(U.lead, (tx, p) => transitionAction(tx, p, X.open, { to: "closed", closure: { outcome: "superseded", note: "replaced", supersededBy: X.draft } })),
    ).rejects.toThrow(/replacement is still a draft/);
  });

  it("a draft is never handed over to the client at closing; it can be withdrawn, and the client's closure page never lists it", async () => {
    await as(U.lead, (c) => c.query(`SELECT app_start_closing($1)`, [P2]), true);
    const dispose = (act: string, how: string, who: string | null) =>
      as(U.lead, (c) => c.query(`SELECT app_dispose_action($1, $2::closure_disposition, 'settled', $3::uuid, NULL)`, [act, how, who]), true);
    await expect(dispose(X.draft, "handed_over", U.owner)).rejects.toThrow(/draft cannot be handed over/);
    await dispose(X.draft, "withdrawn", null);
    await dispose(X.open, "handed_over", U.owner);
    for (const uid of [U.cadmin, U.mgr, U.owner]) {
      const page = await svc(uid, (tx, p) => getClosure(tx, p, P2));
      expect(page.items.map((i) => i.title), uid).toEqual(["Phase two open canary"]);
    }
    expect((await svc(U.lead, (tx, p) => getClosure(tx, p, P2))).items.map((i) => i.title).sort()).toEqual([
      "Phase two draft canary",
      "Phase two open canary",
    ]);
  });

  it("the client admin names who sustains released work, never a draft handed over before this rule", async () => {
    const legacy = id(50);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by)
       VALUES ($1,$2,$3,$4,'Legacy handed draft canary',$5,'draft',$6)`,
      [legacy, P2, ACME, REC3, U.owner, U.lead],
    );
    // Written the way app_dispose_action allowed before 0078.
    await owner.query(
      `INSERT INTO project_closure_items (closure_id, action_id, project_id, org_id, disposition, decided_by)
       VALUES (app_open_closure($1), $2, $1, $3, 'handed_over', $4)`,
      [P2, legacy, ACME, U.lead],
    );
    const name = (act: string) => as(U.cadmin, (c) => c.query(`SELECT app_name_sustainer($1, $2, NULL)`, [act, U.mgr]), true);
    await expect(name(legacy)).rejects.toThrow(/no such handed-over action/);
    await name(X.open);
  });
});
