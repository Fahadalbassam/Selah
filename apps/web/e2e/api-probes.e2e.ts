import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { ids, one } from "./support/db";
import { authFile, type UserKey } from "./support/users";

// Cross-tenant and permission probes through the real HTTP API (the same
// routes the browser uses), as each seeded user. Denials must be 404 (no
// existence leak) or 403, never data.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const as = (u: UserKey | null): Promise<APIRequestContext> =>
  request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE }, ...(u ? { storageState: authFile(u) } : {}) });
const denied = (s: number) => [401, 403, 404].includes(s);

test.describe("permission probes", () => {
  let board: string, rawdah: string, internal: string, act: string, privDoc: string, sharedDoc: string, rec: string;
  test.beforeAll(() => {
    board = ids.board();
    rawdah = ids.rawdah();
    internal = ids.internal();
    act = ids.action("رفع الميثاق المعتمد");
    rec = ids.rec("اعتماد ميثاق مجلس الإدارة");
    privDoc = ids.doc("ملاحظات داخلية للمستشار.docx");
    sharedDoc = ids.doc("تقرير تقييم الحوكمة.pdf");
  });

  test("signed-out callers get 401 on every API", async () => {
    const r = await as(null);
    for (const p of [`/api/projects/${board}/progress`, `/api/actions/${act}`, `/api/notifications`, `/api/files`, `/api/assistant/conversations`]) {
      expect((await r.get(p)).status(), p).toBe(401);
    }
  });

  test("another client's manager can't read, write or download Al-Nukhba's records", async () => {
    const r = await as("hind");
    for (const p of [`/api/projects/${board}/progress`, `/api/projects/${board}/trace`, `/api/actions/${act}`, `/api/documents/${sharedDoc}/download`, `/api/projects/${board}/metrics`]) {
      const res = await r.get(p);
      expect(denied(res.status()), `${p} -> ${res.status()}`).toBe(true);
    }
    const writes = [
      r.post(`/api/actions/${act}/updates`, { data: { body: "probe" } }),
      r.post(`/api/actions/${act}/transition`, { data: { to: "verified_complete" } }),
      r.post(`/api/projects/${board}/recommendations`, { data: { title: "probe" } }),
      r.post(`/api/actions/${act}/deadline-requests`, { data: { proposedDueDate: "2027-01-01", reason: "probe" } }),
      r.post(`/api/assistant/query`, { data: { projectId: board, question: "ما هي التوصيات؟" } }),
    ];
    for (const res of await Promise.all(writes)) expect(denied(res.status()), `${res.url()} -> ${res.status()}`).toBe(true);
  });

  test("a consultant not staffed on a client sees nothing of it", async () => {
    const r = await as("noura"); // leads Rawdah, staffed on Waha; not on Al-Nukhba
    for (const p of [`/api/projects/${board}/progress`, `/api/actions/${act}`, `/api/documents/${sharedDoc}/download`]) {
      const res = await r.get(p);
      expect(denied(res.status()), `${p} -> ${res.status()}`).toBe(true);
    }
    const q = await r.post(`/api/assistant/query`, { data: { projectId: board, question: "summarise the charter" } });
    expect(denied(q.status()), `assistant -> ${q.status()}`).toBe(true);
  });

  test("client users can't open firm-private files, internal projects or firm-only routes", async () => {
    for (const u of ["fahd", "reem", "abdullah"] as const) {
      const r = await as(u);
      const probes = [`/api/documents/${privDoc}/download`, `/api/projects/${internal}/progress`, `/api/team/metrics`, `/api/intake/inquiries`, `/api/actions/${act}/notes`, `/api/firm/settings`];
      for (const p of probes) {
        const res = await r.get(p);
        expect(denied(res.status()), `${u} ${p} -> ${res.status()}`).toBe(true);
      }
    }
  });

  test("client users can't do the consultant's part", async () => {
    for (const u of ["fahd", "reem", "abdullah"] as const) {
      const r = await as(u);
      const res = await Promise.all([
        r.post(`/api/projects/${board}/recommendations`, { data: { title: "probe" } }),
        r.post(`/api/recommendations/${rec}/actions`, { data: { title: "probe" } }),
        r.post(`/api/actions/${act}/transition`, { data: { to: "verified_complete" } }),
        r.post(`/api/projects/${board}/members`, { data: { userId: ids.user("noura@mizan.example") } }),
        r.post(`/api/clients/${ids.org("Al-Nukhba Holding")}/consultants`, { data: { userId: ids.user("noura@mizan.example") } }),
      ]);
      for (const x of res) expect(denied(x.status()), `${u} ${x.url()} -> ${x.status()}`).toBe(true);
    }
  });

  test("a consultant can't staff themselves or approve their own join", async () => {
    const r = await as("noura");
    const nukhba = ids.org("Al-Nukhba Holding");
    const res = await Promise.all([
      r.post(`/api/clients/${nukhba}/consultants`, { data: { userId: ids.user("noura@mizan.example") } }),
      r.put(`/api/clients/${nukhba}/lead`, { data: { userId: ids.user("noura@mizan.example") } }),
      r.post(`/api/projects/${board}/members`, { data: { userId: ids.user("noura@mizan.example") } }),
    ]);
    for (const x of res) expect(denied(x.status()), `${x.url()} -> ${x.status()}`).toBe(true);
  });

  test("cross-site writes are refused (CSRF)", async () => {
    const r = await request.newContext({ baseURL: BASE, storageState: authFile("khalid"), extraHTTPHeaders: { origin: "https://evil.example" } });
    const res = await r.post(`/api/actions/${act}/updates`, { data: { body: "csrf probe" } });
    expect(res.status()).toBe(403);
  });

  test("password guesses are capped per account, whatever X-Forwarded-For says (bug #8)", async () => {
    const r = await as(null);
    // An address nobody has, so no seeded account is locked out by the probe.
    const email = `probe-${Date.now()}@nobody.example`;
    const codes: number[] = [];
    for (let i = 1; i <= 12; i++) {
      const res = await r.post("/api/auth/sign-in/email", {
        headers: { "x-forwarded-for": `10.9.${i}.${i}` },
        data: { email, password: "not-the-password-1" },
      });
      codes.push(res.status());
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  test("a garbage or foreign id is a 404, not a 500", async () => {
    const r = await as("khalid");
    for (const p of [`/api/actions/00000000-0000-0000-0000-000000000000`, `/api/actions/not-a-uuid`, `/api/projects/${rawdah}/progress`, `/api/documents/00000000-0000-0000-0000-000000000000/download`]) {
      const res = await r.get(p);
      expect([400, 404].includes(res.status()), `${p} -> ${res.status()}`).toBe(true);
    }
  });

  test("the action owner can't move an action straight to verified, or edit another owner's action", async () => {
    const r = await as("abdullah");
    const res = await r.post(`/api/actions/${act}/transition`, { data: { to: "verified_complete" } });
    expect(denied(res.status()) || res.status() === 409, `-> ${res.status()}`).toBe(true);
    const reemsAction = ids.action("عرض المسودة على المجلس");
    const upd = await r.post(`/api/actions/${reemsAction}/transition`, { data: { to: "in_progress" } });
    expect(denied(upd.status()) || upd.status() === 409, `-> ${upd.status()}`).toBe(true);
  });

  test("assessment scores are firm-only", async () => {
    const assessment = one(`select id from assessments limit 1`);
    for (const u of ["fahd", "reem"] as const) {
      const r = await as(u);
      const res = await r.get(`/api/assessments/${assessment}`);
      const text = res.ok() ? await res.text() : "";
      expect(/"score|maturity|percent/i.test(text), `${u} sees scores: ${text.slice(0, 200)}`).toBe(false);
    }
  });

  test("files list never includes another tenant's files", async () => {
    const r = await as("hind");
    const res = await r.get(`/api/files`);
    const text = await res.text();
    expect(text).not.toContain(sharedDoc);
    expect(text).not.toContain(privDoc);
    expect(text).not.toContain("حوكمة مجلس الإدارة");
  });
});

test("the Files card never lists firm-private files to client users", async () => {
  const priv = (await import("./support/db")).sql<string[]>(`select id, title from documents where visibility='firm_private'`);
  expect(priv.length).toBeGreaterThan(0);
  for (const u of ["fahd", "reem", "abdullah"] as const) {
    const r = await as(u);
    const text = await (await r.get(`/api/files`)).text();
    for (const [id, title] of priv) {
      expect(text, `${u} sees ${title}`).not.toContain(id!);
    }
  }
});
