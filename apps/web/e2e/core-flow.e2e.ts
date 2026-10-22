import { expect, request, test } from "@playwright/test";
import { ids } from "./support/db";
import { EICAR, pdf } from "./support/files";
import { L } from "./support/msg";
import { open, pickNextMonthDay, toastSaved } from "./support/ui";
import { authFile } from "./support/users";

// Recommendation -> action -> evidence -> review -> revision -> verified,
// with the owner in Arabic and the consultant in English; a due-date request
// both ways; notifications and mail along the way.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const stamp = Date.now().toString(36);
const recTitle = `توصية اختبار ${stamp}`;
const actTitle = `إجراء اختبار ${stamp}`;
let actionId = "";

test.describe.configure({ mode: "serial" });

test("consultant creates a recommendation and releases an action (API: no screen yet, bug #4)", async () => {
  const api = await request.newContext({ baseURL: BASE, storageState: authFile("khalid"), extraHTTPHeaders: { origin: BASE } });
  const rec = await api.post(`/api/projects/${ids.board()}/recommendations`, {
    data: { title: recTitle, rationale: "سبب الاختبار", priority: "high", requiredEvidence: "ملف PDF موقع" },
  });
  expect(rec.status(), await rec.text()).toBeLessThan(300);
  const recId = (await rec.json()).id;
  const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const act = await api.post(`/api/recommendations/${recId}/actions`, {
    data: { title: actTitle, ownerUserId: ids.user("abdullah@nukhba.example"), dueDate: due, release: true, evidence: [{ title: "المحضر الموقع" }] },
  });
  expect(act.status(), await act.text()).toBeLessThan(300);
  actionId = (await act.json()).id;
});

test("owner sees it, starts work, posts a note and is refused an infected file (Arabic)", async ({ browser }) => {
  const t = L("ar");
  const page = await open(browser, "abdullah", "ar");
  await page.goto("/actions");
  await page.getByRole("link", { name: actTitle }).click();
  await expect(page.getByRole("heading", { name: actTitle })).toBeVisible();
  await page.getByRole("button", { name: t("action.move.in_progress") }).click();
  await toastSaved(page);
  await page.locator("#update").fill("بدأنا العمل على المحضر");
  await page.getByRole("button", { name: t("action.post") }).click();
  await expect(page.getByText("بدأنا العمل على المحضر")).toBeVisible();

  await page.getByRole("button", { name: t("action.move.awaiting_review") }).click();
  await page.locator("#file").setInputFiles({ name: "eicar.txt", mimeType: "text/plain", buffer: EICAR });
  await page.getByRole("button", { name: t("action.sendForReview") }).click();
  await expect(page.getByRole("alert").filter({ hasText: t("action.errors.infected") })).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/owner-ar-infected.png" });
  await page.context().close();
});

test("owner submits a clean PDF for review (Arabic)", async ({ browser }) => {
  const t = L("ar");
  const page = await open(browser, "abdullah", "ar");
  await page.goto(`/actions/${actionId}`);
  await page.getByRole("button", { name: t("action.move.awaiting_review") }).click();
  await page.locator("#file").setInputFiles({ name: "minutes.pdf", mimeType: "application/pdf", buffer: pdf() });
  await page.locator("#note").fill("المحضر مرفق");
  await page.getByRole("button", { name: t("action.sendForReview") }).click();
  await toastSaved(page);
  await expect(page.getByText(t("action.awaitingNote"))).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/owner-ar-awaiting.png", fullPage: true });
  await page.context().close();
});

test("consultant finds it in the review queue, downloads it and asks for a revision (English)", async ({ browser }) => {
  const t = L("en");
  const page = await open(browser, "khalid", "en", "dark");
  await page.goto("/review");
  await page.getByRole("link", { name: actTitle }).click();
  // The button asks for a one-minute signed link to the private bucket and follows it.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: t("action.download") }).first().click()]);
  expect(download.url()).toMatch(/X-Amz-Signature=/);
  expect((await download.path()) && download.suggestedFilename()).toBeTruthy();
  await page.getByRole("button", { name: t("action.move.revision_requested") }).click();
  await page.locator("#reason").fill("Please attach the signed page as well.");
  await page.getByRole("button", { name: t("action.confirm") }).click();
  await toastSaved(page);
  await page.screenshot({ path: "e2e-results/shots/consultant-en-revision.png", fullPage: true });
  await page.context().close();
});

test("owner is notified, asks for a later date and resubmits (Arabic)", async ({ browser }) => {
  const t = L("ar");
  const page = await open(browser, "abdullah", "ar");
  await page.goto("/notifications");
  await expect(page.getByText(t("notifications.kinds.action_revision_requested", { title: actTitle }))).toBeVisible();
  await page.goto(`/actions/${actionId}`);
  await page.getByRole("button", { name: t("action.deadline.ask") }).click();
  await pickNextMonthDay(page, "new-date");
  await page.locator("#date-reason").fill("ننتظر توقيع رئيس المجلس");
  await page.getByRole("button", { name: t("action.deadline.send") }).click();
  await toastSaved(page);
  // After a revision request the owner resumes work before sending again.
  await page.getByRole("button", { name: t("action.resume") }).click();
  await toastSaved(page);
  // Answer the evidence-list item with the signed file, then send for review.
  await page.getByRole("button", { name: t("action.items.answer") }).click();
  await page.locator("#file").setInputFiles({ name: "minutes-signed.pdf", mimeType: "application/pdf", buffer: pdf("signed") });
  await page.getByRole("dialog").getByRole("button", { name: t("action.upload") }).click();
  await toastSaved(page);
  await page.getByRole("button", { name: t("action.move.awaiting_review") }).click();
  await page.getByRole("dialog").getByRole("button", { name: t("action.sendForReview") }).click();
  await expect(page.getByText(t("action.awaitingNote"))).toBeVisible();
  await page.context().close();
});

test("consultant approves the date and verifies the action (English)", async ({ browser }) => {
  const t = L("en");
  const page = await open(browser, "khalid", "en");
  await page.goto(`/actions/${actionId}`);
  await page.getByRole("button", { name: t("action.deadline.approve") }).click();
  await toastSaved(page);
  // Bug #11: verifying with an open evidence item said "someone else changed this action".
  await page.getByRole("button", { name: t("action.move.verified_complete") }).click();
  await page.getByRole("dialog").getByRole("button", { name: t("action.confirm") }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: t("action.cancel") }).click();
  await page.getByRole("button", { name: t("action.items.accept"), exact: true }).click();
  await expect(page.getByRole("button", { name: t("action.items.accept"), exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: t("action.move.verified_complete") }).click();
  await page.getByRole("dialog").getByRole("button", { name: t("action.confirm") }).click();
  await expect(page.getByText(t("status.verified_complete")).first()).toBeVisible();
  await expect(page.getByRole("button", { name: t("action.reopen") })).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/consultant-en-verified.png", fullPage: true });
  await page.context().close();
});

// Bug #17: action events only notify in the app, so no mail reaches the owner.
// Marked as an expected failure; it starts failing (and should be flipped) once mail is sent.
test("the owner gets a mail about the revision request (bug #17)", async () => {
  test.fail();
  const api = await request.newContext();
  await expect
    .poll(async () => {
      const r = await api.get("http://localhost:8025/api/v1/search?query=" + encodeURIComponent(`to:abdullah@nukhba.example`));
      // Meeting invites from meetings.e2e.ts go to the same person; leave them out.
      const { messages = [] } = (await r.json()) as { messages?: { Subject: string }[] };
      return messages.filter((m) => !m.Subject.includes("Meeting invitation")).length;
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);
});
