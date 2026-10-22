import { expect, request, test } from "@playwright/test";
import { ids, one } from "./support/db";
import { L } from "./support/msg";
import { hydrated } from "./support/session";
import { open, toastSaved } from "./support/ui";
import { authFile } from "./support/users";

// The plan screens around the core flow: what a client sees of the firm's
// findings, firm-only notes on an action, and the client contacts list.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const stamp = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

test("a firm-only finding never reaches the client; a shared one does (Arabic)", async ({ browser }) => {
  const t = L("ar");
  const shared = `ملاحظة مشتركة ${stamp}`;
  const internal = `ملاحظة داخلية ${stamp}`;
  const page = await open(browser, "khalid", "ar");
  await page.goto(`/projects/${ids.board()}`);
  await hydrated(page, "main");
  for (const [title, vis] of [
    [shared, t("visibility.shared")],
    [internal, t("visibility.firm_private")],
  ] as const) {
    await page.getByRole("button", { name: t("plan.findings.add") }).click();
    const d = page.getByRole("dialog");
    await d.locator("#f-title").fill(title);
    await d.locator("#f-visibility").click();
    await page.getByRole("option", { name: vis }).click();
    await d.getByRole("button", { name: t("plan.findings.add") }).click();
    await toastSaved(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(page.getByRole("listitem").filter({ hasText: internal }).getByText(t("visibility.firm_private"))).toBeVisible();
  await page.context().close();

  for (const u of ["reem", "fahd"] as const) {
    const client = await open(browser, u, "ar");
    await client.goto(`/projects/${ids.board()}`);
    await expect(client.getByText(shared)).toBeVisible();
    await expect(client.getByText(internal)).toHaveCount(0);
    // No way to add to the firm's plan.
    await expect(client.getByRole("button", { name: t("plan.findings.add") })).toHaveCount(0);
    await expect(client.getByRole("button", { name: t("plan.rec.add") })).toHaveCount(0);
    await client.context().close();
  }
});

test("firm notes on an action are for the firm only (English, then the owner in Arabic)", async ({ browser }) => {
  const t = L("en");
  const act = ids.action("رفع الميثاق المعتمد");
  const note = `Called the secretary ${stamp}; the signed copy is with legal.`;
  const page = await open(browser, "khalid", "en");
  await page.goto(`/actions/${act}`);
  await hydrated(page, "main");
  await page.getByRole("button", { name: t("action.notes.add") }).click();
  const d = page.getByRole("dialog");
  await expect(d.locator("#f-body")).toHaveAttribute("placeholder", t("action.notes.placeholder"));
  await d.locator("#f-body").fill(note);
  await d.getByRole("button", { name: t("action.notes.add") }).click();
  await toastSaved(page);
  await expect(page.getByText(note)).toBeVisible();
  await page.context().close();

  for (const u of ["abdullah", "reem", "fahd"] as const) {
    const client = await open(browser, u, "ar");
    await client.goto(`/actions/${act}`);
    await expect(client.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(client.getByText(note)).toHaveCount(0);
    await expect(client.getByText(L("ar")("action.notes.title"))).toHaveCount(0);
    await client.context().close();
    const api = await request.newContext({ baseURL: BASE, storageState: authFile(u), extraHTTPHeaders: { origin: BASE } });
    expect([403, 404]).toContain((await api.get(`/api/actions/${act}/notes`)).status());
    expect([403, 404]).toContain((await api.post(`/api/actions/${act}/notes`, { data: { body: "client probe" } })).status());
  }
});

test("the consultant keeps the client's contacts: add, edit, remove (English)", async ({ browser }) => {
  const t = L("en");
  const org = ids.org("Al-Nukhba Holding");
  const name = `Faisal Contact ${stamp}`;
  const page = await open(browser, "khalid", "en");
  await page.goto(`/clients/${org}`);
  await hydrated(page, "main");
  await page.getByRole("button", { name: t("clients.contacts.add") }).click();
  let d = page.getByRole("dialog");
  await d.locator("#f-name").fill(name);
  await d.locator("#f-title").fill("Board secretary");
  await d.locator("#f-email").fill("not-an-email");
  await d.getByRole("button", { name: t("clients.contacts.add") }).click();
  await expect(d.getByRole("alert")).toHaveText(t("common.errors.invalid"));
  await d.locator("#f-email").fill(`faisal-${stamp}@nukhba.example`);
  await d.getByRole("button", { name: t("clients.contacts.add") }).click();
  await toastSaved(page);
  const row = page.locator("div").filter({ hasText: name }).filter({ has: page.getByRole("button", { name: t("clients.contacts.edit") }) }).last();
  await expect(row.getByText("Board secretary")).toBeVisible();

  // Edit: clear the email, so the list says invites can't reach them.
  await row.getByRole("button", { name: t("clients.contacts.edit") }).click();
  d = page.getByRole("dialog");
  await expect(d.locator("#f-name")).toHaveValue(name);
  await d.locator("#f-email").fill("");
  await d.getByRole("button", { name: t("assessment.question.save") }).click();
  await toastSaved(page);
  await expect(row.getByText(t("clients.contacts.noEmail"))).toBeVisible();
  expect(one(`select coalesce(email,'∅') from client_contacts where name='${name}'`)).toBe("∅");
  expect(one(`select created_by is not null from client_contacts where name='${name}'`)).toBe("t");
  await page.screenshot({ path: "e2e-results/shots/consultant-en-contacts.png" });

  await row.getByRole("button", { name: t("clients.contacts.remove") }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: t("common.continue") }).click();
  await expect(page.getByText(name)).toHaveCount(0);
  expect(one(`select count(*) from client_contacts where name='${name}'`)).toBe("0");
  await page.context().close();

  // A consultant who isn't on the client's team reads nothing.
  const noura = await request.newContext({ baseURL: BASE, storageState: authFile("noura"), extraHTTPHeaders: { origin: BASE } });
  expect([403, 404]).toContain((await noura.get(`/api/clients/${org}/contacts`)).status());
});
