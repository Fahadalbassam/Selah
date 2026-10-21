// Meeting transcripts (migrations 0035-0036) against a real Postgres:
// consent and held status before import, firm-only, never changed, deleted
// on withdrawn consent and on schedule, logged without the text.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { getMeeting, importTranscript } from "@/services/meetings";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f600-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const PROJ = id(3);
const MEETING = id(4);
const U = { admin: id(11), cons: id(12), other: id(13), cmgr: id(14) };
const TEXT = "Sara: The board meets quarterly.\nKhalid: Agreed.";

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>): Promise<R> {
  return as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    const p = await loadPrincipal(tx, userId);
    return fn(tx, p!).catch((e: Error & { cause?: Error }) => {
      throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
    });
  });
}
const put = (userId: string, body = TEXT) =>
  sqlAs(
    userId,
    `INSERT INTO meeting_transcripts (meeting_id, project_id, org_id, lang, format, body, imported_by, delete_after)
     VALUES ($1,$2,$3,'en','text',$4,$5,'1970-01-01') RETURNING delete_after`,
    [MEETING, PROJ, ACME, body, userId],
  );
const kept = async () => (await owner.query(`SELECT meeting_id, delete_after, imported_by FROM meeting_transcripts`)).rows;
const today = async () => (await owner.query(`SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date AS d`)).rows[0].d as Date;
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$5,'firm_admin'), ($2,$5,'consultant'), ($3,$5,'consultant'), ($4,$6,'client_manager')`,
    [U.admin, U.cons, U.other, U.cmgr, FIRM, ACME],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`,
    [PROJ, ACME, FIRM, U.admin],
  );
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [PROJ, U.cons, U.cmgr]);
});

beforeEach(async () => {
  await owner.query(`DELETE FROM meetings`);
  await owner.query(`TRUNCATE audit_log`);
  await sqlAs(
    U.cons,
    `INSERT INTO meetings (id, project_id, org_id, kind, title, starts_at, ends_at, location, join_url, organizer_id, ics_uid)
     VALUES ($1,$2,$3,'status','Monthly status', now() - interval '2 hours', now() - interval '1 hour','online',
             'https://meet.google.com/abc-defg-hij',$4,'x')`,
    [MEETING, PROJ, ACME, U.cons],
  );
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

const held = () => sqlAs(U.cons, `UPDATE meetings SET status = 'held' WHERE id = $1`, [MEETING]);
const consent = (on: boolean) => sqlAs(U.cons, `UPDATE meetings SET transcript_consent = $2 WHERE id = $1`, [MEETING, on]);

describe("meeting transcripts", () => {
  it("need recorded consent and a held meeting", async () => {
    await held();
    await expect(put(U.cons)).rejects.toThrow(/participants were told/);
    // A new meeting with consent, still scheduled.
    await owner.query(`DELETE FROM meetings`);
    await sqlAs(
      U.cons,
      `INSERT INTO meetings (id, project_id, org_id, kind, title, starts_at, ends_at, location, join_url, organizer_id, ics_uid, transcript_consent)
       VALUES ($1,$2,$3,'status','Monthly status', now(), now() + interval '1 hour','online','https://meet.google.com/abc-defg-hij',$4,'x',true)`,
      [MEETING, PROJ, ACME, U.cons],
    );
    await expect(put(U.cons)).rejects.toThrow(/held meeting/);
    await held();
    const [row] = (await put(U.cons)).rows;
    expect(iso(row.delete_after)).toBe(plusDays(await today(), 90));
  });

  it("are the firm's: the client and consultants off the project can neither see nor add one", async () => {
    await consent(true);
    await held();
    await expect(put(U.cmgr)).rejects.toThrow(/row-level security/);
    await expect(put(U.other)).rejects.toThrow(/row-level security/);
    await put(U.cons);
    expect((await sqlAs(U.cmgr, `SELECT * FROM meeting_transcripts`)).rows).toHaveLength(0);
    expect((await sqlAs(U.other, `SELECT * FROM meeting_transcripts`)).rows).toHaveLength(0);
    expect((await sqlAs(U.admin, `SELECT * FROM meeting_transcripts`)).rows).toHaveLength(1);
    // Never changed, only replaced.
    await expect(sqlAs(U.cons, `UPDATE meeting_transcripts SET body = 'x'`)).rejects.toThrow(/permission denied/);
  });

  it("are kept the firm's days once the summary is confirmed", async () => {
    await consent(true);
    await held();
    await put(U.cons);
    await sqlAs(
      U.cons,
      `INSERT INTO meeting_summaries (meeting_id, project_id, org_id, lang, main_points_md, confirmed_by) VALUES ($1,$2,$3,'en','Points',$4)`,
      [MEETING, PROJ, ACME, U.cons],
    );
    expect(iso((await kept())[0].delete_after)).toBe(plusDays(await today(), 30));
  });

  it("go at once when consent is withdrawn, and on schedule by the daily job", async () => {
    await consent(true);
    await held();
    await put(U.cons);
    await consent(false);
    expect(await kept()).toHaveLength(0);

    await consent(true);
    await put(U.cons);
    expect(await owner.query(`SELECT app_purge_transcripts($1::date) AS n`, [plusDays(await today(), 89)])).toMatchObject({
      rows: [{ n: 0 }],
    });
    expect(await owner.query(`SELECT app_purge_transcripts($1::date) AS n`, [plusDays(await today(), 90)])).toMatchObject({
      rows: [{ n: 1 }],
    });
    expect(await kept()).toHaveLength(0);
    await expect(sqlAs(U.admin, `SELECT app_purge_transcripts(now()::date)`)).rejects.toThrow(/permission denied/);
  });

  it("are logged on import and deletion without their text", async () => {
    await consent(true);
    await held();
    await put(U.cons);
    await sqlAs(U.cons, `DELETE FROM meeting_transcripts`);
    const log = (
      await owner.query(
        `SELECT actor_id, action, meta FROM audit_log WHERE action LIKE 'meeting.transcript%' ORDER BY created_at`,
      )
    ).rows;
    expect(log.map((l) => [l.actor_id, l.action])).toEqual([
      [U.cons, "meeting.transcript_import"],
      [U.cons, "meeting.transcript_delete"],
    ]);
    expect(log[0].meta).toEqual({ lang: "en", format: "text", chars: TEXT.length, by_job: false });
  });

  it("are imported through the service from a caption file, and shown to the firm only", async () => {
    await consent(true);
    await held();
    const vtt =
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Sara>Hello.</v>\n\n00:00:02.000 --> 00:00:03.000\n<v Sara>Shall we start?</v>\n";
    const out = await svc(U.cons, (tx, p) => importTranscript(tx, p, MEETING, { text: vtt, format: "vtt", lang: "en" }));
    expect(out.chars).toBe("Sara: Hello. Shall we start?".length);
    expect((await owner.query(`SELECT body FROM meeting_transcripts`)).rows[0].body).toBe("Sara: Hello. Shall we start?");
    expect((await svc(U.cons, (tx, p) => getMeeting(tx, p, MEETING))).transcript).toMatchObject({
      format: "vtt",
      importedBy: "cons",
    });
    expect((await svc(U.cmgr, (tx, p) => getMeeting(tx, p, MEETING))).transcript).toBeNull();
    await expect(
      svc(U.cmgr, (tx, p) => importTranscript(tx, p, MEETING, { text: "x", format: "text", lang: "en" })),
    ).rejects.toThrow(/not found/);
  });
});
