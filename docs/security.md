# Security: OWASP mapping

Targets: **OWASP ASVS 5.0 Level 2** for the web app and the **OWASP Top 10 for LLM Applications (2025)** for the assistant. Each row points at the code that handles it, so it can become a test case. "Not yet" rows are honest gaps for later steps.

Results are test results on the executed cases, not a guarantee of security.

## ASVS 5.0

| Chapter | Where it is handled | Status |
|---|---|---|
| V8 Authorization | `src/authz/authorize.ts` (one check, deny by default); `drizzle/0001_security.sql` (RLS on every table); `tests/authorize.test.ts`, `tests/db/rls.test.ts` | Done for the skeleton |
| V6 Authentication | `src/auth/auth.ts`: Better Auth, scrypt hashing, invite-only (sign-up disabled), 12+ character passwords, sign-in limited to 10 per account per 15 minutes from any address (`src/auth/attempts.ts`) and 20 per address a minute, at most 5 two-factor codes per sign-in, TOTP two-factor sign-in, required for firm admins, consultants and client admins (`src/server/http.ts`, migration 0032); password reset by a mailed link valid for one hour, at most three an hour (migration 0031) | Single sign-on not built |
| V7 Session management | Server-side sessions in `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookies with a `__Secure-` prefix; 8 h lifetime, fresh sign-in after 10 min for sensitive changes | Done |
| V4 API | `src/server/http.ts`: Origin check on every write (CSRF), session required, ids from the URL only used to look rows up; `tests/route-guard.test.ts` | Done |
| V2 Validation and business logic | Zod on every params/body (`route()`); status moves checked in `authz/workflow.ts` and the `check_action_transition` trigger; optimistic concurrency on status updates | Done |
| V1 Encoding and injection | Parameterized SQL through Drizzle; React escaping; the assistant's answer is rendered as plain text | Done |
| V5 File handling | `lib/upload-rules.ts`: extension, declared type and magic bytes must agree; 20 MB cap checked before reading; no legacy Office (macro) formats; bidi characters stripped from names. `services/scan.ts`: ClamAV scan before storing and before any database connection is taken, uploads refused while the scanner is down, downloads only for `clean` files (`skipped`, unscanned development files, are refused once scanning is required; production refuses to start with it off). Tested against a real clamd in CI (`tests/scan`). Private bucket, random keys, one-minute signed links after `authorize()`, every download audited. Stored files and evidence are immutable (`0005_evidence_integrity.sql`) | Done; CSV formula injection still to handle |
| V3 Web frontend | Security headers and CSP in `next.config.ts` (frame-ancestors none, nosniff, HSTS, no-referrer leaks) | CSP still allows inline scripts; move to nonces |
| V14 Data protection | Visibility labels; app role cannot read passwords, sessions or the audit log; sample seed data only | Done |
| V16 Logging and errors | `audit_log` (insert-only for the app, append-only trigger): status changes, downloads, AI queries and every denial are logged with actor and reason, never document text; generic error bodies | Sign-in events not yet copied into `audit_log` |
| V13 Configuration | Secrets only in `.env` (ignored by Git), validated at start (`src/env.ts`); `npm audit` in CI; ports bound to 127.0.0.1 | Done |
| V12 Secure communication | HTTPS for the deployed site through a reverse proxy on the team's Linux server. The proxy must overwrite `X-Forwarded-For` with the visitor's address, not append to it: per-address limits and the intake form read it | Not yet set up |

## Database roles

| Role | Used by | Can do |
|---|---|---|
| `selah_owner` | Migrations only | Owns the schema |
| `selah_app` | The web app | Only what RLS policies allow; no `BYPASSRLS`; cannot read `account`, `session`, `two_factor`, `verification` or `audit_log` |
| `selah_auth` | Better Auth | Only the auth tables |

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

Hosting, retention and legal obligations must be confirmed with the firm and the supervisor before any real client data is used. The site runs on the team's Linux server; backups and HTTPS still need to be set up there.
