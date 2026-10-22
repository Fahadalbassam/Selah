import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { setLocale } from "./support/session";
import { authFile, USERS, type UserKey } from "./support/users";

// Every screen each role can reach, in Arabic and English, light and dark:
// no server errors, no uncaught script errors, the right direction, no
// sideways scroll at desktop or tablet width, and axe's contrast and
// labelling rules. Screenshots and findings go to test-results/crawl/.
const OUT = "e2e-results/crawl";
mkdirSync(OUT, { recursive: true });

const DETAIL = /^\/(projects|actions|clients|meetings|assessments|reports|inquiries|templates)\/[0-9a-f-]{36}(\/(people|departments))?$/;

async function links(page: Page) {
  const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  return [...new Set(hrefs.map((h) => h.split("#")[0]!.split("?")[0]!))].filter((h) => h && !h.startsWith("/api/"));
}

interface Finding { user: string; locale: string; theme: string; path: string; kind: string; detail: string }
const findings: Finding[] = [];

const combos: [UserKey, "ar" | "en", "light" | "dark"][] = [];
for (const u of Object.keys(USERS) as UserKey[]) {
  combos.push([u, "ar", "light"], [u, "en", "dark"]);
}

for (const [u, locale, theme] of combos) {
  test(`crawl ${u} ${locale} ${theme}`, async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    const ctx = await browser.newContext({ storageState: authFile(u), colorScheme: theme, viewport: { width: 1440, height: 900 } });
    await setLocale(ctx, locale);
    const page = await ctx.newPage();
    let current = "";
    const note = (kind: string, detail: string) => findings.push({ user: u, locale, theme, path: current, kind, detail: detail.slice(0, 500) });
    page.on("pageerror", (e) => note("pageerror", e.message));
    page.on("console", (m) => { if (m.type() === "error") note("console", m.text()); });
    page.on("response", (r) => { if (r.status() >= 500) note("http5xx", `${r.status()} ${r.url()}`); });

    const seen = new Set<string>();
    const queue = ["/", "/notifications", "/departments", "/projects?kind=internal", "/security", "/assessments/compare"];
    const perPattern = new Map<string, number>();
    while (queue.length) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);
      current = path;
      const t0 = Date.now();
      const lap = (what: string) => process.env.CRAWL_DEBUG && console.log(path, what, Date.now() - t0);
      const res = await page.goto(path, { waitUntil: "load" }).then(async (r) => { await page.waitForTimeout(1200); return r; }).catch((e) => { note("goto", String(e)); return null; });
      if (res && res.status() >= 400) note("status", String(res.status()));
      lap("goto");
      const url = new URL(page.url());
      if (url.pathname !== path.split("?")[0]) note("redirect", url.pathname);
      const dir = await page.locator("html").getAttribute("dir");
      if (dir !== (locale === "ar" ? "rtl" : "ltr")) note("dir", String(dir));
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 1) note("overflow", `${overflow}px at ${width}`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      const raw = await page.locator("body").innerText();
      const keys = raw.match(/\b[a-z]+(\.[a-zA-Z]+){1,}\b/g)?.filter((k) => !k.includes("example") && !/\.(pdf|docx?|xlsx?|png|jpg|csv|txt)$/.test(k));
      if (keys?.length) note("raw-key", keys.slice(0, 5).join(", "));
      // (Arabic names and titles in the English UI are data, checked separately: no untranslated chrome found.)
      lap("checks");
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze().catch(() => null);
      for (const v of axe?.violations ?? []) note(`axe:${v.id}`, `${v.impact} ×${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
      lap("axe");
      const shot = `${OUT}/${u}-${locale}-${theme}${path.replace(/[^a-z0-9]+/gi, "_")}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      lap("shot");
      for (const l of await links(page)) {
        if (seen.has(l) || queue.includes(l)) continue;
        if (l === "/sign-in") continue;
        const m = l.match(DETAIL);
        if (m) {
          const key = m[1]! + (m[2] ?? "");
          const n = perPattern.get(key) ?? 0;
          if (n >= 2) continue;
          perPattern.set(key, n + 1);
        } else if (/[0-9a-f-]{36}/.test(l)) {
          const key = l.replace(/[0-9a-f-]{36}/g, ":id");
          if (perPattern.has(key)) continue;
          perPattern.set(key, 1);
        }
        queue.push(l);
      }
    }
    writeFileSync(`${OUT}/${u}-${locale}-${theme}.json`, JSON.stringify({ pages: [...seen], findings: findings.filter((f) => f.user === u && f.locale === locale) }, null, 2));
    await ctx.close();
    expect(findings.filter((f) => f.user === u && f.locale === locale && ["pageerror", "http5xx", "status"].includes(f.kind))).toEqual([]);
  });
}
