# Scenario brief (shared by every scenario helper)

Read first: `docs/review/inputs/selah-big-prompt-v2.md` section 9 (9.0 setup, 9.1 what to record, 9.2 cast, 9.3 the scenario text), then `docs/review/work/scenarios-plan.md` (section 0 "what changed", accounts, data, your scenarios' steps). Synthetic files: `docs/review/scenario-files/` (README says which step uses which; D14 EICAR is made on the spot, never kept). Rules: `docs/review/work/phase3-brief.md` (synthetic data only, never name the partner firm, nothing leaves this machine).

## Your copy
- Fresh git worktree from `origin/main` under `C:\Projects\selah-fresh\.claude\worktrees\scen-<copy>` (`git fetch` first). Run `npm ci` once in it.
- Start your own instance: `SELAH_INSTANCE=scen<copy>` then `npm run walkthrough -- --fresh` (add `--full` only if your copy needs the virus scanner). Read `scripts/local.mjs` for the ports it picks and the mail catcher; never use ports 3010/3930 or the `selah-lead` / `selah` / `trail` containers. `--fresh` on YOUR instance only.
- All scenarios run on the **same calendar day as your seed load** (dates are relative).
- Drive the real UI with Playwright as the real role, by reading the screen and clicking (URL pasting only where the scenario is an isolation check). One signed-in context per account (`storageState`); sign-in is limited to 10 per account per 15 minutes. Walkthrough password `123456789@Pass` (test value, localhost only).
- Manual job runs where the plan says (`npm run job:*` in your instance).

## The local model
Only one chat-model run on the whole machine at a time. Copy B owns the model for scenario 13. Copy A must NOT run scenario 20's paste step until the lead tells it to (send the lead a message and continue with other steps).

## What to record (9.1)
Per step: pass/fail, screenshot path, clicks, page time, console/server errors, one line on anything confusing. Per scenario: the four plain-words answers. Write each scenario to `docs/review/scenarios/<nn>-<slug>.md` in `C:\Projects\selah-lead` (create the folder), screenshots under `docs/review/scenarios/shots/<nn>/`. Mark anything that showed something to the wrong person as **PRIVACY** at the top of that scenario file. Don't fix the app; report. If a step can't be done because the app changed, say what you did instead.

## When you're done
Collect every record URL you visited per account into `docs/review/scenarios/urls-<copy>.json` (for the isolation sweep). Leave the instance running (the sweep runs on it) and tell the lead.
