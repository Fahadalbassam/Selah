# Re-check: `feature/org-chart-data` (org chart, part 1), after the builder's fixes

Reviewer: independent agent, 18 Nov 2026.
Checked at `13bce69` (the ten fix commits `0ba3751`..`13bce69` after the merge `fa63833`), against `origin/main` `16ece4d`. The earlier review is `org-chart-data-review.md`.
Method: read the whole diff `fa63833..13bce69` and `apps/web/drizzle/0100_org_chart.sql` in full where a fix touches it, compared each redefined function with its latest earlier text, ran every check on `selah_test_u` migrated from scratch, then ran my own probes (a throwaway copy of the org chart test file with seven extra cases, R1 to R7, deleted afterwards; nothing committed). For each fix I also put the database function back as it was before the fix, ran the fix's test, and put the branch's text back. Line numbers are those of `0100_org_chart.sql` at `13bce69` unless a file is named.

## Verdict

Not ready to merge: one blocking finding, and it comes from a fix. Nine of the ten earlier findings are closed, and every new test fails when its fix is taken out. The tenth (finding 4, managers reading every typed holder name through the masking list) is closed as written, but that fix opens a privacy hole. The assistant masks a client manager's text with that same list. So typed holder names are now sent unmasked to a hosted model whenever a manager's question or passages contain them, and with "show names" off (the default) that is every typed name. The product owner's spec asks for the opposite: "Add holders' typed names to `app_mask_terms` so a hosted model never receives them raw." Two smaller problems should also be fixed. The suggestion mail limit is one mail a day per person across all clients, not per client, so a lead with several clients misses mails. And a holder added during a publish stays open on a position the new version dropped. Everything else holds. `check_minimal_records()` is 0009's text plus the one new refusal, and pitches work again. A manager has no other way to a name: not an older version id, an `as_of` day, the masking list, "your manager" or an error message. The FOR SHARE lock caused no deadlock in any order I tried. Two publishes now make one version. All checks pass: lint, typecheck, 571 unit tests, 979 database tests, drizzle-kit.

## The earlier findings

| # | Earlier finding | Now | Why |
|---|---|---|---|
| 1 | `check_minimal_records()` reverts 0009; pitches fail | **Closed** | Line by line, 882-911 is `0009_prospects.sql:204-234` plus the `position_holders` refusal (903-905). The `switched` CASE, the alias and engagement checks, the contacts and files refusal and the alias copy are all unchanged, and the search_path and SECURITY DEFINER settings match. No other migration redefines the function or its trigger (searched `drizzle/*.sql`). `prospects.test.ts` 9/9 and `walkthrough-seed.test.ts` pass. With the reviewed text put back, prospects fails 6/9 again. |
| 2 | Names off on the current version bypassed through an older version | **Closed** | `app_org_chart_named_positions()` names a manager's branch only when `v.state = 'published'` (307). `app_org_chart_holders()` gives non-full readers nothing on any other version and reads every day as today (324-325). The service matches this (`readsHistory()`, `withHolders()` titles only, `getVersion()` day, `src/services/org-chart.ts:155-160, 266-275, 382-384`). Probe R7: with V1's switch on and the current one off, a manager gets 0 named positions on V1, 0 holders on V1 at any day, and 0 names on the current version. The test fails with the old functions. |
| 3 | An edit racing a publish lands in the published version and is lost | **Closed** | Both triggers read the version `FOR SHARE` (553, 562, 622, 629). The test fails without it ("done" instead of "waiting"). Probe R3 found no deadlock and no lost edit (see "Look especially at"). A holder write racing a publish is a separate, smaller gap: new finding S2. |
| 4 | Managers read every typed holder name through `app_mask_terms()` | **Closed as written, but the fix opens new finding B1** | `app_mask_terms()` (1070-1082) now gives a manager only the names she may read today. Its test fails with 0089's text. Because the assistant masks with this list, those names are no longer masked for her. |
| 5 | Suggestions: unlimited notices and mails | **Partly closed** | One unread notice per client per person, and at most one mail a firm day (852-872). The test fails without the limit. The mail limit is per person across all clients, though, not per client: new finding S1. |
| 6 | Two publishes at once make two versions | **Closed** | `app_publish_org_chart(cid, p_draft, …)` refuses a draft id that is not the current draft (458-460). It has one signature (no old 3-argument copy left, from `pg_proc`), and the grants were updated (995-1004). `publish()` requires `draftId`; its only callers are the tests, all of which pass it. A stale id, another client's draft id and an unknown id are refused (probe R4). The test fails without the check (both publishes succeed). The error wording is note N1. |
| 7 | A manager with no names can date every change | **Closed** | A manager reads only the current version, as of today, and never gets a holding's dates or id (328-332). Probe R7: asking for 2024-12-31 or for today gives the same 8 rows with no dates. |
| 8 | "Your manager" names someone where her chart shows none | **Closed (decided)** | The decision is written into `docs/authorization.md` ("Your manager" bullet) and tested ("your manager" test, departments off at Other). |
| 9 | Arabic of the mails and the notice | **Closed** | All three corrections were made as asked (`src/lib/mail-templates.ts:366`, `messages/ar.json:1979`). `tests/org-chart-text.test.ts` checks them. Its checks contain the old phrases ("هيكله", "إن رأيته", the old notice text), so they would fail against the old text. |
| 10 | Claims the tests did not prove | **Closed, one point carried forward** | "Never grants access" now also compares files and meetings (`readable()`, plus department files and meetings in the seed). Findings 2, 3, 5 and 6, a manager at a client with departments off, the masking list for a manager and "no name in a mail or notice" are now tested. **Carried forward:** two concurrent opposite reporting-line edits (earlier probe P4) still have no test (note N3). |

## New findings

### Blocking

**B1. Typed holder names are no longer masked in a client manager's assistant chats.**

- **Where:** `0100_org_chart.sql:1077-1081`, the filter added by `a2f539b`. The list is read by `projectMasker()` and `projectsMasker()` (`src/services/masking.ts:23-27, 45-52`). The assistant masks the passages, their source labels, the question and the chat history with it (`src/services/assistant.ts:230-247`). A client manager may use the assistant (`src/authz/policy.ts:347`, `client_manager: "any"`).
- **What:** the list is used to mask text before it reaches a hosted model, not only to look names up. Without the holder names, every typed name a manager may not read goes out as written. That is every typed name while "show names" is off, which is the default, and every name outside her branch while it is on. A client's own files (board minutes, its own org chart file, meeting notes) are where these names appear.
- **Failing scenario (probe R1):** masking "Auditor Person and Hessa Chair signed the minutes; Clerk One took notes." as each reader, on Acme's project:
  - client admin and staffed consultant: `[PERSON_1] and [PERSON_2] signed the minutes; [PERSON_3] took notes.`
  - manager, names off: `Auditor [PERSON_1] and Hessa Chair signed the minutes; Clerk One took notes.` ("Person" is masked only because the test's user accounts are called "… person")
  - manager, names on: `Auditor [PERSON_1] and [PERSON_2] …; [PERSON_3] …` (the internal auditor, outside her branch, is not masked)
  - manager in no department, names on: as with names off.
  With 0089's list put back, all six typed names are in the manager's list again (the a2f539b test fails with "expected [Array(6)]").
- **Why the fix was not needed for safety:** the masker creates placeholders only for names it finds in the text, and `unmask()` puts back only the text it replaced (`src/lib/masking.ts:140-149, 164`). So the full list never puts a name into an answer the reader did not already have in her own text, and the list never leaves the server. The earlier review could not check this ("What I could not check"), and its suggested fix had this side effect.
- **Fix:** give the masker every holder name again. Either:
  - remove the `holder:` filter from `app_mask_terms()`, and close finding 4 by recording why the list is safe (server only, nothing unmasked that was not in the text); or
  - keep the list closed and, for client people, build the assistant's masker from `app_mask_terms_in()` over the text that goes out (question, passages, source labels, history). That is how translation already works, and it masks every name in the text.
- **Add a test:** as a manager with names off, a masked passage contains no typed holder name.
- **Docs:** `docs/rules.md:224` ("Typed holder names are masked before a hosted model sees them") is untrue for managers today. `docs/assistant.md:109` ("What is masked") does not mention typed holder names at all.

### Should fix

**S1. The suggestion mail limit is per person across all clients, not per client.**

- **Where:** `0100_org_chart.sql:868-870`. The holder mail has the same check at 796-798, from part 1.
- **What:** the notice limit is per client (`x.entity_id = NEW.org_id`), but the mail check matches only kind, address and day. Each mail links to one client (`/clients/<id>`). After one client's mail, a lead or deputy gets no mail that day for any other client's suggestion (or holder change), although the notice for that other client is created. So the first mail for a client can be dropped.
- **Failing scenario (probe R5):**
  1. Acme's admin suggests a change. The lead and the deputy each get a notice and a mail linking to Acme.
  2. A second client's admin (same lead) suggests a change. The lead gets a notice for the second client, and no mail.
- **Fix:** add `AND o.link = '/clients/' || NEW.org_id` to both mail checks. Add a test with two clients of one lead.

**S2. A holder added while a publish is running stays open on a position the new version drops.**

- **Where:** `check_position_holder()` 735-744 reads the versions without a lock. `app_publish_org_chart()` 475-477 ends the open holdings it can see when that statement runs.
- **Failing scenario (probe R2):**
  1. In the draft, the lead removes the Secretary position.
  2. Connection 1, the lead, publishes without committing yet.
  3. Connection 2, the client's admin, adds "Late Secretary" to the published Secretary position. It succeeds at once, without waiting, and commits.
  4. Connection 1 commits.
  Result: the holding has `to_date` NULL, and the Secretary position is on no current version. `docs/rules.md:217` says publishing "ends today any holding on a position the new version drops". This one stays open: older versions viewed for later days show the person still holding the position, and the masking list keeps the name. No data is lost and no name leaks.
- **Fix:** the same pattern as finding 3. In `check_position_holder()`, take `pg_advisory_xact_lock_shared(hashtext('org_chart'), hashtext(lchart::text))` before the `in_current` check. Publish already holds that lock exclusively (456), so a holder write either finishes first (and publish ends it) or waits and is then refused. Add a race test like the existing one.

### Notes

- **N1. The publish refusal's wording.**
  - Another client's draft id and an unknown id get the same message as a stale one: "that draft was already published; check the new draft, then publish it" (probe R4). Users see it as a 409 with that text (`src/server/http.ts:316`). The message is misleading for an id that was never this client's draft: "this is not the current draft; reload it" would fit every case.
  - A malformed id ("not-a-uuid") gives 22P02, which `toErrorResponse()` turns into a 500 (`http.ts:318-319`). The route in a later part should check that the id is a uuid.
  - Like every trigger message, it is English only. The publish screen will need an Arabic text for it.
- **N2. The builder's two judgements.**
  - *A manager never sees holding dates, even for names she may see.* Not a problem. It is stricter than the spec (which says nothing about dates), matches the lead's decision of 18 Nov, and is what closes finding 7.
  - *Holdings can only be ended, never removed, so switching to minimal records is refused once anyone has been named.* Acceptable for part 1, which has no screens. It must be solved before the holder screens ship. As built, a name typed by mistake (a typo, the wrong person) can never be removed: it stays in the history and in the masking list. That conflicts with a person's right under the PDPL to have wrong data corrected and data no longer needed destroyed. It also leaves a client that becomes consultant-managed with no way to switch. Suggest a firm-admin "remove this holding" that is audited and that the minimal-records switch can rely on. It is already carried to part 3 in the lead log; it should also be listed as a must-have for the holder screens.
- **N3. Carried forward from finding 10:** concurrent opposite reporting-line edits (cycle through two transactions) are still checked only by the earlier probe P4, not by a test.
- **N4. FOR SHARE and a busy draft.** A compatible FOR SHARE request is granted ahead of a publish that is already waiting (probe R3: a third editor's insert went through while the publish waited, and the publish then included it). Edits are short, so this is harmless. A long single-transaction import (part 7) would hold the publish back until it commits; no lock timeout is set, so the publish just waits.

## Look especially at: what I found

- **033c34d:** identical to 0009 apart from the refusal (row 1 above). Nothing else lost.
- **c4223bf and a2f539b: other ways for a manager to reach a name.**
  - Older version id: titles only, in the database and in the service.
  - `as_of`: read as today, with no dates.
  - Masking list: now only her names, which is B1's problem from the other side.
  - `app_my_manager()`: unchanged, and the name only while the current version shows names.
  - Search, the assistant's retrieval and exports: no code reads the new tables (searched `src` and `scripts`). Only `services/org-chart.ts`, `services/engagement.ts` (a count), `lib/offboarding.ts` (the frozen-table list) and the schema do. The chart is not indexed.
  - Notifications and mails: carry only the client id and a link (tested).
  - Suggestion flow: managers cannot suggest (tested).
  - Error messages: the holder refusals ("already holds …") reach only writers, who see every name anyway.
  - Firm staff and the client admin are unaffected: every name on every version and day (builder test, probe R1).
- **27b2d64: deadlocks and blocking.** Publish takes the chart's advisory lock, then the draft `FOR UPDATE`; no edit path takes that advisory lock. An editor who already holds the share lock never waits again in the same transaction.
  - Probe R3: an editor inserted a position. A publish then waited, and the same editor's second edit went through at once. A third editor in another transaction also went through. After both commits, the publish completed. The published rows, the snapshot and the new draft all held "Chair", "First edit, renamed" and "Third editor".
  - Show-names changes lock only published rows, which edits never hold for long (a refused edit rolls back).
  - Edits outside a publish are unaffected: the full suite, with every edit test, passes.
- **07724cf:** all callers pass `draftId` (typecheck enforces it). Stale, another client's and unknown ids are refused. Wording: N1.
- **9e7bc40:** the first notice for a client is never dropped, and notices are counted per client. The first mail for a client can be dropped, because mails are counted per person, not per client (S1).

## Check results (`selah_test_u`, migrated from scratch)

The database server was recreated during my run (the lead's restart) and `selah_test_u` was created again by the lead. I migrated it from scratch before running anything.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm test` (unit) | 38 files, 571 tests, all passed (was 37 files and 568 tests; the new file is `tests/org-chart-text.test.ts`) |
| `npm run test:db` | 74 files, 979 tests, all passed (953 s); includes `prospects.test.ts` 9/9 and `walkthrough-seed.test.ts` |
| `npx drizzle-kit check` | "Everything's fine" |
| `npx drizzle-kit generate --name probe` | "No schema changes, nothing to migrate" (no file created) |
| Journal | 0100 at idx 90 after 0089; `when` values increase throughout |
| `pg_proc` (probe R6) | Every new or redefined function pins `search_path = public, pg_temp`; SECURITY DEFINER where expected (`app_mask_names` stays invoker and not executable by `selah_app`); `app_org_chart_full_reader` executable by `selah_app`, not PUBLIC; one `app_publish_org_chart` |

**Does each new test fail without its fix?** The database function was put back as it was before the fix, the fix's test was run, then the branch's text was restored and the test run again.

| Fix | Without the fix | With it |
|---|---|---|
| 033c34d `check_minimal_records()` | `prospects.test.ts` 6 failed / 3 passed | 9 passed |
| c4223bf names and holders | "names follow the current version" fails (a manager gets 9 holder rows on V1) | passes (it needs "publishing freezes the snapshot" to run first, for V2) |
| 27b2d64 FOR SHARE | race test fails: the rename is "done", not "waiting" | passes |
| a2f539b masking list | manager's list has 6 typed names instead of none | passes |
| 9e7bc40 suggestion limit | 4 notices and 4 mails instead of 2 and 2 | passes |
| 07724cf draft id | both concurrent publishes succeed | passes |
| 02eec8e Arabic | its checks contain the old phrases, so they would fail against the old text (not run) | passes |
| 2762539, 13bce69 | tests of existing behaviour (no fix to take out) | pass |

After these runs, `selah_test_u` holds the branch's functions again (each swap ended with the branch's text).
