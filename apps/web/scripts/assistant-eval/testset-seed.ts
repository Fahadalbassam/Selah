// Seeds the labelled test set (testset/corpus.ts) on top of `npm run db:seed`:
// 160+ synthetic files over three projects, one of them a PDF whose second
// page is a scan, and a few actions with due dates around today so "due this
// week" has a right answer. Prints the ids testset-run.ts needs. Then run
// `npm run job:index-documents` with S3_BUCKET set to the same eval bucket,
// until it indexes nothing more (100 files a round).
//
// Synthetic data only; refuses to run in production. Two guards, because it
// writes 160+ rows and files: EVAL_DB_OK must name the database it connects to
// (`EVAL_DB_OK=selah_test_s`), and the files go to a bucket of their own,
// EVAL_S3_BUCKET (default `selah-eval`), never the app's `selah-evidence`.
// The rows go in one transaction: a failure leaves the database as it was (files
// already put in the eval bucket stay there, unreferenced).
import { createHash } from "node:crypto";
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { CORPUS, fileText, type CorpusFile } from "./testset/corpus";

if (process.env.NODE_ENV === "production") throw new Error("refuses to run in production");
const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
const db = await pool.connect();
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } });
const one = async <T,>(q: string, p: unknown[] = []) => (await db.query(q, p)).rows[0] as T;

const { current_database: dbName } = await one<{ current_database: string }>(`SELECT current_database()`);
if (process.env.EVAL_DB_OK !== dbName) {
  throw new Error(`this writes the test set into the database "${dbName}": set EVAL_DB_OK=${dbName} to confirm it is a disposable test database`);
}
const bucket = process.env.EVAL_S3_BUCKET || "selah-eval";
if (bucket === "selah-evidence") throw new Error("the test set's files go to a bucket of their own, never the app's selah-evidence: set EVAL_S3_BUCKET");
const uid = (email: string) => one<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]).then((r) => r.id);
const proj = (title: string) => one<{ id: string; org_id: string; firm_org_id: string }>(`SELECT id, org_id, firm_org_id FROM projects WHERE title = $1`, [title]);

try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
}

const U = { khalid: await uid("khalid@mizan.example"), noura: await uid("noura@mizan.example"), sara: await uid("sara@mizan.example"), abdullah: await uid("abdullah@nukhba.example") };
const P = { board: await proj("حوكمة مجلس الإدارة"), rawdah: await proj("الخطة الاستراتيجية ٢٠٢٧"), waha: await proj("حوكمة الشركة العائلية") };
if (await one<{ n: number } | undefined>(`SELECT 1 AS n FROM documents WHERE title = $1`, [CORPUS[0]!.title])) throw new Error("the test set is already seeded here");

await db.query("BEGIN");
// The consultants are staffed on their clients' projects (Khalid is already on Al-Waha's).
await db.query(`INSERT INTO project_members (project_id, user_id, is_lead, added_by) VALUES ($1,$2,true,$5),($3,$4,true,$5) ON CONFLICT DO NOTHING`, [P.board.id, U.khalid, P.rawdah.id, U.noura, U.sara]);

/** A two-page PDF: page 1 has a text layer (the cover letter), page 2 is only an image, as a scanner makes it. */
function scannedPdf(coverText: string): Buffer {
  const words = coverText.split(" ");
  const lines: string[] = [];
  for (const w of words) {
    if (lines.length && `${lines.at(-1)} ${w}`.length <= 80) lines[lines.length - 1] += ` ${w}`;
    else lines.push(w);
  }
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = `BT /F1 11 Tf 50 760 Td 15 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const draw = "q 495 0 0 742 50 50 cm /Im1 Do Q";
  const image = Buffer.alloc(64 * 64, 0xd0); // a grey 64x64 "photo of a page"
  const objects: (string | Buffer)[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${image.length} >>\nstream\n`), image, Buffer.from("\nendstream")]),
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let at = parts[0]!.length;
  for (const [i, o] of objects.entries()) {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o), Buffer.from("\nendobj\n")]);
    offsets.push(at);
    parts.push(b);
    at += b.length;
  }
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  return Buffer.concat(parts);
}

const body = (f: CorpusFile) =>
  f.kind === "scanned-pdf" ? { bytes: scannedPdf(f.pages[0]!.map((x) => x.text).join(" ")), type: "application/pdf" } : { bytes: Buffer.from(fileText(f), "utf-8"), type: "text/plain" };

const ids: Record<string, string> = {};
for (const f of CORPUS) {
  const project = P[f.project];
  const { bytes, type } = body(f);
  const key = crypto.randomUUID();
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: type }));
  const r = await one<{ id: string }>(
    `INSERT INTO documents (project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, ai_indexable, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$4,'deliverable','submitted',$5,$6,true,$7,$8,$9,$10,'clean') RETURNING id`,
    [project.id, project.org_id, project.firm_org_id, U[f.by], f.title, f.visibility, key, type, bytes.length, createHash("sha256").update(bytes).digest("hex")],
  );
  ids[f.key] = r.id;
}

// Actions with due dates around today (the firm's today), so "due this week" and "overdue across my clients" have right answers.
const rem = await one<{ id: string }>(
  `INSERT INTO recommendations (project_id, org_id, title, rationale, priority, due_date, created_by)
   VALUES ($1,$2,'تحديث سياسة المكافآت','صدر إصدار جديد من سياسة المكافآت يحل محل الإصدار الأول.','high', app_firm_today() + 30, $3) RETURNING id`,
  [P.board.id, P.board.org_id, U.khalid],
);
const wahaRec = await one<{ id: string }>(`SELECT id FROM recommendations WHERE project_id = $1 AND title = 'ميثاق العائلة'`, [P.waha.id]);
const act = (p: { id: string; org_id: string }, rec: string, title: string, status: string, days: number, owner: { user?: string; name?: string }) =>
  db.query(
    `INSERT INTO actions (project_id, org_id, recommendation_id, title, status, due_date, owner_user_id, owner_name, created_by)
     VALUES ($1,$2,$3,$4,$5, app_firm_today() + $6::int, $7, $8, $9)`,
    [p.id, p.org_id, rec, title, status, days, owner.user ?? null, owner.name ?? null, U.khalid],
  );
await act(P.board, rem.id, "مقارنة إصداري سياسة المكافآت", "in_progress", 2, { user: U.abdullah });
await act(P.board, rem.id, "إعداد مذكرة للجمعية العامة", "assigned", 4, { user: U.abdullah });
await act(P.board, rem.id, "تحديث سجل البدلات", "assigned", 20, { user: U.abdullah });
await act(P.waha, wahaRec.id, "إعداد لائحة الجمعية العائلية", "in_progress", 3, { name: "ماجد الواحي (مدير المكتب)" });
await act(P.waha, wahaRec.id, "مراجعة سجل المساهمين", "in_progress", -6, { name: "ماجد الواحي (مدير المكتب)" });

// People are registered in Arabic and the files spell them in English; companies go by short names (as seed.ts).
const alt: [string, string][] = [["reem@nukhba.example", "Reem Al-Harbi"], ["fahd@nukhba.example", "Fahd Al-Dosari"], ["abdullah@nukhba.example", "Abdullah Al-Mutairi"], ["khalid@mizan.example", "Khalid Al-Shammari"], ["hind@rawdah.example", "Hind Al-Zahrani"]];
for (const [email, name] of alt) await db.query(`UPDATE "user" SET name_alt = $2 WHERE email = $1`, [email, name]);
const short: [string, string[]][] = [["Al-Nukhba Holding", ["Al-Nukhba", "النخبة"]], ["Rawdah Foundation", ["Rawdah", "الروضة"]], ["Al-Waha Family Office", ["Al-Waha", "الواحة"]]];
for (const [name, names] of short) await db.query(`UPDATE organizations SET short_names = $2 WHERE name = $1`, [name, names]);

await db.query("COMMIT");
console.log(JSON.stringify({ ids, board: P.board.id, rawdah: P.rawdah.id, waha: P.waha.id, bucket }));
db.release();
await pool.end();
