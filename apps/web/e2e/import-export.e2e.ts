import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { readXlsx } from "../src/lib/office/xlsx-read";
import { writeXlsx } from "../src/lib/office/xlsx-write";
import { ids, one, sql } from "./support/db";
import { L } from "./support/msg";
import { open } from "./support/ui";
import { authFile, type UserKey } from "./support/users";

// Importing a plan from Excel and Word, and exporting it again (Excel, PDF).
// The files are made here, with a fresh stamp, so every run imports new rows.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const stamp = Date.now().toString(36);
const dir = "e2e-results/import-export";
mkdirSync(dir, { recursive: true });
const as = (u: UserKey): Promise<APIRequestContext> => request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE }, storageState: authFile(u) });
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e-results/shots/${name}.png`, fullPage: true });

const excelPath = `${dir}/plan-${stamp}.xlsx`;
const wordPath = `${dir}/plan-${stamp}.docx`;
const rec1 = `اعتماد سياسة تعارض المصالح ${stamp}`;
const rec2 = `تشكيل لجنة المخاطر ${stamp}`;
const wordRec = `Adopt a delegation of authority matrix ${stamp}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // An Arabic register as consultants keep them: a title row, merged (blank) cells, a Hijri date, Arabic digits, one bad date.
  writeFileSync(
    excelPath,
    writeXlsx([
      {
        name: "الخطة",
        rtl: true,
        // Row 1 is a title; the column headings are on row 2.
        columns: [{ header: `خطة التنفيذ ${stamp}` }, ...Array.from({ length: 6 }, () => ({ header: "" }))],
        rows: [
          ["الملاحظة", "التوصية", "الأولوية", "الإجراء", "المسؤول", "تاريخ الاستحقاق", "قائمة الأدلة"],
          [`لا توجد سياسة لتعارض المصالح ${stamp}`, rec1, "عالية", "إعداد مسودة السياسة", "ريم الحربي", { date: "2027-03-15" }, "مسودة السياسة\nمحضر الاعتماد"],
          [null, null, null, "اعتماد السياسة من المجلس", "abdullah@nukhba.example", "١٥/٠٩/١٤٤٨هـ", "محضر الاجتماع؛ قرار المجلس"],
          [null, rec2, "حرجة", "تسمية أعضاء اللجنة", "شخص غير معروف", "2027-13-40", null],
        ],
      },
    ]),
  );
  // A Word report with headings and bullet points.
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const styles = `<?xml version="1.0"?><w:styles ${w}>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
    <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style></w:styles>`;
  const body = [
    p(`1. Authority is not delegated in writing ${stamp}`, "Heading1"),
    p("Decisions wait for the chairman."),
    p(`1.1 ${wordRec}`, "Heading2"),
    p("Draft the matrix", "ListBullet"),
    p("Approve the matrix", "ListBullet"),
  ].join("");
  writeFileSync(
    wordPath,
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${w}><w:body>${body}</w:body></w:document>`),
      "word/styles.xml": strToU8(styles),
    }),
  );
});

test("consultant imports an Arabic Excel plan: map, fix, release, confirm", async ({ browser }) => {
  const t = L("ar");
  const board = ids.board();
  const page = await open(browser, "khalid", "ar");
  await page.goto(`/projects/${board}`);
  await page.getByRole("link", { name: t("planImport.button") }).click();
  await page.waitForURL(`**/projects/${board}/import`);
  await shot(page, "import-ar-1-file");

  await page.locator("#import-file").setInputFiles(excelPath);
  await page.getByRole("button", { name: t("planImport.upload.read") }).click();
  await expect(page.getByText(t("planImport.map.title"))).toBeVisible();
  // The title row was skipped and the headings matched.
  await expect(page.getByRole("combobox", { name: `${t("planImport.map.importAs")}: التوصية` })).toHaveText(t("importExport.fields.recommendation"));
  await shot(page, "import-ar-2-columns");

  await page.getByRole("button", { name: t("planImport.map.next") }).click();
  const rows = page.locator("tr[data-line]");
  await expect(rows).toHaveCount(3);
  // The second row took its finding and recommendation from the merged cells; its Hijri date was read.
  await expect(rows.nth(1)).toContainText(t("planImport.review.sameAbove"));
  await expect(rows.nth(1)).toContainText("2027-02-22");
  // The third has a date Selah can't read and an owner who isn't on the team.
  await expect(rows.nth(2)).toContainText(t("planImport.review.fix"));
  await expect(rows.nth(2)).toContainText("شخص غير معروف");
  await expect(page.getByRole("button", { name: t("planImport.review.import"), exact: true })).toBeDisabled();

  await rows.nth(2).getByRole("button", { name: t("planImport.review.edit", { n: 5 }) }).click();
  await page.getByRole("dialog").locator("#edit-dueDate").fill("2027-05-01");
  await page.getByRole("dialog").getByRole("button", { name: t("planImport.review.apply") }).click();
  await expect(rows.nth(2)).not.toContainText(t("planImport.review.fix"));
  await page.locator("#import-release").click();
  await shot(page, "import-ar-3-review");

  await page.getByRole("button", { name: t("planImport.review.import"), exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button").last().click();
  await page.waitForURL(`**/projects/${board}`);
  await expect(page.getByText(rec1).first()).toBeVisible();
  await shot(page, "import-ar-4-project");

  // Two actions with an owner and a date were sent; the one without an owner stays a draft.
  const actions = sql<string[]>(
    `select a.title, a.status, coalesce(u.email,'-') from actions a join recommendations r on r.id=a.recommendation_id left join "user" u on u.id=a.owner_user_id where r.title in ('${rec1}','${rec2}') order by a.created_at`,
  );
  expect(actions).toEqual([
    ["إعداد مسودة السياسة", "assigned", "reem@nukhba.example"],
    ["اعتماد السياسة من المجلس", "assigned", "abdullah@nukhba.example"],
    ["تسمية أعضاء اللجنة", "draft", "-"],
  ]);
  expect(one(`select a.due_date from actions a join recommendations r on r.id=a.recommendation_id where a.title='اعتماد السياسة من المجلس' and r.title in ('${rec1}','${rec2}')`)).toBe("2027-02-22");
  expect(one(`select count(*) from evidence_requests e join actions a on a.id=e.action_id join recommendations r on r.id=a.recommendation_id where a.title='إعداد مسودة السياسة' and r.title='${rec1}'`)).toBe("2");
  expect(one(`select priority from recommendations where title='${rec2}'`)).toBe("critical");
  expect(one(`select count(*) from activity_events where meta->>'import'='true' and entity_id in (select a.id from actions a join recommendations r on r.id=a.recommendation_id where r.title in ('${rec1}','${rec2}'))`)).toBe("3");
  expect(one(`select meta->>'actions' from audit_log where action='plan.import' and resource_id='${board}' order by created_at desc limit 1`)).toBe("3");
});

test("importing the same file again adds nothing twice", async ({ browser }) => {
  const t = L("ar");
  const page = await open(browser, "khalid", "ar");
  await page.goto(`/projects/${ids.board()}/import`);
  await page.locator("#import-file").setInputFiles(excelPath);
  await page.getByRole("button", { name: t("planImport.upload.read") }).click();
  await page.getByRole("button", { name: t("planImport.map.next") }).click();
  await expect(page.getByText(t("planImport.review.nothing"))).toBeVisible();
  await expect(page.getByRole("button", { name: t("planImport.review.import"), exact: true })).toBeDisabled();
});

test("consultant imports a Word outline as firm-only (English, dark)", async ({ browser }) => {
  const t = L("en");
  const page = await open(browser, "khalid", "en", "dark");
  await page.goto(`/projects/${ids.board()}/import`);
  await page.locator("#import-file").setInputFiles(wordPath);
  await page.getByRole("button", { name: t("planImport.upload.read") }).click();
  await expect(page.getByText(t("planImport.map.outlineHint"))).toBeVisible();
  await shot(page, "import-en-dark-outline");
  await page.getByRole("button", { name: t("planImport.map.next") }).click();
  await expect(page.locator("tr[data-line]")).toHaveCount(2);
  await page.locator("#import-visibility").click();
  await page.getByRole("option", { name: t("visibility.firm_private") }).click();
  await shot(page, "import-en-dark-review");
  await page.getByRole("button", { name: t("planImport.review.import"), exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button").last().click();
  await page.waitForURL(`**/projects/${ids.board()}`);
  expect(one(`select visibility from recommendations where title='${wordRec}'`)).toBe("firm_private");
  expect(one(`select description from findings where title='Authority is not delegated in writing ${stamp}'`)).toBe("Decisions wait for the chairman.");
  expect(one(`select count(*) from actions a join recommendations r on r.id=a.recommendation_id where r.title='${wordRec}' and a.status='draft'`)).toBe("2");
});

test("the plan exports to Excel with what each person may see", async ({ browser }) => {
  const t = L("ar");
  const board = ids.board();
  const page = await open(browser, "khalid", "ar");
  await page.goto(`/projects/${board}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: t("exports.excel") }).first().click()]);
  const file = `${dir}/export-khalid.xlsx`;
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/^selah-plan-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const [sheet] = readXlsx(new Uint8Array(readFileSync(file)));
  expect(sheet!.rows[0]).toContain(t("importExport.columns.visibility"));
  const flat = sheet!.rows.map((r) => r.join("|")).join("\n");
  expect(flat).toContain(rec1);
  expect(flat).toContain(wordRec);
  expect(flat).toContain("2027-02-22");

  // The client's manager gets the same plan without the firm-only rows or the "who sees it" column.
  const reem = await as("reem");
  const res = await reem.get(`/api/projects/${board}/export?lang=en`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("spreadsheetml");
  const [clientSheet] = readXlsx(new Uint8Array(await res.body()));
  expect(clientSheet!.rows[0]).not.toContain(L("en")("importExport.columns.visibility"));
  const clientFlat = clientSheet!.rows.map((r) => r.join("|")).join("\n");
  expect(clientFlat).toContain(rec1);
  expect(clientFlat).not.toContain(wordRec);

  // An action owner's Actions export holds only their own actions.
  const abdullah = await as("abdullah");
  const mine = await abdullah.get(`/api/actions/export?lang=ar`);
  expect(mine.status()).toBe(200);
  const [actionsSheet] = readXlsx(new Uint8Array(await mine.body()));
  const owners = new Set(actionsSheet!.rows.slice(1).map((r) => r[3]));
  expect([...owners]).toEqual(["عبدالله المطيري"]);
});

test("a report downloads as PDF in Arabic, for those who can read it", async ({ browser }) => {
  const t = L("ar");
  const board = ids.board();
  const khalid = await as("khalid");
  const created = await khalid.post(`/api/projects/${board}/reports`, {
    data: { title: `تقرير الربع ${stamp}`, periodStart: "2026-07-01", periodEnd: "2026-09-30", bodyMd: "<b>bold</b> ملاحظات الفترة" },
  });
  expect(created.status()).toBe(200);
  const reportId = ((await created.json()) as { id: string }).id;

  const page = await open(browser, "khalid", "ar");
  await page.goto(`/reports/${reportId}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: t("exports.pdf") }).click()]);
  const file = `${dir}/report-${stamp}.pdf`;
  await download.saveAs(file);
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  // The text is real, searchable Arabic (shaped and extractable), and nothing written in it ran as HTML.
  const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  expect(text).toContain(stamp);
  expect(text).toContain("حوكمة مجلس");
  expect(text).toContain("<b>bold");
  execFileSync("pdftoppm", ["-png", "-r", "60", "-f", "1", "-l", "1", file, "e2e-results/shots/report-ar-pdf"]);
  await shot(page, "report-ar-pdf-button");

  // Firm-only until shared: the client's manager and another client can't fetch it.
  const reem = await as("reem");
  expect((await reem.get(`/api/reports/${reportId}/pdf`)).status()).toBe(404);
  const hind = await as("hind");
  expect((await hind.get(`/api/reports/${reportId}/pdf`)).status()).toBe(404);
  expect(one(`select count(*) from audit_log where action='report.export' and resource_id='${reportId}'`)).toBe("1");
});

test("only firm staff on the project can import, and a review can't be forged", async () => {
  const board = ids.board();
  const xlsx = readFileSync(excelPath);
  const upload = (r: APIRequestContext, project = board) =>
    r.post(`/api/projects/${project}/import`, { multipart: { file: { name: "plan.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlsx } } });
  for (const u of ["reem", "fahd", "abdullah", "hind"] as const) {
    const r = await as(u);
    expect((await upload(r)).status(), u).toBe(404);
    expect((await r.get(`/api/projects/${board}/import/template`)).status(), u).toBe(404);
  }
  const hind = await as("hind");
  expect((await hind.get(`/api/projects/${board}/export`)).status()).toBe(404);
  // Noura isn't staffed on Al-Nukhba.
  expect((await upload(await as("noura"))).status()).toBe(404);

  const khalid = await as("khalid");
  const parsed = (await (await upload(khalid)).json()) as { token: string };
  const confirm = (token: string, project = board) =>
    khalid.post(`/api/projects/${project}/import/confirm`, {
      data: { token, rows: [{ line: 2, values: { recommendation: `forged ${stamp}` } }], options: { visibility: "shared", release: false } },
    });
  expect((await confirm(`${parsed.token}x`)).status()).toBe(400);
  expect((await confirm(parsed.token, ids.waha())).status()).toBe(400);
  // A text file renamed to .xlsx is refused before it is read.
  const fake = await khalid.post(`/api/projects/${board}/import`, { multipart: { file: { name: "plan.xlsx", mimeType: "text/plain", buffer: Buffer.from("hello") } } });
  expect(fake.status()).toBe(400);
  expect(one(`select count(*) from recommendations where title='forged ${stamp}'`)).toBe("0");
});
