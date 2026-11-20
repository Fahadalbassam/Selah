<p class="kicker">Team guide · Part 2 of 3 · Checked on main after PR #213 · 20 November 2026</p>

# How work moves through Selah

The everyday flows, step by step, exactly as the finished app does them today. Part A has the flows. Part B reports what the scenario tests found so far: no privacy finding, and the failures and confusions listed so we can fix them.

Everything in Part A is built and merged. The few ideas that are not built are marked <span class="tag later">NOT BUILT</span> and collected at the end.

<div class="toc">
<div><b>Part A. The flows</b></div><div></div>
<div>1 The whole journey</div><div>2 Add a client and staff it</div><div>3 The plan and the client's answer</div><div>4 The action back and forth</div><div>5 Bumps in the road</div><div>6 Document requests and upload links</div><div>7 A meeting from booking to follow-ups</div><div>8 The monthly report and sending it</div><div>9 Business indicators</div><div>10 Handing over a deliverable</div><div>11 The assistant at work</div><div>12 Closing a project</div><div>13 The end of an engagement, renewal, archiving</div><div>14 Who gets which client, and changing the lead</div><div>15 The client's structure</div><div>16 Internal projects</div><div><b>Part B. What the scenarios found</b></div><div></div>
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

## 6 Document requests and upload links

1. Project page, **Requests and files**: the consultant lists the documents needed, each with an owner and due date. Mark an item **confidential** to keep its files out of the assistant.
2. The client sees **Documents asked of you** on Home and presses **Send a file** beside the item. The window names the item. They upload or choose a file, then send. The item reads **Waiting for the firm**.
3. The consultant accepts it or returns it with a reason.
4. **No account?** The consultant sends a no-login upload link for one item, valid from 1 hour to 30 days, up to ten files, revocable.

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

## 9 Business indicators

1. The client admin chooses how numbers reach Selah (typed, uploaded from Excel or CSV, or connected). The import button is hidden until that choice is made (found in scenario 12).
2. A client admin or manager types a value for the month (about 3 clicks), or imports a file. Imports never overwrite; corrections keep the original.
3. A missing value shows as missing 10 days after its period ends.
4. Only the firm links an indicator to a recommendation. If a value moves away from its baseline, the lead, deputy and client admins get a notice with the figures only.
5. Every view says "reported by the client, not verified impact". No judging words or colours.

## 10 Handing over a deliverable

1. Share the file with the client first (file menu on Requests and files). Handing over never shares by itself.
2. Open the engagement, **Deliverables**, **Hand over** beside the deliverable; pick the files.
3. The project's acceptor (else the client admin, else the sponsor) sees **Files waiting for your confirmation of receipt** on Home and confirms or comments.
4. States: Not handed over, Handed over (waiting), Received, Commented. Received never means accepted. For a new version, **Hand over a new version**.

## 11 The assistant at work

1. Open **Assistant** (floating card). Under **Ask about** choose All my clients or one project, or press **Ask the assistant** on an action, meeting, recommendation or file.
2. Ask in Arabic or English. Press a source chip to open it.
3. Type **@** to attach up to three files you can already see. The chips warn before you send if a file is switched off for the assistant or its text cannot be read.
4. Ask for drafts (follow-up message, progress update). Drafts are marked, never sent.
5. A file is read only after its owner presses **Let the assistant read it** and it is scanned. Anyone on the owning side can switch it off.
6. **Client side:** off until the firm admin offers it (client page, Setup, Client assistant) and the client admin agrees after reading the notice. Then managers and the admin can ask. Facts only; "who is my consultant"; "my deadlines" for the asker only; a legal question gets no ruling but shows what the documents say; a progress-update draft stays in the chat.
7. A slow answer on the local model can take about a minute. Translations and summaries run as background jobs and appear when ready.

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

## 13 The end of an engagement, renewal, archiving

1. **Reminder.** Each daily run tells the lead, deputy and firm admins in the bell when an open engagement ends within 30 days, and again when it has ended and is still open. The client is never told. The notice names the engagement and gives its date. The daily job must be scheduled on the server.
2. **Renew or next phase:** record a new signed engagement and open a new project on the same client that continues the earlier one.
3. **Cut early or not renewed:** the client presses "ask to close"; the firm closes each project (flow 12). Selah has no separate "termination" record: the reason goes in the closing notes.
4. **Archive the client** when every project is closed: a read-only grace period in which the client can still read and download, the export pack with checksum and receipt, legal holds, then retention purges.

## 14 Who gets which client, and changing the lead

1. Inquiry won: the admin sees up to five **suggested** consultants (services, sector, language, availability, load; no performance scores). The admin chooses the lead; the lead staffs the projects.
2. A consultant who is not on a client sees its name and can **Ask to join** with a reason; the admin or lead decides once.
3. **Change the lead:** the firm admin, on the client page (People). **The client and the old lead are told, with a handover note.** The deputy and the staffed consultants stay.
4. **A consultant sets their own expertise:** they cannot today; the admin does it for them (found in scenario 1).
5. **The client wants another consultant:** they tell the firm (Help, "Ask your consultant"); the admin changes the lead.

## 15 The client's structure

1. Client page, **Structure**. The firm opens the draft: edit by hand, import from Excel or Word, or paste text from a slide and let the assistant propose rows (a background job; the user checks every row).
2. The lead, deputy or admin presses **Review and publish**. A new version appears with a list of new units.
3. The client admin places people in positions and can invite a new hire into a vacancy. Managers see names in their own branch and above. Action owners see only "your manager".
4. **Download PDF** (A3 or A4) for printing. The chart never changes anyone's access.
5. Known bug: the ids made at publish were invalid, so the next draft could not be edited and an invitation into a vacancy failed. A fix was being finished at the pause.

## 16 Internal projects

Any firm member creates one (Projects, Internal) and becomes its lead. They staff colleagues. Another firm member reviews. The lead closes it. Only staffed members and the firm admin see it; clients never do.

<div class="box later" markdown="1">
**Not built (proposals, kept off until shown to be useful):** an AI draft of the meeting summary from a transcript; the assistant reading confirmed summaries; a list of all decisions; a calendar screen; a guided "renew" step that carries open actions into the next project; a reason for why a contract ended; a pause state for a project; re-checking results at 6 and 12 months.
</div>

# Part B. What the scenarios found so far

The scenario plan has 21 scenarios, run on separate full copies of the app with sample data (Arabic, desktop; English and a 768 px dark run come later). Each step is clicked as the real person would, and scored PASS, PASS with friction, or FAIL.

<div class="stat">
<div><b>No privacy finding</b>on any copy so far. Nobody saw another client, a firm-only item, or a count of something left out.</div>
<div><b>70 pass, 4 fail</b>on copy A (scenarios 1, 2, 8, 9, 12, 15 reminder, 20).</div>
<div><b>15 of 21</b>scenarios done, one more in part (15), two started (14, 16), three not run (6, 7, 19).</div>
</div>

## Where we are

| Scenario | Copy | State | Result |
|---|---|---|---|
| 1 New client to a working plan | A | Done | Passed with friction (24 pass, 1 fail) |
| 2 The everyday cycle | A | Done | Passed with friction |
| 3 Evidence sent back twice | B | Done | Passed with friction |
| 4 Blocked and an accepted risk | B | Done | Passed with friction |
| 5 Asking for more time | B | Done | **One FAIL** |
| 8 A firm-run client | A | Done | Passed with friction |
| 9 Someone leaves the client | A | Done | Passed with friction; one expectation not met |
| 10 A steering meeting | B | Done | Passed with friction |
| 11 The monthly report | B | Done | Passed with friction |
| 12 Business indicators | A | Done | Passed with friction |
| 13 The assistant, both sides | B | Done (local model) | Passed; progress draft numbers FAIL |
| 15 End reminder (reminder part) | A | Done | **Pass** |
| 17 A busy Monday morning | B | Done | Pass |
| 18 Layout, keyboard, language | C | Done | Passed with friction |
| 20 Structure to a printed chart | A | Done | **FAILED at steps 10 to 12** (one real bug) |
| 21 A file and a meeting kept from one person | B | Done | Pass: nobody left out saw anything, not even a count |
| 14 Closing a project | C | Started | Not finished |
| 16 A second client from an inquiry | B | Started | Not finished |
| 6, 7, 19 isolation sweep, copy D (English) | n/a | Not run | Waiting |

## The failures

1. **Declining a date request gives no reason (scenario 5).** **Decline** acts at once. There is no reason box and no place to offer a meeting, and the decline cannot be taken back. The consultant has to write in the discussion thread.
2. **The org chart cannot be edited after publishing (scenario 20).** Ids created at publish are not valid, so saving the next draft returned an error and an invitation into a vacancy failed. A workaround (import one Excel row) worked. A fix was in progress.
3. **The progress draft disagrees with the project page (scenario 13).** The draft said 0 verified and 1 late; the project page said 1 of 8 verified and 3 late. A consultant who pastes it without checking sends wrong numbers.
4. **A consultant cannot set their own expertise (scenario 1).** The page says they can; only the admin has the control.
5. **Owner change tells only the new owner (scenario 9).** The lead and the project's consultants are not told, and the history shows no "owner changed" line.

## Confusions and friction

- "Start work" on Home only opens the action; a second click starts it (scenario 2). The best fix: make the Home button start it, or label it "Open".
- Accepting an evidence item and signing off are two steps, and the first attempt gets an instruction instead of a combined step (scenarios 3 and 4). The risk-acceptance **Sign** button is disabled with no message saying why.
- Work mail is held until Sunday, 07:00, and nothing on the screen says a mail is held (scenarios 1, 2, 3). Easy to miss on a Friday test.
- Plan import before the client's people are on the project flags every owner unknown (scenario 1).
- "Make lead" is hidden under a row menu (scenario 1). The conflict dialog defaults to "conflict".
- Draft actions are not marked on the plan list.
- A scanned page or a switched-off attachment is answered as if it were another file (scenario 13). The answer should say that the attachment was skipped.
- A legal question is refused without a pointer to what the documents say.
- A summary switch labelled "firm only" means "shared" when on.
- Sharing a report sends no client notice; the report PDF can show the day before.
- The numbers import button is hidden until a data mode is chosen (scenario 12).
- Dialogs ignore clicks made before they finish loading.
- The org chart draft from pasted text gave 0 units after 135 seconds on the processor (scenario 20).
- The firm-run reviewer text should say "ask a colleague to review" when nobody else is on the team (scenario 8).
- The "Not found" page is served with HTTP code 200, so a script cannot tell found from not found.
- Accessible names are missing on the logo link, radios and checkboxes; one Arabic phrase has a grammar slip ("5 إجراءً ما زالت قائمة").
- "Release now" in the add-action dialog may save a draft (not confirmed).

## What worked

- The two sign-off rule, the date-request flow, risk acceptance and the evidence-by-item flow all worked and were understood.
- The same progress number agrees in four places on one project.
- A virus test file was refused with a clear message.
- The end-of-engagement notice reached the lead and the admin, nobody on the client side.
- A busy Monday: each of three people found what needs them on the first screen without a click.
- The assistant refused rulings and offered drafts only. In 15 of 15 answers checked for a client asker, no citation named another client or a firm-only file.

## What is still to do

Finish scenarios 14 and 16, run 6 and 7, run copy D in English and at 768 px dark, run the scenario 19 isolation sweep on every copy by an independent reviewer, re-run every failed step independently, write the scenario report, and then stop at Gate C for the owner's decision. The Production path lists the after-scenarios list.
