import { expect, request, test } from "@playwright/test";
import { ids, one } from "./support/db";
import { EICAR, pdf } from "./support/files";
import { authFile } from "./support/users";

// Upload scanning against the real clamd, signed download links against the
// real S3 store, and reusing a file as evidence (a copy, not a link).
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const api = (u: Parameters<typeof authFile>[0]) => request.newContext({ baseURL: BASE, storageState: authFile(u), extraHTTPHeaders: { origin: BASE } });

test("clamd refuses EICAR and nothing is stored", async () => {
  const r = await api("abdullah");
  const act = ids.action("صياغة مسودة الميثاق");
  const before = one(`select count(*) from documents`);
  for (const f of [
    { name: "eicar.txt", mimeType: "text/plain", buffer: EICAR },
    // EICAR only counts at the start of a file, so a .pdf wrapper isn't flagged by any scanner; not tested.
  ]) {
    const res = await r.post(`/api/actions/${act}/evidence`, { multipart: { file: f, submitForReview: "false" } });
    expect(res.status(), await res.text()).toBeGreaterThanOrEqual(400);
    expect(await res.text()).toMatch(/rejected/);
  }
  expect(one(`select count(*) from documents`)).toBe(before);
});

test("type checks: an executable renamed .pdf and an empty file are refused", async () => {
  const r = await api("abdullah");
  const act = ids.action("صياغة مسودة الميثاق");
  const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]);
  for (const f of [
    { name: "report.pdf", mimeType: "application/pdf", buffer: exe },
    { name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) },
    { name: "x.html", mimeType: "text/html", buffer: Buffer.from("<script>alert(1)</script>") },
  ]) {
    const res = await r.post(`/api/actions/${act}/evidence`, { multipart: { file: f, submitForReview: "false" } });
    expect(res.status(), `${f.name}: ${await res.text()}`).toBeGreaterThanOrEqual(400);
  }
});

test("a clean upload is scanned, downloadable through a short signed link, and the link can't be tampered with", async () => {
  const r = await api("abdullah");
  const act = ids.action("صياغة مسودة الميثاق");
  const up = await r.post(`/api/actions/${act}/evidence`, { multipart: { file: { name: "draft.pdf", mimeType: "application/pdf", buffer: pdf("draft charter") }, submitForReview: "false" } });
  expect(up.status(), await up.text()).toBeLessThan(300);
  const doc = one(`select id from documents where title='draft.pdf' order by created_at desc limit 1`);
  expect(one(`select scan_status from documents where id='${doc}'`)).toBe("clean");
  const link = await r.get(`/api/documents/${doc}/download`);
  expect(link.status()).toBe(200);
  const { url, expiresIn } = await link.json();
  expect(expiresIn).toBeLessThanOrEqual(300);
  const raw = await request.newContext();
  const got = await raw.get(url);
  expect(got.status()).toBe(200);
  expect((await got.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const tampered = url.replace(/X-Amz-Signature=([0-9a-f])/, (_: string, c: string) => `X-Amz-Signature=${c === "a" ? "b" : "a"}`);
  expect((await raw.get(tampered)).status()).toBe(403);
  // The bucket itself is private.
  const bucket = new URL(url);
  expect((await raw.get(`${bucket.origin}/${bucket.pathname.split("/")[1]}/`)).status()).toBe(403);
  expect((await raw.get(`${bucket.origin}${bucket.pathname}`)).status()).toBe(403);
  // The download was written to the audit trail.
  expect(Number(one(`select count(*) from audit_log where resource_id='${doc}'`))).toBeGreaterThan(0);
});

test("reusing a shared file as evidence attaches a copy, and a firm-private file can't be reused by the client", async () => {
  const r = await api("abdullah");
  const act = ids.action("صياغة مسودة الميثاق");
  const shared = ids.doc("draft.pdf"); // uploaded by the test above
  const res = await r.post(`/api/actions/${act}/evidence/existing`, { data: { documentId: shared, submitForReview: false } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const copy = (await res.json()).documentId as string;
  expect(copy).not.toBe(shared);
  expect(one(`select storage_key <> (select storage_key from documents where id='${shared}') from documents where id='${copy}'`)).toBe("t");
  const priv = ids.doc("ملاحظات داخلية للمستشار.docx");
  const res2 = await r.post(`/api/actions/${act}/evidence/existing`, { data: { documentId: priv, submitForReview: false } });
  expect([403, 404].includes(res2.status()), `private reuse -> ${res2.status()}`).toBe(true);
});
