#!/usr/bin/env node
// Page audit: the two floating tools in the sidebar (Files, the assistant),
// captured once they have finished loading. Reuses the first pass's sign-ins.
//   node scripts/review/capture-cards.mjs --base http://localhost:3010 --auth ../../docs/review/shots/phase1/.auth --out ../../docs/review/shots/phase1-cards
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3000");
const AUTH = resolve(arg("auth", "review-shots/.auth"));
const OUT = resolve(arg("out", "review-shots-cards"));
const ACCOUNTS = arg("accounts", "admin@mizan.test,lead@mizan.test,observer@mizan.test,admin@nukhba.test,manager@nukhba.test,owner@nukhba.test,manager@rawdah.test").split(",");
const CARDS = [["files", ["الملفات", "Files"], ".floating-card-files"], ["assistant", ["المساعد الذكي", "Assistant", "AI assistant"], ".floating-card-assistant"]];

const browser = await chromium.launch();
const out = [];
for (const account of ACCOUNTS) {
  for (const locale of ["ar", "en"]) {
    const dir = join(OUT, account.replace("@", "_at_"), locale);
    mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ storageState: join(AUTH, `${account}.json`), viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: "selah_locale", value: locale, url: BASE }]);
    const page = await ctx.newPage();
    for (const [name, labels, selector] of CARDS) {
      // A fresh page each time, so the other card is not still open.
      await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 120_000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      const button = page.locator('[data-slot="sidebar"] button, [data-slot="sidebar"] a').filter({ hasText: new RegExp(`^\\s*(${labels.join("|")})\\s*$`) }).first();
      if (!(await button.count())) { out.push({ account, locale, card: name, inSidebar: false }); continue; }
      const href = await button.getAttribute("href");
      await button.click();
      await page.waitForTimeout(5000);
      const shot = `${name}-1280.png`;
      await page.screenshot({ path: join(dir, shot) });
      const card = await page.evaluate((sel) => {
        const el = document.querySelector(sel) || document.querySelector('[class*="floating"]');
        if (!el) return null;
        const vis = (e) => e.getBoundingClientRect().width > 2;
        const r = el.getBoundingClientRect();
        return {
          size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          text: el.innerText.replace(/\s+/g, " ").slice(0, 3000),
          buttons: [...el.querySelectorAll("button, a[href]")].filter(vis).map((b) => (b.getAttribute("aria-label") || b.innerText || b.title || "").replace(/\s+/g, " ").trim()).filter(Boolean),
          fields: [...el.querySelectorAll("input, textarea, select")].filter(vis).length,
        };
      }, selector);
      out.push({ account, locale, card: name, inSidebar: true, linkTo: href, landedOn: page.url().replace(BASE, ""), shot: join(account.replace("@", "_at_"), locale, shot), found: card });
    }
    await ctx.close();
  }
  console.log(`${account} done`);
}
writeFileSync(join(OUT, "cards.json"), JSON.stringify(out, null, 2));
await browser.close();
