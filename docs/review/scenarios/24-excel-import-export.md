# Scenario 24. Plan and actions to Excel, and a plan imported from Excel (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010), fresh seed, 23 Nov 2026, Arabic desktop 1280 px, then the same exports from an English session. Evidence is outside the repo at `C:\Projects\selah-scenario-shots\24\`: the workbooks that were downloaded (`plan-*.xlsx`, `actions-ar.xlsx`, `template.xlsx`, `en-ui-*.xlsx`), the workbooks built for the import (`import-ok.xlsx`, `import-formula.xlsx`), screenshots `c-import-*.png`, and `results.json` in `24\b\` and `24\d\`. Page times are the development server and say nothing about production.

**How it was driven.** The import was done through the real import page (file chosen, **قراءة الملف**, columns, **مراجعة الصفوف**, **استيراد**). Workbooks were read with a small script that unzips the file (no Excel was available, so "does Excel run it" is not tested; what is tested is that no cell is stored as a formula). "Should be denied" checks are same-origin `fetch` calls from inside each signed-in session.

**Shortcuts that are not user actions.** Four recommendations with formula-looking titles were created by a direct `POST /api/projects/<id>/recommendations` call (the same call the Add recommendation form makes) instead of typing them in the form. The import workbooks were built by script instead of in Excel.

**Roles.** Noura (deputy, did the plan work for Khalid, who was locked out; see scenario 22), Layla (observer), Fahd (client admin), Reem (client manager), Abdullah (action owner), Hind (Rawdah admin), Majed (firm, not on Al-Nukhba).

**PRIVACY findings: none.** Every export held only what that account may open, and every refused import was "not found".

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Noura | Download the plan workbook (`/api/projects/<id>/export?lang=ar`) | One sheet with all 16 columns and every row she may see | PASS | `24\plan-ar.xlsx` | Sheet «الخطة». Columns: finding, finding details, recommendation, rationale, target outcome, priority, recommendation due date, required evidence, action, action details, owner, department, due date, evidence list, status, who sees it. Includes the draft action (she is firm). Dates are stored as Excel date numbers (46374 etc.). |
| 2 | Noura | Same with `?lang=en` while the screen is Arabic | English headers | FAIL (small) | `24\plan-en.xlsx` | Headers stay Arabic; only the department name changed to English («Board secretariat»). The parameter does not decide the header language. |
| 3 | Noura | Switch the screen to English, download the plan and the actions list without a parameter | English headers | PASS | `24\en-ui-plan-nolang.xlsx`, `24\en-ui-actions-nolang.xlsx` | «Finding, Recommendation, Action, Owner, Due date, Status»; the actions list says «Blocked / Yes». With the English screen, `?lang=en` gives the same result. So the export follows the screen, not the link. Project and action titles stay in the language they were typed in. |
| 4 | Noura | Create four recommendations titled `=HYPERLINK("http://evil.example/x","click")`, `+1+1`, `@SUM(1,1)`, `-2+3`; download the plan | The text is plain text, never a formula | PASS | `24\plan-after-evil-ar.xlsx`, `24\b\results.json` | 0 `<f>` formula elements in the sheet. The four values sit in cells of type `inlineStr` (text) with their characters unchanged. The "no formula" rule holds for this export. (The audit CSV is checked in scenario 29.) |
| 5 | Noura | Download the template (`/api/projects/<id>/import/template`) | A workbook with the plan sheet and a guide sheet | PASS | `24\template.xlsx` | Sheets «الخطة» (14 column headers, no rows) and «إرشادات» (column, what to write). |
| 6 | Noura | Import page: choose `import-ok.xlsx` (3 rows: one known owner, one unknown owner, one row whose recommendation cell is `=1+1`) → **قراءة الملف** | The file is read; columns are matched | PASS | `24\c-import-page.png`, `24\c-import-review.png` | Steps are numbered «1. الملف · 2. الأعمدة · 3. المراجعة». Page text: «يُفحص الملف من الفيروسات ثم يُقرأ، ولا يُحفظ شيء حتى تؤكد». Columns matched automatically, each can be changed or set to «لا يُستورد». |
| 7 | Noura | **مراجعة الصفوف** | Rows with a status; the unknown owner is flagged with a reason | PASS | `24\c-import-rows.png` | Summary: 1 new finding, 1 recommendation, 3 actions, all drafts, 0 rows to fix, 2 to check. Row 3: «لا أحد باسم "شخص غير موجود" في فريق المشروع. سيبقى الإجراء بلا مكلَّف». The reason for "unknown owner" is now on the screen (scenario 1 found it was silent). The release switch **defaults to drafts** («كلها مسودات»), the opposite default to scenario 18's finding. |
| 8 | Noura | **استيراد** and confirm | Created; the page says what was made | PASS with friction | `24\c-import-confirm.png`, `24\c-import-done.png` | `POST .../import/confirm` returned `{"counts":{"findings":1,"recommendations":1,"actions":3,"released":0,"withErrors":0,"withWarnings":2}}`. The page then shows «جارٍ التحميل…» and there is no summary of what was created (only the counts in the response). |
| 9 | Abdullah, Fahd, Noura | Download the plan after the import | Drafts only for the firm | PASS | `24\d\results.json` | Noura's file has the imported recommendation and both draft actions. Fahd's has the imported recommendation but no draft action. Abdullah's has neither (he has no action under it). Noura's Actions page lists the drafts; Abdullah's and Fahd's do not. |
| 10 | Fahd, Reem, Abdullah, Layla | Download the plan and the actions list | Each file holds only what that person may open | PASS | `24\plan-admin.xlsx`, `24\plan-manager.xlsx`, `24\plan-owner.xlsx`, `24\plan-observer.xlsx`, `24\b\results.json` | Plan rows (header included): Fahd 14, Reem 11, Abdullah 4 (his own three actions only), Layla 18. The firm-only recommendation `FIRMONLY-REC-24` and the draft action «اعتماد قرار تشكيل» are absent from Fahd's, Reem's and Abdullah's files and present in Layla's (a firm observer). Actions list rows: Fahd 8, Abdullah 3, Reem 4. |

**Should be denied checks (account, what was asked, what came back).** Project `f19fbafb-a2f1-4e9e-b7f2-cc351df67f5a`, 23 Nov 2026, as the signed-in account.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | admin@rawdah.test (Hind) | `GET /api/projects/<id>/export?lang=ar` | `404 {"error":"not_found"}` |
| D1 | lead2@mizan.test (Majed) | same | `404 {"error":"not_found"}` |
| D2 | admin@nukhba.test, owner@nukhba.test, manager@nukhba.test, observer@mizan.test | `GET /api/actions/export?lang=ar&project=<id>` (a filter the export does not take) | `400 {"error":"bad_request","message":"invalid input","fields":[]}` for all four (the 400 came from a bad parameter and proves nothing; see step 10) |
| D3 | admin@rawdah.test (Hind) | `GET /api/actions/export?lang=ar` | `200`, 4 data rows; a text search of the sheet for «النخبة», «حوكمة مجلس», «ترشيح الأعضاء» found none (`24\actions-admin.xlsx`) |
| D4 | lead2@mizan.test (Majed) | the same | `200`, 6 data rows (Rawdah and Al-Waha); the same three searches found none (`24\actions-lead2.xlsx`) |
| D5 | observer@mizan.test, admin@nukhba.test, owner@nukhba.test, admin@rawdah.test, lead2@mizan.test | `POST /api/projects/<id>/import` with a valid `import-ok.xlsx` | `404 {"error":"not_found"}` for all five (the observer is told "not found", not "read only") |
| D6 | the same five | open `/projects/<id>/import` and `GET /api/projects/<id>/import/template` | page: not found body (HTTP 200); template `404 {"error":"not_found"}` |
| D7 | noura | upload `plan.csv` | `400 {"message":"file rejected: type"}` |
| D7 | noura | upload a text file named `fake.xlsx` | `400 "file rejected: type"` |
| D7 | noura | upload `plan.exe.xlsx` with an `MZ` header | `400 "file rejected: type"` |
| D8 | noura | upload a workbook whose recommendation cell is a real formula (`import-formula.xlsx`) | `200` (read for review). **Not confirmed**, so what would be saved was not checked. |

Not run: Word (`.docx`) import; releasing the imported drafts; an import with the virus scanner refusing a file (the scanner is covered in scenario 32); a file over 20 MB; a zip bomb. Console and server errors: one Next.js dev-tools message («Unknown url scheme 'https'») appeared during the import page; it is a development-server message.

## Confusions
- `?lang=en` does not change an Arabic screen's export; the screen language decides.
- After **استيراد** the page shows only «جارٍ التحميل…»; it does not say what was created or where to find the drafts.
- An observer gets "not found" on the import (she can see the plan).

## Four plain-words answers
1. Yes. The three import steps and the owner message are clear.
2. Nothing leaked and nothing broke. Formula text stays text.
3. No.
4. After the import, say "1 finding, 1 recommendation and 3 draft actions were added" with a link to the plan.
