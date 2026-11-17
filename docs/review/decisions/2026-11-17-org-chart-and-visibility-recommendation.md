# Org chart and "who sees it" picker: recommendation

17 Nov 2026. Four independent reviewers looked at this from different seats (consulting practice, the client admin, privacy and permissions, build cost against the code). This is where they agreed, and how the disagreements were settled.

## In short

Build both. They are real needs, and each has a clear limit.

1. **The org chart** becomes the client's living structure: the firm builds it once, the client keeps the names current, everyone prints it. It is a structure of **positions**, and people sit in them, so a position survives when someone leaves.
2. **The picker** is one control with a switch, "everyone with access, except…" (default) or "only these people…". It can only take people away, never add anyone past the existing rules. It goes on **files and meetings** only.

## Your questions, answered

**Would they need to write everything down?** No. Four ways in, from least to most work: fill the Excel template (or export the current chart, edit it, re-import it); paste a Word outline whose headings are the levels; paste any text and let the assistant arrange it into rows; or type it in the outline editor. Every route ends in a review screen before anything is saved.

**Could the assistant help?** Yes, from text: it turns a pasted list or outline into rows for a person to check. It never invents a position. It cannot read a picture of a chart yet. The AI service is text-only, the local model has no vision, and names inside an image cannot be hidden from a hosted model. We revisit that if the model research picks a vision model.

**What format?** Levels, units (board, executive, sector, department, section), positions under each unit (title, reports to, head or not, specialties, how many people planned), then who holds each position. Codes like 2.4.1 tie it together, because titles repeat.

**Does it turn into an editable diagram? With what tools?** Yes. It is drawn as a plain HTML tree by our own server, with no diagram library. The same drawing is used on screen and in the PDF, so Arabic right to left just works and printing goes through the Gotenberg service we already run. Editing happens in an outline list beside it (add, rename, move, indent), not by dragging boxes. Dragging is fragile in Arabic and easy to get wrong on a wide chart. The libraries we checked were either paid (GoJS, ApexTree), unmaintained (d3-org-chart), or hard to print and mirror (React Flow).

**Printing?** A3 or A4 landscape; choose how many levels; an overview page then one page per department; with or without names; the version and effective date in the footer. Excel export too.

**Where does it sit?** Firm side: a "Structure" tab on the client page. Client side: a "Structure" tab on the client's Departments page. No new sidebar rows, because the app already has too many buttons.

**Should the client see it?** Yes:
- The client admin sees the whole chart with names.
- A manager sees every title, and names only in their own branch and above it.
- An action owner gets no tab, just "Your manager: …" on their profile.
- Names are personal data under Saudi law, so the client admin also has a "show names" switch.

**Who edits? Who requests edits?**
- The **structure** is the firm's deliverable. The firm edits it, and the lead or the firm admin publishes it, optionally with the board's approval attached. The Saudi governance rules make the board approve the structure, so versions with dates matter.
- The **people in positions** are the client admin's to update directly (joined, left, moved), and the lead is told.
- The client admin asks for **structure changes** with one "Suggest a change" link that reaches the lead.

**What if they add or remove an employee?** The position stays. Removing someone marks the position "Vacant" and keeps the history. The existing leaving process asks "leave vacant or pick a replacement", and their open actions go through the existing hand-over. When inviting someone new, you can pick the vacant position they fill.

**How does it tie to departments and who sees what?** A unit can be linked to an existing department, but **the chart never grants or limits access**. Departments stay the only rule for that. This keeps the department rules and the new agenda rule (option C) simple.

**What it will not do:** design the structure, suggest units, judge it, model headcount or cost, or sync with the client's HR system. That would be Selah doing the consulting.

**The picker: where?** Files (except evidence) and meetings. Not on actions, recommendations, evidence or indicators. Those are the shared plan, and hiding one breaks reviews, second sign-off, agendas and closure. A sensitive recommendation (for example "merge department X") stays a firm draft until the firm releases it, and clients no longer see drafts (your D6 answer). Any file about it uses the picker.

**When is it set? Can I edit it?** When you upload a file, book a meeting, or share a deliverable with the client. Yes, you can edit it at any time. Every change is recorded, and the people left out are never told.

**One picker for clients and one for consultants?** One picker. It knows whose item it is:
- On the firm's items, firm staff can leave out colleagues and client people.
- On the client's items, the client admin can leave out client people only. To hide something from the firm, the client already has "private to the company".
- Managers and action owners don't get the picker.

**Would we ever hide something from someone at the client? Is that practical?** Yes, for files and closed meetings: salary or disciplinary papers, a restructuring that affects a manager, a board session. That is the real case, and the consulting research confirms such things are kept need-to-know until announced. No, against the client admin: they answer for the company and must see everything. Some people are always locked in so the work cannot stall:
- the person setting it
- the uploader
- the client admin
- the firm admin on firm items
- the client's lead and deputy
- the meeting's organiser

**The switch, exactly:**
- "Except" means new people who gain access later also see the item.
- "Only" means nobody else, ever, until you change it.
- Saving "only" with nobody in it is refused.
- People left out see nothing at all: no row, no count, no "1 hidden item".

## Disagreements between the reviewers, and how they were settled

| Question | Views | Decision |
|---|---|---|
| Org units = departments, or separate? | Client seat: make departments the units. Build seat: separate tree, optional link. | Separate tree with an optional link. A chart has a board, a CEO and sections that must not become access rules. |
| Assistant reads the chart picture? | Client seat: yes, primary. Build seat: the service cannot see images, and masking breaks. | Text only now; image later only with a local vision model. |
| Picker on actions? | Client seat: yes for the client admin. Privacy seat: no, it breaks the workflow. | No. Drafts (D6) and files cover the restructuring case. |
| Shares vs "only" | Build seat: treat shares as "only". Privacy seat: shares widen and must stay separate. | Shares stay a separate widening action. "Left out" beats a share, and the Share screen refuses it. |

## Size

About 7 pull requests and 13 to 14 working days for Claude Code. The org chart is useful on its own. The picker can be built beside it. Order: your three agenda answers, then the picker, then the chart (see the reply file).

## Sources the reviewers opened

- CMA Corporate Governance Regulations, Articles 22 and 23 (the board approves the structure and the duties of each level): https://ecgi.global/sites/default/files/codes/documents/CGRegulations_en.pdf
- Umbrex, enterprise organisation design (current vs target structure, people mapped after design): https://umbrex.com/services/organization/organization-design/enterprise-organization-design/
- Project research: `research/intake-and-client-ai-db.md` lines 9 and 93 (org structure and authority matrix are the firm's services); `research/lifecycle-gaps-research-notes.md` line 67 (board resolution and effective date as evidence); `research/client-journey/notes/research-precontract.md` line 121 (org chart is a standard intake document).
- Code: `docs/authorization.md`; `apps/web/src/components/ui/combobox.tsx` (no chips yet); `services/pdf.ts` (Gotenberg, JavaScript off); `services/ai/app/llm.py` (text-only model calls); `drizzle/0027_people_leaving.sql`; `drizzle/0021_departments_across.sql`.
