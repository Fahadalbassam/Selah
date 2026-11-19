# Firm guide

For the firm admin, the lead consultant and deputy, consultants and observers. It starts with what each role does, then the working day, then the tasks one by one. Button and page names are as they appear on screen in English. [The Arabic guide](ar.md) has the same tasks with the Arabic screen names; in Selah, press **عربي** at the top of the page to open it.

[Handbook front page](../en.md) · [What Selah will not do](../limits/en.md) · [Client guide](../client/en.md)

## Contents

1. [Roles](#roles)
2. [The working day](#daily-loop)
3. [Adding a client](#add-client)
4. [Staffing](#staffing)
5. [The plan](#plan)
6. [Reviewing evidence](#review)
7. [Meetings](#meetings)
8. [Reports and numbers](#reports)
9. [Handing over deliverables](#deliverables)
10. [Closing a project](#closing)
11. [The assistant](#assistant)
12. [The client's organisation structure](#structure)

<a id="roles"></a>

## 1. Roles

Selah decides on the server what each person sees, from their organisation, their role, the projects they are staffed on and each record's label. If someone opens an address they may not see, they get "Not found", as if it did not exist.

<a id="firm-admin"></a>

### Firm admin

- Adds clients (only the firm admin does), and names each client's lead consultant and, if wanted, a deputy.
- Changes how a client takes part, records signed engagements, and offers the assistant to a client.
- Does the final close of a project, and archives a client that leaves.
- Runs the team, the firm settings (reminders, escalation, retention) and reads the audit log.
- Sees every client and every project, except files a client keeps to itself. Gets work notifications only when staffed on a project or after pressing **Watch** on a client or project.

<a id="lead"></a>

### Lead consultant of a client

- One per client, and sees all of that client's projects.
- Adds consultants to the client's team or takes them off, staffs them on projects, and approves or declines join requests.
- Starts closing a project, publishes the client's organisation structure, and decides a third request to move a due date.
- Stays the accountable name for the client.

<a id="deputy"></a>

### Deputy

Optional, one per client. Can do everything the lead can, sees all of the client's projects, and gets a copy of the lead's alerts.

<a id="consultant"></a>

### Consultant

- Sees only the projects they are staffed on. Being on a client's team makes them eligible for staffing; it does not open the projects.
- Writes the plan, reviews evidence (never work they own or sent evidence for), runs meetings and prepares reports.
- Sees a list of other clients' names only, and can **Ask to join** one with a reason.

<a id="observer"></a>

### Observer

A consultant staffed on a project as "Observer: reads and comments, changes nothing". Reads everything on the project and sees no buttons that change anything, on the project, its meetings or the client's indicators. Can still add a firm note to an action and mute its mail.

<a id="daily-loop"></a>

## 2. The working day

**When:** every working day.

1. Open **Home**. It holds what waits for you, each row with its next step:
   - **Waiting on your decision**: due date changes, join requests, the client's comments on deliverables, suggested changes to the structure, recommendations the client disagreed with, and projects ready for the final close.
   - The reviews you may give (**Review**).
   - **Late or due this week**, **Your follow-ups** from meetings, **Your meetings this week**, and **Since your last visit**.
2. At the foot, one line of counts: Late · Awaiting review · Reviews waiting over 7 days · Blocked. Each opens the **Actions** page on that list. They are counts only; Selah never describes a project's health in a word.
3. On **Actions**, the lists are across the top: All, Assigned to me, Awaiting review, Late, Blocked, No activity, Date moved twice or more, Sent back twice or more, No active owner. Under them you narrow by client, project, owner and department. On a rule list each row's **⋯** holds **Remind the owner** (once a day).
4. The bell holds notifications. Mail choices are in the menu under your name at the foot of the sidebar: **Mail options**.

The language (EN / عربي) and dark mode are in the top bar.

**Screens:** Home (`/`), Actions (`/actions`).

<a id="add-client"></a>

## 3. Adding a client

**When:** a new client signs. **Who:** the firm admin only.

**From an inquiry:** **Inquiries** → open it. Under **Steps** there are four, in order: read it and give it an owner, hold the discovery session, send the proposal, make it a client. The current step has the only solid button. The conflict check is on the side and must be clear (or overridden) before **Make it a client**, which creates the client, records the signed engagement, names the lead and, if you like, starts the first project.

**Directly:** **Clients** → **Add client** → the name in English and Arabic → **Create**. The client's page opens.

**Then, on the client's page** (tabs: Overview · People · Setup · Structure):

1. **People** → **Add consultant**, then from the **⋯** menu on their row: **Make lead** for the lead consultant, and **Make deputy** if you want one.
2. **Setup** → **How the client takes part**: Full (the client's people sign in and record their progress), Restricted (only the client's admins sign in, and their files stay private from the firm until they share them), or Consultant-managed (no client accounts; the firm records progress and evidence for it). The same tab holds the second sign-off rule, the client assistant card and the signed engagements (**Record an engagement**).
3. **Overview** → **New project**. One project per phase or agreed scope.
4. **People** → **Invite someone**: invite the client admin. They get an email with a link that works for 7 days, at their own address.

**What happens next:** the client admin invites their colleagues and adds them to projects. A project no signed engagement covers stays a draft the client does not see.

**A pitch to an organisation that is not a client yet:** **Clients** → **Start a pitch**. Only the firm sees it; the firm admin makes it a client.

**Screens:** Clients (`/clients`), an inquiry (`/inquiries/<id>`), the client page and its tabs (`/clients/<id>`).

<a id="staffing"></a>

## 4. Staffing

**When:** a project starts, or the people on it change. **Who:** the lead and deputy, and the firm admin.

1. The client's team: client page → **People** → **Add consultant**. They join the client's team and do not see its projects yet. Consultants whose expertise matches the inquiry come first, marked **Suggested**; the choice is yours.
2. Staffing a project: project page → **People** → **Firm staff** → **Staff on project**. Pick from the client's team, and choose **Observer** if they should only read.
3. The client's people on the project: on the same tab, **Client people on this project** → **Add a person**. Only people on the project can own its actions. A consultant-managed client has no accounts: name each action's owner on the action instead.
4. Who speaks for the client: **Client roles** → **Name someone**: Sponsor (told at the last escalation level), Coordinator, Steering committee, Acceptor, Observer.
5. A colleague's request to join: it shows on **Home** under **Waiting on your decision**, and on the client page → **People** → **Join requests**: **Approve** or **Decline**.

**What happens next:** a staffed consultant sees the project at once. Taking a consultant off the client's team takes them off all its projects. Nobody from the client leaves a project while they own open actions on it: **Reassign their actions first**.

**Screens:** client page → People, project page → People (`/projects/<id>`).

<a id="plan"></a>

## 5. The plan

**When:** after the diagnosis, and whenever work is added. **Who:** staffed consultants (not observers). The client reads the plan; it never writes it.

A project page has five tabs: **Plan** · **Requests and files** · **Meetings** · **Progress** · **People**. Under the title, one line of counts: what the consultant verified, what is late, and what waits for review.

1. **Plan** → **Sources** at the top: the assessments run on the project, and **Start an assessment**.
2. **Add a recommendation** is the page's main button: the text, priority, due date, the finding it answers, and under **More fields** the source, department, target outcome, the evidence that shows it is done, and who can see it. The **⋯** beside it holds **Add a finding**, **Import** from Excel or Word, and **Download as Excel**.
3. Beside each recommendation, **Add an action**: the step, owner, due date, department and **Evidence list** (what the client should send), then either keep it as a draft or **Release to the owner now**.
4. A draft is seen by nobody at the client, not even its owner, and is not in the client's numbers, until you press **Release to owner** on the action page.
5. The chips under the plan filter it, each with its count: Late · Blocked · No activity for a while · Date moved twice or more · Sent back twice or more · No active owner · Waiting for review over 7 days · Recommendations the company disagrees with. The client sees Late and Blocked only.
6. Open an action row with its arrow to see the files sent and the last review decision.

**What happens next:** the owner is told on release. The client answers each recommendation (agree, partly agree, disagree); one it disagrees with shows under **Waiting on your decision**, and you may **Answer** the client's response once. For a client the firm runs, you record its answer (**Record the client's response**) with how and when it was given, and a colleague confirms it before it counts.

**Giving an action to a colleague:** on the action page, beside the owner, **Give to a colleague**. The status stays as it is; the new and previous owners, the lead, the deputy and the consultants on the project are told.

**Screens:** project page → Plan, a recommendation (`/recommendations/<id>`), an action (`/actions/<id>`).

<a id="review"></a>

## 6. Reviewing evidence

**When:** work is sent for review. The client's lead and the staff on the project are told. **Who:** any consultant staffed on the project who is not an observer, and never for their own work or evidence.

1. Open **Actions** → **Awaiting review** (with how long each has waited), or a **Review** row on **Home**.
2. On the action page, the **Next step** card shows the files sent, each with **Download**.
3. In the **Evidence list**, for each item: **Accept**, **Not accepted** (say what is missing; the client sees it), or **Not needed** (say why).
4. Then decide:
   - **Verify** makes the action Verified. When every item has its file and one sign-off is enough, it also accepts the item files still waiting, in one step.
   - **Request revision**: say what is missing. The owner sees your reason and sends a corrected file.
5. When the work needs two sign-offs (the client's rule, or asked for on one action): the first consultant presses **Sign off (first of two)**, then another presses **Second sign-off and verify**.

**A new date:** when the client proposes a new due date, the same card shows **Approve** and **Decline** with the reason they gave. A third move later is decided by the lead or the firm admin.

**What happens next:** the owner is told of the decision. A consultant can reopen verified work later, with a reason, from the **⋯** beside the title. Nothing becomes Verified without a consultant's review: the database itself refuses it.

**For a client the firm runs:** you send the file for the client, saying how and when the client sent it, and another colleague reviews it.

**Screens:** Actions → Awaiting review (`/actions?filter=awaiting-review`), an action waiting for review.

<a id="meetings"></a>

## 7. Meetings

**When:** a steering committee, a department workshop, a hand-over. **Who:** staffed consultants; the client's admins and managers can book too.

1. Project page → **Meetings** → **Book a meeting**: the time, the call link (Meet, Teams or Zoom) or the place, the attendees, and a department if it is one department's meeting.
2. A department's meeting lists only that department's work on its agenda. A meeting of the whole project opens only for people who may see everything on the project; if you invite someone with limits, the form names them before you save and offers that department's meeting instead. An invited action owner sees only their own actions on the agenda.
3. **Send invites**: every attendee gets a calendar invitation by email. Send them again after any change.
4. The agenda is built from the work itself: late work, work waiting for review, blocked work, and what changed since the last meeting.
5. Afterwards: **Mark as held**, then **Edit summary**, **Record a decision**, and **Add a follow-up** for each thing someone took on.

**What happens next:** follow-ups show under **Your follow-ups** on the home of the person they are given to. Selah does not host the call; it sends the link.

**Screens:** project page → Meetings, a meeting (`/meetings/<id>`).

<a id="reports"></a>

## 8. Reports and numbers

**When:** monthly, and before steering meetings. **Who:** staffed consultants.

1. Project page → **Progress**: the numbers (what the consultant verified, how actions ended, what is late, how long reviews wait), then **Reports**, the hand-over card, and the activity record.
2. **New report** → **Create report**: it freezes the project's numbers as they were on the last day of the period, and stays with the firm. Then **Share with the client** (sharing cannot be undone).
3. The monthly status pack: the monthly job drafts it, seen only by the firm. Write a **Note for the client**, **Issue** it, then share it.
4. Per client: client page → **Overview**: progress across projects and departments, and **Download the client-wide report as PDF**.
5. Across the firm: **Projects** → **Table**: per project, open, late and blocked work and the oldest waiting review, as counts with no judging word.
6. **Business indicators** on the client page: the client's own figures (complaints, staff turnover…) with a baseline and a target. They always carry: "These figures are reported by the client and are not verified impact. A change in an indicator is not proof that a recommendation caused it." Only the firm links an indicator to a recommendation. When a figure moves away from its baseline, the lead, the deputy and the client's admins get a notice with the figures only.

**Screens:** project page → Progress, a report (`/reports/<id>`), Projects → Table, an indicator (`/indicators/<id>`).

<a id="deliverables"></a>

## 9. Handing over deliverables

**When:** the firm hands over a deliverable of the engagement (a report, a matrix, a policy). **Who:** the lead and deputy, and consultants staffed on the engagement's projects.

1. Share the file with the client first, from its own menu on the **Requests and files** tab. Handing over never shares anything by itself.
2. Open the engagement (from the project page or the client page) → **Deliverables** → **Hand over** beside the deliverable. Pick the files; each starts at its latest version.
3. The project's acceptor is asked to confirm receipt; failing that the client admin, failing that the sponsor.

**What happens next:** the receiver sees the files on their home under **Files waiting for your confirmation of receipt**, and confirms receipt or writes a comment, which reaches you on your home. The states: Not handed over · Handed over (waiting) · Received · Commented. Received means the files reached the client, never that the client accepted the work. For a new version, **Hand over a new version**; the earlier round folds under **Earlier hand-overs**.

**Screens:** an engagement (`/engagements/<id>`).

<a id="closing"></a>

## 10. Closing a project

**When:** the work is done, or the client asks to close. **Who:** the lead or deputy starts closing; the firm admin does the final close.

1. Project page → **⋯** beside the title → **Start closing**. Work goes on while closing, and you can **Stop closing** at any time. A **Closing** tab appears.
2. **Open actions**: for each action that is neither verified nor closed, **Decide**: hand it to a named person at the client who carries it on, or another decision with its reason. The client admin or the sponsor can name who carries it on too.
3. **Lessons** → **Write lessons**: what went well, what to improve, what to do next time. Firm only; clients never see them.
4. Case-study consent from the client is optional and does not stop the close. Deliverables handed over and not answered do not hold it up; afterwards they read "No answer before the project closed".
5. When everything is settled, the firm admin's **Home** shows a **Close for good** row. They press **Close project**.

**What happens next:** the project is read-only for everyone, and the **Closure report (PDF)** is ready to download. The firm admin can **Reopen** it when needed, with a reason.

**Screens:** project page → Closing.

<a id="assistant"></a>

## 11. The assistant

**When:** to ask about a client's files and records, or to draft a follow-up message. **Who:** every consultant and the firm admin.

1. **Assistant** in the sidebar opens a floating card. Under **Ask about**, choose **All my clients** or one project.
2. Ask in Arabic or English. Every answer names its source (the file, its version and page, or the record); press a source to open it.
3. **Ask the assistant** on an action, a meeting, a recommendation or a file starts a chat about it.
4. The assistant reads a file only after its owner presses **Let the assistant read it**, and after the file is scanned.

**Good to know:**

- It answers only from what you yourself may open. If you are taken off a client, your chats about it go too.
- When two versions of a document disagree, it says so and cites both.
- It writes drafts and sends nothing.
- It gives no legal rulings and does not judge compliance. What it writes is not the firm's view until a consultant takes it on.
- When the model is hosted outside the server, the names of people, clients and departments Selah knows are replaced with placeholders before any text leaves.

**The client assistant** stays off until the firm admin offers it (client page → **Setup** → **Client assistant** → **Offer the assistant to this client**: who can use it and how many questions a day) and the client admin agrees. Action owners never get it.

**Screens:** the assistant card (`/assistant`), the client assistant card on the client page → Setup.

<a id="structure"></a>

## 12. The client's organisation structure

Client page → **Structure**: the published drawing with the people in each position and the vacancies, levels, versions, and **Download PDF**. The firm prepares the draft (**Edit the draft**, or **Import** from Excel or Word); the lead, the deputy and the firm admin publish it (**Review and publish**). The client admin places people in positions and suggests changes. The structure describes positions only: it never grants or limits access, and Selah never judges it. The steps in detail are in [docs/walkthrough.md](../../walkthrough.md) (section 5.3).
