// The public inquiry form, step by step, in Arabic, filled with the keyboard
// where it can be (each place it can't is written down), with every
// validation error. Sends one fictional inquiry at the end. Then the same
// steps in English without sending.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, MAIL, OUT, chromium, context, hydrated, open, settle, shoot as shootPage } from "./lib.mjs";

const SEND = process.argv.includes("--send");
const notes = { keyboard: {} };
// Notes are saved after every capture, so a step that fails loses nothing.
const save = () => writeFileSync(join(OUT, "notes-inquiry.json"), JSON.stringify(notes, null, 2));
const shoot = async (...a) => { const r = await shootPage(...a); save(); return r; };
const browser = await chromium.launch();

const focusInfo = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  if (el.closest("nextjs-portal")) return { label: "(Next.js development badge)", ring: true };
  const s = getComputedStyle(el);
  return {
    id: el.id || null,
    label: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("name") || el.id || el.tagName).replace(/\s+/g, " ").trim().slice(0, 40),
    ring: s.boxShadow !== "none" || (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0),
  };
};
async function tabWalk(page, max) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.click(2, 2);
  const seq = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(focusInfo);
    if (!f) break;
    seq.push(`${f.label}${f.ring ? "" : " [NO FOCUS RING]"}`);
  }
  return seq;
}
async function tabTo(page, selector, max = 14) {
  const path = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate((s) => !!document.activeElement?.matches(s), selector);
    const f = await page.evaluate(focusInfo);
    path.push(f?.label ?? "(nothing)");
    if (hit) return { ok: true, presses: i + 1, path };
  }
  return { ok: false, path };
}
const stepText = (page) => page.locator("form").locator("xpath=..").locator("p").first().innerText();
const next = (page) => page.locator('form button[type="submit"]').click();
async function pickWithKeyboard(page, triggerId, downs = 1) {
  await page.locator(`#${triggerId}`).focus();
  await page.keyboard.press("Enter");
  await page.locator('[role="listbox"]').waitFor({ timeout: 5000 }).catch(() => {});
  for (let i = 0; i < downs; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const text = await page.locator(`#${triggerId}`).innerText();
  return text.trim();
}

// ---------- Arabic ----------
{
  const c = await context(browser, "ar");
  const { page } = c;

  // How long the page's title takes to write itself.
  await page.goto(`${BASE}/inquiry`, { waitUntil: "domcontentloaded" });
  const t0 = Date.now();
  const timeline = [];
  for (let i = 0; i < 40; i++) {
    const shown = await page.evaluate(() => {
      const h = document.querySelector("h1");
      if (!h) return null;
      // Only the characters a sighted person sees: skip anything visually hidden.
      let n = 0;
      const w = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const r = t.parentElement.getBoundingClientRect();
        const s = getComputedStyle(t.parentElement);
        if (r.width > 2 && r.height > 2 && s.clip === "auto" && s.opacity !== "0") n += t.textContent.length;
      }
      return n;
    });
    timeline.push([Date.now() - t0, shown]);
    await page.waitForTimeout(250);
  }
  notes.titleTyping = { full: await page.evaluate(() => document.querySelector("h1")?.innerText.length), timeline: timeline.filter((x, i, a) => i === 0 || x[1] !== a[i - 1][1]), html: await page.evaluate(() => document.querySelector("h1")?.innerHTML.slice(0, 400)) };
  await hydrated(page);
  await settle(page, 2500);

  notes.keyboard.step1TabOrder = await tabWalk(page, 14);
  await shoot(c, "ar", "71-inquiry-step1");

  // Step 1 with nothing filled.
  await next(page);
  await page.waitForTimeout(700);
  await shoot(c, "ar", "71-inquiry-step1-errors");

  // Step 1 by keyboard.
  await page.locator("#orgName").focus();
  await page.keyboard.type("شركة تجربة المراجعة");
  let r = await tabTo(page, "#orgNameAr");
  notes.keyboard.toNameAr = r;
  r = await tabTo(page, "#sector");
  notes.keyboard.toSector = r;
  notes.keyboard.sectorPicked = await pickWithKeyboard(page, "sector");
  await shoot(c, "ar", "71-inquiry-step1-filled", { noTablet: true });
  r = await tabTo(page, 'form button[type="submit"]');
  notes.keyboard.toContinue1 = r;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  notes.afterStep1 = await stepText(page);

  // Step 2.
  await shoot(c, "ar", "72-inquiry-step2");
  notes.keyboard.step2FocusStartsOn = await page.evaluate(focusInfo);
  await next(page);
  await page.waitForTimeout(700);
  await shoot(c, "ar", "72-inquiry-step2-errors-empty");
  await page.locator("#contactName").focus();
  await page.keyboard.type("مراجع تجريبي");
  notes.keyboard.toRole = await tabTo(page, "#requesterRole");
  notes.keyboard.rolePicked = await pickWithKeyboard(page, "requesterRole", 3);
  notes.keyboard.toEmail = await tabTo(page, "#email");
  await page.keyboard.type("audit-check");
  // The contact channel group: Tab into it, arrow to WhatsApp, Space.
  await page.keyboard.press("Tab");
  notes.keyboard.channelGroupFocus = await page.evaluate(focusInfo);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  notes.keyboard.channelAfterTwoArrowLeft = await page.evaluate(focusInfo);
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  notes.keyboard.channelState = await page.evaluate(() => [...document.querySelectorAll('[aria-labelledby="channelLabel"] button')].map((b) => `${b.innerText.trim()}:${b.getAttribute("data-state")}`));
  if (!notes.keyboard.channelState.some((s) => /واتساب:on/.test(s))) await page.getByRole("radio", { name: "واتساب" }).or(page.getByRole("button", { name: "واتساب" })).first().click();
  await next(page);
  await page.waitForTimeout(700);
  await shoot(c, "ar", "72-inquiry-step2-errors-email-and-phone");
  await page.locator("#email").fill("audit-check@example.test");
  await page.locator("#phone").fill("رقم");
  await next(page);
  await page.waitForTimeout(600);
  notes.phoneLettersError = await page.locator('[data-slot="field-error"]').allInnerTexts();
  await page.locator("#phone").fill("");
  await page.locator('[aria-labelledby="channelLabel"] button').first().click();
  await page.waitForTimeout(300);
  await shoot(c, "ar", "72-inquiry-step2-filled", { noTablet: true });
  await next(page);
  await page.waitForTimeout(900);
  notes.afterStep2 = await stepText(page);

  // Step 3.
  await shoot(c, "ar", "73-inquiry-step3");
  await next(page);
  await page.waitForTimeout(700);
  await shoot(c, "ar", "73-inquiry-step3-errors");
  await page.mouse.click(2, 2); // Tab then starts from the top of the page
  notes.keyboard.toFirstService = await tabTo(page, '[id^="svc-"]', 20);
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  notes.keyboard.servicePicked = await page.evaluate(() => document.querySelector('[id^="svc-"]')?.getAttribute("data-state"));
  if (notes.keyboard.servicePicked !== "checked") await page.locator('[id^="svc-"]').first().click();
  notes.services = await page.locator('[id^="svc-"]').count();
  notes.serviceLabels = await page.evaluate(() => [...document.querySelectorAll('label[for^="svc-"]')].map((l) => l.innerText.trim()));
  notes.keyboard.toWhyNow = await tabTo(page, "#whyNow", 30);
  await page.keyboard.type("فحص تجريبي لصفحة الطلب ضمن مراجعة الواجهات.");
  await shoot(c, "ar", "73-inquiry-step3-filled", { noTablet: true });
  await next(page);
  await page.waitForTimeout(900);
  notes.afterStep3 = await stepText(page);

  // Step 4 (all optional).
  await shoot(c, "ar", "74-inquiry-step4");
  notes.keyboard.ownershipPicked = await pickWithKeyboard(page, "ownershipType", 3);
  await page.waitForTimeout(500);
  await page.locator('[aria-labelledby="sc-hasStrategy"] button').first().click();
  await shoot(c, "ar", "74-inquiry-step4-family-questions", { noTablet: true });
  await next(page);
  await page.waitForTimeout(900);
  notes.afterStep4 = await stepText(page);

  // Step 5: review.
  await shoot(c, "ar", "75-inquiry-step5-review");
  await next(page);
  await page.waitForTimeout(700);
  await shoot(c, "ar", "75-inquiry-step5-error-no-consent", { noTablet: true });
  await page.mouse.click(2, 2); // Tab then starts from the top of the page
  notes.keyboard.toConsent = await tabTo(page, "#consent", 30);
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  notes.keyboard.consentTicked = await page.locator("#consent").getAttribute("data-state");
  if (notes.keyboard.consentTicked !== "checked") await page.locator("#consent").click();
  notes.keyboard.toSend = await tabTo(page, 'form button[type="submit"]', 10);
  await shoot(c, "ar", "75-inquiry-step5-ready", { noTablet: true });

  if (SEND) {
    const sentAt = Date.now();
    await page.keyboard.press("Enter");
    await page.locator('[role="status"]').waitFor({ timeout: 60_000 });
    await settle(page, 1500);
    notes.sent = { text: (await page.locator('[role="status"]').innerText()).replace(/\s+/g, " ") };
    await shoot(c, "ar", "76-inquiry-sent");
    let mail = null;
    for (let i = 0; i < 40 && !mail; i++) {
      const list = await (await fetch(`${MAIL}/api/v1/messages?limit=100`)).json();
      const fresh = list.messages.filter((m) => new Date(m.Created).getTime() >= sentAt - 2000);
      const hit = fresh.find((m) => m.To.some((t) => t.Address === "audit-check@example.test") && /استلمنا/.test(m.Subject));
      if (hit) {
        mail = await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json();
        notes.mailsAfterSending = fresh.map((m) => `${m.To.map((t) => t.Address).join(",")} | ${m.Subject}`);
      } else await new Promise((r) => setTimeout(r, 3000));
    }
    notes.confirmationMail = mail && { subject: mail.Subject, from: mail.From, replyTo: mail.ReplyTo, text: mail.Text };
  }
  await c.ctx.close();
}

// ---------- English: the same steps, not sent ----------
{
  const c = await context(browser, "en");
  const { page } = c;
  await open(c, "/inquiry");
  await hydrated(page);
  await settle(page, 2500);
  await shoot(c, "en", "71-inquiry-step1");
  await next(page);
  await page.waitForTimeout(600);
  await shoot(c, "en", "71-inquiry-step1-errors");
  await page.locator("#orgName").fill("Audit Check Company");
  await pickWithKeyboard(page, "sector");
  await next(page);
  await page.waitForTimeout(900);
  await shoot(c, "en", "72-inquiry-step2");
  await page.locator("#contactName").fill("Audit Reviewer");
  await pickWithKeyboard(page, "requesterRole", 3);
  await page.locator("#email").fill("audit-check@example.test");
  await next(page);
  await page.waitForTimeout(900);
  await shoot(c, "en", "73-inquiry-step3");
  await next(page);
  await page.waitForTimeout(600);
  await shoot(c, "en", "73-inquiry-step3-errors");
  await page.locator('[id^="svc-"]').first().click();
  await page.locator("#whyNow").fill("A test of the inquiry page for the interface review.");
  await next(page);
  await page.waitForTimeout(900);
  await pickWithKeyboard(page, "ownershipType", 3);
  await page.waitForTimeout(500);
  await shoot(c, "en", "74-inquiry-step4-family-questions");
  await next(page);
  await page.waitForTimeout(900);
  await shoot(c, "en", "75-inquiry-step5-review");
  await c.ctx.close();
}

await browser.close();
writeFileSync(join(OUT, "notes-inquiry.json"), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
