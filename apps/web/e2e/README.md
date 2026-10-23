# End-to-end tests

Playwright against the whole stack in Docker: the web app, Postgres with pgvector, RustFS, clamd, the PDF renderer (Gotenberg), the mail job with Mailpit as the SMTP server, the scheduled jobs, and the AI service (local bge-m3, the configured chat model).

```sh
# From the repo root: the stack, then sample data.
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm seed
# For the assistant tests: the evaluation files (indexed by the jobs service within two minutes).
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm seed npx tsx scripts/assistant-eval/seed.ts

cd apps/web
npx playwright test              # everything (about 20 minutes, most of it the screen crawl)
npx playwright test core-flow    # one file
```

The first run signs in every seeded user once, sets up two-factor sign-in for the roles that need it (the secrets go to `e2e/.auth/`, never committed) and keeps the sessions for 7 hours. Sign-ins wait a minute apart because of the rate limit. Mailpit's inbox is at http://localhost:8025.

| File | What it covers |
|---|---|
| `auth.setup.ts` | Sign-in and two-factor setup for all seven roles |
| `core-flow.e2e.ts` | Recommendation → action → evidence (EICAR refused) → revision → due-date request → verified; owner in Arabic, consultant in English |
| `intake-staffing.e2e.ts` | Public inquiry form → triage → discovery → client with a lead → join request → staffing |
| `accounts.e2e.ts` | Invitation and password reset through the real mail job and SMTP |
| `meetings.e2e.ts` | Booking, the calendar invite mail, the client's view, another client's denial |
| `assessments.e2e.ts` | Answering and finalising; the client never sees scores |
| `reports.e2e.ts` | A frozen report, shared with the client, hidden from other clients |
| `assistant.e2e.ts` | A sourced Arabic answer from the real model, the language switch, who can ask |
| `files.e2e.ts` | clamd, file type checks, signed links, the private bucket, reuse as evidence |
| `import-export.e2e.ts` | Excel import (title row, merged cells, Hijri date, a row fixed in review, release), the same file again adding nothing, a Word outline as firm-only, Excel exports per role, a report as Arabic PDF, and the denials |
| `api-probes.e2e.ts` | Cross-tenant and role probes through the HTTP API |
| `crawl.e2e.ts` | Every reachable screen per role in Arabic (light) and English (dark): errors, direction, sideways scroll at 1440 and 1024 px, axe WCAG AA |

Screenshots and crawl findings go to `e2e-results/`. Bugs found are in `docs/testing/bug-tracker.md`.
