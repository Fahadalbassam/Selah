import { expect, request, test, type Page } from "@playwright/test";
import { L } from "./support/msg";
import { acceptConsent, hydrated } from "./support/session";
import { open } from "./support/ui";

// Invitation and password reset end to end: the screen, the mail queue, the
// mail job, a real SMTP server (Mailpit), the link in the mail, sign-in.
const MAILPIT = "http://localhost:8025";
const stamp = Date.now().toString(36);
const invited = `new-${stamp}@nukhba.example`;
test.describe.configure({ mode: "serial" });

async function linkFromMail(to: string, path: string): Promise<string> {
  const api = await request.newContext();
  let id = "";
  await expect
    .poll(async () => {
      const r = await api.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
      const m = (await r.json()).messages ?? [];
      id = m[0]?.ID ?? "";
      return id;
    }, { timeout: 60_000, message: `mail to ${to}` })
    .not.toBe("");
  const msg = await (await api.get(`${MAILPIT}/api/v1/message/${id}`)).json();
  const url = (msg.Text as string).match(new RegExp(`https?://\\S+${path}\\S+`))?.[0];
  expect(url, msg.Text).toBeTruthy();
  return url!.replace(/[).,]+$/, "");
}

async function setPassword(page: Page, pw: string) {
  await hydrated(page, "form");
  await page.locator("#password").fill(pw);
  await page.locator("#confirm").fill(pw);
  await page.locator('form button[type="submit"]').click();
}

test("client admin invites a new action owner, who accepts from the mail and signs in (Arabic)", async ({ browser }) => {
  const t = L("ar");
  const email = invited;
  const admin = await open(browser, "fahd", "ar");
  await admin.goto("/team");
  await admin.getByRole("button", { name: t("people.invite") }).first().click();
  const dlg = admin.getByRole("dialog");
  await dlg.locator("#f-name").fill("موظف جديد");
  await dlg.locator("#f-email").fill(email);
  await dlg.locator('button[type="submit"]').click();
  await expect(admin.getByRole("dialog")).toHaveCount(0);
  await admin.screenshot({ path: "e2e-results/shots/client-admin-ar-invited.png", fullPage: true });

  const link = await linkFromMail(email, "/invite/");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(new URL(link).pathname);
  await setPassword(page, "New-Owner-Pass-2026!");
  await page.waitForURL(/sign-in/);
  await hydrated(page, "form");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("New-Owner-Pass-2026!");
  await page.locator('form button[type="submit"]').click();
  // A new account accepts the terms and notices before anything else.
  await page.waitForURL(/\/consent/);
  await page.screenshot({ path: "e2e-results/shots/consent-first-sign-in.png", fullPage: true });
  await acceptConsent(page);
  await expect(page.locator("body")).toContainText(email);
});

test("forgotten password: mail, reset link, new password works, old one doesn't, link is single-use", async ({ browser }) => {
  // The person invited above, so no seeded user's sessions are ended.
  const email = invited;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/forgot-password");
  await hydrated(page, "form");
  await page.locator("#email").fill(email);
  await page.locator('form button[type="submit"]').click();
  const link = await linkFromMail(email, "/reset-password/");
  await page.goto(new URL(link).pathname + new URL(link).search);
  const next = `Reset-Pass-${stamp}!`;
  await setPassword(page, next);
  await page.waitForURL(/sign-in/);
  // The link can't be used twice.
  await page.goto(new URL(link).pathname + new URL(link).search);
  await setPassword(page, "Another-Pass-2026!!");
  await expect(page.locator("form .text-destructive")).toBeVisible();
  await page.goto("/sign-in");
  await hydrated(page, "form");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("New-Owner-Pass-2026!");
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator("form .text-destructive")).toBeVisible();
  await page.locator("#password").fill(next);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
});
