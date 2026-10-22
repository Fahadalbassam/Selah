import { existsSync, statSync } from "node:fs";
import { test as setup } from "@playwright/test";
import { signIn } from "./support/session";
import { authFile, USERS, type UserKey } from "./support/users";

// One sign-in per seeded user, kept as a storage state for the other tests
// (sessions last 8 hours; a state younger than 7 is reused). Better Auth
// allows 5 sign-ins and 5 two-factor calls per address, and its window
// restarts on every call, so each sign-in waits for a quiet minute first.
setup.describe.configure({ timeout: 180_000 });
for (const u of Object.keys(USERS) as UserKey[]) {
  setup(`sign in as ${u}`, async ({ page }) => {
    const f = authFile(u);
    if (existsSync(f) && Date.now() - statSync(f).mtimeMs < 7 * 3600_000) return;
    await page.waitForTimeout(61_000);
    await signIn(page, u);
    await page.context().storageState({ path: f });
  });
}
