# Review: feature/lead-change-and-end-reminder (Gate B, area 6)

Independent adversarial review of `git diff origin/main...HEAD` in the `lead-change` worktree (head 2ea0473), migration `apps/web/drizzle/0109_lead_change_end_reminder.sql`. Nothing edited or pushed.

What I ran, on database `selah_test_r` only (dropped, recreated, migrated from empty):
- Unit tests, `TZ=UTC`: 67 files, 1073 passed, 2 skipped.
- DB tests: `lead-change-end-reminder`, `audience`, `deputy`, `engagement`, `engagements`, `mail-choices`, `mail`, `offboarding`, `people-leaving`, `rule-parity`. 10 files, 184 passed.
- `drizzle-kit check`: clean.
- SQL probes as `selah_app` with `selah.user_id` set, in scratch scripts outside the repo. Results are quoted below.
- The walkthrough seed, loaded into `selah_test_r` to size the first-deploy reminder batch.

Grep of the diff, the snapshot included, for the partner firm's name (Latin and Arabic), real names, keys, tokens and real mail domains: nothing found. The only hits are function names such as `app_can_reset_password` and the `password_reset` mail kinds.

## Blocking

### B1. Migration ordering against 0108 (privacy-batch): drizzle would skip 0108 without any error
- `apps/web/drizzle/meta/_journal.json:671`: 0109 takes `"idx": 108` with `when` 1795086437611.
- `origin/feature/privacy-batch` adds `0108_privacy_batch` with the same `"idx": 108` and `when` 1795081124373. That is **earlier** than 0109's.
- The drizzle migrator (`node_modules/drizzle-orm/pg-core/dialect.js:57-62`) reads only the latest applied row (`order by created_at desc limit 1`). It applies a migration only if its `folderMillis` is greater than that row's `created_at`.
- **Failure:** if this branch merges and is migrated anywhere (CI database, staging, production, a dev database) before privacy-batch merges, every later `db:migrate` on that database skips 0108 and still prints "migrations applied". The privacy fixes in 0108 would never reach those databases: `check_document_assistant`, `app_meeting_shut_out`, `app_tell_firm_stuck`, and the new `app_send_meeting_invites` / `app_meeting_mail_ok`. On a fresh database both apply, so CI from empty will not catch it.
- Snapshot chain: `0109_snapshot.json` has `prevId` = 0107's id (`2a8bc2ef…`). 0108's snapshot has the same `prevId`, so once both are on main the chain forks.
- **Fix:**
  - Merge 0108 first.
  - Then rebase this branch: journal `idx` 109, `when` greater than 0108's, and 0109 `prevId` = 0108's id (`5c390b23-dd30-4154-891a-7df26a3a53b4`).
  - The two migrations redefine no common function, so no SQL merge is needed. 0108 changes no tables, so the snapshot content does not change.
  - If 0109 must land first, renumber privacy-batch to 0110 with a later `when` instead.

## Should-fix

### S1. `app_lead_change_notices()` trusts a notice row that any user can write for themselves
- Location: `0109_lead_change_end_reminder.sql:102-111`. The only gate is `EXISTS (notifications n WHERE n.user_id = app_uid() AND n.entity_type = 'lead_change' AND n.entity_id = c.id)`.
- That gate cannot be trusted: `notifications` has `GRANT INSERT, UPDATE` to `selah_app`, and its policies are `notify WITH CHECK (app_can_see_user(user_id))` and `own_update`. Every user can see themselves, so anyone can insert, or re-point, a notice addressed to themselves with any `entity_type`/`entity_id`.
- Probe: Beta's client admin, the other firm's admin, and a plain consultant on Acme's team each inserted `('lead_change', <change id>)` for themselves. Each then got `{client_name: 'Acme', lead_name: 'oldLead', client_org_id}` back from the function.
- Exposure: the client name, client id and the current lead's name, never the note. It needs the change's UUID (random, not exposed elsewhere), so it is low. But it breaks the "one's own notices only" claim in the comment and in `docs/authorization.md`, and the DB test at line ~141 checks only the case without a forged notice.
- **Fix:** gate on the real audience, not on a notice existing:
  - `app_uid()` is an active `client_admin` of `c.client_org_id`; or
  - `app_uid() = c.from_user_id`; or
  - `app_uid()` is in `c.firm_org_id` and passes `lead_change_read`.

  Also add a forged-notice case to the test.

### S2. `lead_change_insert` does not tie the new lead, or the firm, to the inserting admin's firm
- Location: `0109_lead_change_end_reminder.sql:52-57`. The policy checks `firm_org_id = app_org()` and `app_can_see_org(client_org_id)`. For a firm admin, `app_can_see_org(client_org_id)` is true for **every** client organisation (baseline `app_can_see_org`). The policy then checks only that `to_user_id` is the client's lead, of any firm.
- Probe, as the other firm's admin:
  ```sql
  INSERT INTO client_lead_changes (client_org_id, firm_org_id, to_user_id, changed_by, handover_note)
  VALUES (ACME, FIRM2, <firm1's current lead>, me, 'from other firm')
  ```
  The insert succeeded. Acme's client admin got a `client.lead_changed` notice and an instant mail. The other firm's admin can read the row back.
- Probe, as the firm admin: an insert with `from_user_id = <any colleague>` succeeded. That colleague gets "a client you led was handed to a colleague" and can now read that row's note.
- Not reachable through `PUT /api/clients/:id/lead` today. A cross-firm `setLead` fails at the `client_assignments` update (`assignment_update` WITH CHECK), which rolls back the whole call. So this is a hole in the policy layer, not a hole in the app.
- **Fix:** add `app_user_org(to_user_id) = app_org()`. Also require that `from_user_id` is NULL or currently holds a `client_assignments` row on that client. A stricter option: make the table insert-only through a SECURITY DEFINER function, as with the handover.

### S3. A departure handover mails the leaver once per client, right away
- Location: `0109_lead_change_end_reminder.sql:178-179` with `tell_lead_change` at lines 77-80 and 83-92.
- `app_hand_over` runs while the leaver is still an active member. Each `client_lead` handed over inserts a change row. The trigger then sends the leaver a `client.handed_over` notice and, by default (`updates = instant`), one work mail **per client**.
- **Failure:** a lead of 8 clients who resigns gets 8 "A client you led was handed to a colleague" mails while they are on the way out. They are told what they just did themselves, at an address that is about to lose access.
- **Fix:** skip the `client.handed_over` branch when the change comes from `app_hand_over`, for example with a transaction-local setting or `changed_by`. Or skip it when `from_user_id` is being handed over. Also note that `app_hand_over` still does not send `client.lead` to the new lead, which `setLead` does.

### S4. On first deploy, every old ended engagement that is still "open" sends `engagement.ended` at once (confirmed)
- Location: `0109_lead_change_end_reminder.sql:255-261`. `today >= g.ends_on - 30` has no lower bound.
- `app_engagement_open()` (lines 229-233) counts an engagement with **no projects** as open forever.
- So the first run sends one `engagement.ended` per (engagement, recipient) for every engagement that ended any time in the past and is still open. Ongoing retainer work counts too: with `retainer_follows` and the projects still `active`, the engagement is "ended … and is still open".
- Recipients are the lead, the deputy and **every** active firm admin.
- Size on the walkthrough seed: 1 engagement (`Strategic planning engagement 2026`, ended 2026-11-14, 1 open project), so 2 notices in one run, all `engagement.ended`.
- On real data the size is about (ended-and-open engagements) × (firm admins + 2). It goes into the same day's summary mail, so mails = distinct recipients, not notices. Run this on production before deploying:
  ```sql
  SELECT count(*) AS engagements,
         sum(cardinality(ARRAY(SELECT app_engagement_reminder_audience(g.id)))) AS notices
  FROM engagements g JOIN organizations o ON o.id = g.client_org_id AND o.status = 'active'
  WHERE g.ends_on IS NOT NULL AND app_firm_today() >= g.ends_on - 30 AND app_engagement_open(g.id);
  ```
- **Fix, if the number is not small:** in the migration, pre-fill `engagement_reminders` for engagements already past (`ends_on < app_firm_today()`) with `recipients '{}'`, so only new ends are told. Or bound the window, for example `today <= ends_on + 30` for `ended`. Decide separately whether an engagement with no projects should count as "open", since it gets this notice once per end date.

## Notes

- **N1. Engagement reminders: concurrency and timezone are fine.**
  - Two overlapping `app_remind_engagements` transactions (the second blocked on the first's PK rows) returned 2 and 0. There were 2 notices in total, so `ON CONFLICT DO NOTHING` on `(engagement_id, kind, ends_on)` holds.
  - `today` comes from `firmToday()` (Asia/Riyadh) in `scripts/follow-ups.ts`. `jobs.sh` also uses `TZ=Asia/Riyadh`.
  - `ended` starts on the Riyadh day after `ends_on`. The screen formats the date with `T00:00:00Z`/`timeZone: "UTC"`, so it does not shift a day.
  - Closed engagements (every project `closed`) and archived clients (`o.status = 'active'`) are skipped. The function refuses any app session (`app_uid() IS NOT NULL`) and has no grant to `selah_app`. Probe: `permission denied` for `app_remind_engagements`, `app_engagement_open` and the log table.
- **N2. The note and grants hold for the obvious readers.**
  - A client admin, a client manager, another client's people, the other firm's admin, a team consultant who is neither lead nor deputy, and project observers all read nothing from `client_lead_changes`.
  - `selah_app` has only SELECT and INSERT, and both policies are PERMISSIVE.
  - All new SECURITY DEFINER functions (`tell_lead_change`, `app_lead_change_notices`, `app_remind_engagements`, and `app_hand_over` as redefined) carry `search_path=public, pg_temp`. `tell_lead_change` and `app_remind_engagements` are revoked from PUBLIC with no grant.
  - The note is not in the audit meta (only `note: true/false`), the mails, the export pack (`CLIENT_FROZEN_TABLES` / pack builders do not touch the table), the assistant (no reference to the table in `src` or `services/ai`), or any notice payload.
- **N3. The client notice reveals nothing firm-internal.** "Your company's lead consultant at the firm is now {name}" shows only the new lead's name and the client's own name or alias. The mail has no names and links to `/help`. The old lead, the reason and the note are never shown.
- **N4. Redefinitions were checked against their latest versions.**
  - `app_hand_over` (0034) and `app_queue_digests` (0092): only the stated lines were added.
  - `outbound_kind` (0095) and `app_work_mail_kinds` (0092): only the two kinds were appended.
  - No migration between 0034 and 0107 redefines `app_hand_over`.
- **N5. The note can be stale for an old lead.** `latestHandoverNote` (`src/services/staffing.ts:290`) takes the newest change **visible to the reader**, so readers can see different "latest" rows. Example: A→B with a note, then B→C, then C→B. The admin, B and C see the newest change (no note), so nothing is shown. A, still on the team, can see only the first change; its `to` is B, the current lead again, so A is shown the first note as current. Filter by the newest change overall, for example with a SECURITY DEFINER "latest change id" helper, or require `toUserId` to be the latest overall.
- **N6. Archived clients.** `client_assignments` is not frozen for archived clients, and `lead_change_insert` does not check `app_is_active_client`. Probe on an archived Acme: the lead change went through. The client admin got an in-app `client.lead_changed` (no mail, outside grace) and the old lead got a mail. Consider adding `app_is_active_client(client_org_id)` to the insert policy. Also consider skipping the client branch of `tell_lead_change` for non-active clients. Departure handovers can hit archived clients too.
- **N7. Minimal-records clients.** The handover note is free text that `app_purge_minimal_records` does not blank. For a minimal-records (consultant-managed) client it can hold client people's names, which the mode tries to avoid. Either purge it with the rest, or hide or disable the field for those clients.
- **N8. The first lead also notifies client admins.** `from_user_id IS NULL` still triggers `client.lead_changed`. That is probably intended, since the client gets its first named lead, but it is not covered in the docs or tests.
- **N9. A user deleted after a change.** `to_user_id` becomes NULL, `lead_name` is NULL, and the client line reads "…is now " with an empty name. Fall back to "gone" or a neutral line.
- **N10. The old lead's link.** `client.handed_over` links to `/clients/:id`. An old lead removed from the team then lands on Not found. Harmless, but the link could go to `/notifications` instead.
