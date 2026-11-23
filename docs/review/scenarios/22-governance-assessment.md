# Scenario 22. A governance assessment from answers to findings (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010, mail http://localhost:8035), fresh seed, 23 Nov 2026, Arabic, desktop 1280 px. English checked on the assessment page and the Retake dialog only. Screenshots and the machine-readable results are outside the repo at `C:\Projects\selah-scenario-shots\22\` (`results.json` in the folders `22\`, `22\n\`, `22\p\`, `22\r\`). Page times are the development server (a first page can take 20 to 30 s) and say nothing about production.

**How it was driven.** A headless browser script (Playwright, run from outside the repo against http://localhost:3010) clicked the real buttons and saved the screenshots. "Should be denied" probes are same-origin `fetch` calls made from inside the signed-in page, so they use that account's real session. Every account signs in once and the session is reused, because sign-in is limited to 10 tries per account in 15 minutes.

**Shortcuts that are not user actions.** None for this scenario. One accident: Khalid (`lead@mizan.test`) was locked out for 15 minutes after about 12 sign-ins in a short time, so Noura (`deputy@mizan.test`, same powers on Al-Nukhba) did the steps instead of him. The lock-out itself is checked on purpose in scenario 28.

**Roles.** Noura (deputy, firm), Khalid (lead, only the first finalise try), Layla (observer), Majed (firm consultant not on Al-Nukhba), Fahd (client admin), Reem (client manager), Abdullah (action owner), Hind (Rawdah client admin). Project: Al-Nukhba, board governance. Seed assessment «التقييم المبدئي ٢٠٢٦» (draft, 6 of 25 questions answered, 6 suggested gaps).

**PRIVACY findings: none.** Every "should be denied" check was refused as expected (list below).

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Khalid | Open the draft assessment, press **اعتماد** (finalise) with 19 questions unanswered, then **متابعة** in the confirm dialog | Refused with a reason | PASS with friction | `22\a-finalise-unanswered.png`, `22\b-after-continue-1500ms.png` | The dialog first says "finalise the assessment?" and says nothing about the 19 open questions. The refusal (HTTP 409) arrives after you confirm, as a toast at the screen corner that disappears in a few seconds: «أجب عن كل سؤال ينطبق، أو حدده بأنه لا ينطبق، قبل الاعتماد». The page does not show which questions are still open. |
| 2 | Noura | Answer the 19 open questions (choice buttons; every third one "No") | Each answer saved; score and counts update | PASS | `22\c-all-answered.png` | Each click saves at once (PATCH 200). After: 30 of 55 points, 54.5 %, 0 left to answer, 14 suggested gaps. Choice groups are real radio groups with names (good for the keyboard). |
| 3 | Noura | **اعتماد** then **متابعة** | Assessment becomes final and locked | PASS | `22\d-finalised.png` | Badge **معتمد**. The answer buttons are replaced by text. New buttons: **مشاركة الإجابات مع العميل**, **إعادة التقييم**, **تقرير**. Banner under the score: «للمكتب فقط. النسب مؤشرات ... وليست شهادة». |
| 4 | Noura | Turn a suggested gap into a finding with **تأكيد كملاحظة**: one "firm only", one "shared with the client" | A finding with the chosen visibility appears on the plan | PASS with friction | `22\e-gap-dialog-shared.png`, `22\e-gap-dialog-firmonly.png`, `22\e-plan-after-findings.png` | Dialog: title, description, a "who sees it" list (shared with the client / firm only). Both findings appear on the plan under «ملاحظة». Friction: after a gap is confirmed the next gap's button looks the same, and confirming the same gap twice returns an English message in a toast («this gap is already a finding», HTTP 409). The dialog also animates for about a second before the fields can be typed into. |
| 5 | Noura | **مشاركة الإجابات مع العميل** | The client admins and managers on the project can read the answers | PASS with friction | `22\f-share-dialog.png`, `22\f-shared.png` | Shares **at once**: no confirm dialog (200), badge **مشارك مع العميل**, button becomes **إيقاف المشاركة**. Fahd's bell and Mailpit have nothing about it afterwards, so the client is not told that an assessment was shared. |
| 6 | Fahd, Reem | Open the shared assessment | Questions and answers readable; no scores, no firm notes, no firm-only finding | PASS | `22\f-client-admin.png`, `22\f-client-manager.png`, `22\n\results.json` | Page header «تقييم مستشاريكم: الأسئلة وإجاباتكم وتعليقاتهم». No percent on the page. The JSON the page uses has the score fields set to `null` (`total` earned, possible, pct all `null`). The shared finding is on their plan; the firm-only finding title and its description do not appear anywhere on the page or in the JSON. |
| 7 | Noura | English: open the same assessment, press **Retake** | English labels; a confirm dialog | PASS | `22\g-en-assessment.png`, `22\g-en-retake-dialog.png` | «Final», «Shared with the client», «Stop sharing», «Retake», «Report». Dialog «Start a new assessment on the same template, to compare with this one?» The project name stays Arabic because it is data. Retake was not confirmed and the comparison screen was not run (not run: a second final assessment needs 25 more clicks). |
| 8 | Noura | **تقرير** (report) | A report of the assessment | NOT RUN | none | A direct POST without the expected fields returned 400 for all three accounts tried, so it says nothing about access. The button was not pressed. |

**Should be denied checks (account, what was asked, what came back).** All as the signed-in account in the browser, 23 Nov 2026. Assessment id `c45fe352-365a-4e6f-8262-a6e93ef718ca` (finalised, **not yet shared** for D1 to D3), project `f19fbafb-a2f1-4e9e-b7f2-cc351df67f5a`.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | admin@nukhba.test (Fahd) | Open `/assessments/<id>` before it was shared | Page body «غير موجود. الصفحة غير موجودة أو لا تملك صلاحية الوصول إليها» (HTTP 200 with the not-found body, the known gap) |
| D1 | owner@nukhba.test (Abdullah) | same | same «غير موجود» body |
| D1 | admin@rawdah.test (Hind) | same | same «غير موجود» body |
| D1 | lead2@mizan.test (Majed) | same | same «غير موجود» body |
| D1api | the same four accounts | `GET /api/assessments/<id>` | `404 {"error":"not_found"}` for all four |
| D2 | the three client accounts | Open `/templates` | «غير موجود» body |
| D2 | lead2@mizan.test | Open `/templates` | The firm's template list opens (a consultant may see templates; by design). |
| D3 | the four accounts | `POST /api/assessments/<id>/share` | 405 (wrong method, so this check proves nothing; the real share check is D6) 405 wrong method; proves nothing. No real share check was run for Abdullah or Hind. |
| D4 | owner@nukhba.test | Open `/assessments/<id>` **after** the share | «غير موجود» body; `GET /api/assessments/<id>` returns `404 {"error":"not_found"}` |
| D5 | admin@nukhba.test, manager@nukhba.test | After the share, search the page and the API JSON for the firm-only finding's title and description | Not present in either (checked three words). The score fields are `null`. |
| D6a | observer@mizan.test (Layla, control) | open `/assessments/<id>` and `GET /api/assessments/<id>` | opens (page text starts «حوكمة مجلس الإدارة التقييم المبدئي ٢٠٢٦ معتمد ...»); `200`: she may read, she may not write (D6) |
| D6 | layla observer (`observer@mizan.test`) | `PATCH /api/assessment-answers/<id>`, `POST .../finding`, `POST /api/assessments/<id>/retake`, `PUT .../share {"shared":false}`, `POST .../finalise` | `404 {"error":"not_found"}` on all five (see friction below) |
| D6 | admin@nukhba.test (Fahd, assessment shared with him) | the same five calls | `404` on all five |
| D6 | lead2@mizan.test (Majed) | the same five calls | `404` on all five |

Console and server errors: not collected in this run. The page answers HTTP 200 for every "not found" screen (known gap).

## Confusions
- Finalising: the confirm dialog says nothing about unanswered questions; the refusal comes as a vanishing toast and no question is marked.
- Sharing with the client acts at once with no confirm and no notice to the client.
- Layla (observer) is told "not found" when she tries to change something she can read. «Not found» is the safe answer, but she cannot tell "I may not" from "it is gone".
- A confirmed gap does not read differently from an unconfirmed one at a glance (the button stays on the next gap).
- A refusal message from the server is shown in English on an Arabic screen (confirming a gap twice).

## Four plain-words answers
1. Mostly. The flow is clear once you know that finalising is final, but sharing and finalising give no warning.
2. Nothing leaked and nothing broke. Scores and firm notes stay with the firm.
3. No.
4. Say how many questions are open before you finalise, ask before sharing, and tell the client when answers are shared.
