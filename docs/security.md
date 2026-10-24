# Security: OWASP mapping

Targets: **OWASP ASVS 5.0 Level 2** for the web app and the **OWASP Top 10 for LLM Applications (2025)** for the assistant. Each row points at the code that handles it, so it can become a test case. "Not yet" rows are honest gaps for later steps.

Results are test results on the executed cases, not a guarantee of security.

## ASVS 5.0

| Chapter | Where it is handled | Status |
|---|---|---|
| V8 Authorization | `src/authz/authorize.ts` (one check, deny by default); `drizzle/0000_baseline.sql` (RLS on every table); `tests/authorize.test.ts`, `tests/db/rls.test.ts` | Done for the skeleton |
| V6 Authentication | `src/auth/auth.ts`: Better Auth, scrypt hashing, invite-only (sign-up disabled), 12+ character passwords, sign-in limited to 10 per account per 15 minutes from any address (`src/auth/attempts.ts`); anyone who knows an address can use that cap to lock the account for the rest of the window, so each lockout is recorded in the audit log as `auth.sign_in.locked` under the account id and 20 per address a minute, at most 5 two-factor codes per sign-in, TOTP two-factor sign-in, required for firm admins, consultants and client admins (`src/server/http.ts`, baseline: Two-factor); password reset by a mailed link valid for one hour, at most three an hour (baseline: Mail) | Single sign-on not built |
| V7 Session management | Server-side sessions in `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookies with a `__Secure-` prefix; 8 h lifetime, fresh sign-in after 10 min for sensitive changes | Done |
| V4 API | `src/server/http.ts`: Origin check on every write (CSRF), session required, ids from the URL only used to look rows up; `tests/route-guard.test.ts` | Done |
| V2 Validation and business logic | Zod on every params/body (`route()`); status moves checked in `authz/workflow.ts` and the `check_action_transition` trigger; optimistic concurrency on status updates | Done |
| V1 Encoding and injection | Parameterized SQL through Drizzle; React escaping; the assistant's answer is rendered as plain text | Done |
| V5 File handling | `lib/upload-rules.ts`: extension, declared type and magic bytes must agree; 20 MB cap checked before reading; no legacy Office (macro) formats; bidi characters stripped from names. `services/scan.ts`: ClamAV scan before storing and before any database connection is taken, uploads refused while the scanner is down, downloads only for `clean` files (`skipped`, unscanned development files, are refused once scanning is required; production refuses to start with it off). Tested against a real clamd in CI (`tests/scan`). Private bucket, random keys, one-minute signed links after `authorize()`, every download audited. Stored files and evidence are immutable (baseline: Evidence integrity) | Done. Imports of `.xlsx`/`.docx` add zip-bomb limits and refuse XML with a document type declaration (`lib/office/`); exports write text as inline strings, never formulas, so formula injection does not arise in Selah's Excel files (docs/import-export.md) |
| V3 Web frontend | Security headers in `next.config.ts` (frame-ancestors none, nosniff, HSTS, no-referrer leaks). Pages get a CSP with a fresh nonce per request from `src/proxy.ts`, so only Next.js's own scripts run; API responses get `default-src 'none'` | Styles still allow inline attributes, which the UI components set |
| V14 Data protection | Visibility labels; app role cannot read passwords, sessions or the audit log; sample seed data only | Done |
| V16 Logging and errors | `audit_log` (insert-only for the app, append-only even for its owner, `audit_log_guard()`): status changes, file downloads and summary reads, sign-ins, failed sign-ins, two-factor checks, sign-outs, password changes, AI queries and every denial are logged with actor and reason, never document text; generic error bodies. Sealed into a SHA-256 hash chain every few minutes and checked every night; kept 12 to 120 months (firm setting, never under 12, NCA ECC 2-12); read on the audit-log screen (see below) | Done (R2) |
| V13 Configuration | Secrets only in `.env` (ignored by Git), validated at start (`src/env.ts`); `npm audit` in CI; ports bound to 127.0.0.1 | Done |
| V12 Secure communication | HTTPS for the deployed site through a reverse proxy on the team's Linux server. The proxy must overwrite `X-Forwarded-For` with the visitor's address, not append to it: per-address limits and the intake form read it | Not yet set up |

## Database roles

| Role | Used by | Can do |
|---|---|---|
| `selah_owner` | Migrations only | Owns the schema |
| `selah_app` | The web app | Only what RLS policies allow; no `BYPASSRLS`; cannot read `account`, `session`, `two_factor`, `verification`, `audit_log` or the audit chain; admins read the log only through `app_audit_entries()` |
| `selah_auth` | Better Auth | Only the auth tables |

## Audit log

What it holds, who reads it and how it shows tampering (R2, migration `0023_audit_trail.sql`).

- **Written by** the app (`src/services/audit.ts`), Better Auth's hooks (`src/auth/auth.ts`: `auth.sign_in`, `auth.sign_in.failed`, `auth.sign_in.password_ok`, `auth.sign_in.locked`, `auth.two_factor.verified` / `failed` / `enable` / `disable`, `auth.password.changed`, `auth.sign_out`) and database functions. Failed sign-ins are recorded under the account's id when the address has one, never the address typed. Ids and counts only, never document text, prompts or answers.
- **Nobody edits or removes an entry.** The app and Better Auth can only insert. For the schema owner, `audit_log_guard()` refuses updates, deletes and `TRUNCATE`, with two exceptions that each need a flag their own function sets: sealing fills an empty seal and nothing else, and pruning deletes only sealed entries behind the chain's anchor that are older than the keep period.
- **Tamper evidence.** `app_seal_audit_log()` (job `job:audit-seal`, every two minutes) gives each new entry the next place in the chain and `sha256(previous hash | place | the entry's fields)`. `app_check_audit_chain()` (job `job:audit-check`, nightly) recomputes the chain from its anchor and records the result in `audit_chain_checks`; a changed, removed or reordered entry fails at its place. The owner can still switch a trigger off (Postgres allows that to a table's owner), which is what the chain is for: the change then shows at the next check. The jobs log prints the latest seal each night, and the screen shows it, so a copy can be kept off the server; a rewrite of the whole chain would no longer match that copy.
- **Keeping.** `firm_settings.audit_keep_months`, 12 to 120, 12 by default. The nightly job prunes older entries from the start of the chain, only after a check passes, and moves the anchor to the last pruned entry's hash.
- **Reading.** `/audit`, for the firm admin (everything, with the chain's state) and client admins (what their own people did, and sign-in attempts on their accounts; for a refused attempt they see that it was refused, not the record or reason, so nothing the firm keeps private can be inferred). Filters by day, person, area, result and organization; CSV export (UTF-8 with a byte-order mark, at most 20,000 rows, formula-safe cells), which is itself logged. Consultants and client managers get a 404. Tests: `tests/db/audit-log.test.ts`, `tests/audit-labels.test.ts` (every logged action has an Arabic and English label).

## OWASP Top 10 for LLM Applications 2025

| Risk | Where it is handled |
|---|---|
| LLM01 Prompt injection | `services/ai/app/prompt.py`: retrieved text wrapped and escaped as data; model told never to follow it; model has no tools |
| LLM02 Sensitive information disclosure | `services/assistant.ts`: permission filter inside the vector query, plus RLS on `ai_chunks`; tested in `tests/db/rls.test.ts` ("forged scope") |
| LLM03 Supply chain | Model and image versions pinned in `docker-compose.yml` and `.env`; a hosted provider is opt-in (`LLM_PROVIDER`) and only receives the allowed passages of one question |
| LLM04 Data and model poisoning | Only documents with the AI flag on are indexed; uploads record their uploader |
| LLM05 Improper output handling | Answers are plain text and rendered as text |
| LLM06 Excessive agency | No write tools; drafts need a human to save or send |
| LLM07 System prompt leakage | No secrets or permission logic in the prompt |
| LLM08 Vector and embedding weaknesses | Each chunk carries tenant, project, label and version; stale versions excluded at query time; chunks dropped by trigger on flag, label or archive changes |
| LLM09 Misinformation | Answers must cite supplied passage ids; unknown ids dropped; no valid citation means "I can't confirm this" |
| LLM10 Unbounded consumption | Question, passage count and passage size limits in the AI service; request timeouts. Per-user rate limits on the app API not yet built |

## Known gaps before real data

The terms of use, privacy notice, AI-use notice and data processing agreement template (`/legal/*`, see `docs/accounts.md`) are drafts written for the product; the firm's counsel reviews them before real client data is used.

Hosting, retention and legal obligations must be confirmed with the firm and the supervisor before any real client data is used. The site runs on the team's Linux server; HTTPS still needs to be set up there. Backups, the restore drill and the breach runbook are in `docs/operations.md`; they need a second disk, the off-server key and the crontab on that server.
