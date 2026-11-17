// Who sees an item (decision of 17 Nov 2026, feature A, part 2) against a real
// Postgres: "everyone with access, except…" and "only these people…" on
// documents (never evidence) and meetings (migrations 0110, 0111).
//   - The database twin of the never-widen property: for every seeded user,
//     the rows they read with the audiences set are a subset of the rows they
//     read without them, on every table the policy is on.
//   - Someone left out sees nothing: not the item by its address, through the
//     API or as a download; not in the Files card, the project's lists, the
//     schedule, Today, notifications, the mail queue, the exports, the
//     activity record, the assistant's search or its citations.
//   - The server refuses a locked person, an "only" list with nobody, a person
//     who could not see the item, a client admin leaving out the firm's
//     people, managers and owners, evidence, and a share, an invitation or a
//     follow-up to someone left out.
//   - "Except" lets in someone who gains access later; "only" does not; a new
//     deputy is never shut out.
//   - A change is audited and tells nobody, and opening it up again neither.
// Every test about a left-out person failed before the two migrations and the
// service changes; the people who still see the items guard what must not change.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorize, type Principal, type RetrievalScope } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { runMail, type OutgoingMail } from "@/jobs/mail";
import { ownerChecks } from "@/jobs/ops-check";
import { readXlsx } from "@/lib/office/xlsx-read";
import { truncateAuditLog } from "./audit-reset";

vi.mock("@/services/storage", () => ({
  DOWNLOAD_TTL_SECONDS: 60,
  putObject: async () => undefined,
  copyObject: async () => undefined,
  getObject: async () => new Uint8Array(),
  signedDownloadUrl: async (key: string) => `https://storage.test/${key}`,
}));
vi.mock("@/services/ai-client", () => ({
  translateText: async (text: string) => ({ text, model: "fake" }),
  summarizePages: async () => {
    throw new Error("not in tests");
  },
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = { ar: (await import("../../messages/ar.json")).default, en: (await import("../../messages/en.json")).default };
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ar" | "en"; namespace?: string }) =>
      createTranslator({ locale, messages: messages[locale], namespace: namespace as never }),
  };
});

const { retrieve } = await import("@/services/assistant");
const D = await import("@/services/documents");
const F = await import("@/services/files");
const M = await import("@/services/meetings");
const { getProject } = await import("@/services/queries");
const { today } = await import("@/services/today");
const { listNotifications } = await import("@/services/notifications");
const { actionsWorkbook, planWorkbook } = await import("@/services/exports");
const { loadPrincipal } = await import("@/services/principal");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-a0d1-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const NUKHBA = id(2);
const OTHER = id(3);
const PN = id(4);
const DEPT = id(5);
const U = {
  admin: id(11), // firm admin
  lead: id(12), // the client's lead consultant
  deputy: id(13), // the client's deputy
  cons: id(14), // staffed on the project; uploads the firm's files
  cons2: id(15), // staffed on the project; left out of a deliverable
  ncadmin: id(16), // the client's admin
  nmgr: id(17), // manager@nukhba.test-style: left out
  nmgr2: id(18), // a manager who still sees everything
  owner: id(19), // an action owner, in the department
  later: id(20), // a manager who joins the project after the audiences are set
  newDeputy: id(21), // on the client's team, named deputy later
  other: id(22), // another client's admin
};
const DOC = { deliv: id(31), client: id(32), only: id(33), open: id(34), firmOnly: id(35), evid: id(36) };
const TITLE = {
  deliv: "Restructuring proposal canary",
  client: "Salary review canary",
  only: "Board session canary",
  open: "Open plan",
  firmOnly: "Draft deliverable",
};
const QUERY = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const MEET = "https://meet.google.com/abc-defg-hij";
const NOT_FOUND = /forbidden|not found/i;
const email = (u: string) => `${Object.entries(U).find(([, v]) => v === u)![0]}@nukhba.test`;

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
const rowsAs = async (userId: string, text: string, params: unknown[] = []) => (await as(userId, (c) => c.query(text, params))).rows;
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
const hour = (h: number) => new Date(Date.now() + h * 3_600_000);
const q = (text: string, params: unknown[] = []) => owner.query(text, params);

let MID = "";

async function doc(docId: string, f: { by: string; ownerOrg: string; title: string; visibility?: string; purpose?: string; ai?: boolean }) {
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
       storage_key, content_type, size_bytes, sha256, scan_status, ai_indexable)
     VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7,$8,$9,'application/pdf',10,$11,'clean',$10)`,
    [docId, PN, NUKHBA, f.ownerOrg, f.by, f.purpose ?? "deliverable", f.title, f.visibility ?? "shared", `k-${docId}`, f.ai ?? false, `sha-${docId}`],
  );
}

beforeAll(async () => {
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`DELETE FROM outbound_emails`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'firm','Mizan Advisory',false), ($2,'client','Al-Nukhba',true), ($3,'client','Other Co',false)`,
    [FIRM, NUKHBA, OTHER],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const uid of Object.values(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, email(uid).split("@")[0], email(uid)]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$13,'firm_admin'), ($2,$13,'consultant'), ($3,$13,'consultant'), ($4,$13,'consultant'), ($5,$13,'consultant'),
      ($6,$14,'client_admin'), ($7,$14,'client_manager'), ($8,$14,'client_manager'), ($9,$14,'action_owner'), ($10,$14,'client_manager'),
      ($11,$13,'consultant'), ($12,$15,'client_admin')`,
    [U.admin, U.lead, U.deputy, U.cons, U.cons2, U.ncadmin, U.nmgr, U.nmgr2, U.owner, U.later, U.newDeputy, U.other, FIRM, NUKHBA, OTHER],
  );
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Nukhba governance','active',$4)`, [
    PN,
    NUKHBA,
    FIRM,
    U.admin,
  ]);
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($1,$5,false,false), ($1,$6,false,false)`,
    [NUKHBA, U.lead, U.deputy, U.cons, U.cons2, U.newDeputy],
  );
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($1,$5), ($1,$6)`, [PN, U.cons, U.cons2, U.nmgr, U.nmgr2, U.owner]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'المالية','Finance')`, [DEPT, NUKHBA]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, [DEPT, U.nmgr, U.nmgr2, U.owner]);
  // The client's managers have the assistant (wave 3), so their search is under test too.
  await q(`INSERT INTO client_ai_settings (client_org_id, enabled, roles) VALUES ($1, true, '{client_admin,client_manager}')`, [NUKHBA]);
  await q(`INSERT INTO client_ai_consents (client_org_id, version, locale, given_by) VALUES ($1, app_client_ai_version(), 'en', $2)`, [NUKHBA, U.ncadmin]);

  await doc(DOC.deliv, { by: U.cons, ownerOrg: FIRM, title: TITLE.deliv, ai: true });
  await doc(DOC.client, { by: U.nmgr2, ownerOrg: NUKHBA, title: TITLE.client, purpose: "client_document", ai: true });
  await doc(DOC.only, { by: U.cons, ownerOrg: FIRM, title: TITLE.only });
  await doc(DOC.open, { by: U.cons, ownerOrg: FIRM, title: TITLE.open, ai: true });
  await doc(DOC.firmOnly, { by: U.cons, ownerOrg: FIRM, title: TITLE.firmOnly, visibility: "firm_private" });
  await doc(DOC.evid, { by: U.nmgr2, ownerOrg: NUKHBA, title: "Evidence", purpose: "evidence" });
  for (const d of [DOC.deliv, DOC.client, DOC.open]) {
    await q(
      `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, content, embedding)
       VALUES ($1,$2,'document',$3,'shared',0,$4,$5)`,
      [PN, NUKHBA, d, `passage of ${d}`, `[${QUERY.join(",")}]`],
    );
  }
  await q(`INSERT INTO document_shares (document_id, user_id, granted_by) VALUES ($1,$2,$3)`, [DOC.open, U.owner, U.cons]);
  // A notice the left-out manager got about the deliverable before it was narrowed.
  await q(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'document.shared','document',$2)`, [U.nmgr, DOC.deliv]);

  // Who sees what, set the way the screens set it.
  await svc(U.cons, (tx, p) => D.setDocumentAudience(tx, p, DOC.deliv, { mode: "except", people: [U.nmgr, U.cons2] }), true);
  await svc(U.ncadmin, (tx, p) => D.setDocumentAudience(tx, p, DOC.client, { mode: "except", people: [U.nmgr] }), true);
  await svc(U.cons, (tx, p) => D.setDocumentAudience(tx, p, DOC.only, { mode: "only", people: [U.cons, U.nmgr2] }), true);
  // The firm shares its draft with the client and leaves a colleague out in the same step.
  await svc(U.cons, (tx, p) => D.shareDocument(tx, p, DOC.firmOnly, { mode: "except", people: [U.cons2] }), true);

  // A meeting booked by the lead; then the manager and a consultant, both invited as optional, are left out.
  MID = (
    await svc(
      U.lead,
      (tx, p) =>
        M.bookMeeting(tx, p, PN, {
          kind: "status",
          title: "Closed board session",
          startsAt: hour(24),
          endsAt: hour(25),
          location: "online",
          joinUrl: MEET,
          spokenLang: "en",
          attendees: [{ userId: U.nmgr, optional: true }, { userId: U.cons2, optional: true }, { userId: U.nmgr2 }],
          sendInvites: true,
        }),
      true,
    )
  ).id;
  await svc(U.lead, (tx, p) => M.setMeetingAudience(tx, p, MID, { mode: "except", people: [U.nmgr, U.cons2] }), true);
  await q(`UPDATE meetings SET status = 'held', transcript_consent = true, consent_noted_by = $2 WHERE id = $1`, [MID, U.lead]);
  await q(`INSERT INTO meeting_decisions (project_id, org_id, meeting_id, text, visibility, created_by) VALUES ($1,$2,$3,'Decision canary','shared',$4)`, [PN, NUKHBA, MID, U.lead]);
  await q(`INSERT INTO meeting_summaries (meeting_id, project_id, org_id, lang, main_points_md, confirmed_by, visibility) VALUES ($1,$2,$3,'en','Summary canary',$4,'shared')`, [
    MID,
    PN,
    NUKHBA,
    U.lead,
  ]);
  await q(`INSERT INTO meeting_summary_sources (meeting_id, project_id, org_id, line, kind, document_id, page) VALUES ($1,$2,$3,1,'document',$4,1)`, [MID, PN, NUKHBA, DOC.open]);
  await q(`INSERT INTO meeting_transcripts (meeting_id, project_id, org_id, lang, format, body, imported_by) VALUES ($1,$2,$3,'en','text','Transcript canary',$4)`, [MID, PN, NUKHBA, U.lead]);
  await q(
    `INSERT INTO meeting_notes (project_id, org_id, author_id, meeting_id, held_on, title, body, visibility) VALUES ($1,$2,$3,$4,app_firm_today(),'Note canary','Said','shared')`,
    [PN, NUKHBA, U.lead, MID],
  );
  await q(
    `INSERT INTO follow_ups (project_id, org_id, meeting_id, title, visibility, assignee_user_id, due_at, created_by) VALUES ($1,$2,$3,'Follow-up canary','shared',$4, now() + interval '2 days', $5)`,
    [PN, NUKHBA, MID, U.nmgr2, U.lead],
  );
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

// ------------------------------------------------------------------ the database rule
const TABLES: Record<string, string> = {
  documents: "id::text",
  document_shares: "document_id || ':' || user_id",
  document_summaries: "id::text",
  info_request_files: "request_id || ':' || document_id",
  assessment_evidence: "answer_id || ':' || document_id",
  meetings: "id::text",
  meeting_attendees: "id::text",
  meeting_decisions: "id::text",
  meeting_summaries: "meeting_id::text",
  meeting_summary_sources: "id::text",
  meeting_transcripts: "meeting_id::text",
  meeting_notes: "id::text",
  follow_ups: "id::text",
  ai_chunks: "id::text",
  content_translations: "id::text",
  activity_events: "id::text",
  notifications: "id::text",
};

async function snapshot() {
  const out = new Map<string, Set<string>>();
  for (const [name, uid] of Object.entries(U)) {
    for (const [table, key] of Object.entries(TABLES)) {
      const rows = await rowsAs(uid, `SELECT ${key} AS k FROM ${table}`);
      out.set(`${name}:${table}`, new Set(rows.map((r) => String(r.k))));
    }
  }
  return out;
}

describe("the database rule only takes people away", () => {
  it("is a RESTRICTIVE policy on every table that gets the picker and every table under those items", async () => {
    const { rows } = await q(`SELECT tablename, permissive FROM pg_policies WHERE policyname = 'audience'`);
    const have = new Map(rows.map((r) => [r.tablename as string, r.permissive as string]));
    for (const table of Object.keys(TABLES)) expect(have.get(table), table).toBe("RESTRICTIVE");
  });

  it("for every seeded user, the rows read with the audiences are a subset of the rows read without them", async () => {
    const saved = (await q(`SELECT * FROM item_audiences`)).rows;
    const people = (await q(`SELECT * FROM item_audience_people`)).rows;
    expect(saved.length).toBeGreaterThan(0);
    const narrowed = await snapshot();
    await q(`DELETE FROM item_audiences`);
    let wide: Map<string, Set<string>>;
    try {
      wide = await snapshot();
    } finally {
      for (const a of saved) {
        await q(`INSERT INTO item_audiences (org_id, item_type, item_id, mode, set_by, set_at) VALUES ($1,$2,$3,$4,$5,$6)`, [
          a.org_id,
          a.item_type,
          a.item_id,
          a.mode,
          a.set_by,
          a.set_at,
        ]);
      }
      for (const x of people) await q(`INSERT INTO item_audience_people (item_type, item_id, user_id) VALUES ($1,$2,$3)`, [x.item_type, x.item_id, x.user_id]);
    }
    let lost = 0;
    for (const [key, rows] of narrowed) {
      const all = wide.get(key)!;
      expect([...rows].filter((r) => !all.has(r)), key).toEqual([]);
      lost += all.size - rows.size;
    }
    // And it did take something away: the left-out manager and consultant lost rows.
    expect(wide.get("nmgr:documents")!.size).toBeGreaterThan(narrowed.get("nmgr:documents")!.size);
    expect(wide.get("nmgr:meetings")!.size).toBeGreaterThan(narrowed.get("nmgr:meetings")!.size);
    expect(wide.get("cons2:documents")!.size).toBeGreaterThan(narrowed.get("cons2:documents")!.size);
    expect(lost).toBeGreaterThan(0);
  });

  it("nobody can write the audience tables except through app_set_audience()", async () => {
    await expect(rowsAs(U.cons, `DELETE FROM item_audiences`)).rejects.toThrow(/permission denied/);
    await expect(
      rowsAs(U.cons, `INSERT INTO item_audience_people (item_type, item_id, user_id) VALUES ('document', $1, $2)`, [DOC.open, U.nmgr]),
    ).rejects.toThrow(/permission denied/);
    // The audience rows are read only by the people who may change it.
    expect(await rowsAs(U.nmgr2, `SELECT * FROM item_audience_people`)).toEqual([]);
    expect((await rowsAs(U.cons, `SELECT user_id FROM item_audience_people WHERE item_id = $1 ORDER BY user_id`, [DOC.deliv])).map((r) => r.user_id)).toEqual(
      [U.cons2, U.nmgr].sort(),
    );
  });
});

// ------------------------------------------------------------------ left out
describe("a person left out sees nothing of the item", () => {
  it("the file is Not found by its address, through the API and as a download", async () => {
    for (const [who, docId] of [
      [U.nmgr, DOC.deliv],
      [U.nmgr, DOC.client],
      [U.cons2, DOC.deliv],
      [U.cons2, DOC.firmOnly],
      [U.nmgr, DOC.only],
      [U.cons2, DOC.only],
    ] as const) {
      await expect(svc(who, (tx, p) => D.createDownloadLink(tx, p, docId, null)), `${who} ${docId}`).rejects.toThrow(NOT_FOUND);
      expect(await svc(who, (tx, p) => D.loadDocument(tx, docId, p))).toBeNull();
      expect(await rowsAs(who, `SELECT title FROM documents WHERE id = $1`, [docId])).toEqual([]);
    }
    // The people who still see it: the uploader, the lead, the client's admin, a manager not left out.
    for (const who of [U.cons, U.lead, U.ncadmin, U.nmgr2, U.admin, U.deputy]) {
      expect((await svc(who, (tx, p) => D.createDownloadLink(tx, p, DOC.deliv, null))).url, who).toContain("storage.test");
    }
  });

  it("the meeting is Not found, with its calendar file, agenda and everything under it", async () => {
    for (const who of [U.nmgr, U.cons2]) {
      await expect(svc(who, (tx, p) => M.getMeeting(tx, p, MID))).rejects.toThrow(NOT_FOUND);
      await expect(svc(who, (tx, p) => M.meetingIcs(tx, p, MID))).rejects.toThrow(NOT_FOUND);
      expect(await rowsAs(who, `SELECT * FROM app_meeting_agenda_for($1)`, [MID])).toEqual([]);
      expect(await rowsAs(who, `SELECT app_can_see_meeting($1) AS ok, app_meeting_open_to_me($1) AS open`, [MID])).toEqual([{ ok: false, open: false }]);
      for (const t of ["meetings", "meeting_attendees", "meeting_decisions", "meeting_summaries", "meeting_summary_sources", "meeting_notes", "meeting_transcripts", "follow_ups"]) {
        const col = t === "meetings" ? "id" : "meeting_id";
        expect(await rowsAs(who, `SELECT 1 FROM ${t} WHERE ${col} = $1`, [MID]), `${who} ${t}`).toEqual([]);
      }
    }
    // A manager who is not left out opens it, sees the marker, and has no picker.
    const seen = await svc(U.nmgr2, (tx, p) => M.getMeeting(tx, p, MID));
    expect([seen.meeting.title, seen.limited, seen.canAudience]).toEqual(["Closed board session", true, false]);
    expect((await svc(U.lead, (tx, p) => M.getMeeting(tx, p, MID))).canAudience).toBe(true);
  });

  it("is left out of the Files card, the project's documents and meetings, the schedule and Today, with no count", async () => {
    const files = await svc(U.nmgr, (tx, p) => F.listFiles(tx, p));
    expect(files.map((f) => f.title)).not.toEqual(expect.arrayContaining([TITLE.deliv]));
    expect(JSON.stringify(files)).not.toMatch(/canary/);
    const project = await svc(U.nmgr, (tx, p) => getProject(tx, p, PN));
    expect(JSON.stringify(project.documents)).not.toMatch(/canary/);
    expect((await svc(U.nmgr, (tx, p) => M.listMeetings(tx, p, PN))).map((m) => m.title)).not.toContain("Closed board session");
    const items = await svc(U.nmgr, (tx, p) => M.schedule(tx, p, { from: hour(-24), to: hour(24 * 7) }));
    expect(JSON.stringify(items)).not.toMatch(/Closed board session|Follow-up canary/);
    // Today (the firm's home) lists the meetings one attends: not the one a consultant is left out of.
    expect(JSON.stringify(await svc(U.cons2, (tx, p) => today(tx, p)))).not.toMatch(/Closed board session/);
    expect(JSON.stringify(await svc(U.lead, (tx, p) => today(tx, p)))).toContain("Closed board session");
    // A count the left-out manager could read says nothing either.
    // (The open plan and the draft shared with the client: the three narrowed files are not counted.)
    expect(await rowsAs(U.nmgr, `SELECT count(*)::int AS n FROM documents WHERE project_id = $1 AND purpose <> 'evidence'`, [PN])).toEqual([{ n: 2 }]);
    // Those who still see the items get them, marked "Limited audience".
    const theirs = await svc(U.nmgr2, (tx, p) => F.listFiles(tx, p));
    expect(Object.fromEntries(theirs.map((f) => [f.title, f.limited]))).toMatchObject({ [TITLE.deliv]: true, [TITLE.client]: true, [TITLE.only]: true, [TITLE.open]: false });
    expect((await svc(U.nmgr2, (tx, p) => M.listMeetings(tx, p, PN))).map((m) => [m.title, m.limited])).toEqual([["Closed board session", true]]);
    expect(JSON.stringify(await svc(U.nmgr2, (tx, p) => M.schedule(tx, p, { from: hour(-24), to: hour(24 * 7) })))).toContain("Closed board session");
  });

  it("gets no notice about it: an old one is hidden, a new one is never stored", async () => {
    expect((await svc(U.nmgr, (tx, p) => listNotifications(tx, p))).items.map((n) => n.entityId)).not.toContain(DOC.deliv);
    expect(await rowsAs(U.nmgr, `SELECT 1 FROM notifications WHERE entity_id = $1`, [DOC.deliv])).toEqual([]);
    const count = async () => (await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [U.nmgr])).rows[0].n as number;
    const before = await count();
    await q(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'document.shared','document',$2), ($1,'meeting.changed','meeting',$3)`, [
      U.nmgr,
      DOC.deliv,
      MID,
    ]);
    expect(await count()).toBe(before);
    // Someone who still sees it is told as before.
    await q(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'meeting.changed','meeting',$2)`, [U.nmgr2, MID]);
    expect((await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND entity_id = $2`, [U.nmgr2, MID])).rows).toEqual([{ n: 1 }]);
  });

  it("the mail queue holds no invite for someone left out, and mail queued before she was left out is withdrawn", async () => {
    // Their invites, queued at booking, were withdrawn when they were left out; only the others' stay to send.
    const queued = (await q(`SELECT to_email FROM outbound_emails WHERE meeting_id = $1 AND withdrawn_at IS NULL`, [MID])).rows.map((r) => r.to_email);
    expect(queued).toContain(email(U.nmgr2));
    expect(queued).not.toContain(email(U.nmgr));
    expect(queued).not.toContain(email(U.cons2));
    // A second meeting, invited before the audience is set.
    const second = (
      await svc(
        U.lead,
        (tx, p) =>
          M.bookMeeting(tx, p, PN, {
            kind: "status",
            title: "Second session",
            startsAt: hour(48),
            endsAt: hour(49),
            location: "online",
            joinUrl: MEET,
            attendees: [{ userId: U.nmgr, optional: true }, { userId: U.nmgr2 }],
            sendInvites: true,
          }),
        true,
      )
    ).id;
    expect((await q(`SELECT to_email FROM outbound_emails WHERE meeting_id = $1`, [second])).rows.map((r) => r.to_email)).toContain(email(U.nmgr));
    await svc(U.lead, (tx, p) => M.setMeetingAudience(tx, p, second, { mode: "except", people: [U.nmgr] }), true);
    // Withdrawn, not deleted (the product owner's decision on the review, B2).
    const after = (await q(`SELECT to_email, withdrawn_at IS NOT NULL AS withdrawn FROM outbound_emails WHERE meeting_id = $1 ORDER BY to_email`, [second])).rows;
    expect(after).toEqual([
      { to_email: email(U.nmgr2), withdrawn: false },
      { to_email: email(U.nmgr), withdrawn: true },
    ]);
    await svc(U.lead, (tx, p) => M.sendInvites(tx, p, second), true);
    // Sending again queues nothing new for her.
    expect((await q(`SELECT count(*)::int AS n FROM outbound_emails WHERE meeting_id = $1 AND to_email = $2`, [second, email(U.nmgr)])).rows).toEqual([{ n: 1 }]);
  });

  // The product owner's decision on the review (B2): nothing is deleted. A queued invite to someone left
  // out is marked withdrawn and kept; the sender skips it, and checks again just before sending.
  describe("the mail queue keeps a withdrawn invite and never sends it", () => {
    const bookWith = (title: string, attendees: { userId: string; optional?: boolean }[], hours: number) =>
      svc(
        U.lead,
        (tx, p) =>
          M.bookMeeting(tx, p, PN, { kind: "status", title, startsAt: hour(hours), endsAt: hour(hours + 1), location: "online", joinUrl: MEET, attendees, sendInvites: true }),
        true,
      ).then((m) => m.id);
    const sent: OutgoingMail[] = [];
    const deliver = async (mail: OutgoingMail) => void sent.push(mail);
    const onlyThis = (mid: string) => q(`UPDATE outbound_emails SET sent_at = now() WHERE sent_at IS NULL AND meeting_id IS DISTINCT FROM $1`, [mid]);

    it("a queued invite is withdrawn, kept and not sent; the change is audited with the count", async () => {
      const mid = await bookWith("Withdrawn invite", [{ userId: U.nmgr, optional: true }, { userId: U.nmgr2 }], 96);
      await svc(U.lead, (tx, p) => M.setMeetingAudience(tx, p, mid, { mode: "except", people: [U.nmgr] }), true);
      const rows = (await q(`SELECT to_email, sent_at, withdrawn_at FROM outbound_emails WHERE meeting_id = $1 ORDER BY to_email`, [mid])).rows;
      expect(rows.map((r) => [r.to_email, r.sent_at === null, r.withdrawn_at !== null])).toEqual([
        [email(U.nmgr2), true, false],
        [email(U.nmgr), true, true],
      ]);
      const [entry] = (await q(`SELECT meta FROM audit_log WHERE action = 'meeting.audience' AND resource_id = $1`, [mid])).rows;
      expect(entry.meta.withdrawnMails).toBe(1);
      await onlyThis(mid);
      sent.length = 0;
      const result = await runMail(owner, deliver, "http://selah.test");
      expect(sent.map((m) => m.to)).toEqual([email(U.nmgr2)]);
      expect(result).toMatchObject({ sent: 1, failed: 0 });
      // Kept, still unsent and withdrawn; and it is not mail that "keeps failing".
      expect((await q(`SELECT count(*)::int AS n FROM outbound_emails WHERE meeting_id = $1 AND to_email = $2 AND sent_at IS NULL AND withdrawn_at IS NOT NULL`, [mid, email(U.nmgr)])).rows).toEqual([
        { n: 1 },
      ]);
      await q(`UPDATE outbound_emails SET created_at = now() - interval '2 hours', attempts = 3, last_error = 'x' WHERE meeting_id = $1 AND to_email = $2`, [mid, email(U.nmgr)]);
      expect((await ownerChecks(owner)).find((c) => c.name === "mail")).toMatchObject({ ok: true });
    });

    it("an invite the sender already picked up is not delivered to someone left out a moment before it goes", async () => {
      const mid = await bookWith("Picked-up invite", [{ userId: U.nmgr2 }], 120);
      // The organiser adds her later and sends the invites again: hers is queued after the others.
      await svc(U.lead, (tx, p) => M.addAttendee(tx, p, mid, { userId: U.nmgr, optional: true }), true);
      await svc(U.lead, (tx, p) => M.sendInvites(tx, p, mid), true);
      await onlyThis(mid);
      sent.length = 0;
      let leftOut = false;
      await runMail(owner, async (mail) => {
        // While the sender works through the batch it has claimed, the lead leaves her out.
        if (!leftOut) {
          leftOut = true;
          await svc(U.lead, (tx, p) => M.setMeetingAudience(tx, p, mid, { mode: "except", people: [U.nmgr] }), true);
        }
        sent.push(mail);
      }, "http://selah.test");
      expect(sent.map((m) => m.to)).not.toContain(email(U.nmgr));
      expect(sent.map((m) => m.to)).toContain(email(U.nmgr2));
      expect((await q(`SELECT sent_at, withdrawn_at FROM outbound_emails WHERE meeting_id = $1 AND to_email = $2`, [mid, email(U.nmgr)])).rows).toEqual([
        { sent_at: null, withdrawn_at: expect.any(Date) },
      ]);
    });
  });

  it("is not in the Excel exports", async () => {
    for (const make of [(tx: Tx, p: Principal) => planWorkbook(tx, p, PN, "en"), (tx: Tx, p: Principal) => actionsWorkbook(tx, p, "en")]) {
      const file = await svc(U.nmgr, make);
      expect(JSON.stringify(readXlsx(file.bytes).map((s) => s.rows))).not.toMatch(/canary|Closed board session/);
    }
  });

  it("is not on the activity record: the share of a file she is left out of does not reach her", async () => {
    const event = `SELECT 1 FROM activity_events WHERE entity_type = 'document' AND entity_id = $1 AND event = 'document_shared'`;
    expect(await rowsAs(U.cons2, event, [DOC.firmOnly])).toEqual([]);
    expect(await rowsAs(U.cons, event, [DOC.firmOnly])).toHaveLength(1);
    const shares = async (who: string) => ((await svc(who, (tx, p) => getProject(tx, p, PN))).activity ?? []).filter((e) => e.event === "document_shared");
    expect(await shares(U.cons2)).toEqual([]);
    expect(await shares(U.cons)).toHaveLength(1);
  });

  it("cannot get an export pack, which only admins make, and they always see the client's items", async () => {
    const p = await svc(U.nmgr, async (_tx, p) => p);
    expect(authorize(p, "organization.export", { type: "organization", orgId: NUKHBA, projectId: null }).allowed).toBe(false);
    // The client's admin always sees what the client can see, so the pack (read under her rules) holds every file.
    expect(await rowsAs(U.ncadmin, `SELECT count(*)::int AS n FROM documents WHERE id = ANY($1)`, [[DOC.deliv, DOC.client, DOC.only]])).toEqual([{ n: 3 }]);
  });

  it("the assistant's search never retrieves a passage of it, with the real scope or a forged one, and citations find nothing", async () => {
    const found = (uid: string, scope: RetrievalScope) => svc(uid, async (tx) => (await retrieve(tx, scope, QUERY, { query: "passage" })).map((r) => r.sourceId));
    const firm = (uid: string): RetrievalScope => ({ projectId: PN, orgId: NUKHBA, labels: ["shared", "firm_private", "client_private", "user_private"], userId: uid });
    const client = (uid: string): RetrievalScope => ({ projectId: PN, orgId: NUKHBA, labels: ["shared", "client_private"], userId: uid, client: true });
    expect((await found(U.cons2, firm(U.cons2))).sort()).toEqual([DOC.client, DOC.open].sort());
    expect((await found(U.nmgr, client(U.nmgr))).sort()).toEqual([DOC.open]);
    expect((await found(U.nmgr2, client(U.nmgr2))).sort()).toEqual([DOC.deliv, DOC.client, DOC.open].sort());
    // A scope naming someone else does not get past row-level security either.
    expect(await found(U.nmgr, client(U.nmgr2))).not.toContain(DOC.deliv);
    // Citations are looked up under her rules: no title comes back.
    expect(await rowsAs(U.nmgr, `SELECT id, title FROM documents WHERE id = ANY($1)`, [[DOC.deliv, DOC.client]])).toEqual([]);
    expect(await rowsAs(U.nmgr, `SELECT 1 FROM ai_chunks WHERE source_id = ANY($1)`, [[DOC.deliv, DOC.client]])).toEqual([]);
  });
});

// ------------------------------------------------------------------ refusals
describe("the server refuses", () => {
  const set = (who: string, docId: string, mode: "everyone" | "except" | "only", people: string[]) =>
    svc(who, (tx, p) => D.setDocumentAudience(tx, p, docId, { mode, people }));

  it("leaving out someone who always sees it: the setter, the uploader, the client's admin, the firm admin, the lead and deputy", async () => {
    for (const locked of [U.cons, U.ncadmin, U.admin, U.lead, U.deputy]) {
      await expect(set(U.cons, DOC.open, "except", [locked]), locked).rejects.toThrow(/always sees it/);
    }
    // A meeting's organiser and required attendees.
    for (const locked of [U.lead, U.nmgr2]) {
      await expect(svc(U.cons, (tx, p) => M.setMeetingAudience(tx, p, MID, { mode: "except", people: [locked] }))).rejects.toThrow(/always sees it/);
    }
  });

  it('an "only" list with nobody', async () => {
    await expect(set(U.cons, DOC.open, "only", [])).rejects.toThrow(/at least one person/);
    await expect(rowsAs(U.cons, `SELECT app_set_audience('document', $1, 'only', '{}')`, [DOC.open])).rejects.toThrow(/at least one person/);
  });

  it("a person who could not see the item: another client's admin, an action owner a file is not shared with", async () => {
    await expect(set(U.cons, DOC.open, "except", [U.other])).rejects.toThrow(/already see it/);
    await expect(set(U.cons, DOC.deliv, "only", [U.owner])).rejects.toThrow(/already see it/);
  });

  it("a client's admin leaving out the firm's people", async () => {
    await expect(set(U.ncadmin, DOC.client, "except", [U.cons])).rejects.toThrow(/your company/);
    await expect(set(U.ncadmin, DOC.client, "only", [U.nmgr2, U.cons])).rejects.toThrow(/your company/);
    // On her own item with "only", the firm's people still see it.
    await svc(U.ncadmin, (tx, p) => D.setDocumentAudience(tx, p, DOC.client, { mode: "only", people: [U.ncadmin, U.nmgr2] }), true);
    try {
      expect(await rowsAs(U.cons, `SELECT 1 FROM documents WHERE id = $1`, [DOC.client])).toHaveLength(1);
      expect(await rowsAs(U.nmgr, `SELECT 1 FROM documents WHERE id = $1`, [DOC.client])).toEqual([]);
    } finally {
      await svc(U.ncadmin, (tx, p) => D.setDocumentAudience(tx, p, DOC.client, { mode: "except", people: [U.nmgr] }), true);
    }
  });

  it("client managers and action owners, the other side, observers and evidence: no picker, Not found", async () => {
    for (const [who, docId] of [
      [U.nmgr2, DOC.client], // a manager, on the client's own file she uploaded
      [U.owner, DOC.open], // an owner the file is shared with
      [U.ncadmin, DOC.deliv], // the client's admin, on the firm's file
      [U.cons, DOC.client], // the firm, on the client's file
      [U.nmgr2, DOC.evid],
      [U.ncadmin, DOC.evid], // evidence never has one
    ] as const) {
      await expect(svc(who, (tx, p) => D.getDocumentAudience(tx, p, docId)), `${who} ${docId}`).rejects.toThrow(NOT_FOUND);
      await expect(set(who, docId, "except", [U.nmgr]), `${who} ${docId}`).rejects.toThrow(NOT_FOUND);
      await expect(rowsAs(who, `SELECT app_set_audience('document', $1, 'except', ARRAY[$2]::uuid[])`, [docId, U.nmgr])).rejects.toThrow(/not allowed/);
    }
    await expect(svc(U.nmgr2, (tx, p) => M.getMeetingAudience(tx, p, MID))).rejects.toThrow(NOT_FOUND);
  });

  it("booking a meeting that invites someone it leaves out in the same step", async () => {
    const booking = (audience: { mode: "except" | "only"; people: string[] }) =>
      svc(
        U.lead,
        (tx, p) =>
          M.bookMeeting(tx, p, PN, {
            kind: "status",
            title: "Refused booking",
            startsAt: hour(200),
            endsAt: hour(201),
            location: "online",
            joinUrl: MEET,
            attendees: [{ userId: U.nmgr, optional: true }, { userId: U.nmgr2 }],
            sendInvites: true,
            audience,
          }),
        true,
      );
    await expect(booking({ mode: "except", people: [U.nmgr] })).rejects.toThrow(/invited and left out/);
    await expect(booking({ mode: "only", people: [U.lead, U.nmgr2] })).rejects.toThrow(/invited and left out/);
    // Nothing was booked or queued.
    expect((await q(`SELECT count(*)::int AS n FROM meetings WHERE title = 'Refused booking'`)).rows).toEqual([{ n: 0 }]);
  });

  it("a share, an invitation or a follow-up to someone left out, and none of them lifts the exclusion", async () => {
    await expect(rowsAs(U.cons, `INSERT INTO document_shares (document_id, user_id, granted_by) VALUES ($1,$2,$3)`, [DOC.deliv, U.nmgr, U.cons])).rejects.toThrow(
      /left out of this file/,
    );
    await expect(
      rowsAs(U.cons, `INSERT INTO document_shares (document_id, user_id, granted_by) VALUES ($1,$2,$3)`, [DOC.only, U.nmgr, U.cons]),
    ).rejects.toThrow(/left out of this file/);
    // A meeting for some people only: inviting anyone else is refused.
    const third = (
      await svc(
        U.lead,
        (tx, p) =>
          M.bookMeeting(tx, p, PN, {
            kind: "steering",
            title: "Third session",
            startsAt: hour(72),
            endsAt: hour(73),
            location: "online",
            joinUrl: MEET,
            attendees: [{ userId: U.nmgr2 }],
            audience: { mode: "only", people: [U.lead, U.nmgr2] },
          }),
        true,
      )
    ).id;
    await expect(svc(U.lead, (tx, p) => M.addAttendee(tx, p, third, { userId: U.cons2 }))).rejects.toThrow(/left out of this meeting/);
    expect(await rowsAs(U.cons2, `SELECT 1 FROM meetings WHERE id = $1`, [third])).toEqual([]);
    await expect(
      rowsAs(U.lead, `INSERT INTO follow_ups (project_id, org_id, meeting_id, title, visibility, assignee_user_id, created_by) VALUES ($1,$2,$3,'x','shared',$4,$5)`, [
        PN,
        NUKHBA,
        MID,
        U.nmgr,
        U.lead,
      ]),
    ).rejects.toThrow(/left out of this meeting/);
    // Making an optional attendee who is left out required would let her in: refused too.
    await expect(rowsAs(U.lead, `UPDATE meeting_attendees SET role = 'required' WHERE meeting_id = $1 AND user_id = $2`, [MID, U.nmgr])).rejects.toThrow(
      /left out of this meeting/,
    );
    expect(await rowsAs(U.nmgr, `SELECT 1 FROM documents WHERE id = $1`, [DOC.deliv])).toEqual([]);
  });
});

// ------------------------------------------------------------------ re-saving
describe("an \"only\" list keeps the person who saved it", () => {
  it("X sets only [A]; Y saves it again unchanged; X still sees the item, as a chip Y could remove on purpose", async () => {
    const S1 = id(71);
    await doc(S1, { by: U.cons, ownerOrg: FIRM, title: "Only-list canary" });
    // X: a consultant on the project, not the uploader, the lead or the deputy.
    await svc(U.cons2, (tx, p) => D.setDocumentAudience(tx, p, S1, { mode: "only", people: [U.cons2, U.nmgr2] }), true);
    expect(await rowsAs(U.cons2, `SELECT 1 FROM documents WHERE id = $1`, [S1])).toHaveLength(1);
    // Y opens the picker: X is on the list as an ordinary chip, not hidden and not locked.
    const seen = await svc(U.admin, (tx, p) => D.getDocumentAudience(tx, p, S1));
    expect(seen.selected).toContain(U.cons2);
    expect(seen.people.find((x) => x.id === U.cons2)?.locked).toBeUndefined();
    // Y saves what the picker shows, unchanged.
    await svc(U.admin, (tx, p) => D.setDocumentAudience(tx, p, S1, { mode: "only", people: seen.selected }), true);
    expect(await rowsAs(U.cons2, `SELECT 1 FROM documents WHERE id = $1`, [S1])).toHaveLength(1);
    // X, editing it again, sees herself locked (she is the one saving).
    expect((await svc(U.cons2, (tx, p) => D.getDocumentAudience(tx, p, S1))).people.find((x) => x.id === U.cons2)?.locked).toBe("self");
    // The saver is never written onto a list of people left out.
    await svc(U.cons2, (tx, p) => D.setDocumentAudience(tx, p, S1, { mode: "except", people: [U.nmgr] }), true);
    expect((await q(`SELECT user_id FROM item_audience_people WHERE item_id = $1`, [S1])).rows.map((r) => r.user_id)).toEqual([U.nmgr]);
  });
});

// ------------------------------------------------------------------ copies
describe("a narrowed file is never copied out of its audience", () => {
  it("a file with a limited audience can't be used as evidence: the service and the database refuse it, and the one left out still sees nothing", async () => {
    const REC = id(61);
    const ACT = id(62);
    await q(`INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$2,$3,'Pay policy','shared',$4) ON CONFLICT DO NOTHING`, [
      REC,
      PN,
      NUKHBA,
      U.lead,
    ]);
    await q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Adopt the pay scales',$5,'in_progress',app_firm_today() + 10,$6) ON CONFLICT DO NOTHING`,
      [ACT, PN, NUKHBA, REC, U.nmgr2, U.lead],
    );
    // nmgr2 still sees the salary file (it is narrowed to leave out nmgr) and owns an open action.
    await expect(
      svc(U.nmgr2, (tx, p) => F.attachExistingEvidence(tx, p, ACT, { documentId: DOC.client, submitForReview: false }), true),
    ).rejects.toThrow(/limited audience/);
    // The database refuses the copy too, whoever writes it.
    await expect(
      rowsAs(
        U.nmgr2,
        `INSERT INTO documents (project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
         SELECT project_id, org_id, $2, $3, 'evidence', 'submitted', title, 'shared', 'k-copy', content_type, size_bytes, sha256, scan_status FROM documents WHERE id = $1`,
        [DOC.client, NUKHBA, U.nmgr2],
      ),
    ).rejects.toThrow(/limited audience/);
    expect(await rowsAs(U.nmgr, `SELECT id FROM documents WHERE title = $1`, [TITLE.client])).toEqual([]);
    // A file nobody narrowed is still used as before.
    await svc(U.nmgr2, (tx, p) => F.attachExistingEvidence(tx, p, ACT, { documentId: DOC.open, submitForReview: false }), true);
    expect(await rowsAs(U.nmgr, `SELECT purpose FROM documents WHERE title = $1 ORDER BY purpose`, [TITLE.open])).toEqual([
      { purpose: "deliverable" },
      { purpose: "evidence" },
    ]);
  });
});

// ------------------------------------------------------------------ later
describe("people who gain access later", () => {
  it('"except" lets in someone who joins later; "only" does not', async () => {
    expect(await rowsAs(U.later, `SELECT id FROM documents WHERE id = ANY($1)`, [[DOC.deliv, DOC.only]])).toEqual([]);
    await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PN, U.later]);
    expect((await rowsAs(U.later, `SELECT id FROM documents WHERE id = ANY($1)`, [[DOC.deliv, DOC.only]])).map((r) => r.id)).toEqual([DOC.deliv]);
    await expect(svc(U.later, (tx, p) => D.createDownloadLink(tx, p, DOC.only, null))).rejects.toThrow(NOT_FOUND);
  });

  it("a new deputy is never shut out of an \"only\" list saved before she was named", async () => {
    expect(await rowsAs(U.newDeputy, `SELECT 1 FROM documents WHERE id = $1`, [DOC.only])).toEqual([]);
    await q(`UPDATE client_assignments SET is_deputy = false WHERE client_org_id = $1 AND user_id = $2`, [NUKHBA, U.deputy]);
    await q(`UPDATE client_assignments SET is_deputy = true WHERE client_org_id = $1 AND user_id = $2`, [NUKHBA, U.newDeputy]);
    try {
      expect(await rowsAs(U.newDeputy, `SELECT title FROM documents WHERE id = $1`, [DOC.only])).toEqual([{ title: TITLE.only }]);
      // The list itself is unchanged (the person picked, and the consultant who saved it): she is let in live, not written onto it.
      expect((await q(`SELECT user_id FROM item_audience_people WHERE item_id = $1`, [DOC.only])).rows.map((r) => r.user_id).sort()).toEqual(
        [U.cons, U.nmgr2].sort(),
      );
      // The picker lists her as locked, as the deputy.
      const audience = await svc(U.cons, (tx, p) => D.getDocumentAudience(tx, p, DOC.only));
      expect(audience.people.find((x) => x.id === U.newDeputy)?.locked).toBe("deputy");
      expect(audience.mode).toBe("only");
    } finally {
      await q(`UPDATE client_assignments SET is_deputy = false WHERE client_org_id = $1 AND user_id = $2`, [NUKHBA, U.newDeputy]);
      await q(`UPDATE client_assignments SET is_deputy = true WHERE client_org_id = $1 AND user_id = $2`, [NUKHBA, U.deputy]);
    }
  });

  it("a new version of a file keeps its audience", async () => {
    const upload = { bytes: new TextEncoder().encode("v2"), fileName: "proposal v2.pdf", contentType: "application/pdf", sha256: "sha-v2", scanned: true, scanMs: 1 };
    const made = await svc(U.cons, (tx, p) => D.uploadNewVersion(tx, p, DOC.deliv, upload), true);
    expect(await rowsAs(U.nmgr, `SELECT 1 FROM documents WHERE id = $1`, [made.id])).toEqual([]);
    expect(await rowsAs(U.nmgr2, `SELECT 1 FROM documents WHERE id = $1`, [made.id])).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ the picker's list
describe("the people the picker offers", () => {
  it("are those who can already see the item, firm first, with the locked ones and why", async () => {
    const a = await svc(U.cons, (tx, p) => D.getDocumentAudience(tx, p, DOC.open));
    expect(a.owner).toBe("firm");
    const ids = a.people.map((x) => x.id);
    expect(ids).not.toContain(U.other);
    expect(ids).toContain(U.owner); // shared with her one by one
    expect(Object.fromEntries(a.people.filter((x) => x.locked).map((x) => [x.id, x.locked]))).toMatchObject({
      [U.cons]: "self",
      [U.admin]: "firmAdmin",
      [U.lead]: "lead",
      [U.deputy]: "deputy",
      [U.ncadmin]: "clientAdmin",
    });
    // On the client's own file, only the client's people.
    const c = await svc(U.ncadmin, (tx, p) => D.getDocumentAudience(tx, p, DOC.client));
    expect([c.owner, c.people.every((x) => x.side === "client"), c.mode, c.selected]).toEqual(["client", true, "except", [U.nmgr]]);
    // For a file not uploaded yet: worked out from what the form says.
    const fresh = await svc(U.ncadmin, (tx, p) =>
      import("@/services/audience").then((A) => A.newItemAudiencePeople(tx, p, PN, "document", { visibility: "shared", departmentId: DEPT })),
    );
    expect(fresh.people.map((x) => x.id).sort()).toEqual([U.ncadmin, U.nmgr, U.nmgr2, U.owner].sort());
    await expect(
      svc(U.nmgr2, (tx, p) => import("@/services/audience").then((A) => A.newItemAudiencePeople(tx, p, PN, "document", { visibility: "shared" }))),
    ).rejects.toThrow(NOT_FOUND);
  });
});

// ------------------------------------------------------------------ audit and notices
describe("changing who sees an item", () => {
  it("is audited, tells nobody left out, and opening it up again tells nobody either", async () => {
    const notices = async () => (await q(`SELECT count(*)::int AS n FROM notifications WHERE user_id = ANY($1)`, [[U.nmgr, U.cons2]])).rows[0].n as number;
    const mails = async () => (await q(`SELECT count(*)::int AS n FROM outbound_emails WHERE to_email = ANY($1)`, [[email(U.nmgr), email(U.cons2)]])).rows[0].n as number;
    const [n0, m0] = [await notices(), await mails()];
    await svc(U.cons, (tx, p) => D.setDocumentAudience(tx, p, DOC.open, { mode: "except", people: [U.nmgr] }), true);
    expect(await rowsAs(U.nmgr, `SELECT 1 FROM documents WHERE id = $1`, [DOC.open])).toEqual([]);
    await svc(U.cons, (tx, p) => D.setDocumentAudience(tx, p, DOC.open, { mode: "everyone", people: [] }), true);
    expect(await rowsAs(U.nmgr, `SELECT 1 FROM documents WHERE id = $1`, [DOC.open])).toHaveLength(1);
    await svc(U.lead, (tx, p) => M.setMeetingAudience(tx, p, MID, { mode: "everyone", people: [] }), true);
    await svc(U.lead, (tx, p) => M.setMeetingAudience(tx, p, MID, { mode: "except", people: [U.nmgr, U.cons2] }), true);
    expect([await notices(), await mails()]).toEqual([n0, m0]);
    const { rows } = await q(
      `SELECT action, resource_id, meta->>'from' AS "from", meta->>'to' AS "to" FROM audit_log WHERE action IN ('document.audience', 'meeting.audience') AND resource_id = ANY($1) ORDER BY created_at`,
      [[DOC.open, MID]],
    );
    expect(rows.filter((r) => r.resource_id === DOC.open).map((r) => [r.from, r.to])).toEqual([
      ["everyone", "except"],
      ["except", "everyone"],
    ]);
    expect(rows.filter((r) => r.action === "meeting.audience").length).toBeGreaterThanOrEqual(2);
    // Who was left out is not in the log's details: only how many.
    expect(JSON.stringify((await q(`SELECT meta FROM audit_log WHERE action = 'document.audience'`)).rows)).not.toContain(U.nmgr);
  });

  it("set while uploading; a refused audience stores no file", async () => {
    const upload = (name: string) => ({ bytes: new TextEncoder().encode(name), fileName: name, contentType: "application/pdf", sha256: `sha-${name}`, scanned: true, scanMs: 1 });
    const made = await svc(
      U.cons,
      (tx, p) => F.uploadProjectDocument(tx, p, PN, { file: upload("pay scales.pdf"), visibility: "shared", audience: { mode: "except", people: [U.nmgr] } }),
      true,
    );
    expect(await rowsAs(U.nmgr, `SELECT 1 FROM documents WHERE id = $1`, [made.id])).toEqual([]);
    expect(await rowsAs(U.nmgr2, `SELECT 1 FROM documents WHERE id = $1`, [made.id])).toHaveLength(1);
    await expect(
      svc(U.cons, (tx, p) => F.uploadProjectDocument(tx, p, PN, { file: upload("refused.pdf"), visibility: "shared", audience: { mode: "except", people: [U.lead] } }), true),
    ).rejects.toThrow(/always sees it/);
    expect((await q(`SELECT count(*)::int AS n FROM documents WHERE title = 'refused.pdf'`)).rows).toEqual([{ n: 0 }]);
  });
});
