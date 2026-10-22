import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { freshTotp } from "./totp";
import { PASSWORD, SECRETS, USERS, type UserKey } from "./users";

export const secrets = (): Record<string, string> => (existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, "utf8")) : {});
export function saveSecret(u: UserKey, secret: string) {
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(SECRETS, JSON.stringify({ ...secrets(), [u]: secret }, null, 2));
}

export async function setLocale(ctx: BrowserContext, locale: "ar" | "en", baseURL = "http://localhost:3000") {
  await ctx.addCookies([{ name: "selah_locale", value: locale, url: baseURL }]);
}

/** Waits until React has taken over an element, so typing and submits reach the app, not the bare HTML form. */
export async function hydrated(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
  }, selector);
}

let lastCode: string | undefined;

/** Signs in through the form; sets up two-factor on first use for roles that need it. */
export async function signIn(page: Page, u: UserKey, password = PASSWORD) {
  await page.goto("/sign-in");
  await hydrated(page, "form");
  await page.locator("#email").fill(USERS[u].email);
  await page.locator("#password").fill(password);
  await page.locator('form button[type="submit"]').click();
  const secret = secrets()[u];
  if (USERS[u].twoFactor && secret) {
    await page.locator("#code").waitFor();
    lastCode = await freshTotp(secret, lastCode);
    await page.locator("#code").fill(lastCode);
    await page.locator('form button[type="submit"]').click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  if (USERS[u].twoFactor && !secret) await enrolTwoFactor(page, u, password);
}

export async function enrolTwoFactor(page: Page, u: UserKey, password = PASSWORD) {
  await expect(page).toHaveURL(/\/security/);
  await page.locator("#password").fill(password);
  await page.locator('form button[type="submit"]').click();
  const key = page.locator("code").first();
  await key.waitFor();
  const secret = (await key.innerText()).trim();
  saveSecret(u, secret);
  lastCode = await freshTotp(secret, lastCode);
  await page.locator("#code").fill(lastCode);
  await page.locator('form button[type="submit"]').click();
  await page.locator("ul li").first().waitFor();
  await page.getByRole("button").last().click(); // "I've saved them"
  await page.waitForURL((url) => !url.pathname.startsWith("/security"));
}
