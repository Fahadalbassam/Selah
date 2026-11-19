import { expect, request, test } from "@playwright/test";
import { ids, one } from "./support/db";
import { EICAR, pdf } from "./support/files";
import { L } from "./support/msg";
import { hydrated } from "./support/session";
import { open, pickNextMonthDay, toastSaved } from "./support/ui";

// Recommendation -> action -> evidence -> review -> revision -> verified,
// with the owner in Arabic and the consultant in English; a due-date request
// both ways; notifications and mail along the way.
const stamp = Date.now().toString(36);
const findingTitle = `Unsigned minutes ${stamp}`;
const recTitle = `توصية اختبار ${stamp}`;
const actTitle = `إجراء اختبار ${stamp}`;
let actionId = "";

test.describe.configure({ mode: "serial" });

test("consultant records a finding, answers it with a recommendation and releases an action (English, dark)", async ({ browser }) => {
  const t = L("en");
  const page = await open(browser, "khalid", "en", "dark");
  await page.goto(`/projects/${ids.board()}`);
  await hydrated(page, "main");

  // Batch 3: "Add a finding" is in the menu beside "Add a recommendation".
  await page.getByRole("button", { name: t("projectPage.menu.planLabel") }).click();
  await page.getByRole("menuitem", { name: t("plan.findings.add") }).click();
  const fd = page.getByRole("dialog");
  await fd.locator("#f-title").fill(findingTitle);
  await fd.locator("#f-description").fill("Board minutes for 2025 are unsigned.");
  await fd.getByRole("button", { name: t("plan.findings.add") }).click();
  await toastSaved(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // "Add a recommendation for it" on the finding's row (findings with no recommendation, at the end of Plan) answers that finding.
  await page.getByRole("listitem").filter({ hasText: findingTitle }).getByRole("button", { name: t("plan.rec.addForFinding") }).click();
  const rd = page.getByRole("dialog");
  await rd.locator("#r-title").fill(recTitle);
  await rd.locator("#r-rationale").fill("سبب الاختبار");
  await rd.locator("#r-priority").click();
  await page.getByRole("option", { name: t("priority.high") }).click();
  // The evidence field is behind "More fields" (October review, item 5); it opened by itself, the finding being chosen.
  await expect(rd.locator("#r-evidence")).toBeVisible();
  await rd.locator("#r-evidence").fill("ملف PDF موقع");
  await rd.getByRole("button", { name: t("plan.rec.save") }).click();
  await toastSaved(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.locator("[data-slot=card]").filter({ hasText: recTitle });
  await expect(card.getByText(t("projectPage.finding.lineFirm", { finding: findingTitle }))).toBeVisible();

  await card.getByRole("button", { name: t("plan.action.add") }).click();
  const ad = page.getByRole("dialog");
  await ad.locator("#a-title").fill(actTitle);
  await ad.locator("#a-owner").click();
  await page.getByRole("option", { name: "عبدالله المطيري" }).click();
  await pickNextMonthDay(page, "a-due");
  await ad.getByRole("button", { name: t("plan.action.addItem") }).click();
  await ad.getByRole("textbox", { name: t("plan.action.item", { n: 1 }) }).fill("المحضر الموقع");
  await expect(ad.getByRole("switch")).toBeChecked();
  await page.screenshot({ path: "e2e-results/shots/consultant-en-new-action.png" });
  await ad.getByRole("button", { name: t("plan.action.save") }).click();
  await expect(page.getByText(t("plan.action.released"))).toBeVisible();
  await expect(card.getByRole("link", { name: actTitle })).toBeVisible();
  actionId = one(`select id from actions where title='${actTitle}'`);
  expect(one(`select status from actions where id='${actionId}'`)).toBe("assigned");
  expect(one(`select count(*) from evidence_requests where action_id='${actionId}'`)).toBe("1");
  await page.screenshot({ path: "e2e-results/shots/consultant-en-plan.png", fullPage: true });
  await page.context().close();
});

test("owner sees it, starts work, posts a note and is refused an infected file (Arabic)", async ({ browser }) => {
  const t = L("ar");
  const page = await open(browser, "abdullah", "ar");
  await page.goto("/actions");
  await page.getByRole("link", { name: actTitle }).click();
  await expect(page.getByRole("heading", { name: actTitle })).toBeVisible();
  await page.getByRole("button", { name: t("action.move.in_progress") }).click();
  await toastSaved(page);
  // One conversation box (batch 4): the owner marks what they write as an update on the work.
  await page.locator(`#thread-${actionId}`).fill("بدأنا العمل على المحضر");
  await page.getByLabel(t("action.thread.asNote")).check();
  await page.getByRole("button", { name: t("action.thread.post") }).click();
  await expect(page.getByText("بدأنا العمل على المحضر")).toBeVisible();

  await page.getByRole("button", { name: t("action.move.awaiting_review") }).click();
  await page.locator("#send-file").setInputFiles({ name: "eicar.txt", mimeType: "text/plain", buffer: EICAR });
  // The page's button and the dialog's say the same words ("send for review"): press the dialog's.
  await page.getByRole("dialog").getByRole("button", { name: t("action.sendForReview") }).click();
  await expect(page.getByRole("alert").filter({ hasText: t("action.errors.infected") })).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/owner-ar-infected.png" });
  await page.context().close();
});

test("owner submits a clean PDF for review (Arabic)", async ({ browser }) => {
  const t = L("ar");
  const page = await open(browser, "abdullah", "ar");
  await page.goto(`/actions/${actionId}`);
  await page.getByRole("button", { name: t("action.move.awaiting_review") }).click();
  await page.locator("#send-file").setInputFiles({ name: "minutes.pdf", mimeType: "application/pdf", buffer: pdf() });
  await page.locator("#send-note").fill("المحضر مرفق");
  await page.getByRole("dialog").getByRole("button", { name: t("action.sendForReview") }).click();
  await toastSaved(page);
  await expect(page.getByText(t("status.awaiting_review")).first()).toBeVisible();
  // Bug 12: with one evidence item open, the file sent for review answers it.
  expect(one(`select count(*) from evidence_submissions where action_id='${actionId}' and evidence_request_id is not null`)).toBe("1");
  await page.screenshot({ path: "e2e-results/shots/owner-ar-awaiting.png", fullPage: true });
  await page.context().close();
});

test("consultant finds it in the Actions list awaiting review, downloads it and asks for a revision (English)", async ({ browser }) => {
  const t = L("en");
  const page = await open(browser, "khalid", "en", "dark");
  // The review queue is a filter of the Actions list (page audit 4.6); /review redirects there.
  await page.goto("/actions?filter=awaiting-review");
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
  // A client reader proposes a new date from the quiet "I need more time" under the next step (page audit 4.5).
  await page.getByRole("button", { name: t("action.next.moreTime") }).click();
  await pickNextMonthDay(page, "new-date");
  await page.locator("#date-reason").fill("ننتظر توقيع رئيس المجلس");
  await page.getByRole("button", { name: t("action.deadline.send") }).click();
  await toastSaved(page);
  // After a revision request one step sends the revised file for review (page audit 4.5; no "Resume work" first).
  // The first file already answered the only evidence item (bug 12), so the
  // item waits for the consultant; the signed file goes with the resubmission.
  await expect(page.getByRole("button", { name: t("sendFile.button") })).toHaveCount(0);
  await page.getByRole("button", { name: t("action.next.resend") }).click();
  await page.locator("#send-file").setInputFiles({ name: "minutes-signed.pdf", mimeType: "application/pdf", buffer: pdf("signed") });
  await page.getByRole("dialog").getByRole("button", { name: t("action.sendForReview") }).click();
  await expect(page.getByText(t("status.awaiting_review")).first()).toBeVisible();
  await page.context().close();
});

test("consultant approves the date and verifies the action (English)", async ({ browser }) => {
  const t = L("en");
  const page = await open(browser, "khalid", "en");
  await page.goto(`/actions/${actionId}`);
  await page.getByRole("button", { name: t("action.deadline.approve") }).click();
  await toastSaved(page);
  // Bug #11 (restored, review N6): with an item that has nothing sent, verifying says so, not
  // "someone else changed this action". The consultant asks for one more item, tries, then waives it.
  await page.getByRole("button", { name: t("action.items.add") }).click();
  await page.locator("#item-title").fill("Attendance sheet");
  await page.getByRole("dialog").getByRole("button", { name: t("action.items.add") }).click();
  await toastSaved(page);
  await page.getByRole("button", { name: t("action.move.verified_complete") }).click();
  await page.getByRole("dialog").getByRole("button", { name: t("action.confirm") }).click();
  await expect(page.getByRole("dialog").getByRole("alert").filter({ hasText: t("action.errors.openEvidence") })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: t("action.cancel") }).click();
  await page.getByRole("button", { name: t("common.moreFor", { name: "Attendance sheet" }) }).click();
  await page.getByRole("menuitem", { name: t("action.items.waive") }).click();
  await page.locator("#reason").fill("The minutes list who attended.");
  await page.getByRole("dialog").getByRole("button", { name: t("action.confirm") }).click();
  await toastSaved(page);
  // October review, item 12: the only item left has its file, so verifying accepts it in the same step.
  await page.getByRole("button", { name: t("action.move.verified_complete") }).click();
  await page.getByRole("dialog").getByRole("button", { name: t("action.confirm") }).click();
  await expect(page.getByText(t("status.verified_complete")).first()).toBeVisible();
  expect(one(`select count(*) from evidence_requests where action_id='${actionId}' and status = 'accepted'`)).toBe("1");
  // Reopening is a rare step: in the page menu, not a button.
  await expect(page.getByRole("button", { name: t("action.reopen") })).toHaveCount(0);
  await page.getByRole("button", { name: t("action.menu.label") }).click();
  await expect(page.getByRole("menuitem", { name: t("action.reopen") })).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/consultant-en-verified.png", fullPage: true });
  await page.context().close();
});

// Bug #17, built: the owner hears about each step by mail too, with a link
// to the action and never its title (baseline: Action mail).
test("the owner gets a mail when the action is released, sent back and verified", async () => {
  const api = await request.newContext();
  type Msg = { ID: string; Subject: string };
  let mine: Msg[] = [];
  await expect
    .poll(
      async () => {
        const r = await api.get("http://localhost:8025/api/v1/search?query=" + encodeURIComponent(`to:"abdullah@nukhba.example" actions/${actionId}`));
        mine = ((await r.json()) as { messages?: Msg[] }).messages ?? [];
        return mine.map((m) => m.Subject).sort();
      },
      { timeout: 60_000, message: "action mail to the owner" },
    )
    .toEqual(
      [
        "إجراء جديد مُسند إليك | An action is assigned to you",
        "طُلب تعديل على إجراء | A revision was requested",
        "تم التحقق من إنجاز إجراء | An action was verified",
      ].sort(),
    );
  for (const m of mine) {
    const msg = (await (await api.get(`http://localhost:8025/api/v1/message/${m.ID}`)).json()) as { Text: string; HTML: string };
    expect(msg.Text).toMatch(new RegExp(`https?://\\S+/actions/${actionId}`));
    expect(msg.Text + msg.HTML).not.toContain(actTitle);
    expect(msg.HTML).toContain('dir="rtl"');
  }
});
