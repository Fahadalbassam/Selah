# Review: `feature/org-chart-data` (org chart, part 1)

Reviewer: independent agent, 18 Nov 2026.
Reviewed at `0ba3751` (after the builder's minimal-records commit `e4b1894`, the merge of `origin/main` `fa63833`, and the masking fix `0ba3751`), against `origin/main` `16ece4d`. A first pass ran on `b637d8d` before the merge.
Method: read `apps/web/drizzle/0100_org_chart.sql` in full, `src/services/org-chart.ts`, the authz, principal and lib changes, and the tests. I ran the branch's tests and my own probes on `selah_test_r`, reset and migrated from scratch, using a throwaway test file in a scratch copy of the commit (`git archive`), never in the worktree. "Probe Pn" below is one of those runs. Line numbers are those of `0100_org_chart.sql` at `0ba3751` unless a file is named.

## Findings, most serious first

| # | Severity | Finding |
|---|---|---|
| 1 | blocking | `check_minimal_records()` reverts 0009: consultants cannot start a pitch (prospects tests and walkthrough seed fail) |
| 2 | blocking | Names off on the current version is bypassed through an older version that is still on |
| 3 | should fix | An edit racing a publish lands in the published version and is lost from the draft |
| 4 | should fix | Managers read every typed holder name through `app_mask_terms()` |
| 5 | should fix | Suggestions: unlimited notices and mails |
| 6 | should fix | Two publishes at once make two permanent versions |
| 7 | note | A manager who sees no names can date every change (as-of counts) |
| 8 | note | "Your manager" names someone where the manager's chart shows none |
| 9 | note | Arabic of the two new mails and one notice |
| 10 | note | Claims the tests do not prove |

Totals: 2 blocking, 4 should fix, 4 notes.

An earlier blocking issue was fixed by the builder while I reviewed. Before `0ba3751`, 0100 redefined `app_mask_terms()` from the baseline, which would have undone 0087 (the list refused to action owners) and 0089 (translations read `app_mask_names()`). At `b637d8d`, probe P10 as an action owner returned every name at the client and the firm. After `0ba3751` it is refused, and the holder names are in `app_mask_names()`.

### 1. blocking: `check_minimal_records()` reverts 0009 and stops consultants starting a pitch

- **Where:** `0100_org_chart.sql:845-880` (added in `e4b1894`).
- **What:** the new definition says "latest definition: 0000_baseline, Insight" and starts from that text. But `0009_prospects.sql:203-230` redefined the function later ("a consultant may start a pitch"): on INSERT, `switched` is only true when the new row sets minimal records or an alias. 0100 goes back to `switched := TG_OP = 'INSERT' OR ...`, so every organisation insert by anyone but the firm admin raises "only the firm admin sets minimal records".
- **How I know:** on the merged branch, `tests/db/prospects.test.ts` fails 6 of 9 tests, each with `app_start_pitch` → `check_minimal_records() line 6 at RAISE`. `tests/db/walkthrough-seed.test.ts` fails the same way: `scripts/walkthrough/seed.ts:114` → `startPitch`, so the walkthrough seed no longer runs. These are the only failures in the full suite.
- **Fix:** start from 0009's text. Keep its `CASE WHEN TG_OP = 'INSERT' THEN NEW.minimal_records OR NEW.display_alias IS NOT NULL ELSE ... END`, add only the `position_holders` refusal, and change the comment to "latest definition: 0009_prospects". Rerun `prospects.test.ts`.

### 2. blocking: switching names off on the current version is bypassed through an older version

- **Where:** `app_org_chart_named_positions()` 287-299 reads the `show_names` of the version it is asked about. `app_org_chart_holders(vid, as_of)` 304-321 accepts any day for any readable version. `src/services/org-chart.ts:362-378`: `getVersion()` takes any `asOf`, and for a superseded version it defaults to the day the version was replaced.
- **What:** holdings belong to the lineage, not the version, so a superseded version shows today's people as soon as the reader asks for today. Suppose the client admin had names on for version 1. Publishing carries the switch over to version 2 (`coalesce(prev_names, false)`, line 450). The admin then turns names off on version 2, the current one. A manager still reads current names in her branch through version 1, whose switch is still on. The admin has no single switch: she would have to find and turn off every past version.
- **How I know (probe P1):** I turned V1 on, published V2 (it inherited on) and turned V2 off. Then `getPublishedChart` as `mgr` gave `names: "none"` and 0 names, while `getVersion(V1, today)` gave `names: "branch"` with 6 current names (Hessa Chair, Nasser Ceo, Cfo Person, ...). `getVersion(V1)` with no day, and `SELECT name FROM app_org_chart_holders(V1, app_firm_today())` as `mgr`, gave the same 6.
- **Fix:** make the managers' switch one per client. Either move it to `org_charts`, or AND every version's switch with the current published version's switch in `app_org_chart_named_positions()`. Separately, limit `as_of` for a past version to the time it was in force (`effective_on`/`published_at` to `superseded_at`). Add a test.

### 3. should fix: an edit racing a publish lands in the version just published

- **Where:** `check_org_unit()` 538 and `check_position()` 604 read the version's state without a lock. `app_publish_org_chart()` 437 locks the draft `FOR UPDATE`.
- **What:** a draft edit can pass its trigger while the publish is still uncommitted. The edit then commits into what has become the published version. The version's rows no longer match its snapshot, the edit is missing from the new draft (the copy was made without it), and the firm loses it without any error. `app_my_manager()` and `app_org_chart_holders()` read those rows, not the snapshot.
- **How I know (probe R1):**
  - Connection 1 (the lead): `app_publish_org_chart`, not yet committed.
  - Connection 2 (a staffed consultant): inserts a position into the draft. It waits on the foreign key lock, then succeeds once connection 1 commits.
  - Connection 3: renames a draft position, which succeeds at once.
  - Result: both rows ended up in published version 2. Its snapshot has neither, and the new draft has 0 of them.
- **Fix:** read the version row `FOR SHARE` (or `FOR KEY SHARE`) in both triggers. A writer then waits for an uncommitted publish, reads the state again and is refused.

### 4. should fix: managers read every typed holder name through the masking list

- **Where:** `app_mask_names()` 998-1031, the `position_holders` union at 1027. `app_mask_terms()` (0089) returns it to anyone but action owners.
- **What:** typed holder names, current and past, sit in the project's name list whatever the switch, the branch or the draft says. The masking list is used on the server only (`src/services/masking.ts:25`), so the browser never gets it. But it is a direct database road to names, the same reason 0087 closed this list to action owners.
- **How I know (probe R2):** as `mgr`, with `show_names` off on V1, `SELECT term FROM app_mask_terms(P) WHERE entity LIKE 'holder:%'` returned all 6 typed names. They include "Auditor Person", who is outside her branch even when names are on. In the first pass, the list also held a name typed only into the firm's draft ("Draft Holder").
- **Fix:** in the full list (`app_mask_terms`), include the holder names only for callers who see every name (the firm's readers, the client's admin). `app_mask_terms_in()` returns only names written in the text, so it can keep them.

### 5. should fix: a suggestion is not limited, unlike every other mail a client person triggers

- **Where:** `notify_org_chart_change_request()` 826-843.
- **What:** every insert writes one notice and one work mail to each of the lead and deputy, with no dedupe and no daily cap. The holder notice (747-775) has both, and `app_report_problem()` (0060_help.sql:69-73) caps reports per person per day.
- **How I know (probe P11):** 5 suggestions from `cadmin` gave 10 mails and 10 notices.
- **Fix:** one unread notice per client and one mail per firm day, as for holder changes, or a per-admin daily cap.

### 6. should fix: two publishes at once make two permanent versions

- **Where:** `app_publish_org_chart()` 420-459 and `publish()` in `src/services/org-chart.ts:827-848`.
- **What:** the advisory lock serialises the two calls, but the second one then publishes the fresh draft, which is an unchanged copy. History is never deleted, and the version number appears in the PDF footer.
- **How I know (probe P3):** the lead and the deputy published concurrently. Both succeeded, as versions 3 and 4, so there were 2 new versions with no change between them. The invariants held: still one draft and one current version.
- **Fix:** `publish()` passes the draft id the publisher saw, and the function refuses when it is no longer the draft. Alternatively, refuse a draft unchanged since it was copied.

### 7. note: a manager who sees no names can still date every change

- **Where:** `app_org_chart_holders(vid, as_of)` and `getVersion(asOf)`.
- **What:** an unnamed holder comes back as a row with `named = false`. That gives filled or vacant, and the number of holders per position, on any day asked. Trying days narrows down when each holding started and ended.
- **How I know (probe P7):** as `mgr` with names off, 2024-12-31 gave 0 rows, 2025-01-01 gave 8 and today gave 8, with no name or date in any row.
- **Fix:** for a reader who does not see names, take today (or the version's own period) and ignore other days.

### 8. note: "your manager" names a manager's manager where her chart shows no names

- **Where:** `app_my_manager()` 327-347 checks `show_names`, but not the client's departments or the branch.
- **How I know (probe P8):** at Other (departments off, names on), `omgr`'s chart showed `names: "none"` with every holder name null, while `myManager()` returned "Other Boss Name".
- **What to do:** this may be intended, since the decision gives "Your manager" to action owners. Decide it and say so in `docs/authorization.md`, which today reads as if a manager at a client with departments off sees no names.

### 9. note: Arabic of the two new mails (`src/lib/mail-templates.ts:351-376`)

- "اقترح مسؤول لدى أحد عملائك تعديلًا على **هيكله** التنظيمي": "هيكله" refers grammatically to the admin, not the client. Write "على الهيكل التنظيمي للعميل".
- "وأجرِ التعديل في المسودة **إن رأيته**" reads as "if you see it". Write "إن وافقت عليه" (the English says "if you agree").
- Notification `org_chart_change_requested`: "اقترح {title} تعديلًا على هيكله التنظيمي" fails gender agreement when the client's name is feminine ("شركة ..."). Write "اقتراح تعديل على الهيكل التنظيمي لـ{title}".

### 10. note: claims the tests do not prove

- "Never grants access": the test (`tests/db/org-chart.test.ts`, `readable()`) compares actions, recommendations and indicators only, not documents or meetings. I checked by grep that no other rule reads the new tables (see below), but the test should cover files and meetings too.
- Untested: findings 2, 3, 5 and 6; concurrent cycle edits (sound, probe P4); a manager at a client with departments off; the masking list for a manager; that a mail and a notice carry no name (true today only because the templates take no parameters).

## What is sound

- **Snapshot holds no names.** `app_org_chart_snapshot_of()` 371-389 has units (incl. department names) and positions only; test checks no holder name in the JSON.
- **Raw holdings.** `position_holders` reads only for firm readers and the client admin (published lineages only). Every other role got 0 rows in each of the six tables in probe P5 and the tests: manager, owner, the consultant staffed on nothing, another client's three accounts. The same goes for `app_org_chart_holders`, `app_org_chart_named_positions` and `app_my_manager`. The functions return an unnamed holder with no id, person or dates.
- **Branch logic.** Down from the linked units, up through `reports_to`, plus the heads of the ancestor units. Only while names are on and departments are on; nobody at a minimal-records client.
- **Audit, notices and mails carry no name.** The audit meta holds the holder id, the day and a typed flag. Notices go to the lead and deputy only, not to whoever made the change.
- **Writes.**
  - The client admin and managers cannot change units or positions: RLS plus the triggers. Tests, and my unqualified UPDATE attempts, found 0 rows. A published version cannot change: the app has SELECT only on versions, the triggers freeze its rows, and `check_org_chart_version` freezes its published fields.
  - Probe P18: a holder at another client was refused by RLS (as `cadmin` and as the lead); a user of another organisation, or a firm user, was refused by the trigger.
  - Cycle checks hold in the service and the trigger, across versions, and under two concurrent opposite edits (probe P4: the second was refused with "cannot report to itself").
  - One draft and one current version: partial unique indexes plus the advisory lock.
- **Never grants access.** Outside the feature, only three things read the new tables: the firm admin's engagement fit count (`src/services/engagement.ts:104`), the masking list and `check_minimal_records()`. `app_dept_ok()` and the department policies are unchanged. The test shows what client people read is unchanged.
- **Migration.**
  - Every function has `SET search_path`. SECURITY DEFINER is used where a function reads across RLS. Internal functions (`app_org_chart_branch`, `snapshot_of`, `copy`, `app_mask_names`) are not granted to the app role. Grants are minimal: no DELETE on holders or suggestions, and no write on charts or versions.
  - `outbound_kind` and `app_work_mail_kinds()` keep every value from 0060, their latest earlier definition (0081-0089 do not touch them), and add the two new kinds.
  - After `0ba3751`, `app_mask_terms()` keeps 0087's refusal for action owners (probe P10: "the masking list is not for action owners"), and holder names reach `app_mask_terms_in()` through `app_mask_names()`.
  - The journal puts 0100 at idx 90, after 0089, with a later `when`. `drizzle-kit check` reports "Everything's fine", and `drizzle-kit generate` finds no schema changes.
- **Texts.** Every new key exists in both `ar.json` and `en.json` (scripted check: 0 keys only in one). The unit suite passes (37 files, 568 tests).

## Tests run

- `tests/db/org-chart.test.ts`: 28/28 at `b637d8d`, and passes at `0ba3751` (run together with `engagement.test.ts`).
- `tests/db/engagement.test.ts` passes. `tests/db/prospects.test.ts` fails 6/9 (finding 1).
- Full database suite at `0ba3751`: 74 files, 974 tests. 966 passed, 6 failed (`prospects.test.ts`), 2 skipped. `walkthrough-seed.test.ts` failed to load because the seed's `startPitch` hit finding 1. Nothing else failed.
- Unit suite: 37 files, 568 tests, all passed.
- Function settings, read from `pg_proc` (probe R3):
  - Every new or redefined function pins `search_path = public, pg_temp`.
  - `app_org_chart_branch`, `app_org_chart_snapshot_of`, `app_org_chart_copy` and `app_mask_names` cannot be executed by `selah_app`.
  - The trigger functions keep the default PUBLIC execute, as everywhere else in the schema. They cannot be called directly.

## What I could not check

- Screens, PDF and Excel (not in this part).
- How masking unmasks a model's answer, and whether a placeholder for a name the reader may not see could be printed back. This bears on finding 4's practical reach.
- Transaction isolation other than READ COMMITTED.
- Real mail delivery and quiet hours.
