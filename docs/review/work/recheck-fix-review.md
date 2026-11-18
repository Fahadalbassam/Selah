# Review of the re-check fixes (`fix/recheck-batch0`)

Independent, adversarial review, 18 Nov 2026. Reviewed at `13db086` (the branch tip after the builder merged `main` #171 and renumbered the attendee-names migration to `0093`; the migration text is byte-identical to the `0150` version). Commits reviewed: e2aa790, 8417b25, 00bbc6f, 41602d5, b51185a, aa4104a, 64f55bc. Nothing fixed or committed. Test database: `selah_test_u`, reset (schema `drizzle` dropped, `DROP OWNED BY selah_owner`) and migrated from empty.

## Verdict

**Mergeable. Nothing blocking.** The definer function returns `user_id` and `name` only, and only for a meeting the caller may open; I found no case where someone who cannot open the meeting gets anything (probes below). The banner, wording and Not found fixes do what they say. The Select fix works at a human typing pace in a real browser, Arabic and English, with Enter, Escape and the mouse.

Three things should be fixed before or with the merge. They are test and wording gaps, not leaks:

1. The new database test does not guard the case the function exists for. A weakened function that gives names to any attendee passes it and every other meeting test.
2. «لا اجتماعات لك بعد» is still untrue for the account that raised fault 2. manager@nukhba is invited to two meetings and received the invitation.
3. The Select fix has no test. In the dev build it still loses a Tab pressed within about 100 ms of the choice.

## Blocking

None.

## Should fix

**S1. The new database test passes with a function that leaks names to an attendee who may not open the meeting.** `tests/db/meeting-attendee-names.test.ts:161-187`.

- *What the tests cover:* the deny cases are a colleague not invited (`rmate`), another client (`oadmin`, `oowner`) and a meeting that does not exist.
- *What they miss:* the case decision 1a is about. That is a person who **is an attendee** but may not open the meeting: a department-limited manager invited to a whole-project meeting (manager@nukhba on the 3rd and 4th steering meetings, `scripts/walkthrough/seed.ts:557, 583`).
- *Probe:* I replaced the gate in `drizzle/0093_meeting_attendee_names.sql:16` with `(app_can_see_meeting(mid) OR app_attends_meeting(mid))` on `selah_test_u`. Then I ran the seven database test files that call `getMeeting` or the function: `meeting-attendee-names`, `whole-project-meetings`, `privacy-leaks`, `meeting-screens`, `transcripts`, `ai-sources` and `observer-indicators`. Result: **7 files, 110 tests, all passed.** No test notices that the limited manager would read every attendee's name.
- *Today's code is right:* with the real function, the manager gets `[]` (probe P2 below).
- *Fix:* add her as a deny case: invited to a whole-project meeting at a client with departments. Also add an uninvited owner of another department on a department's meeting. Both should get `[]`.

**S2. "No meetings for you yet" is still false for the person fault 2 was about.** `src/app/(app)/projects/[id]/page.tsx:564`, `messages/ar.json:125` («لا اجتماعات لك بعد»), `en.json` "No meetings for you yet."

- *The scenario:* manager@nukhba (Board secretariat only) is an attendee of «اجتماع اللجنة التوجيهية الثالث» and «…الرابع» (`seed.ts:557, 583`). The invitation for the 4th was mailed (`seed.ts:586`).
- *What changed:* her Meetings tab said «لا توجد اجتماعات بعد». It now says «لا اجتماعات لك بعد», next to the solid «حجز اجتماع». The two meetings she is invited to are, by any plain reading, "for her".
- *The contradiction:* this branch's own new warning tells the organiser «تصل دعوة التقويم إلى {names}» (`ar.json:1287`).
- *What the change does fix:* the owners' and the uninvited readers' version of fault 4.
- *Why it stays open:* fault 2 is the Gate B question ("N meetings you're invited to are open only to people who see the whole project", or refuse the invitation; page-audit §8).
- *Fix:* either wait for that answer and say in the hand-back that F2 is not closed, or mark it open in `page-audit.md` §8. Do not record it as fixed.

**S3. The Select focus fix has no test, and still loses a fast Tab in the dev build.** `src/components/ui/select.tsx:41-52`. There is no unit or end-to-end test (the commit says so). I checked it in a real browser on a dev server of this branch: `/inquiry`, the sector list, signed out, pointed at `selah_test_u`. A focus and key log was kept in the page.

| Case | Result |
|---|---|
| AR. Tab to the list, Enter, ArrowDown, Enter, wait 0.3 s, Tab | Focus is back on the trigger 74 ms after Enter; Tab lands on «متابعة». **Pass** |
| EN (LTR). The same with ArrowDown to open | Focus is on the trigger 316 ms after Enter (dev render); Tab goes to "Continue". **Pass** |
| AR. Escape after ArrowDown | Focus on the trigger, value unchanged. **Pass** |
| AR. Mouse open, mouse pick, wait 0.3 s, Tab | Value «التدريب», Tab goes on, no focus pulled back later. **Pass** |
| AR. Enter, then Tab about 100 ms later (batched keys) | The option lost focus 98 ms after Enter (that is when the render committed), the Tab came at 104 ms with focus on BODY, and it went to an invisible `span` at the end of the page (by all signs Radix's focus guard). About 550 ms later, when the list unmounted, focus jumped back to the trigger. **The Tab was lost** |

- *Why the last case fails:* focus goes back to the trigger only in an effect plus `setTimeout(0)`. Any Tab that arrives before the render commits (100 to 300 ms in dev; much less in production) still hits the original bug. This is not a regression: before the fix the window was the whole close animation.
- *Not tested:* choosing with Space. The trigger now has focus before the Space key-up, and Radix's trigger `onClick` opens the list when the last pointer was not a mouse (`@radix-ui/react-select` 2.4.1, `dist/index.mjs:221-226`, `pointerTypeRef` starts as `"touch"`). As far as I know, Chromium clicks a button on Space key-up only if the key-down made it active. I could not check Firefox, which may click on a key-up alone; there choosing with Space could reopen the list. Holding Enter past the key-repeat delay has the same exposure (repeated key-downs on the trigger open it). That was also true before, only later.
- *Fix:* add an end-to-end test for the inquiry role list: Enter, then Tab lands on the job-title field. The builder cannot run it, but the lead can. Also check Space in Firefox.

## Notes

**N1. Attendee names: what I probed** (scratch vitest run against `selah_test_u`, data built through `bookMeeting()`; client with departments, client without departments, a second client, a second firm). Each line gives the caller and what `app_meeting_attendee_names` returned:

- **P1.** Definer, owner `selah_owner`, `search_path=public, pg_temp`, `STABLE`. Returns `TABLE(user_id uuid, name text)`. EXECUTE only for `selah_app` (and the owner); not `selah_auth`, not PUBLIC.
- **P2.** Whole-project meeting:
  - the limited manager, invited: `[]`, and `getMeeting` answers "meeting not found";
  - the Finance owner, not invited: `[]`;
  - the invited Legal owner: the 5 names. Her follow-ups list shows only her own ("FU owner" of 3), and `agendaScope` is "own";
  - the client admin and the observer: the 5 names.
- **P3.** Finance department meeting:
  - the Legal owner, not invited: `[]`;
  - the Board manager, not invited: `[]`;
  - a *Finance* owner, not invited: the 3 names. 0070 opens a department's meeting to its people. This follows the lead's rule ("whoever may open it"); it means an action owner can read a department meeting's attendees without being invited.
- **P4.**
  - Another client's admin and owner, a consultant of another firm, the Rawdah people on a Nukhba meeting: `[]`.
  - Client people on a firm-private meeting: `[]`.
  - No `selah.user_id` set, or a null id: `[]`.
- **P5.** A cancelled meeting: names for the invited owner (she can still open it), `[]` for her uninvited colleague. There is no soft delete on `meetings`; a deleted meeting cascades its attendees away.
- **P6.** An owner taken off the project after the invitation: `[]` for her. The others still read her name.
- **P7.** Enumeration: adding a user of another client, of another firm, or another client's admin as an attendee is refused. For the lead consultant the insert fails in the database; the rule is the trigger `check_attendee`, which requires `app_user_sees_project` for the person. A client admin gets `forbidden`. So no one from another tenant can become an attendee, and no name can be pulled out by id.
- **Visibility picker:** `feature/audience-picker` redefines `app_can_see_meeting()` with `app_audience_ok('meeting', …)` (`0111_audience_rules.sql:585`). The new function calls it by name at run time, so it will follow whatever migration order the two branches end up with. Attendees cannot be left out, by decision.

**N2. A client contact on a meeting is still a nameless "—" for client readers.**

- *Where:* `src/services/meetings.ts:255`, page `meetings/[id]/page.tsx:401`. P2: the client admin sees `[null, "contact"]`; the firm sees "External Auditor".
- *Why:* the builder kept contact names for the firm only (`docs/rules.md`, the new row). The decision quoted in the migration ("anyone who may open a meeting sees the names of its attendees") does not make that exception.
- *The inconsistency:* the mailed invitation gives every attendee the contact's name *and address* (`recheck-check.md` §2).
- *Scope:* no contact is on a meeting in the walkthrough data. A question for the lead, not a fault in this branch.

**N3. The in-app calendar file still follows the user-row rule.** `meetingIcs()`, `src/services/meetings.ts:683`. P5: the Rawdah owner's download has one ATTENDEE line (herself), while the page now names the admin. This follows from "the name only, nothing else" (an ATTENDEE line needs an address). Worth one line in `docs/meetings.md` so nobody files it as F1 again.

**N4. Release verb «إسناد» against the status word «مُسند».**

- *The overlap:* `status.assigned` is «مُسند» (`ar.json:54`). "Released actions" are now «الإجراءات المُسندة». So `metrics.historyHint` (`ar.json:1646`) can be read as "of the actions whose status is «مُسند», the share verified", which is impossible.
- *Scope:* `metrics.noneYet` is true under both readings. D3 renames the status words in batch 5, which removes the clash. Low.

**N5. The same "none" pattern on the meeting page.** «لم تُسجَّل قرارات» (`meetings/[id]/page.tsx:303`, `ar.json:1165`). A decision can carry its own visibility (`recordDecision()`, `services/meetings.ts:576-591`), so a client reader on a meeting whose decisions are all firm-only reads "No decisions recorded". Outside fault 4 as worded. Low. Follow-ups are safe: the card is hidden when a client has none of their own.

**N6. Nothing reveals hidden items.** «لا … لك بعد» / "No … for you yet" is shown to everyone on Meetings and Documents (the firm included), and to every client reader on Recommendations, a recommendation's actions and Requests. Its presence therefore says nothing about whether anything is hidden. I found no screen that now says "none" while the reader has items: each line is drawn only when the reader's own list is empty (`projects/[id]/page.tsx:412-415, 563-564, 664-665`, `info-requests-tab.tsx:86`, `recommendations/[id]/page.tsx:190-192`). A firm observer (`can.manage` false) reads the client line on Requests, «لا طلبات لك بعد», which is true for him.

**N7. Banner by reader: correct on every screen that draws it.**

- *Which line where:* `firm` is `principal.orgKind === "firm"` on the indicator page, `/indicators/data` and the reports page, and in `listIndicators()` / `recommendationIndicators()` (home, a department's page, `/clients/:id`, linked indicators). The import wizard uses `onBehalf={data.firm}`.
- *Exports:* the PDFs (`report-html.ts:234`, `client-report-html.ts:141`, `closure-html.ts:96`) and the Excel exports (`services/exports.ts:302, 482`) keep the third-person line, as intended.
- *Not a screen:* the assistant's context sentence (`services/assistant.ts:863`) is model input.
- *No crossover:* I found no screen where a firm reader gets the client line, or the reverse.
- *Small:* the API `GET /api/clients/:id/indicators` now also returns `firm`.

**N8. Not found.**

- *Signed out, on this branch, in a browser:*
  - `/no-such-page` answers 404 with one switch ("English"; after switching, «العربية») and the text in both languages;
  - `/meetings/<uuid>` redirects to `/sign-in`, so a signed-out reader never gets the in-app page.
- *Signed in:* not seen in a browser. I did not sign in to the dev app.
- *Why it should hold:* Next's own docs (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`) render a segment's `not-found.js` inside that segment's layout, so `(app)/not-found.tsx` sits under the top bar and its single switch.
- *What the test proves:* `tests/not-found.test.ts` renders the component on its own and greps the source. It shows the file exists and has no switch, not that Next uses it in the shell. It fails before the fix only because the import is missing.

**N9. Tests that assert source text.**

- *Which:* `recheck-text.test.ts:139-146, 165-180`, `draft-messages.test.ts:29-42` and `not-found.test.ts:36-41` check that an expression appears in a `.tsx` file.
- *Weakness:* they pass if the expression is there but unused, and break on reformatting. The banner check (`/\? "claimNote" : "claimNoteClient"/`) would fail a correct `client ? "claimNoteClient" : "claimNote"` and pass a wrong condition.
- *What is fine:* the message-value tests are sound and would fail on the old strings.

**N10. Wording.**

- «لـ{names}» with a Latin name in the Arabic UI reads «لـReem». Cosmetic.
- The Arabic `draftNotice` and `draftNoticeReader` are identical on purpose (noun form). Only English differs.
- `leftOutKeepsDepartment` lost "but they won't be able to open it" in Arabic; the first line already says it. Fine.

**N11. 64f55bc (capture caret)** is review tooling only. I did not re-run the capture, so the claim that the remaining hydration warnings were the capture's own is the builder's, not checked here.

**N12. Docs.** `docs/rules.md`, `authorization.md`, `meetings.md`, `metrics.md`, `ui-guidelines.md`, `accounts.md` and `walkthrough.md` are updated and name `0093`. No `0150` is left in `docs/`, `src/`, `tests/` or the migrations. `authorization.md` still says that, for a left-out invitee, the meeting's attendees "answer Not found", while her mailed invitation lists them (an older point, `recheck-check.md` §2).

## Check results (at 13db086, `TZ=UTC`, `apps/web`)

| Check | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (unit) | 42 files, 607 tests, all passed |
| `npm run test:db` on `selah_test_u` (fresh migrate) | **77 files, 1034 tests, all passed** (797 s), on a run with nothing else on the machine. An earlier run, made while my dev server was compiling alongside, had three 10-second hook timeouts (`dead-links`, `metrics`, `status-pack`). Those three files alone then passed: 24 of 24. |
| New DB test with the attendee mutant (S1) | 5 of 5 pass (should fail); the 7 meeting-related files: 110 of 110 pass |
| Browser, dev server on 127.0.0.1:3091 against `selah_test_u` | Select cases in S3; Not found in N8 |

**Do the new tests fail without their fix?**

| Test | Fails without the fix? |
|---|---|
| `meeting-attendee-names` | Yes (the function is missing); but it does not catch the weakened gate (S1) |
| `recheck-text` | Yes: literal strings, and the old catalogue fails them |
| `not-found` | Yes, trivially (import of a missing file) |
| `draft-messages` | Yes, by source-text match |
| `meeting-left-out` | Yes, by source-text match |
| Select | No test |
