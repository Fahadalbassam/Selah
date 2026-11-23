# Scenario 29. The audit log: who sees what, the export, and the tamper check (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010), 23 Nov 2026, Arabic desktop 1280 px. English not run. Evidence is outside the repo at `C:\Projects\selah-scenario-shots\29\` (screenshots; the three downloaded CSV files `audit-admin-mizan.csv` (Sara), `audit-admin-nukhba.csv` (Fahd), `audit-admin-rawdah.csv` (Hind); `results.json` in `29\a\`, `29\a2\`, `29\b\`; the screen after the simulated tampering is in `29\tampered\peek-01.png`). Page times are the development server and say nothing about production.

**How it was driven.** A headless browser script (Playwright, outside the repo) for the pages and downloads (`GET /api/audit/export`); the CSV files were read with a script.

**Shortcuts that are not user actions.**
1. **The two audit jobs were run by hand** from `apps/web` of the lead copy: `npx tsx --env-file=.env.local scripts/audit-seal.ts` (it sealed 347 entries) and `scripts/audit-check.ts`. On a server these run on a schedule; locally nothing runs them, so the page first read «لم يُفحص بعد» and «بانتظار الختم».
2. **A database edit simulated tampering.** As the database owner I first tried a plain `UPDATE` and a `DELETE` on `audit_log` (both refused: «audit_log is append-only»). Then I switched the guard trigger off (`ALTER TABLE audit_log DISABLE TRIGGER audit_log_guard`), changed the `meta` of entry 5, switched it on again and ran the check. After that I put the original value back and ran the check again. This is what someone with full control of the database could do; it is not something a user can do. The lead copy's chain is intact again (347 entries checked, same head `235e1fbe...`).

**Roles.** Sara (firm admin), Fahd (Al-Nukhba client admin), Hind (Rawdah client admin), Omar and Khalid (firm consultants), Reem (client manager), Abdullah (action owner), Layla (observer).

**PRIVACY findings: none.**

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Sara | Open `/audit` | Every step anyone took, the chain status and the retention | PASS | `29\peek-01.png`, `29\b-sara-audit-top.png` | Header: «كل دخول، وكل ملف فُتح، وكل تعديل، وكل محاولة رُفضت ... لا يمكن تعديل الإدخالات ولا حذفها، ويتحقق فحص ليلي من أنها لم تُمس.» Cards: last integrity check, entries in the chain, retention «12 شهرًا», oldest entry, last seal with the head hash and the advice to keep a copy off the server. Filters: date range, person, area (8), outcome (done / refused / failed), organisation. 50 rows a page. |
| 2 | Sara | Filter outcome = «مرفوض»; then organisation = «مؤسسة الروضة» | The list narrows | PASS | `29\b-filter-refused.png`, `29\b-filter-rawdah.png`, `29\b\results.json` | Refused filter starts with «رُفضت محاولة من ليلى الحربي: الإعدادات وسجل التدقيق» (my own probe from Layla's account). Rawdah filter: 39 rows. A row's **التفاصيل** shows the code, the record and counts (`rows=38 total=38`). |
| 3 | Sara | Download the CSV | All entries, safe to open in Excel | PASS | `29\audit-admin-mizan.csv` | 347 data rows, 13 columns (time UTC, person, e-mail, organisation, action, action code, result, record type, record id, reason, address, chain number, details). Zero cells start with `=`, `+`, `-`, `@` or a tab. Details are ids and counts (`{"knownAccount":true}`, `scope:own`, `retrieval:no-scope`); no file text and no assistant question or answer. Time is in UTC (the screen shows Riyadh time). |
| 4 | job (shortcut 1) | Seal and check | «347 entries checked» | PASS | job output | `audit log: 347 entries sealed`; `audit chain: 347 entries checked, head 235e1fbe...`. |
| 5 | Sara | Reload after the seal | The page shows the check | PASS | `29\peek-01.png` (before), `29\tampered\peek-01.png` (after step 6) | Before the jobs: «لم يُفحص بعد», «347 بانتظار الختم», last seal «الإدخال 0 ... 0000». |
| 6 | DB owner, then job (shortcut 2) | Try to change or delete an entry; then tamper with the guard off and run the check | Refused; then the break is found | PASS | psql, `29\tampered\peek-01.png` | `UPDATE`/`DELETE` as the owner: «ERROR: audit_log is append-only». With the guard off: `audit chain: BROKEN at entry 5; nothing pruned`; the page reads «آخر فحص للسلامة: مكسور عند الإدخال 5». After restoring the value the check passes again. |
| 7 | Sara | Is anyone told when the chain breaks? | A bell or mail | FAIL (logic) | `psql` count | `notifications` holds no row with an audit or chain kind (count 0). The break shows only on the audit page, so it depends on someone looking, or on the server's own alerting (not set up here). |
| 8 | Fahd | Open `/audit` and download the CSV | His company's trail only | PASS | `29\b-fahd-audit.png`, `29\audit-admin-nukhba.csv` | Header «ما قام به أفراد منشأتك في صلة: ...». 89 data rows, all by five Al-Nukhba people (Fahd 29, Abdullah 21, Reem 19, Salma 15, Mansour 5); none by firm staff. The firm-only strings from scenario 22 (a firm-private finding), the pitch, the inquiries and Rawdah never appear (searched: `FIRMONLY`, `سري المكتب`, `سرية للمكتب`, `Zahra`, `الزهراء`, `ratetest`, `laila@`). His own sign-in lock-out rows for Salma are there. |
| 9 | Hind | Open `/audit` and download the CSV | Her company's trail only | PASS | `29\audit-admin-rawdah.csv` | 38 data rows, four Rawdah people (Yousef 13, Hind 10, Nour 8, Dana 7); no Al-Nukhba or firm row. |

**Should be denied checks (account, what was asked, what came back).** 23 Nov 2026, as the signed-in account.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | consultant@mizan.test (Omar) | Open `/audit`; `GET /api/audit/export` | not found body; `404 {"error":"not_found"}` |
| D1 | lead@mizan.test (Khalid) | same | same |
| D1 | observer@mizan.test (Layla) | same | same (her attempt is itself logged as refused) |
| D1 | manager@nukhba.test (Reem) | same | same |
| D1 | owner@nukhba.test (Abdullah) | same | same |
| D2 | admin@nukhba.test (Fahd) | `GET /api/audit/export` | `200`, 89 rows, only his company (step 8) |
| D3 | admin@rawdah.test (Hind) | same | `200`, 38 rows, only Rawdah (step 9) |
| D4 | database owner | `UPDATE` and `DELETE` on `audit_log` | `ERROR: audit_log is append-only` (both) |

Not run: the nightly schedule itself; the 12-month retention purge (`job:purge...` for audit rows); the audit entry for exporting by a client admin being visible to the firm (it is in Rawdah's trail: `audit_log.export`); the English screens; the CSV in Excel; whether row details for a refused attempt name the record.

Console and server errors: not collected.

## Confusions
- Nothing on the page says that the jobs that seal and check the log must be scheduled; locally it reads «بانتظار الختم» and «لم يُفحص بعد» for ever.
- A broken chain tells nobody by bell or mail.
- The CSV time is UTC while the page shows Riyadh time.
- Layla (observer) is told "not found" for the audit page (fine), and her try is recorded as a refused attempt.

## Four plain-words answers
1. Yes. The filters and the page language are clear.
2. Nothing leaked and nothing broke. The log refuses edits even to the database owner, and a change is found.
3. No.
4. Send a bell notice to the firm admins when the check fails.
