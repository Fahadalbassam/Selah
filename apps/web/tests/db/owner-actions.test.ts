// Decision 1b (product owner, 17 Nov 2026): an action owner reads only the
// actions they own, enforced in the database (migration 0081_owner_actions),
// mirrored in authorize() ("assigned"). No titles and no counts of anyone
// else's actions, anywhere: the recommendation page, notices and mail, the
// mute list, the "replaced by" line, translations, the Files card, project
// progress, the schedule, follow-ups. Files keep their own rule: a teammate's
// file stays visible, without naming the teammate's action.
//
// Two owners in the walkthrough's style: one at a client with departments
// (owner@nukhba.test has a teammate in Legal) and one at a client without
// (owner@rawdah.test). Every owner case failed before 0081 and the service
// changes; the other roles guard what must not change.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { postComment } from "@/services/comments";
import { listFiles } from "@/services/files";
import { actionClosure, projectProgress } from "@/services/follow-through";
import { schedule } from "@/services/meetings";
import { getMailPreferences, listNotifications, setActionMuted } from "@/services/notifications";
import { loadPrincipal } from "@/services/principal";
import { getActionDetail, listActions } from "@/services/queries";
import { getRecommendation } from "@/services/responses";
import { translate } from "@/services/translations";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-b1b1-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const NUKHBA = id(2); // departments on
const RAWDAH = id(3); // departments off
const PN = id(4);
const PR = id(5);
const DEPT = { legal: id(6), fin: id(7), board: id(8) };
const U = {
  admin: id(11), // firm admin
  lead: id(12), // both clients' lead consultant
  ncadmin: id(13), // Nukhba's admin
  nmgr: id(14), // Nukhba manager in Legal
  nboard: id(15), // Nukhba manager in the Board secretariat only: keeps the "N more" line
  owner: id(16), // owner@nukhba.test: action owner in Legal
  mate: id(17), // the owner's teammate in Legal
  fin: id(18), // an action owner in Finance
  radmin: id(19), // Rawdah's admin
  rowner: id(20), // owner@rawdah.test: action owner, no departments
  rmate: id(21), // her colleague
};
const REC = { legal: id(31), all: id(32), rawdah: id(33) };
const A = {
  mine: id(41), // the owner's, Legal
  mate: id(42), // the teammate's, Legal, with something under it in every table
  wide: id(43), // the teammate's, company-wide
  fin: id(44), // Finance's
  handed: id(45), // the owner's until the hand-over
  closed: id(46), // the owner's, closed as replaced by the teammate's
  rmine: id(47), // Rawdah owner's
  rmate: id(48), // Rawdah colleague's
};
const DOC = { mate: id(51), handed: id(52) };
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const VECTOR = `[${Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;

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
// The route answers 404 for both: a ForbiddenError, a NotFoundError, and a row-level refusal (src/server/http.ts).
const NOT_FOUND = /forbidden|not found|row-level security/i;

// Every table that hangs off an action and that the app can read (the firm's
// reminders, action_reminders, are firm-only already; the policy check below
// covers them).
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
  "project_closure_items",
] as const;

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE content_translations`);
  await q(
    `INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'firm','Mizan Advisory',false), ($2,'client','Al-Nukhba',true), ($3,'client','Rawdah',false)`,
    [FIRM, NUKHBA, RAWDAH],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$12,'firm_admin'), ($2,$12,'consultant'),
      ($3,$13,'client_admin'), ($4,$13,'client_manager'), ($5,$13,'client_manager'), ($6,$13,'action_owner'), ($7,$13,'action_owner'), ($8,$13,'action_owner'),
      ($9,$14,'client_admin'), ($10,$14,'action_owner'), ($11,$14,'action_owner')`,
    [U.admin, U.lead, U.ncadmin, U.nmgr, U.nboard, U.owner, U.mate, U.fin, U.radmin, U.rowner, U.rmate, FIRM, NUKHBA, RAWDAH],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$5,'Nukhba governance','active',$6), ($3,'client',$4,$5,'Rawdah governance','active',$6)`,
    [PN, NUKHBA, PR, RAWDAH, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($2,$3,true)`, [NUKHBA, RAWDAH, U.lead]);
  await q(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1,$3), ($1,$4), ($1,$5), ($1,$6), ($1,$7), ($2,$8), ($2,$9)`,
    [PN, PR, U.nmgr, U.nboard, U.owner, U.mate, U.fin, U.rowner, U.rmate],
  );
  await q(
    `INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$4,'الشؤون القانونية','Legal'), ($2,$4,'المالية','Finance'), ($3,$4,'أمانة المجلس','Board secretariat')`,
    [DEPT.legal, DEPT.fin, DEPT.board, NUKHBA],
  );
  await q(
    // As in the walkthrough, Legal's and Finance's heads are action owners.
    `INSERT INTO department_members (department_id, user_id, is_head) VALUES ($1,$4,false), ($1,$5,true), ($1,$6,false), ($2,$7,true), ($3,$8,false)`,
    [DEPT.legal, DEPT.fin, DEPT.board, U.nmgr, U.owner, U.mate, U.fin, U.nboard],
  );
  await q(
    `INSERT INTO findings (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$2,$3,'No contracts register','shared',$4)`,
    [id(35), PN, NUKHBA, U.lead],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, department_id, finding_id, created_by) VALUES
      ($1,$4,$5,'Keep a contracts register','shared',$6,$9,$8),
      ($2,$4,$5,'Publish the delegation matrix','shared',NULL,NULL,$8),
      ($3,$7,$10,'Adopt a board charter','shared',NULL,NULL,$8)`,
    [REC.legal, REC.all, REC.rawdah, PN, NUKHBA, DEPT.legal, PR, U.lead, id(35), RAWDAH],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, created_by) VALUES
      ($1,$7,$8,$9,'Owner canary',$11,'in_progress',app_firm_today() + 30,$14,$15),
      ($2,$7,$8,$9,'Mate canary',$12,'blocked',app_firm_today() + 30,$14,$15),
      ($3,$7,$8,$10,'Mate wide canary',$12,'awaiting_review',app_firm_today() + 30,NULL,$15),
      ($4,$7,$8,$10,'Finance canary',$13,'in_progress',app_firm_today() + 30,$16,$15),
      ($5,$7,$8,$9,'Handed canary',$11,'in_progress',app_firm_today() + 30,$14,$15),
      ($6,$7,$8,$9,'Replaced canary',$11,'in_progress',app_firm_today() + 30,$14,$15)`,
    [A.mine, A.mate, A.wide, A.fin, A.handed, A.closed, PN, NUKHBA, REC.legal, REC.all, U.owner, U.mate, U.fin, DEPT.legal, U.lead, DEPT.fin],
  );
  // The owner's own action, closed as replaced by the teammate's: the "replaced by" line must not name it.
  await q(`UPDATE actions SET status = 'closed', closure_outcome = 'superseded', superseded_by = $2 WHERE id = $1`, [A.closed, A.mate]);
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by) VALUES
      ($1,$3,$4,$5,'Rawdah owner canary',$6,'in_progress',app_firm_today() + 30,$8),
      ($2,$3,$4,$5,'Rawdah colleague canary',$7,'in_progress',app_firm_today() + 30,$8)`,
    [A.rmine, A.rmate, PR, RAWDAH, REC.rawdah, U.rowner, U.rmate, U.lead],
  );

  // Something under the teammate's action (and the Rawdah colleague's) in every table.
  for (const [aid, pid, org, who, tag] of [
    [A.mate, PN, NUKHBA, U.mate, "Mate"],
    [A.rmate, PR, RAWDAH, U.rmate, "Rawdah colleague"],
  ] as const) {
    const at = [pid, org, aid];
    const doc = aid === A.mate ? DOC.mate : id(53);
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, title, storage_key, content_type, size_bytes, sha256, visibility, state, department_id, scan_status)
       VALUES ($1,$2,$3,$3,$4,'evidence',$5,$6,'application/pdf',1,'s','shared','submitted',$7,'clean')`,
      [doc, pid, org, who, `${tag} evidence file`, `k-${doc}`, aid === A.mate ? DEPT.legal : null],
    );
    const { rows: pu } = await q(
      `INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'Progress canary') RETURNING id`,
      [...at, who],
    );
    // The assistant's passages of the colleague's action and of its progress (the index holds both kinds).
    await q(
      `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, lang, content, embedding) VALUES
        ($1,$2,'action',$3,'shared',0,'en','Action passage canary',$5), ($1,$2,'progress_update',$4,'shared',0,'en','Progress passage canary',$5)`,
      [...at, pu[0].id, VECTOR],
    );
    await q(`INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [...at, doc, who]);
    await q(`INSERT INTO evidence_requests (project_id, org_id, action_id, title, created_by) VALUES ($1,$2,$3,'Evidence item canary',$4)`, [...at, U.lead]);
    await q(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome, reason) VALUES ($1,$2,$3,$4,'revise','Review canary')`, [...at, U.lead]);
    await q(`INSERT INTO review_signoffs (project_id, org_id, action_id, reviewer_id) VALUES ($1,$2,$3,$4)`, [...at, U.lead]);
    await q(`INSERT INTO risk_acceptances (project_id, org_id, action_id, accepted_by, statement) VALUES ($1,$2,$3,$4,'Risk canary')`, [
      ...at,
      aid === A.mate ? U.ncadmin : U.radmin,
    ]);
    await q(
      `INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason) VALUES ($1,$2,$3,$4,app_firm_today() + 60,'Deadline canary')`,
      [...at, who],
    );
    await q(`INSERT INTO action_notes (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'Note canary')`, [...at, U.lead]);
    await q(`INSERT INTO action_comments (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'Comment canary')`, [...at, who]);
    await q(
      `INSERT INTO action_due_changes (project_id, org_id, action_id, from_date, to_date, changed_by) VALUES ($1,$2,$3,app_firm_today() + 10,app_firm_today() + 20,$4)`,
      [...at, U.lead],
    );
    // About the colleague's action: one for the firm's lead, and one assigned to the owner herself.
    await q(
      `INSERT INTO follow_ups (project_id, org_id, action_id, title, visibility, assignee_user_id, due_at, created_by) VALUES
        ($1,$2,$3,'Lead follow-up canary','shared',$4, now() + interval '2 days', $4),
        ($1,$2,$3,'Assigned follow-up','shared',$5, now() + interval '3 days', $4)`,
      [...at, U.lead, aid === A.mate ? U.owner : U.rowner],
    );
    // Muted before the rule existed.
    await q(`INSERT INTO mail_mutes (user_id, action_id) VALUES ($1,$2)`, [aid === A.mate ? U.owner : U.rowner, aid]);
    await q(
      `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, to_state) VALUES ($1,$2,$4,'action',$3,'status_changed','blocked')`,
      [...at, who],
    );
    await q(
      `INSERT INTO content_translations (project_id, org_id, entity_type, entity_id, field, source_lang, target_lang, source_sha256, text, model, created_by)
       VALUES ($1,$2,'action',$3,'title','en','ar',$4,'ترجمة إجراء الزميل','m',$5)`,
      [...at, sha(`${tag} canary`), U.lead],
    );
  }
  // A closure round, so the colleague's action has a closure item (the project is not closing; the item is a row to read).
  const { rows: rounds } = await q(`INSERT INTO project_closures (project_id, org_id, started_by) VALUES ($1,$2,$3) RETURNING id`, [PN, NUKHBA, U.lead]);
  await q(
    `INSERT INTO project_closure_items (closure_id, action_id, project_id, org_id, disposition, note, decided_by) VALUES ($1,$2,$3,$4,'withdrawn','No longer needed',$5)`,
    [rounds[0].id, A.mate, PN, NUKHBA, U.lead],
  );
  // The owner's evidence on the action she will hand over: her upload stays hers afterwards.
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, title, storage_key, content_type, size_bytes, sha256, visibility, state, department_id, scan_status)
     VALUES ($1,$2,$3,$3,$4,'evidence','Handover evidence file','k-handed','application/pdf',1,'s','shared','submitted',$5,'clean')`,
    [DOC.handed, PN, NUKHBA, U.owner, DEPT.legal],
  );
  await q(`INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [
    PN,
    NUKHBA,
    A.handed,
    DOC.handed,
    U.owner,
  ]);
  // A notice about her own action, while it is hers.
  await q(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'action.commented','action',$2)`, [U.owner, A.handed]);
  await q(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'action.commented','action',$2)`, [U.owner, A.mine]);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

// ------------------------------------------------------------ the database
describe("the database: an action owner reads only her own actions and what is under them", () => {
  it("lists only her own actions, at a client with departments and at one without", async () => {
    expect(titles(await rowsAs(U.owner, `SELECT title FROM actions`))).toEqual(["Handed canary", "Owner canary", "Replaced canary"]);
    expect(titles(await rowsAs(U.rowner, `SELECT title FROM actions`))).toEqual(["Rawdah owner canary"]);
    // Her teammate the same way round.
    expect(titles(await rowsAs(U.mate, `SELECT title FROM actions`))).toEqual(["Mate canary", "Mate wide canary"]);
  });

  it("reads no row under a colleague's action, and nothing that names it", async () => {
    for (const [who, aid] of [
      [U.owner, A.mate],
      [U.rowner, A.rmate],
    ] as const) {
      for (const t of UNDER) {
        // Not even a follow-up assigned to her, when it names a colleague's action (0086): its action id is theirs.
        expect(await rowsAs(who, `SELECT 1 FROM ${t} WHERE action_id = $1`, [aid]), `${who} reads ${t}`).toEqual([]);
      }
      for (const t of ["activity_events", "notifications", "content_translations"]) {
        expect(await rowsAs(who, `SELECT 1 FROM ${t} WHERE entity_id = $1`, [aid]), t).toEqual([]);
      }
      expect(await rowsAs(who, `SELECT app_can_see_action($1) AS ok`, [aid])).toEqual([{ ok: false }]);
      expect(await rowsAs(who, `SELECT * FROM app_action_people($1)`, [aid])).toEqual([]);
      expect(await rowsAs(who, `SELECT * FROM app_second_review_state($1)`, [aid])).toEqual([]);
      expect(await rowsAs(who, `SELECT * FROM app_action_ladder($1)`, [aid])).toEqual([]);
    }
  });

  it("the other roles are unchanged: the teammate, a manager in the department, the client's admin and the firm", async () => {
    const ALL_N = ["Finance canary", "Handed canary", "Mate canary", "Mate wide canary", "Owner canary", "Replaced canary"];
    expect(titles(await rowsAs(U.nmgr, `SELECT title FROM actions`))).toEqual(ALL_N.filter((t) => t !== "Finance canary"));
    for (const who of [U.ncadmin, U.lead, U.admin]) {
      expect(titles(await rowsAs(who, `SELECT title FROM actions WHERE project_id = $1`, [PN]))).toEqual(ALL_N);
    }
    for (const who of [U.mate, U.nmgr, U.lead]) {
      // Follow-ups: an owner reads only those assigned to her (0086); the teammate has none here.
      const skip = (x: string) =>
        ["mail_mutes", "action_notes"].includes(x) || (x === "project_closure_items" && who !== U.lead) || (x === "follow_ups" && who === U.mate);
      for (const t of UNDER.filter((x) => !skip(x))) {
        expect((await rowsAs(who, `SELECT 1 FROM ${t} WHERE action_id = $1`, [A.mate])).length, `${who} ${t}`).toBeGreaterThan(0);
      }
    }
  });

  it("cannot write under a colleague's action, nor mute it", async () => {
    await expect(
      as(U.owner, (c) =>
        c.query(`INSERT INTO action_comments (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'hi')`, [PN, NUKHBA, A.mate, U.owner]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(svc(U.owner, (tx, p) => setActionMuted(tx, p, A.mate, true))).rejects.toThrow(NOT_FOUND);
    await expect(svc(U.owner, (tx, p) => postComment(tx, p, A.mate, { body: "hi", mentions: [] }))).rejects.toThrow(NOT_FOUND);
  });

  // Every table the app can read that refers to an action: by a foreign key to actions (whatever the
  // column is called), by a foreign key to a table that carries the owner rule, or by a polymorphic
  // pair (entity_type/source_type/target_type with its id). Each carries the rule, or is named here
  // with the reason it needs none.
  const EXEMPT: Record<string, string> = {
    ai_chunks: "owners never have the assistant: policy assistant_on, and client_ai_settings.roles may not hold action_owner",
    ai_drafts: "the firm's drafts only: no client role reads a row",
  };
  it("every table that refers to an action carries the owner rule, or is named with its reason", async () => {
    const { rows } = await owner.query<{ table_name: string }>(
      `WITH ruled AS (SELECT tablename::regclass AS rel FROM pg_policies WHERE policyname = 'owner' AND permissive = 'RESTRICTIVE')
       SELECT DISTINCT c.relname AS table_name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind IN ('r', 'p') AND has_table_privilege('selah_app', c.oid, 'SELECT') AND (
         c.oid = 'actions'::regclass
         OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                    AND (k.confrelid = 'actions'::regclass OR k.confrelid IN (SELECT rel FROM ruled)))
         OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND NOT a.attisdropped
                    AND a.attname IN ('entity_type', 'source_type', 'target_type')))`,
    );
    const { rows: policies } = await owner.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE policyname = 'owner' AND permissive = 'RESTRICTIVE'`,
    );
    const covered = new Set(policies.map((p) => p.tablename));
    const found = rows.map((r) => r.table_name);
    expect(found).toEqual(expect.arrayContaining(["actions", "progress_updates", "follow_ups", "activity_events", "notifications", "content_translations"]));
    expect(found.filter((t) => !covered.has(t) && !(t in EXEMPT))).toEqual([]);
  });

  it("project progress counts only her own work", async () => {
    const total = async (who: string, pid: string) => Number((await rowsAs(who, `SELECT total FROM app_project_progress($1, app_firm_today())`, [pid]))[0].total);
    expect(await total(U.owner, PN)).toBe(3);
    expect(await total(U.rowner, PR)).toBe(1);
    expect(await total(U.ncadmin, PN)).toBe(6);
    expect((await svc(U.owner, (tx, p) => projectProgress(tx, p, PN))).total).toBe(3);
  });

  it("the schedule names only her own actions and the follow-ups assigned to her", async () => {
    const view = await rowsAs(U.owner, `SELECT item_type, title FROM v_schedule WHERE item_type <> 'meeting' ORDER BY title`);
    expect(view).toEqual([
      { item_type: "action", title: "Handed canary" },
      { item_type: "action", title: "Owner canary" },
    ]);
    const now = Date.now();
    const items = await svc(U.owner, (tx, p) => schedule(tx, p, { from: new Date(now - 86_400_000), to: new Date(now + 60 * 86_400_000) }));
    expect(JSON.stringify(items)).not.toMatch(/Mate canary|Mate wide canary|Finance canary|Lead follow-up canary/);
  });

  it("the client's assistant index is out of her reach: no passage, and owners can never be given the assistant", async () => {
    // The colleague's action and progress passages exist: the firm reads both.
    expect((await rowsAs(U.lead, `SELECT content FROM ai_chunks ORDER BY content`)).map((r) => r.content)).toEqual(
      expect.arrayContaining(["Action passage canary", "Progress passage canary"]),
    );
    for (const who of [U.owner, U.rowner]) expect(await rowsAs(who, `SELECT content FROM ai_chunks`)).toEqual([]);
    await expect(rowsAs(U.admin, `SELECT app_set_client_ai($1, true, '{action_owner}', 10)`, [NUKHBA])).rejects.toThrow(/action owners/);
  });

  // The lead's ruling on the review (17 Nov): every definer function an owner can call refuses or
  // answers nothing for an action (or meeting) she may not read. Before 0087 these answered.
  it("the definer functions she can call refuse, or answer nothing, about a colleague's action", async () => {
    // Telling the firm's team a colleague's action waits for review (it does): refused, nothing written.
    await expect(rowsAs(U.owner, `SELECT app_notify_project_team($1, 'action.awaiting_review', '{}') AS n`, [A.wide])).rejects.toThrow(/not visible/);
    // The yes/no helpers say nothing true about it.
    for (const fn of ["app_action_dept_ok", "app_action_label_ok", "app_action_visible_to_client", "app_can_extend"]) {
      expect((await rowsAs(U.owner, `SELECT ${fn}($1) AS ok`, [A.mate]))[0].ok, fn).toBe(false);
      expect((await rowsAs(U.owner, `SELECT ${fn}($1) AS ok`, [A.mine]))[0].ok, `${fn} on her own`).toBe(true);
      expect((await rowsAs(U.nmgr, `SELECT ${fn}($1) AS ok`, [A.mate]))[0].ok, `${fn} for the manager`).toBe(true);
    }
    // The masking list (for the assistant, which owners never have): refused.
    await expect(rowsAs(U.owner, `SELECT * FROM app_mask_terms($1)`, [PN])).rejects.toThrow(/action owners/);
    expect((await rowsAs(U.nmgr, `SELECT * FROM app_mask_terms($1)`, [PN])).length).toBeGreaterThan(0);
    // The invite list, with colleagues' departments: only for people who may book.
    expect(await rowsAs(U.owner, `SELECT * FROM app_meeting_invitees($1)`, [PN])).toEqual([]);
    expect((await rowsAs(U.nmgr, `SELECT * FROM app_meeting_invitees($1)`, [PN])).length).toBeGreaterThan(0);
  });

  it("whether a colleague's file was accepted as evidence is not hers to learn", async () => {
    const { rows: es } = await owner.query(`SELECT id FROM evidence_submissions WHERE document_id = $1`, [DOC.mate]);
    // Reviews are append-only; this one stays (nothing later in the file reads the colleague's reviews).
    await owner.query(
      `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome, evidence_submission_ids) VALUES ($1,$2,$3,$4,'accept',$5)`,
      [PN, NUKHBA, A.mate, U.lead, [es[0].id]],
    );
    expect((await rowsAs(U.lead, `SELECT app_evidence_accepted($1) AS ok`, [DOC.mate]))[0].ok).toBe(true);
    expect((await rowsAs(U.owner, `SELECT app_evidence_accepted($1) AS ok`, [DOC.mate]))[0].ok).toBe(false);
  });

  it("findings answered elsewhere are not counted for her (she reads no finding)", async () => {
    expect(await rowsAs(U.owner, `SELECT * FROM app_findings_answered_elsewhere($1)`, [PN])).toEqual([]);
    expect(await rowsAs(U.fin, `SELECT * FROM app_findings_answered_elsewhere($1)`, [PN])).toEqual([]);
    // A manager outside Legal is still told the finding is answered in another department.
    expect(await rowsAs(U.nboard, `SELECT n FROM app_findings_answered_elsewhere($1)`, [PN])).toEqual([{ n: 1 }]);
  });
});

// --------------------------------------------------------- services, routes
describe("every screen and route: her own actions only, a colleague's is Not found", () => {
  it("a colleague's action is Not found by its address and through the API", async () => {
    for (const [who, aid] of [
      [U.owner, A.mate],
      [U.owner, A.wide],
      [U.owner, A.fin],
      [U.rowner, A.rmate],
    ] as const) {
      await expect(svc(who, (tx, p) => getActionDetail(tx, p, aid))).rejects.toThrow(NOT_FOUND);
    }
    expect((await svc(U.owner, (tx, p) => getActionDetail(tx, p, A.mine))).action.title).toBe("Owner canary");
    expect((await svc(U.mate, (tx, p) => getActionDetail(tx, p, A.mate))).action.title).toBe("Mate canary");
  });

  it("the recommendation page shows her actions and nothing about the others, not even how many", async () => {
    const r = await svc(U.owner, (tx, p) => getRecommendation(tx, p, REC.legal));
    expect(titles(r.actions)).toEqual(["Handed canary", "Owner canary", "Replaced canary"]);
    expect(r.actionsLeftOut).toBe(0);
    expect(JSON.stringify(r)).not.toContain("Mate canary");
    // The database answers no count to an owner either.
    expect(await rowsAs(U.owner, `SELECT app_actions_left_out($1, '{}') AS n`, [REC.legal])).toEqual([{ n: 0 }]);
    expect(await rowsAs(U.rowner, `SELECT app_actions_left_out($1, '{}') AS n`, [REC.rawdah])).toEqual([{ n: 0 }]);
    // A recommendation she has no action under stays Not found.
    await expect(svc(U.owner, (tx, p) => getRecommendation(tx, p, REC.all))).rejects.toThrow(NOT_FOUND);
  });

  it("a manager limited to another department keeps the count, never the titles", async () => {
    const r = await svc(U.nboard, (tx, p) => getRecommendation(tx, p, REC.all));
    expect(titles(r.actions)).toEqual(["Mate wide canary"]);
    expect(r.actionsLeftOut).toBe(1);
    expect(JSON.stringify(r)).not.toContain("Finance canary");
  });

  it("action lists, notices, the mute list, translations and the replaced-by line name only her own", async () => {
    expect(titles(await svc(U.owner, (tx, p) => listActions(tx, p)))).toEqual(["Handed canary", "Owner canary", "Replaced canary"]);
    const notes = await svc(U.owner, (tx, p) => listNotifications(tx, p));
    expect(notes.items.map((n) => n.entityId).sort()).toEqual([A.handed, A.mine].sort());
    expect((await svc(U.owner, (tx, p) => getMailPreferences(tx, p))).muted).toEqual([]);
    expect((await svc(U.rowner, (tx, p) => getMailPreferences(tx, p))).muted).toEqual([]);
    await expect(
      svc(U.owner, (tx, p) => translate(tx, p, { entityType: "action", entityId: A.mate, field: "title", to: "ar" })),
    ).rejects.toThrow(NOT_FOUND);
    await expect(
      svc(U.rowner, (tx, p) => translate(tx, p, { entityType: "action", entityId: A.rmate, field: "title", to: "ar" })),
    ).rejects.toThrow(NOT_FOUND);
    const closure = await svc(U.owner, (tx, p) => actionClosure(tx, p, A.closed));
    expect(closure.closure?.outcome).toBe("superseded");
    expect(closure.closure?.supersededBy).toBeNull();
    // Who may open the replacement still reads its name.
    expect((await svc(U.nmgr, (tx, p) => actionClosure(tx, p, A.closed))).closure?.supersededBy).toMatchObject({ title: "Mate canary" });
  });

  it("a new notice about a colleague's action is not stored for an owner (the head of the department included)", async () => {
    // The owner heads Legal: the reminder ladder tells the head at level 2.
    const { rowCount } = await owner.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'follow_up.overdue','action',$2)`, [
      U.owner,
      A.mate,
    ]);
    expect(rowCount).toBe(0);
    // Her own, and a manager's about the same action, are stored.
    expect((await owner.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'follow_up.overdue','action',$2)`, [U.nmgr, A.mate])).rowCount).toBe(1);
    expect((await owner.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'follow_up.due_soon','action',$2)`, [U.owner, A.mine])).rowCount).toBe(1);
    await owner.query(`DELETE FROM notifications WHERE kind LIKE 'follow_up.%'`);
  });

  // The lead's ruling on the review (17 Nov): when the department's head cannot open the action
  // (an action owner, not its owner), the escalation that would have gone to her goes to the
  // client's admins, on the ladder the action shows and in what the reminder job sends, so the
  // step never reaches nobody. Before 0088 the ladder said "department head" and the job chose her,
  // and the notice was then dropped.
  it("an escalation the department's head could not open goes to the client's admins instead", async () => {
    const legal = id(50);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, created_by)
       VALUES ($1,$2,$3,$4,'Legal teammate canary',$5,'in_progress',app_firm_today() - 1,$6,$7)`,
      [legal, PN, NUKHBA, REC.legal, U.mate, DEPT.legal, U.lead],
    );
    const ladder = async (aid: string) =>
      Object.fromEntries((await rowsAs(U.lead, `SELECT level, audience FROM app_action_ladder($1)`, [aid])).map((r) => [r.level, r.audience]));
    // Legal's head (owner@nukhba.test's like) owns neither: the client's admins in her place.
    expect((await ladder(legal))[2]).toEqual(expect.arrayContaining(["client_admins_for_head"]));
    expect((await ladder(legal))[2]).not.toContain("department_head");
    // Finance's head owns the Finance action: she is told, as before.
    expect((await ladder(A.fin))[2]).toContain("department_head");
    expect((await ladder(A.fin))[2]).not.toContain("client_admins_for_head");
    // What the job sends at level 2 for the Legal action.
    const due = async (aid: string) =>
      (
        await owner.query(
          `SELECT level, recipients FROM app_follow_ups_due((SELECT a.due_date + p.escalate_level2_days FROM actions a JOIN projects p ON p.id = a.project_id WHERE a.id = $1))
           WHERE action_id = $1`,
          [aid],
        )
      ).rows[0] as { level: number; recipients: string[] };
    const step = await due(legal);
    expect(step.level).toBe(2);
    expect(step.recipients).toContain(U.ncadmin);
    expect(step.recipients).not.toContain(U.owner);
    const fin = await due(A.fin);
    expect(fin.recipients).toContain(U.fin);
    expect(fin.recipients).not.toContain(U.ncadmin);
  });

  it("the Files card keeps a teammate's file (files keep their rule) and never names the teammate's action", async () => {
    const files = await svc(U.owner, (tx, p) => listFiles(tx, p));
    const mates = files.find((f) => f.id === DOC.mate);
    expect(mates?.title).toBe("Mate evidence file");
    expect(mates?.source).toEqual({ kind: "evidence", id: null, title: null });
    expect(JSON.stringify(files)).not.toMatch(/Mate canary|Mate wide canary/);
    expect(JSON.stringify(files)).not.toContain(A.mate);
    // At Rawdah (no departments) a colleague's file is not hers to see, as before.
    expect((await svc(U.rowner, (tx, p) => listFiles(tx, p))).map((f) => f.title)).not.toContain("Rawdah colleague evidence file");
  });
});

// --------------------------------------------------------------- hand-over
describe("a former owner, after a hand-over", () => {
  beforeAll(async () => {
    await as(U.lead, (c) => c.query(`UPDATE actions SET owner_user_id = $2 WHERE id = $1`, [A.handed, U.mate]), true);
  });

  it("no longer reads the action, anything under it or the notices about it", async () => {
    expect(titles(await rowsAs(U.owner, `SELECT title FROM actions`))).toEqual(["Owner canary", "Replaced canary"]);
    await expect(svc(U.owner, (tx, p) => getActionDetail(tx, p, A.handed))).rejects.toThrow(NOT_FOUND);
    expect(await rowsAs(U.owner, `SELECT 1 FROM evidence_submissions WHERE action_id = $1`, [A.handed])).toEqual([]);
    expect((await svc(U.owner, (tx, p) => listNotifications(tx, p))).items.map((n) => n.entityId)).toEqual([A.mine]);
    // The new owner reads it.
    expect((await svc(U.mate, (tx, p) => getActionDetail(tx, p, A.handed))).action.title).toBe("Handed canary");
  });

  it("keeps the files she uploaded, without the action's name", async () => {
    const mine = (await svc(U.owner, (tx, p) => listFiles(tx, p))).find((f) => f.id === DOC.handed);
    expect(mine?.title).toBe("Handover evidence file");
    expect(mine?.source).toEqual({ kind: "evidence", id: null, title: null });
  });

  it("through the leaver flow itself (app_hand_over): the new owner is told, the former owner reads nothing about it", async () => {
    const [leaver, act] = [id(23), id(49)];
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1,'leaver','leaver@example.test')`, [leaver]);
    await owner.query(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'action_owner')`, [leaver, NUKHBA]);
    await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PN, leaver]);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Leaver canary',$5,'in_progress',app_firm_today() + 20,$6)`,
      [act, PN, NUKHBA, REC.all, leaver, U.lead],
    );
    await owner.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'action.commented','action',$2)`, [leaver, act]);
    expect(titles(await rowsAs(leaver, `SELECT title FROM actions`))).toEqual(["Leaver canary"]);
    // The client's admin hands the leaver's work to the teammate (the departing-person screen).
    expect((await as(U.ncadmin, (c) => c.query(`SELECT app_hand_over($1, $2, '{action}') AS n`, [leaver, U.mate]), true)).rows[0].n).toBeGreaterThan(0);
    // The new owner holds it and was told, in the same statement as the hand-over.
    expect(await rowsAs(U.mate, `SELECT kind FROM notifications WHERE entity_id = $1`, [act])).toEqual([{ kind: "action.assigned" }]);
    expect(titles(await rowsAs(U.mate, `SELECT title FROM actions WHERE id = $1`, [act]))).toEqual(["Leaver canary"]);
    // The former owner reads neither the action nor her old notice about it.
    expect(await rowsAs(leaver, `SELECT title FROM actions`)).toEqual([]);
    expect(await rowsAs(leaver, `SELECT 1 FROM notifications WHERE entity_id = $1`, [act])).toEqual([]);
    await expect(svc(leaver, (tx, p) => getActionDetail(tx, p, act))).rejects.toThrow(NOT_FOUND);
  });

  it("the summary mail does not count an old notice about it", async () => {
    // Unread and not mailed, with a daily summary: before 0081 the summary job queued a mail for it.
    await owner.query(`UPDATE notifications SET mailed_at = NULL, read_at = NULL, created_at = now() - interval '1 hour' WHERE user_id = $1`, [U.owner]);
    await owner.query(`DELETE FROM notifications WHERE user_id = $1 AND entity_id = $2`, [U.owner, A.mine]);
    await owner.query(`UPDATE notifications SET kind = 'follow_up.overdue' WHERE user_id = $1`, [U.owner]);
    await owner.query(`INSERT INTO mail_preferences (user_id, reminders) VALUES ($1,'daily') ON CONFLICT (user_id) DO UPDATE SET reminders = 'daily'`, [U.owner]);
    await owner.query(`DELETE FROM outbound_emails`);
    await owner.query(`SELECT app_queue_digests(app_firm_today())`);
    expect((await owner.query(`SELECT 1 FROM outbound_emails WHERE to_email = 'owner@example.test'`)).rowCount).toBe(0);
  });
});
