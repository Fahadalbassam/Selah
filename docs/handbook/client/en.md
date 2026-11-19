# Client guide

Selah is where your company and your consulting firm follow what was agreed: each recommendation, who takes it on, what is done and what is waiting. This guide is a set of short tasks. Each one says when you need it, the steps, and what happens next. [The Arabic guide](ar.md) has the same tasks; in Selah, press **عربي** at the top of the page to open it.

[Handbook front page](../en.md) · [What Selah will not do](../limits/en.md)

## Contents

- [Who does what at your company](#roles)
- [Your first sign-in](#first-sign-in)
- [Your home page](#home)
- [Answer a recommendation](#answer)
- [Start work on an action](#start)
- [Send evidence](#evidence)
- [Send a document the firm asked for](#documents)
- [Ask for more time](#more-time)
- [Say you are stuck](#stuck)
- [Ask your consultant](#ask)
- [Invite a colleague](#invite)
- [Give an action to a colleague](#give-action)
- [Confirm you received what the firm handed over](#receipt)
- [The assistant, if your company was offered it](#assistant)
- [The Help page](#help)

<a id="roles"></a>

## Who does what at your company

<a id="client-admin"></a>

**Client admin:** sees everything about your company in Selah. Invites colleagues and switches their accounts off, adds them to projects, answers recommendations for the company, agrees to the assistant or switches it off, chooses how your business figures reach Selah, and reads your company's audit log. Signs in with two-factor sign-in.

<a id="client-manager"></a>

**Client manager:** sees company-wide work and their own department's work (when your company uses departments in Selah), on the projects they were added to. Does actions and sends their evidence, and uses the assistant if it is on. On a project they may be named **Sponsor**, **Coordinator** or **Acceptor**: the sponsor also answers recommendations, and the sponsor and coordinator can give an action to a colleague.

<a id="action-owner"></a>

**Action owner:** sees only their own actions, never anyone else's or how many there are. Starts work, sends evidence, asks for more time and says when they are stuck. The assistant is not available to action owners.

<a id="first-sign-in"></a>

## Your first sign-in

**When:** an invitation reaches you by email.

1. Open the link in the email (it works for 7 days). Type your name and a password, type the password again in **Type it again**, then press **Create my account**.
2. You come back to the sign-in page, which says "Your account is ready. Sign in with your new password." Type your email and the new password, then **Sign in**.
3. **Before you start** shows the terms of use, the privacy notice and "How Selah uses AI". Read them and tick the three boxes: "I accept the terms of use.", "I have read the privacy notice." and "I have read how Selah uses AI." **Accept and continue** stays greyed out until all three are ticked; then press it.
4. A client admin sets up two-factor sign-in (an authenticator app) at the first sign-in.

**What happens next:** your home page opens, with a short welcome for your first two weeks. Next time, a manager or an action owner can press **Email me a sign-in link** on the sign-in page instead of typing a password. The link works once and for a short time; open it, then press **Sign in**. If the invitation has expired, ask whoever invited you for a new one.

<a id="home"></a>

## Your home page

**When:** every time you sign in.

- **Client admin and manager:** what waits for you first, each row with its step: **Recommendations waiting for your company's answer** (**Answer**), **Files sent back to you**, **Your actions that are late or stopped**, **Answers to the dates you proposed**, **Indicators waiting for a value** (**Enter the value**), **Files waiting for your confirmation of receipt**, **Documents asked of you** (**Send a file**), **Meetings waiting for your reply** (**Reply**), **Your follow-ups**, and **Waiting for your choice**. Only the rows with something waiting show. Then how your company's work is going on each project and department, and the business indicators. If your company is part of a group of companies, a block named after the group comes last: its companies counted together, with each company beside the total.
- **Action owner:** your **Home** page (**My actions** in the sidebar opens the same page) shows your actions in three groups: **Waiting for you**, **With your consultant**, and **Finished** (folded). A group with nothing in it is hidden. Then the documents asked of you, your meetings and your follow-ups.

The language button in the top bar switches the language: it reads **عربي** on the English screen and **EN** on the Arabic one. The icon beside it switches dark mode.

**Screen:** Home (`/`).

<a id="answer"></a>

## Answer a recommendation

**When:** the firm writes a recommendation for your company. It shows on your home under **Recommendations waiting for your company's answer**. **Who:** the client admin and the project's sponsor.

1. Press **Answer** on your home, or open the recommendation from the project's **Plan** tab.
2. On the **Your company's answer** card, press **Respond**.
3. Choose:
   - **Agree**: you accept it and will carry it out. Write **What will be done** and **By when**, and if you like **Who answers for it (optional)** and a **Comment (optional)**.
   - **Partly agree**: write **What will be done** and **By when**, and in **Reason** say which part you accept and why not the rest.
   - **Disagree**: say why. The recommendation is marked disputed.
4. **Record the response**.

**What happens next:** the firm is told and may answer your response once; you see its answer under yours. Every response stays on record, and the latest is where the recommendation stands. To change it: **Change the response**.

**Screen:** a recommendation (`/recommendations/<id>`).

<a id="start"></a>

## Start work on an action

**When:** an action is given to you (you get a notification, and it shows under **Waiting for you**). **Who:** its owner, and a manager who can see it.

1. Open the action. The **Next step** card gives its due date and when a reminder goes out, for example "Due …. A reminder goes out on …." If the firm has set who is told when an action stays open, the card says that too.
2. Press **Start work**.

**What happens next:** it reads **In progress**, and its main button becomes **Send for review**. **What to send** lists the files your consultant asked for on this action.

**Screen:** an action (`/actions/<id>`).

<a id="evidence"></a>

## Send evidence

**When:** the work is done, or the file for one item is ready. **Who:** the owner, and a manager. (A client admin does not do actions; they send what the firm asks of them under [Send a document the firm asked for](#documents).)

1. On the action page press **Send for review**, or **Send a file** beside an item under **What to send**.
2. A window opens, named after the button you pressed: **Send for review** or **Send a file**. In it:
   - If you opened it from **Send for review** and the action has a list: under "Answers which item on the evidence list?", choose the item, or **Not an item on the list**. You must choose, even when the list has one item; the send button stays greyed out until you do.
   - **Upload a new file**, or **Choose from Selah files** if it is already there. Accepted: PDF, Word, Excel, PowerPoint, images or text, up to 20 MB. Every file is checked for viruses.
   - A **Note for the reviewer (optional)**.
   - Under **Then**: **Send for review now** (your consultant is told it is ready to check), or **Save without sending** (the file stays on the action, and the button at the foot of the window reads **Save without sending**).
3. Press the button at the foot of the window.

**To send a file you saved without sending:** press **Send for review** again, choose the item if asked, leave **File** empty, and press **Send for review** at the foot of the window. What you saved earlier goes for review; you do not upload it again.

**What happens next:** the action reads **Waiting for the firm**, and the card says "With the consultant since …". It may also say "A second consultant checks it too.": two consultants review it. Nothing more is needed from you. Your consultant decides:

- **Verify**: the action becomes **Verified**, and you are told.
- **Request revision**: you are told why, and the action comes back to you: for an action owner it shows on your home under **Waiting for you**, for a manager under **Files sent back to you**. Open the action and read the reason, then press **Send the revised file for review**, choose the item if asked, and attach the new file. One step: you do not need to press **Resume work** first.

What your company sends is a claim that the work is done until a consultant reviews it. Only **Verified** means a consultant accepted the evidence.

**Screen:** an action, and the **Send for review** or **Send a file** window.

<a id="documents"></a>

## Send a document the firm asked for

**When:** the firm asks for a document to understand your company (a policy, minutes, a structure). It shows on your home under **Documents asked of you** if you were asked by name. **Who:** the client admin, a manager, and an action owner when asked.

1. Press **Send a file** on your home; it opens the project's **Requests and files** tab. Or open the project → **Requests and files**.
2. Press **Send a file** beside the item. The **Send a file** window opens, with "For:" and the item's name.
3. Upload the file or choose it, then send it.

**What happens next:** the item reads **Waiting for the firm**. The consultant accepts it, or returns it with a reason and it comes back to you. The firm may also send you a no-login upload link for one item; it works for a limited time and for that item only.

**Screen:** project page → Requests and files (`/projects/<id>`).

<a id="more-time"></a>

## Ask for more time

**When:** you can see the due date will not be enough. **Who:** the owner, and a manager.

1. On the action page, under the **Next step** card, press **I need more time**.
2. Pick the **New due date** and write the **Reason**.
3. **Send request**.

**What happens next:** the consultants on the project are told. The action reads: "The new date you proposed, …, is waiting for your consultant's answer." The date does not change until they agree. Their answer shows on the action itself, for example "New date …, agreed by … on …." The client admin and managers also see it on their home under **Answers to the dates you proposed**. A third move later is decided by the lead consultant or the firm admin. You cannot propose another date while one is waiting.

<a id="stuck"></a>

## Say you are stuck

**When:** the work stopped for something outside your hands (an approval not given yet, someone unavailable). **Who:** the owner, and a manager, while the action is **In progress**.

1. On the action page, under the **Next step** card, press **I am stuck**.
2. Write in **Reason** what is in the way. The consultant will see it.
3. **Confirm**.

**What happens next:** the action reads **Needs attention**, the reason shows at the top of the card, and it joins the consultant's lists of blocked work and the next meeting's agenda. No separate notification is sent to the consultant, so if you need a quick answer, write to them in the **Discussion** (see [Ask your consultant](#ask)). When it is cleared, press **Resume work**.

<a id="ask"></a>

## Ask your consultant

**When:** you have a question about one action.

1. On the action page press **Ask the consultant**, or scroll to **Discussion**. **Ask the consultant** puts the cursor in the comment box and already mentions the lead consultant.
2. Write your comment. To alert someone else, use **Mention**; only people who can see the action are listed. If your comment reports progress, tick **This is an update on the work**: it is kept as a progress note on the action, so it counts as activity.
3. **Post**.

**What happens next:** everyone who can see the action reads the discussion: the consultants on the project and the people at your company who can open it. The answer stays with the work. For anything else, write to your consultants from the [Help page](#help).

<a id="invite"></a>

## Invite a colleague

**When:** a colleague needs to follow work or take some on. **Who:** the client admin. (Managers and owners ask the client admin.)

1. **People** in the sidebar, under **Company** → **Invite someone**.
2. **Name**, **Email** (their own address: Selah never creates mailboxes) and **Role**: client manager, action owner or client admin. If your company has a published structure with a vacancy, you can pick a **Position in the structure (optional)**.
3. **Invite someone**.
4. Then add them to the project: open the project → **People** → **Your people on this project** → **Add a person**.

**What happens next:** they get an email with a link that works for 7 days. Managers and owners see only the projects they are added to, and only people on a project can own its actions. Open invitations are under **Access** on the same page, where you can revoke them. At a company whose participation is "Restricted", only client admins have accounts, and the admin who owns an action starts it, writes its progress and sends its files for review.

**Screens:** People (`/team`), project page → People.

<a id="give-action"></a>

## Give an action to a colleague

**When:** the owner leaves, or the work moves to someone else. **Who:** the client admin, and the project's coordinator and sponsor.

1. Open the action. Beside the owner, press **Give to a colleague**.
2. Type part of the **Colleague**'s name and pick them. Only people on the project are listed; if they are not on it, add them to the project first.
3. **Give it**.

**What happens next:** the action's status stays as it is. Your colleague, the previous owner and the firm's consultants on the project are told, and it is recorded in the action's history and the audit log. The previous owner no longer sees the action.

<a id="receipt"></a>

## Confirm you received what the firm handed over

**When:** the firm hands over the files of one of the engagement's deliverables. They show on your home under **Files waiting for your confirmation of receipt**. **Who:** the project's acceptor; failing that the client admin; failing that the sponsor.

1. Download the files and look at them.
2. Press **Confirm receipt**. A second window, "Confirm your company received these files", opens; press **Confirm receipt** in it again.
   Or press **Comment** if something is missing or needs changing, and write in **Your comment** (it cannot be sent empty).

**What happens next:** confirming receipt only means the files reached your company; it never means you accepted the work. The firm reads a comment and may hand over a new version. While something waits for your confirmation, its card on your home has the link **All files handed over to your company**, which opens **Files handed over to your company**: everything handed over, earlier hand-overs included. Once nothing waits, the card and its link go away; the page stays at `/deliverables`, and a hand-over notification opens it too.

**Screens:** Home, and `/deliverables`.

<a id="assistant"></a>

## The assistant, if your company was offered it

The assistant stays off until the firm offers it to your company and your client admin agrees. Action owners never get it.

**Agreeing (the client admin, once):**

1. On your home, under **Waiting for your choice**: "Your consultants' firm offered your company the assistant" → **Read and decide**. Or **Assistant** in the sidebar.
2. Read the notice: what it reads, what it never reads, that it gives no rulings, how chats are kept, and who can use it.
3. Tick "I have read this and agree for my company.", then **Agree and switch on**.

To switch it off at any time: the menu under your name → **Assistant consent** → **Switch off the assistant**. An "Are you sure?" window asks; press **Continue**.

**Using it (the client admin and managers, as the firm offered it):**

1. **Assistant** in the sidebar opens a card. Choose **All your projects** or one project.
2. Ask your question. Every answer names its source; press it to open it. The card shows how many questions you have asked today.

**Good to know:** the assistant reads only what you can already open. It never sees the firm's internal notes, assessment scores or other clients. It never rules on the law or compliance, never speaks for the firm, and takes no decisions. For a decision, ask your consultant.

<a id="help"></a>

## The Help page

**Help** at the foot of the sidebar, and in the menu under your name:

- **Your consultants**: the lead consultant, the deputy and the others, with their projects and work email.
- **Write to the firm's management**: when something in Selah is broken, or something about the work worries you and you would rather not raise it with your consultant. Only the firm's management reads it, not your consultants.
- **Questions people ask**.
- **Open your guide**: opens the part of this guide for your role.

**Screen:** Help (`/help`).
