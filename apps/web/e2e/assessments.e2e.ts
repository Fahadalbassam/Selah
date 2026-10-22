import { expect, test } from "@playwright/test";
import { one } from "./support/db";
import { open } from "./support/ui";

// The baseline assessment: answer what's left, finalise, retake, compare;
// the client never sees points or percentages (scores are firm-only).
test.describe.configure({ mode: "serial" });
let assessment = "";

test("consultant answers the remaining questions and finalises (English)", async ({ browser }) => {
  test.setTimeout(180_000);
  assessment = one(`select id from assessments order by created_at limit 1`);
  const page = await open(browser, "khalid", "en");
  await page.goto(`/assessments/${assessment}`);
  const groups = page.getByRole("radiogroup", { name: "Answer" });
  const n = await groups.count();
  for (let i = 0; i < n; i++) {
    const g = groups.nth(i);
    if ((await g.getByRole("radio", { checked: true }).count()) > 0) continue;
    if (!(await g.isVisible())) continue;
    await g.getByRole("radio").first().click();
    await page.waitForResponse((r) => r.url().includes("/api/assessment-answers/") && r.request().method() !== "GET");
  }
  await page.reload();
  // Some questions only appear after another answer (family ownership); answer those too.
  for (let pass = 0; pass < 2; pass++) {
    const g2 = page.getByRole("radiogroup", { name: "Answer" });
    for (let i = 0; i < (await g2.count()); i++) {
      const g = g2.nth(i);
      if ((await g.getByRole("radio", { checked: true }).count()) > 0 || !(await g.isVisible())) continue;
      await g.getByRole("radio").first().click();
      await page.waitForResponse((r) => r.url().includes("/api/assessment-answers/"));
    }
    await page.reload();
  }
  // A rerun against the same database finds it already final.
  if (one(`select status from assessments where id='${assessment}'`) === "draft") {
    await page.getByRole("button", { name: "Finalise" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
  }
  await expect(page.getByText("Final", { exact: false }).first()).toBeVisible();
  await expect.poll(() => one(`select status from assessments where id='${assessment}'`)).not.toBe("draft");
  await page.screenshot({ path: "e2e-results/shots/consultant-en-assessment-final.png", fullPage: true });
});

test("client admin and manager see no scores anywhere (Arabic)", async ({ browser }) => {
  for (const u of ["fahd", "reem"] as const) {
    const page = await open(browser, u, "ar");
    const project = one(`select project_id from assessments where id='${assessment}'`);
    await page.goto(`/projects/${project}`);
    const tabs = page.getByRole("tab");
    const names = await tabs.allInnerTexts();
    for (let i = 0; i < names.length; i++) {
      await tabs.nth(i).click();
      const text = await page.locator("main main").innerText();
      expect(/\d+\s*\/\s*\d+\s*·|\d+(\.\d+)?\s*%/.test(text), `${u} tab ${names[i]} shows a score: ${text.match(/.{0,40}\d+(\.\d+)?\s*%.{0,20}/)?.[0]}`).toBe(false);
    }
    const res = await page.goto(`/assessments/${assessment}`);
    const body = await page.locator("body").innerText();
    expect(/\d+(\.\d+)?\s*%/.test(body), `${u} assessment page (${res?.status()})`).toBe(false);
    await page.screenshot({ path: `e2e-results/shots/${u}-ar-assessment.png`, fullPage: true });
  }
});
