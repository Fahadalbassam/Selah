# Rules catalogue

Every business rule the database enforces, where it lives, the TypeScript that checks it first, and the test that proves it. Paths are relative to `apps/web`.

## One source of truth per rule

- **The database decides.** Each rule is enforced in Postgres (a trigger, a check constraint, a row-level security policy or a validating function in `drizzle/`). The app's role cannot get past it, so a rule holds even when a route forgets to check.
- **TypeScript checks first, for a clear answer.** Services and routes check many rules again before writing, so a person gets a 400 with a sentence they can act on, and so the audit trail records the attempt. When the database refuses anyway, `src/server/http.ts` returns the trigger's own sentence as a 409.
- **A value lives once on each side.** When the TypeScript check needs the same value as the database (a list, a range, a set of moves), it lives in one exported constant. Routes and screens import that constant instead of typing the numbers again. `tests/db/rule-parity.test.ts` reads the database's version (by trying writes, or from the catalog) and fails when the two differ.
- **The catalogue is checked.** `tests/rules-catalogue.test.ts` (part of `npm test`) fails when a trigger function or a hand-written check constraint in `drizzle/` is missing from this page, or when this page names a file that does not exist.

**Changing a rule:** change the migration, the TypeScript check and its constant, this page, and the test in one PR. A new rule goes in a new migration after `0000_baseline.sql`.

Two things are deliberately held twice and not merged:

- **Who may see and do what.** `authorize()` (`src/authz/authorize.ts`, pure, unit-tested) is the decision. Row-level security in the baseline's Security, Staffing and Staffed visibility sections is the backstop. Both are tested on their own (`tests/authorize.test.ts`, `tests/route-guard.test.ts`, `tests/db/rls.test.ts`). Generating one from the other would remove the independent second check, which is the reason both exist.
- **Rules that need data the request does not carry**, such as "the owner is on the project team" or "the signer is still a client admin". The service checks them with a query and the trigger checks them again in the same transaction. They are the same rule written in two languages. The tests below exercise the database side, and the services' error messages are covered by the end-to-end suite (`e2e/`).

## Constants shared with the database

| Value | TypeScript (the one copy) | Used by | Database | Parity test |
|---|---|---|---|---|
| Action status moves | `TRANSITIONS` in `src/authz/workflow.ts` | `canTransition()`, `src/services/actions.ts` | `check_action_transition()` | `tests/db/rule-parity.test.ts` |
| Evidence item decisions | `EVIDENCE_REQUEST_MOVES` in `src/services/follow-through.ts` | `decideEvidenceRequest()` | `check_evidence_request()` | `tests/db/rule-parity.test.ts` |
| Firm setting ranges | `FIRM_SETTING_RANGES`, `CHECKIN_DAYS` in `src/lib/firm-settings.ts` | `src/app/api/firm/settings/route.ts`, `src/app/(app)/settings/settings-form.tsx` | the range checks on firm_settings, `app_valid_checkin_days()` | `tests/db/rule-parity.test.ts` |
| What each response stance needs | `STANCES`, `STANCE_NEEDS` in `src/lib/responses.ts` | `src/services/responses.ts`, `src/app/(app)/recommendations/[id]/response-panel.tsx` | `check_recommendation_response()`, the response_stance enum | `tests/db/recommendation-responses.test.ts` |
| Extensions before the lead decides, and the aging buckets | `EXTENSIONS_BEFORE_LEAD`, `AGING_BUCKETS`, `agingBucket()` in `src/lib/slips.ts` | `src/services/slips.ts`, `src/services/follow-through.ts`, the report page and PDF | `app_extensions_before_lead()`, `app_aging_bucket()` | `tests/db/slips.test.ts` |
| Engagement health: the overdue share and days late that make a project off track, the review wait that is a caution, and the signal itself (F18) | `HEALTH_OVERDUE_SHARE`, `HEALTH_LATE_DAYS`, `REVIEW_WAIT_DAYS`, `healthSignal()` in `src/lib/health.ts` | the oversight page | `app_health_overdue_share()`, `app_health_late_days()`, `app_review_wait_days()`, `app_health_signal()` | `tests/db/oversight.test.ts` |
| The quiet-client period and the Sunday a week starts on (F18) | `CLIENT_QUIET_DAYS`, `weekStart()` in `src/lib/health.ts` | the oversight page, the tests | `app_client_quiet_days()`, `app_week_start()` | `tests/db/oversight.test.ts` |
| Firm setting defaults | `FIRM_SETTING_DEFAULTS` in `src/services/firm-settings.ts` | settings API and page | column defaults, `app_checkin_days()`, `app_restricted_max_admins()` | `tests/db/rule-parity.test.ts` |
| Call link hosts | `callProvider()` in `src/lib/meetings.ts` | meeting forms | `check_meeting()` | `tests/db/rule-parity.test.ts` |
| Meeting and transcript languages | `SPOKEN_LANGS` in `src/lib/meetings.ts` | meeting and transcript routes, `src/services/meetings.ts` | `meetings.meeting_spoken_lang`, `meeting_transcripts.transcript_lang` | `tests/db/rule-parity.test.ts` |
| Transcript formats and length | `TRANSCRIPT_FORMATS`, `TRANSCRIPT_MAX_CHARS` in `src/lib/transcripts.ts` | transcript route and panel, `importTranscript()` | `meeting_transcripts.transcript_format`, `meeting_transcripts.transcript_size` | `tests/db/rule-parity.test.ts` |
| Mail kinds | `MAIL_KINDS` in `src/lib/mail-templates.ts` | the mail job | `outbound_emails.outbound_kind` | `tests/db/rule-parity.test.ts` |
| Mail cadences, defaults and work-mail kinds | `MAIL_CADENCES`, `REMINDER_CADENCES`, `MAIL_DEFAULTS`, `UPDATE_MAIL_KINDS`, `WORK_MAIL_KINDS`, `WEEKLY_DAY`, `LADDER_AUDIENCES` in `src/lib/mail-choices.ts` | `src/app/api/notifications/mail/route.ts`, `src/components/mail-choices.tsx`, the action page's ladder | the mail_cadence enum, `mail_preferences.mail_reminders_cadence`, column defaults, `app_mail_choice()`, `app_update_mail_kinds()`, `app_work_mail_kinds()`, `app_cadence_due()`, `app_action_ladder()` (migration 0019) | `tests/db/rule-parity.test.ts` |
| Ramadan mail hours and span | `RAMADAN_DEFAULTS`, `RAMADAN_SPAN_DAYS` in `src/lib/mail-choices.ts` | `src/app/(app)/settings/settings-form.tsx`, `src/services/firm-settings.ts` | firm_settings defaults, `firm_settings.ramadan_dates` | `tests/db/rule-parity.test.ts` |
| Translatable fields | `TRANSLATABLE` in `src/lib/translations.ts` | `src/services/translations.ts`, translation routes | `app_translation_source()`, `drop_translations()` triggers | `tests/db/rule-parity.test.ts` |
| Translation length | `TRANSLATION_MAX_CHARS` in `src/lib/translations.ts` | `src/app/api/translations/[id]/route.ts` | `content_translations.translation_text` | `tests/db/rule-parity.test.ts` |
| Inquiry form choices | `EMPLOYEE_BANDS`, `OWNERSHIP_TYPES`, `URGENCIES`, `HEARD_FROM`, `INQUIRY_SOURCES`, `REQUESTER_ROLES`, `CONTACT_CHANNELS`, `FAMILY_GENERATIONS`, `FAMILY_WORKING`, `FAMILY_GOVERNANCE` in `src/lib/intake.ts` | the public form, `src/app/api/inquiries/route.ts`, staff entry | the matching enums in `src/db/schema/app.ts` | `tests/intake-constants.test.ts` |
| Information request choices | `INFO_REQUEST_AREAS`, `INFO_REQUEST_STATUSES`, `INFO_REQUEST_SENSITIVITIES`, `INFO_REQUEST_TEMPLATES` in `src/lib/info-requests.ts` | the Requests tab, `src/app/api/projects/[id]/info-requests` routes | the matching enums in `src/db/schema/app.ts` | `tests/info-requests.test.ts` |
| Other-language name length | `NAME_ALT_LENGTH` in `src/lib/masking.ts` | name-alt and contact routes | `user.user_name_alt_len`, `client_contacts.contact_name_alt_len` | `tests/db/rule-parity.test.ts` |
| Client short names | `SHORT_NAMES` in `src/lib/engagement.ts` | `setShortNames()` | `check_short_names()` | `tests/db/rule-parity.test.ts` |
| The firm's time zone and "today" | `FIRM_TIME_ZONE`, `firmToday()` in `src/lib/dates.ts` | every service, job and the date formatting | `app_firm_tz()`, `app_firm_today()`, `app_firm_date()` (migration 0002), used by every function and view that needs the day. Never current_date, which is the database's UTC day | `tests/db/rule-parity.test.ts` (also fails if a function or view spells out the zone again) |
| Phase number and planned working days of a client project | `PHASE_LIMITS` in `src/lib/phases.ts` | project routes, the client page's New project dialog | `projects.projects_sequence_range`, `projects.projects_planned_days_range` | `tests/db/rule-parity.test.ts` |
| Work that can be handed over | `HAND_OVER_KINDS` in `src/services/accounts.ts` | `src/app/api/people/[id]/hand-over/route.ts`, the team page's switch-off dialog | `app_hand_over()`, the blocking kinds of `app_person_holdings_of()` (migration 0027) | `tests/db/rule-parity.test.ts` |
| What an observer only reads | `OBSERVER_READ_ONLY_TABLES`, `OBSERVER_WRITABLE_TABLES` in `src/lib/observers.ts` | `src/authz/policy.ts` (`OPEN_TO_OBSERVERS`) | `check_not_observer()` on each of those tables (migration 0034) | `tests/db/observers.test.ts` |
| Open actions (released, not finished) | `OPEN_STATUSES` in `src/authz/workflow.ts` | `isOverdue()`, the assistant's status answer | `app_action_open()` (migration 0002), used by the deviation, reminder, mail and metrics functions | `tests/db/rule-parity.test.ts` |
| Closing dispositions and frozen tables | `DISPOSITIONS`, `FROZEN_TABLES` in `src/lib/closure.ts` | `src/services/closure.ts`, the closure routes, the Closing tab | `check_project_open()` (the project_open triggers), the closure_disposition enum | `tests/db/closure.test.ts` |
| Grace period, retention, frozen client tables and the export pack | `GRACE_DAYS`, `RETENTION_YEARS`, `CLIENT_FROZEN_TABLES`, `PACK_LABELS`, `PACK_MAX_BYTES`, `PACK_RECEIPT_LIMITS` in `src/lib/offboarding.ts` | the offboarding route, the client page | `app_archive_client()`, `check_client_open()` (the client_open triggers) | `tests/db/offboarding.test.ts` |

Enums (`action_status`, `role`, `visibility` and the rest) and the check constraints declared in `src/db/schema` have one source already: the Drizzle schema, from which part 1 of the baseline is generated.

## Rules by area

Database names are trigger functions (`name()`) or check constraints (`table.name`). "Checked first in" is the TypeScript that gives the clear answer, or "database only" when nothing in the app writes the row in a way that could break the rule. "Tests" names the database test files that run the rule. For every trigger function this was checked on 2026-10-23 from Postgres's own call counts (`pg_stat_user_functions`) per test file. For a check constraint, the file writes that column; several constraints are only exercised on their passing side.

### Security and history

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| History tables (progress, evidence, reviews, activity, snapshots, AI drafts, inquiry events, access reviews, meeting decisions, audit chain checks) are append-only; only the purge job blanks text, and only deleting a client that never signed removes rows | `forbid_change()` | database only | `tests/db/rls.test.ts`, `tests/db/prospects.test.ts` |
| The audit log is append-only even for its owner and can't be truncated; the sealing job only fills an empty seal, and pruning only removes sealed entries behind the chain's anchor that are older than the keep period (never under 12 months) | `audit_log_guard()`, `firm_settings.audit_keep_months_range` | `src/lib/firm-settings.ts` (`FIRM_SETTING_RANGES.auditKeepMonths`) | `tests/db/audit-log.test.ts`, `tests/db/rule-parity.test.ts` |
| The audit chain's start and end only move forward, and there is one row | `audit_chain_forward()` | database only | `tests/db/audit-log.test.ts` |
| Firm roles only in the firm org, client roles only in client orgs | `check_membership_role()` | `src/services/accounts.ts`, `src/services/onboarding.ts` | `tests/db/rls.test.ts`, `tests/db/accounts.test.ts` |
| A project pairs the firm with one client (an internal project belongs to the firm) | `check_project_orgs()` | `src/services/staffing.ts` | `tests/db/rls.test.ts` |
| Action workflow: allowed moves, clients only move their own work, only the firm releases, reviews, closes and reopens, verified needs an accept of this round and every evidence item settled, risk acceptance needs a current client signature, reopening clears the closure | `check_action_transition()` | `src/authz/workflow.ts` (`TRANSITIONS`, `canTransition()`), `src/services/actions.ts` | `tests/db/follow-through.test.ts`, `tests/db/rule-parity.test.ts`, `tests/authorize.test.ts` |
| A document's passages leave the AI index when it is unshared, relabelled, archived, deleted or its AI flag goes off | `drop_document_chunks()` | database only | `tests/db/rls.test.ts`, `tests/db/ai-sources.test.ts` |
| An action takes its recommendation's label: under a firm-only recommendation the action and everything under it (progress, evidence, reviews, risk acceptances, deadline requests, notes, follow-ups) are firm-only, for reads and writes | `app_recommendation_label_ok()`, `app_action_label_ok()` (restrictive policies on each table) | `src/services/actions.ts` (`loadAction()`) | `tests/db/private-recommendations.test.ts` |
| Nobody is notified, or mailed, about an action they can't see; a meeting's agenda lists only actions under shared recommendations | `drop_hidden_action_notification()`, `app_meeting_agenda()` | `src/jobs/follow-ups.ts` | `tests/db/private-recommendations.test.ts` |
| Findings and recommendations are corrected, released and withdrawn, never quietly removed once the client could see them: the label moves only from firm-only to shared and the database stamps when; a withdrawn record is final; withdrawing needs a reason, a recommendation is withdrawn once none of its actions is open or a draft, a finding once no live recommendation answers it; a withdrawal is recorded whole (N1) | `check_releasable_change()`, `start_releasable()`, `findings.findings_withdrawn_whole`, `recommendations.recommendations_withdrawn_whole` | `src/services/plan-changes.ts` (`releaseRecord()`, `withdrawRecord()`, which closes open actions as not applicable and deletes drafts first; `recordControls()` for the screen) | `tests/db/plan-changes.test.ts` |
| Only what the client never saw is deleted: a firm-only finding or recommendation never released, a recommendation with no released actions (its drafts go with it), a finding no recommendation answers; deleting a never-signed client takes everything | `check_releasable_delete()` | `src/services/plan-changes.ts` (`deleteRecord()`) | `tests/db/plan-changes.test.ts` |
| Nothing new starts under a withdrawn recommendation: no new action, no action moved under it, no closed action reopened; the assistant stops citing it and its actions | `refuse_withdrawn_recommendation()`, `drop_record_chunks()` | `src/jobs/index-documents.ts` (`indexRecords()` skips withdrawn records) | `tests/db/plan-changes.test.ts` |
| The client answers each released recommendation: the client's admin, or the project's sponsor in a full engagement; for a consultant-managed client the firm records it, saying how and when the client gave it. Only a shared, live recommendation on a client project that is not closed (F10) | `app_can_respond()`, the respond policy on recommendation_responses | `src/services/responses.ts` (`recordResponse()`, `getRecommendation()` for the screen) | `tests/db/recommendation-responses.test.ts` |
| A response says what it needs: agreeing (fully or partly) gives the planned action and its date, partly agreeing or disagreeing gives the reason; its source comes from who records it, never from the request | `check_recommendation_response()`, `recommendation_responses.recommendation_responses_received`, `recommendation_responses.recommendation_responses_received_only` | `STANCE_NEEDS` in `src/lib/responses.ts`, `src/services/responses.ts` | `tests/db/recommendation-responses.test.ts` |
| A response is never edited or deleted; a new one supersedes it. The firm takes two steps on it, each once and stamped by the database: a colleague other than the recorder confirms a firm-recorded response (until then it doesn't count), and the firm answers it | `check_recommendation_response_change()`, `app_recommendation_stances()` | `src/services/responses.ts` (`confirmResponse()`, `replyToResponse()`) | `tests/db/recommendation-responses.test.ts` |
| Whoever can see an action reads and writes its thread; a comment is written now, by its author, with text, and mentions only other people who can see the action (F11) | the scoped_read and author_insert policies on action_comments, `check_action_comment()`, `app_user_sees_action()`, `app_action_people()` | `src/services/comments.ts` (`postComment()`, `actionThread()`) | `tests/db/action-comments.test.ts` |
| A comment is never edited or deleted: its author may remove it once, which blanks the text and keeps the row. A new comment tells the people it mentions, the action's owner, everyone who wrote in the thread before and, when the client writes, the firm's team, each only if they can see the action; mail follows their update choices | `check_action_comment_change()`, `app_notify_action_comment()`, `mail_action_notification()` | `UPDATE_MAIL_KINDS` in `src/lib/mail-choices.ts`, `src/services/comments.ts` (`removeComment()`) | `tests/db/action-comments.test.ts` |
| A recommendation the client's latest response disagrees with is disputed, and shows on the firm's deviation rules until a later response agrees | the deviation view (rule disputed), `app_recommendation_stances()` | `src/services/insight.ts` (`projectDeviations()`) | `tests/db/recommendation-responses.test.ts` |

### Staffing

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Only consultants are assigned to clients | `check_assignment_role()` | `src/services/staffing.ts` | `tests/db/rls.test.ts` |
| Nobody comes off a project while they own open actions on it (reassign first) | `check_member_removal()` | `src/services/staffing.ts` (`removeProjectPerson()`) | `tests/db/projects.test.ts` |
| A project continues an earlier project of the same client, never itself or one that continues it | `check_project_follows()` | `src/services/staffing.ts` (`createClientProject()`, `updateProject()`) | `tests/db/projects.test.ts` |
| A join request is decided once; only the decision changes | `check_join_request_update()` | `src/services/staffing.ts` (`decideRequest()`) | `tests/db/rls.test.ts` |
| An observer on a project is a firm consultant who is not the client's lead, not a lead and owns no open work there (`project_members.project_member_observer_not_lead`); becoming the client's lead ends observing | `check_project_observer()`, `end_observing_as_lead()` (migration 0034) | `src/services/staffing.ts` (`staffProject()`) | `tests/db/observers.test.ts` |
| An observer reads the project and adds notes to its actions, and writes nothing else there; observers own no actions or KPIs, are left out of the team's work notifications and do no reviews | `check_not_observer()`, `app_observes_project()`, `check_action_owner()`, `check_kpi()`, `app_project_audience()` | `src/authz/authorize.ts` (`OPEN_TO_OBSERVERS` in `src/authz/policy.ts`) | `tests/db/observers.test.ts`, `tests/authorize.test.ts` |

### Signed engagements and draft projects

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| An engagement is between the firm and one of its clients and stays with that client; signature and data-agreement dates are not in the future; the inquiry it came from belongs to that client | `check_engagement()`, `engagements.engagement_period` | `src/services/engagements.ts` (`recordEngagement()`, `updateEngagement()`), `src/lib/engagements.ts` | `tests/db/engagements.test.ts` |
| Who reads an engagement: firm admins, consultants assigned to the client, and the client's admin; only the firm admin writes | `app_can_see_engagement()` | `src/authz/policy.ts` (`engagement.read`, `engagement.write`) | `tests/db/engagements.test.ts` |
| A deliverable belongs to a project its engagement covers | `check_engagement_deliverable()` | `src/services/engagements.ts` (`addDeliverable()`) | `tests/db/engagements.test.ts` |
| A client project no signed engagement covers is a draft; covering it makes it planned; only the firm admin covers it, with an engagement of the same client; a covered project keeps it and is never a draft again; internal projects are never drafts | `check_project_engagement()` | `src/services/engagements.ts` (`coverProjects()`), `src/services/staffing.ts` (`createClientProject()`) | `tests/db/engagements.test.ts`, `tests/db/projects.test.ts` |
| The client never sees a draft project, and its people join only once it is covered | `app_can_see_project()`, `check_draft_member()` | `src/services/staffing.ts` | `tests/db/engagements.test.ts` |

### Prospects and pitches

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Any consultant or the firm admin starts a pitch: a prospect client and its first draft project, led by the consultant who starts it | `app_start_pitch()` | `src/services/prospects.ts` (`startPitch()`), `src/authz/policy.ts` (`organization.pitch`) | `tests/db/prospects.test.ts` |
| Only a client is a prospect; it becomes a client only when its first signed engagement is recorded (which does it), and never goes back | `check_prospect()`, `win_prospect()` | `src/services/engagements.ts` (`recordEngagement()`) | `tests/db/prospects.test.ts` |
| A prospect has no accounts, invitations or join requests, and consultants not on it don't see it in the client directory | `check_prospect_access()`, `app_client_directory()` | `src/services/staffing.ts` (`clientDirectory()`) | `tests/db/prospects.test.ts` |
| Only what never signed is deleted: no engagement, no accounts, not from an inquiry; a prospect by the firm admin or its lead, with everything in it; any other client by the firm admin while it holds no files | `app_discard_check()`, `app_discard_client()` | `src/services/prospects.ts` (`discardBlock()`, `discardClient()`) | `tests/db/prospects.test.ts` |
| A deleted file's bytes leave the bucket (the delete-objects job) | `queue_storage_deletion()` | `scripts/delete-objects.ts` | `tests/db/prospects.test.ts` |
| A new client sets no minimal records unless asked, so a consultant can start a pitch | `check_minimal_records()` | `src/services/prospects.ts` | `tests/db/prospects.test.ts` |

### Closing a project

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Who closes: the firm admin, or the lead of an internal project (N5); only the firm admin reopens, with a reason kept in the project's history | `app_can_close_project()`, `app_reopen_project()` | `src/authz/policy.ts` (`project.close`, `project.reopen`), `src/services/closure.ts` (`moveClosure()`) | `tests/db/closure.test.ts`, `tests/authorize.test.ts` |
| A project moves to or from closing and closed only through the closing steps; a new project is never closing or closed; a closed project's own record doesn't change | `check_project_state()` | `src/services/closure.ts` | `tests/db/closure.test.ts` |
| A project closes only when nothing is left: every open action has a disposition, every handed-over one names who sustains it, no submission waits for review, no deadline request waits for a decision, and the lessons are written | `app_closure_blockers()`, `app_close_project()` | `src/services/closure.ts` (`getClosure()`), the Closing tab | `tests/db/closure.test.ts` |
| A closed project is read-only for everyone on the tables in `FROZEN_TABLES`; check-ins, KPI readings, the assistant and leaving the project stay open; jobs are not limited | `check_project_open()` | `src/authz/authorize.ts` (`OPEN_WHEN_CLOSED`), `src/lib/closure.ts` (`FROZEN_TABLES`) | `tests/db/closure.test.ts`, `tests/authorize.test.ts` |
| Only the firm on a closing project disposes of an open action; deferred, withdrawn and waived say why; who sustains a handed-over action is an active account or contact of the project's own organisation, named by the firm, the client's admin or the project's sponsor | `app_dispose_action()`, `app_name_sustainer()`, `app_check_sustainer()`, `project_closure_items.closure_item_reason` | `src/services/closure.ts` (`disposeAction()`, `nameSustainer()`) | `tests/db/closure.test.ts` |
| The client's sponsor or admin asks the firm to close (N9), one request at a time; the firm admin declines with a reason or starts closing, which answers it | `app_request_closure()`, `app_decline_closure_request()`, `app_start_closing()` | `src/services/closure.ts` (`requestClosure()`, `declineClosureRequest()`) | `tests/db/closure.test.ts` |
| Reminders go on while a project closes, except for actions that already have a disposition | `app_follow_ups_due()` | `src/jobs/follow-ups.ts` | `tests/db/closure.test.ts` |

### A client leaving

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Only the firm admin archives a client, and only once every project is closed; a client that never signed is deleted instead; drafts are deleted and open invitations revoked when it is archived | `app_archive_client()`, `app_archive_blockers()` | `src/authz/policy.ts` (`organization.archive`), `src/services/offboarding.ts` (`getOffboarding()`, `archiveClient()`) | `tests/db/offboarding.test.ts` |
| An organization's status changes only through archiving and restoring, and an archived client's own record does not change | `check_org_status()` | `src/services/offboarding.ts` | `tests/db/offboarding.test.ts` |
| An archived client's people sign in and read during its grace period (0 to 90 days) and nothing after it; no one writes to its client-level records; jobs are not limited | `app_in_grace()`, `app_org()`, `app_role()`, `app_org_kind()`, `app_can_reset_password()`, `check_client_open()` | `src/services/principal.ts` (`readOnly`), `src/authz/authorize.ts` (`OPEN_WHEN_ARCHIVED`) | `tests/db/offboarding.test.ts`, `tests/authorize.test.ts` |
| Only the firm admin restores an archived client, with a reason kept in its history | `app_restore_client()` | `src/services/offboarding.ts` (`restoreClient()`) | `tests/db/offboarding.test.ts` |
| Only the firm admin places or releases a legal hold, each with a reason; a hold never changes once placed and is never deleted while its client exists; only the firm admin sees holds | `app_place_legal_hold()`, `app_release_legal_hold()`, `check_legal_hold()` | `src/authz/policy.ts` (`organization.hold`), `src/services/offboarding.ts` | `tests/db/offboarding.test.ts` |
| An archived client is kept for ten years after archiving; then the daily job deletes it unless a hold stands, erases the accounts that belonged only to it, queues its files for deletion and keeps a deletion record that only the firm admin reads | `app_purge_clients()` | `scripts/purge-clients.ts` | `tests/db/offboarding.test.ts` |
| Only an archived client has an export pack, made by the firm admin or by the client's own admin in its grace period; it holds only records shared with the client or private to it (never firm-only or personal ones), each file checked against its checksum, and the ZIP's own SHA-256 is recorded | `app_can_export_pack()`, `app_record_export_pack()` | `src/authz/policy.ts` (`organization.export`, `OPEN_WHEN_ARCHIVED`), `src/services/export-pack.ts` (`makeExportPack()`) | `tests/db/export-pack.test.ts`, `tests/export-pack.test.ts` |
| A pack's receipt is given once: the client's admin confirms it (and the firm admins are told), or the firm admin records a handover outside Selah naming who received it; a pack never changes otherwise and is deleted only with its client, its stored file with it; only the firm admin and the client's admin see packs | `app_confirm_export_receipt()`, `app_record_export_handover()`, `check_export_pack()` | `src/services/export-pack.ts` (`recordReceipt()`) | `tests/db/export-pack.test.ts` |

### Evidence and review integrity

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| A stored file never changes, evidence is never deleted or renamed, a scan result is final, evidence reaches the AI index only after the firm verified it | `check_document_integrity()` | `src/services/evidence.ts`, `src/services/files.ts`, `src/services/scan.ts` | `tests/db/files.test.ts`, `tests/db/rls.test.ts` |

### Follow-through

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| A board decision records its date | `recommendations.board_decision_dated` | `src/services/plan.ts` (`createRecommendation()`) | `tests/db/follow-through.test.ts` |
| Only closed actions carry a closure outcome | `actions.closure_matches_status` | `src/services/actions.ts` | `tests/db/follow-through.test.ts` |
| Superseded names a different successor, and only superseded does | `actions.superseded_names_successor` | `src/services/actions.ts` | `tests/db/follow-through.test.ts` |
| A new action starts as draft or assigned | `check_action_insert()` | `src/services/plan.ts` (`createAction()`) | `tests/db/follow-through.test.ts` |
| An owner is an active member of the project's organisation, staffed on it | `check_action_owner()` | `src/services/plan.ts` (`assertOwner()`) | `tests/db/follow-through.test.ts` |
| An issued report never changes except to be shared | `freeze_report()` | `src/services/follow-through.ts` (`shareReport()`) | `tests/db/follow-through.test.ts` |
| Evidence items: belong to their action, start open, decided only in the allowed moves | `check_evidence_request()` | `src/services/follow-through.ts` (`EVIDENCE_REQUEST_MOVES`) | `tests/db/follow-through.test.ts`, `tests/db/rule-parity.test.ts` |
| A waived item says why | `evidence_requests.waiver_explained` | `src/services/follow-through.ts` (`decideEvidenceRequest()`) | `tests/db/follow-through.test.ts` |
| A file answering an item marks it submitted; the item must be open on that action and the file scanned clean | `link_submission_to_request()` | `src/services/evidence.ts` | `tests/db/follow-through.test.ts` |
| Due-date requests: for open actions, a new date from today on, decided once by the firm; approval moves the due date | `decide_deadline_request()` | `src/services/follow-through.ts` (`requestDeadlineChange()`, `decideDeadlineChange()`) | `tests/db/follow-through.test.ts` |
| Every move of a released action's due date is kept, by request or by a plan edit, with who moved it; the history is append-only, written only by the database, and as visible as the action. A request keeps the date it asked to move and is marked when that date had already passed (F17) | `record_due_change()`, `decide_deadline_request()`, the scoped_read policy on action_due_changes | `src/services/slips.ts` (`actionSlip()`) | `tests/db/slips.test.ts` |
| The third move of a due date later (by request or in the plan) needs the client's lead consultant, the internal project's lead, or a firm admin; moving it earlier or declining a request doesn't | `app_can_extend()`, `app_action_extensions()`, `record_due_change()` | `src/services/follow-through.ts` (`decideDeadlineChange()`), `canExtend()` in `src/services/slips.ts` | `tests/db/slips.test.ts` |
| Slips and aging are read against the date agreed at release: days slipped, extensions, and how long an open action is past that date, per action and in the project's numbers that a report freezes; "slipped" counts every move later | `app_action_slips()`, `app_project_progress()`, the deviations view | `projectProgress()` in `src/services/follow-through.ts`, `src/lib/report-html.ts` | `tests/db/slips.test.ts` |
| The oversight page lists every planned, active or closing project the firm caller can see (never a pitch, never to the client) with its counts, lead, the client's last activity and a health signal, and the exceptions across them (F18) | `app_portfolio()`, `app_project_lead()`, `app_client_last_active()`, the deviations view | `src/services/oversight.ts` (`portfolio()`, `exceptions()`) | `tests/db/oversight.test.ts` |
| A consultant on the project asks an open action's other, active owner for an update at most once a firm day; the owner gets a reminder with their other reminders; the record is firm-only and append-only, and observers, the client and closed projects can't add one (F18) | `check_action_reminder()`, the firm_read and firm_insert policies on action_reminders, `check_project_open()`, `check_not_observer()` | `src/services/oversight.ts` (`remindOwner()`) | `tests/db/oversight.test.ts` |
| Each open project's signal is kept per week (Sunday start) by the daily job, the current week's row following the project until the week ends; the history is firm-only and read-only to the app (F18) | `app_snapshot_health()`, `app_project_health()`, `app_week_start()`, the firm_read policy on project_health_weeks | `src/jobs/health.ts`, `portfolio()` in `src/services/oversight.ts` | `tests/db/oversight.test.ts` |
| When no one at a full or restricted client has acted on an active project with open work for 14 days (from their last activity, or the first release), the client's lead consultant (the firm admins if there is none) is told once per quiet spell, with their reminders (F18) | `app_alert_quiet_clients()`, `app_client_quiet_days()`, `app_queue_digests()` | `src/jobs/health.ts` | `tests/db/oversight.test.ts` |
| On the 1st of each month the job drafts last month's status pack for every active client project with released work, once per project and month, in the name of the client's lead consultant (else the project's creator), who is told with their reminders; the app can't draft one (F19) | `app_draft_status_packs()`, `check_status_pack()`, the reports_status_pack_once index, `app_queue_digests()` | `src/jobs/status-packs.ts` | `tests/db/status-pack.test.ts` |
| A status pack lists only work the client can be shown (no actions under a firm-only recommendation): what needs a decision, what is overdue and with whom, what moved twice or more, risk accepted and by whom, what was verified, and how many actions reached each status; a client reader sees only their departments' items (F19) | `app_status_pack()`, `app_dept_ok()` | `src/services/status-pack.ts` (`reportPack()`) | `tests/db/status-pack.test.ts` |
| A draft status pack is firm-only and changes only its note, numbers and lists; issuing freezes the numbers with the lists, and only an issued pack can be shared; no report changes kind (F19) | `check_status_pack()`, reports_kind, reports_pack_issued_before_shared | `src/services/status-pack.ts` (`issueStatusPack()`), `shareReport()` in `src/services/follow-through.ts` | `tests/db/status-pack.test.ts` |

### Metrics and KPIs

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| The agreed due date is set at release and kept | `keep_baseline()` | database only | `tests/db/metrics.test.ts` |
| A KPI's objective and owner are in its project | `check_kpi()` | database only (no KPI screens yet) | `tests/db/metrics.test.ts` |
| KPI periods start on the 1st | `kpis.kpi_starts_on_first` | database only | `tests/db/metrics.test.ts` |
| A recommendation and its KPI share a project | `check_recommendation_kpi()` | database only | `tests/db/metrics.test.ts` |
| Readings: for active KPIs and started periods, verified or rejected once, never by their reporter; a correction replaces a reading of the same period | `check_kpi_reading()` | database only | `tests/db/metrics.test.ts` |
| A client's numbers pool its projects' counts and work out the percentage from them, never averaging percentages; each reader counts only the work they can open, with each project and department beside the total | `app_client_progress()` | `src/services/client-overview.ts` (`clientOverview()`) | `tests/db/client-overview.test.ts` |
| A department's page shows its numbers across the client's projects, each project beside the total; it is read by the client's consultants and admins and by the department's own people, never by another department's manager | `app_client_progress()` | `src/services/client-overview.ts` (`departmentOverview()`) | `tests/db/client-overview.test.ts` |

### Handover

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| A client role's person belongs to the project's client; an account holding the sponsor, coordinator or acceptor role is an active admin or manager; client projects only | `check_client_role()` | `src/services/client-roles.ts` (`addClientRole` pre-check) | `tests/db/client-roles.test.ts`, `tests/db/handover.test.ts` |
| The firm admin and the client's lead name client roles; the client's admin names accounts only, never contacts | `app_can_manage_client_roles()` (the insert and delete policies) | `src/services/client-roles.ts` (`canManage`) | `tests/db/client-roles.test.ts` |
| One sponsor and one coordinator per project; naming a new one replaces the old | `check_client_role()` and the unique index project_client_roles_single | `src/services/client-roles.ts` (`SINGLE_ROLES`) | `tests/db/client-roles.test.ts` |
| Client roles are named or removed, never edited | `forbid_change()` on project_client_roles | none (no update path) | `tests/db/client-roles.test.ts` |
| The sponsor role's holder, while an active admin or manager, is told at escalation level 3 | `app_follow_ups_due()` | `src/jobs/follow-ups.ts` | `tests/db/client-roles.test.ts` |
| Setting the handover date schedules check-ins; moving it moves the open ones | `schedule_checkins()` | database only | `tests/db/handover.test.ts` |

Retired: `check_project_sponsor()` (migration 0010). The sponsor moved from the project row to the client roles above.

### Intake

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| The public form is validated and rate-limited in one function; the app role cannot insert inquiries | `submit_inquiry()` | `src/app/api/inquiries/route.ts`, `src/services/intake.ts` | `tests/db/intake.test.ts` |
| Inquiry status moves, owner, conflict check before winning, jobs only anonymise | `check_inquiry_update()` | `src/services/inquiries.ts` | `tests/db/intake.test.ts` |
| Every status and owner change is logged, and the new owner told | `log_inquiry_update()` | database only | `tests/db/intake.test.ts` |
| A new inquiry mails the intake address a link, and the requester an acknowledgement with the reference, at most one a day to an address | `mail_new_inquiry()` | database only | `tests/db/firm-settings.test.ts`, `tests/db/intake.test.ts` |
| Only the firm admin sends a requester a decline, once, for an inquiry closed as lost or declined whose details are still kept | `app_mail_inquiry_decline()` | `src/services/inquiries.ts` (`mailDecline()`, `can.declineMail`) | `tests/db/intake.test.ts` |
| Firm staff enter inquiries that didn't come through the form (referral, returning client, Etimad tender, the firm's own approach); a consultant owns what they enter and the admins are told; a named client must be one they can see; no mail goes out | `app_enter_inquiry()`, `mail_new_inquiry()` | `src/services/inquiries.ts` (`enterInquiry()`), `src/lib/inquiry-entry.ts` | `tests/db/intake.test.ts` |
| The public form's inquiries carry consent, size and ownership and no staff author; entered ones carry who entered them; only a tender carries a tender number; a returning client's inquiry names the client | `inquiries.inquiry_website_fields`, `inquiries.inquiry_entered_by`, `inquiries.inquiry_tender_fields`, `inquiries.inquiry_source_client` | `src/lib/inquiry-entry.ts` (`enteredInquiryInput`) | `tests/db/intake.test.ts` |
| Only the firm admin runs the conflict search: current, past and pitched clients and other inquiries, by exact or similar name (Arabic and English, legal words dropped), mail domain, the same person and the owners' family names; each run is kept as a snapshot nobody can change | `app_name_words()`, `app_family_name()`, `app_conflict_matches()`, `app_record_conflict_search()`, `conflict_searches.conflict_search_subject` | `src/services/conflicts.ts` (`runConflictSearch()`) | `tests/db/conflicts.test.ts` |
| An inquiry's conflict check is cleared only after a conflict search was run for it | `check_conflict_cleared()` | `src/app/(app)/inquiries/[id]/page.tsx` (clear offered only after a search) | `tests/db/conflicts.test.ts` |
| An inquiry is rated on five signals, each 1 to 3, while it is open, by whoever works it | `check_inquiry_qualification()`, `inquiry_qualifications.inquiry_qualification_range` | `src/lib/qualification.ts` (`qualificationInput`), `src/services/inquiries.ts` (`rateInquiry()`) | `tests/db/conflicts.test.ts` |
| The NDA date is recorded by the inquiry's owner or the firm admin, never in the future (Riyadh day), and not once the inquiry's details are cleared | `app_mark_inquiry_nda()` | `src/services/inquiries.ts` (`markNda()`) | `tests/db/conflicts.test.ts` |
| The public form asks the requester's role from a list, why now (required, up to 500 characters) and how to reach them; phone or WhatsApp needs a number; size and ownership are optional; the family questions only for a family business; marketing consent is separate and unticked; no CR number | `submit_inquiry()`, `inquiries.inquiry_why_now`, `inquiries.inquiry_contact_channel`, `inquiries.inquiry_family_fields`, `inquiries.inquiry_marketing_consent` | `src/app/api/inquiries/route.ts`, `src/app/(public)/inquiry/inquiry-form.tsx` | `tests/db/intake.test.ts` |
| Only the requester agrees to news from the firm; the firm admin may only record that they withdrew it, which is logged | `check_inquiry_update()` | `src/services/inquiries.ts` (`withdrawMarketingConsent()`) | `tests/db/intake.test.ts` |
| Clearing an inquiry's details also clears why now, the marketing consent and the contact channel; role and family answers stay as statistics | `forget_inquiry_extras()` | none: the retention job and minimal records | `tests/db/intake.test.ts` |

### Information requests

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Only firm staff on the project add, edit or remove items, and only on an open client project; a new item starts as requested; the client may change only an item's status; an action owner sees only the items they own | `check_info_request()`, the row policies on info_requests | `src/services/info-requests.ts`, `info_request.*` in `src/authz/policy.ts` | `tests/db/info-requests.test.ts` |
| Status moves: a file marks an item received and taking off the last file asks again; the firm reviews, returns with a reason, or marks not applicable and asks again with a reason; the client may say a waiting item does not apply, with a reason | `check_info_request()`, `info_request_files_moved()` | `src/services/info-requests.ts` (`moveInfoRequest()`, `can`) | `tests/db/info-requests.test.ts` |
| An item's owner is an active client admin or someone at the client staffed on the project | `check_info_request()` | the owner picker (`listInfoRequests().owners`) | `tests/db/info-requests.test.ts` |
| A file answers an item only while it is waiting or received, from the same project, shared with both sides and not archived; one file may answer several items; a reviewed item keeps its files; an answered item cannot be deleted | `check_info_request_file()`, the row policies on info_request_files and info_requests (delete only while unanswered) | `src/services/info-requests.ts` (`answerWithUpload()`, `answerWithExisting()`, `removeAnswer()`) | `tests/db/info-requests.test.ts` |
| A confidential item's files stay out of the assistant: such a file cannot be answered with an assistant-read file, cannot be turned on for the assistant, and an item with an assistant-read file cannot become confidential | `check_info_request_file()`, `check_confidential_file()`, `check_info_request()` | `src/app/(app)/projects/[id]/info-requests-tab.tsx` (the confidential hint) | `tests/db/info-requests.test.ts` |
| A client answering an item tells the firm-side team, and only for something the caller did | `app_notify_info_request()` | `src/services/info-requests.ts` (`tellFirm()`) | `tests/db/info-requests.test.ts` |
| Waiting items with a due date are reminded by the daily job with the project's reminder and escalation days: due soon and overdue go to the owner (or the client admins when none is named), and past the level 2 days also to the client managers on the project and the firm-side team; each step once per due date, one notification per person and project | `app_info_requests_due()` | `src/jobs/follow-ups.ts` (`runFollowUps()`) | `tests/db/info-requests.test.ts` |

### Withdrawing a wrong file

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Only the uploader withdraws a file, on an open project, with a reason (3 to 500 characters): not evidence (the reviewer returns it), not a file with versions (the next version replaces it), and not one already relied on (a reviewed information request, a final assessment, a KPI reading). It is archived, leaves the assistant, stops answering requests and draft assessments, and is logged | `app_withdraw_document()`, `app_document_settled()`, `documents.document_withdrawn` | `src/services/documents.ts` (`fileControls().withdraw`, `withdrawDocument()`) | `tests/db/info-requests.test.ts` |
| The withdrawal record is written only by the withdrawal, and a withdrawn file stays archived | `check_document_withdrawal()`, `documents.document_withdrawn` | database only | `tests/db/info-requests.test.ts` |

### Expertise

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| A profile belongs to an active consultant and stays theirs; consultants change only their languages and availability | `check_consultant_profile()` | `src/services/expertise.ts` (`putProfile()`) | `tests/db/expertise.test.ts` |
| A consultant speaks at least one of Arabic and English, and nothing else | `consultant_profiles.languages_known` | `src/app/api/consultants/[id]/profile/route.ts` | `tests/db/expertise.test.ts` |

### Accounts

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Email domains are stored lower-case and must look like domains | `normalise_email_domains()` | `src/services/accounts.ts` (`setEmailDomains()`) | `tests/db/accounts.test.ts` |
| A member's address sits on the organisation's domains | `check_user_email()` | `src/services/accounts.ts`, `src/services/onboarding.ts` | `tests/db/accounts.test.ts` |
| A membership stays with its person and organisation; switching off needs a reason and is never done to yourself | `check_membership_change()` | `src/services/accounts.ts` (`setActive()`) | `tests/db/accounts.test.ts` |
| Switching an account off ends its sessions; both directions are audited | `log_membership_change()` | database only | `tests/db/accounts.test.ts` |
| Invitations: one account per person, the right role for the organisation, only revoked once open; tokens are stored as hashes | `check_invitation()`, `invitations.invitation_token_is_hash` | `src/services/accounts.ts` (`invite()`) | `tests/db/accounts.test.ts` |
| Address changes: a new, free address on the domains, only cancelled once open; tokens are stored as hashes | `check_email_change()`, `email_changes.email_change_token_is_hash` | `src/services/accounts.ts` (`requestEmailChange()`) | `tests/db/accounts.test.ts` |
| An access review covers every active member | `check_access_review()` | `src/services/accounts.ts` (`submitAccessReview()`) | `tests/db/accounts.test.ts` |
| A contact stays with its client | `check_client_contact()` | `src/services/accounts.ts` | `tests/db/accounts.test.ts` |
| The departing-person report lists what someone still holds: open actions, clients and projects they lead and reviews only they can do (these block switching off), plus client roles and departments they head (these need an interim); closed projects are left out; only the admins who manage the person see it | `app_person_holdings_of()`, `app_person_holdings()`, `app_can_manage_person()` (migration 0027) | `src/services/accounts.ts` (`personHoldings()`) | `tests/db/people-leaving.test.ts` |
| Switching someone off is refused while they hold blocking work, and the firm always keeps one active admin; jobs without a person are not stopped | `check_departure()` | `src/services/accounts.ts` (`setActive()`) | `tests/db/people-leaving.test.ts` |
| A client with consultants always has a lead consultant, checked at commit so a lead can move in one transaction | `check_client_has_lead()` | database only | `tests/db/people-leaving.test.ts` |
| Handing work over goes to an active member of the same organisation in one step: actions (the new owner joins the team and is told), sole reviews, client and project leads, and client roles as the interim; audited with the counts | `app_hand_over()` | `src/services/accounts.ts` (`handOver()`) | `tests/db/people-leaving.test.ts` |

### Two-factor sign-in and mail

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Roles that require two-factor sign-in cannot switch it off | `check_two_factor_off()` | `src/authz/two-factor.ts`, `src/auth/auth.ts` | `tests/db/two-factor.test.ts` |
| A queued mail wakes the sender | `notify_outbound_email()` | database only | `tests/db/mail.test.ts` |
| Only known mail kinds are queued | `outbound_emails.outbound_kind` | `src/lib/mail-templates.ts` (`MAIL_KINDS`) | `tests/db/mail.test.ts`, `tests/db/rule-parity.test.ts` |
| Only an inquiry's mails carry a reference, and it is cleared once sent | `outbound_emails.outbound_reference` | `src/jobs/mail.ts` | `tests/db/intake.test.ts` |
| Meeting mail points at its meeting, and only meeting mail does | `outbound_emails.outbound_meeting` | database only | `tests/db/meetings.test.ts` |
| Send attempts are never negative | `outbound_emails.outbound_attempts` | database only | `tests/db/mail.test.ts` |
| An action owner is mailed (a line and a link) when their action needs them, at most hourly, when they chose "right away" and haven't muted the action | `mail_action_notification()` (migration 0019) | database only | `tests/db/mail.test.ts`, `tests/db/mail-choices.test.ts` |
| One summary mail a day at most (a line and a link): daily, or on Sunday for weekly, covering reminders and batched updates, never a muted action; not to anyone switched off or erased | `app_queue_digests()` (migration 0019), run by the daily job as the schema owner | `src/jobs/follow-ups.ts` (`runFollowUps()`) | `tests/db/follow-through.test.ts`, `tests/db/mail-choices.test.ts` |
| Work mail to a member waits for their sending time: never Friday, Saturday only if asked, outside quiet hours, and in the firm's Ramadan only in its Ramadan hours (profile on by default); account, security and meeting mail goes at once | `hold_work_mail()`, `app_mail_send_time()`, `app_mail_send_at()` | database only (the preferences page shows `app_my_next_mail_at()`) | `tests/db/mail-choices.test.ts` |
| Quiet hours are both set and different, or both empty; reminders have no "right away" | `mail_preferences.mail_quiet_hours`, `mail_preferences.mail_reminders_cadence` | `src/services/notifications.ts` (`setMailPreferences()`) | `tests/db/mail-choices.test.ts` |
| Each person reads and changes only their own mail preferences and mutes, and mutes only an action they can see | row-level security on mail_preferences (migration 0003) and mail_mutes (migration 0019) | `src/services/notifications.ts` (`setActionMuted()`) | `tests/db/follow-through.test.ts`, `tests/db/mail-choices.test.ts` |
| The reminder ladder on an action is shown only to someone who can see the action; firm staff alone see that mail to a person is failing, never the error | `app_action_ladder()`, `app_can_see_action()`, `app_mail_failing()` | `src/services/follow-through.ts` (`actionLadder()`, `mailFailing()`) | `tests/db/mail-choices.test.ts` |

### Meetings

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Call links are https on Meet, Teams or Zoom; a meeting keeps its project, organiser and calendar id; status moves; held or cancelled meetings don't move; consent is recorded by the database | `check_meeting()` | `src/lib/meetings.ts` (`callProvider()`), `src/services/meetings.ts` | `tests/db/meetings.test.ts`, `tests/db/rule-parity.test.ts` |
| A meeting ends after it starts | `meetings.meeting_times` | meeting forms, `src/services/meetings.ts` | `tests/db/meetings.test.ts` |
| An online meeting has a call link | `meetings.meeting_online_link` | `src/services/meetings.ts` | `tests/db/meetings.test.ts` |
| A meeting's language is Arabic, English or mixed | `meetings.meeting_spoken_lang` | `src/lib/meetings.ts` (`SPOKEN_LANGS`) | `tests/db/rule-parity.test.ts` |
| Attendees can open the project (firm staff for firm-private meetings); contacts belong to the client; an attendee only answers | `check_attendee()` | `src/services/meetings.ts` (`addAttendee()`, `respond()`) | `tests/db/meetings.test.ts` |
| Decisions and summaries stay with their meeting and are never more visible than it; a summary needs a held meeting | `check_meeting_record()` | `src/services/meetings.ts` (`recordDecision()`, `saveSummary()`) | `tests/db/meetings.test.ts` |
| Decisions and summaries are Arabic or English; a summary is manual or a confirmed AI draft | `meeting_decisions.decision_lang`, `meeting_summaries.summary_lang`, `meeting_summaries.summary_source` | `src/app/api/meetings/[id]/decisions/route.ts`, `src/app/api/meetings/[id]/summary/route.ts` | `tests/db/meetings.test.ts` |
| Notes and follow-ups that point at a meeting stay in its project | `check_meeting_links()` | `src/services/meetings.ts` | `tests/db/meetings.test.ts` |
| Follow-ups from a meeting: kept in place, assignee can open the project, the assignee only marks done | `check_follow_up()` | `src/services/meetings.ts` (`addFollowUp()`, `updateFollowUp()`) | `tests/db/meeting-screens.test.ts` |

### Transcripts

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Imported only for a held meeting with consent recorded; deleted on schedule | `check_meeting_transcript()` | `src/services/meetings.ts` (`importTranscript()`) | `tests/db/transcripts.test.ts` |
| Language, format and size | `meeting_transcripts.transcript_lang`, `meeting_transcripts.transcript_format`, `meeting_transcripts.transcript_size` | `src/lib/meetings.ts`, `src/lib/transcripts.ts` | `tests/db/rule-parity.test.ts` |
| Imports and deletions are logged without the text | `log_meeting_transcript()` | database only | `tests/db/transcripts.test.ts` |
| Withdrawn consent deletes the transcript | `transcript_consent_withdrawn()` | database only | `tests/db/transcripts.test.ts` |
| A confirmed summary starts the transcript's deletion clock | `transcript_summary_confirmed()` | database only | `tests/db/transcripts.test.ts` |
| How long transcripts are kept | `firm_settings.transcript_keep_days` | `src/lib/firm-settings.ts` | `tests/db/rule-parity.test.ts` |

### Engagement modes and departments

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Only the firm admin changes how a client takes part; a mode is entered only when the accounts fit it | `check_organization_change()` | `src/services/engagement.ts` (`setEngagement()`) | `tests/db/engagement.test.ts` |
| Mode changes are audited | `log_organization_change()` | database only | `tests/db/engagement.test.ts` |
| Only clients have a mode and departments | `organizations.engagement_mode_clients`, `organizations.departments_clients` | `src/services/engagement.ts` | `tests/db/engagement.test.ts` |
| Client accounts fit the mode, when joining and when invited | `check_membership_mode()`, `check_invitation_mode()`, `app_check_client_account()` | `src/services/accounts.ts` (`invite()`) | `tests/db/engagement.test.ts` |
| A restricted client's admin limit | `firm_settings.restricted_max_admins_range` | `src/lib/firm-settings.ts` | `tests/db/rule-parity.test.ts` |
| Who recorded progress and evidence, from the author's organisation; the firm records for a client only when it manages the engagement | `set_record_source()` | `src/services/progress.ts`, `src/services/evidence.ts` | `tests/db/engagement.test.ts` |
| Evidence points at a file the firm can open, and takes its action's department | `check_evidence_document()` | `src/services/evidence.ts` | `tests/db/engagement.test.ts` |
| In a restricted engagement, client uploads stay client-private until shared; sharing is one-way | `check_document_label()` | `src/services/documents.ts` (`shareDocument()`) | `tests/db/engagement.test.ts` |
| Only the side that owns a file changes its label or assistant flag; a file shared on a client project stays shared; evidence is shared only by submitting it; sharing a firm file is recorded in the history | `check_document_manage()` | `src/services/documents.ts` (`fileControls()`, `shareDocument()`, `setAssistantFlag()`) | `tests/db/file-controls.test.ts` |
| A new version keeps its file's project, owner, purpose, label and department, takes the next number, comes from the owning side, and never versions evidence; each file has at most one next version | `check_document_version()` | `src/services/documents.ts` (`uploadNewVersion()`) | `tests/db/file-controls.test.ts` |
| An old version leaves the assistant when the next one arrives | `retire_old_version()` | database only | `tests/db/file-controls.test.ts`, `tests/db/ai-sources.test.ts` |
| Departments belong to a client and stay with it | `check_department()` | `src/services/engagement.ts` (`createDepartment()`) | `tests/db/engagement.test.ts` |
| Department members are the client's own active people; a person may sit in several departments | `check_department_member()` | `src/services/engagement.ts` (`putDepartmentMember()`) | `tests/db/engagement.test.ts` |
| Actions and files are filed under an active department of their client | `check_row_department()` | `src/services/plan.ts` | `tests/db/engagement.test.ts` |
| A passage takes its source's department; refiling drops it from the index | `set_chunk_department()`, `drop_department_chunks()` | database only | `tests/db/engagement.test.ts` |
| Recommendations and meetings are filed under an active department of their client, or none; a recommendation keeps a department switched off since, but can't be moved to one | `check_row_department()` | `src/services/plan.ts` (`checkRecommendationScope()`), `src/services/plan-changes.ts` (`updateRecommendation()`), `src/services/meetings.ts` | `tests/db/engagement.test.ts` |
| A department's recommendation is read at the client by that department, the client's admins, its accountable person and whoever owns one of its actions | `app_dept_ok()`, `app_owns_action_under()` | `src/services/queries.ts` | `tests/db/engagement.test.ts` |
| A restructure moves a department's unfinished work (recommendations with work left or none planned, whole; unfinished actions under company-wide ones; their evidence) to another active department of the same client, keeps finished work and closed projects where they were, logs it on each project and in the audit log, and is the firm admin's alone | `app_move_department_work()` | `src/services/engagement.ts` (`moveDepartmentWork()`) | `tests/db/department-move.test.ts` |
| The accountable person for a recommendation is a client admin, or someone at the client staffed on the project | `check_recommendation_accountable()` | `src/services/plan.ts` (`planOptions()`, `checkRecommendationScope()`), `src/services/plan-changes.ts` (`updateRecommendation()`) | `tests/db/engagement.test.ts` |
| An action takes its recommendation's department and is refiled with it | `check_action_department()`, `recommendation_refiled()` | `src/app/(app)/projects/[id]/plan-dialogs.tsx` (`ActionDialog`) | `tests/db/engagement.test.ts` |
| A department's meeting gets that department's agenda, and keeps its department | `meeting_department()`, `app_meeting_agenda()` | `src/components/meeting-form.tsx` | `tests/db/engagement.test.ts` |

### Minimal records and insight

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Minimal records: consultant-managed clients only, with an alias, set by the firm admin | `check_minimal_records()` | `src/services/engagement.ts` (`setEngagement()`) | `tests/db/insight.test.ts` |
| A minimal-records client has no files, contacts, passages, summaries or account owners | `refuse_minimal_records()` | `src/services/plan.ts`, `src/services/files.ts` | `tests/db/insight.test.ts` |
| Switching on minimal records anonymises the client's inquiry | `forget_client_inquiries()` | database only | `tests/db/insight.test.ts` |
| Free text is purged after handover | `firm_settings.minimal_purge_days_range`, `app_purge_minimal_records()` | `src/lib/firm-settings.ts` | `tests/db/insight.test.ts`, `tests/db/rule-parity.test.ts` |

### Assessments

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Notes on answers take their answer's project and author | `check_assessment_note()` | database only | `tests/db/assessments.test.ts` |
| Template authors are active consultants of the firm; changes are logged | `check_template_author()`, `log_template_author()` | `src/services/assessments.ts` (`addTemplateAuthor()`) | `tests/db/assessments.test.ts` |
| A template stays with its firm | `check_assessment_template()` | `src/services/assessments.ts` | `tests/db/assessments.test.ts` |
| Versions are numbered, start as drafts, publish once complete, and never change once published; changes are logged | `check_template_version()`, `log_template_version()` | `src/services/assessments.ts` (`publishVersion()`, `startDraft()`) | `tests/db/assessments.test.ts` |
| Sections and questions change only in a draft, and questions have a valid shape | `check_template_content()` | `src/lib/assessment-schemas.ts`, `src/services/assessments.ts` | `tests/db/assessments.test.ts` |
| Only the firm admin records a client's legal form; only clients have one | `check_legal_form()`, `organizations.legal_form_clients` | `src/services/assessments.ts` (`setLegalForm()`) | `tests/db/assessments.test.ts` |
| A legal profile is for a client; a minimal-records client keeps no legal names or unified number; a listed market needs the listed joint stock company form, checked from both the profile and the client record | `check_client_profile()`, `check_org_against_profile()` | `src/services/client-profile.ts` (`setClientProfile()`, which orders the two writes) | `tests/db/client-profile.test.ts` |
| The firm admin and the client's lead keep the legal profile; firm staff who see the client and the client's admins and managers read it | `app_can_edit_client_profile()` (the insert and update policies) | `src/services/client-profile.ts` (`canEdit`) | `tests/db/client-profile.test.ts` |
| The unified number is 7 then nine digits, and belongs to one client; the ISIC code is four to six digits | `client_profiles.client_profile_unified_number`, `client_profiles.client_profile_isic` and a unique index | `src/lib/client-profile.ts` (`UNIFIED_NUMBER`, `ISIC_CODE`) | `tests/db/client-profile.test.ts` (parity) |
| An assessment is of a client project, on a published live template, with the client's legal form; final is final | `check_assessment()` | `src/services/assessments.ts` (`createAssessment()`) | `tests/db/assessments.test.ts` |
| Every question gets an answer row with its basis; changes are logged | `make_assessment_answers()`, `log_assessment()` | database only | `tests/db/assessments.test.ts` |
| Answers change only in a draft, and only to a value the question has | `check_assessment_answer()` | `src/services/assessments.ts` | `tests/db/assessments.test.ts` |
| Evidence for an answer is a firm-visible file of the project, while the assessment is a draft | `check_assessment_evidence()` | `src/services/assessments.ts` | `tests/db/assessments.test.ts` |
| A finding from an assessment points at a gap of a final assessment of the same project | `check_finding_answer()` | `src/services/assessments.ts` | `tests/db/assessments.test.ts` |
| Scores are firm-only | `app_assessment_scores()`, `app_assessment_results()` | `src/services/assessments.ts` | `tests/db/assessments.test.ts` |

### Translations

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| At most 200 translations a person an hour; a review changes only the text | `check_translation()` | `src/services/translations.ts` | `tests/db/translations.test.ts` |
| Editing or deleting a source deletes its translations | `drop_translations()` | `src/lib/translations.ts` (`TRANSLATABLE`) | `tests/db/translations.test.ts`, `tests/db/rule-parity.test.ts` |
| Arabic to English or back; hash, length and review stamps | `content_translations.translation_langs`, `content_translations.translation_hash`, `content_translations.translation_text`, `content_translations.translation_reviewed` | `src/lib/translations.ts` | `tests/db/translations.test.ts`, `tests/db/rule-parity.test.ts` |

### AI sources and assistant chats

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| A file's text status and scanned pages are set only by the indexing job; a change that sends the file back to the job clears them | `check_text_status()` | database only | `tests/db/ai-sources.test.ts` |
| File summaries cite pages for every line, at most 30 a person an hour; they go with the file's flag, label, archive or a new version | `check_document_summary()`, `drop_document_summaries()` | `src/services/document-summaries.ts` | `tests/db/ai-sources.test.ts` |
| A summary line's source is a passage of this meeting or a page of a project file; rewriting the summary retires them | `check_summary_source()`, `drop_summary_sources()` | `src/services/meetings.ts` (`addSummarySource()`) | `tests/db/ai-sources.test.ts` |
| Messages are Arabic or English; passage pages start at 1 | `ai_messages.ai_message_lang`, `ai_chunks.ai_chunk_page` | `src/services/assistant.ts` | `tests/db/ai-sources.test.ts` |
| A chat stays in its project; its case is a record of that project the owner can see | `check_chat()` | `src/services/assistant.ts` | `tests/db/assistant-chats.test.ts` |
| A new message brings a chat back from the archive | `touch_chat()` | database only | `tests/db/assistant-chats.test.ts` |
| Deleting a record unlinks the chats about it | `unlink_chat_case()` | database only | `tests/db/assistant-chats.test.ts` |
| A project's closing time is set by the database | `set_project_closed_at()` | database only | `tests/db/assistant-chats.test.ts` |
| Chat archive and deletion periods | `firm_settings.chat_archive_days_range`, `firm_settings.chat_after_close_days_range`, `firm_settings.chat_idle_delete_days_range` | `src/lib/firm-settings.ts` | `tests/db/rule-parity.test.ts` |
| A record's passage goes when its text, label or record goes | `drop_record_chunks()` | database only | `tests/db/ai-sources.test.ts` |

### Firm settings and names for masking

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| The intake address looks like an address | `firm_settings.intake_email_format` | `src/app/api/firm/settings/route.ts` | `tests/db/firm-settings.test.ts` |
| This year's Ramadan runs 29 or 30 days (both dates or neither), and its mail hours run forward | `firm_settings.ramadan_dates`, `firm_settings.ramadan_mail_hours` | `src/app/(app)/settings/settings-form.tsx`, `src/app/api/firm/settings/route.ts` | `tests/db/mail-choices.test.ts`, `tests/db/rule-parity.test.ts` |
| Ranges for grace, stale, review and check-in days | `firm_settings.kpi_grace_days_range`, `firm_settings.stale_days_range`, `firm_settings.access_review_days_range`, `firm_settings.checkin_days_valid` | `src/lib/firm-settings.ts` | `tests/db/firm-settings.test.ts`, `tests/db/rule-parity.test.ts` |
| Other-language names: 2 to 120 characters for people, 2 to 200 for contacts; erased with the person | `user.user_name_alt_len`, `client_contacts.contact_name_alt_len`, `erase_name_alt()` | `src/lib/masking.ts` (`NAME_ALT_LENGTH`) | `tests/db/assistant-chats.test.ts`, `tests/db/rule-parity.test.ts` |
| Up to 6 short names of 2 to 100 characters, set by the firm admin | `check_short_names()` | `src/lib/engagement.ts` (`SHORT_NAMES`), `src/services/engagement.ts` | `tests/db/rule-parity.test.ts` |

## Left as they are

- **Messages.** The service and the trigger word the same refusal differently (the service: "a released action needs an owner and a due date"; the trigger: its own sentence). Merging them would change what the API returns (a 400 with the service's words, versus a 409 with the trigger's), which the feature freeze rules out. They describe the same rule, and the tables above pair them.
- **Row-level security and `authorize()`**, for the reason given at the top.
