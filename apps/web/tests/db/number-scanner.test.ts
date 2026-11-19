// The number scanner end to end (section 7 item 6), against a real Postgres:
// personal numbers planted in a file, a record, a blocked reason, a progress
// update and the question never reach the index, a model request or a stored
// answer, with the local model (masking off) and a hosted one (masking on);
// the file keeps its counts for the warning on the assistant switch; and what
// only looks like a number (dates, amounts, invoice numbers, a wrong check
// digit) is left as written. Synthetic numbers only. The model is faked and
// every request to it is kept.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { countDocumentNumbers, indexDocument, indexRecords, pagesFromText, type Embed } from "@/jobs/index-documents";
import { hasRawNumbers } from "@/lib/sensitive-numbers";
import { loadPrincipal } from "@/services/principal";

const ONE = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
// Every request the fake model got, as JSON, and what the model "writes".
const requests = vi.hoisted(() => [] as { call: string; body: string }[]);
const modelSays = vi.hoisted(() => ({ text: "" }));
vi.mock("@/services/ai-client", () => ({
  modelIsLocal: async () => true,
  embed: async (texts: string[]) => {
    requests.push({ call: "embed", body: JSON.stringify(texts) });
    return texts.map(() => ONE);
  },
  answer: async (question: string, passages: unknown[], language: string, history: unknown[]) => {
    requests.push({ call: "answer", body: JSON.stringify({ question, passages, history }) });
    return { answer: modelSays.text, cited_ids: ["P1"], grounded: true };
  },
  translateText: async (text: string, source: string, target: string) => {
    requests.push({ call: "translate", body: JSON.stringify(text) });
    return { text: `[${source}->${target}] ${text}`, model: "fake" };
  },
  summarizePages: async () => {
    throw new Error("passed to summarizeDocument instead");
  },
}));
const A = await import("@/services/assistant");
const S = await import("@/services/document-summaries");
const T = await import("@/services/translations");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");
const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-a5c0-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const P1 = id(3);
const R1 = id(4);
const ACT = id(5);
const PU = id(6);
const DOC = { planted: id(101), off: id(102) };
const U = { admin: id(11), lead: id(12) };

// The numbers planted, as written. Each has a valid check where it has one (made-up numbers).
const PLANTED = {
  id: "1012345672",
  idArabic: "١٠٩٨٧٦٥٤٣٩", // 1098765439
  iqama: "2123456788",
  iban: "SA03 8000 0000 6080 1016 7519",
  card: "4111 1111 1111 1111",
  mobile: "0551234567",
  mobileIntl: "+966 55 765 4321",
  email: "reem.harbi@example.sa",
  passport: "A12345678",
};
// What only looks like one: a wrong check digit, a wrong mod-97, a 9-digit number with no
// passport word, a date, an amount, an invoice number, a year.
const LOOKALIKE = {
  idBad: "1012345678",
  ibanBad: "SA0380000000608010167518",
  nine: "345678912",
  date: "2026-11-19",
  amount: "1,000,000",
  invoice: "INV-2026-00123",
  year: "2030",
};
const FILE_TEXT = [
  `Transfer note. Beneficiary national ID ${PLANTED.id}; resident Iqama ${PLANTED.iqama}.`,
  `Pay to IBAN ${PLANTED.iban} by card ${PLANTED.card}. Call ${PLANTED.mobile} or ${PLANTED.mobileIntl}, mail ${PLANTED.email}.`,
  `\fرقم الهوية ${PLANTED.idArabic}، جواز السفر رقم ${PLANTED.passport}.`,
  `Not personal: ID typed wrong ${LOOKALIKE.idBad}, IBAN typed wrong ${LOOKALIKE.ibanBad}, batch ${LOOKALIKE.nine},`,
  `approved ${LOOKALIKE.date}, limit SAR ${LOOKALIKE.amount}, invoice ${LOOKALIKE.invoice}, Vision ${LOOKALIKE.year}.`,
].join("\n");
const RAW = Object.values(PLANTED).flatMap((v) => [v, v.replace(/[\s-]/g, "")]);
const RAW_DIGITS = ["1098765439", "80000000608010167519"];

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
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
const q = (text: string, params: unknown[] = []) => owner.query(text, params);
const sqlAsLead = (text: string, params: unknown[]) => as(U.lead, (c) => c.query(text, params));
const embedded: string[] = [];
const embed: Embed = async (texts) => {
  embedded.push(...texts);
  return texts.map(() => ONE);
};

/** No planted number, in any of the ways it was written, and nothing the scanner still finds. */
function clean(text: string, where: string) {
  for (const raw of [...RAW, ...RAW_DIGITS]) expect(text, `${where}: ${raw}`).not.toContain(raw);
  expect(hasRawNumbers(text), `${where}: a personal number as written`).toBe(false);
}

beforeAll(async () => {
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, short_names, engagement_mode) VALUES
      ($1,'firm','Mizan Advisory',NULL,'{}',NULL), ($2,'client','Acme Holding','شركة أكمي','{Acme}','consultant_managed')`,
    [FIRM, ACME],
  );
  await q(`INSERT INTO "user" (id, name, email) VALUES ($1,'Firm Admin','admin@example.test'), ($2,'Lina Lead','lead@example.test')`, [U.admin, U.lead]);
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$3,'firm_admin'), ($2,$3,'consultant')`, [U.admin, U.lead, FIRM]);
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`, [
    P1,
    ACME,
    FIRM,
    U.admin,
  ]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES ($1,$2,true,false)`, [ACME, U.lead]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, rationale, visibility, created_by)
     VALUES ($1,$2,$3,'Settle the transfer',$4,'shared',$5)`,
    [R1, P1, ACME, `The refund goes to IBAN ${PLANTED.iban}; limit SAR ${LOOKALIKE.amount}.`, U.lead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, description, status, blocked_reason, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Make the transfer',$5,'blocked',$6,app_firm_today() - 3,$7)`,
    [ACT, P1, ACME, R1, `Beneficiary Iqama ${PLANTED.iqama}.`, `Waiting for card ${PLANTED.card} to be confirmed by ${PLANTED.mobile}`, U.lead],
  );
  await q(
    `INSERT INTO progress_updates (id, project_id, org_id, action_id, author_id, body, source, received_via, received_on)
     VALUES ($1,$2,$3,$4,$5,$6,'consultant_recorded','email','2026-11-01')`,
    [
    PU,
    P1,
    ACME,
    ACT,
    U.lead,
    `Called ${PLANTED.mobileIntl} about ID ${PLANTED.id}; reply to ${PLANTED.email}. Invoice ${LOOKALIKE.invoice} sent ${LOOKALIKE.date}.`,
  ]);
  for (const [d, ai] of [
    [DOC.planted, true],
    [DOC.off, false],
  ] as const) {
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
         ai_indexable, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$4,$5,'deliverable','submitted','Transfer note','shared',$6,$7,'text/plain',1,$8,'clean')`,
      [d, P1, ACME, FIRM, U.lead, ai, `key-${d}`, `sha-${d}`],
    );
  }
  await indexDocument(owner, DOC.planted, pagesFromText(FILE_TEXT), embed);
  await indexRecords(owner, embed);
});

beforeEach(() => {
  requests.length = 0;
  modelSays.text = "The transfer is blocked [P1].";
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("at indexing", () => {
  it("stores tags, never the numbers, in every passage, and leaves look-alikes as written", async () => {
    const { rows } = await q(`SELECT source_type, content FROM ai_chunks WHERE project_id = $1`, [P1]);
    expect(rows.map((r) => r.source_type).sort()).toEqual(["action", "document", "document", "recommendation"]);
    for (const r of rows) clean(r.content, `ai_chunks ${r.source_type}`);
    const file = rows
      .filter((r) => r.source_type === "document")
      .map((r) => r.content)
      .join("\n");
    for (const t of ["[ID_1]", "[ID_2]", "[IQAMA_1]", "[IBAN_1]", "[CARD_1]", "[PHONE_1]", "[PHONE_2]", "[EMAIL_1]", "[PASSPORT_1]"]) expect(file).toContain(t);
    for (const v of Object.values(LOOKALIKE)) expect(file).toContain(v);
    // The embedding call got the same tagged text.
    for (const t of embedded) clean(t, "embedding request");
  });

  it("keeps the counts on the file, and counts a file the assistant may not read without indexing it", async () => {
    const counts = async (d: string) => (await q(`SELECT number_counts FROM documents WHERE id = $1`, [d])).rows[0].number_counts;
    expect(await counts(DOC.planted)).toEqual({ ID: 2, IQAMA: 1, IBAN: 1, CARD: 1, PHONE: 2, EMAIL: 1, PASSPORT: 1 });
    expect(await counts(DOC.off)).toBeNull();
    await countDocumentNumbers(owner, DOC.off, pagesFromText(FILE_TEXT));
    expect(await counts(DOC.off)).toEqual({ ID: 2, IQAMA: 1, IBAN: 1, CARD: 1, PHONE: 2, EMAIL: 1, PASSPORT: 1 });
    expect((await q(`SELECT count(*)::int AS n FROM ai_chunks WHERE source_id = $1`, [DOC.off])).rows[0].n).toBe(0);
  });

  it("lets only the indexing job set the counts", async () => {
    await expect(sqlAsLead(`UPDATE documents SET number_counts = '{}' WHERE id = $1`, [DOC.planted])).rejects.toThrow(/set by the indexing job/);
    // The file list reads them, for the switch's warning.
    const rows = (await svc(U.lead, (tx) => tx.execute<{ number_counts: unknown }>(sql`SELECT number_counts FROM documents WHERE id = ${DOC.planted}`))).rows;
    expect(rows[0]!.number_counts).toMatchObject({ ID: 2 });
  });
});


describe("at send time, with the local model and a hosted one", () => {
  for (const masked of [false, true]) {
    const mode = masked ? "hosted (masking on)" : "local (masking off)";

    it(`${mode}: the question, passages, records, blocked reason, progress update and earlier turns go tagged`, async () => {
      const ask = (input: Partial<Parameters<typeof A.ask>[2]> & { question: string }) =>
        svc(U.lead, (tx, p) => A.ask(tx, p, { projectId: P1, language: "en", ...input }, masked));
      // A status question: the blocked action with its reason and last progress update go as records.
      const first = await ask({ question: `What is blocked for national ID ${PLANTED.id} and phone ${PLANTED.mobile}?` });
      const second = await ask({ question: `And the IBAN ${PLANTED.iban} from the transfer note?`, conversationId: first.conversationId });
      // A file attached with "@" goes first, tagged as well.
      await ask({ question: "Summarise this file", attachments: [DOC.planted] });

      const answers = requests.filter((r) => r.call === "answer");
      expect(answers).toHaveLength(3);
      for (const r of requests) clean(r.body, `${mode} ${r.call} request`);
      const all = answers.map((r) => r.body).join("\n");
      // What was sent still says what was there: the tags, the record, the reason and the update.
      expect(all).toContain("[ID_1]");
      expect(all).toContain("[IBAN_1]");
      expect(all).toContain("Blocked because");
      expect(all).toContain("Called [PHONE_");
      // Look-alikes go as written with the local model; masking (hosted) hides long digit runs as it always did, as [NUMBER_n].
      if (!masked) for (const v of Object.values(LOOKALIKE)) expect(all).toContain(v);
      expect(JSON.parse(answers[1]!.body).history.length).toBeGreaterThan(0);
      // The question's numbers are tagged in this request's numbering (a file's own tags are numbered apart).
      const firstReq = JSON.parse(answers[0]!.body) as { question: string; passages: { text: string }[] };
      expect(firstReq.question).toMatch(/national ID \[ID_1\] and phone \[PHONE_\d\]/);
      expect(second.answer).not.toContain(PLANTED.id);
    });

    it(`${mode}: an answer that writes a number out is tagged before it is kept or shown`, async () => {
      // The model never saw one, but makes one up (or rebuilds one) anyway.
      modelSays.text = `The beneficiary is 1098765439, IBAN SA0380000000608010167519, phone ٠٥٥١٢٣٤٥٦٧ [P1].`;
      const res = await svc(U.lead, (tx, p) => A.ask(tx, p, { projectId: P1, language: "en", question: "Who is the beneficiary?" }, masked));
      clean(res.answer, "answer returned");
      expect(res.answer).toMatch(/The beneficiary is \[ID_\d\], IBAN \[IBAN_\d\], phone \[PHONE_\d\]/);
      const { rows } = await q(`SELECT content FROM ai_messages WHERE id = $1`, [res.messageId]);
      clean(rows[0].content, "stored answer");
      const audit = await q(`SELECT meta FROM audit_log WHERE action = 'assistant.query' ORDER BY created_at DESC LIMIT 1`);
      expect(audit.rows[0].meta).toMatchObject({ numbersInAnswer: 3 });
      expect(audit.rows[0].meta.numbers).toBeGreaterThan(0);
    });

    it(`${mode}: a translation and a file summary send tags; the translation reads as the original did`, async () => {
      await q(`DELETE FROM content_translations`);
      await q(`DELETE FROM document_summaries`);
      const tr = await svc(U.lead, (tx, p) => T.translate(tx, p, { entityType: "progress_update", entityId: PU, field: "body", to: "ar" }, masked));
      const sent = requests.filter((r) => r.call === "translate");
      expect(sent).toHaveLength(1);
      clean(sent[0]!.body, `${mode} translation request`);
      // The person reads the original anyway: the numbers come back in the translation.
      expect(tr.text).toContain(PLANTED.mobileIntl);
      expect(tr.text).toContain(PLANTED.id);
      await q(`DELETE FROM content_translations`);

      const pages: string[] = [];
      await svc(U.lead, (tx, p) =>
        S.summarizeDocument(
          tx,
          p,
          DOC.planted,
          "en",
          async (given) => {
            pages.push(JSON.stringify(given));
            return { points: [{ text: "A transfer to [IBAN_1] [ID_1].", pages: [1] }], model: "fake" };
          },
          masked,
        ),
      );
      expect(pages).toHaveLength(1);
      clean(pages[0]!, `${mode} summary request`);
      const { rows } = await q(`SELECT summary FROM document_summaries WHERE document_id = $1`, [DOC.planted]);
      clean(JSON.stringify(rows), "stored summary");
      await q(`DELETE FROM document_summaries`);
    });
  }
});

describe("an answer as it streams", () => {
  it("shows a number only as a tag, and holds back one still being written", async () => {
    const { createMasker } = await import("@/lib/masking");
    const { createNumberTagger } = await import("@/lib/sensitive-numbers");
    const m = createMasker([], { numbers: createNumberTagger() });
    expect(A.shownSoFar(m, `The ID is ${PLANTED.id} and the phone 055`)).toBe("The ID is [ID_1] and the phone ");
    expect(A.shownSoFar(m, "Write to reem.harbi@exa")).toBe("Write to ");
    expect(A.shownSoFar(m, "It is held under [IBA")).toBe("It is held under ");
    expect(A.shownSoFar(m, "It is held under [IBAN_1]. Then")).toBe("It is held under [IBAN_1]. ");
    // An e-mail's local part before its "@", and a direction mark before a number, wait too.
    expect(A.shownSoFar(m, "Write to reem.harbi")).toBe("Write to ");
    expect(A.shownSoFar(m, "اتصل على ‏055 123")).toBe("اتصل على ");
    // A tag the answer already has keeps its number when a new number is tagged (review S8).
    m.mask(`ID ${PLANTED.id} and Iqama ${PLANTED.iqama}`);
    expect(A.answerNumbersTagged(m, `[IQAMA_1] and [ID_1], and 1098765439`).text).toBe("[IQAMA_1] and [ID_1], and [ID_2]");
  });
});
