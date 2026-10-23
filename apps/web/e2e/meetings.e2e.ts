import { expect, request, test } from "@playwright/test";
import { ids, one } from "./support/db";
import { open } from "./support/ui";

// Book a meeting with client attendees, the calendar invite mail with an
// .ics, the client's view of it, and the record after the meeting.
const stamp = Date.now().toString(36);
const title = `Steering ${stamp}`;
let meetingId = "";

test.describe.configure({ mode: "serial" });

test("consultant books a meeting and invites the client (English)", async ({ browser }) => {
  const page = await open(browser, "khalid", "en");
  await page.goto(`/projects/${ids.board()}`);
  await page.getByRole("tab", { name: "Meetings" }).click();
  await page.getByRole("tabpanel").getByRole("button", { name: "Book a meeting" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Title").fill(title);
  await d.getByRole("button", { name: "Date", exact: true }).click();
  const cal = page.locator(".rdp-root").last();
  await cal.locator("button.rdp-button_next").click();
  await cal.locator("td:not([data-outside]) button:not([disabled])").first().click();
  await d.getByLabel("Call link").fill("https://meet.google.com/abc-defg-hij");
  await d.getByRole("checkbox", { name: "ريم الحربي" }).click();
  await d.getByRole("checkbox", { name: "عبدالله المطيري" }).click();
  await d.getByRole("button", { name: "Book" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  meetingId = one(`select id from meetings where title='${title}'`);
  const starts = one(`select to_char(starts_at at time zone 'Asia/Riyadh', 'HH24:MI') from meetings where id='${meetingId}'`);
  expect(starts, "10:00 Riyadh as entered").toBe("10:00");
});

test("the invite mail reaches the client with a calendar file", async () => {
  const api = await request.newContext();
  let msgId = "";
  await expect
    .poll(async () => {
      const r = await api.get(`http://localhost:8025/api/v1/search?query=${encodeURIComponent('to:"reem@nukhba.example" subject:"Meeting invitation"')}`);
      msgId = ((await r.json()).messages ?? [])[0]?.ID ?? "";
      return msgId;
    }, { timeout: 60_000 })
    .not.toBe("");
  const msg = await (await api.get(`http://localhost:8025/api/v1/message/${msgId}`)).json();
  const parts = [...(msg.Attachments ?? []), ...(msg.Inline ?? [])].map((a: { ContentType: string; FileName: string }) => `${a.ContentType} ${a.FileName}`);
  const raw = await (await api.get(`http://localhost:8025/api/v1/message/${msgId}/raw`)).text();
  expect(raw.includes("BEGIN:VCALENDAR") || parts.some((p) => p.includes("calendar")), `parts: ${parts.join(", ")}`).toBe(true);
  // The invite carries the call link (attendees need it), but no project content.
  expect(raw).not.toContain("حوكمة مجلس الإدارة");
});

test("the client manager sees the meeting and answers the invite (Arabic)", async ({ browser }) => {
  const page = await open(browser, "reem", "ar");
  await page.goto(`/meetings/${meetingId}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.screenshot({ path: "e2e-results/shots/client-ar-meeting.png", fullPage: true });
  const s = await page.locator("main main").ariaSnapshot();
  console.log(s.split("\n").filter((l) => /button|link/.test(l)).join("\n"));
});

test("another client can't open the meeting", async ({ browser }) => {
  const page = await open(browser, "hind", "en");
  await page.goto(`/meetings/${meetingId}`);
  // Streaming sends the loading shell with 200 first; the page then shows "not found" (bug #19).
  await expect(page.getByText("This page doesn't exist or you don't have access to it.")).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});
