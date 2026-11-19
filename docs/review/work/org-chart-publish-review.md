# Org chart, part 5 (publishing): adversarial review

Branch `feature/org-chart-publish`, commit `a7c65f8` on main `fec20f9`. Reviewed 19 Nov 2026 on `selah_test_r`, which was reset (schema `drizzle` dropped, `DROP OWNED BY selah_owner`) and migrated from empty. No code was fixed or committed. The probes ran as a temporary test file (`tests/db/zz-review-probe.test.ts`, with the setup copied from `org-chart-publish.test.ts`). It was deleted afterwards; a copy is in the reviewer's scratchpad.

## Verdict

**Not ready to merge: one blocking finding.** The access rules hold:
- No publish, holder change, leaving or import touches `department_members`.
- A head confirmation cannot be forged across clients.
- Plans stay with the firm's editors.
- The resolution link follows row-level security, including departments and "only" audiences.

The blocker is the new effective-date rule. It allows a back-dated version. Combined with part 3's dropped-position rule, a back-dated version silently deletes real holdings, current and past.

## Blocking

### B1. A back-dated publish deletes the holdings of the positions it drops, current and past

- **Where:** `drizzle/0250_org_chart_publish.sql:89` accepts any day on or after the current version's. `close_dropped_holdings()` (`drizzle/0097_org_chart_editor.sql:437-455`) then:
  - ends every holding that started by `effective_on - 1` on that day, rewriting history;
  - **deletes** every holding of a dropped position that started after that day.
- **Why it is new:** part 3's rule was written for "a holding that has not started yet". A future or today's effective date made "started after the day" mean "not started". Part 5 lets the day be in the past, so "after the day" now includes people who are in post today and people whose holding has already ended. The UI also offers the past: the date picker only disables days before `earliest` (`publish-form.tsx`).
- **Probe P2:** this is the timeline (today is 19 Nov):
  - v1 is published effective 20 Sep (−60 days).
  - The client's admin places "Clerk History" from 20 Oct to 9 Nov.
  - The admin places "Clerk Now" from 10 Nov, open. He is in post today.
  - The lead drops the clerk position in the draft and publishes v2, also dated 20 Sep. The new rule accepts this because it is the same day as v1.
- **Result of P2:**
  - Both holdings are gone (`clerk after: []`).
  - The audit keeps only `org_chart.holder_cancel {count: 2}`, with no holder ids.
  - The publish screen showed both as "cancelled", including the man in post today.
  - v1 now reads "past, replaced on 20 Sep 2026": it was never in effect.
- **A realistic case:** v1 dated 1 Jan. In November the lead records a June board decision as v2, dated 1 Jun.
  - Everyone who joined a dropped position after 1 Jun is erased.
  - Everyone in a dropped position before 1 Jun gets an end date of 31 May, although they actually stayed until November.
- **Breaks:**
  - Scenario 20: "the history keeps the leaver's dates".
  - The service's own promise: "Nobody's history is deleted: a holding ends" (`org-chart.ts`, `changeHolder` doc).
  - The rules.md row for publishing, which says only a holding *not started* is removed.
- **Fix (pick one, with a test):**
  - Make the earliest day `max(current.effective_on, today)`.
  - Or keep back-dating, but have `close_dropped_holdings()` treat "not started" as `from_date > greatest(e, app_firm_today())`, and end, never shorten, holdings that started before today.
  - Either way, a holding that has already started must never be deleted by publishing.
- **Side effect of back-dating:** plans are also placed from the back-dated day (P1: Outsider and Newbie placed from 20 Sep). So someone who joined the client last week appears to have held the position since September.

## Should fix

### S1. Publishing puts a second person in a one-person position

- **Where:** `0250:101-108` inserts each 'place' plan as a new open holding. `changeHolder()` behaves differently (`org-chart.ts` ~1285): on a position planned for one person, it ends the current holder the day before. The 'holds' outcome only checks for the *same* person.
- **Probe P2:** Newbie holds the treasurer position (planned count 1). Bob Typed is planned for it in v2.
  - After publishing, the position has two holders today: `["Newbie Person","Bob Typed"]`.
  - The screen showed Bob as "placed" and said nothing about Newbie.
- **Fix, either:**
  - apply the hand-over rule (end the other holder the day before, listed on the screen);
  - or add an outcome such as 'filled' (skipped and listed) when the position is already at its planned count on that day.

### S2. Two holders of a linked head position make a suggestion that never settles

- **Where:** `headSuggestions()` (`org-chart.ts:1847-1862`) raises one suggestion per holder who is not a head. `confirmHeadSuggestion()` (`:1879`) then removes the head flag from every current head.
- **Probe P5:** the CFO position (planned count 2) is held by Outsider and Finance Manager.
  - Confirm Outsider: Outsider becomes head, and the suggestion "Finance Manager, now headed by Nawaf Outsider" appears.
  - Confirm that: Finance Manager becomes head, Outsider loses the flag, and the suggestion for Outsider is back.
  - The card can never be cleared, and each click undoes the previous one.
- **Fix:** when the head position has several holders, either:
  - offer to add the holder as an *additional* head without removing anyone;
  - or suggest only while *none* of the position's holders is a head.

### S3. A person who left today is still suggested as head, and confirming gives a raw database error

- **Where:** the leaving sets `to_date = today`. `app_org_chart_holders()` counts `to_date >= day`, so the leaver still "holds" the position all day.
- **Probe P4:** the leaver is placed in the CFO position and the account is switched off.
  - The suggestion "Leaver Person" is still listed.
  - Confirming fails inside `check_department_member()` with `Failed query: insert into "department_members" … | department members are active people of the client`.
  - `orgChartError()` has no key for this, so the admin sees an English database message, or a generic error.
- **Access:** no access was granted; the database held.
- **Fix:**
  - In `headSuggestions()`, keep only holders who are active members of the client, and exclude holdings ending today.
  - Map a refusal to `suggestion_gone`.

### S4. Tests that are missing for rules this part promises

- **Resolution link:** `getStructure().resolution` and its use in `structure-body.tsx` have no test at all.
  - The only resolution test uses a non-existent id, which the database refuses on its own. So the service's "the publisher may open it" check (`org-chart.ts:1155`) can be removed without any test failing.
  - My probe P6 shows the behaviour is right:
    - A file of another department gives `null` for a Finance manager, and the title for the client's admin, the lead, the staffed consultant and the observer.
    - With an "only these people" audience (the client's admin only), the manager gets `null` and the firm keeps it.
  - Nothing pins either result.
- **Cross-client head confirmation:** no test. P3 shows it is right:
  - Other's admin gets `[]` and `forbidden`.
  - Sahm's admin naming OTHER gets `forbidden`.
- **"Nothing changes on its own" through a publish:** only `changeHolder` is tested. P1 shows that a plan placed in the linked head position by publishing leaves `department_members` unchanged.
- **The answered-request notice:** the rule "while they are still one of its people" (`0250:130`) has no test.
- **The leaver test:** it deletes the membership row instead of switching the account off (`active = false`). That is not how a person leaves.

## Notes

- **N1. The audit and the answer are worked out outside the lock.**
  - Where: `publish()` computes `planned` (`org-chart.ts:1156`) before `app_publish_org_chart` takes the chart lock and works out its own list.
  - Effect: if a leaving or a plan change lands between the two, the service's `org_chart.publish` audit row and the `placed`/`skipped` it returns can differ from what the database did. The database's own `org_chart.plan` row is right.
  - Fix: return the counts and outcomes from the function.
- **N2. "The draft the publisher checked" is checked only by id.**
  - A staffed consultant can add a plan or drop a position between the preview and the click.
  - The publish still goes through with the same `draftId`, and the toast does not say what changed.
  - This is the same draft-id design as part 1. Worth a version stamp, or listing `placed`/`skipped` after publishing (the API returns them but the form ignores them: `publish-form.tsx` `submit()`).
- **N3. Only the 200 newest files are allowed as the resolution.**
  - Where: `resolutionChoices()` `.limit(200)` (`org-chart.ts:1054`) is used to *validate* the resolution, not only to list choices.
  - Effect: at a client with more than 200 shared files, an older valid resolution is refused with `resolution`.
- **N4. "Your manager" and the head suggestion read the version marked `published`, even before it takes effect.**
  - This applies to `app_my_manager()` and `headSuggestions()` (through `getPublishedChart`).
  - So while v2 is upcoming, the menu header can show v2's reporting line before it takes effect. `versionStatus()` treats v1 as current until then.
  - This comes from part 1 (review N6 of the tree), but part 5 puts it in every page's header.
  - The names rule itself holds: the name is shown only with show names on or for the client's admin (tested).
- **N5. The focus picker can navigate on every arrow key.**
  - Where: `org-tree-view.tsx:114` navigates on `onChange` of a native select. In Chrome on Windows, the arrow keys on a closed select change its value, so a keyboard user moves through the departments with one server navigation per key.
  - Fix: navigate on a "Show" button, or on blur or Enter.
  - Fold buttons, pan (physical, correct in RTL by construction) and zoom are fine. The PDF has no tools markup: `orgChartDocument` calls `orgTreeHtml` without `tools` (`org-chart-html.ts:334`), and a unit test pins it.
- **N6. A demoted suggester gets a dead link.** If the suggester is later moved to client manager, they still get the answer notice. The link goes to `#suggestions` on a page that no longer lists suggestions for them. This is harmless.
- **N7. The migration is numbered 0250.** It is not 0101. The docs say the lead renumbers it at merge; the journal order must be checked then.
- **What holds, checked:**
  - Who publishes: the firm admin, the lead and the deputy. Everyone else is refused by the service and the database (tested).
  - A draft id of another client or an unknown draft is refused.
  - Two publishes race safely: advisory lock, `FOR UPDATE`, then the id check. A plan insert waits on `FOR SHARE` of the version and is then refused.
  - Every plan is cleared after publishing, and none is carried to the next draft.
  - The plans' outcomes are given to the draft's editors only.
  - Audit rows and notices carry counts, never names.
  - A planned person who joined another client is skipped as 'left': `org_memberships.user_id` is unique, so the org check covers it.
  - A plan for a dropped position cannot exist: plans live on draft positions only.
  - The show-names switch is the client's admin's only (tested). The switch is offered only on the current version.

## Check results

| Check | Result |
|---|---|
| `npx eslint .` | clean |
| `npx tsc --noEmit` | clean |
| `vitest run` (unit) | 55 files, 869 passed, 2 skipped |
| `vitest run --config vitest.db.config.ts` on `selah_test_r` | 84 of 86 files passed; 1236 passed, 2 failed |
| The 2 database failures | `assistant-chats` "deletes 90 days after the project closes", `transcripts` "go at once when consent is withdrawn". **They fail the same way on main `fec20f9`** (re-run there): date-dependent retention tests, not this branch. |
| `org-chart-publish.test.ts`, `org-chart-import.test.ts` | pass |

| Probe | Shows |
|---|---|
| P1 | A back-dated v1 with a plan in the linked head position: placed, `department_members` unchanged, the suggestion shown |
| P2 | B1 (both clerk holdings deleted by a back-dated v2) and S1 (two holders in a one-person position) |
| P3 | Cross-client head confirmation: `forbidden` both ways |
| P4 | S3 (a leaver suggested; raw database error on confirming) |
| P5 | S2 (the suggestion keeps undoing itself) |
| P6 | The resolution link follows departments and "only" audiences (correct, untested) |
