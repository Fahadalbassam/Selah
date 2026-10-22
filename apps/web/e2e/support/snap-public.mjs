import { chromium } from "@playwright/test";
const [path, locale = "en"] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.addCookies([{ name: "selah_locale", value: locale, url: "http://localhost:3000" }]);
const p = await ctx.newPage(); await p.goto("http://localhost:3000" + path); await p.waitForTimeout(1000);
console.log(await p.locator("body").ariaSnapshot()); await b.close();
