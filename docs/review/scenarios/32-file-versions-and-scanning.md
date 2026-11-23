# Scenario 32. File versions and upload scanning (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010, with the virus scanner running, started with `--full`), 23 Nov 2026, Arabic desktop 1280 px. English not run. Evidence is outside the repo at `C:\Projects\selah-scenario-shots\32\` (screenshots; `results.json` in `32\d\`, `32\e\`, `32\f\`, `32\g\`). Page times are the development server and say nothing about production.

**How it was driven.** A headless browser script (Playwright, outside the repo). The virus test file was **never written to disk**: the standard antivirus test string (the harmless EICAR text) was built inside the script from two pieces and handed to the file box from memory, so it could not be caught by the machine's own scanner. Other bad files were built in memory the same way.

**Shortcuts that are not user actions.** (1) Odd files (text named `.pdf`, a program header, a 21 MB text file, an HTML file, a text file named `.docx`) were sent with direct `POST /api/projects/<id>/documents` calls from the signed-in page (the same call the dialog makes), because a file picker cannot be given such files by hand. (2) Two probe files were left in the project by this scenario: `probe.txt` (firm-only) and a one-letter `empty.txt` (shared with the client). They are harmless test data.

**Roles.** Noura (deputy, uploads), Fahd (client admin), Abdullah (action owner), Layla (observer), Hind (Rawdah), Majed (firm, not on Al-Nukhba).

**PRIVACY finding: step 5. A new version keeps the assistant flag, so the uploader-or-admin rule is bypassed (G05).**

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Noura | Files dialog: add `test-virus.txt` (the test string), «العميل والمكتب» | Refused with a clear message; nothing stored | PASS | `32\d-eicar-screen.png`, `32\d\results.json` | The dialog stays open with a red line: «رُفض الملف: وجد فحص الفيروسات مشكلة.» The file is not in the list after a reload. The audit log has `document.upload` with outcome `deny` and reason `infected`. |
| 2 | Noura | Odd files by direct calls: text named `.pdf`, a program header named `.pdf`, `run.exe`, an HTML file, a text file named `.docx` | Refused by type | PASS | `32\d\results.json` | All `400 {"message":"file rejected: type"}`. |
| 3 | Noura | A 21 MB text file (limit 20 MB) | Refused | PASS | `32\d\results.json` | `400 {"message":"file too large"}` (the Arabic dialog hint says «بحد أقصى 20 ميغابايت»). |
| 4 | Noura | Files menu on `final-report.docx` → **رفع نسخة جديدة**: `final-report-v2.docx` | A version 2; history kept | PASS with friction | `32\b-newversion-dialog.png`, `32\b-newversion-done.png`, `32\c-files-list.png` | The list now reads «final-report-v2.docx · الإصدار 2». **The file's name in the list became the new file's name**; the old name «final-report.docx» no longer shows (it is kept as version 1 in the database: `version 1`, `supersedes_id` set on version 2). |
| 5 | (database) | Did the assistant switch carry to the new version? | A new version should not silently inherit "let the assistant read it" | FAIL (privacy) | `psql` | Before the upload the switch was ON (set in scenario 27). Afterwards **version 2 has the switch ON and version 1 OFF**. Noura uploaded it and no dialog asked about the new content (and the number-type notice that appears when someone switches a file on was not shown). The handbook says a new version replaces the old in the assistant; whether the consent should carry over needs the owner's decision. Not tested with the assistant itself (it returned errors on this copy; see scenario 27). Reviewer's reading of the code: the new version copies the old flag (`documents.ts`, `aiIndexable: old.aiIndexable`); the uploader-or-admin rule in migration 0108 fires only on UPDATE, so a staffed firm consultant or a client manager can put new content into the assistant without consent and without the personal-number notice. |
| 6 | Noura | Engagement page: deliverable 1 after the new version | Round 1 stays on version 1; a button offers the new one | PASS | `32\eng\peek-01.png` | Round 1 reads «final-report.docx (النسخة 1)» and a button **تسليم نسخة جديدة**. |
| 7 | Noura | **تسليم نسخة جديدة**: the dialog, then submit | Round 2 with the latest version | PASS | `32\g-newround-dialog.png`, `32\g-newround-picked.png`, `32\g\results.json` | Choices «النسخة 2 · 23/11/2026» (ticked) and «النسخة 1». Line «سيُطلب تأكيد الاستلام من: فهد الدوسري (مسؤول لدى العميل).» `POST .../hand-over` → `{"round":2}`. (Scenario 25's "round 2" gap is covered here.) |
| 8 | Noura, Fahd, Layla | Download the clean version 2 | A one-minute link | PASS | `32\e\results.json`, `32\f\results.json` | `GET /api/documents/<id>/download` → `200 {"url":"http://localhost:9010/selah-evidence/...?...X-Amz-Expires=60"}`: the link lives 60 seconds and goes to the storage host, not the app. The audit log holds `document.download` allow ×6 and deny ×1. |
| 9 | Noura, Fahd, Layla | Download a seeded file whose scan status is «skipped» | Not served unscanned | PASS (known data artefact) | `32\e\results.json` | `409 {"message":"this file has not been cleared for download"}` for all three. 17 of 21 files on this copy are «skipped» (seed uploads do not wait for the scanner), so those seeded files cannot be downloaded here (known from scenarios 3 and 13). |

**Should be denied checks (account, what was asked, what came back).** Clean file (version 2) `7c461bf2-3bfa-453a-9ef3-ebe656e0b77d`, project `f19fbafb-a2f1-4e9e-b7f2-cc351df67f5a`, 23 Nov 2026, as the signed-in account.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | owner@nukhba.test (Abdullah) | `GET /api/documents/<shared file>/download` | `404 {"error":"not_found"}` (a project-wide shared file with no department is not his) |
| D1 | admin@rawdah.test (Hind), lead2@mizan.test (Majed) | same | `404` each |
| D2 | admin@nukhba.test (Fahd) | upload `probe.txt` with the label «firm only» (`visibility=firm_private`) to the project | `400 {"error":"bad_request","message":"that label is not available here"}` |
| D2 | owner@nukhba.test, observer@mizan.test, admin@rawdah.test, lead2@mizan.test | the same upload (project-level) | `404` each |
| D3 | admin@nukhba.test, owner@nukhba.test, observer@mizan.test, admin@rawdah.test, lead2@mizan.test | `POST /api/documents/<firm-owned file>/versions` with a file | `404 {"error":"not_found"}` for all five (only the owning side may add a version) |
| D4 | all | the download of the «skipped» seeded file by anyone who may read it | `409 "this file has not been cleared for download"` (step 9) |
| D5 | signed in as Noura | the test virus string, an `.exe`, a program header, an HTML page | refused (steps 1 and 2); nothing stored |

Not run: the **upload scan when the scanner is down** (`SCAN_REQUIRED`: the file should wait, not pass); a virus inside a `.docx`; the "confidential document request" bypass by a new version (needs a confidential request item); a withdrawn version and the name that no longer shows to the other side; a 20 MB file just inside the limit; the upload-link page for someone with no account (`/upload/<token>`); English.

Console and server errors: not collected.

## Confusions
- A new version takes the new file's name in the list.
- The assistant switch silently follows the file to its new version.
- Odd-file refusals say only «file rejected: type» (English) on the API; on the screen the clearest message is the virus one.
- Seed files are unreadable on a `--full` copy (scan «skipped»), which hides real behaviour in earlier scenarios.

## Four plain-words answers
1. Yes. The virus refusal is clear and in Arabic.
2. Nothing leaked and nothing broke. Only the owning side adds versions; the link lasts a minute.
3. No.
4. Ask the uploader again before a new version inherits "let the assistant read it".
