# Selah · صِلَة

AI-assisted governance and consulting implementation platform. A Computer Science graduation project built with Maayish Consulting.

Selah connects consulting outputs (recommendations, policies, structures) to owners, actions, evidence, consultant review and follow-up, with an Arabic-first assistant that answers only from material the asking user is allowed to see.

> **Status:** backend skeleton (step 3 of the plan). The user interface (step 4) is not built yet. Everything here is a team proposal, not a Maayish or supervisor decision. Use synthetic data only.

Design documents: the **Scope, Permissions and AI Access Spec** and the **Stack Decision Record** (shared separately). This repo implements them.

## Layout

```
apps/web/            Next.js app: both portals and the API (TypeScript)
  src/authz/         THE authorization check. Pure functions, fully unit-tested.
  src/server/http.ts route(): the only way to write an API route
  src/services/      Business logic. Every function calls authorize() first.
  src/db/schema/     Drizzle schema (tables)
  src/auth/          Better Auth (sign-in, sessions, 2FA)
  drizzle/           SQL migrations, incl. 0001_security.sql (row-level security)
  tests/             Unit tests, route guard, and Postgres RLS tests (tests/db)
services/ai/         Python FastAPI service: embeddings and cited answers via Ollama
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

The first start downloads the AI models (about 6 GB). Then open http://localhost:3000.

To create the synthetic demo users (one per role, password from `SEED_PASSWORD`), run `npm run db:seed` from `apps/web` as described below.

### Developing the web app without Docker for it

Run only the backing services in Docker and the app with hot reload:

```sh
docker compose up db storage ollama ollama-pull ai -d
cd apps/web
cp .env.example .env.local  # fill in, using the passwords from the root .env
npm install
npm run db:migrate          # uses DATABASE_OWNER_URL
npm run storage:init
npm run db:seed
npm run dev
```

## Tests

```sh
cd apps/web
npm test                    # authorization rules, workflow, route guard
npm run lint && npm run typecheck

# Row-level security against a real Postgres (uses the selah_test database):
DATABASE_OWNER_URL=$TEST_DATABASE_OWNER_URL npm run db:migrate
npm run test:db

cd ../../services/ai
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

CI runs all three on every pull request.

## The rules that keep data separate

1. **One check.** Every API route, download, export, search and AI retrieval goes through `authorize()` in `apps/web/src/authz`. See [docs/authorization.md](docs/authorization.md).
2. **Routes can't skip it.** API routes must be built with `route()`; `tests/route-guard.test.ts` fails otherwise, and ESLint stops pages from importing the database.
3. **The database is the backstop.** Postgres row-level security enforces tenant, engagement and visibility-label isolation for the app's database role, so one missed check in app code cannot leak another client's data.
4. **Deny by default.** A new table has no grants and a new permission has no roles until someone adds them.
5. **AI sees only what you could open.** Retrieval filters run inside the vector query and under RLS. The AI service never gets database credentials.

See [docs/security.md](docs/security.md) for the OWASP ASVS 5.0 and OWASP LLM Top 10 mapping.
