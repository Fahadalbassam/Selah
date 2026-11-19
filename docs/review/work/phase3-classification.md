# Phase 3, area 2: classification

Assessor's report, 19 Nov 2026, against `origin/main` at 4ffb703 (#190). I checked; I fixed nothing.

**How I checked.**
- Worktree: `C:\Projects\selah-fresh\.claude\worktrees\phase3-classification`.
- Database: `selah_test_t`. It was stuck partway through an old migration, so I dropped it, recreated it, and ran all migrations.
- I did not start the app. Every proof is a database or service test run as the wrong user.
- The proof file is `docs/review/work/phase3-classification-proofs.test.ts`. To run it, copy it to `apps/web/tests/db/` and use `npx vitest run --config vitest.db.config.ts tests/db/<file>`. All 10 proofs pass, and each pass means the problem is real.
- I also ran 14 existing suites as a baseline: audience, ai-sources, file-controls, info-requests, privacy-leaks, export-pack, status-pack, upload-links, client-assistant, rls, engagement, private-recommendations, audit-log and metrics. All 277 tests pass.

## Proven leaks (most important first)

### L1. A client person sees the title of a firm-only action in the "leaving person" report
- **What happens.**
  1. The lead releases an action under a firm-only recommendation, with a client person as owner. RLS allows this (proof 1). The client side still cannot read the action.
  2. The client admin opens that person's departure dialog on the Team page.
  3. They see the action's title.
- **Why.** `app_person_holdings_of` is SECURITY DEFINER (`drizzle/0076_drafts_hidden.sql:247`). It drops drafts for clients but never checks the recommendation's label. The route is `api/people/[id]/holdings` → `services/accounts.ts:276` → `team/departure-dialog.tsx`.
- **Proof.** Proof 2: `app_person_holdings(owner)`, run as the client admin, returns "Firm-only canary".
- **What the user would notice.**
  - A client admin can read the title of work the firm is keeping private, for example under a "merge two divisions" recommendation.
  - The same item blocks switching the person off, and the client cannot see why.
- **Risk.** High. It is a title, on a screen, in the restructuring case that feature A was built for.
- **Suspected, not proven.** `app_hand_over` (0034) works on the same list. So a client admin may be able to move the firm-only action to someone else.
- **Proposal.** Small. For a caller at the client, add `app_recommendation_label_ok` (and the action's department) to the action and review branches. When the client admin cannot see an item, it should not block them; the firm sorts it out instead. Add a deny test.
- **Recommendation.** Build now.

### L2. The audit log shows the firm admin the name of a client-private file
- **What happens.**
  1. A client person withdraws a wrong upload (N8).
  2. `withdrawDocument` writes `meta: { title }` to the audit log (`services/documents.ts:279`).
  3. `app_audit_entries` gives the firm admin every row with its meta (`drizzle/0023_audit_trail.sql:213`).
  4. The Audit page prints every meta key (`app/(app)/audit/page.tsx:157`). The CSV export does the same (`services/audit-log.ts:151`).
- **Proof.** Proof 4: the firm admin cannot open the file (0 rows), but reads `title = "Salary scale 2027 (client private).pdf"`.
- **Who else.** The same applies to a file a department rule or an audience (feature A) hides from an admin.
- **Risk.** Medium to high. Only the file name, but names like "salary scale" or "disciplinary – X" are the sensitive part.
- **Proposal.** Small. Drop the title from that audit row; the id is enough. This is the only audit write I found that carries a title (I searched every `audit()` meta).
- **Recommendation.** Build now.

### L3. The activity record keeps a withdrawn file's name under the wrong label, both ways
- **What happens.**
  - `app_withdraw_document` stores a `document_withdrawn` event with `meta.title` and `meta.reason` (`drizzle/0018_withdraw_file.sql:66`).
  - It sets no label, so the event defaults to `shared`.
  - No policy on `activity_events` re-checks a document's label. Only actions have that check (0078:297).
- **Proof.** Proof 5:
  - The firm reads the name of the client-private file.
  - The client admin reads the name and reason for a firm-only file the lead withdrew.
  - The client admin's Activity tab lists the event (`document_withdrawn`, by a firm person). The screen does not select `meta`, so today the name is one query away, not on screen.
- **Risk.** Medium. The database's second line of defence is wrong here, and events are append-only, so a bad row stays.
- **Proposal.** Small.
  - Write the event with the file's label.
  - Leave the title out of the event.
  - Add a restrictive "document label" policy on events, like the one for actions.
  - A migration cannot fix stored events, because they are append-only. It can blank the title through the owner's purge path, or the new policy can hide the old rows.
- **Recommendation.** Build now, with L2.

### L4. Report numbers the firm froze count firm-only work, and the client reads them
- **What happens.**
  1. `snapshotReport` and `issueStatusPack` freeze `projectProgress()` as the firm user (`services/follow-through.ts:447`, `services/status-pack.ts:83`).
  2. `app_project_progress` (`drizzle/0079_received_on_firm_day.sql:42`) runs with the caller's own rights and has no label filter, so it counts actions under firm-only recommendations.
  3. Once the report is shared, the client reads `reports.metrics`. The PDF prints it too (`services/exports.ts:260`).
- **Proof.** Proof 3: the client's own live numbers are total 2, open 2, overdue 1. The shared report the client reads says 3, 3, 2.
- **What is fine.** The lists inside the pack already keep to shared recommendations (`app_status_pack`, 0050:24), so no titles leak.
- **What the user would notice.**
  - The monthly report says "3 actions, 2 late". The client's own plan shows 2 actions and 1 late.
  - A careful client sees that the firm is tracking hidden work.
- **Risk.** Medium. It reveals that firm-only work exists and how many items there are, and the client's documents disagree with each other.
- **Proposal.** Small. Freeze the numbers as the client would see them: count only actions under shared recommendations.
- **Recommendation.** Build now. It also helps area 4 (the numbers must agree).

### L5. The monthly history on the Progress tab counts firm-only and other-department actions
- **What happens.**
  - `app_snapshot_metrics` runs as the owner, so with no RLS (`drizzle/0000_baseline.sql:2683`, the `metrics` job).
  - `metric_snapshots` can be read by anyone who sees the project.
  - `projectMetrics()` (`follow-through.ts:572`) sends that history to the client's Progress tab (`progress-tab.tsx:241`).
- **Proof.** Proof 6: a Finance-only manager reads live totals of 1 action and 0 late. The history beside them says 3 actions and 2 late, because it includes the Board action and the firm-only one.
- **Risk.** Medium. Under D8 counts are not titles, but firm-only counts reach the client, and the chart contradicts the live number.
- **Proposal.** Medium. Either store a client-side series (shared recommendations only) and a firm series, or hide the stored history from client readers until it is split. Department-limited readers would need a series per department, or no history.
- **Recommendation.** Build now in its simplest form: no stored history for client readers. A proper per-side series can come after the scenarios.

## Other proven problems (not a leak to another party, but the wrong person can change a label)

### C1. A file answering a confidential request reaches the assistant through a new version
- **The rule.** A file answering a confidential request stays out of the assistant. Two triggers enforce it (`drizzle/0016_info_requests.sql:158` and `:186`).
- **The gap.** Both triggers look only at files listed on `info_request_files`. A new version is never listed there (`uploadNewVersion`, `services/documents.ts:211`).
- **Proof.** Proof 7:
  1. Switching on the first version is refused.
  2. The client admin uploads v2 and switches it on.
  3. The indexing job indexes it.
  4. The lead's assistant search returns the text "the board approved the merger".
  5. Nothing links v2 to the confidential request.
- **What the user would notice.** Nothing on screen, which is the problem. The request hint ("the assistant will not read the file you send for it", `messages/en.json:4141`) becomes untrue. With the hosted model, that text is sent off the server (masked names only).
- **Risk.** Medium to high for board minutes, financials and family-ownership files. These are exactly the items the starter list marks confidential (`lib/info-requests.ts:33-52`).
- **Proposal.** Small. Treat the whole version chain as answering the request, in both triggers, so a new version inherits the confidential lock. Add a test.
- **Recommendation.** Build now.

### C2. A client manager switches on the assistant for any client-owned file she can see
- **What happens.** `document.manage` gives `client_manager` scope `owner_org` (`authz/policy.ts:236`). The database checks only "same organisation" (`check_document_manage`, `drizzle/0005_file_controls.sql:13`).
- **Proof.** Proof 8: a manager switches on the AI flag for an "HR grade structure" file the client admin uploaded.
- **Risk.** Medium. The docs say "the organization that owns the file controls the flag". In practice that means any manager, not the person or the admin who uploaded it.
- **Question for Fahad (recommended answer: yes).** Should the flag on a client file belong to its uploader and the client admin only?
- **Proposal.** Small: one policy line, a matching database check, and a test.
- **Recommendation.** Build now if the answer is yes.

### C3. The database lets a reader rename or refile someone else's file
- **What happens.** The `scoped` policy on `documents` is `FOR ALL`. `check_document_integrity` freezes bytes, owner and purpose, but not `title` (except on evidence) or `department_id`.
- **Proof.** Proof 10: a Finance manager renames the client admin's file and refiles it into Finance. Refiling also hides it from other departments.
- **Scope.** No screen or route does this, so it is a weakness in the database's second line of defence only.
- **Proposal.** Small. Allow title and department changes only for the uploader or the owning side's admins.
- **Recommendation.** Build after the scenarios, or now with C2 since it is in the same file.

## Suspected (read in the code, not proven)

| # | What | Why it is only suspected | Effort |
|---|---|---|---|
| S1 | `app_hand_over` lets a client admin move a firm-only action to someone else (follows from L1) | Not run | small, with L1 |
| S2 | Notices go to the whole firm team without a per-person label check (`app_notify_project_team`, 0087:12; `app_tell_owner_changed`, 0104:7). They carry no text, only the kind and the time. | Only reachable with `user_private` recommendations, which no screen creates | leave |
| S3 | `app_second_review_state` (0081:206) answers about another department's action, or one under a firm-only recommendation, when given its id | Returns codes and a reviewer name, not a title; an id is needed | small, after scenarios |
| S4 | The indexing job takes files with scan status `skipped` whatever `SCAN_REQUIRED` says (`scripts/index-documents.ts:39`); download checks it (`services/scan.ts:31`). A file never scanned in development stays readable by the assistant after production turns scanning on. | Configuration-dependent | small |
| S5 | An export pack built by the firm admin silently leaves out the client's private files (RLS hides them), so the client gets an incomplete pack with no warning | Not a leak: an incomplete hand-back | small: say so on the pack |
| S6 | A shared status pack keeps an item after its recommendation is withdrawn | Frozen on purpose; not run | leave, or note |
| S7 | Activity events of recommendations and findings copy the label when written; old events would not follow a later change | Labels only widen (firm-only to shared), so no leak today | leave |
| S8 | A meeting's label can change at database level after client attendees were added (no trigger stops it), and the mail check (`app_meeting_mail_ok`) does not look at the label | No route changes a meeting's label (`api/meetings/[id]/route.ts` has no visibility field) | leave; note for the future |

## What works today (with proof)

**Defaults on upload**
- Firm upload: the Files card offers "firm only" first (`components/file-explorer.tsx:188`; `services/files.ts:467` lists the labels per side).
- Client upload: shared, or client-private. In a restricted engagement it is forced to client-private by the database (`check_document_label`, baseline:4713; `engagement.test.ts`).
- Internal projects: firm only.
- Evidence is always shared (`services/evidence.ts:139`).
- A file answering a request must be shared (0016:158). Upload-link files are stored as shared, client-owned (0057).
- Schema default is `firm_private` (`db/schema/app.ts:819`).
- The AI flag is off by default (`:821`).
- Requests start as "standard"; the starter list marks 11 items confidential (`lib/info-requests.ts`).

**Who can change a label**
- Only the owning side changes a file's label or AI flag (0005:13).
- Sharing is one-way: firm-only to shared, and client-private to shared by the client admin only.
- A new version keeps its label and department (0005:47).
- Evidence is never relabelled or versioned.
- Only the firm edits a request's sensitivity (0016 `check_info_request`).
- Source tests: `file-controls.test.ts`, `info-requests.test.ts`.

**Index and retrieval**
- A file's passages are dropped when its label changes, its flag goes off, it is archived or deleted (baseline:1807), or it is refiled (baseline:4921).
- Each passage takes its department from the source when written (baseline:4890).
- A passage is returned only while the reader can open the file or record live, through restrictive policies: `with_source` (baseline:7095) and `audience` (0095:810).
- Because of that, a label narrowed during indexing cannot widen access.
- The assistant's search puts label, department, audience and draft checks inside the query (`services/assistant.ts:483`).
- Action owners get no retrieval (`authz/retrieval.ts`).
- Source tests: `ai-sources.test.ts`, `client-assistant.test.ts`, `rls.test.ts`.

**Display and export**
- Files card and download: read under RLS, then `authorize()`, then the scan gate (`services/documents.ts:116`).
- Plan and actions workbooks, client report PDF, closure report PDF: read live as the reader (`services/exports.ts`).
- Status-pack lists: shared recommendations only (0050:24).
- Export pack: shared and client-private labels plus audience (`services/export-pack.ts`).
- Meeting invitations: firm-only meetings refuse client attendees and contacts (`check_attendee`, baseline:4318).
- Org chart work card: read as the viewer (`services/org-chart.ts` `personWork`).
- Mail templates carry no titles.
- Source tests: `privacy-leaks.test.ts`, `status-pack.test.ts`, `export-pack.test.ts`, `audience.test.ts`.

**Audience picker ("everyone except" / "only")**
- Restrictive policies on documents, meetings, chunks, activity events and notifications (0095).
- Enforced in the definer functions it names.
- Its own suite passes.
- I found no path that widens access. L2 and L3 also reach a left-out person only for the audit page and the raw event row, which are the same holes.

## Order I recommend

1. Build now: L1, L2 + L3 (one pull request), C1, L4.
2. L5 in its simplest form (no stored history for clients).
3. C2 if Fahad says yes.
4. After the scenarios: C3, S3, S4, S5.
5. Leave: S2, S6, S7, S8.

Every fix needs a deny test that fails first. The proof file already holds one for each problem.
