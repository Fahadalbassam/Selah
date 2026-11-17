#!/usr/bin/env node
// Page audit capture (docs/review/): signs in once as one account, then opens
// every page and tab that account can reach by following the links on the
// screen, in Arabic and English. For each page it saves the first screen at
// 1280x800 and (Arabic) at 768x1024, the whole page, and a record: what is on
// the first screen, how many buttons, links, fields, tabs and menu items it
// shows, console errors, and labels left in the other language.
//
// It only reads: it opens pages, tabs and menus, and never submits a form.
// (The one exception: with --accept-consent it accepts the first sign-in
// notices, after capturing that page, so the app behind them can be read.)
//
//   node scripts/review/capture.mjs --account admin@mizan.test \
//     --base http://localhost:3010 --out ../../docs/review/shots/phase1
//
// Options: --locales ar,en   --limit 140   --password <walkthrough password>
//          --accept-consent  --start /,/notifications

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "true" : process.argv[i + 1]) : fallback;
};
const ACCOUNT = arg("account");
if (!ACCOUNT) {
  console.error("--account is required");
  process.exit(1);
}
const BASE = arg("base", "http://localhost:3000");
const OUT = resolve(arg("out", "review-shots"));
const LOCALES = arg("locales", "ar,en").split(",");
const LIMIT = Number(arg("limit", "140"));
const PASSWORD = arg("password", process.env.WALKTHROUGH_PASSWORD || "123456789@Pass");
const ACCEPT_CONSENT = arg("accept-consent", "false") === "true";
const START = arg("start", "/,/notifications,/security,/help").split(",");
const CARDS = arg("cards", "false") === "true";
// Only the pages named in --start: do not follow the links on them.
const NO_FOLLOW = arg("no-follow", "false") === "true";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const SKIP = /^\/api\/|\/download|\/export|\/report$|\/sign-out|\.(pdf|xlsx|csv|ics|zip|docx)(\?|$)/;
// How many different records of one kind of page to open (states differ most on these).
const PER_KIND = { "/actions/:id": 9, "/projects/:id": 4, "/clients/:id": 4, "/recommendations/:id": 3, "/meetings/:id": 3, "/inquiries/:id": 3 };

const slug = (s) => s.replace(UUID, (m) => m.slice(0, 8)).replace(/[^a-z0-9؀-ۿ]+/gi, "_").replace(/^_|_$/g, "").slice(0, 90) || "home";
const kindOf = (path) => {
  const u = new URL(path, BASE);
  const q = [...u.searchParams.entries()].map(([k, v]) => `${k}=${v.replace(UUID, ":id")}`).sort().join("&");
  return u.pathname.replace(UUID, ":id") + (q ? `?${q}` : "");
};

/** Runs in the page: what is on the screen. */
function measure() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.value || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const main = document.querySelector("main") || document.body;
  const sidebar = document.querySelector('[data-slot="sidebar"]');
  // The page itself: not the top bar (language, theme, bell) and not Next's development badge.
  const inMain = (sel) => [...main.querySelectorAll(sel)].filter((el) => vis(el) && !el.closest("header, nextjs-portal"));
  const fold = innerHeight;
  const above = (els) => els.filter((e) => e.getBoundingClientRect().top < fold);
  const buttons = inMain('button:not([disabled]):not([role="tab"]), [role="button"], input[type="submit"]');
  const links = inMain("a[href]");
  const fields = inMain('input:not([type="hidden"]):not([type="submit"]), textarea, select, [role="combobox"]');
  const tabs = inMain('[role="tab"]');
  const menuTriggers = inMain('[aria-haspopup="menu"]');
  const tablist = main.querySelector('[role="tablist"]');
  const headings = inMain("h1, h2, h3, [data-slot='card-title']").map((h) => `${h.tagName.toLowerCase()}: ${label(h)}`);
  // Text whose top edge is on the first screen.
  const seen = new Set();
  const firstScreen = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let chars = 0;
  for (let n = walker.nextNode(); n && chars < 1800; n = walker.nextNode()) {
    const text = n.textContent.replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!text || !el || seen.has(text) || !vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.top >= fold || r.bottom <= 0) continue;
    seen.add(text);
    firstScreen.push(text);
    chars += text.length;
  }
  const chrome = [...buttons, ...tabs, ...links, ...inMain("h1, h2, h3, label, th")].map(label).filter(Boolean);
  const arabic = /[؀-ۿ]/;
  const latinWord = /[A-Za-z]{3,}/;
  const lang = document.documentElement.lang;
  const stray = [...new Set(chrome.filter((t) => (lang === "en" ? arabic.test(t) : latinWord.test(t) && !arabic.test(t))))].slice(0, 25);
  const body = document.body.innerText;
  const rawKeys = [...new Set((body.match(/\b[a-z]+(\.[a-zA-Z]+){1,}\b/g) || []).filter((k) => !/example|\.test$|\.(pdf|docx?|xlsx?|png|jpg|csv|txt|com|sa|org|net)$/.test(k)))].slice(0, 10);
  return {
    lang,
    dir: document.documentElement.dir,
    title: document.title,
    h1: label(document.querySelector("main h1") || document.querySelector("h1") || document.body).slice(0, 80),
    counts: {
      buttons: buttons.length, links: links.length, fields: fields.length, tabs: tabs.length, menuTriggers: menuTriggers.length,
      buttonsAbove: above(buttons).length, linksAbove: above(links).length, fieldsAbove: above(fields).length,
    },
    buttonLabels: buttons.map(label).filter(Boolean).slice(0, 80),
    tabLabels: tabs.map(label),
    tablistTop: tablist ? Math.round(tablist.getBoundingClientRect().top + scrollY) : null,
    headings: headings.slice(0, 60),
    firstScreen: firstScreen.join(" | ").slice(0, 2000),
    pageHeight: document.documentElement.scrollHeight,
    screens: Math.round((document.documentElement.scrollHeight / innerHeight) * 10) / 10,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    sidebar: sidebar ? [...sidebar.querySelectorAll("a[href], button")].filter(vis).map(label).filter(Boolean) : null,
    topbar: [...document.querySelectorAll("header a[href], header button")].filter(vis).map(label).filter(Boolean).slice(0, 20),
    strayLanguage: stray,
    rawKeys,
    textLength: main.innerText.length,
  };
}

async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function signIn(browser, stateFile) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ar" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const el = document.querySelector("form");
    return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
  });
  await page.locator("#email").fill(ACCOUNT);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 60_000 });
  await page.locator('[data-slot="sidebar"], #c-terms').first().waitFor({ timeout: 60_000 });
  await ctx.storageState({ path: stateFile });
  await ctx.close();
}

async function main() {
  const dir = join(OUT, ACCOUNT.replace("@", "_at_"));
  mkdirSync(join(OUT, ".auth"), { recursive: true });
  const stateFile = join(OUT, ".auth", `${ACCOUNT}.json`);
  const browser = await chromium.launch();
  if (!existsSync(stateFile)) await signIn(browser, stateFile);

  for (const locale of LOCALES) {
    const out = join(dir, locale);
    mkdirSync(out, { recursive: true });
    const ctx = await browser.newContext({ storageState: stateFile, viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: "selah_locale", value: locale, url: BASE }]);
    const page = await ctx.newPage();
    let events = [];
    page.on("pageerror", (e) => events.push({ kind: "pageerror", detail: e.message.slice(0, 400) }));
    page.on("console", (m) => { if (m.type() === "error") events.push({ kind: "console", detail: m.text().slice(0, 400) }); });
    page.on("response", (r) => { if (r.status() >= 400 && !/\/_next\/|favicon/.test(r.url())) events.push({ kind: `http${r.status()}`, detail: r.url().replace(BASE, "") }); });

    const records = [];
    const queue = [...START];
    const seen = new Set();
    const perKind = new Map();
    let n = 0;

    const capture = async (path, name, extra = {}) => {
      n++;
      const base = `${String(n).padStart(3, "0")}-${slug(name)}`;
      const m = await page.evaluate(measure).catch((e) => ({ error: String(e) }));
      await page.screenshot({ path: join(out, `${base}-1280.png`) }).catch(() => {});
      await page.screenshot({ path: join(out, `${base}-1280-full.png`), fullPage: true }).catch(() => {});
      let tablet = null;
      if (locale === "ar") {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.waitForTimeout(350);
        tablet = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, screens: Math.round((document.documentElement.scrollHeight / innerHeight) * 10) / 10 })).catch(() => null);
        await page.screenshot({ path: join(out, `${base}-768.png`) }).catch(() => {});
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(250);
      }
      // What hides behind the menu buttons (Arabic pass only: the count is the same in English).
      let menus = [];
      if (locale === "ar" && m.counts?.menuTriggers) {
        const triggers = page.locator('main [aria-haspopup="menu"]:visible');
        const count = Math.min(await triggers.count().catch(() => 0), 12);
        for (let i = 0; i < count; i++) {
          try {
            await triggers.nth(i).click({ timeout: 1500 });
            await page.waitForTimeout(200);
            const items = await page.locator('[role="menuitem"]:visible, [role="menuitemcheckbox"]:visible, [role="menuitemradio"]:visible').allInnerTexts();
            menus.push(items.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean));
            await page.keyboard.press("Escape");
            await page.waitForTimeout(150);
          } catch { /* a trigger that moved or is covered: skip it */ }
        }
      }
      const rec = {
        n, path, name, url: page.url().replace(BASE, ""), shot: `${base}-1280.png`, shotFull: `${base}-1280-full.png`, shotTablet: locale === "ar" ? `${base}-768.png` : null,
        ...extra, ...m, tablet, menus, menuItems: menus.flat().length, events,
      };
      events = [];
      records.push(rec);
      return rec;
    };

    const collectLinks = async () => {
      if (NO_FOLLOW) return;
      const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href"))).catch(() => []);
      for (const raw of new Set(hrefs)) {
        // Tabs are opened by clicking them below, so a link to one tab is the same page.
        const u = new URL(raw.split("#")[0], BASE);
        u.searchParams.delete("tab");
        const href = u.pathname + u.search;
        if (!href || SKIP.test(href) || href.startsWith("/sign-in") || seen.has(href) || queue.includes(href)) continue;
        const kind = kindOf(href);
        const count = perKind.get(kind) ?? 0;
        const max = UUID.test(href) ? (PER_KIND[kind] ?? 2) : 1;
        UUID.lastIndex = 0;
        if (count >= max) continue;
        perKind.set(kind, count + 1);
        queue.push(href);
      }
    };

    // The two floating tools every role has in the sidebar (Files, and the assistant where offered).
    if (CARDS) {
      await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 120_000 }).catch(() => {});
      await settle(page);
      for (const [name, labels] of [["files", ["الملفات", "Files"]], ["assistant", ["المساعد الذكي", "Assistant", "AI assistant"]]]) {
        const button = page.locator('[data-slot="sidebar"] button, [data-slot="sidebar"] a').filter({ hasText: new RegExp(`^\\s*(${labels.join("|")})\\s*$`) }).first();
        if (!(await button.count().catch(() => 0))) { records.push({ n: ++n, name: `card_${name}`, missing: true, events: [] }); continue; }
        try {
          await button.click({ timeout: 3000 });
          await page.waitForTimeout(1500);
          const shot = `${String(++n).padStart(3, "0")}-card_${name}-1280.png`;
          await page.screenshot({ path: join(out, shot) });
          const card = await page.evaluate(() => {
            const el = document.querySelector('[class*="floating-card"], [class*="surface-floating"], [role="dialog"]');
            if (!el) return null;
            const vis = (e) => e.getBoundingClientRect().width > 2;
            return {
              text: el.innerText.replace(/\s+/g, " ").slice(0, 2500),
              buttons: [...el.querySelectorAll("button, a[href]")].filter(vis).map((b) => (b.getAttribute("aria-label") || b.innerText || b.title || "").replace(/\s+/g, " ").trim()).filter(Boolean),
              fields: [...el.querySelectorAll("input, textarea, select")].filter(vis).length,
            };
          });
          records.push({ n, name: `card_${name}`, url: page.url().replace(BASE, ""), shot, card, events });
          events = [];
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
          if (new URL(page.url()).pathname !== "/") await page.goto(`${BASE}/`, { waitUntil: "load" }).catch(() => {});
        } catch (e) {
          records.push({ n: ++n, name: `card_${name}`, error: String(e).slice(0, 300), events: [] });
        }
      }
    }

    while (queue.length && n < LIMIT) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      const t0 = Date.now();
      const res = await page.goto(BASE + path, { waitUntil: "load", timeout: 120_000 }).catch((e) => { events.push({ kind: "goto", detail: String(e).slice(0, 300) }); return null; });
      await settle(page);
      const loadMs = Date.now() - t0;
      const landed = new URL(page.url()).pathname;
      if (landed === "/consent") {
        await capture(path, "consent", { status: res?.status() ?? null, loadMs });
        if (!ACCEPT_CONSENT) break;
        for (const box of await page.getByRole("checkbox").all()) await box.click();
        await page.locator('form button[type="submit"]').click();
        await page.waitForURL((url) => url.pathname !== "/consent", { timeout: 60_000 });
        await ctx.storageState({ path: stateFile });
        seen.delete(path);
        queue.unshift(path);
        continue;
      }
      await capture(path, path, { status: res?.status() ?? null, loadMs, redirectedTo: landed !== path.split("?")[0] ? landed : null });
      await collectLinks();
      // Each tab of the page's first tab row is its own screen.
      const tabs = page.locator('main [role="tablist"]').first().locator('[role="tab"]');
      const tabCount = await tabs.count().catch(() => 0);
      for (let i = 0; i < tabCount && n < LIMIT; i++) {
        const tab = tabs.nth(i);
        if ((await tab.getAttribute("aria-selected").catch(() => "true")) === "true") continue;
        const tabName = ((await tab.innerText().catch(() => "")) || `tab${i}`).replace(/\s+/g, " ").trim();
        try {
          await tab.click({ timeout: 3000 });
          await settle(page, 500);
          await capture(path, `${path}__tab_${tabName}`, { tab: tabName, tabIndex: i });
          await collectLinks();
        } catch (e) {
          events.push({ kind: "tab", detail: `${tabName}: ${String(e).slice(0, 200)}` });
        }
      }
    }
    writeFileSync(join(out, "pages.json"), JSON.stringify({ account: ACCOUNT, locale, base: BASE, captured: records.length, leftInQueue: queue.length, records }, null, 2));
    // A short index a person (or a helper) can scan before opening screenshots.
    const lines = records.map((r) => r.card !== undefined || r.missing || r.error ? `${String(r.n).padStart(3, "0")} | ${r.name} | ${r.missing ? "not in this role's sidebar" : r.error ? `error ${r.error}` : `buttons ${r.card?.buttons.length ?? "?"} fields ${r.card?.fields ?? "?"}`} | ${r.shot ?? "-"}` : `${String(r.n).padStart(3, "0")} | ${r.url}${r.tab ? ` [tab: ${r.tab}]` : ""} | status ${r.status ?? "-"} | h1: ${r.h1 ?? ""} | buttons ${r.counts?.buttons ?? "?"} (+${r.menuItems} in menus) links ${r.counts?.links ?? "?"} fields ${r.counts?.fields ?? "?"} tabs ${r.counts?.tabs ?? "?"} | ${r.screens ?? "?"} screens | tabs start ${r.tablistTop ?? "-"}px | events ${r.events.length} | ${r.shot}`);
    writeFileSync(join(out, "index.txt"), lines.join("\n"));
    console.log(`${ACCOUNT} ${locale}: ${records.length} screens captured, ${queue.length} left in queue`);
    await ctx.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(`${ACCOUNT}: ${e.stack || e}`);
  process.exit(1);
});
