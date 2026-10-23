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
| Firm setting defaults | `FIRM_SETTING_DEFAULTS` in `src/services/firm-settings.ts` | settings API and page | column defaults, `app_checkin_days()`, `app_restricted_max_admins()` | `tests/db/rule-parity.test.ts` |
| Call link hosts | `callProvider()` in `src/lib/meetings.ts` | meeting forms | `check_meeting()` | `tests/db/rule-parity.test.ts` |
| Meeting and transcript languages | `SPOKEN_LANGS` in `src/lib/meetings.ts` | meeting and transcript routes, `src/services/meetings.ts` | `meetings.meeting_spoken_lang`, `meeting_transcripts.transcript_lang` | `tests/db/rule-parity.test.ts` |
| Transcript formats and length | `TRANSCRIPT_FORMATS`, `TRANSCRIPT_MAX_CHARS` in `src/lib/transcripts.ts` | transcript route and panel, `importTranscript()` | `meeting_transcripts.transcript_format`, `meeting_transcripts.transcript_size` | `tests/db/rule-parity.test.ts` |
| Mail kinds | `MAIL_KINDS` in `src/lib/mail-templates.ts` | the mail job | `outbound_emails.outbound_kind` | `tests/db/rule-parity.test.ts` |
| Translatable fields | `TRANSLATABLE` in `src/lib/translations.ts` | `src/services/translations.ts`, translation routes | `app_translation_source()`, `drop_translations()` triggers | `tests/db/rule-parity.test.ts` |
| Translation length | `TRANSLATION_MAX_CHARS` in `src/lib/translations.ts` | `src/app/api/translations/[id]/route.ts` | `content_translations.translation_text` | `tests/db/rule-parity.test.ts` |
| Other-language name length | `NAME_ALT_LENGTH` in `src/lib/masking.ts` | name-alt and contact routes | `user.user_name_alt_len`, `client_contacts.contact_name_alt_len` | `tests/db/rule-parity.test.ts` |
| Client short names | `SHORT_NAMES` in `src/lib/engagement.ts` | `setShortNames()` | `check_short_names()` | `tests/db/rule-parity.test.ts` |
| The firm's time zone and "today" | `FIRM_TIME_ZONE`, `firmToday()` in `src/lib/dates.ts` | every service, job and the date formatting | `app_firm_tz()`, `app_firm_today()`, `app_firm_date()` (migration 0002), used by every function and view that needs the day. Never current_date, which is the database's UTC day | `tests/db/rule-parity.test.ts` (also fails if a function or view spells out the zone again) |
| Open actions (released, not finished) | `OPEN_STATUSES` in `src/authz/workflow.ts` | `isOverdue()`, the assistant's status answer | `app_action_open()` (migration 0002), used by the deviation, reminder, mail and metrics functions | `tests/db/rule-parity.test.ts` |

Enums (`action_status`, `role`, `visibility` and the rest) and the check constraints declared in `src/db/schema` have one source already: the Drizzle schema, from which part 1 of the baseline is generated.

## Rules by area

Database names are trigger functions (`name()`) or check constraints (`table.name`). "Checked first in" is the TypeScript that gives the clear answer, or "database only" when nothing in the app writes the row in a way that could break the rule. "Tests" names the database test files that run the rule. For every trigger function this was checked on 2026-10-23 from Postgres's own call counts (`pg_stat_user_functions`) per test file. For a check constraint, the file writes that column; several constraints are only exercised on their passing side.

### Security and history

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| History tables (progress, evidence, reviews, activity, audit, snapshots, AI drafts, inquiry events, access reviews, meeting decisions) are append-only; only the purge job blanks text | `forbid_change()` | database only | `tests/db/rls.test.ts` |
| Firm roles only in the firm org, client roles only in client orgs | `check_membership_role()` | `src/services/accounts.ts`, `src/services/onboarding.ts` | `tests/db/rls.test.ts`, `tests/db/accounts.test.ts` |
| A project pairs the firm with one client (an internal project belongs to the firm) | `check_project_orgs()` | `src/services/staffing.ts` | `tests/db/rls.test.ts` |
| Action workflow: allowed moves, clients only move their own work, only the firm releases, reviews, closes and reopens, verified needs an accept of this round and every evidence item settled, risk acceptance needs a current client signature, reopening clears the closure | `check_action_transition()` | `src/authz/workflow.ts` (`TRANSITIONS`, `canTransition()`), `src/services/actions.ts` | `tests/db/follow-through.test.ts`, `tests/db/rule-parity.test.ts`, `tests/authorize.test.ts` |
| A document's passages leave the AI index when it is unshared, relabelled, archived, deleted or its AI flag goes off | `drop_document_chunks()` | database only | `tests/db/rls.test.ts`, `tests/db/ai-sources.test.ts` |

### Staffing

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Only consultants are assigned to clients | `check_assignment_role()` | `src/services/staffing.ts` | `tests/db/rls.test.ts` |
| A join request is decided once; only the decision changes | `check_join_request_update()` | `src/services/staffing.ts` (`decideRequest()`) | `tests/db/rls.test.ts` |

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

### Metrics and KPIs

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| The agreed due date is set at release and kept | `keep_baseline()` | database only | `tests/db/metrics.test.ts` |
| A KPI's objective and owner are in its project | `check_kpi()` | database only (no KPI screens yet) | `tests/db/metrics.test.ts` |
| KPI periods start on the 1st | `kpis.kpi_starts_on_first` | database only | `tests/db/metrics.test.ts` |
| A recommendation and its KPI share a project | `check_recommendation_kpi()` | database only | `tests/db/metrics.test.ts` |
| Readings: for active KPIs and started periods, verified or rejected once, never by their reporter; a correction replaces a reading of the same period | `check_kpi_reading()` | database only | `tests/db/metrics.test.ts` |

### Handover

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| The client sponsor is an active admin or manager of the client | `check_project_sponsor()` | `src/services/handover.ts` | `tests/db/handover.test.ts` |
| Setting the handover date schedules check-ins; moving it moves the open ones | `schedule_checkins()` | database only | `tests/db/handover.test.ts` |

### Intake

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| The public form is validated and rate-limited in one function; the app role cannot insert inquiries | `submit_inquiry()` | `src/app/api/inquiries/route.ts`, `src/services/intake.ts` | `tests/db/intake.test.ts` |
| Inquiry status moves, owner, conflict check before winning, jobs only anonymise | `check_inquiry_update()` | `src/services/inquiries.ts` | `tests/db/intake.test.ts` |
| Every status and owner change is logged, and the new owner told | `log_inquiry_update()` | database only | `tests/db/intake.test.ts` |
| A new inquiry mails the intake address a link | `mail_new_inquiry()` | database only | `tests/db/firm-settings.test.ts` |

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

### Two-factor sign-in and mail

| Rule | Database | Checked first in | Tests |
|---|---|---|---|
| Roles that require two-factor sign-in cannot switch it off | `check_two_factor_off()` | `src/authz/two-factor.ts`, `src/auth/auth.ts` | `tests/db/two-factor.test.ts` |
| A queued mail wakes the sender | `notify_outbound_email()` | database only | `tests/db/mail.test.ts` |
| Only known mail kinds are queued | `outbound_emails.outbound_kind` | `src/lib/mail-templates.ts` (`MAIL_KINDS`) | `tests/db/mail.test.ts`, `tests/db/rule-parity.test.ts` |
| Meeting mail points at its meeting, and only meeting mail does | `outbound_emails.outbound_meeting` | database only | `tests/db/meetings.test.ts` |
| Send attempts are never negative | `outbound_emails.outbound_attempts` | database only | `tests/db/mail.test.ts` |
| An action owner is mailed (a line and a link) when their action needs them, at most hourly | `mail_action_notification()` | database only | `tests/db/mail.test.ts` |

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
| Departments belong to a client and stay with it | `check_department()` | `src/services/engagement.ts` (`createDepartment()`) | `tests/db/engagement.test.ts` |
| Department members are the client's own active people, in one department | `check_department_member()` | `src/services/engagement.ts` (`putDepartmentMember()`) | `tests/db/engagement.test.ts` |
| Actions and files are filed under an active department of their client | `check_row_department()` | `src/services/plan.ts` | `tests/db/engagement.test.ts` |
| A passage takes its source's department; refiling drops it from the index | `set_chunk_department()`, `drop_department_chunks()` | database only | `tests/db/engagement.test.ts` |

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
| A file's text status is set only by the indexing job | `check_text_status()` | database only | `tests/db/ai-sources.test.ts` |
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
| Ranges for grace, stale, review and check-in days | `firm_settings.kpi_grace_days_range`, `firm_settings.stale_days_range`, `firm_settings.access_review_days_range`, `firm_settings.checkin_days_valid` | `src/lib/firm-settings.ts` | `tests/db/firm-settings.test.ts`, `tests/db/rule-parity.test.ts` |
| Other-language names: 2 to 120 characters for people, 2 to 200 for contacts; erased with the person | `user.user_name_alt_len`, `client_contacts.contact_name_alt_len`, `erase_name_alt()` | `src/lib/masking.ts` (`NAME_ALT_LENGTH`) | `tests/db/assistant-chats.test.ts`, `tests/db/rule-parity.test.ts` |
| Up to 6 short names of 2 to 100 characters, set by the firm admin | `check_short_names()` | `src/lib/engagement.ts` (`SHORT_NAMES`), `src/services/engagement.ts` | `tests/db/rule-parity.test.ts` |

## Left as they are

- **Messages.** The service and the trigger word the same refusal differently (the service: "a released action needs an owner and a due date"; the trigger: its own sentence). Merging them would change what the API returns (a 400 with the service's words, versus a 409 with the trigger's), which the feature freeze rules out. They describe the same rule, and the tables above pair them.
- **Row-level security and `authorize()`**, for the reason given at the top.
