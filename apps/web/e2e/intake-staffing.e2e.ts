import { expect, test, type Page } from "@playwright/test";
import { one } from "./support/db";
import { L } from "./support/msg";
import { hydrated } from "./support/session";
import { open } from "./support/ui";

// Public inquiry -> triage -> owner -> conflict check -> discovery ->
// outcome -> client with a lead and a first project -> a consultant asks to
// join -> the lead approves -> the lead staffs a project.
const stamp = Date.now().toString(36);
const org = `Qimma Logistics ${stamp}`;
const project = `Qimma governance ${stamp}`;

async function pickNextMonth(page: Page, trigger: ReturnType<Page["getByRole"]>) {
  await trigger.click();
  const cal = page.locator(".rdp-root").last();
  await cal.locator("button.rdp-button_next").click();
  await cal.locator("td:not([data-outside]) button:not([disabled])").first().click();
}

test.describe.configure({ mode: "serial" });

test("a visitor sends the public inquiry form (English, then the sent page in Arabic)", async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: "Asia/Riyadh" });
  await ctx.addCookies([{ name: "selah_locale", value: "en", url: "http://localhost:3000" }]);
  const p = await ctx.newPage();
  await p.goto("/inquiry");
  await hydrated(p, "form");
  await p.getByLabel("Organisation name").fill(org);
  await p.getByRole("combobox", { name: "Sector" }).click();
  await p.getByRole("option").first().click();
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByLabel("Your name").fill("Faisal Test");
  await p.getByRole("combobox", { name: "Your role" }).click();
  await p.getByRole("option", { name: "Board member" }).click();
  await p.getByLabel("Work email").fill(`faisal-${stamp}@qimma.example`);
  // WhatsApp needs a number.
  await p.getByRole("radio", { name: "WhatsApp" }).click();
  await p.getByRole("button", { name: "Continue" }).click();
  await expect(p.getByText("Add the number we should call or message.")).toBeVisible();
  await p.getByLabel("WhatsApp number").fill("+966 55 000 0000");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByRole("checkbox", { name: "Corporate governance" }).click();
  await p.getByLabel("Why now?").fill("The board changes in January.");
  await p.getByRole("radio", { name: "Within 3 months" }).click();
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByRole("combobox", { name: "Ownership" }).click();
  await p.getByRole("option", { name: /several partners/ }).click();
  await p.getByRole("radio", { name: "10–49" }).click();
  await p.getByRole("radiogroup", { name: "Which generation runs the business today?" }).getByRole("radio", { name: "The second generation" }).click();
  await p.getByRole("radiogroup", { name: "A written strategy" }).getByRole("radio", { name: "No" }).click();
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByRole("button", { name: "Send inquiry" }).click();
  await expect(p.getByText(/privacy notice/i).first()).toBeVisible();
  await p.getByRole("checkbox", { name: /privacy notice/ }).click();
  await p.getByRole("button", { name: "Send inquiry" }).click();
  await expect(p.getByRole("heading").filter({ hasText: /thank|sent|received/i }).first()).toBeVisible();
  await p.screenshot({ path: "e2e-results/shots/inquiry-en-sent.png", fullPage: true });
  expect(one(`select count(*) from inquiries where org_name='${org}'`)).toBe("1");
});

test("the firm admin triages it, books discovery, records the outcome and makes it a client (English)", async ({ browser }) => {
  const page = await open(browser, "sara", "en");
  await page.goto("/inquiries");
  await page.getByRole("link", { name: org }).click();
  await page.getByRole("button", { name: "Mark as triaged" }).click();
  await expect(page.getByText("Triaged").first()).toBeVisible();
  await page.getByRole("button", { name: "Assign an owner" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Assign an owner" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Run the conflict search" }).click();
  await expect(page.getByRole("button", { name: "Search again" })).toBeVisible();
  await page.getByRole("button", { name: "Record the check" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Checked against clients and owners");
  await page.getByRole("dialog").getByRole("button", { name: "Record the check" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Book a discovery session" }).click();
  const d = page.getByRole("dialog");
  await pickNextMonth(page, d.getByRole("button", { name: "Date", exact: true }));
  await d.getByRole("button", { name: "Book a discovery session" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Record the outcome" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Good fit");
  await page.getByRole("dialog").getByRole("button", { name: "Record the outcome" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Make it a client" }).click();
  const c = page.getByRole("dialog");
  await c.getByRole("combobox", { name: "Lead consultant (optional)" }).click();
  await page.getByRole("option", { name: /نورة/ }).click();
  await c.getByRole("textbox", { name: "First project (optional)" }).fill(project);
  await c.getByRole("button", { name: "Make it a client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: org })).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/admin-en-new-client.png", fullPage: true });
});

test("a consultant asks to join the new client; the lead approves (Arabic)", async ({ browser }) => {
  const t = L("ar");
  const khalid = await open(browser, "khalid", "ar");
  await khalid.goto("/clients");
  const row = khalid.getByText(org, { exact: true }).locator("xpath=..");
  await row.getByRole("button", { name: t("staffing.requestJoin") }).click();
  await khalid.getByRole("dialog").getByRole("textbox").fill("لدي خبرة في الحوكمة");
  await khalid.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(row.getByText(t("staffing.pending"))).toBeVisible();
  // Before approval Khalid can't open the client's project.
  const projectId = one(`select id from projects where title='${project}'`);
  const before = await khalid.request.get(`/api/projects/${projectId}/progress`);
  expect([403, 404]).toContain(before.status());

  const noura = await open(browser, "noura", "ar");
  await noura.goto(`/clients/${one(`select id from organizations where name='${org}'`)}`);
  await noura.getByRole("button", { name: t("staffing.approve") }).click();
  await expect(noura.getByText(t("staffing.noRequests"))).toBeVisible();
  // The lead staffs Khalid on the project.
  await noura.goto(`/projects/${projectId}`);
  await noura.getByRole("tab", { name: t("staffing.projectTeam") }).click();
  await noura.getByRole("button", { name: t("staffing.staff") }).click();
  await noura.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(noura.getByRole("dialog")).toHaveCount(0);
  await expect(noura.getByRole("tabpanel").getByText("khalid@mizan.example")).toBeVisible();
  await noura.screenshot({ path: "e2e-results/shots/lead-ar-staffed.png", fullPage: true });
  const after = await khalid.request.get(`/api/projects/${projectId}/progress`);
  expect(after.status()).toBe(200);
});
