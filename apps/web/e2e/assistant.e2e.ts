import { expect, test } from "@playwright/test";
import { ids, one } from "./support/db";
import { open } from "./support/ui";

// The assistant through the browser, with the real model (gpt-oss on
// Ollama's cloud, names masked) and local bge-m3 search: an Arabic question
// with sources, the language switch, and the project picker's limits.
test.describe.configure({ mode: "serial", timeout: 180_000 });

test("consultant asks in Arabic and gets a sourced answer, then switches to English", async ({ browser }) => {
  const page = await open(browser, "khalid", "ar");
  await page.goto(`/assistant`);
  // ?project= alone doesn't preselect (only with &case=), so pick it (bug #20).
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /حوكمة مجلس الإدارة/ }).click();
  const box = page.getByRole("textbox").last();
  await box.fill("ما الذي طلبه مجلس الإدارة بشأن تعاملات الأطراف ذات العلاقة؟");
  const t0 = Date.now();
  await box.press("Enter");
  const answer = page.locator("main main").getByRole("article").last().or(page.locator("[data-role=assistant]").last());
  const res = await page.waitForResponse((r) => r.url().includes("/api/assistant/query") && r.request().method() === "POST", { timeout: 90_000 });
  console.log("query status:", res.status());
  await page.waitForTimeout(1500);
  console.log("answer seconds:", (Date.now() - t0) / 1000);
  await page.screenshot({ path: "e2e-results/shots/assistant-ar.png", fullPage: true });
  const text = await page.locator("main main").innerText();
  expect(text).not.toContain("لا أستطيع تأكيد ذلك");
  expect(text).toMatch(/500/);
  void answer;

  // Language switch from the user menu: the interface flips; the latest answer is translated.
  await page.getByRole("button", { name: /khalid@mizan.example/ }).click();
  await page.getByRole("menuitem", { name: /English/ }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 15_000 });
  // Only the latest answer is translated automatically; the question stays as asked.
  await expect.poll(async () => /500/.test(await page.locator("main main").innerText()) && /[A-Za-z]{4,} [A-Za-z]{4,} [A-Za-z]{3,}/.test(await page.locator("main main").innerText()), { timeout: 60_000 }).toBe(true);
  await page.screenshot({ path: "e2e-results/shots/assistant-en-switched.png", fullPage: true });
});

// Bug #21, built: a plain question about the plan finds the recommendation
// itself (baseline: Record passages), and the answer cites it with what it needs.
test("a question about a recommendation is answered from the recommendation (English)", async ({ browser }) => {
  const rec = one(`select id from recommendations where title = 'اعتماد ميثاق مجلس الإدارة'`);
  // The jobs service indexes records every two minutes.
  await expect
    .poll(() => one(`select count(*) from ai_chunks where source_type = 'recommendation' and source_id = '${rec}'`), { timeout: 150_000 })
    .toBe("1");
  const page = await open(browser, "khalid", "en");
  await page.goto("/assistant");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /حوكمة مجلس الإدارة/ }).click();
  const box = page.getByRole("textbox").last();
  await box.fill("What does approving the board charter need?");
  await box.press("Enter");
  const res = await page.waitForResponse((r) => r.url().includes("/api/assistant/query") && r.request().method() === "POST", { timeout: 90_000 });
  const body = (await res.json()) as { grounded: boolean; answer: string; citations: { sourceType: string; sourceId: string }[] };
  console.log("answer:", body.answer);
  expect(body.grounded).toBe(true);
  expect(body.citations).toContainEqual(expect.objectContaining({ sourceType: "recommendation", sourceId: rec }));
  expect(body.answer).toMatch(/minutes|PDF|محضر/i);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e-results/shots/assistant-en-recommendation.png", fullPage: true });
});

test("a consultant who isn't staffed can't pick the client's project; client roles get no assistant", async ({ browser }) => {
  const noura = await open(browser, "noura", "en");
  await noura.goto("/assistant");
  await noura.getByRole("combobox", { name: "Project" }).click();
  await expect(noura.getByRole("option", { name: /حوكمة مجلس الإدارة/ })).toHaveCount(0);
  await noura.keyboard.press("Escape");
  await noura.goto(`/assistant?project=${ids.board()}`);
  await expect(noura.getByRole("combobox", { name: "Project" })).not.toContainText("حوكمة مجلس الإدارة");

  const reem = await open(browser, "reem", "en");
  await reem.goto("/");
  await expect(reem.getByRole("link", { name: "Assistant" })).toHaveCount(0);
  await reem.goto("/assistant");
  await expect(reem.getByText(/doesn't exist|don't have access/)).toBeVisible();
});
