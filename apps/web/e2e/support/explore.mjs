// Dev helper: run steps as a user and print the dialog or main snapshot after the last step.
// node e2e/support/explore.mjs <user> <path> <locale> '<js steps using p>'
import { chromium } from "@playwright/test";
const [user, path, locale, steps] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: `e2e/.auth/${user}.json`, viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "selah_locale", value: locale, url: "http://localhost:3000" }]);
const p = await ctx.newPage();
p.on("response", (r) => { if (r.url().includes("/api/") && r.request().method() !== "GET") r.text().then((t) => console.log("API", r.status(), r.request().method(), r.url().replace("http://localhost:3000", ""), t.slice(0, 160))).catch(() => {}); });
await p.goto("http://localhost:3000" + path);
await p.waitForFunction(() => Object.keys(document.querySelector("main") ?? {}).length >= 0);
await p.waitForTimeout(1500);
const fn = new Function("p", `return (async () => { ${steps} })()`);
await fn(p);
await p.waitForTimeout(1200);
const d = p.getByRole("dialog");
const snap = (await d.count()) ? await d.last().ariaSnapshot() : await p.locator("main main, main").first().ariaSnapshot();
console.log(snap.split("\n").filter((l) => !l.includes("/url")).join("\n").slice(0, 6000));
if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT, fullPage: true });
await b.close();
