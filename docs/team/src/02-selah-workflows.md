<p class="kicker">Team guide · Part 2 of 3 · Checked on main after PR #251 (last app change #215) · 24 November 2026</p>

# How work moves through Selah

The everyday flows, step by step, exactly as the finished app does them today. Part A has the flows. Part B reports what the scenario tests found in scenarios 1 to 34: nobody saw another client's data, one privacy gap is open (G05, a new file version keeps the assistant switch), and the failures and confusions are listed so we can fix them. Part C says what will change later in each flow and gives the first batch of fixes in priority order.

Everything in Part A is built and merged. The few ideas that are not built are marked <span class="tag later">NOT BUILT</span> and collected at the end. Nothing in Part C is built.

Companion files for the team: [gaps-and-priorities](../gaps-and-priorities.md) (70 gaps and the order to fix them), [testing-guide](../testing-guide.md) (the test suites and how to run them) and [selah-target](../../future/selah-target.md) (Selah after every planned upgrade, with 34 open questions).

<div class="toc">
<div><b>Part A. The flows</b></div><div></div>
<div>1 The whole journey</div><div>2 Add a client and staff it</div><div>3 The plan and the client's answer</div><div>4 The action back and forth</div><div>5 Bumps in the road</div><div>6 Document requests and upload links</div><div>7 A meeting from booking to follow-ups</div><div>8 The monthly report and sending it</div><div>9 Business indicators</div><div>10 Handing over a deliverable</div><div>11 The assistant at work</div><div>12 Closing a project</div><div>13 The end of an engagement, renewal, archiving</div><div>14 Who gets which client, and changing the lead</div><div>15 The client's structure</div><div>16 Internal projects</div><div><b>Part B. What the scenarios found</b></div><div></div>
<div><b>Part C. What will change later</b></div><div></div>
</div>

**The people in these flows.** Firm side: the firm admin (adds clients, picks the lead, does the final close, archives clients), the client's lead consultant and an optional deputy (run the client's team), consultants (see only the projects they are staffed on), observers (read only). Client side: the client admin (sees all of their own company), client managers (one can be the project sponsor) and action owners (see only their own actions). The full role list is in the Handbook.

# Part A. The flows

## 1 The whole journey

A client reaches the firm in one of three ways: the public form, a referral or tender entered by staff, or a pitch the firm starts. The firm qualifies the inquiry, signs, sets up the client, writes the plan, and then the two sides work through the actions until the project closes.

```flow
@Prospect > Inquiry form, referral or pitch > @Firm admin > Four steps + conflict check > Win into a client > Record signed engagement > Name lead and deputy
Staff the project > Invite the client admin > @Consultant > Write or import the plan > @Client > Answer, do, send evidence > @Consultant > Review > Reports and follow-up > Close > Archive
```

## 2 Add a client and staff it

**Who:** the firm admin adds; the lead and deputy staff.

1. **From an inquiry:** Inquiries, open it. Four numbered steps: read it and give it an owner, hold the discovery session, send the proposal, make it a client. The current step has the only solid button. The conflict check is on the side and must be clear (or overridden) before **Make it a client**. That creates the client, records the signed engagement, names the lead and can start the first project. *Directly:* Clients, **Add client**, the name in English and Arabic, **Create**.
2. On the client page, **People**: **Add consultant**, then in the row menu **Make lead** (and **Make deputy** if wanted). Consultants whose expertise matches come first, marked **Suggested**; the choice is the admin's.
3. **Setup**: how the client takes part (full, restricted or firm-run), the second sign-off rule, the client assistant card, and **Record an engagement**.
4. **Overview**, **New project**: one project per phase or scope. A project that no signed engagement covers stays a draft the client does not see.
5. **People**, **Invite someone**: the client admin gets an email with a link valid for 7 days.
6. Project page, **People**: **Staff on project** (pick from the client's team; choose Observer for read only), then **Client people on this project** to add the client's people. Only people on the project can own its actions. Finally **Client roles**: Sponsor, Coordinator, Acceptor.

<div class="box" markdown="1">
**Do it in this order.** The plan import flags every owner as "unknown" if the client's people are not yet on the project, and nothing on the screen says so. Invite and add the client's people first, then import the plan (found in scenario 1).
</div>

**Known gaps.** The conflict dialog defaults to "conflict", the owner dialog does not start on a suggested consultant, and "Make lead" sits in a row menu (G48, G50; [gaps-and-priorities](../gaps-and-priorities.md)).

## 3 The plan and the client's answer

**Who:** staffed consultants write (not observers). The client reads and answers.

```flow
Add a recommendation > Add an action: step, owner, due date, evidence list > Keep as draft  or  Release to owner now > Owner is told > @Client admin or sponsor answers: agree, partly agree, disagree + reason > Firm may answer once
```

1. Project page, **Plan**. Start from **Sources** if an assessment was run. **Add a recommendation** is the main button (text, priority, due date, the finding it answers; more fields under **More fields**). The menu beside it has **Add a finding**, **Import** from Excel or Word, and **Download as Excel**.
2. Beside each recommendation, **Add an action**: the step, owner, due date, department and an **Evidence list** (what the client should send).
3. A draft action is seen by nobody at the client, not even its owner, and is not in the client's numbers until **Release to owner**. Draft actions are not marked on the plan list, so check before a meeting.
4. The chips under the plan filter it: Late, Blocked, No activity for a while, Date moved twice or more, Sent back twice or more, No active owner, Waiting for review over 7 days, Disputed. The client sees Late and Blocked only.
5. The client admin or sponsor presses **Respond** on the recommendation and chooses Agree (with what will be done and by when), Partly agree (with the reason) or Disagree (with the reason). Every response stays on record. A disagreement shows under **Waiting on your decision** for the firm.
6. **For a firm-run client** the consultant records the client's answer (**Record the client's response**) with how and when it was given, and a colleague confirms it before it counts.

**Known gaps.** "Release now" is on by default and has saved drafts by mistake (G40); draft actions are not marked on the plan list (G53); the plan import now says why an owner is "unknown" but does not warn first. See [gaps-and-priorities](../gaps-and-priorities.md).

## 4 The action back and forth

**Owner side**

```flow
@Owner gets notice > Open the action > Start work > Progress notes > Send for review (evidence) > Waiting for the firm
```

1. The owner sees the **Next step** card with the due date and when a reminder goes out. On the home page "Start work" only opens the action; press **Start work** on the action itself (found in scenario 2).
2. After starting, the one solid button is **Send for review**. Beside it: **I am stuck**, **I need more time**.
3. **Send for review** opens a window: pick which evidence item the file answers (you must choose, even with one item), upload a file or choose one already in Selah (PDF, Word, Excel, PowerPoint, images or text, up to 20 MB, virus-scanned), add a note, and choose **Send for review now** or **Save without sending**.
4. To send a file you only saved: press **Send for review** again, leave the file empty, and confirm.

**Reviewer side**

```flow
@Consultant sees it in Home or Actions, Awaiting review > Next step card: files with Download > Accept each evidence item > Verify  or  Request revision with reason > Owner is told
```

1. Any consultant staffed on the project (not an observer, and never for their own work) opens **Actions**, **Awaiting review**, or a **Review** row on Home.
2. In the **Evidence list**, each item: **Accept**, **Not accepted** (say what is missing; the client sees it) or **Not needed** (say why). Items must be accepted or waived before verifying, or the server answers with an instruction (found in scenarios 3 and 4: accepting and signing are two steps).
3. **Verify** makes the action Verified. **Request revision** sends it back with the reason; the owner opens the action, reads the reason, and presses **Send the revised file for review**, in one step.
4. **Two sign-offs.** Where the client's rule asks for it (for example on high-priority work), or one action asks for it: the first consultant presses **Sign off (first of two)**; a different consultant then presses **Second sign-off and verify**. The first signer is not offered the second step.
5. A consultant can reopen verified work later, with a reason, from the menu beside the title.

<div class="box ok" markdown="1">
**The rule that never bends:** nothing becomes Verified without a consultant's accept, and nobody verifies their own work. The database itself refuses it. Selah asks for the second human; it never signs for one.
</div>

**Known gaps.** Accepting an evidence item and signing off are two steps, with an English sentence and no item named when the first try is too early (G44); "Start work" on Home only opens the action (G45). See [gaps-and-priorities](../gaps-and-priorities.md).

## 5 Bumps in the road

| What goes wrong | Steps | Who |
|---|---|---|
| **Owner is stuck** | Owner presses **I am stuck** and gives a reason. The action shows as Blocked, appears on the next meeting agenda and in "needs attention", and **the project's lead and consultants are notified**. | Owner; consultant follows up |
| **Owner needs more time** | Owner presses **I need more time**, proposes a date and a reason. The consultant sees **Approve** and **Decline** on the Next step card. The third move needs the lead or admin. Every move is kept. | Owner asks; firm decides |
| **Evidence not good enough** | Consultant: **Request revision** with a reason. Owner: reads it, sends a corrected file. Nothing is lost; old versions stay. | Consultant, owner |
| **Client disagrees with a recommendation** | Disagree or partly agree with a reason on the recommendation. The firm may answer once, and may edit or withdraw the recommendation. | Client admin or sponsor |
| **Client chooses not to act** | Client admin or manager: menu on the action, **accept the risk of not completing it**; type the statement, tick the box, **Sign**. Then the firm closes the action as "risk accepted". Action owners are not offered it. | Client signs; firm closes |
| **Client goes quiet** | The ladder: reminder before the due date; owner when overdue; managers and lead after 7 days; client admins, sponsor and watching firm admins after 14 days. One summary mail a day at most. After 14 days with no activity the lead is told. A consultant can nudge an owner once a day (**Remind the owner**). | Automatic |
| **Wrong file uploaded** | The uploader withdraws it with a reason. The other side no longer sees a private name. Evidence itself is not withdrawn: the reviewer returns it. | Uploader |
| **Plan no longer fits** | Close the action as "replaced by" another action, or "not applicable". Withdraw a recommendation with a reason. | Firm |
| **Give work to a colleague** | On the action page, beside the owner, **Give to a colleague**. The status stays; the old and new owners, the lead, the deputy and the project's consultants are told. The server refuses a new owner who may not be on the project. | Owner, sponsor, coordinator, lead |
| **A client person leaves** | The client admin switches them off and moves their actions in the dialog. The lead and project consultants are not told that owners changed, and the departure dialog mentions a temporary head with no control (both found in scenario 9). | Client admin |
| **A firm person leaves** | Team, open the person: Selah lists everything they hold and hands it to one colleague in one step. Switching the account off is refused until then. | Firm admin |

**Known gaps.** Declining a date request has no reason box (G17); an owner change tells only the new owner (G16); the client is not told when the consultant changes (G15); the risk Sign button is disabled with no reason (G46). See [gaps-and-priorities](../gaps-and-priorities.md).

## 6 Document requests and upload links

1. Project page, **Requests and files**: the consultant lists the documents needed, each with an owner and due date. Mark an item **confidential** to keep its files out of the assistant.
2. The client sees **Documents asked of you** on Home and presses **Send a file** beside the item. The window names the item. They upload or choose a file, then send. The item reads **Waiting for the firm**.
3. The consultant accepts it or returns it with a reason.
4. **No account?** The consultant sends a no-login upload link for one item, valid for 1, 3, 7, 14 or 30 days (7 unless changed), up to ten files, revocable.

**Known gaps.** The no-login upload link was tested (scenario 34); its mail names neither the item nor the firm. A client answering a request item with a file was not tested. See [gaps-and-priorities](../gaps-and-priorities.md).

## 7 A meeting from booking to follow-ups

```flow
Book a meeting > Send invites (calendar file) > Automatic agenda > @Held: mark as held > Write summary (saving confirms it) > Record decisions > Add follow-ups > Share with the client
```

1. Project page, **Meetings**, **Book a meeting**: title, kind, date and time, length, place or call link (Meet, Teams or Zoom only), shared or firm-only, attendees. Pick a department if it is one department's meeting.
2. If you tick someone who cannot open a whole-project meeting, the form warns, offers a department meeting or the board-secretary meeting, and does not save until the name is removed.
3. **Send invites**: every attendee gets a calendar invitation. Send again after changes.
4. The agenda is built from the work: late, waiting for review, blocked, and what changed since the last meeting. Headings follow the reader's language.
5. Afterwards: **Mark as held**, **Edit summary**, **Record a decision** (a correction is a new decision), **Add a follow-up** for each task with an assignee and date.
6. Follow-ups appear on the assignee's Home. A shared summary is visible to the client and can be translated.
7. A transcript can be pasted or imported only after attendees were told; firm-only; deleted 30 days after the summary is confirmed.

**Known gaps.** Meeting decisions and follow-ups start shared with the client (G01); a department-limited manager's Meetings tab can read "none for you yet" (G26). See [gaps-and-priorities](../gaps-and-priorities.md).

## 8 The monthly report and sending it

```flow
Progress tab > New report: freezes the numbers > Pick a template > Write the note > @Colleague approves > @Person confirms Send > Client reads it
```

1. Project page, **Progress**, **New report**. Choose **monthly progress**, **steering summary** or **closing summary** (Arabic or English). The numbers freeze as of the last day of the period.
2. Write the **Note for the client**. The note is read by every client reader, so do not name another department's work.
3. A colleague other than the writer **approves**: the lead, the deputy or the firm admin.
4. **Send to the client** opens a confirmation dialog. Nothing goes until **Send** is pressed. It cannot be undone. Selah never sends on its own.
5. **From the assistant:** ask "draft a progress update" in a project chat, then **Use as draft**. The report page opens with the text as the note; nothing is saved until you save. Check the numbers against the project page before sending (see Part B).
6. The monthly status pack is drafted by the monthly job, seen only by the firm; add a note, **Issue** it, then approve and send the same way.
7. Sharing a report sends the client no notice yet, and the PDF header date can show the previous day (both found in scenario 11).

**Known gaps.** Sending a report gives the client no notice (G20); the PDF date can show the previous day (G33); the assistant's progress draft disagrees with the project page (G31). See [gaps-and-priorities](../gaps-and-priorities.md).

## 9 Business indicators

1. The client admin chooses how numbers reach Selah (typed, uploaded from Excel or CSV, or connected). The import button is hidden until that choice is made (found in scenario 12).
2. A client admin or manager types a value for the month (about 3 clicks), or imports a file. Imports never overwrite; corrections keep the original.
3. A missing value shows as missing 10 days after its period ends.
4. Only the firm links an indicator to a recommendation. If a value moves away from its baseline, the lead, deputy and client admins get a notice with the figures only.
5. Every view says "reported by the client, not verified impact". No judging words or colours.

**Known gaps.** The numbers-import button is hidden until a data mode is chosen (G54). The "moved away" notice goes to the bell only, with no mail, so its mute-mail switch has nothing to silence (G56). See [gaps-and-priorities](../gaps-and-priorities.md).

## 10 Handing over a deliverable

1. Share the file with the client first (file menu on Requests and files). Handing over never shares by itself.
2. Open the engagement, **Deliverables**, **Hand over** beside the deliverable; pick the files.
3. The project's acceptor (else the client admin, else the sponsor) sees **Files waiting for your confirmation of receipt** on Home and confirms or comments.
4. States: Not handed over, Handed over (waiting), Received, Commented. Received never means accepted. For a new version, **Hand over a new version**.

**Known gaps.** The firm is not told when the client confirms receipt (it is told of a comment) (G21). Handing over a new file version works (scenario 32). See [gaps-and-priorities](../gaps-and-priorities.md).

## 11 The assistant at work

1. Open **Assistant** (floating card). Under **Ask about** choose All my clients or one project, or press **Ask the assistant** on an action, meeting, recommendation or file.
2. Ask in Arabic or English. Press a source chip to open it.
3. Type **@** to attach up to three files you can already see. The chips warn before you send if a file is switched off for the assistant or its text cannot be read.
4. Ask for drafts (follow-up message, progress update). Drafts are marked, never sent.
5. A file is read only after its uploader or the owning side's admin presses **Let the assistant read it** and it is scanned. Anyone on the owning side can switch it off. A new version keeps the switch of the old one (the open privacy gap G05), so check the switch after uploading a new version.
6. **Client side:** off until the firm admin offers it (client page, Setup, Client assistant) and the client admin agrees after reading the notice. Then managers and the admin can ask. Facts only; "who is my consultant"; "my deadlines" for the asker only; a legal question gets no ruling but shows what the documents say; a progress-update draft stays in the chat.
7. A slow answer on the local model can take about a minute. Translations and summaries run as background jobs and appear when ready.

**Known gaps.** An unreadable attachment is answered as if it were another file (G34); a new file version keeps the assistant switch on (G05); the public AI notice still says clients have no assistant (G02). No assistant answer could be produced on the last test copy. See [gaps-and-priorities](../gaps-and-priorities.md).

## 12 Closing a project

```flow
@Client sponsor or admin: Ask the firm to close > @Lead or deputy: Start closing > Decide each open action > Write lessons > @Firm admin: Close for good > Closure report PDF
```

1. The client side can press **Ask the firm to close** in the project menu. The firm admin cannot close by request alone.
2. The lead or deputy presses **Start closing** in the project menu. A **Closing** tab appears. Work goes on; **Stop closing** is always available.
3. For each open action: **Decide**: hand it to a named person at the client who carries it on, or another decision with its reason. The client admin or sponsor can name who carries it on.
4. **Write lessons** (firm only). Case-study consent is optional.
5. Deliverables handed over and not answered do not hold the close; they later read "No answer before the project closed".
6. The firm admin's Home shows **Close for good**; pressing **Close project** makes the project read-only and prepares the Closure report PDF. The admin can **Reopen** with a reason.

**Known gaps.** "Start closing" is only in the menu (G47); the closure PDF total was off by one (G32); a reopened project sends the client admin no notice (G23). See [gaps-and-priorities](../gaps-and-priorities.md).

## 13 The end of an engagement, renewal, archiving

1. **Reminder.** Each daily run tells the lead, deputy and firm admins in the bell when an open engagement ends within 30 days, and again when it has ended and is still open. The client is never told. The notice names the engagement and gives its date. The daily job must be scheduled on the server.
2. **Renew or next phase:** record a new signed engagement and open a new project on the same client that continues the earlier one.
3. **Cut early or not renewed:** the client presses "ask to close"; the firm closes each project (flow 12). Selah has no separate "termination" record: the reason goes in the closing notes.
4. **Archive the client** when every project is closed: a read-only grace period in which the client can still read and download, the export pack with checksum and receipt, legal holds, then retention purges.

**Known gaps.** An archived client is offered reply buttons and a wrong refusal reason, and its sign-in message does not say what to do (G25). See [gaps-and-priorities](../gaps-and-priorities.md).

## 14 Who gets which client, and changing the lead

1. Inquiry won: the admin sees up to five **suggested** consultants (services, sector, language, availability, load; no performance scores). The admin chooses the lead; the lead staffs the projects.
2. A consultant who is not on a client sees its name and can **Ask to join** with a reason; the admin or lead decides once.
3. **Change the lead:** the firm admin, on the client page (People). **The client and the old lead are told, with a handover note.** The deputy and the staffed consultants stay.
4. **A consultant sets their own expertise:** the consultant sets their own languages and whether they can take a new client; the admin sets service areas and sectors, and the page says so (re-checked in scenario 31).
5. **The client wants another consultant:** they tell the firm (Help, "Ask your consultant"); the admin changes the lead.

**Known gaps.** The client is not told on screen when the consultant changes (G15). A consultant now sets his own languages and availability (scenario 31); services stay with the admin. See [gaps-and-priorities](../gaps-and-priorities.md).

## 15 The client's structure

1. Client page, **Structure**. The firm opens the draft: edit by hand, import from Excel or Word, or paste text from a slide and let the assistant propose rows (a background job; the user checks every row).
2. The lead, deputy or admin presses **Review and publish**. A new version appears with a list of new units.
3. The client admin places people in positions and can invite a new hire into a vacancy. Managers see names in their own branch and above. Action owners see only "your manager".
4. **Download PDF** (A3 or A4) for printing. The chart never changes anyone's access.
5. Fixed bug: the ids made at publish were invalid, so the next draft could not be edited and an invitation into a vacancy failed. Fixed in #215 (migration 0115). Scenario 20 has not been run again since.

**Known gaps.** The pasted-text draft gave 0 units in a test (G37); the publish-id fix (#215) has not been re-run through scenario 20 (G38). See [gaps-and-priorities](../gaps-and-priorities.md).

## 16 Internal projects

Any firm member creates one (Projects, Internal) and becomes its lead. They staff colleagues. Another firm member reviews. The lead closes it. Only staffed members and the firm admin see it; clients never do.

<div class="box later" markdown="1">
**Not built (proposals, kept off until shown to be useful):** an AI draft of the meeting summary from a transcript; the assistant reading confirmed summaries; a list of all decisions; a calendar screen; a guided "renew" step that carries open actions into the next project; a reason for why a contract ended; a pause state for a project; re-checking results at 6 and 12 months.
</div>

**Known gaps.** Scenarios 22 to 34 (assessments, inquiries and pitches, Excel, deliverable receipt, the moved-away notice, assistant switches, sign-in and two-step, the audit log, retention and erasure, team load and the second reviewer, file versions and scanning, mail hours, and edge cases) found nobody seeing another person's or another client's data: every "should be denied" check was refused. They found one privacy gap, G05 (a new file version keeps the assistant switch). Their results, all 70 gaps and the order to fix them are in [gaps-and-priorities](../gaps-and-priorities.md) and in Parts B and C below.

# Part B. What the scenarios found

There are 34 scenarios. Scenarios 1 to 21 were run on 20 November on four separate full copies of the app with sample data: A, B and C in Arabic on desktop, and D in English (scenarios 2, 7, 12 and 15) plus scenario 18 in English at 768 px, dark mode. Scenarios 22 to 34 were run on 23 November on the lead's copy, in Arabic on desktop and in English where the screen differs. Each step is clicked as the real person would, and scored PASS, PASS with friction, or FAIL. The runs used sample data on development servers; no consultant or client has run them yet. **Scenario 19, the isolation sweep, is not finished: it was interrupted and has to be run again.**

<div class="stat">
<div><b>1 privacy gap</b>in 34 scenarios: G05, found in scenario 32. Nobody saw another client, a firm-only item, or a count of something left out.</div>
<div><b>33 of 34</b>scenarios done. Scenario 19 (isolation sweep) is not finished.</div>
<div><b>Copy A: 70 pass, 4 fail</b>(scenarios 1, 2, 8, 9, 12, 15 reminder, 20). The later copies passed, mostly with friction; the fails are listed below.</div>
</div>

## Where we are

| Scenario | Copy | Result |
|---|---|---|
| 1 New client to a working plan | A | Passed with friction (24 pass, 1 fail) |
| 2 The everyday cycle | A, D (English) | A: passed with friction. D: **Pass** |
| 3 Evidence sent back twice | B | Passed with friction |
| 4 Blocked and an accepted risk | B | Passed with friction |
| 5 Asking for more time | B | **One FAIL** (decline with no reason) |
| 6 The lead leaves | B | **Pass** (new lead with a handover note; a suspended person is locked out at once) |
| 7 An unhappy client | B, D (English) | B: **Pass**. D: **Pass**. In both the client is not told when the consultant changes (Help shows it) |
| 8 A firm-run client | A | Passed with friction |
| 9 Someone leaves the client | A | Passed with friction; one expectation not met (only the new owner is told) |
| 10 A steering meeting | B | Passed with friction |
| 11 The monthly report | B | Passed with friction |
| 12 Business indicators | A, D (English) | A: passed with friction. D: passed with friction |
| 13 The assistant, both sides | B | Passed (local model); progress draft numbers **FAIL** |
| 14 Closing a project | C | Passed with friction |
| 15 End of engagement (reminder, offboarding) | A (reminder), C, D (English) | Reminder: **Pass**. C: passed with friction. D: passed with friction and **one small fail** (reply buttons offered on an archived client; the refusal gives the wrong reason) |
| 16 A second client from an inquiry (holding group) | B | **Pass** (group roll-up 22% equals the sum of the parts; every cross-client page reads "not found"; the assistant is closed for both new clients' admins) |
| 17 A busy Monday morning | B | Pass |
| 18 Layout, keyboard, language | C (Arabic), D (English, 768 px, dark) | C: passed with friction. D: passed with friction (layout holds at 768 px; dark-mode contrast and the date picker are the friction) |
| 19 Isolation sweep | A, B, C, D | **Not finished** (interrupted) |
| 20 Structure to a printed chart | A | **FAILED at steps 10 to 12** (one real bug, now fixed, see below) |
| 21 A file and a meeting kept from one person | B | Pass: nobody left out saw anything, not even a count |

## The failures in scenarios 1 to 21

1. **Declining a date request gives no reason (scenario 5).** **Decline** acts at once. There is no reason box and no place to offer a meeting, and the decline cannot be taken back. The consultant has to write in the discussion thread.
2. **The org chart could not be edited after publishing (scenario 20).** Ids created at publish were not valid, so saving the next draft returned an error and an invitation into a vacancy failed. **Fixed** in #215 (migration 0115): copied units and positions now get valid ids, and stored ones are repaired once.
3. **The progress draft disagrees with the project page (scenario 13).** The draft said 0 verified and 1 late; the project page said 1 of 8 verified and 3 late. A consultant who pastes it without checking sends wrong numbers.
4. **A consultant cannot set their own expertise (scenario 1).** The page said they can; only the admin had the control. **Re-checked in scenario 31 and fixed:** a consultant edits their own languages and availability, services stay with the admin, and the page says so.
5. **Owner change tells only the new owner (scenario 9).** The lead and the project's consultants are not told, and the history shows no "owner changed" line.
6. **The client is not told when the consultant changes (scenarios 6 and 7, Arabic and English).** Only the Help page shows it.
7. **The closure PDF total is off by one (scenario 14):** it shows 3 where the project has 4.
8. **An archived client still sees reply and "I will attend" buttons (scenario 15, copies C and D),** and the refusal gives the wrong reason. The archived sign-in message ("your account is not linked to an active organisation") does not say what to do.
9. **The "release now" switch is on by default** once an owner and a date are set (scenario 18, copies C and D). It is hard to see in dark mode, and one mis-click saved drafts.

## Scenarios 22 to 34

Run on 23 November for the gap list. The counts are steps: pass / friction / fail / not run. "Denied rows" are the checks that a person who must not see or do something was refused; every one was refused, and an independent reviewer re-ran 32 of them and agreed.

| Scenario | Steps | Denied rows | Short result |
|---|---|---|---|
| 22 Governance assessment | 4 / 3 / 0 / 1 | 14 | Works. Finalising and sharing give no warning and no client notice. |
| 23 Inquiry to discovery, and a pitch | 9 / 4 / 0 / 0 | 14 | Works. Owner dialog default, date fields, no sign the decline mail went. |
| 24 Excel import and export | 8 / 1 / 1 / 0 | 11 | Formula text stays text. An export asked for in English from an Arabic screen keeps Arabic headers. |
| 25 Deliverable receipt | 8 / 2 / 1 / 0 | 10 | The firm is not told of a receipt (it is told of a comment). |
| 26 Indicator moved away | 8 / 0 / 0 / 0 | 8 | Once per period holds. The notice is bell only, no mail. |
| 27 Assistant switches and consent | 7 / 3 / 0 / 0 | 7 | Switches and consent work. **No answer could be produced** (the model service returned an error). |
| 28 Sign-in, links, lock-out, two-step | 14 / 2 / 1 / 0 | 9 | Works. A refused email domain gives the wrong reason. |
| 29 Audit log | 8 / 0 / 1 / 0 | 8 | Tampering is found. A broken chain tells nobody. |
| 30 Retention, erasing, legal hold | 9 / 1 / 1 / 0 | 5 | Erasure and hold work. The erasure reason is shown to the client. No purge was run. |
| 31 Team load, expertise, second reviewer | 9 / 1 / 0 / 0 | 9 | Works. Scenario 1's expertise finding is fixed. |
| 32 File versions and upload scanning | 7 / 1 / 0 / 0 | 7 | A virus file is refused. **The assistant switch follows a file to a new version (G05).** |
| 33 Notifications and mail hours | 11 / 0 / 2 / 0 | 5 | The rules hold. A held mail shows no sign on the notice. |
| 34 Legal pages, upload link, join request, access review | 8 / 4 / 0 / 0 | 9 | Works. The AI notice contradicts the client assistant. |

**The privacy gap, G05.** When someone uploads a new version of a file, the new version keeps the old version's "Let the assistant read it" switch. The rule that only the uploader or the owning side's admin may switch a file on is checked when the switch is changed, not when a version is added. So a staffed firm consultant or a client manager can put new content into the assistant without that step, and the notice about personal numbers is skipped. Nobody outside the file's own readers sees anything. It is the first fix in Part C.

**Other new findings worth knowing.** The AI notice says client people have no assistant (G02). The security page lists a second-site backup that is not set up (G03). The erasure reason typed by the firm admin is shown to the client admin (G04). Server refusals appear in English on Arabic screens in eight of the 13 scenarios (G42).

**Not tested by any scenario:** restricted-client mode; the number scanner; the pre-go-live script; translation on demand; Word import; template building; converting a pitch; a client answering a document request with a file; what happens when the virus scanner is down; the daily and weekly mail digests; any purge job; two-step sign-in being forced for a role; and the isolation sweep (19).

## The gap list in numbers

All findings from scenarios 1 to 34 and the final status are in one list of 70 gaps (G01 to G70).

| Class | Gaps |
|---|---|
| 1 Privacy or consent | 13 |
| 2 Someone is left uninformed | 17 |
| 3 Wrong numbers or wrong answers | 9 |
| 4 Confusing controls | 21 |
| 5 Looks and accessibility | 10 |
| **All** | **70** |

By seriousness: 14 high, 29 medium, 27 low. 36 are logic gaps and 34 are polish. Four of the 70 (G08 to G11) are go-live work, not code changes.

## Confusions and friction

- "Start work" on Home only opens the action; a second click starts it (scenario 2). The best fix: make the Home button start it, or label it "Open".
- Accepting an evidence item and signing off are two steps, and the first attempt gets an instruction instead of a combined step (scenarios 3 and 4). The risk-acceptance **Sign** button is disabled with no message saying why.
- Work mail is held until Sunday, 07:00, and nothing on the screen says a mail is held (scenarios 1, 2, 3).
- **Start closing** exists only in the ⋯ menu on an active project, and the lead has no close button until everything is settled (scenario 14). A reopened project sends no notice to the client admin.
- The client sees a "make pack" button on an archived client (scenario 15).
- "Verified" is used three ways in English: Verify, Accepting, Verified Complete.
- Saving shows only a generic "Saved" toast, not what was saved.
- Mail for English readers is written Arabic first, and the invitation mail names neither the firm nor the inviter.
- Dark mode: check boxes and switches are barely visible. The first Tab stop (the logo) has no name; the date picker is hard to use by keyboard.
- Plan import before the client's people are on the project flags every owner unknown (scenario 1).
- The org chart draft from pasted text gives 0 units, after 135 seconds on the processor (scenario 20).
- "Make lead" is hidden under a row menu (scenario 1). The conflict dialog defaults to "conflict".
- Draft actions are not marked on the plan list.
- A scanned page or a switched-off attachment is answered as if it were another file (scenario 13). The answer should say that the attachment was skipped.
- A legal question is refused without a pointer to what the documents say.
- A summary switch labelled "firm only" means "shared" when on.
- Sharing a report sends no client notice; the report PDF can show the day before.
- The numbers import button is hidden until a data mode is chosen (scenario 12).
- Dialogs ignore clicks made before they finish loading.
- The firm-run reviewer text should say "ask a colleague to review" when nobody else is on the team (scenario 8).
- The "Not found" page is served with HTTP code 200, so a script cannot tell found from not found.
- Accessible names are missing on the logo link, radios and checkboxes; one Arabic phrase has a grammar slip.

## What worked

- The two sign-off rule, the date-request flow, risk acceptance and the evidence-by-item flow all worked and were understood.
- The same progress number agrees in four places on one project.
- A virus test file was refused with a clear message.
- The end-of-engagement notice reached the lead and the admin, nobody on the client side; the export pack checksum matched and held nothing firm-only.
- A busy Monday: each of three people found what needs them on the first screen without a click.
- The assistant refused rulings and offered drafts only. In 15 of 15 answers checked for a client asker, no citation named another client or a firm-only file.
- Leaving and suspension take effect at once: a suspended person gets 401, a removed person gets "not found".
- The English run and the 768 px dark run found the same behaviour as the Arabic desktop runs.

## What is still to do

Fix G05 first. Make "Not found" pages return a real 404 (G07), then run the scenario 19 isolation sweep again on every copy by an independent reviewer (it was interrupted). Run scenario 20 again after the #215 fix. Write the scenario report with an independent re-run of every failed step (in scenarios 1, 5, 9, 13, 15, 18 and 20), and then stop at Gate C for the owner's decision. Team members will later run every scenario by hand on a production build. After Gate C comes the go-live list in the Production path, section 7.

# Part C. What will change later

<div class="box later" markdown="1">
**Nothing in Part C is built.** <span class="tag part">REFINE</span> marks a change to something built, taken from the gap list. <span class="tag later">PLANNED</span> marks a feature that does not exist yet, taken from the target product document. There are no dates. Every planned feature keeps today's rules: it suggests and a person decides, and the AI stays fully local for real client files.
</div>

## What will change in each flow

| Flow | REFINE: changes to what is built | PLANNED: not built |
|---|---|---|
| 1 The whole journey | None beyond the flows below. | A guided renew step, a reason for why a contract ended, and a pause state for a project. Proposals only; each waits on a decision by the firm. |
| 2 Add a client and staff it | The conflict dialog starts at "not yet checked" and the owner dialog at the first suggested consultant (G48). "Make lead" moves onto the row (G50). The screen says the decline mail went (G28). A join request asks for a reason when declined (G18). The invitation mail names the firm and the inviter (G62). An address outside the company's domains gets the right message (G24). | None. |
| 3 The plan and the client's answer | "Release now" is off by default (G40). Draft actions are marked on the plan list (G53). The import says what it created (G30) and warns that the client's people must be on the project first. For assessments: guidance written for the consultant is kept from the client (G12), finalising counts the open questions (G41), and sharing tells the client (G19). | Assessment help: a draft answer and score with citations, for a consultant to accept, change or reject. The reference library it cites. Both come last. |
| 4 The action back and forth | "Start work" on Home starts the work or is labelled "Open" (G45). Accepting an evidence item and verifying become one clear step (G44). One English word for each meaning of "verified" (G60). A person who may read but not change sees "read only", not "not found" (G52). | None. |
| 5 Bumps in the road | A declined date request carries a reason and can offer a meeting (G17). An owner change tells the lead, the project's consultants and the old owner, and writes a history line (G16). The risk Sign button says why it is disabled (G46). The client admin sees on Home that the consultant changed (G15). | Stuck or overloaded lanes: facts from action history for the admin and the lead, with no score of a person. Concern flags: not designed yet. |
| 6 Document requests and upload links | A new version keeps the document's name in the list (G55). The scenario still to run: a client answering a request with a file. | Text recognition, so a scanned document sent in answer can be read by the assistant. |
| 7 A meeting from booking to follow-ups | Decisions and follow-ups start firm-only, and the switch says what it does (G01). A department-limited manager's Meetings tab shows the meetings she is invited to (G26). | A meeting brief built from the agenda, open decisions and open actions. A draft of the summary from a transcript. The assistant reading confirmed summaries. A list of all decisions and a calendar screen. Proposals; each must first be shown to be useful. |
| 8 The monthly report and sending it | The client is told when a report is sent (G20). The PDF header uses the firm's day (G33). The assistant's progress draft is built from the same query as the Progress tab (G31). | The firm's own report templates and a richer editor, after research. A client page where the company keeps and edits its own report. |
| 9 Business indicators | The import button shows with a prompt before a data mode is chosen (G54). The mute-mail switch is removed or the mail is added (G56). | Indicator help: proposed rows from a messy spreadsheet and a suggested link to a recommendation. The client accepts each value; only the firm confirms a link. |
| 10 Handing over a deliverable | The firm is told when the client confirms receipt (G21). | None. |
| 11 The assistant at work | A new version no longer keeps the assistant switch (G05). A skipped attachment is named (G34). A page with no text is refused instead of answered (G35). "Due this week" is worked out in code, and an answer that only echoes the question is not shown as grounded (G36). The AI notice is corrected (G02). The firm's card shows when the client stopped the assistant (G27). | Text recognition for scanned pages. Save an answer as a firm-only note. "What changed since my last visit". The reference library. The value test comes first: it shows which of these save time. |
| 12 Closing a project | A visible "Start closing" button (G47). The closure PDF count is fixed (G32). A reopened project tells the client admin (G23). | A re-check of results at 6 and 12 months after hand-over. A proposal only. |
| 13 End of an engagement, renewal, archiving | The end notice says what to do next: renew, close or archive. An archived client sees no reply buttons and a sign-in message that says "ask the firm" (G25). | The guided renew step that carries open actions; the reason a contract ended; the pause state. |
| 14 Who gets which client, and changing the lead | The client admin is told on Home when the consultant changes (G15). Whether reviews waiting on the old lead move by themselves is an open question for the firm. | None. |
| 15 The client's structure | Scenario 20 is run again after the #215 fix (G38). The draft from pasted text says why it gave nothing (G37). | None. Whether a new structure should prompt a review of departments and owners is an open question. |
| 16 Internal projects | None. | None. |

Across every flow: server refusals are translated in one place, so Arabic screens stop showing English sentences (G42); mail waiting for the weekend or the night says so on the notice (G22); dark-mode contrast and accessible names are fixed (G63, G64).

## The first batch of fixes, in priority order

From the gap list. Privacy first, then people left uninformed, then wrong numbers, then confusing controls. One short pull request each, and each fix starts with a test that fails before it.

| Order | Gaps | The fix | Class |
|---|---|---|---|
| 1 | **G05** | When a version is added, the database switches the assistant flag off unless the uploader may switch it on. | Privacy |
| 2 | G01 | Meeting decisions and follow-ups start firm-only, and the switch says what it does. | Privacy |
| 3 | G02, G03 | Correct the AI notice and the security page. The notice version goes up, so people accept it again. | Privacy |
| 4 | G04, G70 | Hide the erasure reason from the client and clear it from the person's row. Audit every refused erase. | Privacy |
| 5 | G14 | Tell every firm admin, by bell and mail, when the audit chain check fails. | Left uninformed |
| 6 | G06, G07 | Return a real 404 for "Not found" pages, then run the isolation sweep again. There is no leak today: a forbidden record and a made-up id give the same page. | Privacy |
| 7 | G31, G32, G33 | The wrong numbers and the PDF date, in one batch: they share the report and progress queries. | Wrong numbers |
| 8 | G34 | Say when an attachment was skipped. | Wrong answers |
| 9 | G16, G19, G20, G21, G23 | The missing notices: owner change, shared assessment, sent report, confirmed receipt, reopened project. | Left uninformed |
| 10 | G42 | Translate the server messages in one place. It clears about a dozen friction items at once. | Confusing controls |
| 11 | G40 | "Release now" is off by default. | Confusing controls |

**Before real client data, not code:** run the clean-up script for old audit rows (G08), keep the "local model only" rule for real files (G09), have a lawyer review the legal texts (G10), work the go-live list (G11), and run scenario 20 again (G38). These are in the Production path, section 7.

**After the first batch**, in the order of the gap list: the rest of the missing notices and wrong reasons (G15, G17, G18, G22, G24 to G30), the remaining wrong answers (G35 to G39), the remaining confusing controls, then looks and accessibility (G62 to G64 first). The planned features come after these fixes and after the firm answers the open questions listed in the Handbook, section 20.
