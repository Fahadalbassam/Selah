// The Arabic fold for word search and masking (migration 0112) against a real
// Postgres: the database's fold and prefix rule agree with lib/arabic-fold.ts,
// the stored search column finds a word in every spelling and with or without
// its prefix, and the names in a text are found as the masker finds them.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FOLD_DROP, SEARCH_FOLD_FROM, foldWords, searchStems } from "@/lib/arabic-fold";
import { keywordQuery } from "@/lib/assistant-search";
import { createMasker } from "@/lib/masking";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");
const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f112-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const NUKHBA = id(2);
const PROJ = id(3);
const U = { admin: id(11), cons: id(12), ahmed: id(13), reem: id(14) };
const ZERO = `[${Array(1024).fill(0).join(",")}]`;

async function sqlAs(userId: string, text: string, params: unknown[] = []) {
  const c: PoolClient = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const r = await c.query(text, params);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

// Words in every form the fold and the prefix rule handle, and some they must leave alone.
const WORDS = [
  "أحمد", "إبراهيم", "آل", "ٱلرحمن", "مصطفى", "مدرسة", "المسؤول", "المسئول", "مسؤولية", "عائشة", "شؤون", "رئيس",
  "مُرَاجَعَةٌ", "نظاماً", "ممتـــثلة", "٢٠٢٧", "۱۴۰۵", "ب٣", "والشركة", "بالمراجعة", "وبالمكافآت", "فالقرار", "كالعادة",
  "للنخبة", "وللجنة", "لجنة", "بنك", "البنك", "الله", "وال", "والي", "كتاب", "فيه", "لها", "ولي", "مجلس", "المجلس",
  "Board", "ÉTÉ", "Al-Nukhba", "2027", "x٣y", "",
  // Review of #209: letters whose lower case JavaScript writes differently by default, digits inside words.
  "İstanbul", "İ", "ΣΑΣ", "ẞ", "Ǆemal", "ÅNGSTRÖM", "عام٢٠٢٥م", "ب٣ت", "A٢B۳", "Vision٢٠٣٠", "ق٫٥",
];
const SENTENCES = [
  "وبالمكافآت السنوية تختص لجنة الترشيحات، وللجنة أن تستعين بخبراء مستقلين.",
  "يرفع المسؤول التنفيذي تقريره إلى أعضاء مجلس الإدارة في عام ٢٠٢٧. والي فبراير بنك البنك للنخبة، والشركة 2027 Board ب3",
  "(للجنة) «وللنخبة»؛ كالعادة—فالقرار…للإنماء ولـلنخبة الله لله",
];

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, short_names) VALUES ($1,'firm','Mizan Advisory','ميزان للاستشارات','{}'),
      ($2,'client','Al-Nukhba Holding','شركة النخبة القابضة', ARRAY['النخبة'])`,
    [FIRM, NUKHBA],
  );
  await q(
    `INSERT INTO "user" (id, name, name_alt, email) VALUES ($1,'admin',NULL,'admin@example.test'), ($2,'cons',NULL,'cons@example.test'),
      ($3,'Ahmed Al-Otaibi','أحمد العتيبي','ahmed@example.test'), ($4,'Reem Al-Harbi','ريم الحربي','reem@example.test')`,
    [U.admin, U.cons, U.ahmed, U.reem],
  );
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$5,'firm_admin'), ($2,$5,'consultant'), ($3,$6,'client_manager'), ($4,$6,'client_manager')`,
    [U.admin, U.cons, U.ahmed, U.reem, FIRM, NUKHBA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Board governance','active',$4)`,
    [PROJ, NUKHBA, FIRM, U.admin],
  );
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [PROJ, U.cons, U.ahmed]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the database's fold is lib/arabic-fold.ts's", () => {
  it("folds every word of the list, and every character of the rules, the same way", async () => {
    const chars = [...SEARCH_FOLD_FROM, ...FOLD_DROP].map((c) => `ب${c}ت`);
    const words = [...WORDS, ...chars];
    const { rows } = await owner.query<{ w: string; f: string }>(`SELECT w, app_search_fold(w) AS f FROM unnest($1::text[]) WITH ORDINALITY AS t(w, i) ORDER BY i`, [words]);
    expect(rows.map((r) => r.f)).toEqual(words.map(foldWords));
    // Spot checks of the rules themselves.
    expect(foldWords("أإآٱ ى ة ؤئ ٢٠٢٧ ۱۲ مُرَاجَعَةٌ ممتـــثلة")).toBe("اااا ي ه ءء 2027 12 مراجعه ممتثله");
  });

  it("takes the same prefix off the same words", async () => {
    const folded = WORDS.map(foldWords);
    const { rows } = await owner.query<{ s: string[] }>(`SELECT app_search_stems(w) AS s FROM unnest($1::text[]) WITH ORDINALITY AS t(w, i) ORDER BY i`, [folded]);
    const sorted = (xs: string[]) => [...xs].sort();
    expect(rows.map((r) => sorted(r.s))).toEqual(folded.map((w) => sorted(searchStems(w))));
    const at = (w: string) => searchStems(foldWords(w));
    expect(at("والشركة")).toEqual(["شركه"]);
    expect(at("وبالمكافآت")).toEqual(["مكافات"]);
    expect(at("للنخبة")).toEqual(["نخبه", "لنخبه"]);
    expect(at("وللجنة")).toEqual(["جنه", "لجنه"]);
    // The cautions of section 7: «لجنة» also gives «جنة»; «بنك» keeps its ب (two letters would be left).
    expect(at("لجنة")).toEqual(["جنه"]);
    expect(at("بنك")).toEqual([]);
    expect(at("البنك")).toEqual(["بنك"]);
    expect(at("الله")).toEqual([]);
    expect(at("Board")).toEqual([]);
  });

  it("indexes a passage by exactly those shorter forms (app_search_tsv)", async () => {
    for (const text of SENTENCES) {
      const words = foldWords(text).split(/[^ء-ي]+/).filter(Boolean);
      const stems = words.flatMap(searchStems).join(" ");
      const { rows } = await owner.query<{ got: string[]; want: string[] }>(
        `SELECT ARRAY(SELECT unnest(tsvector_to_array(app_search_tsv($1))) ORDER BY 1) AS got,
                ARRAY(SELECT unnest(tsvector_to_array(to_tsvector('simple', app_search_fold($1)) || to_tsvector('simple', $2))) ORDER BY 1) AS want`,
        [text, stems],
      );
      expect(rows[0]!.got).toEqual(rows[0]!.want);
    }
  });
});

describe("word search in the stored column", () => {
  const passages = {
    hamza: "يرفع المسؤول التنفيذي تقريره إلى أعضاء مجلس الإدارة في عام ٢٠٢٧.",
    prefix: "وبالمكافآت السنوية تختص لجنة الترشيحات، وللجنة أن تستعين بخبراء.",
    exact: "تجتمع لجنة المراجعة أربع مرات في السنة.",
    other: "Tatweel aside, nothing here is Arabic: the board meets in 2027.",
  };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const [k, content] of Object.entries(passages)) {
      const r = await owner.query<{ id: string }>(
        `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, content, embedding)
         VALUES ($1,$2,'document',gen_random_uuid(),'shared',0,$3,$4) RETURNING id`,
        [PROJ, NUKHBA, content, ZERO],
      );
      ids[k] = r.rows[0]!.id;
    }
  });

  const search = async (question: string) => {
    const words = keywordQuery(question);
    const { rows } = await owner.query<{ id: string }>(
      `SELECT id FROM ai_chunks WHERE tsv @@ to_tsquery('simple', $1) ORDER BY ts_rank(tsv, to_tsquery('simple', $1)) DESC, id`,
      [words],
    );
    return rows.map((r) => Object.entries(ids).find(([, v]) => v === r.id)?.[0]);
  };

  it("is computed by app_search_tsv, the index is back", async () => {
    const { rows } = await owner.query(`SELECT bool_and(tsv = app_search_tsv(content)) AS same FROM ai_chunks`);
    expect(rows[0].same).toBe(true);
    const idx = await owner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'ai_chunks_tsv_idx'`);
    expect(idx.rows[0].indexdef).toMatch(/USING gin \(tsv\)/);
  });

  it("finds a word typed with or without hamza, ة or Arabic-Indic digits", async () => {
    expect(await search("المسئول")).toEqual(["hamza"]);
    expect(await search("اعضاء")).toEqual(["hamza"]);
    expect(await search("أعضاء")).toEqual(["hamza"]);
    expect(await search("الاداره")).toEqual(["hamza"]);
    // «٢٠٢٧» in the passage and «2027» in the question are one number, in both directions.
    expect(await search("2027")).toEqual(expect.arrayContaining(["hamza", "other"]));
    expect(await search("٢٠٢٧")).toEqual(expect.arrayContaining(["hamza", "other"]));
  });

  it("finds a word with or without its prefix, and ranks the form as written first", async () => {
    expect(await search("المكافآت")).toEqual(["prefix"]);
    expect(await search("مكافأة")).toEqual([]);
    expect(await search("الترشيحات")).toEqual(["prefix"]);
    // «اللجنة» finds both «لجنة» and «وللجنة»; «لجنة المراجعة» ranks the passage with both words first.
    expect(await search("اللجنة")).toEqual(expect.arrayContaining(["prefix", "exact"]));
    expect((await search("لجنة المراجعة"))[0]).toBe("exact");
  });

  it("keeps a word that only looks prefixed: «بنك» is not «نك»", async () => {
    expect(keywordQuery("بنك")).toBe("بنك");
    const { rows } = await owner.query(`SELECT app_search_tsv('البنك والبنوك بنك')::text AS v`);
    expect(rows[0].v).not.toMatch(/'نك'/);
    expect(rows[0].v).toMatch(/'بنك'/);
  });
});

// The phase 3 probes (docs/review/work/phase3-assistant-redaction.md 3.2): names the
// masker missed because of hamza, tatweel or «لل».
describe("masking finds names in the folded text", () => {
  const terms = async (text: string) =>
    (await sqlAs(U.cons, `SELECT kind, term, grp FROM app_mask_terms_in($1, $2)`, [PROJ, text])).rows as { kind: string; term: string; grp: number }[];

  it("finds a name without its hamza, with tatweel, and after ل as «لل»", async () => {
    expect((await terms("رسالة من احمد العتيبي")).map((r) => r.term)).toEqual(expect.arrayContaining(["أحمد العتيبي"]));
    expect((await terms("ريـــم الحربي")).map((r) => r.term)).toEqual(expect.arrayContaining(["ريم الحربي"]));
    expect((await terms("درجة نضج الحوكمة للنخبة 2.1")).map((r) => r.term)).toEqual(["النخبة"]);
    expect((await terms("وللنخبة رأي")).map((r) => r.term)).toEqual(["النخبة"]);
    // Not a name: «النخبة» inside a longer word, «لنخبة» without the ل of «لل».
    expect(await terms("النخبةوي ونخبة لنخبة")).toEqual([]);
  });

  it("finds a name only at the start of a word or after a prefix written on to it (review S4)", async () => {
    await owner.query(
      `INSERT INTO client_contacts (org_id, name) VALUES ($1,'بشرى المطيري'), ($1,'سلمى الدوسري'), ($1,'أمل الشهري'), ($1,'آل سعود'), ($1,'إلهام الزهراني')`,
      [NUKHBA],
    );
    const found = async (text: string) => (await terms(text)).map((r) => r.term);
    // Inside another word: not found.
    expect(await found("رأس المال البشري والتعايش")).toEqual([]);
    expect(await found("الانتقال السلمي للسلطة")).toEqual([]);
    expect(await found("التطبيق الكامل وشامل للعامل")).toEqual([]);
    // At the start of a word, after و ب ل, «لل» for the article, «لآل» and «لإلهام» as written.
    expect(await found("قالت بشرى ثم وأمل الشهري")).toEqual(expect.arrayContaining(["بشرى", "أمل الشهري"]));
    expect(await found("رسالة لآل سعود")).toContain("آل سعود");
    expect(await found("أرسلت لإلهام")).toContain("إلهام");
    expect(await found("رفع للنخبة")).toContain("النخبة");
  });

  it("masks a text as the whole list would", async () => {
    const all = (await owner.query(`SELECT kind, term, entity FROM app_mask_terms($1)`, [PROJ])).rows;
    const texts = [
      "درجة نضج الحوكمة للنخبة 2.1",
      "رسالة من احمد العتيبي و إلى أحمد، ونسخة لريـــم الحربي",
      "ريمـ الحربيـ ومُؤسسة",
      "عرض على النخبة وبالنخبة ولشركة النخبة القابضة",
      "تقرير لِلنُّخبة عن الإدارة",
      "Al-Nukhba Holding and Reem Al-Harbi",
      "للـنخبة ولـلنخبة، لآل سعود، لإلهام، وقالت بشرى ولأمل الشهري",
      "النخبةوي ونخبة لنخبة، رأس المال البشري، الانتقال السلمي، التطبيق الكامل وشامل للعامل، وفي حكمه",
    ];
    for (const [i, text] of texts.entries()) {
      const some = await terms(text);
      const subset = createMasker(some.map((r) => ({ ...r, entity: String(r.grp) })), { places: true });
      const whole = createMasker(all, { places: true }).mask(text);
      expect(subset.mask(text)).toBe(whole);
      expect(whole === text).toBe(i === texts.length - 1);
    }
    expect(createMasker(all).mask(texts[0]!)).toBe("درجة نضج الحوكمة ل[ORG_1] 2.1");
  });
});
