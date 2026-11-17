// Pages that only need opening: sign-in and its notices, forgot password, the
// token pages with made-up tokens, legal texts, privacy, not found.
// Reads only; submits nothing.
import { chromium, context, open, shoot } from "./lib.mjs";

const FAKE43 = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"; // 43 characters, well formed, not a real token
const FAKE32 = "AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf"; // 32 letters

const PAGES = [
  ["01-sign-in", "/sign-in"],
  ["02-sign-in-error-no-access", "/sign-in?error=no_access"],
  ["03-sign-in-error-link", "/sign-in?error=INVALID_TOKEN"],
  ["04-sign-in-done-invited", "/sign-in?done=invited"],
  ["05-sign-in-done-reset", "/sign-in?done=reset"],
  ["06-sign-in-done-email", "/sign-in?done=email"],
  ["10-forgot-password", "/forgot-password"],
  ["20-sign-in-link-bad-token", "/sign-in/link/not-a-token"],
  ["21-sign-in-link-wellformed-fake", `/sign-in/link/${FAKE32}`],
  ["30-reset-password-bad-token", "/reset-password/x"],
  ["31-reset-password-wellformed-fake", `/reset-password/${FAKE32}`],
  ["40-invite-bad-token", "/invite/not-a-token"],
  ["41-invite-wellformed-fake", `/invite/${FAKE43}`],
  ["50-confirm-email-bad-token", "/confirm-email/x"],
  ["51-confirm-email-wellformed-fake", `/confirm-email/${FAKE43}`],
  ["60-consent-signed-out", "/consent"],
  ["61-security-signed-out", "/security"],
  ["70-inquiry", "/inquiry"],
  ["80-privacy", "/privacy"],
  ["81-legal-terms", "/legal/terms"],
  ["82-legal-privacy", "/legal/privacy"],
  ["83-legal-ai", "/legal/ai"],
  ["84-legal-data-agreement", "/legal/data-agreement"],
  ["85-legal-sub-processors", "/legal/sub-processors"],
  ["86-legal-security", "/legal/security"],
  ["87-legal-unknown", "/legal/nothing"],
  ["90-upload-bad-token", "/upload/not-a-token"],
  ["91-upload-wellformed-fake", `/upload/${FAKE43}`],
  ["95-not-found-signed-out", "/this-page-does-not-exist"],
  ["96-home-signed-out", "/"],
  ["97-app-page-signed-out", "/projects"],
];

const only = process.argv[2];
const browser = await chromium.launch();
for (const locale of ["ar", "en"]) {
  const c = await context(browser, locale);
  for (const [name, path] of PAGES) {
    if (only && !name.includes(only)) continue;
    const status = await open(c, path);
    const u = new URL(c.page.url());
    const landed = u.pathname + u.search;
    await shoot(c, locale, name, { path, status, redirectedTo: landed !== path ? landed : null });
  }
  await c.ctx.close();
}
// English in dark mode.
if (!only) {
  const d = await context(browser, "en", { dark: true });
  for (const [name, path] of [["01-sign-in", "/sign-in"], ["70-inquiry", "/inquiry"], ["91-upload-wellformed-fake", `/upload/${FAKE43}`], ["81-legal-terms", "/legal/terms"]]) {
    const status = await open(d, path);
    await shoot(d, "en", name, { path, status, dark: true });
  }
  await d.ctx.close();
}
await browser.close();
