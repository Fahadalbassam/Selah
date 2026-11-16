// With the stored lead@mizan.test session: capture /security (nothing switched
// on), and make one no-login upload link for an open request item of the
// project "حوكمة مجلس الإدارة". Then, signed out, capture the page the link
// opens. No file is uploaded. The stored session is never signed out.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH, MAIL, OUT, chromium, context, open, settle, shoot as shootPage } from "./lib.mjs";

const PROJECT = "/projects/8c55994f-9b30-4023-bb4a-371e31134b35";
const TO = "audit-check@example.test";
const notes = {};
const state = join(AUTH, "lead@mizan.test.json");
// Notes are saved after every capture, so a step that fails loses nothing.
const save = () => writeFileSync(join(OUT, "notes-upload-security.json"), JSON.stringify(notes, null, 2));
const shoot = async (...a) => { const r = await shootPage(...a); save(); return r; };
const browser = await chromium.launch();

// /security, Arabic and English.
for (const locale of ["ar", "en"]) {
  const c = await context(browser, locale, { storageState: state });
  const status = await open(c, "/security");
  await shoot(c, locale, "62-security-lead", { status, account: "lead@mizan.test" });
  if (locale === "ar") {
    // One link only: if its mail is already in the mailbox (an earlier run made it), use that one.
    const earlier = (await (await fetch(MAIL + "/api/v1/messages?limit=100")).json()).messages.some((m) => m.To.some((t) => t.Address === TO) && /مستند/.test(m.Subject));
    let asked = 0;
    await open(c, PROJECT);
    await c.page.getByRole("tab", { name: /الطلبات/ }).click();
    await settle(c.page, 800);
    notes.sendLinkButtons = await c.page.getByRole("button", { name: "إرسال رابط رفع" }).count();
    if (earlier) {
      notes.linkMade = "by an earlier run";
      await shoot(c, "ar", "92-requests-tab-with-link-firm-side", { noTablet: true, account: "lead@mizan.test" });
    } else {
      const send = c.page.getByRole("button", { name: "إرسال رابط رفع" }).first();
      await send.scrollIntoViewIfNeeded();
      await send.click();
      const dialog = c.page.locator('[data-slot="dialog-content"]');
      await dialog.waitFor({ timeout: 15_000 });
      await dialog.locator('input[name="email"]').fill(TO);
      await shoot(c, "ar", "92-upload-link-dialog-firm-side", { noTablet: true, noFull: true, account: "lead@mizan.test" });
      asked = Date.now();
      await dialog.getByRole("button", { name: "إرسال الرابط" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30_000 });
      notes.linkMade = true;
    }
    // The mail.
    let mail = null;
    for (let i = 0; i < 40 && !mail; i++) {
      const list = await (await fetch(`${MAIL}/api/v1/messages?limit=100`)).json();
      const hit = list.messages.find((m) => m.To.some((t) => t.Address === TO) && new Date(m.Created).getTime() >= asked - 2000 && /مستند/.test(m.Subject));
      if (hit) mail = await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json();
      else await new Promise((r) => setTimeout(r, 3000));
    }
    notes.mail = mail && { subject: mail.Subject, from: mail.From, replyTo: mail.ReplyTo, text: mail.Text.replace(/[A-Za-z0-9_-]{30,}/g, "<token>") };
    notes.link = (mail?.Text.match(/https?:\/\/[^\s"<]+/) || [null])[0];
  }
  await c.ctx.close();
}

// The page the link opens, signed out.
if (notes.link) {
  const path = new URL(notes.link).pathname;
  for (const [locale, dark] of [["ar", false], ["en", false], ["en", true]]) {
    const c = await context(browser, locale, { dark });
    const status = await open(c, path);
    await shoot(c, locale, "93-upload-real-link", { status, dark });
    if (locale === "ar") {
      // Send with no file chosen: the browser's own message.
      await c.page.getByRole("button", { name: "إرسال" }).click();
      notes.emptySend = await c.page.evaluate(() => ({ message: document.querySelector("#upload-file").validationMessage, accept: document.querySelector("#upload-file").accept }));
      // Keyboard order.
      await c.page.mouse.click(2, 2); // Tab then starts from the top of the page
      const seq = [];
      for (let i = 0; i < 8; i++) {
        await c.page.keyboard.press("Tab");
        const l = await c.page.evaluate(() => { const el = document.activeElement; return !el || el === document.body ? null : el.closest("nextjs-portal") ? "(dev badge)" : (el.getAttribute("aria-label") || el.innerText || el.id || el.tagName).trim().slice(0, 40); });
        if (!l) break;
        seq.push(l);
      }
      notes.uploadTabOrder = seq;
    }
    await c.ctx.close();
  }
  notes.link = notes.link.replace(/[A-Za-z0-9_-]{30,}/, "<token>");
}
await browser.close();
writeFileSync(join(OUT, "notes-upload-security.json"), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
