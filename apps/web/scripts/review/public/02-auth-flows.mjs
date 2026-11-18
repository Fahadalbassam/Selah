// The sign-in pages' states that need a click: wrong password, link asked for,
// reset asked for, and the token pages with a real link from the mail.
// It never completes a password reset, never accepts an invitation, and uses
// a password sign-in twice only (both wrong on purpose).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, MAIL, OUT, chromium, context, hydrated, open, settle, shoot as shootPage } from "./lib.mjs";

const ACCOUNT = "owner@nukhba.test";
const FAKE43 = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";
const FAKE32 = "AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf";
const notes = {};
const started = Date.now();

async function mailTo(address, subjectPart, sinceMs, waitMs = 90_000) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const list = await (await fetch(`${MAIL}/api/v1/messages?limit=100`)).json();
    const hit = list.messages.find((m) => m.To.some((t) => t.Address === address) && m.Subject.includes(subjectPart) && new Date(m.Created).getTime() >= sinceMs - 2000);
    if (hit) return await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json();
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}
const linkIn = (mail) => (mail?.Text.match(/https?:\/\/[^\s"<]+/) || [null])[0];

/** Presses Tab and writes down where the focus goes and whether a focus ring shows. */
async function tabWalk(page, max = 20) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.click(2, 2); // sets where Tab starts from: the top of the page
  const seq = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      if (el.closest("nextjs-portal")) return { label: "(Next.js development badge)" };
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(), id: el.id || null,
        label: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("name") || el.id || "").replace(/\s+/g, " ").trim().slice(0, 50),
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
        ring: s.boxShadow !== "none" || (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0),
      };
    });
    if (!info) break;
    seq.push(info);
  }
  return seq;
}

// Notes are saved after every capture, so a step that fails loses nothing.
const save = () => writeFileSync(join(OUT, "notes-auth-flows.json"), JSON.stringify(notes, null, 2));
const shoot = async (...a) => { const r = await shootPage(...a); save(); return r; };
const browser = await chromium.launch();

// ---- Arabic ----
{
  const c = await context(browser, "ar");
  const { page } = c;

  // Keyboard order on the sign-in page.
  await open(c, "/sign-in");
  await hydrated(page);
  notes.signInTabOrder = await tabWalk(page, 12);
  await page.mouse.click(2, 2);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  await shoot(c, "ar", "07-sign-in-keyboard-focus", { noTablet: true, noFull: true, note: "focus after four Tab presses" });

  // Empty form: the browser's own message, and its language.
  await open(c, "/sign-in");
  await hydrated(page);
  await page.locator('form button[type="submit"]').click();
  notes.signInEmptyValidation = await page.evaluate(() => ({ message: document.querySelector("#email").validationMessage, browserLanguage: navigator.language, pageLanguage: document.documentElement.lang }));

  // Wrong password, an address with no account. Entirely with the keyboard.
  await page.locator("#email").focus();
  await page.keyboard.type("nobody-audit@example.test");
  await page.keyboard.press("Tab"); // the "forgot it?" link sits between the two fields
  const afterEmail = await page.evaluate(() => document.activeElement?.id || document.activeElement?.innerText);
  if (afterEmail !== "password") await page.keyboard.press("Tab");
  notes.signInTabFromEmailLandsOn = afterEmail;
  await page.keyboard.type("wrong-password-audit-1");
  let t0 = Date.now();
  await page.keyboard.press("Enter");
  await page.locator("form .text-destructive").waitFor({ timeout: 30_000 });
  notes.wrongPasswordUnknownAddress = { ms: Date.now() - t0, text: await page.locator("form .text-destructive").innerText(), url: page.url().replace(BASE, "") };
  await shoot(c, "ar", "08-sign-in-wrong-password-unknown-address");

  // Wrong password, an address that has an account: the answer must be the same.
  await page.locator("#email").fill(ACCOUNT);
  await page.locator("#password").fill("wrong-password-audit-2");
  t0 = Date.now();
  await page.locator('form button[type="submit"]').click();
  await page.waitForTimeout(400);
  await page.locator("form .text-destructive").waitFor({ timeout: 30_000 });
  await settle(page, 300);
  notes.wrongPasswordKnownAddress = { ms: Date.now() - t0, text: await page.locator("form .text-destructive").innerText() };
  await shoot(c, "ar", "09-sign-in-wrong-password-known-address", { noTablet: true });

  // Ask for a sign-in link.
  const linkAsked = Date.now();
  await page.locator("#password").fill("");
  await page.getByRole("button", { name: /رابط الدخول/ }).click();
  await page.getByText("تحقق من بريدك").waitFor({ timeout: 30_000 });
  await shoot(c, "ar", "11-sign-in-link-asked");

  // Ask for a password reset.
  await open(c, "/forgot-password");
  await hydrated(page);
  const resetAsked = Date.now();
  await page.locator("#email").fill(ACCOUNT);
  await page.locator('form button[type="submit"]').click();
  await page.locator("form").waitFor({ state: "detached", timeout: 30_000 });
  await shoot(c, "ar", "12-forgot-password-sent");

  // The mails.
  const linkMail = await mailTo(ACCOUNT, "رابط الدخول", linkAsked);
  const resetMail = await mailTo(ACCOUNT, "إعادة تعيين", resetAsked);
  notes.signInLinkMailArrived = !!linkMail;
  notes.resetMailArrived = !!resetMail;
  const signInLink = linkIn(linkMail);
  const resetLink = linkIn(resetMail);
  notes.signInLinkShape = signInLink?.replace(/[A-Za-z0-9_-]{20,}/, "<token>") ?? null;
  notes.resetLinkShape = resetLink?.replace(/[A-Za-z0-9_-]{20,}/, "<token>") ?? null;

  // The reset page from the real link: captured, nothing typed, nothing sent.
  if (resetLink) {
    await open(c, new URL(resetLink).pathname);
    await shoot(c, "ar", "32-reset-password-real-link");
    const e = await context(browser, "en");
    await open(e, new URL(resetLink).pathname);
    await shoot(e, "en", "32-reset-password-real-link");
    await e.ctx.close();
  }

  // The reset form's own errors, on a made-up token (so no password can change).
  // Since #153 a made-up token may show "this link doesn't work" with no form; then there is nothing to fill.
  await open(c, `/reset-password/${FAKE32}`);
  if (await page.locator("#password").count()) {
  await hydrated(page);
  await page.locator("#password").fill("short");
  await page.locator("#confirm").fill("short");
  await page.locator('form button[type="submit"]').click();
  notes.resetShortPassword = await page.evaluate(() => ({ nativeMessage: document.querySelector("#password").validationMessage, pageError: document.querySelector("form .text-destructive")?.innerText ?? null }));
  await page.locator("#password").fill("audit-check-password-1");
  await page.locator("#confirm").fill("audit-check-password-2");
  await page.locator('form button[type="submit"]').click();
  await page.locator("form .text-destructive").waitFor({ timeout: 15_000 });
  await shoot(c, "ar", "33-reset-password-mismatch", { noTablet: true });
  await page.locator("#confirm").fill("audit-check-password-1");
  await page.locator('form button[type="submit"]').click();
  await page.waitForTimeout(1500);
  await page.locator("form .text-destructive").waitFor({ timeout: 30_000 });
  await settle(page, 300);
  notes.resetFakeToken = await page.locator("form .text-destructive").innerText();
  await shoot(c, "ar", "34-reset-password-dead-link-after-submit");
  } else {
    notes.resetFakeToken = "no form on a made-up token";
  }

  // The e-mail change page: any well-formed token shows the button; pressing it with a made-up one shows the error.
  await open(c, `/confirm-email/${FAKE43}`);
  await page.waitForTimeout(500);
  { const own = page.locator("form button, main button"); if (await own.count()) await own.first().click(); else notes.confirmEmailNoButton = true; }
  await page.locator(".text-destructive").waitFor({ timeout: 30_000 }).catch(() => { notes.confirmEmailNoErrorShown = true; });
  await shoot(c, "ar", "52-confirm-email-dead-link-after-press");

  // The sign-in link page from the real mail.
  if (signInLink) {
    await open(c, new URL(signInLink).pathname);
    await shoot(c, "ar", "22-sign-in-link-real");
    const e = await context(browser, "en");
    await open(e, new URL(signInLink).pathname);
    await shoot(e, "en", "22-sign-in-link-real");
    await e.ctx.close();
  }
  // A made-up link pressed: the dead-link answer.
  await open(c, `/sign-in/link/${FAKE32}`);
  await page.getByRole("link", { name: "تسجيل الدخول" }).click();
  await page.waitForURL(/\/sign-in\?/, { timeout: 60_000 }).catch(() => {});
  await settle(page);
  notes.fakeLinkPressedLandsOn = page.url().replace(BASE, "");
  await shoot(c, "ar", "23-sign-in-link-dead-after-press");
  await c.ctx.close();

  // The real link pressed once, in a throwaway context: what comes after it.
  if (signInLink) {
    const t = await context(browser, "ar");
    await open(t, new URL(signInLink).pathname);
    await t.page.getByRole("link", { name: "تسجيل الدخول" }).click();
    await t.page.waitForURL((u) => !u.pathname.startsWith("/sign-in/link") && !u.pathname.startsWith("/api/"), { timeout: 90_000 }).catch(() => {});
    await settle(t.page, 1500);
    notes.realLinkPressedLandsOn = t.page.url().replace(BASE, "");
    await shoot(t, "ar", "24-after-sign-in-link", { noTablet: true });
    await t.ctx.close(); // the session is simply dropped; no sign-out
    // The same link a second time.
    const u = await context(browser, "ar");
    await open(u, new URL(signInLink).pathname);
    await u.page.getByRole("link", { name: "تسجيل الدخول" }).click();
    await u.page.waitForURL(/\/sign-in\?/, { timeout: 60_000 }).catch(() => {});
    await settle(u.page);
    notes.usedLinkPressedLandsOn = u.page.url().replace(BASE, "");
    await shoot(u, "ar", "25-sign-in-link-used-twice", { noTablet: true });
    await u.ctx.close();
  }
  notes.mails = { signInLink: linkMail && { subject: linkMail.Subject, from: linkMail.From, replyTo: linkMail.ReplyTo, text: linkMail.Text.replace(/[A-Za-z0-9_-]{20,}/g, "<token>") }, reset: resetMail && { subject: resetMail.Subject, from: resetMail.From, replyTo: resetMail.ReplyTo, text: resetMail.Text.replace(/[A-Za-z0-9_-]{20,}/g, "<token>") } };
}

// ---- English: the same answers, without another password attempt ----
{
  const c = await context(browser, "en");
  const { page } = c;
  await open(c, "/forgot-password");
  await hydrated(page);
  await page.locator("#email").fill("nobody-audit@example.test");
  await page.locator('form button[type="submit"]').click();
  await page.locator("form").waitFor({ state: "detached", timeout: 30_000 });
  notes.forgotUnknownAddressAnswer = await page.locator('[data-slot="card-content"] p').first().innerText();
  await shoot(c, "en", "12-forgot-password-sent-unknown-address");
  await open(c, `/confirm-email/${FAKE43}`);
  await page.waitForTimeout(500);
  { const own = page.locator("form button, main button"); if (await own.count()) await own.first().click(); else notes.confirmEmailNoButton = true; }
  await page.locator(".text-destructive").waitFor({ timeout: 30_000 }).catch(() => { notes.confirmEmailNoErrorShown = true; });
  await shoot(c, "en", "52-confirm-email-dead-link-after-press");
  await c.ctx.close();
}

await browser.close();
notes.tookSeconds = Math.round((Date.now() - started) / 1000);
writeFileSync(join(OUT, "notes-auth-flows.json"), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
