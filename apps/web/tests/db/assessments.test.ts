// Assessment templates and assessments (migrations 0028-0029) against a real
// Postgres, through the services and, where the database is the last line,
// with direct SQL: authors, stable published versions, tenant isolation,
// the basis per legal form, scoring and conditions, evidence, gaps becoming
// findings, and follow-up that keeps reported, evidenced and verified apart.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Tx } from "@/db/client";
import type { Principal } from "@/authz";
import * as A from "@/services/assessments";
import { createAction, createRecommendation } from "@/services/plan";
import { loadPrincipal } from "@/services/principal";
import { STARTER_TEMPLATE } from "@/services/assessment-starter";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a400-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // llc
const LISTED = id(3); // listed_jsc
const NOFORM = id(4); // legal form not recorded
const FIRM2 = id(5); // another firm
const U = {
  admin: id(11),
  author: id(12),
  cons: id(13), // staffed, not an author
  outsider: id(14), // consultant on no project
  cadmin: id(15),
  cmgr: id(16),
  cowner: id(17),
  other: id(18), // manager of another client
  admin2: id(19), // admin of another firm
};
const P = { acme: id(21), listed: id(22), noform: id(23), internal: id(24) };
const DOC = { acme: id(31), listed: id(32), private: id(33), firm: id(34) };

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

/** Run a service as a user; committed unless `dry`. */
async function svc<T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>, dry = false): Promise<T> {
  return as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      const p = await loadPrincipal(tx, userId);
      // Drizzle wraps database errors; keep the database's message visible.
      return fn(tx, p!).catch((e: Error & { cause?: Error }) => {
        throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
      });
    },
    !dry,
  );
}
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const commitAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params), true);

let starter: { id: string; versionId: string };
/** The starter template's question id by its ref, in a version. */
async function qid(versionId: string, ref: string) {
  return (await owner.query(`SELECT id FROM template_questions WHERE version_id = $1 AND ref = $2`, [versionId, ref])).rows[0]
    .id as string;
}
async function answerOf(assessmentId: string, ref: string) {
  return (
    await owner.query(
      `SELECT x.id, x.basis FROM assessment_answers x JOIN template_questions q ON q.id = x.question_id WHERE x.assessment_id = $1 AND q.ref = $2`,
      [assessmentId, ref],
    )
  ).rows[0] as { id: string; basis: string };
}
const answer = (assessmentId: string, ref: string, value: string | null, extra: Record<string, string> = {}) =>
  answerOf(assessmentId, ref).then((x) => svc(U.cons, (tx, p) => A.answerQuestion(tx, p, x.id, { value, ...extra })));

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations, audit_log CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, legal_form) VALUES
      ($1,'firm','firm',NULL,NULL), ($2,'client','Acme','full','llc'), ($3,'client','Listed Co','full','listed_jsc'),
      ($4,'client','Unknown form','full',NULL), ($5,'firm','Other firm',NULL,NULL)`,
    [FIRM, ACME, LISTED, NOFORM, FIRM2],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$9,'firm_admin'), ($2,$9,'consultant'), ($3,$9,'consultant'), ($4,$9,'consultant'),
      ($5,$10,'client_admin'), ($6,$10,'client_manager'), ($7,$10,'action_owner'), ($8,$11,'client_manager')`,
    [U.admin, U.author, U.cons, U.outsider, U.cadmin, U.cmgr, U.cowner, U.other, FIRM, ACME, LISTED],
  );
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'firm_admin')`, [U.admin2, FIRM2]);
  for (const [org, pid] of [
    [ACME, P.acme],
    [LISTED, P.listed],
    [NOFORM, P.noform],
  ]) {
    await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [org, U.author]);
    await q(
      `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Work','active',$4)`,
      [pid, org, FIRM, U.admin],
    );
    await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [pid, U.cons]);
  }
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'internal',$2,$2,'Ours','active',$3)`,
    [P.internal, FIRM, U.admin],
  );
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [P.acme, U.cmgr, U.cowner]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P.listed, U.other]);
  for (const [doc, pid, org, vis] of [
    [DOC.acme, P.acme, ACME, "shared"],
    [DOC.listed, P.listed, LISTED, "shared"],
    [DOC.private, P.acme, ACME, "client_private"],
    [DOC.firm, P.acme, ACME, "firm_private"],
  ]) {
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$4,$5,'client_document','submitted','charter.pdf',$6,$7,'application/pdf',1,'x','clean')`,
      [doc, pid, org, vis === "client_private" ? org : FIRM, vis === "client_private" ? U.cadmin : U.cons, vis, `k-${doc}`],
    );
  }
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("authors", () => {
  it("are the firm admin and the consultants the admin names", async () => {
    await expect(svc(U.author, (tx, p) => A.createTemplate(tx, p, { name: "Mine" }), true)).rejects.toThrow(/not_found|template/);
    await expect(svc(U.cons, (tx, p) => A.addTemplateAuthor(tx, p, U.author))).rejects.toThrow(/forbidden/);
    await expect(svc(U.admin, (tx, p) => A.addTemplateAuthor(tx, p, U.cadmin))).rejects.toThrow(/active consultants of the firm/);
    await svc(U.admin, (tx, p) => A.addTemplateAuthor(tx, p, U.author));
    // Directly, too: a consultant cannot name themselves.
    await expect(
      commitAs(U.cons, `INSERT INTO template_authors (firm_org_id, user_id, granted_by) VALUES ($1,$2,$2)`, [FIRM, U.cons]),
    ).rejects.toThrow(/row-level security/);
    const authors = await svc(U.cons, (tx, p) => A.listTemplateAuthors(tx, p));
    expect(authors.map((a) => a.userId)).toEqual([U.author]);
    const logged = await owner.query(`SELECT action FROM audit_log WHERE action LIKE 'template_author.%'`);
    expect(logged.rows.map((r) => r.action)).toEqual(["template_author.add"]);
  });
});

describe("the starter template", () => {
  it("installs as an editable draft with honest provenance, and publishes", async () => {
    starter = await svc(U.author, (tx, p) => A.installStarterTemplate(tx, p));
    const v = await svc(U.cons, (tx, p) => A.getTemplateVersion(tx, p, starter.versionId));
    expect(v.status).toBe("draft");
    expect(v.sections.map((s) => s.titleAr)).toEqual(STARTER_TEMPLATE.sections.map((s) => s.titleAr));
    const questions = v.sections.flatMap((s) => s.questions);
    expect(questions).toHaveLength(28);
    // Every question names its source and where in it, in both languages.
    for (const q of questions) {
      expect(q.citation, q.ref!).toBeTruthy();
      expect(q.locator, q.ref!).toBeTruthy();
      expect(q.promptAr, q.ref!).toBeTruthy();
    }
    // Nothing is a legal requirement by default, and no text claims compliance.
    expect(questions.filter((q) => q.basis === "legal_requirement")).toEqual([]);
    const all = JSON.stringify(STARTER_TEMPLATE);
    expect(all).not.toMatch(/non-compliant|required by law|\bmust\b/i);
    expect(questions.filter((q) => q.legalFor?.includes("listed_jsc")).map((q) => q.ref)).toEqual(["3.2", "6.4"]);
    // Citations not yet checked against the source say so.
    expect(questions.filter((q) => !q.citationVerified).map((q) => q.ref)).toEqual([
      "2.1",
      "2.2",
      "2.3",
      "2.4",
      "3.3",
      "3.4",
      "6.4",
      "7.3",
      "7.4",
    ]);
    await svc(U.author, (tx, p) => A.publishVersion(tx, p, starter.versionId));
    const logged = await owner.query(`SELECT meta FROM audit_log WHERE action = 'template.publish'`);
    expect(logged.rows[0].meta).toEqual({ template_id: starter.id, version: 1 });
  });
});

describe("published versions", () => {
  it("never change, even directly as an author; edits go to a new draft", async () => {
    const q11 = await qid(starter.versionId, "1.1");
    await expect(svc(U.author, (tx, p) => A.updateQuestion(tx, p, q11, { prompt: "Changed" }))).rejects.toThrow(
      /published version/,
    );
    await expect(commitAs(U.author, `UPDATE template_questions SET prompt = 'Changed' WHERE id = $1`, [q11])).rejects.toThrow(
      /published version cannot be changed/,
    );
    await expect(commitAs(U.author, `DELETE FROM template_sections WHERE version_id = $1`, [starter.versionId])).rejects.toThrow(
      /published version cannot be changed/,
    );
    await expect(commitAs(U.author, `DELETE FROM template_versions WHERE id = $1`, [starter.versionId])).rejects.toThrow(
      /is kept/,
    );
    await expect(
      commitAs(U.author, `UPDATE template_versions SET status = 'draft' WHERE id = $1`, [starter.versionId]),
    ).rejects.toThrow(/published version cannot be changed/);

    const { draftVersionId } = await svc(U.author, (tx, p) => A.startDraft(tx, p, starter.id));
    // One draft at a time: asking again returns it.
    expect(await svc(U.author, (tx, p) => A.startDraft(tx, p, starter.id))).toEqual({ draftVersionId, existing: true });
    const draft = await svc(U.author, (tx, p) => A.getTemplateVersion(tx, p, draftVersionId));
    expect([draft.version, draft.status]).toEqual([2, "draft"]);
    const copied = draft.sections.flatMap((s) => s.questions);
    expect(copied).toHaveLength(28);
    // Conditions point at the copies, not the originals.
    const c32 = copied.find((q) => q.ref === "3.2")!;
    expect(c32.appliesIfQuestionId).toBe(copied.find((q) => q.ref === "3.1")!.id);
    await svc(U.author, (tx, p) =>
      A.updateQuestion(tx, p, copied.find((q) => q.ref === "1.1")!.id, { prompt: "Is the structure approved?" }),
    );
    expect((await owner.query(`SELECT prompt FROM template_questions WHERE id = $1`, [q11])).rows[0].prompt).toBe(
      "Is there an approved organisational structure?",
    );
    // A draft with an empty section cannot be published; discarding it leaves v1 as it was.
    await svc(U.author, (tx, p) => A.addSection(tx, p, draftVersionId, { position: 9, title: "Empty" }));
    await expect(svc(U.author, (tx, p) => A.publishVersion(tx, p, draftVersionId))).rejects.toThrow(/every section/);
    await svc(U.author, (tx, p) => A.discardDraft(tx, p, draftVersionId));
    expect(
      (await owner.query(`SELECT count(*)::int AS n FROM template_questions WHERE version_id = $1`, [draftVersionId])).rows[0].n,
    ).toBe(0);
    expect(
      (await owner.query(`SELECT count(*)::int AS n FROM template_questions WHERE version_id = $1`, [starter.versionId])).rows[0]
        .n,
    ).toBe(28);
  });

  it("are duplicated into a new template's draft, and archived templates are kept off new assessments", async () => {
    const dup = await svc(U.author, (tx, p) => A.duplicateTemplate(tx, p, starter.id, { name: "Copy" }));
    const v = await svc(U.author, (tx, p) => A.getTemplateVersion(tx, p, dup.draftVersionId));
    expect([v.template.name, v.version, v.sections.flatMap((s) => s.questions).length]).toEqual(["Copy", 1, 28]);
    await svc(U.author, (tx, p) => A.publishVersion(tx, p, dup.draftVersionId));
    await svc(U.author, (tx, p) => A.updateTemplate(tx, p, dup.id, { archived: true }));
    await expect(
      svc(U.cons, (tx, p) => A.createAssessment(tx, p, P.acme, { templateId: dup.id, title: "x" }), true),
    ).rejects.toThrow(/archived/);
    const listed = await svc(U.cons, (tx, p) => A.listTemplates(tx, p));
    expect(listed.templates.map((t) => t.name)).toEqual([STARTER_TEMPLATE.name]);
    expect(listed.canAuthor).toBe(false);
    const all = await svc(U.admin, (tx, p) => A.listTemplates(tx, p, { includeArchived: true }));
    expect(all.templates.map((t) => t.name).sort()).toEqual(["Copy", STARTER_TEMPLATE.name].sort());
  });

  it("check a question's shape: options, conditions and scoring", async () => {
    const { id: tid, draftVersionId: vid } = await svc(U.author, (tx, p) => A.createTemplate(tx, p, { name: "Shapes" }));
    const { id: sid } = await svc(U.author, (tx, p) => A.addSection(tx, p, vid, { position: 1, title: "S" }));
    const base = { sectionId: sid, position: 1, prompt: "Q", weight: 1, basis: "team_proposed" as const };
    await expect(svc(U.author, (tx, p) => A.addQuestion(tx, p, vid, { ...base, type: "multiple_choice" }))).rejects.toThrow(
      /list options/,
    );
    await expect(
      svc(U.author, (tx, p) =>
        A.addQuestion(tx, p, vid, {
          ...base,
          type: "multiple_choice",
          options: [
            { value: "a", label: "A", points: 1 },
            { value: "a", label: "B", points: 2 },
          ],
        }),
      ),
    ).rejects.toThrow(/its own value/);
    await expect(svc(U.author, (tx, p) => A.addQuestion(tx, p, vid, { ...base, type: "text", weight: 2 }))).rejects.toThrow(
      /not scored/,
    );
    await expect(
      svc(U.author, (tx, p) => A.addQuestion(tx, p, vid, { ...base, type: "yes_no", basis: "good_practice" })),
    ).rejects.toThrow(/name the source/);
    // Only legal forms make a criterion binding or guidance: never a question's own basis, even directly.
    await expect(
      svc(U.author, (tx, p) =>
        A.addQuestion(tx, p, vid, { ...base, type: "yes_no", basis: "legal_requirement" as never, citation: "x", locator: "y" }),
      ),
    ).rejects.toThrow(/own_basis/);
    await expect(
      commitAs(
        U.author,
        `INSERT INTO template_questions (version_id, section_id, firm_org_id, position, prompt, type, basis, citation, locator)
         VALUES ($1,$2,$3,9,'Q','yes_no','regulator_guidance','x','y')`,
        [vid, sid, FIRM],
      ),
    ).rejects.toThrow(/own_basis/);
    await expect(
      commitAs(
        U.author,
        `INSERT INTO template_questions (version_id, section_id, firm_org_id, position, prompt, type, basis, legal_for)
         VALUES ($1,$2,$3,9,'Q','yes_no','firm_method','{listed_jsc}')`,
        [vid, sid, FIRM],
      ),
    ).rejects.toThrow(/sourced/);
    const { id: parent } = await svc(U.author, (tx, p) => A.addQuestion(tx, p, vid, { ...base, type: "yes_no" }));
    await expect(
      svc(U.author, (tx, p) =>
        A.addQuestion(tx, p, vid, {
          ...base,
          position: 2,
          type: "yes_no",
          appliesIfQuestionId: parent,
          appliesIfValues: ["maybe"],
        }),
      ),
    ).rejects.toThrow(/does not have/);
    // A condition on another version's question is refused.
    await expect(
      svc(U.author, async (tx, p) =>
        A.addQuestion(tx, p, vid, {
          ...base,
          position: 2,
          type: "yes_no",
          appliesIfQuestionId: await qid(starter.versionId, "1.1"),
          appliesIfValues: ["yes"],
        }),
      ),
    ).rejects.toThrow(/same version/);
    await svc(U.author, (tx, p) => A.updateTemplate(tx, p, tid, { archived: true }));
  });
});

describe("tenant isolation", () => {
  it("clients never read templates; consultants not on a project never reach its assessments", async () => {
    for (const uid of [U.cadmin, U.cmgr, U.cowner]) {
      const seen = await sqlAs(
        uid,
        `SELECT (SELECT count(*) FROM assessment_templates)::int AS t, (SELECT count(*) FROM template_questions)::int AS q`,
      );
      expect(seen.rows[0]).toEqual({ t: 0, q: 0 });
      await expect(svc(uid, (tx, p) => A.listTemplates(tx, p), true)).rejects.toThrow(/forbidden/);
    }
    await expect(
      commitAs(U.cadmin, `INSERT INTO assessment_templates (firm_org_id, name, created_by) VALUES ($1,'x',$2)`, [FIRM, U.cadmin]),
    ).rejects.toThrow(/row-level security/);
    // Another firm's admin sees none of this firm's templates, and cannot reach them by id.
    const theirs = await sqlAs(
      U.admin2,
      `SELECT (SELECT count(*) FROM assessment_templates)::int AS t, (SELECT count(*) FROM template_questions)::int AS q`,
    );
    expect(theirs.rows[0]).toEqual({ t: 0, q: 0 });
    await expect(svc(U.admin2, (tx, p) => A.getTemplateVersion(tx, p, starter.versionId), true)).rejects.toThrow(/not found/);
    await expect(svc(U.admin2, (tx, p) => A.startDraft(tx, p, starter.id), true)).rejects.toThrow(/not found/);
    await expect(sqlAs(U.admin2, `SELECT app_copy_template_version($1, $2)`, [starter.versionId, starter.id])).rejects.toThrow(
      /not found/,
    );
    await expect(
      svc(U.outsider, (tx, p) => A.createAssessment(tx, p, P.acme, { templateId: starter.id, title: "x" }), true),
    ).rejects.toThrow(/not_found|project/);
  });
});

let acme: string; // the llc's assessment
let listed: string; // the listed company's

describe("assessments", () => {
  it("need a client project and the client's legal form, and take the basis from it", async () => {
    await expect(
      svc(U.admin, (tx, p) => A.createAssessment(tx, p, P.internal, { templateId: starter.id, title: "x" }), true),
    ).rejects.toThrow(/client projects/);
    await expect(
      svc(U.cons, (tx, p) => A.createAssessment(tx, p, P.noform, { templateId: starter.id, title: "x" }), true),
    ).rejects.toThrow(/legal form first/);
    // Only the firm admin records it.
    await expect(svc(U.cons, (tx, p) => A.setLegalForm(tx, p, NOFORM, "closed_jsc"), true)).rejects.toThrow(/forbidden/);
    await svc(U.admin, (tx, p) => A.setLegalForm(tx, p, NOFORM, "closed_jsc"));
    const closed = await svc(U.cons, (tx, p) =>
      A.createAssessment(tx, p, P.noform, { templateId: starter.id, title: "Baseline" }),
    );
    expect((await answerOf(closed.id, "3.4")).basis).toBe("regulator_guidance");

    acme = (await svc(U.cons, (tx, p) => A.createAssessment(tx, p, P.acme, { templateId: starter.id, title: "Baseline 2026" })))
      .id;
    listed = (
      await svc(U.cons, (tx, p) => A.createAssessment(tx, p, P.listed, { templateId: starter.id, title: "Baseline 2026" }))
    ).id;
    const bases = async (aid: string) =>
      Promise.all(["3.2", "6.4", "7.4", "3.4", "1.1"].map(async (r) => (await answerOf(aid, r)).basis));
    expect(await bases(acme)).toEqual(["good_practice", "good_practice", "good_practice", "good_practice", "firm_method"]);
    expect(await bases(listed)).toEqual([
      "legal_requirement",
      "legal_requirement",
      "good_practice", // 7.4 waits for the CMA article to be checked
      "good_practice",
      "firm_method",
    ]);
    // A later change of legal form leaves the assessment as it was made.
    await svc(U.admin, (tx, p) => A.setLegalForm(tx, p, LISTED, "llc"));
    expect((await answerOf(listed, "3.2")).basis).toBe("legal_requirement");
    expect((await owner.query(`SELECT legal_form FROM assessments WHERE id = $1`, [listed])).rows[0].legal_form).toBe(
      "listed_jsc",
    );
    await expect(commitAs(U.cons, `UPDATE assessments SET legal_form = 'llc' WHERE id = $1`, [listed])).rejects.toThrow(
      /keeps its project/,
    );
  });

  it("score yes/partly/no, ratings and choices, skip questions whose condition is not met, and show gaps", async () => {
    await answer(acme, "1.1", "yes");
    await answer(acme, "1.2", "partly");
    await answer(acme, "1.3", "no");
    await expect(answer(acme, "1.1", "4")).rejects.toThrow(/not an answer/);
    await expect(answer(acme, "1.1", "yes", { textAnswer: "x" })).rejects.toThrow(/only text questions/);
    await answer(acme, "2.2", "informal"); // 1 of 3
    await answer(acme, "3.1", "none"); // 3.2 and 3.4 then do not apply
    await answer(acme, "4.1", "no"); // 4.2 and 4.3 then do not apply
    await answer(acme, "6.3", "3"); // 2 of 3
    const a = await svc(U.cons, (tx, p) => A.getAssessment(tx, p, acme));
    const s1 = a.sections[0]!;
    expect([s1.earned, s1.possible, s1.pct, s1.gaps]).toEqual([3, 6, 50, 2]);
    const qs = a.sections.flatMap((s) => s.questions);
    const by = (ref: string) => qs.find((q) => q.ref === ref)!;
    expect([by("1.1").points, by("1.1").isGap, by("1.2").isGap, by("1.3").isGap]).toEqual([2, false, true, true]);
    expect([by("2.2").points, by("2.2").maxPoints, by("2.2").isGap]).toEqual([1, 3, true]);
    expect([by("6.3").points, by("6.3").maxPoints, by("6.3").isGap]).toEqual([2, 3, false]);
    expect([by("3.2").applicable, by("3.4").applicable, by("4.2").applicable, by("4.3").applicable]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(by("3.2").basisLabel.en).toBe("Good practice (voluntary)");
    // "Not applicable" is left out of the score.
    await answer(acme, "5.1", "na");
    expect((await svc(U.cons, (tx, p) => A.getAssessment(tx, p, acme))).sections[4]!.possible).toBe(0);
  });

  it("are finalised once every applicable question is answered, and are then kept as they are", async () => {
    await expect(svc(U.cons, (tx, p) => A.finaliseAssessment(tx, p, acme))).rejects.toThrow(/answer every question/);
    const left = (await svc(U.cons, (tx, p) => A.getAssessment(tx, p, acme))).sections
      .flatMap((s) => s.questions)
      .filter((q) => q.applicable && q.answer.value === null);
    expect(left.map((q) => q.ref)).toEqual([
      "2.1",
      "2.3",
      "2.4",
      "2.5",
      "3.3",
      "5.2",
      "6.1",
      "6.2",
      "6.4",
      "7.1",
      "7.2",
      "7.3",
      "7.4",
      "8.1",
      "8.2",
      "8.3",
    ]);
    for (const q of left) await answer(acme, q.ref!, q.type === "multiple_choice" ? q.options![0]!.value : "no");
    await svc(U.cons, (tx, p) => A.addAnswerEvidence(tx, p, left[0]!.answer.id, DOC.acme));
    await svc(U.cons, (tx, p) => A.addAnswerEvidence(tx, p, left[0]!.answer.id, DOC.firm));
    await svc(U.cons, (tx, p) => A.setFirmNote(tx, p, left[0]!.answer.id, "the founder resisted this"));
    await expect(svc(U.cons, (tx, p) => A.addAnswerEvidence(tx, p, left[0]!.answer.id, DOC.listed))).rejects.toThrow(
      /this project/,
    );
    await expect(
      commitAs(
        U.cons,
        `INSERT INTO assessment_evidence (answer_id, document_id, project_id, org_id, added_by) VALUES ($1,$2,$3,$4,$5)`,
        [left[0]!.answer.id, DOC.private, P.acme, ACME, U.cons],
      ),
    ).rejects.toThrow(/the firm can see/);
    const { total } = await svc(U.cons, (tx, p) => A.finaliseAssessment(tx, p, acme));
    expect(total.toAnswer).toBe(0);
    expect(total.gaps).toBeGreaterThan(10);
    await expect(answer(acme, "1.1", "no")).rejects.toThrow(/kept as it was/);
    await expect(
      commitAs(U.cons, `UPDATE assessment_answers SET value = 'yes' WHERE id = $1`, [left[0]!.answer.id]),
    ).rejects.toThrow(/kept as it was/);
    await expect(commitAs(U.cons, `UPDATE assessments SET status = 'draft' WHERE id = $1`, [acme])).rejects.toThrow(
      /kept as it was/,
    );
    await expect(svc(U.cons, (tx, p) => A.removeAnswerEvidence(tx, p, left[0]!.answer.id, DOC.acme))).rejects.toThrow(
      /kept as it was/,
    );
  });

  it("are shown to the client's admins and managers on the project only once final and shared", async () => {
    const visible = async (uid: string) =>
      (await sqlAs(uid, `SELECT count(*)::int AS n FROM assessment_answers WHERE assessment_id = $1`, [acme])).rows[0].n;
    expect(await visible(U.cmgr)).toBe(0);
    await svc(U.cons, (tx, p) => A.shareAssessment(tx, p, acme, true));
    expect(await visible(U.cmgr)).toBe(28);
    expect(await visible(U.cadmin)).toBe(28);
    expect(await visible(U.cowner)).toBe(0); // action owners are not shown assessments
    expect(await visible(U.other)).toBe(0); // another client
    const seen = await svc(U.cmgr, (tx, p) => A.getAssessment(tx, p, acme));
    expect(seen.canConduct).toBe(false);
    expect(seen.sections.flatMap((s) => s.questions)).toHaveLength(28);
    // The firm's notes and firm-private files stay with the firm.
    const q = seen.sections.flatMap((s) => s.questions).find((x) => x.ref === "2.1")!;
    expect(q.answer).not.toHaveProperty("firmNote");
    expect(q.evidence.map((e) => e.documentId)).toEqual([DOC.acme]);
    const hidden = await sqlAs(
      U.cmgr,
      `SELECT (SELECT count(*) FROM assessment_notes)::int AS notes, (SELECT count(*) FROM assessment_evidence)::int AS evidence`,
    );
    expect(hidden.rows[0]).toEqual({ notes: 0, evidence: 1 });
    const firmView = await svc(U.cons, (tx, p) => A.getAssessment(tx, p, acme));
    const fq = firmView.sections.flatMap((s) => s.questions).find((x) => x.ref === "2.1")!;
    expect([fq.answer.firmNote, fq.evidence.length]).toEqual(["the founder resisted this", 2]);
    // The client sees the questions of this version, and nothing else of the firm's.
    const t = await sqlAs(
      U.cmgr,
      `SELECT (SELECT count(*) FROM template_versions)::int AS v, (SELECT count(*) FROM assessment_templates)::int AS t`,
    );
    expect(t.rows[0]).toEqual({ v: 1, t: 1 });
    const a11 = (await answerOf(acme, "1.1")).id;
    await expect(svc(U.cmgr, (tx, p) => A.answerQuestion(tx, p, a11, { comment: "x" }))).rejects.toThrow(/forbidden/);
    // A draft assessment cannot be shared.
    await expect(svc(U.cons, (tx, p) => A.shareAssessment(tx, p, listed, true))).rejects.toThrow(/once it is final/);
    await svc(U.cons, (tx, p) => A.shareAssessment(tx, p, acme, false));
    expect(await visible(U.cmgr)).toBe(0);
  });
});

describe("from gap to verified work", () => {
  it("a consultant confirms a gap as a finding; non-gaps, drafts and duplicates are refused", async () => {
    const gap = await answerOf(acme, "1.3");
    const fine = await answerOf(acme, "1.1");
    const draftAnswer = (await answerOf(listed, "1.1")).id;
    await expect(svc(U.cons, (tx, p) => A.confirmGap(tx, p, draftAnswer, { title: "x", visibility: "shared" }))).rejects.toThrow(
      /finalise/,
    );
    await expect(svc(U.cons, (tx, p) => A.confirmGap(tx, p, fine.id, { title: "x", visibility: "shared" }))).rejects.toThrow(
      /not a gap/,
    );
    const f = await svc(U.cons, (tx, p) =>
      A.confirmGap(tx, p, gap.id, { title: "No one owns governance", visibility: "shared" }),
    );
    await expect(svc(U.cons, (tx, p) => A.confirmGap(tx, p, gap.id, { title: "again", visibility: "shared" }))).rejects.toThrow(
      /already/,
    );
    // Directly: a finding in another project cannot point at this answer.
    await expect(
      commitAs(
        U.cons,
        `INSERT INTO findings (project_id, org_id, title, assessment_answer_id, created_by) VALUES ($1,$2,'x',$3,$4)`,
        [P.listed, LISTED, gap.id, U.cons],
      ),
    ).rejects.toThrow(/not in this project/);
    await expect(commitAs(U.cons, `UPDATE findings SET assessment_answer_id = NULL WHERE id = $1`, [f.id])).rejects.toThrow(
      /keeps the answer/,
    );

    // From here the existing recommendations and actions carry it.
    const rec = await svc(U.cons, (tx, p) =>
      createRecommendation(tx, p, P.acme, {
        title: "Name a governance officer",
        findingId: f.id,
        priority: "high",
        source: "consultant",
        visibility: "shared",
      }),
    );
    const act = await svc(U.cons, (tx, p) =>
      createAction(tx, p, rec.id, { title: "Appoint and announce", ownerUserId: U.cowner, dueDate: "2026-12-31", release: true }),
    );
    const followUp = () => svc(U.cons, (tx, p) => A.assessmentFollowUp(tx, p, acme));
    expect(await followUp()).toEqual([
      expect.objectContaining({
        ref: "1.3",
        findingId: f.id,
        recommendations: 1,
        actions: 1,
        reported: 0,
        evidenced: 0,
        verified: 0,
      }),
    ]);
    // The owner reports it done with evidence: reported and evidenced, not verified.
    await owner.query(`UPDATE actions SET status = 'in_progress' WHERE id = $1`, [act.id]);
    await commitAs(
      U.cowner,
      `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`,
      [P.acme, ACME, act.id, DOC.acme, U.cowner],
    );
    await commitAs(U.cowner, `UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [act.id]);
    expect((await followUp())[0]).toMatchObject({ reported: 1, evidenced: 1, verified: 0 });
    const metrics = async () =>
      (await sqlAs(U.cons, `SELECT verified, verified_client_evidence FROM v_project_metrics WHERE project_id = $1`, [P.acme]))
        .rows[0];
    expect(Number((await metrics()).verified)).toBe(0);
    // A consultant's review verifies it.
    await commitAs(
      U.cons,
      `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`,
      [P.acme, ACME, act.id, U.cons],
    );
    await commitAs(U.cons, `UPDATE actions SET status = 'verified_complete' WHERE id = $1`, [act.id]);
    expect((await followUp())[0]).toMatchObject({
      reported: 0,
      evidenced: 1,
      verified: 1,
      verifiedClientEvidence: 1,
      verifiedConsultantRecorded: 0,
    });
    expect(await metrics()).toMatchObject({ verified: 1, verified_client_evidence: 1 });
    const reviewer = await owner.query(`SELECT reviewer_id, outcome, created_at FROM reviews WHERE action_id = $1`, [act.id]);
    expect(reviewer.rows[0]).toMatchObject({ reviewer_id: U.cons, outcome: "accept" });

    // The trace runs from the assessment to the review.
    const trace = await sqlAs(U.cons, `SELECT node_type, parent_type, parent_id FROM app_trace($1)`, [P.acme]);
    expect(trace.rows).toEqual(
      expect.arrayContaining([
        { node_type: "assessment", parent_type: null, parent_id: null },
        { node_type: "finding", parent_type: "assessment", parent_id: acme },
        { node_type: "recommendation", parent_type: "finding", parent_id: f.id },
        { node_type: "action", parent_type: "recommendation", parent_id: rec.id },
        { node_type: "review", parent_type: "action", parent_id: act.id },
      ]),
    );
  });

  it("direct recommendations still work without any assessment", async () => {
    const rec = await svc(U.cons, (tx, p) =>
      createRecommendation(tx, p, P.listed, {
        title: "Board decision",
        priority: "medium",
        source: "board_decision",
        decidedOn: "2026-10-01",
        visibility: "shared",
      }),
    );
    const act = await svc(U.cons, (tx, p) => createAction(tx, p, rec.id, { title: "Carry it out", release: false }));
    const trace = await sqlAs(U.cons, `SELECT node_type, parent_type FROM app_trace($1) WHERE node_id IN ($2, $3)`, [
      P.listed,
      rec.id,
      act.id,
    ]);
    expect(trace.rows).toEqual(
      expect.arrayContaining([
        { node_type: "recommendation", parent_type: null },
        { node_type: "action", parent_type: "recommendation" },
      ]),
    );
    expect(await svc(U.cons, (tx, p) => A.assessmentFollowUp(tx, p, listed))).toEqual([]);
  });

  it("reports freeze the scores and the follow-up, without calling anything compliant", async () => {
    await expect(
      svc(U.cons, (tx, p) =>
        A.assessmentReport(tx, p, listed, { title: "x", periodStart: "2026-10-01", periodEnd: "2026-10-31", lang: "en" }),
      ),
    ).rejects.toThrow(/finalise/);
    const r = await svc(U.cons, (tx, p) =>
      A.assessmentReport(tx, p, acme, { title: "October", periodStart: "2026-10-01", periodEnd: "2026-10-31", lang: "en" }),
    );
    const body = (await owner.query(`SELECT body_md, visibility FROM reports WHERE id = $1`, [r.id])).rows[0];
    expect(body.body_md).toMatch(/not a certification of legal compliance/);
    expect(body.body_md).toMatch(/\| 1\.3 No one owns governance \| 1 \| 0 \| 1 \| 1 \|/);
    expect(body.body_md).not.toMatch(/non-compliant/i);
  });
});

describe("minimal records", () => {
  it("purge written answers and comments after handover, keeping the answers themselves", async () => {
    const MIN = id(6);
    const PMIN = id(25);
    await owner.query(
      `INSERT INTO organizations (id, kind, name, engagement_mode, minimal_records, display_alias, legal_form)
       VALUES ($1,'client','x','consultant_managed',true,'Client M','llc')`,
      [MIN],
    );
    await owner.query(
      `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Work','active',$4)`,
      [PMIN, MIN, FIRM, U.admin],
    );
    await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PMIN, U.cons]);
    const { id: aid } = await svc(U.cons, (tx, p) =>
      A.createAssessment(tx, p, PMIN, { templateId: starter.id, title: "Baseline" }),
    );
    await answer(aid, "1.1", "partly", { comment: "the founder decides alone" });
    await owner.query(`UPDATE projects SET handover_on = '2026-01-01' WHERE id = $1`, [PMIN]);
    await owner.query(`SELECT app_purge_minimal_records('2026-06-01')`);
    const x = (
      await owner.query(`SELECT value, comment FROM assessment_answers WHERE id = $1`, [(await answerOf(aid, "1.1")).id])
    ).rows[0];
    expect(x).toEqual({ value: "partly", comment: "—" });
  });
});

describe("retake and compare", () => {
  it("retakes a final assessment on the same template and shows what changed, section by section", async () => {
    await expect(svc(U.cons, (tx, p) => A.retakeAssessment(tx, p, listed), true)).rejects.toThrow(/finalise/);
    const { id: again } = await svc(U.cons, (tx, p) => A.retakeAssessment(tx, p, acme, { title: "Follow-up 2027" }));
    const before = (await owner.query(`SELECT value FROM assessment_answers WHERE id = $1`, [(await answerOf(acme, "1.1")).id]))
      .rows[0].value as string;
    await answer(again, "1.1", before === "yes" ? "no" : "yes");

    // Either order: the earlier one comes first.
    const out = await svc(U.cons, (tx, p) => A.compareAssessments(tx, p, again, acme), true);
    expect(out.earlier.id).toBe(acme);
    expect(out.later).toMatchObject({ id: again, title: "Follow-up 2027", status: "draft" });
    expect(out.sections).toHaveLength(STARTER_TEMPLATE.sections.length);
    const first = out.sections[0]!;
    expect(first.changes).toEqual([
      expect.objectContaining({ ref: "1.1", change: "answer", before: expect.objectContaining({ value: before }) }),
    ]);
    expect(first.changes[0]!.after!.value).toBe(before === "yes" ? "no" : "yes");
    // Section and total points add up from the same per-question points as the assessment.
    expect(out.earlier.earned).toBe(out.sections.reduce((n, s) => n + s.before.earned, 0));
    const scored = await svc(U.cons, (tx, p) => A.getAssessment(tx, p, acme), true);
    expect(out.earlier.earned).toBe(scored.total.earned);
    expect(out.earlier.possible).toBe(scored.total.possible);
  });

  it("only compares the same client on the same template, and only what the caller can read", async () => {
    const again = (await owner.query(`SELECT id FROM assessments WHERE title = 'Follow-up 2027'`)).rows[0].id as string;
    await expect(svc(U.cons, (tx, p) => A.compareAssessments(tx, p, acme, listed), true)).rejects.toThrow(/same client/);
    await expect(svc(U.cons, (tx, p) => A.compareAssessments(tx, p, acme, acme), true)).rejects.toThrow(/two different/);
    // The retake is still a draft: the client can't read it, so can't compare with it.
    await expect(svc(U.cmgr, (tx, p) => A.compareAssessments(tx, p, acme, again), true)).rejects.toThrow(/not found/);
    await expect(svc(U.outsider, (tx, p) => A.compareAssessments(tx, p, acme, again), true)).rejects.toThrow(/not found/);
    await expect(sqlAs(U.cmgr, `SELECT * FROM app_assessment_compare($1, $2)`, [acme, again])).rejects.toThrow(/not found/);
  });

  it("matches questions by a reference that names one question in its version", async () => {
    await as(U.author, async (c) => {
      const draft = (await c.query(`SELECT app_copy_template_version($1, $2) AS id`, [starter.versionId, starter.id])).rows[0].id;
      await expect(
        c.query(`UPDATE template_questions SET ref = ' 1.1 ' WHERE version_id = $1 AND ref = '1.2'`, [draft]),
      ).rejects.toThrow(/template_questions_ref_once/);
    });
  });
});
