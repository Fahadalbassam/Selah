# Selah · صِلَة

Selah is a platform for consulting firms. A firm runs its own internal projects in it with its staff, and follows its clients through implementation: from recommendation to owner, action, evidence, review and sign-off.

Selah connects consulting outputs (recommendations, policies, structures) to owners, actions, evidence, consultant review and follow-up, with an Arabic-first assistant that answers only from material the asking user is allowed to see.

> **Status:** in active development. Use sample data only until hosting and data handling are approved for real client data.

## Who sees what

- **The firm** is the consulting company running Selah. Its staff are a firm admin and consultants.
- **Internal projects** belong to the firm itself. Only firm staff who are members see them; clients never do.
- **Client projects** belong to a client organization. A consultant sees a client only when the firm admin assigns them to it (`client_assignments`), and then sees all of that client's projects. Other consultants don't.
- **Client users** (client admin, client manager, action owner) see only their own organization. Firm documents stay `firm_private` unless someone chooses to share them with the client.

Design documents: the **Scope, Permissions and AI Access Spec** and the **Stack Decision Record** (shared separately). This repo implements them.

## Layout

```
apps/web/            Next.js app: both portals and the API (TypeScript)
  src/authz/         THE authorization check. Pure functions, fully unit-tested.
  src/server/http.ts route(): the only way to write an API route
  src/services/      Business logic. Every function calls authorize() first.
  src/db/schema/     Drizzle schema (tables)
  src/auth/          Better Auth (sign-in, sessions, 2FA)
  src/app/           Pages: (app) is the signed-in shell, (auth) is sign-in
  src/components/    App sidebar, tables, badges; components/ui is shadcn/ui
  messages/          Arabic and English strings (next-intl)
  drizzle/           SQL migrations, incl. 0001_security.sql (row-level security)
  tests/             Unit tests, route guard, and Postgres RLS tests (tests/db)
services/ai/         Python FastAPI service: cited answers via a swappable LLM provider
db/init/             Creates database roles on first start
docs/                Architecture, authorization and OWASP notes
```

## Run it

You need Docker Desktop. On Windows, clone with Git for Windows; `.gitattributes` keeps the shell scripts in LF.

```sh
git clone https://github.com/fahadalbassam/selah.git
cd selah
cp .env.example .env        # then fill every value (openssl rand -base64 32)
docker compose up --build
```

The first start downloads the local AI models (a few GB). Then open http://localhost:3000.

To create sample users (one per role, password from `SEED_PASSWORD`), run `npm run db:seed` from `apps/web` as described below. Sign in as `sara@mizan.example` (firm admin), `khalid@mizan.example` or `noura@mizan.example` (consultants), `fahd@nukhba.example` (client admin), `reem@nukhba.example` (client manager), `abdullah@nukhba.example` (action owner) or `hind@rawdah.example` (client manager of a second client).

### AI provider

The AI service talks to the model through one interface (`services/ai/app/llm.py`). Set `LLM_PROVIDER=ollama` (default, runs `qwen3:4b` locally, fits a 4 GB GPU such as a GTX 1050) or `LLM_PROVIDER=openai_compat` with `LLM_API_BASE`, `LLM_API_KEY` and `LLM_MODEL` to use a hosted API for answers. Embeddings always stay local (`bge-m3`), so document text is only sent to a hosted API as the passages of a question.

### Developing the web app without Docker for it

Run only the backing services in Docker and the app with hot reload:

```sh
docker compose up db storage clamav ollama ollama-pull ai -d
cd apps/web
cp .env.example .env.local  # fill in, using the passwords from the root .env
npm install
npm run db:migrate          # uses DATABASE_OWNER_URL
npm run storage:init
npm run db:seed
npm run dev
```

## Frontend

Built from the free official shadcn/ui blocks: `sidebar-07` (collapsible icon sidebar with the user menu at the bottom), `sidebar-03` (grouped sub-menus) and the cards and tables from `dashboard-01`. Arabic is the default and the layout flips to right-to-left; English is a toggle in the user menu, as is dark mode. Every page loads its data through `withPrincipal()` and the read services in `src/services/queries.ts`, which run each row through `authorize()`, so the UI shows exactly what the API allows.

## Tests

```sh
cd apps/web
npm test                    # authorization rules, workflow, route guard
npm run lint && npm run typecheck

# Row-level security against a real Postgres (uses the selah_test database):
DATABASE_OWNER_URL=$TEST_DATABASE_OWNER_URL npm run db:migrate
npm run test:db

# Upload scanning against a real ClamAV (docker compose up clamav -d):
CLAMD_HOST=localhost npm run test:scan

cd ../../services/ai
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

CI runs all of these on every pull request. ClamAV needs at least 3 GiB of free RAM on the host (4 GiB preferred).

## The rules that keep data separate

1. **One check.** Every API route, download, export, search and AI retrieval goes through `authorize()` in `apps/web/src/authz`. See [docs/authorization.md](docs/authorization.md).
2. **Routes can't skip it.** API routes must be built with `route()`; `tests/route-guard.test.ts` fails otherwise, and ESLint stops pages from importing the database.
3. **The database is the backstop.** Postgres row-level security enforces tenant, project and visibility-label isolation for the app's database role, so one missed check in app code cannot leak another client's data.
4. **Deny by default.** A new table has no grants and a new permission has no roles until someone adds them.
5. **AI sees only what you could open.** Retrieval filters run inside the vector query and under RLS. The AI service never gets database credentials.

See [docs/security.md](docs/security.md) for the OWASP ASVS 5.0 and OWASP LLM Top 10 mapping.

See [docs/data-architecture.md](docs/data-architecture.md) for how the database, file storage and the assistant's access fit together.
