# Assistant value test: a single-tester trial

Does the assistant save a consultant real time on real tasks, without making the answers worse? This is a short trial to get a first answer.

**What this is, and what it is not.** One person (the owner) runs every task on his own laptop, once with the assistant and once without it. He times each attempt, checks the answer against the key below, and notes whether he would use the assistant for that task. The result is **a single-tester trial, not a measured study**: one person, six tasks, and a tester who knows the product and, on the second attempt, already knows the answer. Report it in those words. It replaces, for now, the five-consultant plan in `docs/review/work/phase3-assistant-redaction.md` section 1.5 (Gate B answer, `docs/review/lead-log.md`, Gate B answers, part 1).

All data is the synthetic walkthrough data (`docs/walkthrough.md`). Mizan Advisory and its clients are fictional.

## 1. Before you start

1. Load the walkthrough the same day you run the test, because "late" is counted from the day the data is loaded: `npm run walkthrough -- --fresh` (`docs/walkthrough.md` section 1).
2. Use the **local model only** (`LLM_PROVIDER=ollama` in `.env`, `docs/walkthrough.md` section 2, option B). Nothing leaves the laptop. Do not use a hosted model for this test.
3. Use the model we plan to ship if it is installed (section 7 picks `qwen3.5:4b`). Whatever you use, write it down in the run record below.
4. Wait until the walkthrough prints that the assistant has read the sample files and records.
5. Two browser windows: a normal one and a private one, so you can be signed in as two people. Every account uses the walkthrough password (`docs/walkthrough.md` section 3).
6. A stopwatch (a phone is fine), and this file or the score sheet `docs/value-test-score-sheet.csv` open beside you.
7. Do not read the answer keys in section 5 until you have finished both attempts of a task.

### Run record (fill in before the first task)

| What | Value |
|---|---|
| Date | |
| Selah commit (`git log -1 --format=%h`) | |
| Chat model and its size (`ollama list`) | |
| Search model | bge-m3 (check `ollama list`) |
| `LLM_PROVIDER` | ollama |
| Laptop: processor | |
| Laptop: graphics card and its memory | |
| Laptop: memory (RAM) | |
| Is this the production server? | No: the server is a GTX 1050 with 16 GB RAM. Answers there will be slower than on this laptop, so the times here are the best case. |

## 2. How to run each task

- **One task at a time, both attempts back to back.** Do tasks 1, 3 and 5 with the assistant first; do tasks 2, 4 and 6 without it first. Swapping the order this way shares out the advantage of the second attempt, where you already know the answer.
- **The clock** starts when you have read the question and stops when you have written your final answer (a few lines in a text file is enough). Stop at 8 minutes: write "stopped at 8 min" and score what you have.
- **With the assistant:** use the assistant (المساعد الذكي) as much as you like, and the screens too if you want; write down if you went back to the screens and why.
- **Without the assistant:** screens and the Files card search only. Use the places listed under "Where to look without the assistant".
- **Right?** compares your final answer with the key: yes (everything in the key), partly (something missing or slightly off), no (wrong or missing the main point). Score the answer you handed in, not the assistant's first reply. If the assistant's reply was wrong and you corrected it, say so in the note.
- **Citation checked?** (with the assistant only): yes if you opened at least one cited source before you accepted the answer.
- **Would use?** (with the assistant only): yes, maybe or no. Would you use the assistant for this kind of task on a normal working day?

Decide what counts as value before you start, and write it here: for example, "the assistant is faster on at least 4 of the 6 tasks, no answer is less right with the assistant than without it, and on task 4 I checked the citation".

> What counts as value (write it before task 1):
>
> &nbsp;

## 3. The tasks

The role is the account to sign in as. The question is what you type into the assistant, and what you answer without it.

### Task 1. Late work across clients (English)

- **Role:** lead@mizan.test (lead consultant).
- **Question:** "Across all my clients, what is late, why, and who owns it? Write three lines for my manager."
- **Assistant scope:** "All my clients" (كل عملائي).
- **Where to look without the assistant:** Actions (الإجراءات) → **متأخرة** (Late); open each row for its owner and its reason (blocked reason, the reason it was sent back, the date request).
- **What it shows:** the most common Monday question; tests the status reader and the cross-client scope.

### Task 2. A board decision, asked in Arabic about an English file (client side)

- **Role:** manager@nukhba.test (client manager, board secretariat; uses the client assistant).
- **Question:** «ماذا قرر مجلس الإدارة في اجتماعه رقم 14 بشأن لجنة المراجعة؟ ومن سيعمّم مسودة لائحة اللجنة؟»
- **Assistant scope:** the project حوكمة مجلس الإدارة.
- **Where to look without the assistant:** Projects → حوكمة مجلس الإدارة → **الطلبات والملفات** → the file *Board minutes 2026-03-02.txt*.
- **What it shows:** the client assistant, and a question in one language about a source in the other. The earlier run got the number of members and the person who circulates the charter wrong, so read the answer closely.

### Task 3. Getting ready for a meeting (Arabic)

- **Role:** lead@mizan.test.
- **Question:** «قبل اجتماع اللجنة التوجيهية الرابع: ما القرارات والمتابعات التي ما زالت مفتوحة من الاجتماع الثالث، وما الأدلة التي لم تصل بعد؟ اكتبها في نقاط قصيرة.»
- **Assistant scope:** the project حوكمة مجلس الإدارة.
- **Where to look without the assistant:** the project → **الاجتماعات** → *اجتماع اللجنة التوجيهية الثالث* (decision and follow-ups); the project → **الخطة** (actions sent back or waiting for files; open the action rows); **الطلبات والملفات** (documents asked of the company and not answered).
- **What it shows:** whether the assistant helps to prepare a meeting. There is no meeting-brief feature today, so the assistant has to put it together from records.

### Task 4. Two versions of one rule (Arabic): is the citation checked?

- **Role:** lead@mizan.test.
- **Question:** «ما الحد الذي يستطيع الرئيس التنفيذي اعتماده دون الرجوع إلى المجلس: 750 ألف ريال أم مليون ريال؟ أيهما ساري الآن، ولماذا؟»
- **Assistant scope:** the project حوكمة مجلس الإدارة.
- **Where to look without the assistant:** **الطلبات والملفات** → *Delegation of authority matrix 2024.docx* and *مصفوفة الصلاحيات 2026 (مسودة).docx*; the third steering meeting's decision; the action *تحديث مصفوفة الصلاحيات ورفعها للمجلس*.
- **What it shows:** the most dangerous fault seen so far: a confident, cited, wrong answer. The earlier runs gave only one figure, and once called the draft "the updated text". The point of this task is whether you open the cited file and see if it is the approved version or the draft. Record **Citation checked?** honestly.

### Task 5. A recommendation's evidence and a reply to the client (English)

- **Role:** lead@mizan.test.
- **Question:** "For the recommendation تشكيل لجنة المراجعة (form the audit committee): what evidence does it need, has anything been sent back, and why? Write a two-line reply to the client."
- **Assistant scope:** the project حوكمة مجلس الإدارة.
- **Where to look without the assistant:** the project → **الخطة** → the recommendation → its actions; open *إعداد لائحة عمل اللجنة* (the evidence list, the reason it was sent back, the discussion) and *ترشيح الأعضاء المستقلين للجنة*.
- **What it shows:** a common review task, plus a short draft. The assistant drafts but never sends.

### Task 6. What changed since my last visit (Arabic)

- **Setup, before the clock starts** (about 5 minutes, done once):
  1. Sign in as lead@mizan.test, open the project حوكمة مجلس الإدارة and stay on it for a few seconds. This sets "your last visit". Sign out.
  2. In the private window, make three changes and write down the time of each:
     - as owner@nukhba.test: open *إعداد لائحة عمل اللجنة*, send a new file for review (any small text file you make, for example «لائحة لجنة المراجعة، المسودة الثانية: الصلاحيات، أربعة اجتماعات في السنة، العلاقة مع المراجع الخارجي»);
     - as finance@nukhba.test: on *تحديث مصفوفة الصلاحيات ورفعها للمجلس*, add a progress note in the discussion («هذا تحديث عن سير العمل») such as «أرسلنا المقارنة للرئيس التنفيذي»;
     - as sponsor@nukhba.test: on *ترشيح الأعضاء المستقلين للجنة*, resume the work (**استئناف العمل**).
- **Role:** lead@mizan.test.
- **Question:** «ما الذي تغيّر في مشروع حوكمة مجلس الإدارة منذ زيارتي الأخيرة؟»
- **Assistant scope:** the project حوكمة مجلس الإدارة.
- **Where to look without the assistant:** the home page (الرئيسية) → **منذ زيارتك الأخيرة**, or the line at the top of the project («تحرّك … منذ زيارتك الأخيرة في …»), then open each action. Note that opening the project moves "your last visit" to now: do the attempt without the assistant from the home page first, or set the visit again (step 1) and make three new changes before the second attempt.
- **What it shows:** the gap. The assistant has no "what changed" reader today (assessment 1.2), so expect it to miss or guess. The task measures how big the gap is and whether you fall back to the screens.

## 4. Score sheet

Fill in one table per task. The same columns are in `docs/value-test-score-sheet.csv` for a spreadsheet. Time as minutes:seconds.

### Task 1. Late work across clients

| Attempt | Order (1st/2nd) | Time | Right? (yes/partly/no) | Citation checked? (yes/no) | Would use? (yes/maybe/no) | Note |
|---|---|---|---|---|---|---|
| With assistant | 1st | | | | | |
| Without | 2nd | | | n/a | n/a | |

### Task 2. A board decision (client side)

| Attempt | Order (1st/2nd) | Time | Right? (yes/partly/no) | Citation checked? (yes/no) | Would use? (yes/maybe/no) | Note |
|---|---|---|---|---|---|---|
| With assistant | 2nd | | | | | |
| Without | 1st | | | n/a | n/a | |

### Task 3. Getting ready for a meeting

| Attempt | Order (1st/2nd) | Time | Right? (yes/partly/no) | Citation checked? (yes/no) | Would use? (yes/maybe/no) | Note |
|---|---|---|---|---|---|---|
| With assistant | 1st | | | | | |
| Without | 2nd | | | n/a | n/a | |

### Task 4. Two versions of one rule

| Attempt | Order (1st/2nd) | Time | Right? (yes/partly/no) | Citation checked? (yes/no) | Would use? (yes/maybe/no) | Note |
|---|---|---|---|---|---|---|
| With assistant | 2nd | | | | | |
| Without | 1st | | | n/a | n/a | |

### Task 5. A recommendation's evidence and a reply

| Attempt | Order (1st/2nd) | Time | Right? (yes/partly/no) | Citation checked? (yes/no) | Would use? (yes/maybe/no) | Note |
|---|---|---|---|---|---|---|
| With assistant | 1st | | | | | |
| Without | 2nd | | | n/a | n/a | |

### Task 6. What changed since my last visit

| Attempt | Order (1st/2nd) | Time | Right? (yes/partly/no) | Citation checked? (yes/no) | Would use? (yes/maybe/no) | Note |
|---|---|---|---|---|---|---|
| With assistant | 2nd | | | | | |
| Without | 1st | | | n/a | n/a | |

### At the end (a few lines)

- Against the "what counts as value" line you wrote: met, partly met, or not met?
- Where did the assistant save the most time, and where did it cost time?
- Did you accept any answer that turned out to be wrong? Which task?
- What would you do next with the answers (copy them into a mail, save them as a note on the project, nothing)? This answers the "save an answer as a note" question in the assessment.
- Anything you would not show a client.

## 5. Answer keys (read only after both attempts of a task)

### Task 1

Three late actions on حوكمة مجلس الإدارة (Al-Nukhba), the only client the lead can see with late work:

| Action | Owner | Why it is late |
|---|---|---|
| ترشيح الأعضاء المستقلين للجنة | منصور العنزي (the sponsor, CEO) | Blocked: «بانتظار موافقة الجمعية العامة على مكافآت الأعضاء المستقلين». Due 6 days before the load day |
| مراجعة حدود الصلاحيات المالية | سلمى الشهري (Finance) | In progress, 4 days late; she asked to move the date: «الرئيس التنفيذي مسافر حتى نهاية الأسبوع القادم», waiting for the firm |
| إعداد لائحة عمل اللجنة | عبدالله المطيري (Legal) | Sent back for revision, 2 days late: the bylaws do not state the committee's powers, how often it meets, or its relation to the external auditor |

**How to check:** Actions → متأخرة as lead@mizan.test. If that list shows something else on your copy, the list is the key. **Partly:** right actions but a missing owner or reason, or a follow-up counted as an action (the overdue follow-up «إرسال جدول مقارنة الحدود المالية للجنة» is a meeting follow-up, not an action; mentioning it is fine). **No:** an action from a client the lead cannot see, or a wrong owner.

### Task 2

Meeting no. 14 (2 March 2026): the board resolved to form an **audit committee of three members, at least two of them independent**, chaired by an independent member (decision R-14/1). **Reem Al-Harbi (ريم الحربي), the board secretary, circulates the draft committee charter.**

**How to check:** open *Board minutes 2026-03-02.txt*, item 1. **Partly:** "at least three members", or the chair's independence missing. **No:** someone else circulates the charter, or anything from a file she may not open (Finance's or Legal's work, the restructuring proposal kept from her).

### Task 3

From the third steering meeting (held a week before the load day):
- Decision: lower the CEO's limit to SAR 750,000 and study the CFO's limit again («اعتماد خفض حد الرئيس التنفيذي إلى 750 ألف ريال، وإعادة دراسة حد المدير المالي»).
- Follow-ups still open: «إرسال جدول مقارنة الحدود المالية للجنة» (سلمى الشهري, overdue by 2 days); «تجهيز مذكرة الجمعية العامة عن مكافآت الأعضاء المستقلين» (فهد الدوسري, due in 5 days). The third, «مشاركة قالب لائحة اللجنة مع الشؤون القانونية» (عمر الزهراني), is done and should not be listed as open.

Evidence still missing:
- The updated matrix (*المصفوفة المحدثة*) on *تحديث مصفوفة الصلاحيات ورفعها للمجلس*; the comparison memo is in.
- A revised committee bylaws on *إعداد لائحة عمل اللجنة* (sent back: powers, meetings, external auditor).
- The chair's signed final copy of the charter on *عرض المسودة على المجلس واعتمادها* (Omar asked in the discussion; Reem will send it after the chair signs).
- The documents asked of the company on the request list and not answered yet (the three kickoff items: articles of association, delegation of authority, organisation chart). The general assembly minutes are answered.

**How to check:** the meeting page, the Plan tab rows, and Requests and files. **Partly:** the decision and follow-ups right but evidence missing, or the reverse. **No:** the done follow-up listed as open plus most items missing, or invented decisions.

### Task 4

**SAR 1,000,000 applies today.** It is in the approved matrix, version 1 (January 2024, the English file). The 750,000 figure is in version 2, **a draft** (March 2026, «لم تعتمد بعد», the Arabic file). The steering committee decided to lower the limit to 750,000, but the board has not approved the new matrix yet: the action *تحديث مصفوفة الصلاحيات ورفعها للمجلس* is still in progress. A good answer gives both figures, says which is approved and which is a draft, and cites both files.

**How to check:** open both files. **Partly:** both figures, but unclear which applies. **No:** one figure only, or 750,000 given as the rule in force. **Citation checked?** is "yes" only if you opened a cited file before accepting the answer.

### Task 5

The recommendation تشكيل لجنة المراجعة has, for the client, two actions:
- *إعداد لائحة عمل اللجنة* (عبدالله المطيري): evidence item «اللائحة متضمنة الصلاحيات ودورية الاجتماعات». It was **sent back**: the bylaws did not state the committee's powers, how often it meets, or its relation to the external auditor. The owner replied that they will add a chapter on powers and set four meetings a year.
- *ترشيح الأعضاء المستقلين للجنة* (منصور العنزي): blocked, waiting for the general assembly to approve the independent members' pay. No evidence sent.
- The firm also has a draft action, *اعتماد قرار تشكيل اللجنة ونشره*, that the client does not see. It must not appear in the reply to the client.

A good two-line reply: thanks for the reply; please send the revised bylaws with the powers, four meetings a year and the relation to the external auditor; the nominations wait for the assembly.

**How to check:** the recommendation page and the two actions. **Partly:** right reason but the draft action named, or the blocked action missing. **No:** wrong reason, or a reply that says the work is accepted.

### Task 6

The three actions you changed in the setup, each with what happened:
- *إعداد لائحة عمل اللجنة*: a new file sent for review (now waiting for the firm);
- *تحديث مصفوفة الصلاحيات ورفعها للمجلس*: a progress note from Finance;
- *ترشيح الأعضاء المستقلين للجنة*: resumed (in progress again).

**How to check:** your setup notes, and the "since your last visit" line. **Partly:** some of the three, or all three without what changed. **No:** none, or changes you did not make. Expect the assistant to miss this today: say in the note what it answered instead.

## 6. Afterwards

- Put the filled sheet, the run record and the end notes in the review folder (`docs/review/work/`) and add one line to the lead log.
- Write the result as: "Single-tester trial on <date>, <model> on <laptop>: …". Do not turn it into percentages that suggest a study.
- If an answer showed anything from a file or a client the person may not open, stop and record it as a bug: that is a confidentiality failure, not a value question.
