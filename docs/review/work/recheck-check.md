# Independent check of the screen re-check (batch 0)

Checker's report, 18 Nov 2026. I checked `work/recheck-firm-public.md` and `work/recheck-client.md` against the `recheck1` and `phase1` captures and the code on `main` (c78a7a9). This was read only. Evidence paths are relative to `docs/review/shots/`.

## Verdict

**Nothing blocking.** I found no screen where someone sees what they may not, and neither did the helpers.

- The five blocking conditions in the client report hold.
- The firm report's claims about the observer and lead2 hold as worded.
- Every "fixed" claim I checked (24 of them) holds.
- Four claims are incomplete or out of date. The most important is the client report's description of the calendar invite (section 2).
- Five things in scope were not judged by either report (section 5).

## 1. Blocking first

There is no blocking fault.

The case closest to blocking is the calendar invite sent to manager@nukhba for a whole-project meeting she cannot open (section 2). It is **not a privacy fault under the decision**, for four reasons:

- The decision controls who may *open* the meeting in Selah. The mail opens nothing.
- The mail names no work and carries no agenda.
- Every person and address in it is already visible to her in Selah.
- The organiser may invite her after the warning.

It is still a point for Fahad (section 7, question 1).

## 2. The calendar invite to manager@nukhba: what the mail contains

How the invite was sent:

- The seed books «اجتماع اللجنة التوجيهية الرابع» with her as an attendee (`apps/web/scripts/walkthrough/seed.ts:555`).
- It then calls `sendInvites` (`seed.ts:558`).
- `sendInvites` runs `app_send_meeting_invites` (`drizzle/0000_baseline.sql:4353-4369`; no later migration changes it).
- That function queues one `meeting.invite` mail for every attendee with an account, except the person sending it, plus every client contact who has an e-mail address.
- The queued mail has **no link** (only `to_email, kind, meeting_id`).

What she receives:

| Part | Content | Source |
|---|---|---|
| Subject | «دعوة اجتماع \| Meeting invitation» | `src/lib/mail-templates.ts:86-89`, `renderMail` l. 361 |
| Body | «دعوة الاجتماع مرفقة. افتحها لإضافتها إلى تقويمك.», then "The meeting invitation is attached. Open it to add it to your calendar." No Selah address, no button. | same |
| Attachment | An iCalendar REQUEST. The sender job builds it when the mail goes out, as the schema owner (no row rules). Every recipient gets the same file. | `src/jobs/mail.ts:83-127`, `src/lib/ics.ts:53-81` |
| SUMMARY | «اجتماع اللجنة التوجيهية الرابع» | `ics.ts:68` |
| DTSTART / DTEND | Six days after seeding, 10:00 to 11:00. The firm page shows Tue 24 Nov 2026, 10:00–11:00. | `ics.ts:66-67` |
| LOCATION, URL, DESCRIPTION | The call link `https://meet.google.com/abc-defg-hij` | `ics.ts:69-70` |
| ORGANIZER | خالد الشمري, `lead@mizan.test` | `ics.ts:72` |
| ATTENDEE (RSVP=TRUE), name and address of each | منصور العنزي `sponsor@nukhba.test`, ريم الحربي `manager@nukhba.test`, فهد الدوسري `admin@nukhba.test`, عمر الزهراني `consultant@mizan.test`, نورة القحطاني `deputy@mizan.test` (marked optional) | `ics.ts:73-76`, `mail.ts:105-123` |
| Not in it | Agenda, decisions, summary, follow-ups, project name, department | — |

Judgement:

- **The client report's F2 is incomplete.** It says the invite "carries the title and the call link". The invite also carries the time, the organiser, and every invitee with their e-mail address. Its conclusion ("no leak") still holds.
- **Under the decision, this is not a privacy fault.**
  - She can already see all five people and their addresses in Selah. `/team` lists the Nukhba addresses. Her captured pages also show `lead@`, `deputy@` and `consultant@mizan.test`.
  - The title names no other department's work.
  - The organiser chose to invite her.
  - `docs/meetings.md:12` records this content as accepted: "title, time, link and who else is invited, never the agenda".
- **The docs disagree with each other.** `docs/authorization.md:57` says that for her the meeting's attendees "answer Not found". The mail gives her the attendee list.
- **The "as decided" was the lead's call, not Fahad's.** Fahad's test list asks for "404 on a whole-project meeting, its agenda, its PDF and its calendar entry" (`decisions/2026-11-17-gate-a-followups.md:17`). The in-app calendar file does answer 404 for her, but the mailed calendar entry still reaches her. The wording "left as it is, as decided" came from the #165 review (`work/agenda-owners-links-review.md:20`, row 8). That is worth one line to Fahad.
- **The warning does not say the invite still goes out.** The organiser reads «لن يتمكن {names} من فتح هذا الاجتماع … يمكنك الحفظ رغم ذلك.» (`messages/ar.json:1283`). Nothing says the person still gets the invite with the call link. "Send the calendar invite now" is ticked by default (`src/components/meeting-form.tsx`, `useState(true)`).
- **Edge case, older than batch 0, low.** A client contact (for example the external auditor) on any shared meeting has their e-mail address mailed to every invitee. Inside Selah only the firm sees contacts on a meeting (`src/services/meetings.ts:234`).

## 3. The blocking conditions, checked myself

| Condition | Holds? | What I checked |
|---|---|---|
| No draft action visible to any client | **Yes** | I searched all 8 client accounts, both languages, in `recheck1/*/pages.json`. The draft's title «اعتماد قرار تشكيل اللجنة ونشره»: 0 hits. Its id `64f9a053`: 0 hits. The firm accounts have it: lead, deputy, consultant and observer 5–10 hits each. The "مسودة" hits on client pages are other records («صياغة مسودة الميثاق», «عرض المسودة…») and file names. `/actions` for admin@nukhba has 8 rows; the card reads «8 إجراءات · مُتحقق: 1». |
| Owners see no title and no count of others' actions | **Yes** | I counted every Nukhba and Rawdah action title in each owner's `pages.json`, AR and EN. owner@nukhba: only his 3. finance@nukhba: only her 2. owner@rawdah: only her 2. Home counters are their own (`owner_at_nukhba.test/ar/001-home-1280.png` 1/0/0/0, late 1; finance 2/0/0/0). Recommendation pages show no "N more" (`owner_at_nukhba.test/ar` #15–17). The Closing tab shows only her own action (`owner_at_rawdah.test/ar/014`). Code: the plan Excel follows the same filter (`src/services/exports.ts:91-173`), and the actions Excel uses `mineOnly` for owners. |
| A department-limited manager sees no other department's titles, and gets Not found on a whole-project meeting | **Yes**, with the evidence gap the client report states | 0 Finance or Legal action titles on any manager@nukhba page, AR and EN. Her one non-secretariat title, «نشر الميثاق…», is filed under the secretariat. "Not found" is in `check-agenda/manager_at_nukhba.test/ar/001-meetings_574c3428-1280.png`. Note: that capture was taken 23:05–23:06 on 17 Nov, about 20 minutes before #165 merged (23:27), on a branch build with phase-1 data, not on `main`. The code on `main` agrees (`drizzle/0082`, `0084`). |
| The Rawdah owner opens her meeting and sees only her own tasks | **Yes** | `owner_at_rawdah.test/ar/017-meetings_6834f191-1280.png`: «إجراءاتك المدرجة في جدول أعمال هذا الاجتماع فقط» with her 2 actions. The admin and lead2 see 4. Her Meetings tab lists 1 meeting (`…/010`). |
| No Link / Unlink for a client admin | **Yes** | There is no «ربط», «فك الربط», "Link" or "Unlink" in the buttons or menus of any client account, in either language. Indicator pages went from 11 buttons to 9. Recommendation pages went from 3–4 buttons to 2. Rule: `src/authz/policy.ts:267`. |

**Firm report: the observer (holds as worded).** Firm report l. 74 says the observer "changes nothing on indicators, meetings or assessments". That holds:

- indicators show only «عرض كجدول» (`observer_at_mizan.test/ar` #43, #44);
- meetings show only «اسأل المساعد» (#45–47);
- recommendations show only «اسأل المساعد» (#38–40);
- the assessment page has no buttons (#42);
- the client and department pages have no «مؤشر جديد» (#49, #52–54).

If the claim is read as "the observer changes nothing at all", it does not hold, by design. The observer still has:

- «إضافة ملاحظة» (firm-only notes) on every action, which is allowed (`OPEN_TO_OBSERVERS`, `policy.ts:388`);
- firm-wide buttons that do not depend on a project role: «مشروع داخلي جديد», «إدخال طلب», «بدء عرض», «طلب الانضمام».

**Firm report: lead2 (holds).** I searched lead2's `pages.json`, AR and EN, for the Nukhba names, the project title, its ids, its people and its action words. The only hits are «شركة النخبة القابضة» / "Al-Nukhba Holding" and «النخبة للتطوير العقاري» on `/clients`, next to «طلب الانضمام». ("الشهري" matched only the word «الشهرية».)

## 4. Claims that do not hold, or no longer hold

1. **Client F2, the invite's content.** It is incomplete (section 2). The verdict "no leak" stands. Also, `app_send_meeting_invites` mails every attendee *except the sender*, plus client contacts.
2. **Firm report, the upload page by a real link: out of date.** The report said three things:
   - "93 is a dead-link page; the live page was not seen";
   - row 53 "line fixed in code, live page not seen";
   - "`notes-upload-security.json` holds the full token".

   The re-capture at 03:00 replaces all three (`recheck1/public/ar/93-upload-real-link-1280.png`, `…-768.png`, `en/93-…`):
   - The live page shows «مطلوب من ميزان للاستشارات», the item as h1, one solid «إرسال», and the expiry line.
   - The header has only the wordmark and «English». «تسجيل الدخول» is gone (phase 1 had it).
   - The notes file now holds `<token>`.
   - What remains:
     - In Arabic, the extension list (now one left-to-right piece) breaks over two lines at 1280 and 768: line 2 starts «.txt .csv)».
     - The native file control reads "Choose File / No file chosen" in English. That comes from the capture browser's language, not from the app.
3. **Firm F3, the count.** It says "meetings 11 loads". In fact there are 9 meeting loads carrying 11 warnings: admin EN #83 and #85 have two each. The other counts are right: notifications 5, actions 3, departments 1, plan import 1. Lead AR #49 (`/projects/:id/import`) is a server-side `pg` deprecation warning, not a hydration warning.
4. **Client check 3.** The "Not found" proof is from a pre-merge branch build (section 3). The report says "phase-1 data" but not that it was pre-merge.

## 5. "Fixed" claims checked against the captures (24, all hold)

| Claim | Evidence (`recheck1/…` unless noted) |
|---|---|
| Client B2: «8 إجراءات · مُتحقق: 1», bar 1 of 8 | `admin_at_nukhba.test/ar/005-projects-1280.png` |
| Client N2: draft row gone, 8 rows | `admin_at_nukhba.test/ar/006` text |
| Client: Link/Unlink gone | `pages.json` buttons, recheck1 vs `phase1/admin_at_nukhba.test/ar` #24, 25, 36–38 |
| Client N14: «1–30 يومًا: 1» | `manager_at_nukhba.test/ar/010-projects_f19fbafb_tab_التقدم-1280-full.png` |
| Client B4: «مفعّلة» / «متوقفة» | `manager_at_nukhba.test/ar/008`, `manager_at_rawdah.test/ar/008` |
| Client row 24: one Departments link for the limited manager | `manager_at_nukhba.test/ar/008` (links 1) |
| Client 3.8: Rawdah home without the data-mode card | `admin_at_rawdah.test/ar/001-home-1280-full.png` |
| Client B3: ladder gone on a verified action | `admin_at_rawdah.test/ar/022` vs `phase1/…/022` (phase 1 had «تذكير 29/10 متأخر 02/11») |
| Client N15: «مذكرة المقارنة…» now «أُرسل، بانتظار المراجعة» with «تنزيل» | `finance_at_nukhba.test/ar/013` vs `phase1/…/014` |
| Client B5: no page error on meetings | 0 events in all 8 client accounts, both languages |
| Client N1: owner's recommendation shows only his action, no count | `owner_at_nukhba.test/ar` #15–17 |
| Client N5: owner has no meetings | `owner_at_nukhba.test/ar/009` |
| Firm B2: «8 إجراءات · مُتحقق: 1 · بانتظار المراجعة: 1» | `admin_at_mizan.test/ar/071` (phase 1 had no count) |
| Firm N8: «6 فجوات مقترحة، 0 مؤكدة» + «للمكتب فقط» | `admin_at_mizan.test/ar/016` |
| Firm N12: badge «17» (phase 1 «71») | `lead_at_mizan.test/ar/001-home-1280.png` vs `phase1/…` |
| Firm: staff band «10–49» | `admin_at_mizan.test/ar/006` |
| Firm: "1 action" in English | `admin_at_mizan.test/en/071` |
| Firm: draft line «لا يراه العميل حتى تُصدره…» | `lead_at_mizan.test/ar/042` |
| Firm N4: observer read-only on indicators and meetings | `observer_at_mizan.test/ar` #43–47 |
| Firm N24: firm-run line on every Al-Waha tab | `admin_at_mizan.test/ar` #56–66 |
| Firm: Activity rows "…، بواسطة" | `admin_at_mizan.test/ar/019` |
| Firm N23: mail row reads «غير مستخدم في هذا الموقع» | `public/ar/85-legal-sub-processors-1280.png` |
| Firm N23: consent no longer says "stays in the Kingdom" | `owner_at_rawdah.test/ar/001` vs `phase1/…/001` |
| Firm row 53: upload header without «تسجيل الدخول» | `public/ar/93` vs `phase1/public/ar/93` |

## 6. The faults listed: real? severity?

All faults listed in both reports are real. I confirmed them on screen or in code:

- client F1 to F7;
- firm F1 to F6;
- firm F7 is marked unsure, and I did not test it.

Line references I re-read and found correct: `meetings.ts:235-248`, `meetings/[id]/page.tsx:60-69` and `:401`, `0085_live_agenda.sql:69`, `ar.json:1613, 4817, 4825, 4828, 4891, 5072`, `files.ts:168-173`, `team/page.tsx:89`, `indicator-data.ts:200`.

No fault should be raised to blocking. Changes I suggest:

- **Client F2 (medium): keep, and widen it.** Correct the invite text (section 2). Two owner tabs show the same false "nothing here" pattern:
  - owner@nukhba's Meetings tab says «لا توجد اجتماعات بعد», though the project has 3 meetings;
  - his Requests tab says «لم تطلب الشركة أي شيء بعد», though there are 4 requests (`owner_at_nukhba.test/ar/009`, `010`).

  Wording such as "none for you" fixes all three without a count.
- **Firm F1 (two language switches): more people see it now.** It is the page every limited client reader gets on a whole-project meeting, and every owner gets on a colleague's action (`check-agenda/manager_at_nukhba.test/ar/001` shows «EN» and «English»). The client report does not mention it.
- **Client F3 and firm F2 (agenda language).** Both call it low. That is fine only if Fahad accepts "the agenda is in the meeting's language". Otherwise it is B1 still half open, on a hard rule (rule 2), although `lead-log.md` (18 Nov) says batch 0 is closed.
- **Firm F3:** correct the count (section 4).
- **Client F7:** I agree it is an observation. In the captures it comes from the seed booking a past meeting today.

## 7. In scope, judged by neither report

1. **The meeting form and the add-attendee form with the new warning (#165).** Both are dialogs and were not captured. Both reports defer them, and neither gives a verdict. From the messages:
   - The Arabic reads plainly.
   - «لن يتمكن {names}» uses a masculine verb, even for «ريم الحربي».
   - It does not say the person still gets the invite and the call link.
   - The limited manager's own booking dialog (her department only, «departmentOnlyHint») was not seen either.
2. **The Trace tab for client readers.** It is not in the client report.
   - For manager@nukhba, the draft is gone (links 10 → 9) and only her work shows under the findings.
   - The Finance finding «حدود الصلاحيات المالية مرتفعة» stands with nothing under it. The Recommendations tab says «تعالجها توصية في إدارة أخرى» for the same finding.
   - No title leaks; this is a small inconsistency (`manager_at_nukhba.test/ar/011-projects_f19fbafb_tab_التتبّع-1280-full.png`). Trace goes in D2 anyway.
3. **Owners' empty states** (section 6, client F2).
4. **The in-app Not found that limited client readers now get** (section 6, firm F1).
5. **Not captured by either report: the Files card, the Excel and PDF exports, the mails (such as `action.assigned` for the draft's named owner) and the client assistant.**
   - The code reads them under the same row rules (`exports.ts`; `files.ts:168-173`).
   - On screen, the notifications show no draft.
   - None of these was verified as a file or a mail.

## 8. For Fahad (short)

1. The limited manager invited to a whole-project meeting gets a calendar invite with its title, time, call link and every invitee's address, while the page answers Not found.
   - Is that acceptable as `docs/meetings.md` says? If yes, fix `authorization.md:57` to match.
   - If not, leave the other attendees out of her invite. Either way, say in the warning that the invite still goes out.
2. Free text written by a person still names other people's work. This is not D8 (D8 is about titles). Accept it?
   - Examples: the report note «مصفوفة الصلاحيات متأخرة أسبوعين» for the secretariat manager (client Q3).
   - The sponsor's answer «سيُنفَّذ: عرض المسودة على المجلس…» shown to owner@nukhba on the charter recommendation (`owner_at_nukhba.test/ar/015`).
