import { expect, type Browser, type Page } from "@playwright/test";
import { setLocale } from "./session";
import { authFile, type UserKey } from "./users";

export async function open(browser: Browser, u: UserKey, locale: "ar" | "en", theme: "light" | "dark" = "light"): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(u), colorScheme: theme, viewport: { width: 1440, height: 900 }, timezoneId: "Asia/Riyadh" });
  await setLocale(ctx, locale);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${u}] pageerror: ${e.message}`));
  return page;
}

/** Opens a date field's calendar, goes to next month and picks its first open day. */
export async function pickNextMonthDay(page: Page, fieldId: string) {
  await page.locator(`#${fieldId}`).click();
  const cal = page.locator("[data-slot=calendar], .rdp-root").last();
  await cal.locator("button.rdp-button_next, button[aria-label*='next' i], button[aria-label*='التالي']").first().click();
  await cal.locator("td:not([data-outside]) button:not([disabled])").first().click();
}

export async function toastSaved(page: Page) {
  await expect(page.locator("[data-slot=toast]").first()).toBeVisible();
}
