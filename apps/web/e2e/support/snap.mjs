// Dev helper: print the accessibility snapshot of a page as a user.
// node e2e/support/snap.mjs <user> <path> [en|ar] [click-text...]
import { chromium } from "@playwright/test";
const [user, path, locale = "en", ...clicks] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: `e2e/.auth/${user}.json`, viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "selah_locale", value: locale, url: "http://localhost:3000" }]);
const p = await ctx.newPage();
await p.goto("http://localhost:3000" + path);
await p.waitForTimeout(1500);
for (const c of clicks) { await p.getByText(c, { exact: true }).first().click(); await p.waitForTimeout(800); }
console.log(await p.locator("body").ariaSnapshot());
await b.close();
