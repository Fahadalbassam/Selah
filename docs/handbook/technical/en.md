# Technical pack

For the firm's IT person: what runs, how a request is checked, how to deploy, back up and restore, and how to extend Selah. Much of this is already written in other files in `docs/`; this page gives the short version and links to them rather than repeating them.

[العربية](ar.md) · [Handbook front page](../en.md)

| Read next | For |
|---|---|
| [docs/handoff.md](../../handoff.md) | What Selah is, the stack, the repository layout, how the team works |
| [docs/operations.md](../../operations.md) | Traffic in (tunnel or direct), backups, restore drill, restoring, health checks and alerts, upgrading, breach runbook |
| [docs/data-architecture.md](../../data-architecture.md) | One database, file storage, what the assistant can reach |
| [docs/authorization.md](../../authorization.md) | Who sees and does what, and how a request flows |
| [docs/rules.md](../../rules.md) | Every business rule: its database object, the TypeScript that checks it first, and its test |
| [docs/security.md](../../security.md) | OWASP ASVS 5.0 and OWASP Top 10 for LLM applications mapping, database roles, audit log |
| [README.md](../../../README.md) | Running it locally and by hand |

<a id="architecture"></a>

## 1. Architecture: the containers

Everything runs from `docker-compose.yml` on one Linux server. Every port is bound to `127.0.0.1`, except the `edge` container's 80 and 443 when the direct profile is on. Secrets come from `.env` (copy `.env.example`; never commit `.env`).

| Service | Image or build | What it does |
|---|---|---|
| `db` | `pgvector/pgvector` (Postgres 16 with pgvector) | The one database: every organisation's rows side by side, kept apart by row-level security; also holds the assistant's search index |
| `storage` | `rustfs/rustfs` | The private S3-compatible bucket for files. Any S3 store works through `.env` |
| `clamav` | `clamav/clamav` | Virus scanner. The web app refuses uploads while it is down. Needs at least 3 GiB free RAM (4 preferred) |
| `pdf` | `gotenberg/gotenberg` (Chromium) | Draws PDF exports. On an internal network with no route out, no published port. PDF exports are refused while it is down |
| `ollama` | `ollama/ollama` | Runs the local models: the search model (bge-m3, always local) and, if chosen, the local chat model |
| `ollama-pull` | `ollama/ollama` | One-shot: pulls the models into the `ollama-models` volume |
| `ai` | built from `services/ai` (Python FastAPI) | Embeddings, answers, summaries, translation, behind one provider switch (`services/ai/app/llm.py`). Has no database or storage credentials |
| `setup` | built from `apps/web` (tools stage) | One-shot: runs the migrations as the schema owner, then creates the private bucket |
| `web` | built from `apps/web` (runner stage) | The Next.js app: both portals and the API |
| `mail` | built from `apps/web` (tools stage) | Sends queued mail through the relay, waking on each new mail |
| `jobs` | built from `apps/web` (tools stage) | The scheduled jobs (`apps/web/scripts/jobs.sh`): every two minutes, indexing for the assistant, removing deleted files' bytes, audit sealing and the readiness check; daily (Riyadh date), reminders, quiet-client alerts, indicator feeds, the audit chain check and retention purges; monthly, metrics snapshots and status pack drafts |
| `edge` | `caddy` (profile `direct`) | HTTPS on ports 80 and 443 with its own certificates |
| `edge-tunnel` | `caddy` (profile `tunnel`) | The same Caddy, reached only by `cloudflared` |
| `cloudflared` | `cloudflare/cloudflared` (profile `tunnel`) | Cloudflare Tunnel: the server opens the connection; no open port |

Volumes: `db-data`, `storage-data`, `ollama-models`, `clamav-db`, `edge-data`. The two ways in, and when to switch from the tunnel to direct, are in [operations.md, "How traffic reaches it"](../../operations.md#how-traffic-reaches-it).

<a id="layers"></a>

## 2. The request and security layers

A request passes these layers in order. Each one can refuse it; none of them trusts what the browser says about who it is.

1. **Caddy** (`ops/edge/Caddyfile`): HTTPS, security headers and limits, and the visitor's address set by Caddy itself (the sign-in and inquiry limits use it).
2. **The page proxy** (`apps/web/src/proxy.ts`): a fresh Content Security Policy nonce on every page, so an injected script does not run.
3. **`route()`** (`apps/web/src/server/http.ts`), the only way to write an API route (`tests/route-guard.test.ts` fails the build otherwise): it refuses cross-site writes (the Origin must be the app), requires a valid session, builds the person (`Principal`) from the database, validates parameters and body with Zod, and runs the handler in one transaction as that user so row-level security applies to every query. Pages load their data the same way, through `withPrincipal()` (`src/server/page.ts`) and the read services; ESLint stops pages from importing the database.
4. **`authorize()`** (`apps/web/src/authz/`): five questions in order (organisation, role, project membership or client assignment, scope of the grant, visibility label), then a sixth that only ever says no (was this person left out of the item). The permission table is `POLICY` in `policy.ts`. Every service calls it before acting.
5. **Postgres row-level security**: the app's role (`selah_app`) has no `BYPASSRLS` and sees only the rows its policies allow, so one missed check in app code still cannot reach another client's data. A new table has no grants until a migration adds them.

A refusal anywhere answers **404**, the same as a missing record, and is written to the audit log. Files are opened only through a one-minute signed link the server issues after the same checks, and every download is audited. The assistant's search runs inside this chain: the web app searches as the signed-in person, with the permission filter inside the vector query and under row-level security, and hands the AI service only the passages that survive. Details: [authorization.md, "How a request flows"](../../authorization.md#how-a-request-flows), [data-architecture.md, "What the assistant can reach"](../../data-architecture.md#5-what-the-assistant-can-reach-built).

<a id="deploy"></a>

## 3. Deployment

The steps are in the [README ("Run it")](../../../README.md#run-it) and [operations.md](../../operations.md). In short:

1. A Linux server with Docker. Clone the repository; copy `.env.example` to `.env` and fill every value (`openssl rand -base64 32` for each secret).
2. Choose the way in with `COMPOSE_PROFILES` (`tunnel` or `direct`) and set `SITE_DOMAIN`, `FILES_DOMAIN`, `APP_URL` and `S3_PUBLIC_ENDPOINT`.
3. Choose where answers are written: `LLM_PROVIDER=ollama` (local) or `openai_compat` with `LLM_API_BASE`, `LLM_API_KEY` and `LLM_MODEL` (hosted; names are masked first, `AI_MASKING=auto`). The search model always stays local.
4. `docker compose up -d`. The `setup` service runs the migrations and creates the bucket before the web app starts.
5. A production build refuses to start with upload scanning off or two-factor sign-in off. Firm admins, consultants and client admins set up two-factor sign-in at their first sign-in.
6. Check it: `/api/health` (the app runs) and `/api/ready` (database, bucket and scanner; the PDF renderer and the AI service only switch features off), and `ops/readiness.sh` on the server.
7. Before any real client file: the direct way in instead of the tunnel, a mail sender on the firm's own domain with SPF, DKIM and DMARC, backups on a second disk with the key kept off the server, and the legal texts reviewed by the firm's counsel ([handoff.md, "Open items"](../../handoff.md#11-open-items)).

Upgrading is `ops/upgrade.sh` (a backup first, then the new version and its migrations, then a wait for `/api/ready`), with `--rollback` to go back: [operations.md, "Upgrading"](../../operations.md#upgrading).

<a id="backups"></a>

## 4. Backups and restore

All in [operations.md](../../operations.md): [Backups](../../operations.md#backups), [Restore drill](../../operations.md#restore-drill), [Restoring](../../operations.md#restoring). In one paragraph: `ops/backup.sh` (nightly from cron) dumps the database and lists every stored file with its checksum, with `--offsite` writing an encrypted copy for the second location; `ops/restore-drill.sh` (monthly) restores the newest backup into a scratch database and checks row counts, the audit chain and every file, without touching the live site; `ops/restore.sh <backup> --yes` replaces the live database after running the drill on that backup first. At most a day of work is lost with one backup a night.

<a id="extend"></a>

## 5. How to extend

Read `apps/web/AGENTS.md` first: the Next.js version in use differs from older versions, and its own docs are under `apps/web/node_modules/next/dist/docs/`. Every change keeps Arabic and English, right-to-left first.

<a id="extend-permission"></a>

### Add a permission

1. Add it to `POLICY` in `apps/web/src/authz/policy.ts` with the narrowest grants that work (`any`, `assigned`, `own`, `lead`, `working` and the other scopes are explained at the top of the file and in [authorization.md, "The five questions"](../../authorization.md#the-five-questions)). A permission not listed is denied.
2. In the service, load the row, build the `Resource` and call `assertAllowed()` before acting. Expose it with `route()`.
3. If it changes who may read or write rows, add the matching row-level security policy (or function) in a new migration (below). Both layers must agree.
4. Add allow **and** deny tests: `tests/authorize.test.ts` for the rule, `tests/db/` for the database (other tenant, other project, wrong role, wrong department, wrong label).
5. Add its row to [docs/rules.md](../../rules.md), and change [docs/authorization.md](../../authorization.md) when it changes who may see or do something. For a new kind of record, follow [authorization.md, "Adding a new record type"](../../authorization.md#adding-a-new-record-type-checklist).

<a id="extend-migration"></a>

### Add a migration

The schema is in `apps/web/src/db/schema/`; migrations are numbered SQL files in `apps/web/drizzle/`, with snapshots in `apps/web/drizzle/meta/`. `0000_baseline.sql` is the starting schema, and every later file adds to it or redefines what it holds.

1. A change to tables or columns: edit the schema, then `npx drizzle-kit generate --name <name>`. A change to functions, policies, triggers or grants only: `npx drizzle-kit generate --custom --name <name>` and write the SQL by hand.
2. Never edit a migration that is already merged. To change a function or a policy, find its latest definition by searching every file in `apps/web/drizzle/` for its name (later files win), and redefine it in the new file (`CREATE OR REPLACE FUNCTION`, `DROP POLICY … ; CREATE POLICY …`).
3. drizzle-kit compares with the snapshot whose file name sorts last. Commit the snapshot with the migration, run `npx drizzle-kit check`, and generate once more to confirm it says there are no schema changes.
4. `npm run db:migrate` in `apps/web` (it uses `DATABASE_OWNER_URL`); on the server the `setup` service runs it.
5. Rules and tests as for a permission. The team's full routine is in [handoff.md, "How the team works"](../../handoff.md#9-how-the-team-works).

<a id="extend-screen"></a>

### Add a screen

1. A page is a folder under `apps/web/src/app/(app)/` (signed in), `(auth)` (sign-in) or `(public)`. It loads its data through `withPrincipal()` and a read service in `src/services/`, never from the database directly.
2. Any API it calls is a route built with `route()`.
3. If it needs a sidebar row, add it in `src/lib/nav.ts` for the roles it applies to (`tests/navigation.test.ts`). The row is not the access control: the page checks its reader on the server and answers 404 otherwise.
4. Follow [docs/ui-guidelines.md](../../ui-guidelines.md): shadcn/ui and the Selah components, colour tokens only, logical (right-to-left safe) classes only, one solid button per card, 768 px and wider. Show states with the six status words (`lib/status-words.ts`, [docs/placement.md](../../placement.md)).
5. Every label in both message files (next section). Update [docs/walkthrough.md](../../walkthrough.md) when a screen or a "who sees what" row changes.

<a id="extend-translation"></a>

### Add a translation

Screen text lives in `apps/web/messages/ar.json` and `apps/web/messages/en.json` (next-intl), with the same key path in both.

1. Write the Arabic first, in natural Arabic, then the English. On client screens speak to the reader ("your company", «شركتكم»).
2. Read it in a page with `getTranslations()` (server) or `useTranslations()` (client component).
3. Mail, exports, PDFs, errors and tooltips are text too and go in the same files. A new audit action needs an Arabic and English label and an area (`tests/audit-labels.test.ts` checks it).
4. Translating what people write (a recommendation, a comment) into the other language is a different feature, done on request by the AI service: [docs/translations.md](../../translations.md).

<a id="checks"></a>

## 6. The checks

In `apps/web`: `npm run lint`, `npm run typecheck`, `npm test` (unit), `npm run test:db` (row-level security against a real Postgres), `npm run test:scan` (against a real ClamAV); in `services/ai`, `pytest`. CI runs them on every pull request. The commands are in the [README ("Tests")](../../../README.md#tests).
