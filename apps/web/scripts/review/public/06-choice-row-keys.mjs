// Arrow keys in the inquiry form's choice rows (contact channel), with a pause
// after each key so a delayed focus move is not missed. Sends nothing.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, chromium, context, hydrated, open, settle } from "./lib.mjs";

const notes = {};
const browser = await chromium.launch();
for (const locale of ["ar", "en"]) {
  const c = await context(browser, locale);
  const { page } = c;
  await open(c, "/inquiry");
  await hydrated(page);
  await settle(page, 1500);
  await page.locator("#orgName").fill("Audit Check Company");
  await page.locator("#sector").click();
  await page.getByRole("option").first().click();
  await page.locator('form button[type="submit"]').click();
  await page.locator("#contactName").waitFor();
  await page.waitForTimeout(600);
  const items = page.locator('[aria-labelledby="channelLabel"] button');
  const where = () => page.evaluate(() => {
    const el = document.activeElement;
    const g = document.querySelector('[aria-labelledby="channelLabel"]');
    const chosen = [...g.querySelectorAll("button")].find((b) => b.getAttribute("data-state") === "on")?.innerText.trim();
    return `focus: ${g.contains(el) ? el.innerText.trim() : `outside the row (${el.id || el.tagName})`} | chosen: ${chosen}`;
  });
  const log = [`order on screen (first to last in the page's reading direction): ${(await items.allInnerTexts()).map((t) => t.trim()).join(" , ")}`];
  await items.first().focus();
  await page.waitForTimeout(300);
  log.push(`start -> ${await where()}`);
  for (const key of ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowRight", "ArrowRight", "ArrowDown", "ArrowUp", "End", "Home", "Space"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(350);
    log.push(`${key} -> ${await where()}`);
  }
  notes[locale] = log;
  await c.ctx.close();
}
await browser.close();
writeFileSync(join(OUT, "notes-choice-row-keys.json"), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
