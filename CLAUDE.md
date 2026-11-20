# Selah: notes for anyone (person or AI) changing the code

Selah follows consulting recommendations through to implementation, for a consulting firm and its clients. Arabic first, then English. Next.js app in `apps/web`, Postgres with row-level security, a Python AI service in `services/ai`, one local Ollama model.

## Read first
- `docs/system-map.md`: every feature, its files, tables, roles, risks and connections, and "if you change X, also check Y". **Any PR that changes a connection (a new import across features, a table, a policy entry, an AI call, a job) updates `docs/system-map.md` in the same PR** (and re-generates the interactive map once it exists).
- `docs/handoff.md` (how it is built), `docs/rules.md` (every product rule, one row each), `docs/authorization.md` (who sees what), `docs/assistant.md` (the assistant, masking, the number scanner, jobs), `docs/operations.md` (running it, upgrades, **Before go-live**).

## How it fits together
pages (`apps/web/src/app/(app)`, `(auth)`, `(public)`) → route handlers (`apps/web/src/app/api/**/route.ts`, all through `route()` in `src/server/http.ts`) → services (`src/services`) → Postgres (Drizzle schema in `src/db/schema`, SQL in `apps/web/drizzle/NNNN_*.sql`) → permission checks twice: `authorize()` with `src/authz/policy.ts` in the app, and row-level security in the database. AI: `src/services/ai-client.ts` → `services/ai` → Ollama (`qwen3.5:4b` chat, `bge-m3` embeddings). Slow AI work runs as jobs (`src/jobs/ai-jobs.ts`), one model run at a time.

Roles: `firm_admin`, `consultant` (lead, deputy, staffed, observer), `client_admin`, `client_manager`, `action_owner`. Action states and the six status words are in `docs/rules.md`.

## Rules that are easy to break
- **Two layers of permission.** A change to who may see or do something touches `policy.ts`, the service, **and** the database rule, with a test as the wrong user for each.
- **Migrations:** one new file numbered after the last in `apps/web/drizzle/meta/_journal.json`; journal `when` later than the previous; snapshot `prevId` = the previous snapshot's id; never edit a migration that is on `main`. Two open PRs with the same number: the second to merge renumbers and re-chains. `drizzle-kit check` and the probe ("No schema changes") must be clean.
- **Privacy:** never put real client data, real names or keys in code, tests, logs or messages. Never name the partner consulting firm; the sample firm is the fictional Mizan Advisory. Never read `.env` files outside your own copy.
- **AI:** the database filters, never a model. Masking fails closed (`maskingOn()`); the number scanner runs on everything sent to a model, local or hosted; one model run at a time; prefer plain rules and SQL over AI ("keep it light, keep it fast").
- **UI:** Arabic first; plain words; no judging words or colours for client numbers; labels from `apps/web/messages/ar.json` / `en.json`.
- **Reviews:** an independent review for any privacy, permission, AI or database change; low-effort code review and green CI before merge.

## Checks
From `apps/web`: `npm run lint`, `npm run typecheck`, `TZ=UTC npm test`, `npm run test:db` (needs a test database), `npx drizzle-kit check`. AI service: `python -m pytest -q` in `services/ai`.
