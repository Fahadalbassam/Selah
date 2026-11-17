// The walkthrough's sample data (scripts/walkthrough/seed.ts) says what
// docs/walkthrough.md says it does (page audit N15, N15b): the matrix action
// has one evidence item answered and one open, and late actions are late
// because their date passed, not because it was moved (no date history).
//
// The real seed runs here, on the test database, with object storage
// replaced (no file leaves the test). It takes a minute.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... TEST_DATABASE_AUTH_URL=... npm run test:db
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
const authUrl = process.env.TEST_DATABASE_AUTH_URL;
if (!ownerUrl || !appUrl || !authUrl) throw new Error("set TEST_DATABASE_OWNER_URL, TEST_DATABASE_APP_URL and TEST_DATABASE_AUTH_URL");

// The seed's configuration, pointed at the test database, before anything loads env().
Object.assign(process.env, {
  DATABASE_OWNER_URL: ownerUrl,
  DATABASE_APP_URL: appUrl,
  DATABASE_AUTH_URL: authUrl,
  APP_URL: "http://selah.test",
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-0123456789",
  S3_ENDPOINT: "http://storage.test",
  S3_BUCKET: "test",
  S3_ACCESS_KEY: "test",
  S3_SECRET_KEY: "test",
  AI_SERVICE_URL: "http://ai.test",
  AI_SERVICE_TOKEN: "an-ai-token-that-is-long-enough-0123456789",
  CLAMD_HOST: "",
  SCAN_REQUIRED: "false",
});

vi.mock("@/services/storage", () => ({
  putObject: async () => undefined,
  copyObject: async () => undefined,
}));
// Exports translate on the server; outside a request, the real messages through next-intl's own translator.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = { ar: (await import("../../messages/ar.json")).default, en: (await import("../../messages/en.json")).default };
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ar" | "en"; namespace?: string }) =>
      createTranslator({ locale, messages: messages[locale], namespace: namespace as never }),
  };
});

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const q = async (text: string, params: unknown[] = []) => (await owner.query(text, params)).rows;

beforeAll(async () => {
  await owner.query(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  await import("../../scripts/walkthrough/seed");
}, 300_000);

afterAll(async () => {
  await owner.end();
});

const actionByTitle = async (title: string) => (await q(`SELECT id, due_date::text AS due, baseline_due_date::text AS baseline FROM actions WHERE title = $1`, [title]))[0];

describe("the walkthrough sample data", () => {
  it("answers one item of the matrix action's evidence list, the way the screens do, and leaves one open (N15)", async () => {
    const matrix = await actionByTitle("تحديث مصفوفة الصلاحيات ورفعها للمجلس");
    const items = await q(`SELECT title, status FROM evidence_requests WHERE action_id = $1 ORDER BY title`, [matrix.id]);
    expect(items).toEqual([
      { title: "المصفوفة المحدثة", status: "open" },
      { title: "مذكرة المقارنة مع الحدود الحالية", status: "submitted" },
    ]);
    // The file sent is the one tied to the answered item.
    const sent = await q(`SELECT r.title FROM evidence_submissions s JOIN evidence_requests r ON r.id = s.evidence_request_id WHERE s.action_id = $1`, [matrix.id]);
    expect(sent).toEqual([{ title: "مذكرة المقارنة مع الحدود الحالية" }]);
  });

  it("makes actions late without moving their dates: no date history but the one approved request (N15b)", async () => {
    const today = (await q(`SELECT app_firm_today()::text AS d`))[0].d as string;
    for (const title of ["ترشيح الأعضاء المستقلين للجنة", "إعداد لائحة عمل اللجنة", "مراجعة حدود الصلاحيات المالية"]) {
      const a = await actionByTitle(title);
      expect(a.due < today, title).toBe(true);
      // Late against the date agreed at release, as the screens count it.
      expect(a.baseline, title).toBe(a.due);
      expect(await q(`SELECT 1 FROM action_due_changes WHERE action_id = $1`, [a.id]), title).toEqual([]);
    }
    // The only moves in the whole sample are the ones a request asked for and the firm approved.
    expect(await q(`SELECT 1 FROM action_due_changes WHERE request_id IS NULL`)).toEqual([]);
    expect((await q(`SELECT count(*)::int AS n FROM action_due_changes`))[0].n).toBe(1);
  });

  it("limits one Al-Nukhba deliverable with \"everyone except\", leaving out manager@nukhba.test (feature A)", async () => {
    const [file] = await q(
      `SELECT d.id, a.mode, array_agg(u.email) AS out FROM documents d
       JOIN item_audiences a ON a.item_type = 'document' AND a.item_id = d.id
       JOIN item_audience_people x ON x.item_type = a.item_type AND x.item_id = a.item_id
       JOIN "user" u ON u.id = x.user_id
       WHERE d.title = $1 GROUP BY d.id, a.mode`,
      ["مقترح إعادة تنظيم أمانة مجلس الإدارة.docx"],
    );
    expect([file?.mode, file?.out]).toEqual(["except", ["manager@nukhba.test"]]);
    const ok = async (email: string) =>
      (await q(`SELECT app_audience_ok('document', $1, (SELECT id FROM "user" WHERE email = $2)) AS ok`, [file!.id, email]))[0].ok as boolean;
    expect(await ok("manager@nukhba.test")).toBe(false);
    expect(await ok("admin@nukhba.test")).toBe(true);
    expect(await ok("lead@mizan.test")).toBe(true);
  });
});
