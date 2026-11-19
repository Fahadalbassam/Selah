import { expect, test } from "@playwright/test";
import { ids, one } from "./support/db";
import { L } from "./support/msg";
import { open } from "./support/ui";

// A frozen progress report: created by the consultant, firm-only until a
// colleague approves it and it is sent from the confirmation dialog, then
// readable by the client's manager and nobody else.
const stamp = Date.now().toString(36);
const title = `October report ${stamp}`;
test.describe.configure({ mode: "serial" });
let reportId = "";

test("consultant freezes a report for this month (English)", async ({ browser }) => {
  const page = await open(browser, "khalid", "en");
  await page.goto(`/projects/${ids.board()}`);
  await page.getByRole("tab", { name: "Progress" }).click();
  await page.getByRole("button", { name: "New report" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Title").fill(title);
  await d.getByRole("button", { name: "Period starts" }).click();
  await page.locator(".rdp-root").last().locator("td:not([data-outside]) button:not([disabled])").first().click();
  await d.getByRole("button", { name: "Period ends" }).click();
  await page.locator(".rdp-root").last().locator("td[data-today] button").click();
  await d.getByRole("button", { name: "Create report" }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}/);
  reportId = page.url().split("/").pop()!;
  await page.screenshot({ path: "e2e-results/shots/consultant-en-report.png", fullPage: true });
});

test("the client can't read it until it's shared, then can (Arabic)", async ({ browser }) => {
  const t = L("ar");
  const reem = await open(browser, "reem", "ar");
  await reem.goto(`/reports/${reportId}`);
  await expect(reem.getByText(t("notFound.body"))).toBeVisible();

  // Khalid wrote it, so the firm admin approves it first (migration 0110), then he sends it from the confirmation dialog.
  const admin = await open(browser, "sara", "en");
  await admin.goto(`/reports/${reportId}`);
  await admin.getByRole("button", { name: "Approve" }).click();
  await admin.getByRole("alertdialog").or(admin.getByRole("dialog")).getByRole("button").filter({ hasText: /approve|continue|confirm/i }).last().click();
  await expect.poll(() => one(`select approved_at is not null from reports where id='${reportId}'`)).toBe("t");

  const page = await open(browser, "khalid", "en");
  await page.goto(`/reports/${reportId}`);
  await page.getByRole("button", { name: "Send to the client" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText(/will see it under Reports/)).toBeVisible();
  // Opening the dialog sent nothing.
  expect(await one(`select shared_at is null from reports where id='${reportId}'`)).toBe("t");
  await dlg.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => one(`select shared_at is not null from reports where id='${reportId}'`)).toBe("t");

  await reem.goto(`/reports/${reportId}`);
  await expect(reem.getByRole("heading", { name: title })).toBeVisible();
  await reem.screenshot({ path: "e2e-results/shots/client-ar-report.png", fullPage: true });

  const hind = await open(browser, "hind", "ar");
  await hind.goto(`/reports/${reportId}`);
  await expect(hind.getByText(t("notFound.body"))).toBeVisible();
});
