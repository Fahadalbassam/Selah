# Review: PR #193, `fix/classification-leaks` (f4ddb14)

Independent adversarial review, 19 Nov 2026. I read the branch and did not change it.

**What I ran**
- Database `selah_test_r`. I emptied it (dropped only objects owned by `selah_owner`), then ran `scripts/migrate.ts` from empty. Every migration applied, 0106 included.
- The full DB suite: `TZ=UTC npx vitest run --config vitest.db.config.ts`. 89 files and 1316 tests pass.
- Unit tests: 65 files, 1018 pass, 2 skipped. `tsc --noEmit` is clean.
- A reviewer probe against `selah_test_r`, kept outside the repo at `<scratchpad>/lr-probe.cjs`.

**Migration chain.**
- 0106 comes after 0105 in the journal (idx 106), and its `when` is later.
- The `0106_snapshot.json` prevId equals the 0105 id. The body is identical to 0105, as it should be: no table changes.
- No audit or activity rows are rewritten.
- The migration is not idempotent: plain `CREATE FUNCTION`/`CREATE POLICY`/`CREATE TRIGGER` and `DROP FUNCTION` with no `IF EXISTS`. That is normal for this repo, because drizzle runs each migration once.

**Grep.** The diff has no partner-firm name ([partner firm] / [partner firm]), no real names and no keys. The test fixtures use `example.test` addresses.

## Blocking

### B1. C1 is not closed: the client admin can unlink a version from its chain and switch the assistant on
- **Where.** `drizzle/0106_classification_leaks.sql:189` (`app_document_chain`) and `:217` (`check_confidential_file`).
- **Why it fails.** The new rule follows `documents.supersedes_id`. Nothing freezes that column on UPDATE:
  - `check_document_integrity` (baseline) leaves it out.
  - `check_document_version` (0005) fires on INSERT only.
  - The `scoped` policy on `documents` is FOR ALL.
- **Proof (probe, run as the client admin, each statement committed).**
  1. v1 is attached to a confidential request, and v2 supersedes v1.
  2. `UPDATE documents SET ai_indexable = true WHERE id = v2` is refused ("a file answering a confidential request…"). Good.
  3. `UPDATE documents SET supersedes_id = NULL WHERE id = v2` succeeds.
  4. `UPDATE documents SET ai_indexable = true WHERE id = v2` now succeeds (`ai_indexable: true`). The indexing job then indexes it, which is exactly what proof 7 of the assessment showed.
- **Same weakness, wider.** The firm lead could also run `UPDATE documents SET supersedes_id = NULL` on the client's v1. So any reader can rewrite another side's version history.
- **Scope.** No screen does this, so the hole is in the database's second line of defence only, the same class as C3. But the PR and `docs/rules.md` now promise "in every version", and the chain is the whole mechanism.
- **Fix (small).** Make `supersedes_id` immutable after insert: add `NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id` to `check_document_integrity`, or to the new rename trigger, for `selah_app` callers. Add a deny test: unlink, then switch on.

## Should-fix

### S1. Data written before this PR keeps leaking (L2 and C1); only L3's old rows are handled
- **L2.** Existing `audit_log` rows for `document.withdraw` still carry `meta.title`. `app_audit_entries` (0023:213) still returns them to the firm admin, and the Audit page and CSV print them (`app/(app)/audit/page.tsx:157`, `services/audit-log.ts:151`). The fix only stops new rows.
  - A read-time redaction keeps "no rewrite" intact: strip `meta - 'title'` for `action = 'document.withdraw'` inside `app_audit_entries`.
  - The test (`classification-leaks.test.ts`, "the audit row keeps the file's id") checks only a row written after the fix.
- **C1.** A later version of a confidential answer that is already `ai_indexable` stays on, and stays indexed, after the migration. The new triggers only stop future switches.
  - A one-off `UPDATE documents SET ai_indexable = false` on chain members of confidential answers is not an audit or activity rewrite. Its trigger drops the passages.
  - Alternatively, list affected rows in the PR so the firm can check the pilot data.
- **L4.** Reports already frozen and shared keep their firm-side numbers. They cannot be changed, which is acceptable, but say so in the PR or release notes.

### S2. The firm's report PDF now disagrees with itself
- **Where.** `services/exports.ts:227-322` (`reportPdf`).
- **What happens.** The PDF prints the frozen numbers (now client-side) beside `listActions(...)`, read live as the reader.
- **Concrete case.** For the firm, the header says 2 actions and 1 late, and the list below shows 3 actions, firm-only titles included. That is the same contradiction L4 set out to remove, now on the firm's copy.
- **Bigger concern.** It is also the copy a consultant is most likely to download and hand to the client. The firm-only titles in that list are an old route to the same data (the report PDF as the hand-over to the client), not something this PR introduced. But this PR makes the report "for the client", so the list should follow the frozen numbers.
- **Fix.** For a shared report, or a status pack, filter the list with the same `client_side` rule. At least label the live list as including firm-only work.

### S3. A firm-only action owned by a person the client admin switches off is left with nobody, unannounced
- **Where.** `drizzle/0106_classification_leaks.sql:22` (now also via `check_departure` and `app_hand_over`).
- **What happens.** This is by design: the action no longer blocks the client admin. But the firm learns about it only if someone opens the departed person's report, or the "no active owner" deviation filter.
- **What to do.** Notify the client's lead consultant when a deactivation leaves open firm-only work, or at least confirm in the PR that the deviation list is the agreed signal. The test proves the action stays with the old owner. It does not prove the firm can then hand it over.
  - I checked that `app_can_manage_person` lets the firm admin manage the client person, and that `app_hand_over` needs an active target in the client org. So it can be settled, but no test covers it.

## Notes (checked, no change needed or low risk)

1. **SECURITY DEFINER hygiene is fine.**
   - Every new or replaced definer has `search_path=public, pg_temp` (checked in `pg_proc.proconfig`).
   - `app_document_chain` and `app_document_answers_confidential` have no EXECUTE for `selah_app` or PUBLIC (probe: "permission denied").
   - `app_document_label_ok` is granted to `selah_app`. It answers true for an unknown id and the label answer for a known one, so it is a yes/no oracle that needs a uuid. That is the same shape as `app_recommendation_label_ok`. Acceptable.
   - `check_document_rename` is SECURITY INVOKER with no `search_path`. That is fine, because it runs with the caller's own rights.
   - `app_project_progress` (INVOKER) has PUBLIC EXECUTE again after the DROP/CREATE, as the baseline did. Harmless.
2. **The rename trigger does not stop the database's own moves.**
   - `app_move_department_work` (0078) and `check_evidence_document` (baseline:4693) are SECURITY DEFINER, so `current_user` is the owner.
   - Foreign-key SET NULL actions run as the table owner too.
   - Jobs have no `app_uid()`.
   - The department suites pass. It does depend on the literal role name `selah_app`. A future login role that inherits `selah_app` would bypass it, which is worth a comment.
3. **The `document_label` policy is RESTRICTIVE, FOR SELECT, `TO selah_app`.** That is correct, and nothing inserts document events from the app role.
   - It hides from the firm only events about client-private files (and someone else's `user_private` ones). It does not hide too much: the firm's department check passes (`app_dept_ok` is true for the firm).
   - The audience picker is still enforced by 0095's `audience` policy, both on `entity_type = 'document'` and on `meta ? 'documentId'`.
   - Events that name a file only in `meta.documentId` (`info_request_answered`, `evidence_submitted`) are not covered by `document_label`. Those files must be shared, though (`check_info_request_file`, evidence rules), and they carry no title. Fine.
   - It falls back to true when the file has been deleted. Files are deleted only together with their project (0009, 0025), which removes the events too. Fine.
4. **Definers that read `activity_events` past RLS** do not expose withdrawal events: `app_client_last_active` (a timestamp, firm only), health history, `app_status_pack` (action events only) and `app_action_owner_changes`.
5. **L1 and S1 follow everywhere.** `app_hand_over` (0034), `check_departure` (0027) and `app_person_holdings` all go through `app_person_holdings_of`. The client-admin gate is `app_org_kind() = 'firm' OR (label AND dept)`. Since `app_dept_ok` is always true for a client admin, the department half is redundant but harmless.
6. **The firm's live L4 numbers are unchanged.**
   - The new `s` filter (`action_id IN a`) equals the old unfiltered `app_action_slips`, which already excludes drafts.
   - `client_side` matches `app_status_pack`'s rule (`r.id IS NULL OR r.visibility = 'shared'`).
   - Other callers (the progress route, the project page) default to false.
   - Firm-side reports now show client numbers. That is intended and documented.
7. **L5.** Nothing else reads `metric_snapshots` (no definer, no other service). The firm's Progress tab keeps its history (metrics.test).
8. **C1, another route (old, not this PR).** "Use an existing file as evidence" (`services/files.ts:336`) copies a shared confidential answer into a new evidence document outside the chain. After the firm verifies it, the firm may switch it on for the assistant. It needs a deliberate firm step, and the client gives up nothing. Consider refusing the copy, or carrying the lock to it, when the source answers a confidential request.
9. **C3 covers title and department only.** A reader can still set `state = 'archived'` on another person's file (this denies the file to everyone; it is not a leak), and `supersedes_id` (B1). Neither column was in the assessment's C3, but B1 shows why the list matters.
10. **Tests assert the closure, not just the setup.**
    - Each describe block checks the wrong reader gets nothing: an empty list, not-contain, a refusal regex. The old-row case is inserted by the owner and checked as hidden.
    - Gaps: B1 (unlinking the chain), the S1 old audit rows, and a firm hand-over of the orphaned firm-only action (S3).
