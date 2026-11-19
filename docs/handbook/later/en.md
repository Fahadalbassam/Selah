# Later improvements

Ideas the firm may build later, written down so the team can split them. **None of this is built, and there are no dates.** What Selah does today is in the firm and client guides; what it will not do is in [What Selah will not do](../limits/en.md).

[العربية](ar.md) · [Handbook front page](../en.md)

<a id="rules"></a>

## Rules for every item

- **Automation suggests, a person decides.** Every item below proposes something: a value, a score, a warning. It changes nothing on its own. A consultant or the client accepts, changes or ignores it, and the record says who decided.
- **It must run well on our server:** a GTX 1050 graphics card, 16 GB of memory, and the local model. Nothing is sent to a hosted model with client files. If an item needs a bigger machine, it waits.
- **Keep the app light.** One shared local model and one search index serve every AI feature. No new model, agent or service just for one feature. Use plain rules and database queries (thresholds, counts, dates) wherever they do the job, and use AI only where it clearly helps.
- **Keep it fast.** AI jobs run in one shared queue, one at a time on the server. Answers and embeddings that have not changed are cached. A file is indexed once, and again only when it changes. Page and AI response times are measured before and after each feature.
- **The same access rules.** A suggestion is read as the person who will see it, so it never shows what that person may not open.
- **No judging words.** No scores of people, no rankings, no "good" or "bad", no colour verdicts. Figures and facts, with their source.
- **Keep the data now.** Each item names the data it needs. The one thing to do today is to keep that data structured and timestamped, so it is there when the item is built.

<a id="kpi-help"></a>

## 1. Automatic help with business indicators

**What it does.** Reads indicator values from a spreadsheet or file the client uploads and proposes the rows to add. Flags a value that moved away from its target. Suggests a likely link between an indicator and a recommendation.

- **Who decides.** The client's admin or manager accepts each value before it is saved. Only the firm confirms a link to a recommendation, as today.
- **On the server.** Spreadsheets are read without a model (the import already does this). The model is used only for a messy file where the columns are not clear. The flag is a plain rule: the latest value against the target and the direction (lower or higher is better).
- **Data it needs.** Each indicator's baseline, target, target date and direction; values by period; the recommendations of the project.
- **Keep now, structured and timestamped.** Each value with its period, who entered it and when, how it came in (typed, imported, connected), and every correction kept beside the original. Each link with who made it and when. Most of this is kept today; keep it that way.
- **Never.** It never says a recommendation caused a change. The line "reported figures, not verified impact" stays.

<a id="assessment-help"></a>

## 2. Help with the governance assessment

**What it does.** For each assessment question, suggests a draft answer and score from the client's evidence, compared with the reference library (see [the reference library](#reference-library)). Every suggestion has a citation: the client's file and page, and the reference it is measured against.

- **Who decides.** The consultant accepts, changes or rejects each draft. A draft is marked as a draft until a consultant takes it on. Scores stay with the firm, as today.
- **On the server.** Runs as a background job in the shared queue (overnight if needed), not while the consultant waits. One short reason per question.
- **Data it needs.** The template's questions with their reference numbers; the evidence files the client allowed the assistant to read; the reference library.
- **Keep now, structured and timestamped.** Each answer with who answered it and when, the template version it belongs to, and the evidence files linked to it. If an answer is changed, keep the earlier answer too (to check: today an answer keeps only its latest time).
- **Never.** No ruling that a client is "compliant" or "non-compliant".

<a id="lanes"></a>

## 3. Spotting stuck or overloaded lanes

**What it does.** From the history of actions, spots a lane that is stuck or overloaded: a consultant with many reviews waiting a long time, a client person who owns most of the late work in a department, a project where nothing has moved for weeks.

- **Who decides.** It shows the facts to the firm admin or the lead, who may already see them. They decide, for example to give an action to a colleague (that button exists).
- **On the server.** Database queries only: counts, ages and dates. No model.
- **Data it needs.** Each change of an action's state with who made it and when; when evidence was sent and when it was reviewed; date requests and their answers.
- **Keep now, structured and timestamped.** The action history as it is kept today (each change, its time and who made it), never rewritten. Review decisions with their times.
- **Never.** No score or ranking of a person. Counts and waiting times only, as the Team page shows today.

<a id="other-ideas"></a>

## 4. Other practical ideas from the reviews

Only ideas that clearly help, each small:

- **"What changed since my last visit" and a meeting brief in the assistant.** The screens already know what moved; the assistant does not. A cited list of the changes, and a brief built from a meeting's agenda, open decisions and open actions, marked as a draft. Value test tasks 3 and 6 show whether the time saved is worth it. Uses the same model and the same readers as the screens.
- **Reading scanned pages (text recognition).** A scanned board minute is invisible to the assistant today. Run text recognition only on the pages marked as scanned, in the shared queue, then index them once. Runs on the processor.
- **Saving an answer as a note.** Save an assistant answer, with its citations, as a firm-only note on the project, by the person who asked. Never shared with the client automatically.

Already decided, not an idea: the client's **progress-update draft** is approved as facts only (done, in progress, waiting, late, with dates and sources), marked as a draft, and never sent by Selah.

<a id="reference-library"></a>

## 5. The reference library (plan)

A small library of governance and strategy references that the assistant and the assessment help can cite. Not built.

**The six sources:**
1. The IFC family business governance handbook.
2. The OECD Principles of Corporate Governance.
3. The Capital Market Authority's Corporate Governance Regulations.
4. The Balanced Scorecard.
5. Good Strategy Bad Strategy.
6. The Ministry of Economy and Planning strategy framework.

**How it is kept:**
- **A separate source.** The library is a "reference" source, kept apart from the client's evidence. It is never mixed into a client's files, and a client's files never go into it.
- **Labelled in every citation.** A citation from the library says "Reference" and names the source, its edition and the place in it, so nobody takes it for the client's own document.
- **Edition and date.** Each source is stored with its edition or the date of the version used, since regulations are amended.
- **Copyright.** Each source's licence is checked before anything is loaded. The two books are copyrighted: answers quote them only briefly, with the page, and the library holds the firm's own short notes about them rather than their text.
- **Tested.** Arabic and English questions about each source are added to the labelled test set for the assistant, with the right passages marked, so we can see whether answers cite the right place.

<a id="splitting"></a>

## 6. Splitting the work

Each item can be taken by one person or a pair. Suggested order: the things that need no model first.

| Item | Needs a model? | Depends on | Size |
|---|---|---|---|
| 3. Stuck or overloaded lanes | No | Action history (kept today) | Small to medium |
| 1. Indicator help: the flag and the spreadsheet rows | No | The import (exists) | Small |
| 1. Indicator help: messy files and suggested links | Yes, the shared one | The flag above | Medium |
| 4. "What changed" and the meeting brief | Yes, the shared one | Value test result | Small to medium |
| 4. Saving an answer as a note | No | None | Small |
| 4. Reading scanned pages | No (text recognition) | The shared queue | Medium |
| 5. The reference library | For search only | Licence check of each source | Medium |
| 2. Assessment help | Yes, the shared one | The reference library, the labelled test set | Medium to large |
