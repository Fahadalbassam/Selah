# Selah: test coverage, gaps and priorities

Written 23 Nov 2026 from `main` at 818d544 (migrations to 0115). Sources: the team handbook (`docs/team/src/01-selah-handbook.md`), the workflows guide (`02`), the Selah map (`docs/selah-map.html`, 30 features, 8 sub-features), `docs/review/final-status.md` (sections 2 and 5), the testing guide, scenarios 1 to 21, and **13 new scenarios, 22 to 34**, written and run for this document (files in `docs/review/scenarios/`, screenshots outside the repo in `C:\Projects\selah-scenario-shots\<nn>\`).

**How the new scenarios were run.** On the lead's own copy (`SELAH_INSTANCE=lead`, app on port 3010), Arabic desktop, English where the screen differs, by a headless browser script (Playwright) that clicks the real controls, plus same-origin calls from inside each signed-in session for the "should be denied" checks. Every shortcut that is not a user action is named in its scenario file. Page times are from the development server and say nothing about production. The scenarios were run by an AI helper, not by consultants or clients.

**What did not run on this copy.** The assistant never produced an answer (its model service returned an error for every question), so assistant quality and translation on demand are **not tested**. Two-step sign-in was set up with a code computed from the shown key, not with a phone. Two-step is not forced on this copy. No purge job (chats, transcripts, closed inquiries, archived clients, old audit rows) was run. The isolation sweep (scenario 19) is still not done.

## 1. Coverage: what each scenario tested

"Old" scenarios are 1 to 21 (run on copies A to D, 20 Nov). "New" are 22 to 34 (lead copy, 23 Nov). "None" means no scenario touched it. "Partly" means a scenario used it but did not test it.

### Firm side

| Feature (map id) | Scenarios | Notes |
|---|---|---|
| Sign-in, invitation, first-sign-in notices (F01) | 28 (new) | Invitation, notices, reset, sign-in link, lock-out, two-step: tested. Two-step **required** for roles: not run (setting off locally). Sign-in with a real device: not run. |
| Authorization core, "Not found" (F02) | every scenario; 19 (not finished) | Isolation sweep unfinished. Every new scenario has "should be denied" checks and none leaked. |
| Home per role (F03) | 2, 3, 17 | |
| Clients: add, team, lead and deputy, mode (F04) | 1, 6, 7, 8, 16 | Restricted mode: none. |
| Join requests, watch (F04) | 17 (read only), 34 (new) | Watch: API only. |
| Departments (F05) | 21, partly 9, 13, 20 | Department-limited manager's Meetings tab: found in review, not in a scenario. |
| Client groups (F06) | 16 | |
| Engagements and end reminder (F07) | 15 | |
| Deliverable hand-over and receipt (F07) | 25, 32 (new) | Firm-run client's recorded receipt: not run. |
| Inquiries inbox, conflict check, NDA, discovery (F08) | 1, 16, 17, 23 (new) | Win into a client: 1 and 16 (23 opened the dialog only). |
| Public inquiry form and its limits (F08) | 23 (new) | |
| Pitches (F08) | 23 (new) | Converting a pitch: not run. |
| Projects, plan, recommendations (F09) | 1, 2, 3, 22 (new) | |
| Plan import and export, Excel (F09, F29) | 1 (import), 24 (new) | Word import: none. |
| Assessments and templates (F17) | 22 (new) | Template building and publishing: none. Compare two assessments: none. |
| Org chart (F20) | 16, 20 | 20 failed at steps 10 to 12; fixed in #215, not re-run. |
| Actions: start, evidence, review, verify (F10) | 2, 3, 4, 31 (new) | |
| Second sign-off (F10) | 2, 3, 6, 31 (new) | |
| Date requests (F10) | 5 | |
| Blocked, risk acceptance (F10) | 4 | |
| Give an action to a colleague (F10) | 9 | |
| Document requests and no-login upload links (F11) | 34 (new, link only) | A client answering a request item with a file: none. |
| Files: labels, versions, scan (F12) | 21, 25, 32 (new) | Virus refusal, odd types, size, versions, one-minute link: tested. Scanner-down behaviour: none. |
| Who sees an item (F13) | 21 | |
| Meetings, agenda, summaries, decisions, transcripts (F14) | 10 | Translating a summary: none. |
| Reports, templates, approval, confirmed send (F15) | 11, 13 | |
| Monthly status pack (F15) | 11 (partly) | |
| Business indicators (F16) | 12 | |
| Indicator "moved away" notice (F16) | 26 (new) | Target-date case, file import, sheet read: none. |
| Project closing (F18) | 14 | |
| Archiving, export pack, holds (F19) | 15 | Hold placed and released: 30 (new). A purge: none. |
| Assistant, staff side (F21.1) | 13 | Value test not run. |
| Assistant, client side, offer and consent (F21.2) | 13, 16, 27 (new) | Answers: not obtained in 27. |
| @-attach, progress draft (F21.3, F21.4) | 13 | |
| Search, masking, AI service (F21.5) | 13 | |
| Background AI jobs (F21.6) | 20 (org chart draft) | Translation and summary jobs: none. |
| Number scanner (F21.7) | none | |
| Help, guides, tooltips (F22) | 1, 2, 7, 14, 18 (Help page) | Role guides: partly. |
| Notifications and mail, hours, choices (F23) | 1, 2, 3, 33 (new) | Daily and weekly digest content: none. |
| Audit log, CSV, chain check (F24) | 29 (new); 4, 6, 21 (rows) | |
| Scheduled jobs (F25) | 15 (reminder), 26, 29, 33 (run by hand) | None scheduled on this copy. |
| Pre-go-live script (F26) | none | Written, not run. |
| Firm settings, team, expertise (F27) | 1 (expertise), 30, 31, 33 (new) | |
| Team load (F27, F28) | 31 (new) | |
| Oversight lists, Projects table (F28) | 2, 17 | |
| Exports and PDFs (F29) | 11, 14, 15, 20, 24 (new), 29 (new) | Language of exports: 24. |
| Retention and deletion: settings, erasing a person, legal hold (F19, F27, F01) | 30 (new), 15 | |
| Access review (F01) | 34 (new) | |
| Platform, tests, deployment (F30) | none | Not a scenario matter (testing guide). |
| Legal pages, security pack (F22) | 34 (new) | Not lawyer-reviewed. |
| Translation on demand (F21.6) | none (34 tried) | Not run. |

### Client side

| Feature | Scenarios | Notes |
|---|---|---|
| Home, answer recommendations (F03, F09) | 2, 7, 17 | |
| Plan, actions as the client sees them (F09, F10) | 2, 3, 4, 5, 9 | |
| Owner work: start, evidence, stuck, more time (F10) | 2, 3, 4, 5 | |
| Risk acceptance (F10) | 4 | |
| Team, invitations, switch off, access review (F01) | 9, 34 (new), 28 (new) | |
| Departments, "Our group" (F05, F06) | 16, 21 | |
| Business indicators (F16) | 12, 26 (new) | |
| Structure (F20) | 20 | |
| Assistant: consent, ask (F21.2) | 13, 27 (new) | Answers not obtained in 27. |
| Deliverables: confirm receipt or comment (F07) | 25 (new) | |
| Shared assessment (F17) | 22 (new) | |
| Documents asked of you; upload link (F11) | 34 (new, link) | |
| Help page, ask your consultant (F22) | 7 | |
| Client audit log (F24) | 29 (new) | |
| Mail choices (F23) | 33 (new) | |
| First sign-in notices, reset, sign-in link, two-step (F01) | 28 (new) | |
| Restricted-client work (F04) | none | |
| Download the export pack on leaving (F19) | 15 | |
| Their own report page | not built | |

**Features nobody tested:** restricted-client mode; the number scanner; the pre-go-live script; translation on demand; Word import; template building; converting a pitch; document-request answering by a client; scanner-down behaviour; daily and weekly mail digests; any purge job; real two-step enforcement; the isolation sweep (19).

## 2. The 13 new scenarios

Steps are counted from each file's step table (a rough count). "Denied" is the number of rows in its "should be denied" table (each row can cover several accounts). **One privacy finding in the 13: G05 (scenario 32), a new file version keeps the assistant flag.** Every "should be denied" check was refused as expected (an independent reviewer re-ran 32 of them and agreed).

| # | Scenario | Pass / friction / fail / not run | Denied rows | Short result |
|---|---|---|---|---|
| 22 | Governance assessment | 4 / 3 / 0 / 1 | 14 | Works. Finalise and share give no warning and no client notice. |
| 23 | Inquiry to discovery, and a pitch | 9 / 4 / 0 / 0 | 14 | Works. Owner dialog default, date fields, no sign the decline mail went. |
| 24 | Excel import and export | 8 / 1 / 1 / 0 | 11 | Formula text stays text. `?lang=en` ignored. |
| 25 | Deliverable receipt | 8 / 2 / 1 / 0 | 10 | Firm not told of a receipt (told of a comment). |
| 26 | Indicator moved away | 8 / 0 / 0 / 0 (+1 note) | 8 | Once per period holds. Bell only, no mail. |
| 27 | Assistant switches and consent | 7 / 3 / 0 / 0 | 7 | Switches and consent work. **No answer obtained.** |
| 28 | Sign-in, links, lock-out, two-step | 14 / 2 / 1 / 0 | 9 | Works. A refused e-mail domain gives the wrong reason. |
| 29 | Audit log | 8 / 0 / 1 / 0 | 8 | Tamper found. A broken chain tells nobody. |
| 30 | Retention, erasing, legal hold | 9 / 1 / 1 / 0 | 5 | Erasure and hold work. Erasure reason shown to the client. No purge run. |
| 31 | Team load, expertise, second reviewer | 9 / 1 / 0 / 0 | 9 | Works. Scenario 1's expertise finding is fixed. |
| 32 | File versions and upload scanning | 7 / 1 / 0 / 0 (+1 note) | 7 | Virus refused. The assistant switch follows a file to a new version. |
| 33 | Notifications and mail hours | 11 / 0 / 2 / 0 | 5 | Rules hold. A held mail shows no sign on the notice. |
| 34 | Legal pages, upload link, join request, access review | 8 / 4 / 0 / 0 | 9 | Works. The AI notice contradicts the client assistant. |

## 3. Gaps and polish

**Type.** *Logic gap*: a step or a notice is missing or wrong. *Polish*: it works but is confusing.
**Class** (the order of section 4): **1** privacy or consent, **2** someone is left uninformed, **3** wrong numbers or wrong answer, **4** confusing control, **5** looks and accessibility.
**Seriousness**: High, Medium, Low. "Old" = found in scenarios 1 to 21 or in final-status section 5; "new" = found in 22 to 34. "Fixed?" marks an old finding I re-checked.

| ID | Feature | Role affected | Scenario and step | Type | Class | Serious | One-line fix |
|---|---|---|---|---|---|---|---|
| G01 | Meeting decisions and follow-ups start SHARED with the client; the summary already starts firm-only and its label shows the current state (F14) | Firm consultant, client | 10, summary step (old); record-panels.tsx lines 299 and 378 | Logic | 1 | Medium | Default decisions and follow-ups to firm-only and label the effect of the switch. |
| G02 | The AI notice says the assistant is not available to client people (F22, F21.2) | Client admin | 34 step 1 (new) | Logic | 1 | High | Rewrite `/legal/ai` for the client assistant, bump the notice version. |
| G03 | The security page lists a second-site encrypted backup with the key off the server (F22) | IT teams | 34 step 1 (new) | Logic | 1 | High | Show those lines only when the setting exists, or say "planned". |
| G04 | The erasure reason typed by the firm admin is shown to the client admin; the free-text reason also stays on the erased person's own row (`0000_baseline.sql`), not only on the membership (F01) | Client admin | 30 step 7 (new) | Logic | 1 | Medium | Show "Account erased" only; keep the reason in the firm's log and clear it from the person's row. |
| G05 | **A real bypass.** A new file version keeps the assistant flag (`documents.ts:245`, `aiIndexable: old.aiIndexable`). The uploader-or-admin rule in `0108_privacy_batch.sql` fires only on UPDATE, so any staffed firm consultant or a client manager can put new content into the assistant without consent, and the personal-number notice is skipped (F12, F21) | Client and firm | 32 step 5 (new) | Logic | 1 | High | A trigger on INSERT of a version that sets the flag off unless the uploader may switch it on. |
| G06 | Isolation sweep (scenario 19) not finished (F02) | Everyone | final-status §5 (old) | Logic | 1 | High | Run it on every copy, by someone other than the builders. |
| G07 | "Not found" pages answer HTTP 200. No existence leak: a forbidden record and a made-up id give the same page and status (F02) | Testers, monitors | 13, 23 to 34 (old, new) | Polish | 4 | Medium | Return 404 (the sweep needs it to tell found from not found). |
| G08 | Old audit rows keep some private file names until the clean-up script runs (F24, F26) | Client | final-status §5 (old) | Logic | 1 | High | Run `pre-go-live:clean-private-names` once before go-live. |
| G09 | A name that appears only inside a file is not masked; real files go only to a local model (F21.5) | Client | handbook §10 (old) | Logic | 1 | High | Keep the "local only" rule enforced; show the model's place on the client page. |
| G10 | Legal texts not reviewed by a lawyer; hosting, retention, duties not confirmed (F22) | Everyone | production path (old) | Logic | 1 | High | Lawyer review before go-live. |
| G11 | Go-live items open: sending domain, second backup disk, key off the server, restore drill, outside penetration test, tunnel never run live (F30) | Operator | final-status §5 (old) | Logic | 1 | High | Work the go-live checklist. |
| G12 | Assessment guidance written for the consultant is shown to the client (F17) | Client | after-scenarios list (old); 22 JSON (new) | Logic | 1 | Medium | Split consultant guidance from client wording. |
| G13 | The two-step setup response carries the key and ten backup codes before the first code is checked (F01) | Anyone setting up | 28 step 15 (new) | Polish | 1 | Low | Return the codes only after the code is verified. |
| G14 | Broken audit chain tells nobody (F24) | Firm admin | 29 step 7 (new) | Logic | 2 | High | Bell and mail to every firm admin when the check fails. |
| G15 | The client is not told when the consultant changes; Help is the only place (F04) | Client | 6, 7 (old) | Logic | 2 | Medium | Re-run after #199; add a Home line for the client admin. |
| G16 | Owner change tells only the new owner; no "owner changed" history line (F10) | Lead, consultants, old owner | 9 step 4 (old) | Logic | 2 | Medium | Tell the lead and project consultants; write the history line. |
| G17 | Declining a date request carries no reason or meeting offer (F10) | Owner | 5 step 4 (old) | Logic | 2 | Medium | Add a reason box and an "offer a meeting" option. |
| G18 | Approving or declining a join request: no confirm, no reason (F04) | Consultant | 34 steps 8, 9 (new) | Logic | 2 | Medium | Ask for a reason when declining; confirm both. |
| G19 | Sharing an assessment sends the client no notice and asks no confirm (F17) | Client, lead | 22 step 5 (new) | Logic | 2 | Medium | Confirm, then notify the client admins. |
| G20 | Sharing a report sends the client no notice (F15) | Client | 11 (old) | Logic | 2 | Medium | Notify the readers when a report is sent. |
| G21 | The firm is not told when the client confirms receipt of a deliverable (F07) | Lead, deputy, admin | 25 step 8 (new) | Logic | 2 | Medium | Add a bell notice, as for a comment. |
| G22 | A held work mail gives no sign on the notice or in the bell; only the mail-choices page says when mail goes (F23) | Everyone | 1, 2, 3, 33 step 6 | Logic | 2 | Medium | Show "mail waits until 07:00" on the notice. |
| G23 | A reopened project sends no notice to the client admin (F18) | Client admin | 14 (old) | Logic | 2 | Medium | Notify on reopen. |
| G24 | An invitation to an address outside the company's domains reports "already done or changed by someone else" (F01) | Client admin, firm admin | 28 step 1 (new) | Logic | 2 | Medium | Say "this address is not on your company's list". |
| G25 | Archived client: sign-in message does not say what to do; reply and "I will attend" offered and refused with the wrong reason (F19) | Client | 15 (old) | Logic | 2 | Medium | Say "ask the firm", and hide the buttons. |
| G26 | A department-limited manager's Meetings tab reads "none for you yet" although invited (F14) | Client manager | final-status §5 (old) | Logic | 2 | Medium | Show the invited meetings. |
| G27 | The firm's card does not say the client stopped the client assistant, or when (F21.2) | Firm admin | 27 step 8 (new) | Logic | 2 | Low | Show "stopped by the client on <date>". |
| G28 | After the decline mail is sent for an inquiry, nothing on screen says so (F08) | Firm admin | 23 step 10 (new) | Logic | 2 | Low | Add a toast and a log line. |
| G29 | The access review refuses (hand over first) in English, loses the rest of the review, offers no hand-over (F01) | Client admin | 34 step 11 (new) | Logic | 2 | Medium | Name the open work in Arabic and link to the hand-over. |
| G30 | Plan import: nothing shows after confirming what was created (F09) | Lead | 24 step 8 (new) | Polish | 2 | Low | Say "1 finding, 1 recommendation, 3 draft actions added" with a link. |
| G31 | The progress draft disagrees with the project page (0 verified, 1 late against 1 of 8 and 3 late) (F21.4) | Consultant | 13 step 5 (old) | Logic | 3 | High | Build the draft from the same query as the Progress tab. |
| G32 | Closure PDF total off by one (F18, F29) | Lead, client | 14 (old) | Logic | 3 | Medium | Fix the count and add a test. |
| G33 | The report PDF header date can show the previous day (UTC) (F15) | Client | 11 (old) | Logic | 3 | Medium | Use the firm's day. |
| G34 | An attached file that cannot be read is answered as if it were another file (F21.3) | Consultant | 13 step 6 (old) | Logic | 3 | High | Say the attachment was skipped. |
| G35 | A scanned page produced an invented, cited answer (F21.1) | Consultant | assistant test set N28 (old) | Logic | 3 | High | Refuse when a page has no text; do text recognition later. |
| G36 | The 4B model mislabels "due this week", fails follow-ups across clients, shows echo answers as grounded (F21) | Consultant | test set (old) | Logic | 3 | Medium | Compute "this week" in code; mark echo answers. |
| G37 | Org chart draft from pasted text gave 0 units after 135 s (F20) | Consultant | 20 (old) | Logic | 3 | Medium | Check the job output; show why it gave nothing. |
| G38 | Org chart could not be edited after publishing (F20) | Lead | 20 steps 10 to 12 (old) | Logic | 3 | High | **Fixed in #215; not re-run.** Re-run scenario 20. |
| G39 | The same export asked for in English from an Arabic screen keeps Arabic headers (F29) | Anyone | 24 step 2 (new) | Polish | 3 | Low | Honour `?lang=`, or drop the parameter. |
| G40 | The release-now switch defaults to ON and caused saved drafts, hard to see in dark mode (F09) | Consultant | 18 step 0c, twice (old) | Polish | 4 | High | Default off; label what happens. |
| G41 | Finalising an assessment: the confirm says nothing about open questions; the refusal is a vanishing toast; no question is marked (F17) | Consultant | 22 step 1 (new) | Polish | 4 | Medium | Count open questions in the confirm and mark them. |
| G42 | Server refusals appear in English on Arabic screens (systemic): 22, 25, 26, 28, 30, 31, 33, 34 | Everyone | many (new) | Polish | 4 | Medium | Map every server message to a translated one in one place. |
| G43 | Retention settings: "refused by a data rule" names no field; out-of-range values give no sentence (F27) | Firm admin | 30 steps 2, 4; 33 step 10 (new) | Polish | 4 | Low | Name the two fields and the rule. |
| G44 | Accepting an evidence item and signing off are two steps; the first try gets an English sentence and no item is named; "Accept" has no confirm (F10) | Consultant | 3, 4, 31 step 4 (old, new) | Polish | 4 | Medium | Show the open item; offer one combined step. |
| G45 | "Start work" on Home only opens the action (F10) | Owner | 2 (old) | Polish | 4 | Low | Make it start, or label it "Open". |
| G46 | The risk-acceptance Sign button is disabled with no message (F10) | Client | 3, 4 (old) | Polish | 4 | Low | Say why. |
| G47 | Start closing is only in the menu on an active project (F18) | Lead | 14 (old) | Polish | 4 | Low | Add a visible button. |
| G48 | The conflict dialog defaults to "conflict"; the owner dialog defaults to the first name, not the suggested ones (F08) | Admin | 1, 23 step 5, 6 | Polish | 4 | Medium | Default to "not yet checked" and to the first suggestion. |
| G49 | Date fields in the NDA and discovery dialogs cannot be typed (F08) | Admin | 23 step 7 (new) | Polish | 4 | Low | Allow typing. |
| G50 | "Make lead" is hidden in a row menu (F04) | Admin | 1 (old) | Polish | 4 | Low | Put it on the row. |
| G51 | Offering the client assistant starts with the client admin's role unticked (F21.2) | Firm admin | 27 step 1 (new) | Polish | 4 | Low | Tick it by default. |
| G52 | A person who may read a file or action but not change it gets "not found" (F10, F12, F17) | Observer, lead | 22, 27, 31 (new) | Polish | 4 | Low | Show "read only". |
| G53 | Draft actions are not marked on the plan list (F09) | Consultant | 1 (old) | Polish | 4 | Low | Add a "draft" mark. |
| G54 | The numbers-import button is hidden until a data mode is chosen (F16) | Client admin | 12 (old) | Polish | 4 | Low | Show it with a prompt. |
| G55 | A new file version takes the new file's name in the list (F12) | Everyone | 32 step 4 (new) | Polish | 4 | Low | Keep the document name; show the file name as a detail. |
| G56 | Mute-mail switch on an indicator has no mail to silence (the notice is bell-only) (F16) | Lead, client admin | 26 step 9 (new) | Polish | 4 | Low | Remove the switch or add the mail. |
| G57 | Two inquiries from one prospect make two rows with no link (F08) | Admin | 23 (new) | Polish | 4 | Low | Show "same sender" on the second. |
| G58 | The firm-run reviewer text should say "ask a colleague to review" (F10) | Consultant | 8 (old) | Polish | 4 | Low | Reword. |
| G59 | Dialogs ignore clicks made before they finish loading; the first click on "Create my account" looks dead (F30) | Everyone | many (old, new) | Polish | 4 | Low | Disable the button with a spinner until ready. |
| G60 | "Verified" is used three ways in English (F10) | English readers | 3 (old) | Polish | 5 | Low | One word per meaning. |
| G61 | A generic "Saved" toast, not what was saved (F27) | Everyone | many (old) | Polish | 5 | Low | Say what. |
| G62 | Mail for English readers is Arabic first; the invitation names neither the firm nor the inviter (F23, F01) | English readers, invitees | 1, 28 (old, new) | Polish | 5 | Medium | Name both; order by the reader's language. |
| G63 | Dark mode: check boxes and switches barely visible; the date picker is hard by keyboard (H8) | Dark-mode users | 18 (old) | Polish | 5 | Medium | Fix contrast and the picker. |
| G64 | Missing accessible names on the logo link, radios and checkboxes; one Arabic grammar slip (H8) | Keyboard and screen-reader users | 18 (old) | Polish | 5 | Medium | Name them. |
| G65 | Over-masking of short organisation names such as «أمل»; text already holding "[ORG_1]" is unmasked (F21.5) | Everyone | final-status §5 (old) | Polish | 5 | Low | Tune the masking list. |
| G66 | Two words for "inquiry"; date-request wording; tooltips add tab stops (F22) | Everyone | after-scenarios list (old) | Polish | 5 | Low | One word; tidy the tab order. |
| G67 | A hydration warning in the browser console on the client People page (dev server) (F30) | Developers | 34 (new) | Polish | 5 | Low | Check it on a production build. |
| G68 | The audit CSV time is UTC while the page shows Riyadh time (F24) | Firm admin | 29 step 3 (new) | Polish | 5 | Low | Add the zone to the header. |
| G69 | The assistant median is 117 s per answer on the test processor (F21) | Consultant | 4.2 (old) | Polish | 5 | Medium | Re-measure on the server; consider a smaller context. |
| G70 | Refused erase calls are audited only when the caller can see the person (`eraseUser` looks up through `membershipOf`), but the audit page claims every refused attempt is recorded (F24, F01) | Firm admin | 30 D1 (new) | Logic | 1 | Low | Audit the refusal for every caller, or reword the page. |

**Not defects, kept so they are not lost.** The value test has not been run, so no time-saving figure exists. Page times from the development server are not production figures. Seeded files cannot be downloaded on a `--full` copy (scan status "skipped"). The end-to-end suite has never run on a staging server; two assistant tests were written for a hosted model; one unit test reads the machine's AI address (the testing guide, section 6).

**Re-checked from the old list:** *A consultant cannot set his own expertise* (scenario 1, step 13) is **fixed**: scenario 31 shows Omar editing his languages and availability, services staying with the admin, and the page saying so. The plan import now shows why an owner is "unknown" (24 step 7), though the page does not warn before the import that the client's people must be on the project first.

## 4. Counts

**By type and class** (70 items; G08 to G11 are go-live items, not code).

| Class | Logic | Polish | Total |
|---|---|---|---|
| 1 Privacy or consent | 12 | 1 | 13 |
| 2 Someone left uninformed | 16 | 1 | 17 |
| 3 Wrong numbers or wrong answers | 8 | 1 | 9 |
| 4 Confusing controls | 0 | 21 | 21 |
| 5 Looks and accessibility | 0 | 10 | 10 |
| **All** | **36** | **34** | **70** |

**By seriousness.** High 14, Medium 29, Low 27. (Counted by script from the table above.)

## 5. Priorities

Order: privacy first, then logic gaps that leave someone uninformed, then wrong numbers, then confusing controls, then looks.

1. **Privacy and consent (class 1).** G05 (the assistant flag bypass, first), G01 (decisions and follow-ups start shared), G02 (AI notice), G03 (security page claims), G04 (erasure reason), G12 (assessment guidance), G70 (refused erase calls not always audited), then the go-live set G06, G08 to G11 and G13 (G06 and G08 to G11 are work, not code changes).
2. **Someone left uninformed (class 2).** G14 (broken audit chain), G15 to G17, G19 to G24 (the notices that are missing), G25 to G30.
3. **Wrong numbers and wrong answers (class 3).** G31 to G34 first (they can send a wrong figure or a wrong answer without a warning), then G35 to G39.
4. **Confusing controls (class 4).** G40 (release-now default) first, then G41, G42 (English server messages, systemic), G44, G48, then the rest.
5. **Looks (class 5).** G62 to G64 (mail wording, dark mode, accessible names), then the rest.

### Suggested first batch

One short pull request each, privacy items first, each with a test that fails before the fix:

1. **G05** a trigger on INSERT of a version sets the assistant flag off unless the uploader may switch it on.
2. **G01** default meeting decisions and follow-ups to firm-only and label the effect.
3. **G02 and G03** correct the AI notice and the security page (text; bump the notice version so people accept it again).
4. **G04** hide the erasure reason from the client (and clear it from the person's row); **G70** audit every refused erase.
5. **G14** notify the firm admins when the audit chain breaks.
6. **G06** re-run the isolation sweep, and **G07** return a real 404 for "not found" pages so the sweep can tell found from not found (no leak today).
7. **G31, G32, G33** wrong numbers and the PDF date (one batch: they share the report and progress queries).
8. **G34** say when an attachment was skipped.
9. **G16, G19, G20, G21, G23** the missing notices (owner change, shared assessment, sent report, receipt, reopened project).
10. **G42** translate the server messages in one place (it clears about a dozen of the friction items at once).
11. **G40** release-now defaults to off.

Before real client data (not code): G08, G09, G10, G11, and re-run scenario 20 (G38).
