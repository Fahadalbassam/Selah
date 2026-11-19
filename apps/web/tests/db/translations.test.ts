// On-demand translations (baseline: Translations) against a real Postgres:
// readable and makeable only with the source, retired when the source
// changes, reviewed by firm staff only, capped per person. The model is
// faked; no AI is called.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { createMasker } from "@/lib/masking";
import { loadPrincipal } from "@/services/principal";

const fake = vi.hoisted(() => ({ calls: 0, fail: false, echo: false, sent: "" }));
vi.mock("@/services/ai-client", () => ({
  // The AI service says its model is local (masking.ts asks it): names go out unmasked unless a test sets AI_MASKING=on.
  modelIsLocal: async () => true,
  translateText: async (text: string, source: string, target: string) => {
    if (fake.fail) throw new Error("down");
    fake.calls++;
    fake.sent = text;
    // A hosted model keeps the placeholders it is given.
    if (fake.echo) return { text: `ترجمة: ${text}`, model: "fake-hosted" };
    return { text: `[${source}->${target}] ${text.length}`, model: "fake-model" };
  },
}));
const T = await import("@/services/translations");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f500-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const PROJ = id(4);
const BETA_PROJ = id(5);
const REC = id(6);
const ACTION = id(7);
const UPDATE = id(8);
const U = { admin: id(11), cons: id(12), other: id(13), cmgr: id(14), betaMgr: id(15) };
const RATIONALE = "يحتاج المجلس إلى ميثاق عائلي مكتوب.";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>, commit = true): Promise<T> {
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
const insertAs = (userId: string, fields: Partial<Record<string, string>> = {}) =>
  sqlAs(
    userId,
    `INSERT INTO content_translations (project_id, org_id, entity_type, entity_id, field, source_lang, target_lang, source_sha256, text, model, created_by)
     VALUES ($1,$2,'recommendation',$3,'rationale','ar','en',$4,'The board needs a written family charter.','m',$5) RETURNING id`,
    [fields.project ?? PROJ, fields.org ?? ACME, fields.entity ?? REC, fields.hash ?? sha(RATIONALE), fields.by ?? userId],
  );
const visible = async (userId: string) => (await sqlAs(userId, `SELECT id, text, reviewed_by FROM content_translations`)).rows;

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$6,'firm_admin'), ($2,$6,'consultant'), ($3,$6,'consultant'), ($4,$7,'client_manager'), ($5,$8,'client_manager')`,
    [U.admin, U.cons, U.other, U.cmgr, U.betaMgr, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [PROJ, BETA_PROJ, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($4,$5)`, [
    PROJ,
    U.cons,
    U.cmgr,
    BETA_PROJ,
    U.betaMgr,
  ]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, rationale, created_by) VALUES ($1,$2,$3,'Charter',$4,$5)`,
    [REC, PROJ, ACME, RATIONALE, U.cons],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Draft the charter',$5,'in_progress','2099-01-01',$6)`,
    [ACTION, PROJ, ACME, REC, U.cmgr, U.cons],
  );
  await q(
    `INSERT INTO progress_updates (id, project_id, org_id, action_id, author_id, body, source) VALUES ($1,$2,$3,$4,$5,'تم إعداد المسودة الأولى.','client_portal')`,
    [UPDATE, PROJ, ACME, ACTION, U.cmgr],
  );
});

beforeEach(async () => {
  await owner.query(`TRUNCATE content_translations`);
  await owner.query(`UPDATE recommendations SET rationale = $1, title = 'Charter' WHERE id = $2`, [RATIONALE, REC]);
  fake.calls = 0;
  fake.fail = false;
  fake.echo = false;
  fake.sent = "";
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("translations in the database", () => {
  it("are made and read by people who can read the source, and nobody else", async () => {
    await insertAs(U.cmgr);
    expect(await visible(U.cmgr)).toHaveLength(1);
    expect(await visible(U.cons)).toHaveLength(1);
    expect(await visible(U.admin)).toHaveLength(1);
    expect(await visible(U.other)).toHaveLength(0); // a consultant not on the project
    expect(await visible(U.betaMgr)).toHaveLength(0); // another client
    await expect(insertAs(U.betaMgr)).rejects.toThrow(/row-level security/);
    await expect(insertAs(U.other)).rejects.toThrow(/row-level security/);
  });

  it("must match the source's current text, project and author", async () => {
    await expect(insertAs(U.cons, { hash: sha("something else") })).rejects.toThrow(/row-level security/);
    await expect(insertAs(U.cons, { project: BETA_PROJ, org: BETA })).rejects.toThrow(/row-level security|violates foreign key/);
    await expect(insertAs(U.cons, { by: U.cmgr })).rejects.toThrow(/row-level security/);
    await expect(
      sqlAs(U.cons, `SELECT * FROM app_translation_source('recommendation', $1, 'created_by')`, [REC]),
    ).rejects.toThrow(/cannot be translated/);
  });

  it("are deleted when their field changes, and kept when another field changes", async () => {
    await insertAs(U.cons);
    await owner.query(`UPDATE recommendations SET title = 'Family charter' WHERE id = $1`, [REC]);
    expect(await visible(U.cons)).toHaveLength(1);
    await owner.query(`UPDATE recommendations SET rationale = 'تغيّر النص.' WHERE id = $1`, [REC]);
    expect((await owner.query(`SELECT count(*)::int AS n FROM content_translations`)).rows[0].n).toBe(0);
  });

  it("go when the source row is deleted", async () => {
    await owner.query(
      `INSERT INTO findings (id, project_id, org_id, title, description, created_by) VALUES ($1,$2,$3,'Gap','وصف',$4)`,
      [id(30), PROJ, ACME, U.cons],
    );
    await sqlAs(
      U.cons,
      `INSERT INTO content_translations (project_id, org_id, entity_type, entity_id, field, source_lang, target_lang, source_sha256, text, model, created_by)
       VALUES ($1,$2,'finding',$3,'description','ar','en',$4,'Description','m',$5)`,
      [PROJ, ACME, id(30), sha("وصف"), U.cons],
    );
    await owner.query(`DELETE FROM findings WHERE id = $1`, [id(30)]);
    expect((await owner.query(`SELECT count(*)::int AS n FROM content_translations`)).rows[0].n).toBe(0);
  });

  it("are reviewed by firm staff only, who may correct the text but nothing else", async () => {
    const [{ id: tid }] = (await insertAs(U.cmgr)).rows;
    const upd = await sqlAs(U.cmgr, `UPDATE content_translations SET text = 'x', reviewed_at = now() WHERE id = $1`, [tid]);
    expect(upd.rowCount).toBe(0);
    await expect(
      sqlAs(U.cons, `UPDATE content_translations SET field = 'title', reviewed_at = now() WHERE id = $1`, [tid]),
    ).rejects.toThrow(/only the text/);
    await sqlAs(
      U.cons,
      `UPDATE content_translations SET text = 'The board needs a family charter in writing.', reviewed_at = now() WHERE id = $1`,
      [tid],
    );
    const [row] = (await owner.query(`SELECT text, reviewed_by, reviewed_at FROM content_translations`)).rows;
    expect(row.text).toBe("The board needs a family charter in writing.");
    expect(row.reviewed_by).toBe(U.cons);
    expect(row.reviewed_at).not.toBeNull();
    await expect(sqlAs(U.cons, `DELETE FROM content_translations WHERE id = $1`, [tid])).rejects.toThrow(/permission denied/);
  });

  it("are capped at 200 new ones per person an hour", async () => {
    await owner.query(
      `INSERT INTO content_translations (project_id, org_id, entity_type, entity_id, field, source_lang, target_lang, source_sha256, text, model, created_by)
       SELECT $1, $2, 'action', gen_random_uuid(), 'title', 'en', 'ar', $3, 't', 'm', $4 FROM generate_series(1, 200)`,
      [PROJ, ACME, sha("x"), U.cons],
    );
    await expect(insertAs(U.cons)).rejects.toThrow(/too many translations/);
    await insertAs(U.cmgr);
  });
});

describe("the translation service", () => {
  it("asks the model once, then serves the kept translation to everyone who can read it", async () => {
    const r = { entityType: "recommendation", entityId: REC, field: "rationale", to: "en" as const };
    const first = await svc(U.cmgr, (tx, p) => T.translate(tx, p, r));
    expect(first).toMatchObject({ sourceLang: "ar", original: false, reviewed: false, text: `[ar->en] ${RATIONALE.length}` });
    const again = await svc(U.cons, (tx, p) => T.translate(tx, p, r));
    expect(again.id).toBe(first.id);
    expect(fake.calls).toBe(1);
    // Asked in the language it was written in: the original, no model call.
    const same = await svc(U.cons, (tx, p) => T.translate(tx, p, { ...r, to: "ar" }));
    expect(same).toMatchObject({ original: true, text: RATIONALE });
    expect(fake.calls).toBe(1);
  });

  it("makes a new one after the source is edited", async () => {
    await owner.query(`UPDATE actions SET description = 'مسودة أولى.' WHERE id = $1`, [ACTION]);
    const r = { entityType: "action", entityId: ACTION, field: "description", to: "en" as const };
    await svc(U.cmgr, (tx, p) => T.translate(tx, p, r));
    await owner.query(`UPDATE actions SET description = 'مسودة ثانية أطول.' WHERE id = $1`, [ACTION]);
    const next = await svc(U.cmgr, (tx, p) => T.translate(tx, p, r));
    expect(next.text).toBe(`[ar->en] ${"مسودة ثانية أطول.".length}`);
    expect(fake.calls).toBe(2);
  });

  it("translates a progress update, which is never edited", async () => {
    const r = { entityType: "progress_update", entityId: UPDATE, field: "body", to: "en" as const };
    expect((await svc(U.cons, (tx, p) => T.translate(tx, p, r))).original).toBe(false);
  });

  it("answers not found for text the person can't read, and unavailable when the model is down", async () => {
    const r = { entityType: "recommendation", entityId: REC, field: "rationale", to: "en" as const };
    await expect(svc(U.betaMgr, (tx, p) => T.translate(tx, p, r))).rejects.toThrow(/not found/);
    await expect(svc(U.cons, (tx, p) => T.translate(tx, p, { ...r, field: "created_by" }))).rejects.toThrow(
      /cannot be translated/,
    );
    fake.fail = true;
    await expect(svc(U.cons, (tx, p) => T.translate(tx, p, r))).rejects.toThrow(/not available/);
  });

  it("lets firm staff mark a translation reviewed, and not the client", async () => {
    const r = { entityType: "recommendation", entityId: REC, field: "rationale", to: "en" as const };
    const made = await svc(U.cmgr, (tx, p) => T.translate(tx, p, r));
    await expect(svc(U.cmgr, (tx, p) => T.reviewTranslation(tx, p, made.id!, {}))).rejects.toThrow(/not found/);
    await svc(U.cons, (tx, p) => T.reviewTranslation(tx, p, made.id!, {}));
    expect((await svc(U.cmgr, (tx, p) => T.translate(tx, p, r))).reviewed).toBe(true);
  });
});

// With a hosted model the names in the text become placeholders first. The
// list of a project's names is not for action owners (app_mask_terms); a
// translation asks only for the names written in its own text
// (app_mask_terms_in), so owners keep it (docs/translations.md).
describe("masking a translation for a hosted model", () => {
  const OWNER = id(16);
  const MATE = id(17);
  const OWN_ACTION = id(9);
  const TITLE = "Noura Al-Qahtani sends the charter to the Acme board";
  let before: string | undefined;

  beforeAll(async () => {
    await owner.query(`INSERT INTO "user" (id, name, name_alt, email) VALUES ($1,'Noura Al-Qahtani','نورة القحطاني','noura@example.test'), ($2,'Faisal Al-Shammari','فيصل الشمري','faisal@example.test')`, [OWNER, MATE]);
    await owner.query(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$3,'action_owner'), ($2,$3,'action_owner')`, [OWNER, MATE, ACME]);
    await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [PROJ, OWNER, MATE]);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'in_progress','2099-01-01',$7)`,
      [OWN_ACTION, PROJ, ACME, REC, TITLE, OWNER, U.cons],
    );
    before = process.env.AI_MASKING;
    process.env.AI_MASKING = "on";
  });
  afterAll(() => {
    if (before === undefined) delete process.env.AI_MASKING;
    else process.env.AI_MASKING = before;
  });

  it("works for an action owner: the model gets placeholders, she gets the names back", async () => {
    fake.echo = true;
    const r = { entityType: "action", entityId: OWN_ACTION, field: "title", to: "ar" as const };
    const made = await svc(OWNER, (tx, p) => T.translate(tx, p, r));
    expect(fake.calls).toBe(1);
    expect(fake.sent).toMatch(/\[PERSON_1\].*\[ORG_1\]/);
    expect(fake.sent).not.toMatch(/Noura|Qahtani|Acme/);
    expect(made.text).toBe(`ترجمة: ${TITLE}`);
  });

  it("gives back only names written in the text, and the full list stays refused to owners", async () => {
    const found = await sqlAs(OWNER, `SELECT kind, term, grp FROM app_mask_terms_in($1, $2)`, [PROJ, TITLE]);
    const terms = found.rows.map((x: { term: string }) => x.term);
    expect(terms).toEqual(expect.arrayContaining(["Noura Al-Qahtani", "Acme"]));
    for (const t of terms) expect(TITLE.toLowerCase()).toContain(t.toLowerCase());
    // No record id: a number shared by the names of one person.
    expect(found.rows.every((x: { grp: unknown }) => typeof x.grp === "number")).toBe(true);
    // The list does hold names absent from the text; she never receives them.
    const all = (await sqlAs(U.cmgr, `SELECT term FROM app_mask_terms($1)`, [PROJ])).rows.map((x: { term: string }) => x.term);
    expect(all).toEqual(expect.arrayContaining(["Faisal Al-Shammari", "فيصل الشمري", "cmgr"]));
    expect(terms).not.toContain("Faisal Al-Shammari");
    await expect(sqlAs(OWNER, `SELECT * FROM app_mask_terms($1)`, [PROJ])).rejects.toThrow(/action owners/);
    // Another client's project gives nothing back, whatever the text.
    expect((await sqlAs(OWNER, `SELECT * FROM app_mask_terms_in($1, 'Beta strategy, betaMgr')`, [BETA_PROJ])).rowCount).toBe(0);
  });

  it("finds a name in the spellings the masker treats as one", async () => {
    const text = "سلّمت نورة القحطاني المسودة، وراجعها NOURA el qahtani وفريق ACME.";
    const terms = (await sqlAs(OWNER, `SELECT term FROM app_mask_terms_in($1, $2)`, [PROJ, text])).rows.map((x: { term: string }) => x.term);
    expect(terms).toEqual(expect.arrayContaining(["نورة القحطاني", "Noura Al-Qahtani", "Acme"]));
    expect(terms).not.toContain("Faisal Al-Shammari");
    // A name inside a longer word is not one (Latin names need whole words).
    expect((await sqlAs(OWNER, `SELECT term FROM app_mask_terms_in($1, 'Acmeworks and Nouras')`, [PROJ])).rowCount).toBe(0);
  });

  it("masks a text as the whole list would", async () => {
    const texts = [
      TITLE,
      "سلّمت نورة القحطاني المسودة، وراجعها NOURA el qahtani وفريق ACME.",
      "وللقحطاني رأي، ونُورَة توافق.",
      "Noura Al‑Qahtani and NouraAlQahtani; Al Qahtani's note to noura.alqahtani@example.test",
      "فيصل الشمري و Faisal Al-Shammari، cmgr and cons: الشمري.",
      "Acmeworks and Nouras",
    ];
    const all = (await sqlAs(U.cmgr, `SELECT kind, term, entity FROM app_mask_terms($1)`, [PROJ])).rows;
    for (const [i, text] of texts.entries()) {
      const some = (await sqlAs(U.cmgr, `SELECT kind, term, grp FROM app_mask_terms_in($1, $2)`, [PROJ, text])).rows;
      const subset = createMasker(some.map((r: { kind: string; term: string; grp: number }) => ({ ...r, entity: String(r.grp) })), { places: true });
      const whole = createMasker(all, { places: true }).mask(text);
      expect(subset.mask(text)).toBe(whole);
      // Every text but the last has names to mask.
      expect(whole === text).toBe(i === texts.length - 1);
    }
  });
});
