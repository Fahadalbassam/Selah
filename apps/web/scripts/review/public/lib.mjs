// Shared helpers for the signed-out page audit (docs/review/work/audit-public.md).
// One browser, one page at a time. Records go to docs/review/shots/phase1/public/<ar|en>/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

export const BASE = "http://localhost:3010";
export const MAIL = "http://localhost:8035";
export const OUT = resolve("../../docs/review/shots/phase1/public");
export const AUTH = resolve("../../docs/review/shots/phase1/.auth");
export { chromium };

/** Runs in the page: what is on the screen (same counts as scripts/review/capture.mjs). */
export function measure() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.value || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const main = document.querySelector("main") || document.body;
  const inMain = (sel) => [...main.querySelectorAll(sel)].filter((el) => vis(el) && !el.closest("header, nextjs-portal"));
  const fold = innerHeight;
  const above = (els) => els.filter((e) => e.getBoundingClientRect().top < fold);
  const buttons = inMain('button:not([disabled]):not([role="tab"]), [role="button"], input[type="submit"]');
  const links = inMain("a[href]");
  const fields = inMain('input:not([type="hidden"]):not([type="submit"]), textarea, select, [role="combobox"]');
  const tabs = inMain('[role="tab"]');
  const menuTriggers = inMain('[aria-haspopup="menu"]');
  const headings = inMain("h1, h2, h3, [data-slot='card-title']").map((h) => `${h.tagName.toLowerCase()}: ${label(h)}`);
  const seen = new Set();
  const firstScreen = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let chars = 0;
  for (let n = walker.nextNode(); n && chars < 1800; n = walker.nextNode()) {
    const text = n.textContent.replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!text || !el || seen.has(text) || !vis(el) || el.closest("script, style, nextjs-portal")) continue;
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
    linkLabels: links.map((a) => `${label(a)} -> ${(a.getAttribute("href") || "").replace(/[A-Za-z0-9_-]{20,}/g, "<token>")}`).slice(0, 40),
    headings: headings.slice(0, 60),
    firstScreen: firstScreen.join(" | ").slice(0, 2000),
    pageHeight: document.documentElement.scrollHeight,
    screens: Math.round((document.documentElement.scrollHeight / innerHeight) * 10) / 10,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    topbar: [...document.querySelectorAll("header a[href], header button")].filter(vis).map(label).filter(Boolean).slice(0, 20),
    strayLanguage: stray,
    rawKeys,
    solidButtons: [...document.querySelectorAll('[data-slot="button"], button')].filter((b) => vis(b) && !b.closest("nextjs-portal") && (b.getAttribute("data-variant") === "default" || /\bbg-primary\b/.test(String(b.className)))).map(label),
    textLength: main.innerText.length,
  };
}

export async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/** Waits until React has taken over the first form (a click before that submits natively). */
export async function hydrated(page, sel = "form") {
  await page.waitForFunction((s) => {
    const el = document.querySelector(s);
    return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
  }, sel, { timeout: 30_000 });
}

/** A browser context for one language (and optionally dark mode or a stored session). */
export async function context(browser, locale, { dark = false, storageState } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: dark ? "dark" : "light", ...(storageState ? { storageState } : {}) });
  await ctx.addCookies([{ name: "selah_locale", value: locale, url: BASE }]);
  const page = await ctx.newPage();
  const events = [];
  page.on("pageerror", (e) => events.push({ kind: "pageerror", detail: e.message.slice(0, 400) }));
  page.on("console", (m) => { if (m.type() === "error") events.push({ kind: "console", detail: m.text().slice(0, 400) }); });
  page.on("response", (r) => { if (r.status() >= 400 && !/\/_next\/|favicon/.test(r.url())) events.push({ kind: `http${r.status()}`, detail: `${r.request().method()} ${r.url().replace(BASE, "")}`.slice(0, 200) }); });
  return { ctx, page, events };
}

/**
 * Saves the first screen, the whole page and (Arabic, light) the tablet first screen,
 * and adds a record to pages.json / index.txt. `name` is the file name stem.
 */
export async function shoot(c, locale, name, extra = {}) {
  const { page, events } = c;
  const dir = join(OUT, locale);
  mkdirSync(dir, { recursive: true });
  const stem = extra.dark ? `${name}-dark` : name;
  const m = await page.evaluate(measure).catch((e) => ({ error: String(e) }));
  // caret: "initial": hiding the caret writes caret-color inline on inputs, which a hydrating page
  // reports as a hydration mismatch (see ../capture.mjs).
  await page.screenshot({ path: join(dir, `${stem}-1280.png`), caret: "initial" }).catch(() => {});
  if (!extra.noFull) await page.screenshot({ path: join(dir, `${stem}-1280-full.png`), fullPage: true, caret: "initial" }).catch(() => {});
  let tablet = null;
  if (locale === "ar" && !extra.dark && !extra.noTablet) {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(400);
    tablet = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, screens: Math.round((document.documentElement.scrollHeight / innerHeight) * 10) / 10 })).catch(() => null);
    await page.screenshot({ path: join(dir, `${stem}-768.png`), caret: "initial" }).catch(() => {});
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
  }
  const rec = { name: stem, url: page.url().replace(BASE, "").replace(/[A-Za-z0-9_-]{20,}/g, "<token>"), shot: `${stem}-1280.png`, ...extra, ...m, tablet, events: events.splice(0) };
  const file = join(dir, "pages.json");
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { locale, base: BASE, records: [] };
  all.records = all.records.filter((r) => r.name !== stem).concat(rec).sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(file, JSON.stringify(all, null, 2));
  writeFileSync(join(dir, "index.txt"), all.records.map((r) => `${r.name} | ${r.url} | status ${r.status ?? "-"} | h1: ${r.h1 ?? ""} | buttons ${r.counts?.buttons ?? "?"} links ${r.counts?.links ?? "?"} fields ${r.counts?.fields ?? "?"} | ${r.screens ?? "?"} screens | overflow ${r.overflowX ?? "?"}${r.tablet ? ` (768: ${r.tablet.overflowX})` : ""} | solid ${r.solidButtons?.length ?? "?"} | events ${r.events.length} | ${r.shot}`).join("\n"));
  console.log(`${locale} ${stem}: ${m.h1 ?? m.error} | b${m.counts?.buttons} l${m.counts?.links} f${m.counts?.fields} | ${m.screens} screens | events ${rec.events.length}`);
  return rec;
}

export async function open(c, path) {
  const res = await c.page.goto(BASE + path, { waitUntil: "load", timeout: 120_000 }).catch((e) => { c.events.push({ kind: "goto", detail: String(e).slice(0, 300) }); return null; });
  await settle(c.page);
  return res?.status() ?? null;
}
