<p class="kicker">Team handbook · Part 1 of 3 · Checked on main after PR #215, migrations to 0115 · 20 November 2026</p>

# Selah, explained for the team

This handbook tells the whole team what Selah is for, who uses it, what each person can and cannot do, and how the main parts work: files, the assistant, meetings, reports, the client's structure and internal projects. It describes the finished app as it is on main today (last merged change: #215, database migrations up to 0115).

Two companion documents go with it: **Workflows** (the everyday flows step by step, and what the scenario tests found) and **Production path** (how Selah runs, what must happen before go-live, what is left, and the future features). The source of truth for all three is the system map in the repository, which lists every feature, its files, its roles and its connections.

<div class="box" markdown="1">
**What is new since the 6 November edition.** Help and a role guide inside the app. A privacy clean-up (five leaks found and fixed). Restricted clients can finally work. The client assistant answers "who is my consultant" and "my deadlines". Staff get a facts-only progress draft that opens the report page. Reports have templates, a second person's approval and a confirmed send. Files can be attached in a question with @. The client is told when the lead consultant changes, and the firm is reminded before an engagement ends. The client's organisation structure (org chart). A local model (qwen3.5:4b), better Arabic search, a scanner for personal numbers, and slow AI work as background jobs. The full list is in section 19.
</div>

<div class="toc">
<div>01 What Selah is</div><div>02 Words we use</div><div>03 The core loop</div><div>04 Firm-side roles</div><div>05 Client-side roles</div><div>06 Every screen and what you do there</div><div>07 From first contact to goodbye</div><div>08 When things go wrong</div><div>09 Files</div><div>10 The assistant</div><div>11 Meetings and summaries</div><div>12 Reports, templates and sending</div><div>13 The client's organisation structure</div><div>14 Internal projects</div><div>15 Help and guides inside the app</div><div>16 The design rules</div><div>17 How to try it yourself</div><div>18 Also in Selah</div><div>19 What changed in this run</div>
</div>

## 01 What Selah is

A consulting firm finishes its work and hands the client plans, policies, a new structure and a list of recommendations. Then the hard part starts: making sure the client actually does them. Today that happens in emails, Excel sheets and WhatsApp. Nobody can see what is really done.

Selah (سلة, "connection") connects the consultant and the client around that follow-up. Each recommendation gets an owner, a deadline and actions. The client reports progress and uploads proof. The consultant checks the proof and either accepts it or sends it back. Both sides see the same, true picture.

| Selah does | Selah never does |
|---|---|
| Record what the consultant recommended and who must do it | Write official recommendations itself |
| Chase late work automatically | Approve evidence or decide if work is good enough |
| Keep proof (evidence) and the consultant's decision on it | Make governance judgements or rule on legal compliance |
| Show both sides honest progress and reports | Claim business impact from a percentage |
| Answer questions about the files and records you may see (the assistant) | Send a report, a message or a draft on its own |
| Suggest drafts and next steps for a person to check | Approve, close or change anything for you |

**Six facts to remember**

- **Generic product.** It is built for any consulting firm. The partner firm is never named in the product, the screens or the documents. The sample firm is called Mizan Advisory.
- **One install, one firm.** Each firm gets its own installation with all its clients inside.
- **Arabic first.** Arabic right-to-left is the default; every screen, email and export also exists in English.
- **Presented as a production app.** No "demo" or "prototype" labels. It still runs on sample data only, because hosting and data handling are not approved for real client data yet (see the Production path).
- **No client ever sees another client.** If you are not allowed to see something, Selah answers "Not found", as if it did not exist. Two independent checks guard this, one in the app and one in the database. Every scenario test so far found no privacy leak.
- **Automation suggests, a person decides.** This is the rule for the assistant today and for every future feature.

## 02 Words we use

| Word | Meaning |
|---|---|
| Firm | The consulting firm that runs Selah (its admins and consultants). |
| Client | A company the firm works for. Each client is sealed off from every other client. |
| Project | One piece of agreed work for a client, for example "Board governance". A client can have many projects (one per phase or scope). |
| Finding | A problem or gap the consultant found (for example from an assessment). |
| Recommendation | What the consultant advises the client to do about it. Can also be a board decision. |
| Action | A concrete task under a recommendation, with one owner and a due date. |
| Evidence | A file that proves an action was done (a signed charter, minutes, a policy). |
| Review | The consultant's decision on evidence: accept (verified) or ask for a revision. |
| Engagement | The signed contract record between the firm and the client, with its dates and deliverables. |
| Inquiry | A request from a possible new client, from the public form or entered by staff. |
| Pitch | A draft client the firm is trying to win. Only the firm sees it. |
| Report | A frozen picture of a project's numbers, with a note. A client sees it only after approval and a confirmed send. |
| Template | A starting outline for a report: monthly progress, steering summary or closing summary, in Arabic and English. |
| Structure | The client's organisation chart: units, positions and the people in them. It never changes who sees what. |
| Job | Slow work that runs in the background in one shared queue: reading files, translations, summaries, an org chart draft from pasted text. |
| Firm-only | Anything the client can never see: internal notes, scores, internal projects. Marked with a lock icon. |

## 03 The core loop

Everything in Selah serves this one chain. The rest of the product is what happens around it.

```flow
Assessment (optional) > Finding > Recommendation > Owner + deadline > Actions > Progress + evidence > Consultant review > Follow-up + reports
```

1. **The firm writes the plan.** Consultants type findings and recommendations, or import them from Excel or Word.
2. **The client answers.** The client admin or the project's sponsor says "agree", "partly agree" or "disagree" on each recommendation, with a reason.
3. **Actions are released.** An action starts as a draft the client cannot see. The consultant releases it with an owner and a due date.
4. **The client works.** The owner starts it, says if they are stuck, asks for a new date if needed, talks to the consultant on the action, and sends evidence.
5. **The firm reviews.** A consultant accepts the evidence (the action becomes verified) or sends it back with a reason. Nobody reviews their own work. Some work needs a second consultant to sign off too.
6. **Follow-up.** Reminders and a four-step ladder chase late work. Meetings get an automatic agenda. A monthly status pack is drafted for the consultant. Reports reach the client only after a colleague approves and a person confirms the send.

**The states an action moves through**

```flow
Draft > Assigned > In progress > Awaiting review > Verified complete
```

From Awaiting review the consultant can also choose **Revision requested**, which goes back to In progress. "Blocked" and "late" are rules shown on an action, not states. Any open action can be **Closed** with an outcome (partly done, risk accepted, not applicable, replaced by another action). The firm can reopen a verified or closed action with a reason.

<div class="box" markdown="1">
**The most important rule in Selah: four things are never mixed.** A person saying the work is done (Awaiting review). The evidence they uploaded. A consultant verifying it (only this turns green; the database itself refuses "verified" without a consultant's accept). Real business impact, which Selah never claims: client numbers are always labelled "client-reported, not verified impact".
</div>

## 04 Firm-side roles

Access is never decided by role alone. Selah checks five things every time: which organisation you belong to, your role, which projects you are on, what you are assigned, and how private the record is. So two consultants with the same role can see very different things. The check runs twice, once in the app and once in the database.

| Role | Can do | Cannot do |
|---|---|---|
| **Firm admin** (مدير المكتب) | See every client and project. Add clients (only admins can). Name each client's lead and deputy. Record signed engagements. Win inquiries into clients and run the conflict check. Do the final close of a project and reopen it. Archive or restore a client, place a legal hold, make the export pack. Offer the client assistant. Set the second sign-off rule. Firm settings, audit log, team load, expertise. Hand over a leaving person's work. Review the work when nobody else on a firm-run client can. | See client-private files. Get notifications for work they do not follow (they must co-consult or "watch"). Review work they submitted themselves. |
| **Lead consultant** (one per client) | See all of that client's projects. Add or remove consultants on the client and staff them on projects. Approve or decline join requests. Start closing a project. Name client roles (sponsor, coordinator). Publish the client's structure. Decide a third date extension. Approve reports. Hand over deliverables. | Do the final close (admin only). Remove the deputy. Change or remove the lead (admin only). |
| **Deputy** (optional, one per client) | Everything the lead can do on that client, and a copy of the lead's alerts. A full backup when the lead is away. | Become accountable: the lead stays the named person. Remove the lead. |
| **Consultant** | See only the projects they are staffed on, plus a list of client names (nothing else). Ask to join a client's team, with a reason. Write findings, recommendations and actions. Release actions. Review evidence. Decide date requests. Run meetings, request lists and upload links. Draft and share reports. Run assessments. Use the staff assistant. Start a pitch. Create internal projects. | See a client or project they are not on. Review or close their own work. Give the second sign-off after the first. Add clients or do the final close of a client project. |
| **Observer** | Read everything on one project. Add notes on its actions. | Change anything else. Own actions. Review. Edit indicators or reports. |

**How clients get their consultants**

- **The admin decides who leads.** When an inquiry is won, or from the client page, the admin names the lead. Selah suggests up to five consultants by matching the services asked for, the sector, the requester's language, whether they take new clients, and how many clients they already have. It only suggests. No performance scores go into it.
- **Expertise profiles.** Under Team the admin records each consultant's service areas and sectors. Each consultant also keeps their own languages and whether they can take a new client. A consultant with no profile is never suggested.
- **The lead staffs the projects.** Being on a client's team only makes a consultant eligible. The lead (or deputy, or admin) puts them on each project.
- **Consultants can ask to join.** They see the client directory (names only) and send a request with a reason. The admin or the client's lead decides once.
- **The interviewer need not be the lead.** The first conversation (discovery) is run by whoever owns the inquiry. When the inquiry is won, the admin names the lead separately. The discovery notes stay linked to the new client either way.

**Switching the consultant on a client**

- **Change the lead:** the firm admin, on the client page. A client with consultants must always have a lead, so the swap happens in one step. **The client and the old lead are told, and a handover note travels with the change** (new in this run).
- **Add or remove a consultant:** the lead, deputy or admin. Nobody comes off a project while they still own open actions there.
- **Someone leaves the firm:** the admin opens the person on Team. Selah lists everything they still hold (open actions, clients they lead, reviews only they can do, client roles) and hands it all to one colleague in one step. Switching the account off is refused until that is done.
- **The client wants a different consultant:** there is no button. The client tells the firm (email, or "Ask your consultant" on the Help page) and the firm admin changes the lead.

## 05 Client-side roles

| Role | Can do | Cannot do |
|---|---|---|
| **Client admin** (مدير حساب العميل) | See all of their own company: people, departments, projects, files (including files private to the company). Invite and switch off their people, run access reviews, manage departments. Answer recommendations. Move actions and change owners. Upload files (shared with the firm, or private to the company). Sign a risk acceptance. Ask the firm to close a project. Agree to (or switch off) the client assistant. Choose how business numbers reach Selah. Place people in the company's structure. See the company's audit log. During a goodbye period, download the export pack. | See anything of the firm (internal notes, scores, other clients). Verify or close actions. Write the plan. |
| **Client manager** | See company-wide work plus their own departments. Move actions, change owners, upload evidence, comment, ask for a new date, sign a risk acceptance. Book shared meetings. Enter business numbers. Use the client assistant if offered and the admin agreed. | See other departments' work. Invite people. Answer recommendations (unless they are the sponsor). |
| **Sponsor** (a manager or admin named on a project) | Answers recommendations for the client. Gets level-3 escalations. Names who keeps each handed-over action going at closing. Can ask the firm to close the project. | One sponsor per project; naming a new one replaces the old. |
| **Coordinator** | The day-to-day contact for the project. Same powers as a manager. | One per project. |
| **Action owner** | See only their own actions, files shared with them, and their department teammates' files. Start work, say they are stuck, upload evidence, send it for review, ask for a new date, comment, give an action to a colleague where allowed. Sign in with a link by email. | See other people's actions or how many there are. Use the assistant. |
| **Contact without an account** | Recorded by the firm (for example the external auditor). Can be invited to meetings and named as an owner for firm-run clients. | Sign in. Only the firm sees the contact list. |

**How much a client takes part**

| Mode | Who has accounts | Who records progress | Use it when |
|---|---|---|---|
| **Full** | Any client role | The client's own people | The normal case. |
| **Restricted** | Up to two client admins | The client admin (fixed in this run: before, the admin had no buttons) | A client who wants few people inside. Their uploads stay private from the firm until an admin shares them. |
| **Firm-run** (consultant-managed) | None | The consultant, marked "recorded by a consultant" with how and when they heard (email, meeting, phone) | Family offices and clients who will not log in. A second person must review. |

Departments are optional and off by default. When on, a manager or owner sees only their department's actions and files. A department-limited manager sees her own part of the numbers; a line on her pages now says why her figure differs from the whole project's. Client groups (holdings) add up the numbers of several companies without merging their data.

## 06 Every screen and what you do there

Names are as the in-app guides use them. Arabic names are in the sidebar. Admin-only items are marked.

### Firm side

| Screen | What you do there |
|---|---|
| **Home** (الرئيسية) | What waits for you, each row with its next step: decisions (date requests, join requests, client comments, disputed recommendations, projects ready to close), reviews you may give, late work, follow-ups, meetings this week, and what changed since your last visit. One line of counts at the foot. |
| **Actions** (الإجراءات) | Lists across the top: All, Assigned to me, Awaiting review, Late, Blocked, No activity, Date moved twice or more, Sent back twice or more, No active owner. On a rule list, **Remind the owner** (once a day). The Projects table gives counts per project, never a health word. |
| **Projects** (المشاريع) | Client and internal projects. Inside a project five tabs: **Plan**, **Requests and files**, **Meetings**, **Progress**, **People**. A **Closing** tab appears while a project is closing. |
| **Action page** | The heart of the work: the next step, status, evidence list, review (accept, revision, sign-off), date requests, risk acceptance, give to a colleague, close and reopen, the discussion with mentions, firm-only notes, "Ask the assistant". |
| **Clients** (العملاء) | Each client's page with four tabs: **Overview**, **People**, **Setup**, **Structure**. Also client groups and "Start a pitch". |
| **Inquiries** (الطلبات الواردة) | New requests: four numbered steps (owner, discovery, proposal, make a client), the conflict check, the NDA, win into a client or close with a decline email. |
| **Assessment templates** | Build and version assessment templates (firm only). |
| **Assistant** (المساعد الذكي) | Floating card; ask about one project or all your clients. |
| **Files** (الملفات) | Floating card at the foot of the sidebar: every file you may open, grouped by client and project. |
| **Team** (الفريق) | People, invitations, access review, team load (reviews and work per consultant, never a ranking), Expertise. The admin hands over a leaver's work here. |
| **Audit log** (سجل التدقيق) · admin | Every step anyone took, with a tamper check and CSV export. |
| **Settings** · admin | In the menu under your name: intake address, lead suggestions, stale and check-in days, access reviews, retention, Ramadan mail hours. |
| **Help** | The guide for your role, in Arabic or English, opens from the app. |

### Client side

| Screen | Who | What you do there |
|---|---|---|
| **Home** | Everyone | What waits for you with its step: recommendations to answer, files sent back, late or stopped work, answers to your date requests, indicators waiting for a value, receipts to confirm, documents asked of you, meetings to reply to. Action owners see three groups: Waiting for you, With your consultant, Finished. |
| **Projects**, **Actions** | Admins, managers | The project as the client sees it, without firm-only items. Answer recommendations (admin, sponsor), read sent reports, answer document requests. |
| **Team**, **Departments**, **Our group**, **Audit log** | Client admin | Invite people, access review, who heads what, the group roll-up (if granted), the company's own trail. |
| **Business indicators** | Admins, managers | The company's own figures. |
| **Structure** | Admin (names), managers (own branch) | The published org chart; the admin places people. |
| **Assistant** | Admins, managers (if on) | Ask about the company's own work. |
| **Help** | Client roles | Your consultants, write to the firm's management, report a problem, common questions. |

## 07 From first contact to goodbye

```flow
1 Inquiry > 2 Check > 3 Win or decline > 4 Contract > 5 Setup > 6 Kickoff > 7 Follow-through > 8 Closing > 9 Leaving
```

| Stage | What happens | Who |
|---|---|---|
| 1 Inquiry | A prospect fills the public form, or staff enter a referral or tender. Every admin is told; the prospect gets a reference number. | Prospect, admin |
| 2 Check | Four numbered steps: give it an owner, discovery session, proposal. The conflict check must be clear (or overridden). NDA recorded. | Admin, owner |
| 3 Win or decline | The admin wins it into a client and names the lead, or declines with an email. | Admin |
| 4 Contract | The admin records the signed engagement (dates, deliverables). Until then the project is a draft the client does not see. | Admin |
| 5 Setup | Lead, deputy, consultants. Client mode (full, restricted, firm-run). Second sign-off rule. The client assistant offer. The client admin is invited. | Admin, lead |
| 6 Kickoff | Document request lists, first meetings with calendar invites, the plan entered or imported. | Lead, consultants |
| 7 Follow-through | The core loop (section 03), monthly status packs and oversight. Deliverables handed over and confirmed received. | Both sides |
| 8 Closing | The client can ask to close. The lead or deputy starts closing; every open action gets a decision; lessons are written. The admin closes. | Lead starts, admin closes |
| 9 Leaving | When every project is closed, the admin archives the client: a read-only grace period, the export pack with checksum, legal holds, then purges. | Admin, client |

**The end of an engagement.** Each engagement has an end date. Since this run the lead, the deputy and the firm admins get a notice in the bell when an open engagement ends within 30 days, and again when it has ended and is still open. The notice never goes to the client. Nothing else happens by itself: the firm decides whether to renew, close the projects or archive. To renew, record a new signed engagement and open a new project that continues the earlier one. To end early, the sponsor or client admin presses "ask to close" on the project and the firm closes it with the reason in the closing notes.

## 08 When things go wrong

| The problem | What Selah offers | Who acts |
|---|---|---|
| Work is stuck | The owner marks the action **Blocked** with a reason. It shows on the next meeting's agenda and in "needs attention". **"I am stuck" now notifies the project's lead and consultants** (before, nobody at the firm was told). | Owner; consultant follows up |
| The deadline is unrealistic | The owner asks for a new date; the firm approves or declines. Every move is kept. The third move needs the lead or admin. | Client asks, firm decides |
| Work is late | A ladder: reminder before the due date, owner when overdue, plus managers and lead after 7 days, plus client admins, sponsor and watching firm admins after 14 days. One summary email a day at most. | Automatic |
| The client went quiet | After 14 days with no activity the lead is told. A consultant can nudge an owner once a day from Actions. | Automatic, lead |
| Evidence is not good enough | **Revision requested** with a reason; the owner replies and sends again. | Consultant |
| The client disagrees with a recommendation | "Disagree" or "partly agree" with a reason, kept on record, shown in the firm's lists. | Client admin or sponsor |
| The client decides not to do something | A client admin or manager signs a risk acceptance, then the firm closes the action as "risk accepted". | Client signs, firm closes |
| The plan changed | Close an action as "replaced by" another, or "not applicable". Withdraw a recommendation with a reason. Released items are never deleted. | Firm |
| Someone uploaded the wrong file | The uploader withdraws it with a reason. Evidence itself is never deleted. | Uploader |
| A client person needs help | The Help page: "ask your consultant" and a problem form that reaches the firm admins. | Client |
| Someone leaves | Hand over everything they hold to one colleague (Team page). A client person cannot be removed from a project while they own open actions. When a client person leaves, the client admin moves their actions. | Admin; client admin |
| An owner cannot be given the work | The server refuses an owner who is not allowed on that project (fixed in this run). **Give to a colleague** moves an action to someone else on the same side. | Owner, lead |

## 09 Files

**Who can see a file**

| Label | Who sees it |
|---|---|
| **Shared** | Both sides, on that project (and inside the department, if departments are on). |
| **Firm-only** | Firm staff on the project. Never the client. Internal project files are always firm-only. |
| **Client-private** | Only the client company. Not even the firm admin. A restricted client's uploads start here; the client admin can share them (one way, never back). |
| **Personal** | Only the person who uploaded it. |

**Limiting who sees one file or meeting.** The audience picker works on a file or a meeting: "everyone except…" or "only these people". It only takes people away. A person left out sees no row, no count, no notice, no mail and no assistant passage about it.

**How files behave**

- **Safe uploads.** Up to 20 MB. The type is checked three ways and the file is scanned for viruses (ClamAV) before anyone can open it. Files sit in private storage; each download is a one-minute link and is logged.
- **Versions.** A new version replaces the old in lists and in the assistant. The history stays. A confidential request can no longer be bypassed by uploading a new version and switching the assistant on.
- **Evidence is permanent.** Evidence is never deleted or renamed. A wrong upload is withdrawn by its uploader with a reason, and the name of a withdrawn private file no longer shows to the other side.
- **Reuse.** A shared file already in Selah can be attached as evidence without uploading again.
- **Document requests** (project, Requests and files): the firm lists what it needs, with an owner and due date. The client answers each item with files or "does not apply". For someone without an account the firm can send a no-login upload link for one item (valid 1 hour to 30 days, up to ten files, revocable). Items can be marked confidential, which keeps their files out of the assistant.
- **The Files card** lists exactly the files you could open elsewhere.
- **Who controls "Let the assistant read it".** Switching a file's assistant flag **on** needs the uploader of that version or the owning side's admin. Switching it **off** is open to anyone on the owning side, because it only protects privacy.

## 10 The assistant

An Arabic and English assistant that answers questions from the files and records you are allowed to see, and shows where every answer came from. It opens as a floating card from the sidebar, or with "Ask the assistant" on an action, meeting, recommendation or file.

| For firm staff | For the client |
|---|---|
| Questions about one project or all your clients | Only client admins and managers, never action owners |
| Every answer cites the file, version and page, or the record | Off by default: the firm admin offers it per client and role, with a daily question limit |
| "What is overdue?" read from live actions | The client admin must agree after reading a notice, and can switch it off |
| Two versions that disagree are named, not silently picked | Facts only. **New:** "Who is my consultant?" is answered; "my deadlines" shows only the asker's own dates; a legal question still gets no ruling, but shows what the client's own documents say |
| **Facts-only progress draft** that opens the report page (see section 12) | **Facts-only progress-update draft** that stays in the client's own chat; Selah never sends it |
| Follow-up message drafts (never sent) | Never reads firm-only files, scores, firm notes, lessons or audit data |
| File summaries with page links, and answers in the other language | |
| **@ attach:** type @ to attach up to three files you can already see; chips say if a file cannot be read (scanned, not yet indexed, switched off) | |

**How it stays inside your rights.** The assistant searches with the same permission check as every other screen, built into the search itself. Text you could not open never reaches the model. Chats belong to one person; a consultant taken off a client loses those chats at once. Old chats are deleted on a schedule (90 days after a project closes, or 180 days idle).

**Where the AI runs now**

| Part | Where it runs |
|---|---|
| Search model (bge-m3) | Always on our own machine. Files and their vectors never leave it. |
| Answer model | **A local model, qwen3.5:4b, is the default** (the 3.4 GB download was approved). Everything stays on our server. A hosted model is possible for sample data only. |
| Slow AI work | Translations, file summaries and the org chart draft from pasted text run as **background jobs** in one shared queue, one model run at a time, so a page never hangs. |

**Three protections before any text reaches a model**

1. **Name masking.** Names of people, clients, departments, cities, emails and phone numbers that Selah knows are replaced with placeholders and put back in the answer. Masking fails closed: if Selah cannot be sure it is on, nothing is sent.
2. **Personal-number scanner.** A small rule-based scanner (no AI) replaces Saudi national IDs, Iqama numbers, IBANs, card numbers, phone numbers, email addresses, passport and commercial-registration numbers with tags, both when a file is indexed and when anything is sent to a model, local or hosted. The stored file never changes. When someone switches a file on for the assistant, Selah says which kinds of number it holds.
3. **The database filters, never the model.** Permission is part of the search query.

**Arabic search.** Word search ignores short vowels, tatweel and spelling variants of hamza, ى/ي and ة/ه, so «احمد» finds «أحمد». Search was measured on a labelled test set of 164 sample files and 100 questions: the right passage was found for 81 of 89 scored questions. The misses were mostly cross-language, a scanned page, or long files crowding out others; none was a ranking problem, so a reranker was not built.

**Honest limits.** A name that appears only inside a file and not in Selah's records is not hidden by name masking, so real client files should go only to a local model. Scanned pages cannot be read yet (no text recognition). On the local model on the server's processor an answer can take about a minute (47 to 132 seconds in the scenario runs), with the stream kept open meanwhile. In the scenario tests the staff progress draft showed different numbers from the project page, and an attached file that could not be read was answered as if it were another file; both are on the fix list (Workflows, section 5). No answer showed anything to the wrong person.

## 11 Meetings and summaries

Where it is: open a project, **Meetings** tab, **Book a meeting**, or open a meeting to reach its own page. Selah records meetings and links to the call; it never hosts the call.

**Before the meeting**

- Book it with title, type, date, place, a call link (Google Meet, Teams or Zoom only), shared or firm-only, and attendees. Firm staff book any meeting; client admins and managers can book shared ones.
- **Department meetings and whole-project meetings.** A department meeting lists only that department's work. A whole-project meeting opens only for people who may see everything; a department-limited manager cannot be invited to it. The form says so, offers that department's meeting instead, and does not save until the name is taken off.
- Selah emails a calendar invite that works in Google, Outlook and Apple calendars without connecting any account. Moves and cancellations send updates.
- The agenda writes itself: overdue, awaiting-review and blocked actions, and what changed since the last meeting. **Headings and status words follow the reader's language.**

**After the meeting**

1. Whoever runs it marks it held.
2. They write the summary by hand. Saving it confirms it. It starts firm-only; it can be shared with the client.
3. Each summary line can point to its source: a passage of the transcript (firm only) or a page of a project file.
4. Decisions are recorded and never edited: a correction is a new decision, and the old one shows struck through.
5. Follow-ups are tasks out of the meeting, each with an assignee and date. The assignee (client side too) can mark their own one done.
6. A transcript can be pasted or imported only after attendees were told. It is firm-only and deleted 30 days after the summary is confirmed (90 days at most).

**What the summary feeds.** Follow-ups appear on each person's Home. The next agenda shows what changed. A shared summary is visible to the client and can be translated on demand. Decisions can become board-decision recommendations.

<div class="box later" markdown="1">
**Not built (proposals).** An AI draft of the summary from a transcript. The assistant reading confirmed summaries and decisions. A list of all decisions across meetings. A calendar screen. Each must first be shown to be useful.
</div>

## 12 Reports, templates and sending

**When:** monthly, and before steering meetings. **Who:** staffed consultants write; a colleague approves; a person confirms the send.

1. Project page, **Progress** tab: the numbers (what the consultant verified, how actions ended, what is late, how long reviews wait).
2. **New report** freezes the project's numbers as they were on the last day of the period. It stays with the firm.
3. **Choose a template** on the report page: **monthly progress**, **steering summary** or **closing summary**, in Arabic or English. A template gives headings and prompts; nothing is filled in as fact.
4. The monthly status pack is drafted by the monthly job and seen only by the firm. Write a **Note for the client**, then **Issue** it.
5. **Approve.** A report reaches the client only after a colleague other than its writer approves it: the client's lead or deputy consultant, or the firm admin.
6. **Send to the client.** A confirmation dialog opens and nothing goes until you press **Send**. Sending cannot be undone. Selah never sends a report on its own, and the assistant never sends.
7. **Progress draft from the assistant.** In a chat on a client's project, ask "draft a progress update". The draft is facts only (done, in progress, waiting, late, with dates and sources), starts with "Draft: check before sending", and uses only work every client reader of the report may see. **Use as draft** opens the report page with the text as the note; edit there, and nothing is saved until you save. **Send to the client** under it opens the same confirmation, and only once the report is approved.

**Rules to remember**

- The note on a report is read by every client reader of it, whatever their department. Do not name another department's work in it.
- Shared reports and PDFs count only shared work. Firm-only work and other departments' work never count for a limited reader.
- **Business indicators** are the client's own figures with a baseline and a target. They always carry: "These figures are reported by the client and are not verified impact." Only the firm links an indicator to a recommendation. Words and colours never judge a figure (no "worse", no red): they show the figures and the direction. When a figure moves away from its baseline the lead, the deputy and the client admins get a notice with the figures only.

<div class="box later" markdown="1">
**Later, not built:** user-made report templates, a richer formatted editor (research first, Arabic right-to-left), and a client page where the client keeps and edits their own report.
</div>

## 13 The client's organisation structure

Client page, **Structure** tab: the published chart with the people in each position, vacancies, levels, versions, and **Download PDF** (A3 or A4).

- **The firm prepares the draft:** edit it by hand, import from Excel or Word, or paste text from a slide and let the assistant draft rows (a background job; the user checks every row).
- **The lead, the deputy and the firm admin publish** (Review and publish). Each publish makes a new version.
- **The client admin places people** in positions and suggests changes; managers see names only in their own branch and above; action owners see only "your manager".
- **The chart never changes who sees any work.** It describes positions only, and Selah never judges it.
- Found in the scenarios and now fixed (#215, migration 0115): ids made when a version is published were not valid, so the next draft could not be edited. Copied units and positions now get valid ids, and the ids already stored were repaired once, with one audit row per client.

## 14 Internal projects

An internal project is the firm's own work, using the same tools as client work: recommendations, actions, evidence, review, meetings, files.

- **Who creates it:** any firm member, from Projects, Internal. The creator becomes its lead.
- **Who works on it:** the colleagues the lead staffs. Firm staff own and do the actions themselves.
- **Who reviews:** another firm member. Nobody reviews their own action, here too.
- **Who closes it:** its lead (unlike client projects, which only the admin closes).
- **Who sees it:** only the staffed members and the firm admin. No client ever sees it; the page carries a grey "internal project, firm only" banner. Its files are always firm-only.
- **What it is for:** improving methods and templates, preparing proposals, training, the firm's own governance work.

## 15 Help and guides inside the app

- **A guide for each role.** Clients get the client guide; firm staff get the firm guide. Both open from the app in Arabic or English. Each task is short: when you need it, the steps, what happens next, which screen.
- **Tooltips and first-visit lines.** About 95 short tooltips, a first-visit line on main pages and plain empty states say what a page is for and what to do next.
- **Client Help page.** Your consultants, write to the firm's management, report a problem (reaches the firm admins), and common questions.
- **The handbook.** The handbook front page, the guides, "What Selah will not do" and "Later improvements" are in the repository in Arabic and English, and the in-app guide links to them.
- **Both languages for every message.** Labels come from one Arabic and one English file that must always match.

## 16 The design rules

| Rule | What it means in practice |
|---|---|
| Build from shadcn/ui and Animate UI | Official components first. A custom component only when nothing fits. |
| Monochrome | Black, white and greys. Colour only for status, and muted: grey for in progress, amber for waiting, red for a problem, green only for work a consultant verified. Every status also has a word. |
| Grey card surfaces | Cards on a grey page, light shadow, rounded corners. |
| Arabic first, right to left | Arabic is the default; English is one click away. Layouts use start/end so they mirror. Emails, codes and numbers stay left to right inside Arabic. |
| Desktop and tablet only | 768 pixels wide and up. No phone layouts. |
| Tools float | Files and the assistant are floating cards that stay open as you move between pages. |
| Calm motion | A short fade between pages. Everything turns off for people who prefer reduced motion. |
| Firm-only looks firm-only | A lock icon or "Firm only" badge on anything a client cannot see. |
| Real screens only | Every screen is backed by a real API and workflow. No mock screens, no "demo" labels. |
| **Fewer buttons** | **One main action per page, plain labels, what to do next said in words.** The five simplification batches applied this to every screen. |
| No judging words for client numbers | Figures and facts with their source, never "good", "bad" or a colour verdict. |
| AI output is labelled | Always marked as AI-written, always with sources, never in green. |
| Accessible | Text contrast to WCAG 2.2 AA; visible keyboard focus; icon-only buttons have labels. Open items from the scenarios: missing accessible names on the logo link, radios and checkboxes. |

## 17 How to try it yourself

1. Install Docker Desktop and Node.js 22 or newer, and get the Selah repository.
2. From the repository folder run the walkthrough command with the fresh option. The first run takes 10 to 20 minutes.
3. Open the local address for Selah and the local address for the emails it sends (a test mailbox).
4. Sign in with any of the 14 sample accounts. The password is in the walkthrough guide (local only).

| Try this account | To see |
|---|---|
| admin@mizan.test | The firm admin: every client, inquiries, team, audit log, closing a project. |
| lead@mizan.test | The lead of Al-Nukhba: Home, a second sign-off, a date request, the assistant. |
| consultant@mizan.test | A consultant who cannot see Rawdah ("Not found"). |
| observer@mizan.test | Read-only: no buttons that change anything. |
| admin@nukhba.test | The client admin: answering recommendations, inviting people, assistant consent. |
| manager@nukhba.test | A manager using the client assistant; cannot see Finance's work. |
| owner@nukhba.test | An action owner: only his own actions, re-sending a revision. |
| owner@rawdah.test | The first sign-in: terms, privacy and AI notice. |

The sample cases: Al-Nukhba board governance (Arabic, one action in every state), Rawdah strategic plan (English, ready to close) and Al-Waha family office (firm-run, no client accounts). The scenario tests added a fourth, Sahm, built from an inquiry.

**How we work.** Research before building: a new feature must be shown to be needed (bug fixes can go ahead). The progress checklist is the source of truth. Every screen gets its backend and tests, in Arabic and English. Never put real client data into a local setup, and never paste keys into chats or commits. **Any change to how parts connect updates the system map in the same pull request.** An independent review is required for any privacy, permission, AI or database change.

## 18 Also in Selah

Built and merged, but only named in passing above.

| Part | How it works |
|---|---|
| **Invitations and email domains** | Nobody can sign up; every account starts with an invitation. The firm sets its email domains before inviting. A client may set its own list. Changing an address is confirmed by a link to the new one. |
| **Two-step sign-in** | Required for firm admins, consultants and client admins (authenticator app or backup code). Optional for managers and owners. Passwords are 12 characters or more. At most 10 sign-in tries per account in 15 minutes; each lockout is audited. |
| **Forgotten password, sign-in link** | A reset link by email valid for one hour, at most three an hour. Managers and owners can ask for a one-time sign-in link. |
| **Access reviews** | Every 90 days each organisation's admins confirm who is still with them. |
| **Erasing a person (PDPL)** | On request the firm admin erases a person: the name becomes "Former user #n", sign-in data is deleted, history stays. It cannot be undone and is logged. |
| **Legal profile** | The client's legal identity (Arabic legal name, unified number, legal form, sector, size, regulators, fiscal year). Not kept for "minimal records" clients. |
| **Inquiry acknowledgement** | The prospect gets a reference number mail (at most one a day per address); a returning client is linked to its old record. |
| **Evidence items** | An action can name the pieces of proof it needs. The reviewer accepts, rejects or waives each; an action cannot become verified while any is open. |
| **Slip history and aging** | Every move of a due date is kept with who and why. Reports show days slipped and the age of open work. |
| **Mail that respects the Saudi week** | Work mail never goes on Friday, on Saturday only if asked, never in quiet hours, and in Ramadan only in the firm's hours. Each person chooses how updates and reminders arrive. Security and meeting mail goes at once. Work mail held for the weekend gives no notice that it is held (found in the scenarios). |
| **Translation on demand** | "Show in English" or "اعرض بالعربية" on written text; labelled "Machine translated" with "Show original"; made once as a background job, then kept. The original is the official version. |
| **Assessments** | The firm builds and publishes a template; a consultant answers each question; finalised assessments are locked; two can be compared. Low answers are suggested as gaps and a consultant confirms each as a finding. Scores are firm-only and never say "compliant". |
| **Exports** | Plan as Excel (with a template and guide sheet), actions list, report PDFs, client report PDF, closure report PDF, structure PDF, audit log CSV, the export pack. Each holds only what you could already open, in your language, and is logged. Typed text can never turn into an Excel formula. |
| **Firm settings** | Intake address, lead suggestions, stale after 14 days, check-ins at 30, 60 and 90 days, access review every 90 days, indicator grace 10 days, restricted clients up to 2 accounts, transcripts kept 30 days, chat retention, Ramadan mail hours. Reminder and escalation days are set on each project. |
| **Legal and security pages** | Terms, privacy notice and AI notice (accepted and recorded at first sign-in, asked again when one changes), a data processing agreement template, the sub-processor list and a security pack that shows this site's real setup. |
| **The audit log** | Who did what and when, as ids and counts only: never file text or assistant questions or answers. Each row is chained to the last so the tamper check shows any change. |
| **Server work** | Backups, restore drill, readiness checks, monitoring, upgrades and the incident runbook are in the operations guide and in the Production path. |

## 19 What changed in this run

| Area | What was built or fixed | PR |
|---|---|---|
| Help | Role guides, tooltips, first-visit lines, handbook in Arabic and English | #189, #190, #194 |
| Privacy | Five proven leaks closed (firm-only titles in a leaving report, private file names in the audit log and activity, shared reports counting firm-only work, Progress history counting firm-only work), confidential-request bypass, file rename by another manager | #193 |
| Privacy | Assistant switch rule, department-limited managers refused whole-project invitations, "I am stuck" notifies the firm | #200 |
| Restricted clients | The client admin can record progress and evidence | #197 |
| Client assistant | Who is my consultant, own deadlines only, legal answers with the documents' facts, facts-only progress draft | #198 |
| Lead change and end reminder | Client and old lead told with a handover note; reminder before an engagement ends | #199 |
| Reports | Staff progress draft, Use as draft, approval by a second person, confirmed send, three templates | #201, #204 |
| Assistant | @ attach | #206 |
| Owners | Give an action to a colleague; the server refuses an owner who may not be on the project | #202, #203 |
| Before go-live | A script to clean old private file names from the audit log (written, not run) | #205 |
| Local model and search | qwen3.5:4b default, labelled test set, longer waits for slow answers, Arabic word search | #191, #207, #208, #209 |
| AI jobs | Translations, summaries and org chart drafts run as background jobs | #211 |
| Number scanner | Personal numbers replaced by tags before any model | #213 |
| Org chart | Valid ids for copied units and positions (migration 0115); a one-time repair of stored ids with an audit row per client. Run it with the app stopped; it waits at most 10 seconds for a lock. | #215 |
| Scenarios | All four copies (A, B, C, D in English, 768 px dark) are done: no privacy finding on any copy. Scenario 19 (isolation sweep) was interrupted and is not finished. The failures and friction are in Workflows, Part B. | n/a |
| Tests | Full end-to-end run on a production-like stack: 67 passed, 1 failed, 3 not run, no app bug found | #210 |

<p class="small">Source of truth: the system map in the repository (29 features, 8 sub-features, 70 links). Companion documents: Workflows, Production path.</p>
