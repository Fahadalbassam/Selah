<p class="kicker">For the Selah team · Production readiness · Part 3 of 3 · Main after PR #215, migrations to 0115 · 20 November 2026</p>

# Selah's path to production: what is solid, what is only built, what we still need

This is part 3 of the team documents. The Handbook explains the parts and the Workflows explain the flows. Here we answer in plain words: how solid is what we have, how does it run, what must be done **before go-live**, what is still left, and which features come later.

<div class="box" markdown="1">
**The short answer.** The core of Selah is in good shape and a lot has been added since 6 November: help inside the app, five privacy leaks found and fixed, restricted clients working, reports with approval and a confirmed send, a local model with better Arabic search, a scanner for personal numbers, and background jobs for slow AI work. The scenario tests run so far found **no privacy leak**. What Selah still does not have is proof on a real server with real people: it has not been deployed, the tunnel has not been tested live, and the scenario testing is not finished (Gate C is still ahead). The work ahead is a short, ordered go-live list (section 5), the rest of the scenarios, and fixes for what they found. We do not need many new features.
</div>

<div class="stat">
<div><b>0 leaks</b>between clients: the permission review, the assistant runs, the leak fixes, and every scenario so far.</div>
<div><b>67 / 1 / 3</b>passed / failed / not run in the full end-to-end run on a production-like stack; no app bug found.</div>
<div><b>0115</b>last database migration. Four of the recent ones need care on a live server: 0109, 0112, 0114, 0115.</div>
<div><b>164 + 100</b>sample files and questions in the labelled test set that the model and search choices were made on.</div>
<div><b>20 of 21</b>scenarios done on four copies, no privacy finding on any; the isolation sweep (19) is not finished; Gate C ahead.</div>
</div>

## 1 How solid is what we have?

Each area gets one label: <span class="tag built">SOLID</span> built, enforced and tested. <span class="tag part">BUILT, NOT PROVEN</span> the code exists but has not run for real or been measured. <span class="tag open">MISSING</span> nobody has done it yet.

| Area | What exists today | What is still open | Label |
|---|---|---|---|
| Keeping clients apart | Every route, download, export, search and assistant lookup goes through one check, `authorize()`, and the database repeats it with row-level security. A denied request looks like a missing one. A privacy review plus the leak-fix batch closed five real leaks (firm-only titles, private file names, shared reports counting firm-only work, history counting firm-only work). Restricted clients, assistant switch owners and whole-project meeting invitations were tightened. The isolation sweep of scenario 19 is still to run on every copy. | No outside penetration test. Tests use our own sample data. | <span class="tag built">SOLID</span> |
| Sign-in | Invite only. Staff and client admins use a password plus an authenticator code; managers and owners can use an emailed link. 10 tries per 15 minutes; sessions last 8 hours. The app refuses to start in production with scanning or two-factor off. | No single sign-on with the firm's Microsoft or Google accounts. | <span class="tag built">SOLID</span> |
| The workflow | Action states enforced by the database. Nobody reaches Verified without a consultant's accept; nobody verifies their own work; the two-sign-off rule works (scenarios 2, 3). Reports need a second person's approval and a confirmed send. | A few friction points from the scenarios (Workflows, Part B). | <span class="tag built">SOLID</span> |
| Files | 20 MB limit, three type checks, ClamAV scan (a virus test file was refused), signed one-minute links, versions, labels, an audience picker. | Scanned pages cannot be read (no text recognition yet). | <span class="tag built">SOLID</span> |
| Audit log | Hash-chained, sealed and checked nightly; kept 12 months at least. | Old rows still hold some private file names until the **pre-go-live clean-up** (section 5). | <span class="tag part">SOLID after clean-up</span> |
| Email | Invitations, reminders, daily digest and escalations; work mail respects the Saudi week. | A sending domain on the firm's side with SPF, DKIM and DMARC. Work mail held for the weekend gives no sign that it is held. | <span class="tag part">BUILT, NOT PROVEN</span> |
| Assistant | Answers with citations, from what the asker may open; a local model (qwen3.5:4b) by default; name masking that fails closed; a personal-number scanner (0114); Arabic word search (0112); @-attach; client assistant gaps closed; background jobs (0113). Labelled test set: 81 of 89 scored questions found the right passage; access held on all 164 earlier questions; no leak in scenario 13. | Answers take about a minute on the local model on a processor (47 to 132 s). The progress draft's numbers can disagree with the project page. Reading scanned pages and a name-spotting model are not built. Answer quality on the server's own hardware is not measured. | <span class="tag part">BUILT, NOT PROVEN</span> |
| Backups and restore | Backup, off-site encrypted copy, restore and a monthly restore drill that checks row counts, the audit chain and file checksums; a breach runbook. | The second disk, a key kept off the server, a schedule, and one drill done and written down. | <span class="tag part">BUILT, NOT PROVEN</span> |
| Monitoring | `/api/ready`, a two-minute alert job, `ops/readiness.sh`; upgrade and rollback scripts. | Alerts to a real inbox, an outside uptime check, disk and log watching. | <span class="tag part">BUILT, NOT PROVEN</span> |
| Deployment | Docker Compose with two ways in (tunnel for sample data, direct for real data); the full end-to-end suite runs on a production-like stack. | **The server is not running Selah. The tunnel was never tested live. No staging server.** | <span class="tag open">MISSING</span> |
| Speed | AI work goes in one queue, one at a time; searches measured (new Arabic search function 2.5 ms a passage). | No agreed workload or page-speed targets measured on the server. | <span class="tag open">MISSING</span> |
| Ease of use | One rulebook; every screen simplified (fewer buttons, plain labels); a role guide, tooltips and first-visit lines in the app; scenarios timed in clicks. | No sessions with real consultants or clients yet. Manual accessibility review open. | <span class="tag part">BUILT, NOT PROVEN</span> |
| Legal | Terms, privacy and AI notices, DPA template, sub-processor list; acceptance recorded. | Not reviewed by a lawyer. Hosting location, retention and duties not confirmed. | <span class="tag open">MISSING</span> |

## 2 How it runs on our server

The target is one Linux machine with a GTX 1050 graphics card and 16 GB of memory, everything in Docker.

| Part | Where it runs | Before go-live |
|---|---|---|
| Web app and API (Next.js) | Our server | Production build, the real settings, the production safety check passing. |
| Database (PostgreSQL 16 with vector search) | Our server | Backups on the second disk and a key kept off the server. Migrations through 0115. |
| File storage (S3-compatible) | Our server | Included in the backup. Storage size planned. |
| Virus scanner (ClamAV) | Our server, own container | About 1 to 1.5 GB of memory; signatures update daily. |
| PDF export (Gotenberg) | Our server, no route to the internet | Nothing extra. |
| Search model (bge-m3) | Our server | Time how long it takes to index real documents. |
| **Answer model (qwen3.5:4b, local)** | Our server, on the processor | Measure real answer times. One model run at a time. A hosted model is for sample data only. |
| AI service and jobs | Our server | Slow work (translations, summaries, org chart draft, indexing) runs as jobs in one queue. |
| Email | A relay | A sending domain on the firm's side with SPF, DKIM, DMARC. |
| The way in | Cloudflare Tunnel (sample data) or Caddy direct | **Switch to direct before any real client file**, because the tunnel handles encryption outside Saudi Arabia. |

**Two risks.** Memory: about nine services share 16 GB, so measure under load. One machine: if the server breaks, Selah stops; an off-server backup and a written restore time protect us.

**Rule for real client files.** Real client files go only to a **local** model. Name masking cannot hide a name that appears only inside a file, and a name-spotting model is deliberately not built. Write this into the deployment guide.

## 3 Extra features: keep, trim or hold?

Our rule is to cut nothing built and tested, and to reduce clutter by hiding. The recent screen simplification applied this to every screen.

| Feature | Verdict | Why |
|---|---|---|
| Closing gate and closure report | <span class="tag built">KEEP</span> | Without it projects never end cleanly. |
| Second sign-off | <span class="tag built">KEEP</span> | Small, rule-based; works in the tests. Off by default. |
| Audit log with hash chain | <span class="tag built">KEEP</span> | Cybersecurity controls expect 12 months of logs. |
| Date requests and slip history | <span class="tag built">KEEP</span> | The honest number of how a deadline moved. Gap found: decline has no reason box. |
| Recommendation responses; risk acceptance | <span class="tag built">KEEP</span> / <span class="tag part">TRIM</span> | Needed; risk acceptance is shown only to people who can sign. |
| Offboarding, export pack, legal hold | <span class="tag built">KEEP</span> | Records must be kept; clients will ask what happens to their data. |
| Intake, conflict check, NDA | <span class="tag built">KEEP</span> | Now four numbered steps instead of five competing cards. |
| Lead suggestions by expertise | <span class="tag built">KEEP</span> | Only suggests; no performance scores. Gap: a consultant cannot set their own profile. |
| Business indicators | <span class="tag built">KEEP</span> | Careful wording; neutral colours; a "moved away" notice with figures only. |
| Departments, restricted and firm-run modes | <span class="tag built">KEEP</span> | Restricted clients now work; the firm-run mode keeps Selah useful for clients who will not log in. |
| Client groups (holdings) | <span class="tag later">HOLD</span> | Rare for a first firm; shown once a group exists. |
| Assessments with templates | <span class="tag part">TRIM</span> | Only a starter template ships. Loading the firm's own template waits until the firm sends it. |
| Assistant (staff and client), @-attach, progress draft | <span class="tag built">KEEP</span> | The strongest everyday use; the four locks held in every test. |
| Monthly status pack, reports with templates | <span class="tag built">KEEP</span> | It replaces the report consultants write by hand. |
| Org chart (structure) | <span class="tag built">KEEP</span> | Useful to the firm; the publish id bug is fixed (#215, 0115). |
| Closing survey and case-study consent | <span class="tag later">HOLD</span> | Optional; do not put it in front of every client. |

## 4 Everyday situations: what Selah does today

| Situation | What Selah does today | Gap | Status |
|---|---|---|---|
| Switching the consultant on a client | The admin changes the lead; the **client and the old lead are told with a handover note**. Leavers' work is handed to named people. | Reviews waiting on the old lead are not moved automatically. | <span class="tag built">COVERED</span> |
| The contract is about to end | **A reminder to the lead, deputy and admins from 30 days before until 30 days after the end date.** | Say in the notice what to do next (renew, close, archive). The daily job must be scheduled. | <span class="tag built">COVERED</span> |
| Renewal or a next phase | A new engagement and a new project that continues the earlier one. | No guided "renew" step that carries open actions. | <span class="tag part">PARTIAL</span> |
| The client cuts the contract early | The sponsor asks to close; the firm closes; archiving gives the grace period and export pack. | No record of why it ended. | <span class="tag part">PARTIAL</span> |
| Work is late or stuck | Blocked, date requests, comments, rule lists, the ladder. **"I am stuck" now notifies the firm.** | Decline of a date request has no reason box. | <span class="tag built">COVERED</span> |
| The client disagrees with a recommendation | Kept on record with the reason; the firm may answer once; the client may sign a risk acceptance. | None for now. | <span class="tag built">COVERED</span> |
| Give work to a colleague | **Give to a colleague** (client and firm), with notices; the server refuses an owner who may not be on the project. | An owner change tells only the new owner. | <span class="tag part">PARTIAL</span> |
| A client person leaves | The client admin moves their actions. | The lead is not told; the dialog mentions a temporary head with no control. | <span class="tag part">PARTIAL</span> |
| Meeting summary | Typed by hand, firm-only first, shareable; decisions and follow-ups beside it. | No AI draft; the assistant cannot read summaries. | <span class="tag part">PARTIAL</span> |
| Sending a report to the client | Template, a second person's approval, a confirmed send. | Sharing sends no client notice yet. | <span class="tag part">PARTIAL</span> |

## 5 The path to production, in order

### A. Before go-live (the checklist for the operator)

Do these once, on the live database, before the firm's real clients are let in. The operations guide has the exact commands.

| # | Step | What to do and why | Done? |
|---|---|---|---|
| 1 | **Size the end reminders** (migration 0109) | The first daily run after 0109 tells the firm about every open engagement of an active client that ends within 30 days or ended in the last 30. Run the provided **read-only count** on the live database first (how many engagements and how many notices). Notices go into each person's summary mail, so at most one mail per person that day. Run it after the migration and before the next daily job. Also needed before any later upgrade that first brings 0109. | Open |
| 2 | **The pre-go-live clean-up script** (`pre-go-live:clean-private-names`) | Before migration 0106, withdrawing a wrong upload stored the file's name in the audit log and activity record where the other side could read it. 0106 hides old rows when read, but the stored rows still hold the names. The script blanks those fields, sets the right label on old activity rows, re-hashes the audit chain, and writes one system entry. Steps: stop `web` and `jobs`; rebuild the tools image; take a backup; **dry run** (counts only); then `--apply` (it shows the dry run and asks you to type the database name; one transaction, rolls back on any error). A second run finds nothing. Never run it on a test copy by mistake (it refuses unless told). After it, copy the new chain head off the server. **Backups taken before the run still hold the names**: keep them under the usual period, and if one is ever restored, run the script again. Written and tested; **not run yet**. | Open |
| 3 | **Test the tunnel live** | The tunnel image was updated without a live test. With the real tunnel token: start the tunnel, check the connections register with no error; from outside the firm's network open the public address (sign-in over HTTPS, a file download, a PDF export); ask the assistant a question and watch a slow answer finish (the stream must stay open past 100 seconds) and a translation or summary finish as a job. If anything fails, set the previous image back and note it in the incident register. | Open |
| 4 | **Plan the 0112 search rewrite** (maintenance window) | 0112 drops and re-adds the assistant's search column and its index. It holds an exclusive lock on the assistant's passages: during that time the assistant cannot search or index (the rest of Selah works). Measured on the laptop: about **4 minutes per 100,000 passages**; allow two to three times that on a slower server. Count first. Plan a maintenance window like any upgrade. The embeddings are not touched. | Open |
| 5 | **Allow for the 0114 re-index** | 0114 sends every indexed file back to the indexing job to tag personal numbers. Until the job reaches a file it reads "pending" and its summary button says not indexed. Allow about **3.5 hours per 10,000 files** on the server's processor (count first). Summaries, answers and translations kept before the upgrade may still hold numbers as written; clear them if that matters. | Open |
| 6 | **Direct way in** | Point the two names at the server, open ports 80 and 443, set the direct profile, delete the tunnel, check the sub-processor page. Do this before any real client file. | Open |
| 7 | **The firm's own mail domain** | SPF, DKIM, DMARC so mail does not land in spam. | Open |
| 8 | **Backups** | Second disk, an off-server key, the schedule, one restore drill done and its time written down. Run `ops/readiness.sh` and see it green. | Open |
| 9 | **Real-client rule** | Real client files go only to a local model. Write it into the deployment guide. | Open |
| 10 | **Legal texts** | Reviewed by the firm's counsel. | Open |
| 11 | **Allow for the 0115 org chart repair** (migration 0115) | 0115 gives valid ids to the copied units and positions of every published org chart version and repairs the ids already stored, once, with one audit row per client. Run the upgrade **with the app stopped** and a **10 second lock timeout**; if it cannot get its locks in 10 seconds it fails cleanly and can be run again. Take a backup first. Nothing in it changes who can see any work. Needed on any live database that already has published org charts. | Open |

### B. What is still left in the plan

| Step | Work | State |
|---|---|---|
| 1 | Org chart publish fix (ids): independent review, merged as #215 (migration 0115) | **Done** |
| 2 | Scenarios on all four copies (A, B, C, D in English, 768 px dark): 6, 7, 14, 16 finished; **no privacy finding** on any copy | **Done** |
| 3 | **Scenario 19 isolation sweep** on every copy by an independent reviewer | **Interrupted, not finished: run again** |
| 4 | **Scenario report** and an independent re-run of every failed step | Not started |
| 5 | **Gate C: stop for the owner's decision** | Ahead |
| 6 | **After-scenarios list** (below) | After Gate C |
| 7 | The interactive Selah map (radial map of features, files and risks; kept true by a path-check script) | Done (`docs/selah-map.html`) |
| 8 | Clean-up of scenario copies, worktrees and test buckets | Later |

**After-scenarios list:** text recognition (OCR) for scanned pages; save an assistant answer as a note; staff "what changed since my last visit" and meeting drafts; concern flags (facts, no score); export language following the screen; leftovers from the screen batches (date-request words, two words for "inquiry", tab stops added by tooltips); assessment guidance written for the consultant shown to the client; findings from the labelled test set; an answer that only echoes the question shown as grounded; org chart draft from pasted text giving 0 units; owner change telling only the new owner; plan import before the people are added; plus the failures and confusions in Workflows, Part B.

## 6 Future features (nothing here is built, and there are no dates)

These ideas are written down so the team can split them. They follow the same rules as everything else.

<div class="box" markdown="1">
**Rules for every future feature**

- **Automation suggests, a person decides.** A suggestion proposes a value, a score or a warning; it changes nothing by itself. A consultant or the client accepts, changes or ignores it, and the record says who decided.
- **Keep it light.** One shared local model and one search index serve every AI feature. No new model, agent or service for a single feature. Prefer plain rules and database queries (thresholds, counts, dates) over AI wherever they do the job.
- **Keep it fast.** AI jobs run in one shared queue, one at a time. Cache answers and embeddings that have not changed. Index a file once, and again only when it changes. Measure page and AI response times before and after each feature.
- **It must run well on our server** (GTX 1050, 16 GB, local model). Nothing goes to a hosted model with client files. The same access rules apply: a suggestion is read as the person who will see it. No judging words, no scores of people.
- **Keep the data now.** For each idea the one thing to do today is to keep its data structured and timestamped.
</div>

| Idea | What it does | Needs a model? | Data to keep now | Size |
|---|---|---|---|---|
| **Stuck or overloaded lanes** | From action history, shows a consultant with many reviews waiting long, a client person owning most late work, a project where nothing moved for weeks. Facts to the admin or lead, who decide. | No (database queries) | Each state change with who and when; when evidence was sent and reviewed; date requests and answers | Small to medium |
| **Indicator help** | Reads values from a spreadsheet the client uploads and proposes rows; flags a value that moved away from its target; suggests a likely link to a recommendation. Never says a recommendation caused a change. | Only for messy files and suggested links | Baseline, target, direction; values by period with who entered them and how; every correction beside the original | Small, then medium |
| **Assessment help** | Suggests a draft answer and score from the client's evidence against the reference library, with a citation for each. Marked draft until a consultant takes it on. Runs as an overnight job. Never "compliant". | Yes, the shared one | Each answer with who and when and the template version; evidence linked; keep earlier answers | Medium to large |
| **"What changed" and meeting brief** | A cited list of changes since the last visit; a brief from a meeting's agenda, open decisions and open actions. | Yes, the shared one | Already kept | Small to medium |
| **Save an answer as a note** | Save an assistant answer with citations as a firm-only note on the project. | No | None | Small |
| **Scanned pages (OCR)** | Text recognition only on pages marked scanned, in the shared queue, indexed once. | No (recognition on the processor) | Pages marked `needs_ocr` | Medium |
| **User-made report templates and a richer editor** | The firm's own templates; headings, lists, small tables in the note. Research first (Arabic right-to-left, safe storage, PDF and translation). Still needs approval and a confirmed send. | No | The report text and edits | Medium |
| **A client page for their own report** | The client keeps and edits the progress draft as the company's own report; the firm sees it only if the client shares it; Selah never sends it. | No | Text, writer, edit times, who shared | Small to medium |
| **Workflow helpers** | A guided renew step; a reason for why a contract ended; a pause state; the AI meeting summary draft; a decisions list; a calendar screen. Each must first be shown to be useful. | Mostly no | None | Various |

### The reference library (plan, not built)

A small library of governance and strategy references that the assistant and the assessment help can cite, kept apart from client evidence.

| Source | Note |
|---|---|
| IFC family business governance handbook | Check the licence before loading |
| OECD Principles of Corporate Governance | Store the edition used |
| Capital Market Authority corporate governance regulations | Regulations change: store the date of the version |
| The Balanced Scorecard | Copyrighted: the library holds the firm's short notes, quotes only briefly with the page |
| Good Strategy Bad Strategy | Copyrighted: as above |
| Ministry of Economy and Planning strategy framework | Check the licence |

Every citation from the library is labelled "Reference" and names the source, its edition and the place in it, so nobody mistakes it for the client's own document. Arabic and English questions about each source are added to the labelled test set with the right passages marked.

### Suggested order for splitting the work

1. Things that need no model first: stuck or overloaded lanes, the indicator flag and spreadsheet rows, save an answer as a note, the client's own report page.
2. Things that need the shared model after the value test: "what changed" and the meeting brief, indicator suggestions.
3. Text recognition and user-made templates: after research.
4. The reference library, then assessment help: last. They depend on a licence check of each source and the labelled test set.

<p class="small">Sources: the system map, the operations guide (Before go-live), the assistant guide, the lead's log and the scenario reports. Companion documents: Handbook, Workflows.</p>
