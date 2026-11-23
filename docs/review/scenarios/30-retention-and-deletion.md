# Scenario 30. Retention settings, erasing a person, and a legal hold (lead copy)

Lead copy (`SELAH_INSTANCE=lead`, web http://localhost:3010), 23 Nov 2026, Arabic desktop 1280 px. English not run. Evidence is outside the repo at `C:\Projects\selah-scenario-shots\30\` (screenshots; `audit-rawdah-after-erase.csv`; `results.json` in `30\b\` to `30\h\`). Page times are the development server and say nothing about production.

**What was not run.** **No purge job was run** (chats, meeting transcripts, minimal-records clients, closed inquiries, archived clients, audit rows older than the keep period). The settings and the holds were tested; the nightly deletions that use them were not, because they need aged data. So "deletion actually happens after the period" and "a hold really stops a purge" are **not tested here**. Archiving a client with its grace period and export pack is covered by scenario 15.

**How it was driven.** A headless browser script (Playwright, outside the repo) for every screen; same-origin `fetch` for "should be denied" checks; `psql` read-only for the audit and user rows.

**Shortcuts that are not user actions.** None. Reading rows with `psql`.

**A mistake of mine, put right.** My first settings script typed into the wrong box and changed the audit keep period from 12 to 20 months (two saves, both accepted). I put it back to 12 through the same screen; the final value is 12 (`30\e\results.json`, `S4`).

**Roles.** Sara (firm admin), Majed (firm lead of Rawdah), Khalid (lead of Al-Nukhba), Omar, Layla, Hind (Rawdah client admin), Fahd (Al-Nukhba client admin), Nour (a Rawdah client manager made in scenario 28 for this purpose), Dana (Rawdah action owner, the target of denied erase calls).

**PRIVACY findings: none.**

| # | Who | Step | Expected | Result | Evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | Sara | Open `/settings` | The firm's settings in groups | PASS | `30\peek-01.png` | Groups: intake (e-mail, lead suggestions), business indicators («المهلة قبل ناقص»), follow-up (stale days, post-delivery check-ins), accounts (access review days, restricted-client admin count, sign-in links), records (minimal-records days, meeting transcripts 1 to 90 days), assistant chats (archive, delete after close, delete after last message), Ramadan (dates and mail hours), audit log (keep 12 to 120 months). Each group has its own **حفظ**. Header «هذه هي القيم الابتدائية، ولم يُغيَّر منها شيء بعد.» becomes «آخر تغيير 23/11/2026.» after a save. |
| 2 | Sara | Transcript days = 100 (allowed 1 to 90), **حفظ** | Refused with the range | PASS with friction | `30\e-transcripts-100.png` | No request was sent and no sentence appeared (the field hint says «من 1 إلى 90»). The refusal is a browser check only. |
| 3 | Sara | Transcript days = 20, **حفظ** | Saved | PASS | `30\e\results.json` | `PATCH /api/firm/settings` 200; after a reload the value is 20. No toast text was captured. |
| 4 | Sara | Chat archive = 100 days and delete-after-last-message = 50 days (the rule: delete must be later than archive), **حفظ** | Refused with the reason | FAIL (small) | `30\e-chat-conflict.png` | Server `409 {"error":"conflict","message":"refused by a data rule"}`, shown on the screen under the group as **English** «refused by a data rule», with no mention of which two fields clash (the hint above says "more than the archive days"). The same text for the other conflict checks below. |
| 5 | Sara | Out-of-range and inconsistent settings by the API | Refused | PASS | `30\d\results.json` | `transcriptKeepDays: 0` → `400 ... "fields":["transcriptKeepDays"]`; one Ramadan date only → `409 refused by a data rule`; Ramadan hours running backwards → `409 refused by a data rule`; an unknown field → `400`. |
| 6 | Sara | Client page **الأشخاص** → Nour's row menu → **محو البيانات الشخصية** | A confirm with the reason; clear warning | PASS | `30\a-nour-menu.png`, `30\b-erase-dialog.png` | Dialog: «لطلب محو بموجب نظام حماية البيانات الشخصية. يُستبدل الاسم والبريد، ويُزال الدخول، ويبقى في السجل اسم بديل. لا يمكن التراجع.» and a required reason box. |
| 7 | Sara | Enter the reason and confirm | The person becomes a numbered former user | PASS | `30\c-after-erase.png`, `30\c\results.json` | `POST /api/people/<id>/erase` → `{"label":"Former user #1"}`. The list now shows «Former user #1 · erased-1@erased.invalid». Database: name `Former user #1`, no sessions, no password account row, no two-step row. The three consent rows stay. **Hind's own People page (seen later, `34\g-access-card.png`) shows the erased row as «موقوف: erased: <the reason Sara typed>»**: the firm admin's free-text erasure reason («طلب محو من صاحبة الحساب بموجب نظام حماية البيانات الشخصية، بتاريخ 23/11/2026.») is displayed to the client admin, with an English «erased:» prefix. Here the reason was harmless; the field is free text and the client can read it. |
| 8 | Nour | Her old saved session, and the old e-mail with her password | Both refused at once | PASS | `30\c\results.json` | The old session lands on `/sign-in`; `GET /api/actions/export` → `401 {"error":"unauthenticated"}`; sign-in → `401 INVALID_EMAIL_OR_PASSWORD`. |
| 9 | Hind | Rawdah's audit CSV after the erasure | History stays, without the name | PASS | `30\audit-rawdah-after-erase.csv` | 9 rows now read «Former user #1» with `erased-1@erased.invalid`; the real name «نور القحطاني» and `nour@rawdah` appear in **no** row. The erasure itself is audited (`user.erase`, allow). |
| 10 | Sara | Rawdah → Setup → **وضع حجز نظامي**, reason, confirm | A hold is listed | PASS | `30\f-hold-dialog.png`, `30\g-hold-placed.png` | Dialog: «ما دام الحجز قائمًا لا تُحذف سجلات العميل أبدًا، حتى بعد انتهاء مدة الاحتفاظ.» The card then lists «الحجوزات النظامية: قائم، 23/11/2026 بواسطة سارة العتيبي», the reason, and **رفع الحجز**. This works while the client is still active (the card sits under «أغلق هذا المشروع قبل الأرشفة»). |
| 11 | Sara | **رفع الحجز** with a reason | Released, history kept | PASS | `30\h-release-dialog.png`, `30\h-released.png` | Dialog «متى رُفعت جميع الحجوزات تُحذف السجلات بعد انتهاء مدة الاحتفاظ.» The hold reads «مرفوع ... رُفع في 23/11/2026 بواسطة سارة العتيبي: <reason>». Audit rows `client.hold_place` and `client.hold_release` (allow). |

**Should be denied checks (account, what was asked, what came back).** 23 Nov 2026, as the signed-in account. Dana's user id was used for erase calls so that no real erasure happened on a denied call.

| # | Account | Ask | Came back |
|---|---|---|---|
| D1 | admin@rawdah.test (Hind), lead@mizan.test (Khalid), lead2@mizan.test (Majed), admin@nukhba.test (Fahd), nour@rawdah.test (Nour) | `POST /api/people/<Dana>/erase {"reason":"اختبار رفض المحو"}` | `404 {"error":"not_found"}` for all five. The audit log holds 3 `org_user.erase` denials (the other two calls are not in the log: probably refused before the audit write, as "not visible"). |
| D2 | lead@mizan.test, consultant@mizan.test, admin@nukhba.test, observer@mizan.test | Open `/settings`; `GET /api/firm/settings`; `PATCH /api/firm/settings {"staleDays":3}` | not found body; `404`; `404` for all four |
| D3 | lead2@mizan.test (Majed), admin@rawdah.test (Hind), lead@mizan.test (Khalid), admin@nukhba.test (Fahd) | `POST /api/clients/<Rawdah>/offboarding/holds {"reason":"..."}` | `404 {"error":"not_found"}` for all four; the audit log has 4 `organization.hold` denials |
| D4 | Hind, Khalid, Fahd | `GET /api/clients/<Rawdah>/offboarding` | `404` for all three |
| D4 | lead2@mizan.test (Majed, Rawdah's lead) | the same | `200` (she may read the leaving state: no holds, no blockers); she cannot place a hold (D3). |

Not run: see the top. Also not run: the **hand-over of a leaving firm person's work** (scenario 6 covers a lead leaving); erasing a firm person; **two-step reset** by the admin for a client person; the "minimal records" client's purge; the export pack; the English screens; erasing the only client admin of a client.

Console and server errors: not collected.

## Confusions
- A refused retention setting shows «refused by a data rule» in English and does not name the fields.
- The out-of-range transcript value is blocked by the browser with no sentence on the page.
- The erasure reason typed by the firm admin is shown to the client admin on the People page (as the suspension reason).
- A hold can be placed on a client that is still active; the card does not say what it holds (nothing is archived yet).
- The firm admin's erase menu sits in the client's people list, the same menu as «إيقاف الحساب», one item apart; the dialog warns clearly and asks for a reason.

## Four plain-words answers
1. Yes for erasing and holds. The settings page is long, with six separate save buttons.
2. Nothing leaked and nothing broke. The history stays but loses the name.
3. No.
4. Name the two clashing settings in Arabic when a retention rule is refused.
