// A second pass over the inquiry form that sends NOTHING to the server: the
// form's POST is answered here, in the browser, with the reference of the one
// inquiry that 04-inquiry.mjs really sent, so the confirmation screen can be
// captured (the first capture was taken while it was still sending).
// Also: closer keyboard checks (lists, the choice rows, where focus lands on
// each new step) and the family-business questions.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, chromium, context, hydrated, open, settle, shoot as shootPage } from "./lib.mjs";

const REF = "INQ-A90915D0"; // the inquiry sent by 04-inquiry.mjs
const notes = {};
const save = () => writeFileSync(join(OUT, "notes-inquiry-keyboard.json"), JSON.stringify(notes, null, 2));
const shoot = async (...a) => { const r = await shootPage(...a); save(); return r; };
const browser = await chromium.launch();

const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "(nothing: the page body)";
  const s = getComputedStyle(el);
  const ring = s.boxShadow !== "none" || (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0);
  return `${(el.getAttribute("aria-label") || el.innerText || el.id || el.tagName).replace(/\s+/g, " ").trim().slice(0, 40)}${el.id ? ` #${el.id}` : ""}${ring ? "" : " [NO FOCUS RING]"}`;
});
const stepText = (page) => page.locator("form").locator("xpath=..").locator("p").first().innerText();

for (const locale of ["ar", "en"]) {
  const L = locale === "ar";
  const n = (notes[locale] = {});
  const c = await context(browser, locale);
  const { page } = c;
  let posts = 0;
  await page.route("**/api/inquiries", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ref: REF }) });
  });
  await open(c, "/inquiry");
  await hydrated(page);
  await settle(page, 2000);

  // Step 1.
  await page.locator("#orgName").fill(L ? "شركة تجربة المراجعة" : "Audit Check Company");
  await page.locator("#sector").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  n.listOpensWithFocusOn = await focused(page);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  n.listAfterArrowDown = await focused(page);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  n.listAfterSecondArrowDown = await focused(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  n.listPicked = (await page.locator("#sector").innerText()).trim();
  n.focusAfterPick = await focused(page);
  // Enter inside a text field: does it move on?
  await page.locator("#orgName").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  n.enterInTextFieldGoesTo = await stepText(page);
  n.focusOnArrivalStep2 = await focused(page);

  // Step 2: the choice row (contact channel) with arrow keys.
  await page.locator("#contactName").fill(L ? "مراجع تجريبي" : "Audit Reviewer");
  await page.locator("#requesterRole").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await page.locator("#email").fill("audit-check@example.test");
  const first = page.locator('[aria-labelledby="channelLabel"] button').first();
  await first.focus();
  n.channelStart = await focused(page);
  await page.keyboard.press("ArrowRight");
  n.channelAfterArrowRight = await focused(page);
  await first.focus();
  await page.keyboard.press("ArrowLeft");
  n.channelAfterArrowLeft = await focused(page);
  await first.focus();
  await page.keyboard.press("Tab");
  n.channelAfterTab = await focused(page);
  n.channelDir = await page.evaluate(() => { const g = document.querySelector('[aria-labelledby="channelLabel"]'); return { dirAttr: g.getAttribute("dir"), computed: getComputedStyle(g).direction, role: g.getAttribute("role"), itemRole: g.querySelector("button").getAttribute("role") }; });
  await first.click(); // keep e-mail as the channel (a click on the chosen one must not clear it)
  n.channelStateAfterClickingChosen = await page.evaluate(() => [...document.querySelectorAll('[aria-labelledby="channelLabel"] button')].map((b) => `${b.innerText.trim()}:${b.getAttribute("data-state")}`));
  await page.locator('form button[type="submit"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  n.step3 = await stepText(page);
  n.focusOnArrivalStep3 = await focused(page);

  // Step 3.
  await page.locator('[id^="svc-"]').first().click();
  await page.locator("#whyNow").fill(L ? "فحص تجريبي لصفحة الطلب ضمن مراجعة الواجهات." : "A test of the inquiry page for the interface review.");
  await page.locator('form button[type="submit"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  n.focusOnArrivalStep4 = await focused(page);

  // Step 4 with a family business chosen.
  await page.locator("#ownershipType").click();
  await page.getByRole("option", { name: L ? "شركة عائلية بعدة شركاء" : "Family business, several partners" }).click();
  await page.waitForTimeout(700);
  await shoot(c, locale, "74-inquiry-step4-family-questions", { note: "family business chosen; nothing sent" });
  await page.locator('form button[type="submit"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  n.focusOnArrivalStep5 = await focused(page);
  n.editLinks = await page.evaluate(() => [...document.querySelectorAll("form button")].filter((b) => /^(تعديل|Edit)$/.test(b.innerText.trim())).map((b) => b.getAttribute("aria-label") || b.innerText.trim()));

  // Send: answered in the browser, nothing reaches the server.
  await page.locator("#consent").click();
  await page.locator('form button[type="submit"]').focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { level: 2 }).filter({ hasText: L ? "استلمنا طلبك" : "your inquiry was received" }).waitFor({ timeout: 30_000 });
  await settle(page, 1500);
  n.postsAnsweredInBrowser = posts;
  n.focusAfterSending = await focused(page);
  n.confirmation = await page.evaluate(() => {
    const card = [...document.querySelectorAll('[role="status"]')].find((e) => e.querySelector("h2"));
    const icon = card?.querySelector("svg");
    return { text: card?.innerText.replace(/\s+/g, " ").trim(), iconColour: icon ? getComputedStyle(icon).color : null, buttons: [...(card?.querySelectorAll("button") ?? [])].map((b) => b.getAttribute("aria-label") || b.innerText.trim()) };
  });
  await shoot(c, locale, "76-inquiry-sent", { note: `confirmation screen; the request was answered in the browser with the reference of the inquiry really sent (${REF}), so no second inquiry exists` });
  await c.ctx.close();
}
await browser.close();
save();
console.log(JSON.stringify(notes, null, 2));
