# Batch 3 review: the project page around the plan (branch `batch3/project-page`, f7bcbce)

Independent adversarial review, 19 Nov 2026. Read: the build brief, page audit 4.3 / section 5 batch 3 / sections 6-8, `docs/authorization.md`, the full diff `fbac962...batch3/project-page`, the old page at fbac962. Probed against `selah_test_d` with temporary database tests, since deleted. Nothing fixed, nothing committed.

## Verdict

**Mergeable once the "Should fix" items are settled. Nothing blocking found.** The new aggregations hold up for every reader I probed: drafts (D6), other departments (D8), other owners (1b), label-hidden files, observers and consultants staffed elsewhere all stay out. They hold because every part reads through the caller's row-level security. The weak spots are a Closing tab that goes beyond the audit's rule, a heavy page load, a few screen-standard and wording faults, and tests that leave the risky paths unchecked.

## Blocking

None.

## Should fix

1. **Closing stays as a tab for good after any answered request.** `lib/project-tabs.ts:53` shows Closing when `c.request !== null`, and `getClosure` returns the latest request whatever its status. Audit 4.3 says Closing is a tab "while closing, closed, or while a request to close **waits**".
   - Probe: on an active project, one *declined* request (`project_closure_requests.status = 'declined'`). Every reader then gets `plan,files,meetings,progress,people,closing`: the firm admin, the client admin, the Legal-only manager, and the action owner (who never asked).
   - The builder chose this so the client can read the firm's answer. In practice, a request declined in month 2 puts Closing on the page of an active project for the rest of its life, for everyone on it.
   - Fix: decide which it is. Either limit the tab to a `pending` request (and say where the answer is read), or keep it and record the choice against the audit.

2. **The page now reads every action the reader can see, on every project, on every load.** `services/action-board.ts:433` calls `loadReadable()` with no project filter and then filters in JavaScript. For firm staff, `deviations: true` also reads `v_deviations` for every action the reader can see (`action-board.ts:115-118`), plus a second `v_deviations` query (`:457`).
   - Scenario: a firm admin with a few thousand actions across clients opens any project and pays for the whole firm's board.
   - An old `?tab=` address does all of this, and the other ~20 service calls, twice: `page.tsx` loads everything, then redirects, then loads everything again.
   - Fix: add a project filter to `loadReadable` and the deviations query. Redirect before the load: `oldTabTarget` needs only `principal.orgKind`.

3. **The full evidence map is sent once per recommendation card.** `page.tsx:497` passes `evidence={evidence}`, the whole `Record` for the project, to every `PlanActions` client component. The RSC payload grows with cards × actions. No leak: it is all the reader may see. Pass each card only its own actions' entries.

4. **Screen standard: a visible Remove is left on People.** `client-roles-card.tsx:77` still draws a ghost "Remove" `ApiButton` on every client-role row (sponsor, coordinator, ...). The same tab moved staff and people removal into the row menu (`RemoveFromProject`). Scenario: a client admin's People tab mixes ⋯ menus and visible Remove buttons. Move it into `RemoveFromProject` / a `RowMenu`.

5. **Wording, Arabic first.**
   - `projectPage.rules.why.slipped` and `rules.why.churn`: «تأجّل موعده {n} مرات» / «أُعيد للتعديل {n} مرات» do not inflect for the count ("2 مرات" should read «مرتين»; 11 and up should be «مرة»). Every other count string here uses ICU plurals.
   - `status.verifiedNone`: the English "No actions released yet" uses the firm's word "released" on a client screen (plain-labels rule), while the Arabic says «مُسندة» (assigned). The two languages say different things. Use the client's words in both (for example a `…Client` key).

6. **Tests do not cover the risky paths.** The new suites pass, and one mutation was caught (see Checks). These are untested:
   - **`planEvidence` relies on row-level security alone** (`queries.ts:482`, no `authorize()`, no audience check in the service, unlike the `documents` list in `getProject`). No test has a file on an action the reader *can* open but the file they *cannot*. Every evidence test uses actions the reader cannot open at all, so the action filter, not the file rule, does the work.
     - My probe: a `firm_private` evidence file on the Legal "Late canary" action is listed for the lead and hidden from the client admin, the Legal manager and the owner. So row-level security holds today; nothing pins it.
     - Add that case. Also add a narrowed (visibility picker) document, which evidence cannot be today (trigger `evidence_not_narrowed`); a test would keep it so.
   - **`projectConsultants`: no consultant is staffed on *another* project of the same client** (the lead dedups everywhere). My probe: staffing `obs` on the closing project only gives the main project `["cons"]` and the closing project `["obs"]`. Correct, but untested.
   - **Old-tab redirects: tested only by a regex over `page.tsx` source** (`tests/project-page.test.ts`, "the page sends an old address on…"), not by behaviour per role.
   - **No test for a declined or answered request** (item 1), and none for a person left out of a meeting by the picker on the new Meetings tab. The list is the existing `listMeetings`, so the risk is low.

## Notes

- **Privacy, probed: nothing shown that should not be.**
  - Status line and chips (`projectAttention`): for the Legal manager they hold no Finance action. A client gets only `late` and `blocked` reasons (P6: the client admin sees Finance's late/blocked; the manager does not). The firm's stale, slipped, churn and orphaned reasons are never loaded for a client (`deviations: firmRules`).
  - Status share: matches the reader's own Progress numbers (manager 1/5 = 20 %, client admin 1/6 = 16.7 %). Owner 1/4, own actions only.
  - "Since your last visit": `app_changed_actions` is SECURITY INVOKER. The Legal manager's list has no Finance action and no draft.
  - Finding lines: the assessment title comes through the `assessments` row policy, which shows clients only final, shared assessments, and admins and managers only. Owners cannot read findings at all (`finding.read` is `ALL_BUT_OWNER`).
  - Review lines: show the outcome and date, never `reviews.reason`.
  - `projectConsultants` / `app_my_consultants`: leaves out observers and inactive members, filters by project in JavaScript, and adds the client's lead and deputy, the same people Help already lists.
- **Redirect after load (question 3): no leak.** `getProject` throws `NotFoundError` before anything else runs, so an outsider gets the same 404, as quickly as before, whatever the `?tab=`. Even an unconditional redirect would leak nothing, because it points at the same project URL. The ordering only costs a double load (Should fix 2).
- **Nothing lost: each old tab has a place.** Recs and Trace map to Plan; Needs attention to chips; Assessments to Sources (firm) or Requests and files (client); Requests and Documents to Requests and files; Activity to the foot of Progress; Team to People; Handover to Progress; Closing to its own tab or the menu. Gaps, both small:
  - Trace's "replaces the action above" now exists only from the old action ("Replaced by", `actions/[id]/page.tsx:158`). The new action does not say what it replaces (audit-review item 32 asked for this to be said).
  - The old Closing tab's explanation on an active project (`hintActive`, `hintActiveClient`) is gone. The menu item has only a confirm.
- **Action owner: four tabs is consistent with the old page.** The owner had no Progress before either. Owners still get no "since your last visit" (`sinceLastVisit` refuses `action.read` for them, and the page swallows the error). This predates the branch, but the line is now part of the page design.
- **Unanswered findings:** a finding answered only by a *withdrawn* recommendation is drawn under the withdrawn card and never in the "no recommendation yet" group. The old page counted it as answered by 0.
- **Defence in depth:** `projectConsultants` skips `authorize("help.read")`. Every client role has it today, so this is not a leak, but the service comment says each part is "checked again with authorize()".
- **Dead code:** `projectDeviations()` in `services/insight.ts:48` has no caller left. The SQL function `app_trace()` stays granted to `selah_app` with no route. Harmless; drop them in a later migration.
- **E2e:** the e2e files were updated for the menus and tabs. They were not run (they need the whole stack).

## Checks (on `selah_test_d`, reset and migrated from empty)

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` | 52 files, 781 passed |
| `npm run test:db` | 83 files, 1156 passed (965 s) |
| Mutation: `planRulesFor(firmRules)` changed to `planRulesFor(true)` in `projectAttention` | 2 tests in `tests/db/project-page.test.ts` fail, as they should; reverted |
| Probes P1-P7 (temporary file, deleted) | firm-only evidence hidden from client readers; "since last visit" by department; status share = Progress; declined request keeps Closing for all (Should fix 1); consultant on another project not named; firm reasons absent for clients |
