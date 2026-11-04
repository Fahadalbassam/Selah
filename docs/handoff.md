# Selah hand-off

A guide for someone joining the team: what Selah is, how it works, what is built, what it is built with, and how to run it. Written on 2026-11-04 against `main` at `4042f73` (PR #138). The other files in `docs/` hold the detail; this page tells you where to look.

Where this page is unsure, it says so. Everything listed as built is merged on `main` and covered by tests unless noted.

---

## 1. What Selah is

Selah (صِلَة, "connection") is a platform for consulting firms. After a firm delivers its work (plans, policies, organisational structures, recommendations), putting that work into practice is hard to follow. Selah connects each consulting output to an owner, actions, evidence, the consultant's review and follow-up, so both sides can see what is really done.

- **Generic product.** Selah is built for any consulting firm. It started as a six-student Computer Science graduation project developed with a Saudi consulting firm as the partner, but the partner is never named in the product, the UI or the docs.
- **It connects, it does not consult.** Selah never writes official recommendations, approves evidence, makes governance judgements or rules on legal compliance. People do; Selah records and shows it.
- **Arabic first.** Arabic and right-to-left is the default; everything also exists in English.
- **Presented as a production app**, not a prototype. It runs on sample data only until hosting and data handling are approved for real client data.
- **Single firm per install.** One installation serves one consulting firm and its clients.

What it is not: a file drive, a dashboard of sample charts, a chatbot, or an AI consultant. A percentage on a dashboard is never presented as proof of business results.

## 2. Who uses it

There are two connected workspaces in one app: the **firm side** and the **client side**. Access is decided on the server from organisation + role + project membership + assignment + the record's visibility label. A role alone never grants access (`docs/authorization.md`).

### Firm side

| Role | What they do |
|---|---|
| **Firm admin** | Adds clients (only admins do), assigns consultants to a client, names the lead and an optional deputy, records engagements, closes client projects, firm settings, audit log. Sees every client and project, but never a client-private file. Gets notifications only for work they co-consult on or watch. |
| **Lead consultant** (one per client) | Staffs the client's projects, adds or removes consultants on that client, approves join requests, can start the closing gate. Sees all of that client's projects. |
| **Deputy consultant** (optional, one per client) | Same powers as the lead, gets a copy of the lead's alerts. The lead stays the accountable name. |
| **Consultant** | Sees only the projects they are staffed on. Sees a directory of client names (no data) and can ask to join with a reason. Writes the plan, reviews evidence, runs meetings and reports. |
| **Observer** | A read-only colleague on a project. Reads everything there, changes nothing. |

### Client side

| Role | What they do |
|---|---|
| **Client admin** | Sees all of their own organisation: people, departments, projects, files (including client-private ones). Invites managers and owners, answers recommendations, consents to the client assistant, chooses how indicator data is shared. |
| **Client manager** | Sees company-wide work and their own departments. Moves actions, changes owners, can use the client assistant if it is switched on for managers. A manager can be named the project **sponsor** or **coordinator**. |
| **Action owner** | Sees only their own actions and files shared with them (plus department teammates' files). Updates progress, reports blockers, submits evidence. No assistant. |

No client can see another client's data. Two layers enforce this: `authorize()` in app code and Postgres row-level security as the backstop (section 6).

### How much a client takes part (engagement modes)

Each client is in one of three modes (`docs/engagement.md`):

- **full**: the client's people use Selah with any client role.
- **restricted**: only client admins (up to 2) have accounts. Their uploads are private from the firm until an admin shares them.
- **consultant-managed**: the client has no accounts. Firm staff record what they hear, marked "recorded by a consultant" (with how and when it was received) so it is never mixed with what the client submitted. A **minimal records** option keeps as little as possible and purges free text 90 days after handover.

**Departments** are optional and off by default; when on, they narrow who at the client sees an action or file. **Client groups** (holdings) pool counts across member companies without merging their data.

## 3. How it works

### The core workflow

```
(optional) assessment → finding / gap → recommendation → owner + deadline → actions
   → progress updates and evidence → consultant review → verified / revision → follow-up and reports
```

1. **Enter the plan.** Consultants write findings and recommendations directly, or import them from Excel or Word, or confirm gaps from an assessment. Recommendations can also be board decisions. Only the firm writes the plan; the client reads it.
2. **Release actions.** An action starts as Draft (the client never sees it) and is released to Assigned with an owner and a due date.
3. **The client answers.** The client admin or sponsor records whether they agree, partly agree or disagree with each recommendation, with a reason. Responses are append-only.
4. **The client works.** The owner moves the action to In Progress, can mark it Blocked with a reason, asks for a new date, comments in the action's thread, and submits evidence (files, scanned for viruses) against the evidence list the consultant asked for.
5. **The firm reviews.** A consultant verifies the work or asks for a revision with a reason. Nobody reviews work they own or submitted evidence for. Some work needs a **second sign-off** from a different consultant (by client rule or per action).
6. **Follow-up.** Reminders and a four-level escalation ladder chase overdue work; meetings get an automatic agenda; the client can sign a **risk acceptance**; actions are closed with an outcome.
7. **Reporting.** Live project metrics, monthly status packs, frozen reports shared with the client, PDF and Excel exports, firm-wide oversight with an on-track / watch / off-track signal.
8. **Closing.** A project closes through a gate: every open item is disposed of, the client names who sustains each, lessons are recorded, and the project becomes read-only. A closing survey and case-study consent are optional.

### Action states

Draft → Assigned → In Progress ↔ Blocked → Awaiting Review → **Verified Complete** or Revision Requested (→ In Progress). Any open state can be Closed with an outcome; Verified or Closed can be reopened by the firm.

Selah keeps four things apart and never mixes them:

- a person's **claim** that work is done (Awaiting Review),
- **submitted evidence**,
- **human-verified** implementation (a consultant's accept review; the database refuses Verified without one),
- **business impact**, which Selah never claims. Client indicators are labelled "client-reported, not verified impact" everywhere.

Verified work is also counted by what it rested on: the client's evidence, evidence a consultant recorded, or a mix.

### The lifecycle around the work

Selah covers a client from first contact to offboarding (the journey steps J01 to J14 in `docs/progress-checklist.md`):

- **Intake:** a public `/inquiry` form, staff-entered referrals and prospects, conflict search, NDA and discovery records, decline mail, conversion to a client (`docs/intake.md`).
- **Enrolment:** a signed engagement record, client legal profile, one or many projects per client (one per phase), invitations, first sign-in with terms, privacy and AI notice.
- **Kickoff:** information request lists (with no-login upload links for single request items), meetings with `.ics` invites.
- **Offboarding:** archive a client, read-only grace period, export pack with a signed receipt, legal hold, purge; reassigning work when people leave.

### The assistant

An Arabic/English assistant using retrieval-augmented generation (RAG), shown as a floating card opened from the sidebar (`docs/assistant.md`).

**For firm staff:** questions across all their clients or one project, answers with citations (file, version, page, or record), status questions ("what is overdue?") answered from live action records, indicator questions, conflicting versions named with their citations instead of silently picked, chats linked to a record ("Ask the assistant" on an action, meeting, recommendation or file), file summaries, answers streamed as they are written, and a switch to see an answer in the other language.

**How it stays inside each person's rights:**

- Files are indexed only when their owner turns on "available to the assistant", they are scanned clean and not archived.
- The permission filter (`retrievalScope()`, the same check as the rest of the app) goes **inside** the vector search's `WHERE`, and the query runs under row-level security. Only the passages that survive reach the model.
- The AI service never has database or storage credentials.
- Search is hybrid (meaning + keywords, merged), all in Postgres with pgvector. No graph database.
- With a hosted model, names of people, clients and departments are replaced with placeholders before text leaves the server (`AI_MASKING=auto`).
- Chats belong to one person; a consultant taken off a client loses those chats at once. Retention deletes old chats.

**The client assistant** (for client admins and managers, never action owners) is behind four locks:

1. Off by default; the firm admin offers it per client and per role, with a daily question limit.
2. The client admin consents after reading a notice; a new notice version needs a new consent.
3. The database checks it on every request (restrictive policies on the index and chats).
4. Stricter prompt rules (facts only, no legal or compliance rulings, no guesses about the firm's views, no other clients) and an answer filter with fixed Arabic/English refusals.

It never reads firm-only files, assessment scores, firm notes, lessons, pitch material, survey answers or audit data.

**Evaluation runs** with GPT-OSS-120B (hosted) and local bge-m3 embeddings: staff run 38 of 39 answers correct, every access probe refused; client run with planted "canary" passages showed none leaked; all-clients run showed nothing from another client. Reports are in the project files under `selah-frontend/assistant/`.

## 4. Features

### Built (merged on `main`)

Grouped by area; the PR numbers are in `docs/progress-checklist.md`.

**Accounts and access**
- Invite-only accounts with the person's own email, email domain rules per organisation, address changes by admins, switching accounts off, access reviews, erasure.
- Better Auth sign-in, TOTP two-factor (required for firm admins, consultants and client admins), magic sign-in links for client managers and owners, password reset, rate limits, 8-hour sessions.
- Consent records for terms, privacy notice, AI notice and data agreement (drafts awaiting the firm's counsel).

**Clients and staffing**
- Clients, client overview page and client-wide report, lead and deputy, consultant join requests, observers, watching a client or project.
- Three engagement modes, minimal records, optional departments, client groups with a holding view (`/group`).
- Internal projects (the firm's own work, never visible to clients).
- Team page with workload and team load (reviews waiting, second sign-offs, overdue work per consultant; no scores or rankings).
- Typeable people pickers.

**The plan and follow-through**
- Findings, recommendations (including board decisions), actions; edit, withdraw and release; firm-only records.
- Recommendation responses from the client, action comment threads with mentions, firm-only notes.
- Evidence lists, evidence submission, reuse of an existing file as evidence, review, revision, second sign-off.
- Deadline change requests, slip history and aging buckets, risk acceptances, closing with outcomes.
- Reminders and four-level escalation, quiet-client alerts, daily digest mail, mail choices that respect the Saudi week.
- Plan trace (assessment → finding → recommendation → action → evidence) and "since your last visit".
- **Today** page for firm staff: reviews waiting, due this week, follow-ups, meetings, decisions waiting.

**Assessments**
- Template builder with versions and authors, a starter template, assessments per client project, a visible 1-3 weight, gaps confirmed as findings by a consultant, follow-up table, comparison and reassessment, frozen assessment report (`docs/assessments.md`). Scores are firm-only. Never "compliant" or "non-compliant".

**Files**
- Upload with type checks (extension, declared type and magic bytes) and a ClamAV scan, a 20 MB cap, private storage, one-minute signed download links, every download audited.
- Visibility labels (shared, firm-only, client-private, user-private), sharing, new versions, withdrawing a wrong unreviewed file.
- Files explorer as a floating card, listing exactly what the person can open.

**Meetings**
- Booking with attendees, `.ics` calendar invites (no calendar account needed), call links limited to Meet, Teams and Zoom, an automatic agenda (overdue, awaiting review, blocked, changes since the last meeting), decisions and follow-ups (`docs/meetings.md`).

**Metrics, indicators and reports** (`docs/metrics.md`)
- **Implementation metrics** per project: released, verified, awaiting review, blocked, overdue, on-time rate against the baseline date, review wait, slips, revision rate, stale actions; monthly snapshots.
- **Team metrics** for the firm admin: reviews done, review time, waiting and overdue work. No per-consultant scores.
- **Client business indicators** (KPI layer B): the client's own measures (company or department), baseline, target, values over time with corrections kept, firm-entered values marked, a one-time check against the client's source, links to recommendations as stated intent (never cause), due and missing periods, reminders. Labelled "client-reported, not verified impact".
- **Indicator data in three modes**, chosen by the client admin (`docs/indicator-data.md`): typed in (default), Excel/CSV upload with matching and review, or connected (a published Google Sheet read daily, or the client's own system sending figures with a private key). No per-vendor connectors.
- Engagement health on the oversight page (counts, never a weighted score), eight weeks of history, monthly status packs, frozen and shared reports, closure report PDF.

**Import and export** (`docs/import-export.md`)
- Import a plan from Excel or Word with column matching and row review; nothing is created until confirmed, and the file is not stored.
- Export the plan and actions list to Excel; reports to PDF through a separate Gotenberg container.

**Operations and trust** (`docs/operations.md`, `docs/security.md`)
- Audit log with a hash chain sealed every few minutes and checked nightly, and an audit-log screen.
- Backups, restore drill, restore and breach runbook scripts (`ops/`), readiness checks, upgrade script.
- Caddy in front of the app, through a Cloudflare Tunnel or directly with its own certificates (one setting).
- Security overview and sub-processor pages for clients' IT teams.
- Production-mode safety check: the app refuses to start with scanning off or two-factor off.

**Help and walkthrough**
- Client help pages and "ask your consultant".
- A team walkthrough kit (section 7).

### Not built: frozen or planned

These are in `docs/progress-checklist.md` as open (`[ ]`). "Frozen" means held on purpose until someone shows they are needed.

- Deliverable versions with client acceptance and comments on drafts (F21).
- Saudi working calendar (F15), saying what proves each recommendation (F16), change request log (F20), schedule screen (F23), decision register (F24).
- Pause and follow-on projects (F28), after-care re-verification at 6 and 12 months (F29).
- Workstreams with a lead (F32), a client steering meeting across projects (F33).
- Readiness before real data: AI operations and consent (R6), accessibility checks (R7).
- Assistant: text recognition (OCR) for scanned pages, name spotting for names not in Selah, saving an answer as a note, automatic meeting summaries.
- Single sign-on.
- Inviting the client's people straight from inquiry conversion.

### Excluded by decision

Weighting formulas, automatic impact claims, consultant rankings, AI compliance rulings, enterprise-wide KPI dashboards, full HR or finance systems, strategy or SWOT generation, training a model, per-vendor connectors to client systems, Neo4j or graph RAG, Google Meet API and calendar sync. Selah never hosts calls.

## 5. Tech stack and tools

| Area | What is used |
|---|---|
| Web app | **Next.js 16** (App Router) with **React 19** and **TypeScript**, both portals and the API in one app (`apps/web`) |
| UI | **Tailwind CSS 4**, **shadcn/ui** (blocks `sidebar-07`, `sidebar-03`, `dashboard-01`), **Animate UI**, Radix and Base UI primitives, Motion, lucide icons, IBM Plex Sans Arabic font, next-themes (dark mode) |
| Languages | **next-intl**, strings in `apps/web/messages/ar.json` and `en.json` |
| Validation | **Zod** on every request body and parameter |
| Database | **PostgreSQL 16 + pgvector** (one database, row-level security), **Drizzle ORM** and drizzle-kit migrations |
| Auth | **Better Auth** (sessions, TOTP two-factor, magic links) |
| File storage | S3-compatible private bucket: **RustFS** in Docker (AWS S3 SDK, so any S3 store works by `.env`) |
| Virus scan | **ClamAV** (clamd) in its own container |
| PDF export | **Gotenberg** (Chromium) in its own container with no network route out |
| Mail | **Nodemailer** over SMTP; Resend as the relay was tested; **Mailpit** catches mail locally |
| AI service | **Python FastAPI** (`services/ai`): embeddings, answers, summaries, behind one provider interface |
| Models | Embeddings: **bge-m3** (always local, through **Ollama**). Answers: **qwen3:4b** locally through Ollama, or a hosted OpenAI-compatible API (tested with **GPT-OSS-120B** on Ollama's cloud) |
| Text extraction | poppler `pdftotext` for PDF; own zip/XML readers for Word, PowerPoint and Excel |
| Edge | **Caddy**, optionally **Cloudflare Tunnel** (`cloudflared`) |
| Containers | **Docker Compose** (`docker-compose.yml`, `docker-compose.test.yml`) |
| Tests | **Vitest** (unit, database, scanner), **Playwright** with axe-core (end-to-end), **pytest** (AI service) |
| CI | GitHub Actions (`.github/workflows/ci.yml`): lint, typecheck, unit tests, build, `npm audit`, database tests on real Postgres, scanner tests on real ClamAV, AI service tests |

Background jobs run as scripts (`npm run job:*` in `apps/web`): mail, follow-ups, indexing documents, metrics snapshots, health, status packs, indicator feeds, audit seal and check, purges, ops check.

Target server: a Linux machine with a GTX 1050 and 16 GB RAM, everything in Docker. The GPU is too small for a good chat model, which is why answers can go to a hosted API. The server is not running Selah yet.

## 6. Security in five rules

1. **One check.** Every API route, download, export, search and AI retrieval goes through `authorize()` (`apps/web/src/authz`).
2. **Routes can't skip it.** API routes must be built with `route()`; a test fails otherwise, and pages can't import the database.
3. **The database is the backstop.** Row-level security enforces tenant, project and label isolation for the app's database role.
4. **Deny by default.** A new table has no grants and a new permission has no roles until someone adds them. A denial returns 404, the same as a missing record.
5. **AI sees only what you could open.** Filters run inside the vector query and under row-level security.

Every business rule is listed in `docs/rules.md` with where the database enforces it, the TypeScript that checks it first, and its test. A rule change touches all of them in one PR. The OWASP ASVS 5.0 and OWASP LLM Top 10 mapping is in `docs/security.md`.

## 7. Running it locally

You need Docker Desktop (running) and Node.js 22+. From the repository root:

```sh
npm run dev:local             # app with sample data on http://localhost:3000, mail at http://localhost:8025
npm run dev:local -- --full   # adds the ClamAV scanner and the local AI (a few GB download)
npm run test:all              # every suite including end-to-end (about 30 minutes)
npm run test:all -- --quick   # skips end-to-end
npm run stop:local            # stops the containers
npm run reset:local           # also deletes local data and models
```

The first run writes `.env` and `apps/web/.env.local` with random secrets (both git-ignored). The lean start has no scanner, no assistant and two-factor off. The script is `scripts/local.mjs`; the README has the same steps by hand.

**Team walkthrough** (`docs/walkthrough.md`):

```sh
npm run walkthrough -- --fresh   # loads the walkthrough data from scratch
npm run walkthrough              # later runs keep what the team changed
```

It loads a fictional firm with every staff role, two clients with every client role (14 accounts in all, `*.test` addresses), three cases with every action state, and the assistant reading them. For fast answers, put a hosted model key in `.env` (the steps are in the guide). Sign-in is limited to 10 per account per 15 minutes.

Gotchas that cost time before:

- `CLAMD_HOST` stays empty when there is no scanner; uploads are then kept unscanned (development only).
- `AI_SERVICE_TOKEN` must be at least 32 characters.
- Tests run with `TZ=UTC`.
- The assistant end-to-end test times out on a CPU-only local model.

## 8. Repository layout

```
apps/web/              Next.js app: both portals and the API
  src/authz/           authorize(), the policy and the workflow moves (pure, unit-tested)
  src/server/http.ts   route(): the only way to write an API route
  src/services/        business logic; every function calls authorize() first
  src/db/schema/       Drizzle schema
  src/auth/            Better Auth
  src/app/             pages: (app) signed-in shell, (auth) sign-in, (public) inquiry/legal/upload, api/
  src/components/      Selah components; components/ui is shadcn/ui
  src/jobs/, scripts/  background jobs, seed, walkthrough seed, assistant evaluation
  messages/            Arabic and English strings
  drizzle/             SQL migrations (0000_baseline.sql holds the base schema and RLS); last is 0067_indicator_data
  tests/, tests/db/    unit and Postgres tests; e2e/ is Playwright
services/ai/           Python FastAPI AI service (llm.py is the provider switch, prompt.py the rules)
db/init/               database roles on first start
ops/                   backup, restore, restore drill, readiness, upgrade, Caddyfile
scripts/local.mjs      the local run, test and walkthrough commands
docs/                  everything in this list below
```

Docs worth reading first: `authorization.md`, `rules.md`, `data-model.md`, `engagement.md`, `assistant.md`, `metrics.md`, `ui-guidelines.md`, `progress-checklist.md`. Then as needed: `accounts.md`, `assessments.md`, `meetings.md`, `intake.md`, `import-export.md`, `indicator-data.md`, `data-architecture.md`, `security.md`, `operations.md`, `translations.md`, `walkthrough.md`.

## 9. How the team works

- **Research before building.** Every new capability must be shown to be genuinely needed; no features for their own sake. Bug fixes may go ahead.
- **Every screen has its backend and tests.** No mock screens, no "demo" or "prototype" labels. Desktop and tablet only (768 px and wider).
- **UI rules** are in `docs/ui-guidelines.md`: shadcn/ui and Animate UI first, monochrome with muted status colours, grey card surfaces, RTL with logical properties, Arabic and English on everything, floating cards for tools (Files, assistant).
- **The checklist is the source of truth.** `docs/progress-checklist.md`: the PR that delivers an item ticks it and adds its PR number.
- **Migrations:** a new rule goes in a new migration after the last one on `main`. drizzle-kit uses the snapshot whose file name sorts last, so before merging a migration PR: rebase on `main`, renumber to the next free number, regenerate the snapshot, append the journal entry last, run `drizzle-kit check`, and merge straight away. Every migration PR includes its snapshot. New audit actions need Arabic and English labels.
- **Merging:** once CI is green and a code review finds nothing blocking. Production changes and history rewrites always need the product owner's explicit go.
- **Secrets** live only in `.env`; never paste keys into issues, chats or commits.

## 10. Key decisions

- One client can have many projects (one per phase or scope); departments are optional tags (option B, 2026-10-24).
- Only firm admins add clients and close client projects; the lead or deputy may start the closing gate; the client sponsor may ask for closure.
- Consultants verify and close actions, never their own.
- Assessment scores stay firm-only.
- Restricted mode reveals nothing about private files to the firm, not even counts.
- No-login upload links only for single request-list items, time-limited, scanned, logged and revocable.
- Magic links for client managers and owners; staff and client admins keep password + two-factor.
- Holdings are flexible: a group record with pooled counts; each member company is a linked client or a company inside a client.
- Cloudflare Tunnel for sample data; switch to direct hosting (config only) before any real client file.
- Self-hosted storage and backups on the team's machines rather than a cloud bucket (the code stays S3-compatible).
- Client-system integration is allowed for indicator data only in the form built (Google Sheet or the client pushing with a key).

## 11. Open items

- **Simplification review.** The app has too many buttons for some users. A review found 18 issues with a six-batch fix order (project files: `plan/selah-simplification-review.html`); four decisions are waiting on the product owner, and nothing from it is built yet.
- **Client assistant defaults.** Four questions (legal questions, deadlines aware of who asks, drafting a progress update for the client, cross-language search) have working defaults but no final answer.
- **Before real client data:** counsel reviews the legal drafts; hosting, retention and legal duties confirmed with the firm and the supervisor; direct hosting instead of the tunnel; a mail sender on the firm's own domain with SPF, DKIM and DMARC; backups need the second disk, off-server key and crontab; R6 and R7.
- **Deployment** has not happened; the server is not running Selah yet.
- **Inquiry lead picker** still uses the old dropdown rather than the typeable picker.
- Items in section 4 under "Not built".
- **Uncertain:** some authorization rules are tagged "[Proposed]" in the original spec (for example the firm admin not seeing client-private files) and are built so they can be tested; the team should confirm them before a report presents them as requirements (`docs/authorization.md`).

## 12. Where things live outside the repo

- Project shared files: the product vision and scope notes (`00`-`04` files), plans and reviews under `plan/`, research under `research/`, screenshots and assistant evaluation reports under `selah-frontend/`.
- Published pages: the progress checklist, the full-picture plan, the journey map, the walkthrough guide and the simplification review are kept as shared pages alongside the repo docs; the repo copy wins when they differ.
